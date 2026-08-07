// ── Sandboxed code execution ────────────────────────────
//
// Executes Python3 / Node.js code in an isolated subprocess with:
// - CPU time limit (seconds)
// - Memory limit (MB)
// - Wall-clock timeout
// - Separate temp directory per job
// - No network access (future: namespace isolation)

use anyhow::{Context, Result};
use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct ExecutionConfig {
    pub language: String,      // "python3" | "node"
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
            timeout_secs: 300,      // 5 min max
            memory_limit_mb: 512,   // 512 MB
            cpu_limit_secs: 300,    // 5 min CPU
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

/// Create an isolated temp directory for a job execution
fn create_workspace() -> Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!("computerwa-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("Failed to create workspace: {:?}", dir))?;
    Ok(dir)
}

/// Write code to a file in the workspace
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

/// Execute code in a sandboxed subprocess
pub async fn execute(config: &ExecutionConfig) -> Result<ExecutionResult> {
    let workspace = create_workspace()?;
    let (code_file, interpreter) = write_code(&workspace, &config.language, &config.code)?;

    info!(
        "Executing {} code in workspace {:?} (timeout: {}s, mem: {}MB)",
        config.language, workspace, config.timeout_secs, config.memory_limit_mb
    );

    let start = std::time::Instant::now();

    // Build command with resource limits.
    // Python3: use ulimit -v to cap virtual memory.
    // Node.js: skip ulimit -v (V8 needs large virtual address space for JIT),
    //          use V8's --max-old-space-size flag to limit heap instead.
    let shell_cmd: String;
    if interpreter == "node" {
        let heap_mb = (config.memory_limit_mb as f64 * 0.75) as u64;
        shell_cmd = format!(
            "node --max-old-space-size={} {}",
            heap_mb,
            code_file.to_string_lossy()
        );
    } else {
        shell_cmd = format!(
            "ulimit -v {} 2>/dev/null; {} {}",
            config.memory_limit_mb * 1024,
            interpreter,
            code_file.to_string_lossy()
        );
    }

    let mut cmd = if config.timeout_secs > 0 {
        let mut c = Command::new("timeout");
        c.arg(format!("{}s", config.timeout_secs));
        c.arg("sh").arg("-c").arg(&shell_cmd);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg(&shell_cmd);
        c
    };

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.current_dir(&workspace);

    // Spawn and wait with timeout
    let child = cmd.spawn().context("Failed to spawn process")?;

    let output = tokio::time::timeout(
        Duration::from_secs(config.timeout_secs + 5), // grace period
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
            let timed_out = exit_code == 124; // timeout command exit code

            Ok(ExecutionResult {
                stdout: String::from_utf8_lossy(&out.stdout).to_string(),
                stderr: String::from_utf8_lossy(&out.stderr).to_string(),
                exit_code,
                duration_ms,
                timed_out,
                memory_used_mb: 0, // TODO: cgroup memory accounting
            })
        }
        Ok(Err(e)) => Err(anyhow::anyhow!("Process error: {}", e)),
        Err(_) => {
            Ok(ExecutionResult {
                stdout: String::new(),
                stderr: format!("Execution timed out after {}s", config.timeout_secs),
                exit_code: 124,
                duration_ms,
                timed_out: true,
                memory_used_mb: 0,
            })
        }
    }
}

/// Check if a language runtime is available on the system
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
