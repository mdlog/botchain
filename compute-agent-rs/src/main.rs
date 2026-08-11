// ── BotCompute Provider Agent (Rust) ────────────────────
//
// High-performance compute agent for the BotCompute marketplace (on BOT Chain).
//   - axum HTTP server (async)
//   - alloy EVM client (type-safe contract calls)
//   - sandboxed code execution (ulimit + timeout + bubblewrap)
//   - interactive terminal (per-session Docker container)
//   - background job monitor (auto-accept/auto-complete)
//
// Endpoints:
//   GET  /health          — agent status
//   GET  /info            — provider node info
//   GET  /jobs            — list provider's jobs
//   POST /execute         — execute code (consumer → agent, signed)
//   GET  /terminal/{id}   — interactive terminal (Docker container, WebSocket, signed)
//   POST /jobs/{id}/accept — accept a pending job (provider-signed)
//   POST /jobs/{id}/complete — complete an active job (consumer-signed)
//
// Every mutating route carries an EIP-191 signed challenge (see `auth`): the
// agent URL is published on-chain, so an unauthenticated /execute would be free
// code execution and an unauthenticated /complete would let strangers settle
// other people's leases.

mod auth;
mod chain;
mod gpu;
mod monitor;
mod sandbox;
mod terminal;

use axum::{
    Router,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderValue, Method, Request, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
};
use bollard::Docker;
use chain::{ChainClient, JOB_ACTIVE, JOB_COMPLETED, JOB_PENDING};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Semaphore;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{error, info, warn};
use uuid::Uuid;

/// Ceiling on the client-supplied `/execute` timeout. Callers used to be able to
/// ask for any duration, which pinned a sandbox process on the provider's box
/// indefinitely.
const MAX_EXECUTION_TIMEOUT_SECS: u64 = 300;
const DEFAULT_EXECUTION_TIMEOUT_SECS: u64 = 60;

/// Browsers only get to call this agent from origins the operator names. Falls
/// back to the local dev server rather than to "any origin".
const DEFAULT_ALLOWED_ORIGINS: [&str; 2] = ["http://localhost:3000", "http://127.0.0.1:3000"];

#[derive(Clone)]
struct AppState {
    client: Arc<ChainClient>,
    sessions: terminal::SessionMap,
    /// `None` when the host has no reachable Docker socket. The agent still
    /// serves /execute; only the interactive terminal is unavailable.
    docker: Option<Docker>,
    /// Bounds concurrent sandbox executions to the machine's parallelism, so a
    /// burst of /execute calls cannot fork-bomb the provider.
    exec_slots: Arc<Semaphore>,
    sandbox_ok: bool,
}

// ── Error type ──────────────────────────────────────────

/// Errors are JSON because every client parses the response body as JSON; a
/// `text/plain` body surfaced to the user as an opaque parse failure.
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

impl From<auth::AuthError> for ApiError {
    fn from(e: auth::AuthError) -> Self {
        let status = match e {
            auth::AuthError::NotAuthorised { .. } => StatusCode::FORBIDDEN,
            _ => StatusCode::UNAUTHORIZED,
        };
        ApiError::new(status, e.to_string())
    }
}

fn bad_body(e: JsonRejection) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, e.body_text())
}

fn rpc_error(e: anyhow::Error) -> ApiError {
    ApiError::new(StatusCode::BAD_GATEWAY, e.to_string())
}

// ── Request logging middleware ──────────────────────────

async fn request_logger(req: Request<axum::body::Body>, next: Next) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let start = Instant::now();

    let response = next.run(req).await;

    // Skip logging health checks (too noisy).
    if path == "/health" {
        return response;
    }

    info!(
        "→ {} {} → {} ({:.0}ms)",
        method,
        path,
        response.status(),
        start.elapsed().as_millis()
    );

    response
}

