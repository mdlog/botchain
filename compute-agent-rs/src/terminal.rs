//! Interactive terminal sessions over WebSocket.
//!
//! A consumer with an active lease opens a WebSocket to `/terminal/{job_id}`,
//! proves ownership of the job by signing an EIP-191 challenge with their
//! wallet, and gets a live shell. The shell runs **inside a per-session Docker
//! container** (`botchain-terminal:latest`) so the provider's filesystem and
//! secrets are protected by the container boundary. The session is killed
//! automatically when the lease expires.
//!
//! Bridge layout (Tty=true → raw stream, no multiplex header):
//!   container stdout  ──► (bollard stream) ──► WebSocket (binary)
//!   WebSocket         ──► (write_all)      ──► container stdin
//!
//! Security:
//! - Auth: recovered signer MUST equal on-chain `job.consumer`; provider &
//!   active status also verified, and the challenge must be fresh.
//! - Isolation: per-session container (cap_drop ALL, readonly_rootfs,
//!   no-new-privileges), memory/cpu/pids limits, network bridge (controlled
//!   egress). Provider host filesystem is insulated by the container boundary.
//! - Lifecycle: killed (stop+remove container) on job complete/cancel/expire.

use std::sync::Arc;

use alloy::primitives::Address;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use bollard::Docker;
use bollard::container::AttachContainerResults;
use bollard::models::{ContainerCreateBody, HostConfig};
use bollard::query_parameters::{
    AttachContainerOptionsBuilder, CreateContainerOptionsBuilder, RemoveContainerOptionsBuilder,
    ResizeContainerTTYOptionsBuilder, StartContainerOptions,
};
use dashmap::DashMap;
use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;
use tracing::{info, warn};

use crate::AppState;
use crate::auth::{self, Scope, SignedAuth};
use crate::chain::JOB_ACTIVE;
use crate::sandbox;

/// The terminal session container image (built by setup.sh).
pub const TERMINAL_IMAGE: &str = "botchain-terminal:latest";

/// Close codes handed to the browser. RFC 6455 only lets applications use
/// 4000–4999; anything outside it (a 5xxx code, say) is dropped by the client
/// stack, which reports an abnormal 1006 with no reason and leaves the user
/// staring at a blank terminal instead of the actual cause.
mod close_code {
    pub const AUTH_FAILED: u16 = 4001;
    pub const CHAIN_READ_FAILED: u16 = 4002;
    pub const JOB_NOT_LEASABLE: u16 = 4003;
    pub const LEASE_EXPIRED: u16 = 4004;
    pub const DOCKER_UNAVAILABLE: u16 = 4010;
    pub const IMAGE_MISSING: u16 = 4011;
    pub const CONTAINER_FAILED: u16 = 4012;
    pub const WORKSPACE_FAILED: u16 = 4013;
}

/// Active terminal sessions keyed by job_id, so job lifecycle handlers
/// (complete / cancel / expire) can terminate a live shell.
pub type SessionMap = Arc<DashMap<u64, TerminalHandle>>;

/// Handle stored in `SessionMap` allowing a terminal to be killed externally.
/// Holds the container id + a Docker handle so `kill()` can stop+remove it.
pub struct TerminalHandle {
    container_id: String,
    docker: Docker,
}

impl TerminalHandle {
    /// Stop and remove the container (if still present). Safe to call after
    /// auto_remove has already reaped it.
    pub async fn kill(&self) {
        let _ = self.docker.stop_container(&self.container_id, None).await;
        let opts = RemoveContainerOptionsBuilder::default()
            .force(true)
            .v(true)
            .build();
        let _ = self
            .docker
            .remove_container(&self.container_id, Some(opts))
            .await;
    }
}

/// Axum handler: upgrade the WebSocket and run a terminal session.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    axum::extract::Path(job_id): axum::extract::Path<u64>,
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::response::Response {
    info!("🔌 Terminal WS upgrade requested for job #{}", job_id);
    ws.on_upgrade(move |socket| run_session(socket, job_id, state))
}

