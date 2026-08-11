// ── Job monitor ─────────────────────────────────────────
//
// Background task that polls the marketplace contract for
// new pending jobs assigned to this provider's nodes.

use crate::chain::{ChainClient, JOB_ACTIVE, JOB_COMPLETED, JOB_PENDING, JobInfo};
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
    let mut seen_pending: HashSet<u64> = HashSet::new();
    let mut seen_completed: HashSet<u64> = HashSet::new();
    let interval = Duration::from_secs(config.poll_interval_secs);
    let mut poll_count: u64 = 0;

    info!(
        "Job monitor started (poll={}s, auto_accept={})",
        config.poll_interval_secs, config.auto_accept
    );

    loop {
        tokio::time::sleep(interval).await;
        poll_count += 1;

        let jobs = match client.get_provider_jobs().await {
            Ok(jobs) => jobs,
            Err(e) => {
                warn!("❌ Monitor poll #{} failed: {}", poll_count, e);
                continue;
            }
        };

        let total = jobs.len();
        let pending = jobs.iter().filter(|j| j.status == JOB_PENDING).count();
        let active = jobs.iter().filter(|j| j.status == JOB_ACTIVE).count();
        let completed = jobs.iter().filter(|j| j.status == JOB_COMPLETED).count();

        // Log poll summary every 4 cycles (~1 min) or when there are jobs
        if poll_count.is_multiple_of(4) || total > 0 {
            info!(
                "📊 Poll #{}: {} jobs (pending={}, active={}, completed={})",
                poll_count, total, pending, active, completed
            );
        }

        for job in jobs {
            let job_id = job.job_id;

            let first_sighting = match job.status {
                JOB_PENDING => seen_pending.insert(job_id),
                JOB_COMPLETED => seen_completed.insert(job_id),
                _ => true,
            };

            match job.status {
                JOB_PENDING if first_sighting => {
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
                        info!(
                            "⏳ Job #{} waiting for manual accept (auto_accept=false)",
                            job_id
                        );
                    }
                }

                JOB_ACTIVE if job.started_at > 0 => {
                    let elapsed = now_timestamp().saturating_sub(job.started_at);
                    let duration_secs = job.duration_hours.saturating_mul(3600);
                    let remaining = duration_secs.saturating_sub(elapsed);

                    if remaining > 0 {
                        info!(
                            "⏱️  Job #{} ACTIVE | remaining {:02}:{:02}:{:02} ({}% elapsed)",
                            job_id,
                            remaining / 3600,
                            (remaining % 3600) / 60,
                            remaining % 60,
                            (elapsed * 100) / duration_secs.max(1)
                        );
                    } else {
                        info!(
                            "⏰ Job #{} EXPIRED (elapsed={}s, duration={}s) — auto-completing...",
                            job_id, elapsed, duration_secs
                        );
                        match client.complete_job(job_id).await {
                            Ok(_) => {
                                info!("🏁 Job #{} COMPLETED on-chain (auto)", job_id);
                                seen_completed.insert(job_id);
                                let _ = tx.send(MonitorEvent::JobExpired(job.clone())).await;
                            }
                            Err(e) => warn!("❌ Failed to auto-complete job #{}: {}", job_id, e),
                        }
                    }
                }

                // Settled elsewhere (consumer called /complete, or another
                // agent instance) — still needs the local terminal torn down.
                JOB_COMPLETED if first_sighting => {
                    let _ = tx.send(MonitorEvent::JobCompleted(job.clone())).await;
                }

                _ => {}
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
