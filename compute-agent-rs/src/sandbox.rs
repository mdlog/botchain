// ── Sandboxed code execution ────────────────────────────
//
// Executes Python3 / Node.js code in an isolated subprocess with:
// - CLEAN environment (no PROVIDER_PRIVATE_KEY or other sensitive vars)
// - Memory limit (ulimit -v or V8 --max-old-space-size)
// - Wall-clock timeout
// - Separate temp directory per job
// - Restricted filesystem via bwrap (bubblewrap)
// - PID isolation via bwrap --unshare-all

use anyhow::{Context, Result};
use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct ExecutionConfig {
    pub language: String,
    pub code: String,
    pub timeout_secs: u64,
    pub memory_limit_mb: u64,
    pub cpu_limit_secs: u64,
}

impl Default for ExecutionConfig {
    fn default() -> Self {
        Self {
            language: "python3".to_string(),
            code: String::new(),
            timeout_secs: 300,
            memory_limit_mb: 512,
            cpu_limit_secs: 300,
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
    pub memory_used_mb: u64,
}

fn create_workspace() -> Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!("computerwa-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("Failed to create workspace: {:?}", dir))?;
    std::fs::create_dir_all(dir.join("home"))?;
    std::fs::create_dir_all(dir.join("tmp"))?;
    Ok(dir)
}

fn write_code(workspace: &PathBuf, language: &str, code: &str) -> Result<(PathBuf, String)> {
    let (filename, interpreter) = match language {
        "python3" | "python" => ("main.py", "python3"),
        "node" | "javascript" => ("main.js", "node"),
        other => return Err(anyhow::anyhow!("Unsupported language: {}", other)),
    };
    let file_path = workspace.join(filename);
    std::fs::write(&file_path, code)
        .with_context(|| format!("Failed to write code file: {:?}", file_path))?;
    Ok((file_path, interpreter.to_string()))
}

/// Build a minimal, safe environment — strips ALL sensitive vars.
fn build_safe_env(workspace: &PathBuf) -> Vec<(String, String)> {
    let fake_home = "/workspace/home".to_string();
    vec![
        ("PATH".to_string(), "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin".to_string()),
        ("HOME".to_string(), fake_home),
        ("USER".to_string(), "nobody".to_string()),
        ("LOGNAME".to_string(), "nobody".to_string()),
        ("SHELL".to_string(), "/bin/sh".to_string()),
        ("LANG".to_string(), "C.UTF-8".to_string()),
        ("TERM".to_string(), "dumb".to_string()),
        ("PYTHONDONTWRITEBYTECODE".to_string(), "1".to_string()),
        ("PYTHONUNBUFFERED".to_string(), "1".to_string()),
        ("NODE_ENV".to_string(), "production".to_string()),
        ("TMPDIR".to_string(), "/workspace/tmp".to_string()),
    ]
}

/// Smoke test: can bwrap actually run a command? Must include /lib64 for dynamic linker.
fn bwrap_available() -> bool {
    let mut args = vec![
        "--ro-bind".to_string(), "/usr".to_string(), "/usr".to_string(),
        "--symlink".to_string(), "usr/bin".to_string(), "/bin".to_string(),
        "--symlink".to_string(), "usr/sbin".to_string(), "/sbin".to_string(),
        "--symlink".to_string(), "usr/lib".to_string(), "/lib".to_string(),
    ];
    for lib in ["/lib64", "/lib32", "/libx32"] {
        if std::path::Path::new(lib).exists() {
            let target = format!("usr{}", lib);
            args.push("--symlink".to_string());
            args.push(target);
            args.push(lib.to_string());
        }
    }
    args.extend([
        "--proc".to_string(), "/proc".to_string(),
        "--dev".to_string(), "/dev".to_string(),
        "--tmpfs".to_string(), "/tmp".to_string(),
        "/usr/bin/true".to_string(),
    ]);
    std::process::Command::new("bwrap")
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Execute code in a sandboxed subprocess
pub async fn execute(config: &ExecutionConfig) -> Result<ExecutionResult> {
    let workspace = create_workspace()?;
    let (code_file, interpreter) = write_code(&workspace, &config.language, &config.code)?;
    let safe_env = build_safe_env(&workspace);

    let bwrap_ok = bwrap_available();
    info!(
        "Executing {} code in workspace {:?} (timeout: {}s, mem: {}MB, bwrap: {})",
        config.language, workspace, config.timeout_secs, config.memory_limit_mb, bwrap_ok
    );

    if !bwrap_ok {
        return Err(anyhow::anyhow!(
            "bwrap sandbox unavailable. Install: sudo apt install bubblewrap"
        ));
    }

    let start = std::time::Instant::now();

    // Inner command with resource limits (runs INSIDE bwrap sandbox via sh -c)
    let inner_cmd: String;
    if interpreter == "node" {
        let heap_mb = (config.memory_limit_mb as f64 * 0.75) as u64;
        inner_cmd = format!(
            "node --max-old-space-size={} {}",
            heap_mb,
            "/workspace/".to_string() + code_file.file_name().unwrap().to_str().unwrap()
        );
    } else {
        inner_cmd = format!(
            "ulimit -v {} 2>/dev/null; {} {}",
            config.memory_limit_mb * 1024,
            interpreter,
            "/workspace/".to_string() + code_file.file_name().unwrap().to_str().unwrap()
        );
    }

    // Build bwrap command string.
    // KEY FIX: bwrap runs "sh -c 'inner_cmd'" inside the sandbox,
    // so ulimit (shell builtin) works properly.
    let mut bwrap_args = vec![
        "--ro-bind".to_string(), "/usr".to_string(), "/usr".to_string(),
        "--symlink".to_string(), "usr/bin".to_string(), "/bin".to_string(),
        "--symlink".to_string(), "usr/sbin".to_string(), "/sbin".to_string(),
        "--symlink".to_string(), "usr/lib".to_string(), "/lib".to_string(),
    ];

    // Add lib symlinks for merged-usr systems
    for lib in ["/lib64", "/lib32", "/libx32"] {
        if std::path::Path::new(lib).exists() {
            let target = format!("usr{}", lib);
            bwrap_args.push("--symlink".to_string());
            bwrap_args.push(target);
            bwrap_args.push(lib.to_string());
        }
    }

    bwrap_args.extend([
        "--proc".to_string(), "/proc".to_string(),
        "--dev".to_string(), "/dev".to_string(),
        "--tmpfs".to_string(), "/tmp".to_string(),
        "--bind".to_string(), workspace.to_string_lossy().to_string(), "/workspace".to_string(),
        "--chdir".to_string(), "/workspace".to_string(),
        "--unshare-all".to_string(),
        "--share-net".to_string(),
        "--".to_string(), "/bin/sh".to_string(), "-c".to_string(), inner_cmd,
    ]);

    // Build final command: timeout → bwrap → sh -c 'inner_cmd'
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

    // CRITICAL: Clear ALL env vars, set only safe whitelist
    cmd.env_clear();
    for (key, value) in &safe_env {
        cmd.env(key, value);
    }

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.current_dir(&workspace);

    let child = cmd.spawn().context("Failed to spawn bwrap process")?;

    let output = tokio::time::timeout(
        Duration::from_secs(config.timeout_secs + 5),
        child.wait_with_output(),
    )
    .await;

    let duration_ms = start.elapsed().as_millis() as u64;

    // Cleanup workspace
    if let Err(e) = std::fs::remove_dir_all(&workspace) {
        warn!("Failed to cleanup workspace {:?}: {}", workspace, e);
    }

    match output {
        Ok(Ok(out)) => {
            let exit_code = out.status.code().unwrap_or(-1);
            let timed_out = exit_code == 124;
            Ok(ExecutionResult {
                stdout: String::from_utf8_lossy(&out.stdout).to_string(),
                stderr: String::from_utf8_lossy(&out.stderr).to_string(),
                exit_code,
                duration_ms,
                timed_out,
                memory_used_mb: 0,
            })
        }
        Ok(Err(e)) => Err(anyhow::anyhow!("Process error: {}", e)),
        Err(_) => Ok(ExecutionResult {
            stdout: String::new(),
            stderr: format!("Execution timed out after {}s", config.timeout_secs),
            exit_code: 124,
            duration_ms,
            timed_out: true,
            memory_used_mb: 0,
        }),
    }
}

/// Check if a language runtime is available
pub fn check_runtime(language: &str) -> bool {
    let cmd = match language {
        "python3" | "python" => ("python3", "--version"),
        "node" | "javascript" => ("node", "--version"),
        _ => return false,
    };
    std::process::Command::new(cmd.0)
        .arg(cmd.1)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
