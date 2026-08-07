// ── ComputeRWA Provider Agent (Rust) ────────────────────
//
// High-performance compute agent for the ComputeRWA marketplace.
//   - axum HTTP server (async)
//   - alloy EVM client (type-safe contract calls)
//   - sandboxed code execution (ulimit + timeout)
//   - background job monitor (auto-accept/auto-complete)
//
// Endpoints:
//   GET  /health          — agent status
//   GET  /info            — provider node info
//   GET  /jobs            — list provider's jobs
//   POST /execute         — execute code (consumer → agent)
//   POST /jobs/{id}/accept — accept a pending job
//   POST /jobs/{id}/complete — complete an active job

mod chain;
mod sandbox;
mod monitor;

use axum::{
    extract::{Path, State},
    http::{StatusCode, Request},
    middleware::{self, Next},
    response::Json,
    response::Response,
    routing::{get, post},
    Router,
};
use chain::ChainClient;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Instant;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{info, warn, error};

#[derive(Clone)]
struct AppState {
    client: Arc<ChainClient>,
}

// ── Request logging middleware ──────────────────────────

async fn request_logger(req: Request<axum::body::Body>, next: Next) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let start = Instant::now();

    let response = next.run(req).await;

    let elapsed = start.elapsed();
    let status = response.status();

    if path == "/health" {
        // Skip logging health checks (too noisy)
        return response;
    }

    info!(
        "→ {} {} → {} ({:.0}ms)",
        method,
        path,
        status,
        elapsed.as_millis()
    );

    response
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    provider: String,
    agent: String,
    version: String,
    nodes: String,
    rust: bool,
}

#[derive(Serialize)]
struct InfoResponse {
    provider: String,
    node_ids: Vec<u64>,
    runtimes: Vec<String>,
}

#[derive(Deserialize)]
struct ExecuteRequest {
    job_id: Option<u64>,
    language: String,
    code: String,
    timeout_secs: Option<u64>,
}

// ── Handlers ────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let addr = state.client.address();
    let provider_str = if addr == alloy::primitives::Address::ZERO {
        "not configured".to_string()
    } else {
        addr.to_string()
    };
    let nodes_str = if addr == alloy::primitives::Address::ZERO {
        "no wallet".to_string()
    } else {
        "monitoring".to_string()
    };
    Json(HealthResponse {
        status: "ok".to_string(),
        provider: provider_str,
        agent: "ComputeRWA Provider Agent".to_string(),
        version: "2.0.0-rs".to_string(),
        nodes: nodes_str,
        rust: true,
    })
}

async fn info(State(state): State<AppState>) -> Result<Json<InfoResponse>, (StatusCode, String)> {
    let addr = state.client.address();
    let node_ids = state.client.get_provider_nodes().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut runtimes = Vec::new();
    if sandbox::check_runtime("python3") {
        runtimes.push("python3".to_string());
    }
    if sandbox::check_runtime("node") {
        runtimes.push("node".to_string());
    }

    Ok(Json(InfoResponse {
        provider: addr.to_string(),
        node_ids,
        runtimes,
    }))
}

async fn list_jobs(State(state): State<AppState>) -> Result<Json<Value>, (StatusCode, String)> {
    let jobs = state.client.get_provider_jobs().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let total = jobs.len();
    let active = jobs.iter().filter(|j| j.status == 1).count();
    let pending = jobs.iter().filter(|j| j.status == 0).count();
    let completed = jobs.iter().filter(|j| j.status == 2).count();

    info!("📋 Jobs requested: {} total (pending={}, active={}, completed={})", total, pending, active, completed);

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
    Json(req): Json<ExecuteRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let code_preview: String = req.code.chars().take(80).collect();
    let code_lines = req.code.lines().count();

    info!(
        "🔧 EXECUTE REQUEST | lang={} lines={} timeout={}s job={}",
        req.language,
        code_lines,
        req.timeout_secs.unwrap_or(300),
        req.job_id.map(|j| format!("#{}", j)).unwrap_or_else(|| "standalone".to_string())
    );
    info!("📝 Code preview: {}{}", code_preview, if req.code.len() > 80 { "..." } else { "" });

    // Verify job is active if job_id provided
    if let Some(job_id) = req.job_id {
        let job = state.client.get_job(job_id).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        if job.status != 1 {
            warn!("❌ Job #{} not active (status={})", job_id, job.status);
            return Err((StatusCode::FORBIDDEN, format!("Job {} is not active (status={})", job_id, job.status)));
        }

        let addr = state.client.address();
        if !job.provider.eq_ignore_ascii_case(&addr.to_string()) {
            warn!("❌ Job #{} doesn't belong to this provider", job_id);
            return Err((StatusCode::FORBIDDEN, "Job does not belong to this provider".to_string()));
        }

        info!("✅ Job #{} verified active, provider match", job_id);
    }

    if !sandbox::check_runtime(&req.language) {
        warn!("❌ Runtime {} not available", req.language);
        return Err((StatusCode::BAD_REQUEST, format!("{} runtime not available", req.language)));
    }

    let config = sandbox::ExecutionConfig {
        language: req.language.clone(),
        code: req.code,
        timeout_secs: req.timeout_secs.unwrap_or(300),
        ..Default::default()
    };

    info!("🚀 Executing {} code (timeout={}s)...", req.language, config.timeout_secs);
    let exec_start = Instant::now();

    match sandbox::execute(&config).await {
        Ok(result) => {
            let total_ms = exec_start.elapsed().as_millis();
            let status_str = if result.exit_code == 0 { "✅ COMPLETED" } else { "⚠️ FAILED" };

            info!(
                "{} Execution done | exit={} duration={}ms (total {}ms) timed_out={}",
                status_str,
                result.exit_code,
                result.duration_ms,
                total_ms,
                result.timed_out
            );

            if !result.stdout.is_empty() {
                let preview: String = result.stdout.chars().take(200).collect();
                info!("📤 stdout: {}{}", preview, if result.stdout.len() > 200 { "..." } else { "" });
            }
            if !result.stderr.is_empty() {
                let preview: String = result.stderr.chars().take(200).collect();
                warn!("⚠️ stderr: {}{}", preview, if result.stderr.len() > 200 { "..." } else { "" });
            }

            Ok(Json(json!({
                "status": if result.exit_code == 0 { "completed" } else { "failed" },
                "exit_code": result.exit_code,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "duration_ms": result.duration_ms,
                "timed_out": result.timed_out,
                "agent": "rust",
            })))
        }
        Err(e) => {
            error!("❌ Execution failed: {}", e);
            Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
        }
    }
}