// ── Payloads ────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    provider: String,
    agent: &'static str,
    version: &'static str,
    nodes: &'static str,
    rust: bool,
    sandbox: bool,
    docker: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InfoResponse {
    provider: String,
    node_ids: Vec<u64>,
    runtimes: Vec<&'static str>,
    sandbox: bool,
    docker: bool,
    gpu_summary: gpu::GpuSummary,
}

#[derive(Deserialize)]
struct ExecuteRequest {
    #[serde(rename = "jobId", alias = "job_id")]
    job_id: u64,
    language: String,
    code: String,
    #[serde(rename = "timeoutSecs", alias = "timeout_secs")]
    timeout_secs: Option<u64>,
    auth: auth::SignedAuth,
}

/// Body for routes whose only input is the signed challenge.
#[derive(Deserialize)]
struct AuthOnlyRequest {
    auth: auth::SignedAuth,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteResponse {
    execution_id: String,
    status: &'static str,
    exit_code: i32,
    stdout: String,
    stderr: String,
    duration_ms: u64,
    timed_out: bool,
    agent: &'static str,
}

// ── Handlers ────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let addr = state.client.address();
    let configured = addr != alloy::primitives::Address::ZERO;
    Json(HealthResponse {
        status: "ok",
        provider: if configured {
            addr.to_string()
        } else {
            "not configured".to_string()
        },
        agent: "BotCompute Provider Agent",
        version: env!("CARGO_PKG_VERSION"),
        nodes: if configured {
            "monitoring"
        } else {
            "no wallet"
        },
        rust: true,
        sandbox: state.sandbox_ok,
        docker: state.docker.is_some(),
    })
}

async fn info(State(state): State<AppState>) -> Result<Json<InfoResponse>, ApiError> {
    let addr = state.client.address();
    let node_ids = state.client.get_provider_nodes().await.map_err(rpc_error)?;

    // nvidia-smi is a process spawn; keep it off the async worker thread.
    let gpu_summary = tokio::task::spawn_blocking(gpu::get_gpu_summary)
        .await
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    info!(
        "📋 /info — provider={}, nodes={:?}, gpus={}",
        addr, node_ids, gpu_summary.unified_model
    );

    Ok(Json(InfoResponse {
        provider: addr.to_string(),
        node_ids,
        runtimes: sandbox::available_runtimes().to_vec(),
        sandbox: state.sandbox_ok,
        docker: state.docker.is_some(),
        gpu_summary,
    }))
}

async fn list_jobs(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let jobs = state.client.get_provider_jobs().await.map_err(rpc_error)?;

    let total = jobs.len();
    let pending = jobs.iter().filter(|j| j.status == JOB_PENDING).count();
    let active = jobs.iter().filter(|j| j.status == JOB_ACTIVE).count();
    let completed = jobs.iter().filter(|j| j.status == JOB_COMPLETED).count();

    info!(
        "📋 Jobs requested: {} total (pending={}, active={}, completed={})",
        total, pending, active, completed
    );

    Ok(Json(json!({
        "total": total,
        "active": active,
        "pending": pending,
        "completed": completed,
        "jobs": jobs,
    })))
}

