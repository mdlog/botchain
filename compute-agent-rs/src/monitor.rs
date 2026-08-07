// ── Job monitor ─────────────────────────────────────────
//
// Background task that polls the marketplace contract for
// new pending jobs assigned to this provider's nodes.

use crate::chain::{ChainClient, JobInfo};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::{info, warn};

pub struct MonitorConfig {
    pub poll_interval_secs: u64,
    pub auto_accept: bool,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            poll_interval_secs: 15,
            auto_accept: false,
        }
    }
}

#[derive(Debug, Clone)]
pub enum MonitorEvent {
    NewPendingJob(JobInfo),
    JobAccepted(JobInfo),
    JobCompleted(JobInfo),
    JobExpired(JobInfo),
}

pub async fn run_monitor(
    client: Arc<ChainClient>,
    config: MonitorConfig,
    tx: mpsc::Sender<MonitorEvent>,
) {
    let mut seen_jobs: HashSet<u64> = HashSet::new();
    let interval = Duration::from_secs(config.poll_interval_secs);
    let mut poll_count: u64 = 0;

    info!(
        "Job monitor started (poll={}s, auto_accept={})",
        config.poll_interval_secs, config.auto_accept
    );

    loop {
        tokio::time::sleep(interval).await;
        poll_count += 1;

        match client.get_provider_jobs().await {
            Ok(jobs) => {
                let total = jobs.len();
                let pending = jobs.iter().filter(|j| j.status == 0).count();
                let active = jobs.iter().filter(|j| j.status == 1).count();
                let completed = jobs.iter().filter(|j| j.status == 2).count();

                // Log poll summary every 4 cycles (~1 min) or when there are jobs
                if poll_count % 4 == 0 || total > 0 {
                    info!(
                        "📊 Poll #{}: {} jobs (pending={}, active={}, completed={})",
                        poll_count, total, pending, active, completed
                    );
                }

                for job in jobs {
                    let job_id = job.job_id;

                    // New pending job detected
                    if job.status == 0 && !seen_jobs.contains(&job_id) {
                        seen_jobs.insert(job_id);
                        info!(
                            "🔔 NEW PENDING JOB #{} | node={} type={} consumer={} price={} DGRAM/hr duration={}h",
                            job_id,
                            job.node_id,
                            job.job_type,
                            job.consumer,
                            wei_to_dgram(&job.price_per_hour_wei),
                            job.duration_hours
                        );

                        let _ = tx.send(MonitorEvent::NewPendingJob(job.clone())).await;

                        if config.auto_accept {
                            info!("⚡ Auto-accepting job #{}...", job_id);
                            match client.accept_job(job_id).await {
                                Ok(_) => {
                                    info!("✅ Job #{} ACCEPTED on-chain", job_id);
                                    let _ = tx.send(MonitorEvent::JobAccepted(job.clone())).await;
                                }
                                Err(e) => warn!("❌ Failed to auto-accept job #{}: {}", job_id, e),
                            }
                        } else {
                            info!("⏳ Job #{} waiting for manual accept (auto_accept=false)", job_id);
                        }
                    }

                    // Check active jobs for expiry
                    if job.status == 1 && job.started_at > 0 {
                        let elapsed = now_timestamp().saturating_sub(job.started_at);
                        let duration_secs = job.duration_hours * 3600;
                        let remaining = duration_secs.saturating_sub(elapsed);

                        // Log active job status every poll
                        if remaining > 0 {
                            let hrs = remaining / 3600;
                            let mins = (remaining % 3600) / 60;
                            let secs = remaining % 60;
                            info!(
                                "⏱️  Job #{} ACTIVE | remaining {:02}:{:02}:{:02} ({}% elapsed)",
                                job_id, hrs, mins, secs,
                                (elapsed * 100) / duration_secs.max(1)
                            );
                        }

                        if elapsed >= duration_secs {
                            info!(
                                "⏰ Job #{} EXPIRED (elapsed={}s, duration={}s) — auto-completing...",
                                job_id, elapsed, duration_secs
                            );

                            match client.complete_job(job_id).await {
                                Ok(_) => {
                                    info!("🏁 Job #{} COMPLETED on-chain (auto)", job_id);
                                    let _ = tx.send(MonitorEvent::JobExpired(job.clone())).await;
                                }
                                Err(e) => warn!("❌ Failed to auto-complete job #{}: {}", job_id, e),
                            }
                        }
                    }

                    // Log newly completed jobs
                    if job.status == 2 && seen_jobs.contains(&job_id) {
                        // Already logged completion, skip
                    }
                }
            }
            Err(e) => {
                warn!("❌ Monitor poll #{} failed: {}", poll_count, e);
            }
        }
    }
}

pub async fn run_heartbeat(client: Arc<ChainClient>) {
    let interval = Duration::from_secs(300);

    info!("💓 Heartbeat monitor started (interval=300s / 5min)");

    loop {
        tokio::time::sleep(interval).await;

        match client.get_provider_nodes().await {
            Ok(node_ids) => {
                if node_ids.is_empty() {
                    info!("💓 Heartbeat: no registered nodes (skip)");
                } else {
                    for node_id in &node_ids {
                        info!("💓 Sending heartbeat for node #{}...", node_id);
                        if let Err(e) = client.heartbeat(*node_id).await {
                            warn!("❌ Heartbeat failed for node #{}: {}", node_id, e);
                        }
                    }
                    info!("💓 Heartbeat cycle done ({} nodes)", node_ids.len());
                }
            }
            Err(e) => warn!("❌ Heartbeat: failed to get nodes: {}", e),
        }
    }
}

fn now_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
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