async fn run_session(mut socket: WebSocket, job_id: u64, state: AppState) {
    // A close frame is the only way to tell the browser why: the upgrade has
    // already succeeded by the time we know Docker is missing.
    let Some(docker) = state.docker.clone() else {
        close_with(
            &mut socket,
            close_code::DOCKER_UNAVAILABLE,
            "interactive terminal unavailable: this provider node has no reachable Docker daemon",
        )
        .await;
        return;
    };

    // ── 1. Auth handshake: first message must be the signed challenge ──
    let auth = match socket.recv().await {
        Some(Ok(Message::Text(t))) => serde_json::from_str::<SignedAuth>(&t),
        _ => {
            close_with(
                &mut socket,
                close_code::AUTH_FAILED,
                "expected auth message",
            )
            .await;
            return;
        }
    };
    let auth = match auth {
        Ok(a) => a,
        Err(e) => {
            close_with(
                &mut socket,
                close_code::AUTH_FAILED,
                &format!("bad auth payload: {e}"),
            )
            .await;
            return;
        }
    };

    let signer = match auth::verify(&auth, Scope::Terminal, job_id) {
        Ok(a) => a,
        Err(e) => {
            warn!("🚫 terminal auth rejected for job #{}: {}", job_id, e);
            close_with(&mut socket, close_code::AUTH_FAILED, &e.to_string()).await;
            return;
        }
    };

    // ── 2. On-chain job verification + expiry ──
    let job = match state.client.get_job(job_id).await {
        Ok(j) => j,
        Err(e) => {
            close_with(
                &mut socket,
                close_code::CHAIN_READ_FAILED,
                &format!("getJob failed: {e}"),
            )
            .await;
            return;
        }
    };
    if job.status != JOB_ACTIVE {
        close_with(&mut socket, close_code::JOB_NOT_LEASABLE, "job not active").await;
        return;
    }
    if !state.client.is_self(&job.provider) {
        close_with(
            &mut socket,
            close_code::JOB_NOT_LEASABLE,
            "job belongs to another provider",
        )
        .await;
        return;
    }
    // The recovered signer MUST be the job's consumer.
    if let Err(e) = auth::require_signer(signer, &job.consumer) {
        close_with(&mut socket, close_code::AUTH_FAILED, &e.to_string()).await;
        return;
    }

    let now = chrono::Utc::now().timestamp() as u64;
    let expires_at = job.expires_at();
    if now >= expires_at {
        close_with(&mut socket, close_code::LEASE_EXPIRED, "lease expired").await;
        return;
    }
    let remaining_secs = expires_at.saturating_sub(now);

    // ── 3. Prepare a per-session workspace (host temp dir bound into /workspace) ──
    let workspace = match sandbox::create_session_workspace().await {
        Ok(w) => w,
        Err(e) => {
            close_with(
                &mut socket,
                close_code::WORKSPACE_FAILED,
                &format!("workspace: {e}"),
            )
            .await;
            return;
        }
    };

    let mem_mb = 512u64;

    // ── 4. Create + start the terminal container ──
    let host_cfg = HostConfig {
        memory: Some((mem_mb * 1024 * 1024) as i64),
        nano_cpus: Some(1_000_000_000), // 1.0 CPU
        pids_limit: Some(256),
        cap_drop: Some(vec!["ALL".to_string()]),
        readonly_rootfs: Some(true),
        security_opt: Some(vec!["no-new-privileges:true".to_string()]),
        network_mode: Some("bridge".to_string()), // controlled egress (DNS+HTTPS native)
        auto_remove: Some(true),
        binds: Some(vec![format!("{}:/workspace", workspace.to_string_lossy())]),
        ..Default::default()
    };

    let body = ContainerCreateBody {
        image: Some(TERMINAL_IMAGE.to_string()),
        cmd: Some(vec!["/bin/bash".to_string(), "-i".to_string()]),
        tty: Some(true),
        open_stdin: Some(true),
        attach_stdin: Some(true),
        attach_stdout: Some(true),
        attach_stderr: Some(true),
        env: Some(vec![
            "TERM=xterm-256color".to_string(),
            "COLORTERM=truecolor".to_string(),
            "PS1=bash-5.2$ ".to_string(),
            "HOME=/workspace".to_string(),
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin".to_string(),
        ]),
        working_dir: Some("/workspace".to_string()),
        host_config: Some(host_cfg),
        ..Default::default()
    };

    let container_name = format!(
        "botchain-job-{}-{}",
        job_id,
        chrono::Utc::now().timestamp_millis()
    );
    let create_opts = CreateContainerOptionsBuilder::default()
        .name(&container_name)
        .build();

    let created = match docker.create_container(Some(create_opts), body).await {
        Ok(c) => c,
        Err(e) => {
            let (code, msg) = if e.to_string().to_lowercase().contains("image") {
                (
                    close_code::IMAGE_MISSING,
                    format!("terminal image '{TERMINAL_IMAGE}' missing — run setup.sh to build it"),
                )
            } else {
                (
                    close_code::CONTAINER_FAILED,
                    format!("create container: {e}"),
                )
            };
            close_with(&mut socket, code, &msg).await;
            let _ = std::fs::remove_dir_all(&workspace);
            return;
        }
    };
    let container_id = created.id.clone();

    if let Err(e) = docker
        .start_container(&container_id, None::<StartContainerOptions>)
        .await
    {
        close_with(
            &mut socket,
            close_code::CONTAINER_FAILED,
            &format!("start container: {e}"),
        )
        .await;
        remove_container(&docker, &container_id).await;
        let _ = std::fs::remove_dir_all(&workspace);
        return;
    }

    // ── 5. Attach (hijacked; Tty=true → raw stream, no demux header) ──
    let attach_opts = AttachContainerOptionsBuilder::default()
        .stdin(true)
        .stdout(true)
        .stderr(true)
        .stream(true)
        .logs(false)
        .build();
    let AttachContainerResults { output, input } = match docker
        .attach_container(&container_id, Some(attach_opts))
        .await
    {
        Ok(r) => r,
        Err(e) => {
            close_with(
                &mut socket,
                close_code::CONTAINER_FAILED,
                &format!("attach: {e}"),
            )
            .await;
            remove_container(&docker, &container_id).await;
            let _ = std::fs::remove_dir_all(&workspace);
            return;
        }
    };

    // Register the session so lifecycle handlers can kill it.
    state.sessions.insert(
        job_id,
        TerminalHandle {
            container_id: container_id.clone(),
            docker: docker.clone(),
        },
    );

    info!(
        "🟢 Terminal session started for job #{} (consumer={}, container={}, {}s remaining)",
        job_id, signer, &container_name, remaining_secs
    );

    // ── 6. Bridge: container↔WebSocket ──
    let banner = banner(job_id, signer, remaining_secs);

    let docker_for_resize = docker.clone();
    let id_for_resize = container_id.clone();

    let recv_task: tokio::task::JoinHandle<()> = tokio::spawn(async move {
        let mut output = output; // Stream<Item = Result<LogOutput>>
        let mut input = input; // Pin<Box<dyn AsyncWrite + Send>> (Unpin via Box)
        let mut ws_sent = 0u64;
        let mut pty_writes = 0u64;

        // Banner first (real WS bytes, before any container output).
        if socket
            .send(Message::Binary(banner.into_bytes().into()))
            .await
            .is_err()
        {
            return;
        }

        loop {
            tokio::select! {
                // container stdout → WebSocket
                item = output.next() => {
                    match item {
                        Some(Ok(log)) => {
                            ws_sent += 1;
                            if socket.send(Message::Binary(log.into_bytes())).await.is_err() {
                                warn!("[bridge] ws.send failed (sent={}) → closing", ws_sent);
                                break;
                            }
                        }
                        Some(Err(e)) => {
                            warn!("[bridge] container stream error: {} → closing", e);
                            break;
                        }
                        None => {
                            info!("[bridge] container output ended (sent={})", ws_sent);
                            break;
                        }
                    }
                }
                // WebSocket → container stdin (or resize control)
                msg = socket.recv() => {
                    match msg {
                        Some(Ok(Message::Text(t))) => {
                            // Control channel: {"resize":{"rows":N,"cols":M}}.
                            if let Some((rows, cols)) = parse_resize(&t) {
                                let ropts = ResizeContainerTTYOptionsBuilder::default()
                                    .h(rows as i32).w(cols as i32).build();
                                if let Err(e) = docker_for_resize.resize_container_tty(&id_for_resize, ropts).await {
                                    warn!("[bridge] resize_container_tty failed: {}", e);
                                }
                                continue;
                            }
                            pty_writes += 1;
                            if let Err(e) = input.write_all(t.as_bytes()).await {
                                warn!("[bridge] container write (text) failed: {} → closing (written={})", e, pty_writes);
                                break;
                            }
                            let _ = input.flush().await;
                        }
                        Some(Ok(Message::Binary(b))) => {
                            pty_writes += 1;
                            if let Err(e) = input.write_all(&b).await {
                                warn!("[bridge] container write (bin) failed: {} → closing (written={})", e, pty_writes);
                                break;
                            }
                            let _ = input.flush().await;
                        }
                        Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                        Some(Ok(Message::Close(_))) => {
                            info!("[bridge] client sent Close (sent={} written={})", ws_sent, pty_writes);
                            break;
                        }
                        None => {
                            info!("[bridge] socket.recv()=None (client disconnect, sent={} written={})", ws_sent, pty_writes);
                            break;
                        }
                        Some(Err(e)) => {
                            warn!("[bridge] socket.recv() error: {} (sent={} written={})", e, ws_sent, pty_writes);
                            break;
                        }
                    }
                }
            }
        }
    });

    // ── 7. Expiry timer: stop+remove the container when the lease runs out ──
    let docker_for_timer = docker.clone();
    let id_for_timer = container_id.clone();
    let expiry_task = tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(remaining_secs)).await;
        warn!(
            "⏰ Lease expired for terminal job #{}, stopping container",
            job_id
        );
        let _ = docker_for_timer.stop_container(&id_for_timer, None).await;
    });

    // Wait for the bridge to finish (client disconnect or container EOF).
    let _ = recv_task.await;
    expiry_task.abort();

    // Final cleanup: stop+remove container (auto_remove usually reaps, but be safe).
    remove_container(&docker, &container_id).await;
    let cleanup = workspace.clone();
    let _ = tokio::task::spawn_blocking(move || std::fs::remove_dir_all(cleanup)).await;

    state.sessions.remove(&job_id);
    info!("🔴 Terminal session ended for job #{}", job_id);
}

