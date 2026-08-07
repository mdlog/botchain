// ── GPU Detection via nvidia-smi ────────────────────────
//
// Detects all NVIDIA GPUs in the rig using `nvidia-smi -L`
// and `nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits`.
// Falls back gracefully if nvidia-smi is not installed (non-NVIDIA systems).

use serde::{Serialize, Deserialize};
use std::process::Command;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub index: u32,
    pub model: String,
    pub vram_mb: u32,
}

/// Detect all NVIDIA GPUs in the system using nvidia-smi.
/// Returns empty vec if nvidia-smi is not available or no GPUs found.
pub fn detect_gpus() -> Vec<GpuInfo> {
    // Check if nvidia-smi exists
    if which("nvidia-smi").is_none() {
        info!("🔍 nvidia-smi not found — no NVIDIA GPUs detected (CPU-only node)");
        return Vec::new();
    }

    // Get GPU list: "GPU 0: NVIDIA GeForce RTX 3060 (UUID: GPU-xxx)"
    let list_output = match Command::new("nvidia-smi")
        .arg("-L")
        .output()
    {
        Ok(out) => out,
        Err(e) => {
            info!("🔍 nvidia-smi -L failed: {}", e);
            return Vec::new();
        }
    };

    if !list_output.status.success() {
        info!("🔍 nvidia-smi -L exited non-zero");
        return Vec::new();
    }

    let list_str = String::from_utf8_lossy(&list_output.stdout);

    // Get VRAM: "12288\n8192\n..." (one line per GPU, in MiB)
    let vram_output = Command::new("nvidia-smi")
        .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
        .output();

    let vram_lines: Vec<String> = match &vram_output {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .collect()
        }
        _ => Vec::new(),
    };

    // Parse GPU list
    let mut gpus = Vec::new();
    for (i, line) in list_str.lines().enumerate() {
        // Format: "GPU 0: NVIDIA GeForce RTX 3060 (UUID: GPU-xxx)"
        // or:     "GPU 0: NVIDIA H100 80GB HBM3 (UUID: GPU-xxx)"
        let model = parse_gpu_name(line);
        let vram_mb = vram_lines
            .get(i)
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        gpus.push(GpuInfo {
            index: i as u32,
            model,
            vram_mb,
        });
    }

    if !gpus.is_empty() {
        info!("🔍 Detected {} GPU(s):", gpus.len());
        for g in &gpus {
            info!("   GPU {}: {} ({} MiB)", g.index, g.model, g.vram_mb);
        }
    }

    gpus
}

/// Parse GPU name from nvidia-smi -L output line.
/// Input: "GPU 0: NVIDIA GeForce RTX 3060 (UUID: GPU-xxx)"
/// Output: "NVIDIA RTX 3060"
fn parse_gpu_name(line: &str) -> String {
    // Strip "GPU N: " prefix
    let after_prefix = line.split(": ").nth(1).unwrap_or(line);

    // Strip " (UUID: ...)" suffix
    let name_part = after_prefix.split(" (UUID").next().unwrap_or(after_prefix).trim();

    // Normalize: "NVIDIA GeForce RTX 3060" → "NVIDIA RTX 3060"
    // "NVIDIA H100 80GB HBM3" → "NVIDIA H100"
    let normalized = name_part
        .replace("NVIDIA GeForce ", "NVIDIA ")
        .replace("NVIDIA Quadro ", "NVIDIA ");

    // Strip VRAM suffix from name (e.g. "H100 80GB HBM3" → "H100")
    // Keep it simple: if it matches known patterns, normalize
    let lower = normalized.to_lowercase();
    if lower.contains("h100") {
        return "NVIDIA H100".to_string();
    }
    if lower.contains("a100") {
        return "NVIDIA A100".to_string();
    }

    normalized
}

/// Check if a command exists in PATH.
fn which(cmd: &str) -> Option<String> {
    Command::new("which")
        .arg(cmd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        })
}

/// Summary of all detected GPUs for display.
#[derive(Debug, Serialize)]
pub struct GpuSummary {
    pub count: u32,
    pub models: Vec<String>,      // e.g. ["NVIDIA RTX 3060", "NVIDIA RTX 3060"]
    pub total_vram_mb: u32,       // sum of all VRAM
    pub unified_model: String,    // e.g. "NVIDIA RTX 3060 ×2"
    pub gpus: Vec<GpuInfo>,       // individual GPU details
}

/// Get a summary of all GPUs for the /info endpoint.
pub fn get_gpu_summary() -> GpuSummary {
    let gpus = detect_gpus();
    let count = gpus.len() as u32;
    let total_vram_mb: u32 = gpus.iter().map(|g| g.vram_mb).sum();
    let models: Vec<String> = gpus.iter().map(|g| g.model.clone()).collect();

    // Create unified model string
    let unified_model = if gpus.is_empty() {
        "CPU Only".to_string()
    } else if gpus.iter().all(|g| g.model == gpus[0].model) {
        // All same model: "NVIDIA RTX 3060 ×4"
        if count > 1 {
            format!("{} ×{}", gpus[0].model, count)
        } else {
            gpus[0].model.clone()
        }
    } else {
        // Mixed models: "NVIDIA RTX 3060 ×2, NVIDIA RTX 3090 ×1"
        let mut counts: std::collections::HashMap<&str, u32> = std::collections::HashMap::new();
        for g in &gpus {
            *counts.entry(&g.model).or_insert(0) += 1;
        }
        counts
            .iter()
            .map(|(m, c)| {
                if *c > 1 {
                    format!("{} ×{}", m, c)
                } else {
                    m.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join(", ")
    };

    GpuSummary {
        count,
        models,
        total_vram_mb,
        unified_model,
        gpus,
    }
}