async fn execute_code(
    State(state): State<AppState>,
    payload: Result<Json<ExecuteRequest>, JsonRejection>,
) -> Result<Json<ExecuteResponse>, ApiError> {
    let Json(req) = payload.map_err(bad_body)?;

    let signer = auth::verify(&req.auth, auth::Scope::Execute, req.job_id)?;
    let job = state.client.get_job(req.job_id).await.map_err(rpc_error)?;

    if !state.client.is_self(&job.provider) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "job belongs to another provider",
        ));
    }
    if job.status != JOB_ACTIVE {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            format!("job {} is not active (status={})", req.job_id, job.status),
        ));
    }
    auth::require_signer(signer, &job.consumer)?;

    if !state.sandbox_ok {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "bubblewrap sandbox unavailable on this node — install bubblewrap and restart the agent",
        ));
    }
    if !sandbox::check_runtime(&req.language) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("{} runtime not available", req.language),
        ));
    }

    // Held for the rest of the handler; dropping it frees the slot.
    let _slot = state.exec_slots.clone().try_acquire_owned().map_err(|_| {
        ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "all execution slots are busy, retry shortly",
        )
    })?;

    let timeout_secs = req
        .timeout_secs
        .unwrap_or(DEFAULT_EXECUTION_TIMEOUT_SECS)
        .clamp(1, MAX_EXECUTION_TIMEOUT_SECS);

    let code_lines = req.code.lines().count();
    let code_preview: String = req.code.chars().take(80).collect();
    let truncated = req.code.chars().count() > 80;
    info!(
        "🔧 EXECUTE job=#{} lang={} lines={} timeout={}s consumer={}",
        req.job_id, req.language, code_lines, timeout_secs, signer
    );
    info!(
        "📝 Code preview: {}{}",
        code_preview,
        if truncated { "..." } else { "" }
    );

    let config = sandbox::ExecutionConfig {
        language: req.language.clone(),
        code: req.code,
        timeout_secs,
        ..Default::default()
    };

    let exec_start = Instant::now();
    let result = sandbox::execute(&config).await.map_err(|e| {
        error!("❌ Execution failed: {}", e);
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    let ok = result.exit_code == 0;
    info!(
        "{} Execution done | exit={} duration={}ms (total {}ms) timed_out={}",
        if ok { "✅ COMPLETED" } else { "⚠️ FAILED" },
        result.exit_code,
        result.duration_ms,
        exec_start.elapsed().as_millis(),
        result.timed_out
    );
    log_stream("📤 stdout", &result.stdout, false);
    log_stream("⚠️ stderr", &result.stderr, true);

    Ok(Json(ExecuteResponse {
        execution_id: Uuid::new_v4().to_string(),
        status: if ok { "completed" } else { "failed" },
        exit_code: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr,
        duration_ms: result.duration_ms,
        timed_out: result.timed_out,
        agent: "rust",
    }))
}

async fn accept_job(
    State(state): State<AppState>,
    Path(job_id): Path<u64>,
    payload: Result<Json<AuthOnlyRequest>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let Json(req) = payload.map_err(bad_body)?;
    let signer = auth::verify(&req.auth, auth::Scope::Accept, job_id)?;

    let job = state.client.get_job(job_id).await.map_err(rpc_error)?;
    if !state.client.is_self(&job.provider) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "job belongs to another provider",
        ));
    }
    // Accepting is the provider committing their own hardware, so only the
    // provider on the job may trigger it.
    auth::require_signer(signer, &job.provider)?;

    info!("📲 Accept request for job #{} from {}", job_id, signer);
    state.client.accept_job(job_id).await.map_err(|e| {
        warn!("❌ Accept job #{} failed: {}", job_id, e);
        ApiError::new(StatusCode::BAD_GATEWAY, e.to_string())
    })?;
    info!("✅ Job #{} accepted on-chain", job_id);

    Ok(Json(json!({ "status": "accepted", "jobId": job_id })))
}

async fn complete_job(
    State(state): State<AppState>,
    Path(job_id): Path<u64>,
    payload: Result<Json<AuthOnlyRequest>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let Json(req) = payload.map_err(bad_body)?;
    let signer = auth::verify(&req.auth, auth::Scope::Complete, job_id)?;

    let job = state.client.get_job(job_id).await.map_err(rpc_error)?;
    if !state.client.is_self(&job.provider) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "job belongs to another provider",
        ));
    }
    // Completing settles payment and kills the consumer's shell, so only the
    // consumer who is paying for the lease may end it early.
    auth::require_signer(signer, &job.consumer)?;

    info!("🏁 Complete request for job #{} from {}", job_id, signer);
    terminal::kill_session_for_job(&state, job_id).await;

    state.client.complete_job(job_id).await.map_err(|e| {
        warn!("❌ Complete job #{} failed: {}", job_id, e);
        ApiError::new(StatusCode::BAD_GATEWAY, e.to_string())
    })?;
    info!("✅ Job #{} completed on-chain", job_id);

    Ok(Json(json!({ "status": "completed", "jobId": job_id })))
}