fn banner(job_id: u64, consumer: Address, remaining_secs: u64) -> String {
    format!(
        "\r\n\x1b[1;34m» BotCompute isolated compute terminal\x1b[0m\r\n\
         \x1b[2mjob #{jobid} · consumer {addr} · {secs}s remaining\x1b[0m\r\n\
         \x1b[2msandboxed via Docker container (cap_drop ALL, readonly rootfs, bridge net). shell closes when lease expires.\x1b[0m\r\n\r\n",
        jobid = job_id,
        addr = consumer,
        secs = remaining_secs
    )
}

/// Parse a `{"resize":{"rows":N,"cols":M}}` control frame, clamping degenerate
/// sizes (a 0-row SIGWINCH crashes TUI apps).
fn parse_resize(text: &str) -> Option<(u16, u16)> {
    if !text.starts_with('{') {
        return None;
    }
    let v = serde_json::from_str::<serde_json::Value>(text).ok()?;
    let r = v.get("resize")?.as_object()?;
    let read = |k: &str, fallback: u64| r.get(k).and_then(|x| x.as_u64()).unwrap_or(fallback);
    let rows = read("rows", 24).clamp(2, u16::MAX as u64) as u16;
    let cols = read("cols", 80).clamp(10, u16::MAX as u64) as u16;
    Some((rows, cols))
}

