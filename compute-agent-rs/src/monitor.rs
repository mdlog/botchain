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

    info!(
        "Job monitor started (poll={}s, auto_accept={})",
        config.poll_interval_secs, config.auto_accept
    );

    loop {
        tokio::time::sleep(interval).await;

        match client.get_provider_jobs().await {
            Ok(jobs) => {
                for job in jobs {
                    let job_id = job.job_id;

                    if job.status == 0 && !seen_jobs.contains(&job_id) {
                        seen_jobs.insert(job_id);
                        info!("New pending job #{} (node={}, type={})", job_id, job.node_id, job.job_type);

                        let _ = tx.send(MonitorEvent::NewPendingJob(job.clone())).await;

                        if config.auto_accept {
                            match client.accept_job(job_id).await {
                                Ok(_) => {
                                    info!("Auto-accepted job #{}", job_id);
                                    let _ = tx.send(MonitorEvent::JobAccepted(job.clone())).await;
                                }
                                Err(e) => warn!("Failed to auto-accept job #{}: {}", job_id, e),
                            }
                        }
                    }

                    if job.status == 1 && job.started_at > 0 {
                        let elapsed = now_timestamp().saturating_sub(job.started_at);
                        let duration_secs = job.duration_hours * 3600;

                        if elapsed >= duration_secs {
                            info!("Job #{} expired (elapsed={}s, duration={}s)", job_id, elapsed, duration_secs);

                            match client.complete_job(job_id).await {
                                Ok(_) => {
                                    info!("Auto-completed expired job #{}", job_id);
                                    let _ = tx.send(MonitorEvent::JobExpired(job)).await;
                                }
                                Err(e) => warn!("Failed to auto-complete job #{}: {}", job_id, e),
                            }
                        }
                    }
                }
            }
            Err(e) => warn!("Monitor poll failed: {}", e),
        }
    }
}

pub async fn run_heartbeat(client: Arc<ChainClient>) {
    let interval = Duration::from_secs(300);

    info!("Heartbeat monitor started (interval=300s)");

    loop {
        tokio::time::sleep(interval).await;

        match client.get_provider_nodes().await {
            Ok(node_ids) => {
                for node_id in node_ids {
                    if let Err(e) = client.heartbeat(node_id).await {
                        warn!("Heartbeat failed for node {}: {}", node_id, e);
                    }
                }
            }
            Err(e) => warn!("Failed to get provider nodes: {}", e),
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