fn log_stream(label: &str, stream: &str, is_warning: bool) {
    if stream.is_empty() {
        return;
    }
    let preview: String = stream.chars().take(200).collect();
    let ellipsis = if stream.chars().count() > 200 {
        "..."
    } else {
        ""
    };
    if is_warning {
        warn!("{}: {}{}", label, preview, ellipsis);
    } else {
        info!("{}: {}{}", label, preview, ellipsis);
    }
}

// ── Wiring ──────────────────────────────────────────────

fn cors_layer() -> CorsLayer {
    let configured = std::env::var("AGENT_ALLOWED_ORIGINS").unwrap_or_default();
    let mut origins: Vec<HeaderValue> = configured
        .split(',')
        .map(str::trim)
        .filter(|o| !o.is_empty())
        .filter_map(|o| match HeaderValue::from_str(o) {
            Ok(v) => Some(v),
            Err(_) => {
                warn!("⚠️ Ignoring invalid AGENT_ALLOWED_ORIGINS entry: {}", o);
                None
            }
        })
        .collect();

    if origins.is_empty() {
        warn!(
            "⚠️ AGENT_ALLOWED_ORIGINS unset — browser access limited to {:?}. Set it to your dashboard origin.",
            DEFAULT_ALLOWED_ORIGINS
        );
        origins = DEFAULT_ALLOWED_ORIGINS
            .iter()
            .filter_map(|o| HeaderValue::from_str(o).ok())
            .collect();
    } else {
        info!("🌐 CORS origins: {:?}", origins);
    }

    CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::CONTENT_TYPE])
}