async fn remove_container(docker: &Docker, container_id: &str) {
    let _ = docker.stop_container(container_id, None).await;
    let _ = docker
        .remove_container(
            container_id,
            Some(
                RemoveContainerOptionsBuilder::default()
                    .force(true)
                    .v(true)
                    .build(),
            ),
        )
        .await;
}

async fn close_with(socket: &mut WebSocket, code: u16, reason: &str) {
    warn!("closing terminal WS: {} {}", code, reason);
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.to_string().into(),
        })))
        .await;
}

/// Terminate any live terminal for a job (called on complete/cancel/expire).
pub async fn kill_session_for_job(state: &AppState, job_id: u64) {
    if let Some((_, handle)) = state.sessions.remove(&job_id) {
        info!("🔌 Killing terminal session for job #{}", job_id);
        handle.kill().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_clamps_resize_frames() {
        assert_eq!(
            parse_resize(r#"{"resize":{"rows":40,"cols":120}}"#),
            Some((40, 120))
        );
        // Degenerate sizes are clamped, not passed through.
        assert_eq!(
            parse_resize(r#"{"resize":{"rows":0,"cols":0}}"#),
            Some((2, 10))
        );
    }

    #[test]
    fn ignores_non_resize_input() {
        assert_eq!(parse_resize("ls -la\n"), None);
        assert_eq!(parse_resize(r#"{"hello":"world"}"#), None);
    }
}