async fn accept_job(
    State(state): State<AppState>,
    Path(job_id): Path<u64>,
) -> Result<Json<Value>, (StatusCode, String)> {
    info!("📲 Accept request for job #{}", job_id);

    state.client.accept_job(job_id).await
        .map_err(|e| {
            warn!("❌ Accept job #{} failed: {}", job_id, e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;

    info!("✅ Job #{} accepted on-chain", job_id);

    Ok(Json(json!({
        "status": "accepted",
        "job_id": job_id,
    })))
}

async fn complete_job(
    State(state): State<AppState>,
    Path(job_id): Path<u64>,
) -> Result<Json<Value>, (StatusCode, String)> {
    info!("🏁 Complete request for job #{}", job_id);

    state.client.complete_job(job_id).await
        .map_err(|e| {
            warn!("❌ Complete job #{} failed: {}", job_id, e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;

    info!("✅ Job #{} completed on-chain", job_id);

    Ok(Json(json!({
        "status": "completed",
        "job_id": job_id,
    })))
}

// ── Main ────────────────────────────────────────────────

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

    // Background monitors
    let monitor_client = client.clone();
    let (monitor_tx, mut monitor_rx) = tokio::sync::mpsc::channel(100);

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
                        job.job_id, job.node_id, job.job_type, job.consumer,
                        wei_to_dgram(&job.price_per_hour_wei)
                    );
                }
                monitor::MonitorEvent::JobAccepted(job) => {
                    info!("✅ Job #{} ACCEPTED on-chain", job.job_id);
                }
                monitor::MonitorEvent::JobCompleted(job) => {
                    info!("🏁 Job #{} COMPLETED on-chain", job.job_id);
                }
                monitor::MonitorEvent::JobExpired(job) => {
                    info!("⏰ Job #{} EXPIRED + auto-completed", job.job_id);
                }
            }
        }
    });

    // Heartbeat
    let hb_client = client.clone();
    tokio::spawn(async move {
        monitor::run_heartbeat(hb_client).await;
    });

    // HTTP server
    let state = AppState { client };
    let app = Router::new()
        .route("/health", get(health))
        .route("/info", get(info))
        .route("/jobs", get(list_jobs))
        .route("/execute", post(execute_code))
        .route("/jobs/{id}/accept", post(accept_job))
        .route("/jobs/{id}/complete", post(complete_job))
        .layer(middleware::from_fn(request_logger))
        .layer(CorsLayer::very_permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    info!("╔══════════════════════════════════════════════════╗");
    info!("║ 🦀 ComputeRWA Rust Agent v2.0.0                 ║");
    info!("║    axum + alloy + tokio                          ║");
    info!("║    Listening on {}                        ║", addr);
    info!("╚══════════════════════════════════════════════════╝");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Convert wei string to human-readable DGRAM (6 decimals)
fn wei_to_dgram(wei_str: &str) -> String {
    if let Ok(wei) = wei_str.parse::<u128>() {
        let whole = wei / 1_000_000;
        let frac = wei % 1_000_000;
        if frac == 0 {
            format!("{}", whole)
        } else {
            format!("{}.{:06}", whole, frac)
        }
    } else {
        wei_str.to_string()
    }
}