/// Connect to Docker, returning `None` when the host has no usable socket so
/// the rest of the agent can keep serving.
async fn connect_docker() -> Option<Docker> {
    let docker = match Docker::connect_with_unix_defaults() {
        Ok(d) => d,
        Err(e) => {
            warn!(
                "⚠️ Docker unavailable ({}): interactive terminal disabled. Install Docker / add the user to the docker group. Code-run (/execute) unaffected.",
                e
            );
            return None;
        }
    };

    match docker.ping().await {
        Ok(_) => info!("🐳 Docker connected (unix socket)"),
        // Keep the handle: dockerd may come up after the agent does.
        Err(e) => warn!(
            "⚠️ Docker ping failed: {} — interactive terminal will fail until Docker is running",
            e
        ),
    }

    match docker.inspect_image(terminal::TERMINAL_IMAGE).await {
        Ok(_) => info!("📦 Terminal image '{}' present", terminal::TERMINAL_IMAGE),
        Err(_) => warn!(
            "⚠️ Terminal image '{}' missing — interactive terminal will return an error. Build it: docker build -t {} -f compute-agent-rs/Dockerfile.terminal compute-agent-rs/",
            terminal::TERMINAL_IMAGE,
            terminal::TERMINAL_IMAGE
        ),
    }

    Some(docker)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,computerwa_agent=debug".into()),
        )
        // Compact format for cleaner CLI output
        .compact()
        .init();

    let port: u16 = std::env::var("AGENT_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3006);

    let client = match ChainClient::from_env().await {
        Ok(c) => {
            info!("🔗 Connected to BOT Chain | provider: {}", c.address());
            Arc::new(c)
        }
        Err(e) => {
            error!("❌ Failed to init chain client: {}", e);
            return Err(e);
        }
    };

    // Probe before serving: both probes fork, and the answers are then memoised
    // for the request path.
    let (sandbox_ok, runtimes) = tokio::task::spawn_blocking(sandbox::probe_environment).await?;
    if sandbox_ok {
        info!("🧱 bubblewrap sandbox OK | runtimes: {:?}", runtimes);
    } else {
        warn!(
            "⚠️ bubblewrap unavailable — /execute will return 503. Install it: sudo apt install bubblewrap"
        );
    }

    let docker = connect_docker().await;

    // Background monitors
    let monitor_client = client.clone();
    let (monitor_tx, mut monitor_rx) = tokio::sync::mpsc::channel(100);

    let sessions: terminal::SessionMap = Default::default();
    let monitor_sessions = sessions.clone();

    tokio::spawn(async move {
        monitor::run_monitor(
            monitor_client,
            monitor::MonitorConfig::default(),
            monitor_tx,
        )
        .await;
    });

    // Consume monitor events
    tokio::spawn(async move {
        while let Some(event) = monitor_rx.recv().await {
            match event {
                monitor::MonitorEvent::NewPendingJob(job) => {
                    info!(
                        "🔔 NEW JOB #{} | node={} type={} consumer={} price={} DGRAM/hr",
                        job.job_id,
                        job.node_id,
                        job.job_type,
                        job.consumer,
                        wei_to_dgram(&job.price_per_hour_wei)
                    );
                }
                monitor::MonitorEvent::JobAccepted(job) => {
                    info!("✅ Job #{} ACCEPTED on-chain", job.job_id);
                }
                monitor::MonitorEvent::JobCompleted(job) => {
                    info!("🏁 Job #{} COMPLETED on-chain", job.job_id);
                    if let Some((_, handle)) = monitor_sessions.remove(&job.job_id) {
                        info!("🔌 Killing terminal for completed job #{}", job.job_id);
                        handle.kill().await;
                    }
                }
                monitor::MonitorEvent::JobExpired(job) => {
                    info!("⏰ Job #{} EXPIRED + auto-completed", job.job_id);
                    if let Some((_, handle)) = monitor_sessions.remove(&job.job_id) {
                        info!("🔌 Killing terminal for expired job #{}", job.job_id);
                        handle.kill().await;
                    }
                }
            }
        }
    });

    // Heartbeat
    let hb_client = client.clone();
    tokio::spawn(async move {
        monitor::run_heartbeat(hb_client).await;
    });

    let exec_slots = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2);
    info!("⚙️ Concurrent execution slots: {}", exec_slots);

    // HTTP server
    let state = AppState {
        client,
        sessions,
        docker,
        exec_slots: Arc::new(Semaphore::new(exec_slots)),
        sandbox_ok,
    };
    let app = Router::new()
        .route("/health", get(health))
        .route("/info", get(info))
        .route("/jobs", get(list_jobs))
        .route("/execute", post(execute_code))
        .route("/terminal/{id}", get(terminal::ws_handler))
        .route("/jobs/{id}/accept", post(accept_job))
        .route("/jobs/{id}/complete", post(complete_job))
        .layer(middleware::from_fn(request_logger))
        .layer(cors_layer())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    info!("╔══════════════════════════════════════════════════╗");
    info!(
        "║ 🦀 BotCompute Rust Agent v{:<23}║",
        env!("CARGO_PKG_VERSION")
    );
    info!("║    axum + alloy + tokio                          ║");
    info!("║    Listening on {:<33}║", addr);
    info!("╚══════════════════════════════════════════════════╝");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Convert wei string to human-readable DGRAM (6 decimals)
fn wei_to_dgram(wei_str: &str) -> String {
    match wei_str.parse::<u128>() {
        Ok(wei) => {
            let whole = wei / 1_000_000;
            let frac = wei % 1_000_000;
            if frac == 0 {
                whole.to_string()
            } else {
                format!("{}.{:06}", whole, frac)
            }
        }
        Err(_) => wei_str.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_wei_as_dgram() {
        assert_eq!(wei_to_dgram("2000000"), "2");
        assert_eq!(wei_to_dgram("2500000"), "2.500000");
        assert_eq!(wei_to_dgram("not-a-number"), "not-a-number");
    }

    #[test]
    fn clamps_a_hostile_execution_timeout() {
        let clamp = |t: u64| t.clamp(1, MAX_EXECUTION_TIMEOUT_SECS);
        assert_eq!(clamp(999_999_999), MAX_EXECUTION_TIMEOUT_SECS);
        assert_eq!(clamp(0), 1);
        assert_eq!(clamp(30), 30);
    }
}
