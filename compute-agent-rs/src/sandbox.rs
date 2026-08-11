// ── Sandboxed code execution ────────────────────────────
//
// Executes Python3 / Node.js code in an isolated subprocess with:
// - CLEAN environment (no PROVIDER_PRIVATE_KEY or other sensitive vars)
// - Memory limit (ulimit -v or V8 --max-old-space-size)
// - Wall-clock timeout
// - Separate temp directory per job
// - Restricted filesystem + PID isolation via bwrap (bubblewrap)

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::process::Command;
use tracing::{info, warn};
use uuid::Uuid;

/// Languages this agent will run, mapped to their interpreter binary.
const RUNTIMES: [(&str, &str); 2] = [("python3", "python3"), ("node", "node")];

#[derive(Debug, Clone)]
pub struct ExecutionConfig {
    pub language: String,
    pub code: String,
    pub timeout_secs: u64,
    pub memory_limit_mb: u64,
}

impl Default for ExecutionConfig {
    fn default() -> Self {
        Self {
            language: "python3".to_string(),
            code: String::new(),
            timeout_secs: 300,
            memory_limit_mb: 512,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ExecutionResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u64,
    pub timed_out: bool,
}

fn create_workspace() -> Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!("botcompute-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("Failed to create workspace: {:?}", dir))?;
    std::fs::create_dir_all(dir.join("home"))?;
    std::fs::create_dir_all(dir.join("tmp"))?;
    Ok(dir)
}

fn write_code(workspace: &Path, language: &str, code: &str) -> Result<(PathBuf, &'static str)> {
    let (filename, interpreter) = match canonical_runtime(language) {
        Some("python3") => ("main.py", "python3"),
        Some("node") => ("main.js", "node"),
        _ => return Err(anyhow::anyhow!("Unsupported language: {}", language)),
    };
    let file_path = workspace.join(filename);
    std::fs::write(&file_path, code)
        .with_context(|| format!("Failed to write code file: {:?}", file_path))?;
    Ok((file_path, interpreter))
}

/// Build a minimal, safe environment — strips ALL sensitive vars.
fn build_safe_env() -> Vec<(&'static str, &'static str)> {
    vec![
        (
            "PATH",
            "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        ),
        ("HOME", "/workspace/home"),
        ("USER", "nobody"),
        ("LOGNAME", "nobody"),
        ("SHELL", "/bin/sh"),
        ("LANG", "C.UTF-8"),
        ("TERM", "dumb"),
        ("PYTHONDONTWRITEBYTECODE", "1"),
        ("PYTHONUNBUFFERED", "1"),
        ("NODE_ENV", "production"),
        ("TMPDIR", "/workspace/tmp"),
    ]
}

/// The filesystem skeleton every bwrap invocation needs: read-only /usr with the
/// merged-usr symlinks, plus the dynamic linker directories that actually exist
/// on this host (without /lib64 nothing links and every run fails).
fn bwrap_rootfs_args() -> Vec<String> {
    let mut args = vec![
        "--ro-bind".to_string(),
        "/usr".to_string(),
        "/usr".to_string(),
        "--symlink".to_string(),
        "usr/bin".to_string(),
        "/bin".to_string(),
        "--symlink".to_string(),
        "usr/sbin".to_string(),
        "/sbin".to_string(),
        "--symlink".to_string(),
        "usr/lib".to_string(),
        "/lib".to_string(),
    ];
    for lib in ["/lib64", "/lib32", "/libx32"] {
        if Path::new(lib).exists() {
            args.push("--symlink".to_string());
            args.push(format!("usr{}", lib));
            args.push(lib.to_string());
        }
    }
    args.extend([
        "--proc".to_string(),
        "/proc".to_string(),
        "--dev".to_string(),
        "/dev".to_string(),
        "--tmpfs".to_string(),
        "/tmp".to_string(),
    ]);
    args
}

/// Smoke test: can bwrap actually run a command here?
fn probe_bwrap() -> bool {
    let mut args = bwrap_rootfs_args();
    args.push("/usr/bin/true".to_string());
    std::process::Command::new("bwrap")
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn probe_runtime(interpreter: &str) -> bool {
    std::process::Command::new(interpreter)
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Verify the bubblewrap sandbox is functional.
///
/// Probed once and memoised: it forks a process, which must not happen on the
/// async request path, and the answer cannot change without reinstalling
/// bubblewrap. Call [`probe_environment`] during startup so the fork happens
/// before the server is accepting connections.
pub fn sandbox_available() -> bool {
    static BWRAP_OK: OnceLock<bool> = OnceLock::new();
    *BWRAP_OK.get_or_init(probe_bwrap)
}

/// The language runtimes actually installed on this node. Memoised for the same
/// reason as [`sandbox_available`].
pub fn available_runtimes() -> &'static [&'static str] {
    static AVAILABLE: OnceLock<Vec<&'static str>> = OnceLock::new();
    AVAILABLE.get_or_init(|| {
        RUNTIMES
            .iter()
            .filter(|(name, bin)| {
                let ok = probe_runtime(bin);
                if !ok {
                    warn!("runtime '{}' not installed — /execute will reject it", name);
                }
                ok
            })
            .map(|(name, _)| *name)
            .collect()
    })
}

/// Map a caller-supplied language alias onto a supported runtime.
fn canonical_runtime(language: &str) -> Option<&'static str> {
    match language {
        "python3" | "python" => Some("python3"),
        "node" | "javascript" => Some("node"),
        _ => None,
    }
}

/// Check if a language runtime is available.
pub fn check_runtime(language: &str) -> bool {
    canonical_runtime(language).is_some_and(|r| available_runtimes().contains(&r))
}

/// Force the memoised probes to run now, returning `(sandbox_ok, runtimes)`.
pub fn probe_environment() -> (bool, &'static [&'static str]) {
    (sandbox_available(), available_runtimes())
}

/// Create an isolated per-session workspace (reused by the interactive terminal).
pub async fn create_session_workspace() -> Result<PathBuf> {
    tokio::task::spawn_blocking(create_workspace).await?
}

/// Execute code in a sandboxed subprocess.
pub async fn execute(config: &ExecutionConfig) -> Result<ExecutionResult> {
    if !sandbox_available() {
        return Err(anyhow::anyhow!(
            "bwrap sandbox unavailable. Install: sudo apt install bubblewrap"
        ));
    }

    let language = config.language.clone();
    let code = config.code.clone();
    let (workspace, code_file, interpreter) =
        tokio::task::spawn_blocking(move || -> Result<(PathBuf, PathBuf, &'static str)> {
            let workspace = create_workspace()?;
            let (file, interpreter) = write_code(&workspace, &language, &code)?;
            Ok((workspace, file, interpreter))
        })
        .await??;

    info!(
        "Executing {} code in workspace {:?} (timeout: {}s, mem: {}MB)",
        config.language, workspace, config.timeout_secs, config.memory_limit_mb
    );

    let start = std::time::Instant::now();

    let sandboxed_path = format!(
        "/workspace/{}",
        code_file.file_name().unwrap_or_default().to_string_lossy()
    );

    // bwrap runs `sh -c '<inner>'` inside the sandbox so `ulimit`, a shell
    // builtin, actually applies to the interpreter. Node ignores ulimit -v for
    // its heap, so it gets --max-old-space-size instead.
    let inner_cmd = if interpreter == "node" {
        let heap_mb = (config.memory_limit_mb as f64 * 0.75) as u64;
        format!("node --max-old-space-size={} {}", heap_mb, sandboxed_path)
    } else {
        format!(
            "ulimit -v {} 2>/dev/null; {} {}",
            config.memory_limit_mb * 1024,
            interpreter,
            sandboxed_path
        )
    };

    let mut bwrap_args = bwrap_rootfs_args();
    bwrap_args.extend([
        "--bind".to_string(),
        workspace.to_string_lossy().to_string(),
        "/workspace".to_string(),
        "--chdir".to_string(),
        "/workspace".to_string(),
        "--unshare-all".to_string(),
        "--".to_string(),
        "/bin/sh".to_string(),
        "-c".to_string(),
        inner_cmd,
    ]);

    let mut cmd = if config.timeout_secs > 0 {
        let mut c = Command::new("timeout");
        c.arg(format!("{}s", config.timeout_secs));
        c.arg("bwrap");
        c.args(&bwrap_args);
        c
    } else {
        let mut c = Command::new("bwrap");
        c.args(&bwrap_args);
        c
    };

    // CRITICAL: clear ALL env vars, set only the safe whitelist.
    cmd.env_clear();
    for (key, value) in build_safe_env() {
        cmd.env(key, value);
    }

    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.current_dir(&workspace);
    cmd.kill_on_drop(true);

    let child = cmd.spawn().context("Failed to spawn bwrap process")?;

    let output = tokio::time::timeout(
        Duration::from_secs(config.timeout_secs.saturating_add(5)),
        child.wait_with_output(),
    )
    .await;

    let duration_ms = start.elapsed().as_millis() as u64;

    let cleanup = workspace.clone();
    let _ = tokio::task::spawn_blocking(move || {
        if let Err(e) = std::fs::remove_dir_all(&cleanup) {
            warn!("Failed to cleanup workspace {:?}: {}", cleanup, e);
        }
    })
    .await;

    match output {
        Ok(Ok(out)) => {
            let exit_code = out.status.code().unwrap_or(-1);
            // `timeout` exits 124 when it had to kill the child.
            let timed_out = exit_code == 124;
            Ok(ExecutionResult {
                stdout: String::from_utf8_lossy(&out.stdout).to_string(),
                stderr: String::from_utf8_lossy(&out.stderr).to_string(),
                exit_code,
                duration_ms,
                timed_out,
            })
        }
        Ok(Err(e)) => Err(anyhow::anyhow!("Process error: {}", e)),
        Err(_) => Ok(ExecutionResult {
            stdout: String::new(),
            stderr: format!("Execution timed out after {}s", config.timeout_secs),
            exit_code: 124,
            duration_ms,
            timed_out: true,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_language_aliases_onto_runtimes() {
        assert_eq!(canonical_runtime("python"), Some("python3"));
        assert_eq!(canonical_runtime("javascript"), Some("node"));
        assert_eq!(canonical_runtime("ruby"), None);
    }

    #[test]
    fn safe_env_carries_no_host_secrets() {
        let env = build_safe_env();
        assert!(env.iter().all(|(k, _)| *k != "PROVIDER_PRIVATE_KEY"));
        assert!(
            env.iter()
                .any(|(k, v)| *k == "HOME" && *v == "/workspace/home")
        );
    }

    #[test]
    fn bwrap_rootfs_binds_usr_read_only() {
        let args = bwrap_rootfs_args();
        let usr = args.windows(3).any(|w| w == ["--ro-bind", "/usr", "/usr"]);
        assert!(usr, "expected a read-only /usr bind, got {args:?}");
    }
}
