// ── Chain interactions (alloy 1.8.3) ────────────────────
//
// Reads jobs from ComputeMarketplace, accepts/completes jobs,
// reads node info from ComputeRegistry.

use alloy::{
    primitives::{Address, U256},
    providers::{DynProvider, ProviderBuilder},
    signers::local::PrivateKeySigner,
    sol,
};
use anyhow::{Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::env;
use std::str::FromStr;
use std::sync::Arc;
use tracing::{info, warn};

// Contract ABIs — #[sol(rpc)] generates new() constructor + call builders
sol! {
    #[sol(rpc)]
    #[allow(missing_docs)]
    contract ComputeMarketplace {
        enum JobStatus { Pending, Active, Completed, Cancelled }

        struct ComputeJob {
            uint64 nodeId;
            address consumer;
            address provider;
            string jobType;
            string specHash;
            uint256 pricePerHourWei;
            uint256 paymentAmount;
            uint64 durationHours;
            uint64 startedAt;
            uint64 completedAt;
            JobStatus status;
        }

        function getJob(uint256 jobId) external view returns (ComputeJob memory);
        function getJobCost(uint256 jobId) external view returns (uint256);
        function acceptJob(uint256 jobId) external;
        function completeJob(uint256 jobId) external;
        function cancelJob(uint256 jobId) external;
        function nextJobId() external view returns (uint256);
        function totalJobs() external view returns (uint256);
    }

    #[sol(rpc)]
    #[allow(missing_docs)]
    contract ComputeRegistry {
        enum NodeStatus { Inactive, Active, Busy, Offline }

        struct GpuSpecs {
            string model;
            uint16 vramGB;
            uint16 tflops;
            string region;
        }

        struct ComputeNode {
            address provider;
            GpuSpecs specs;
            NodeStatus status;
            uint96 totalRevenue;
            uint64 registeredAt;
            uint64 lastHeartbeat;
            bool verified;
        }

        function getNode(uint64 nodeId) external view returns (ComputeNode memory);
        function getProviderNodes(address provider) external view returns (uint64[] memory);
        function heartbeat(uint64 nodeId) external;
    }
}

/// `JobStatus` discriminants, mirrored so callers do not sprinkle bare integers.
pub const JOB_PENDING: u8 = 0;
pub const JOB_ACTIVE: u8 = 1;
pub const JOB_COMPLETED: u8 = 2;

/// `getJob` is one RPC round trip per job and there is no bulk read on the
/// contract, so a provider scan walks only the tail of the job list. Anything
/// older than this window is settled history the agent has no work to do on.
const JOB_SCAN_WINDOW: u64 = 250;

/// Enough parallelism to keep the scan sub-second without stampeding a public
/// RPC endpoint into rate-limiting the provider.
const JOB_SCAN_CONCURRENCY: usize = 8;

type Mkt = ComputeMarketplace::ComputeMarketplaceInstance<Arc<DynProvider>>;
type Reg = ComputeRegistry::ComputeRegistryInstance<Arc<DynProvider>>;

pub struct ChainClient {
    marketplace: Mkt,
    registry: Reg,
    provider_address: Address,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobInfo {
    pub job_id: u64,
    pub node_id: u64,
    pub consumer: String,
    pub provider: String,
    pub job_type: String,
    pub spec_hash: String,
    pub price_per_hour_wei: String,
    pub payment_amount: String,
    pub duration_hours: u64,
    pub started_at: u64,
    pub completed_at: u64,
    pub status: u8,
}

impl JobInfo {
    /// Unix second at which the lease stops being billable.
    pub fn expires_at(&self) -> u64 {
        self.started_at
            .saturating_add(self.duration_hours.saturating_mul(3600))
    }
}

impl ChainClient {
    pub async fn from_env() -> Result<Self> {
        let priv_key_str =
            env::var("PROVIDER_PRIVATE_KEY").context("PROVIDER_PRIVATE_KEY not set")?;
        let key = if priv_key_str.starts_with("0x") {
            priv_key_str
        } else {
            format!("0x{}", priv_key_str)
        };
        let signer = PrivateKeySigner::from_str(&key).context("Invalid private key")?;
        let provider_address = signer.address();

        let rpc_url = env::var("RPC_URL").unwrap_or_else(|_| "https://rpc.bohr.life".to_string());

        let marketplace_addr = env::var("MARKETPLACE_ADDR")
            .unwrap_or_else(|_| "0xB72A69BeFFcd478e2ae19C20b65b1cAC1DC5d848".to_string());
        let registry_addr = env::var("REGISTRY_ADDR")
            .unwrap_or_else(|_| "0xcBbEa600C8d15E190A1C69676d8b8a5938BFE396".to_string());

        let mkt = Address::from_str(&marketplace_addr).context("Invalid MARKETPLACE_ADDR")?;
        let reg = Address::from_str(&registry_addr).context("Invalid REGISTRY_ADDR")?;

        // connect() is async in alloy 1.8.3
        let provider = ProviderBuilder::new()
            .wallet(signer)
            .connect(&rpc_url)
            .await?;
        let provider: Arc<DynProvider> = Arc::new(DynProvider::new(provider));

        let marketplace = ComputeMarketplace::new(mkt, provider.clone());
        let registry = ComputeRegistry::new(reg, provider);

        info!("ChainClient init: provider={:?}", provider_address);

        Ok(Self {
            marketplace,
            registry,
            provider_address,
        })
    }

    pub fn address(&self) -> Address {
        self.provider_address
    }

    /// True when `candidate` is this agent's own provider address.
    pub fn is_self(&self, candidate: &str) -> bool {
        candidate.eq_ignore_ascii_case(&self.provider_address.to_string())
    }

    pub async fn get_job(&self, job_id: u64) -> Result<JobInfo> {
        let job = self
            .marketplace
            .getJob(U256::from(job_id))
            .call()
            .await
            .context("getJob failed")?;

        Ok(JobInfo {
            job_id,
            node_id: job.nodeId,
            consumer: job.consumer.to_string(),
            provider: job.provider.to_string(),
            job_type: job.jobType.clone(),
            spec_hash: job.specHash.clone(),
            price_per_hour_wei: job.pricePerHourWei.to_string(),
            payment_amount: job.paymentAmount.to_string(),
            duration_hours: job.durationHours,
            started_at: job.startedAt,
            completed_at: job.completedAt,
            status: job.status as u8,
        })
    }

    pub async fn total_jobs(&self) -> Result<u64> {
        let total = self
            .marketplace
            .totalJobs()
            .call()
            .await
            .context("totalJobs failed")?;
        Ok(total.to::<u64>())
    }

    pub async fn accept_job(&self, job_id: u64) -> Result<()> {
        self.marketplace
            .acceptJob(U256::from(job_id))
            .send()
            .await
            .context("acceptJob tx failed")?
            .get_receipt()
            .await
            .context("acceptJob receipt failed")?;
        info!("Job {} accepted", job_id);
        Ok(())
    }

    pub async fn complete_job(&self, job_id: u64) -> Result<()> {
        self.marketplace
            .completeJob(U256::from(job_id))
            .send()
            .await
            .context("completeJob tx failed")?
            .get_receipt()
            .await
            .context("completeJob receipt failed")?;
        info!("Job {} completed", job_id);
        Ok(())
    }

    /// Jobs assigned to this provider, newest `JOB_SCAN_WINDOW` ids only.
    pub async fn get_provider_jobs(&self) -> Result<Vec<JobInfo>> {
        let total = self.total_jobs().await?;
        if total == 0 {
            return Ok(Vec::new());
        }
        let oldest = total.saturating_sub(JOB_SCAN_WINDOW).max(1);

        let mut jobs: Vec<JobInfo> = futures_util::stream::iter(oldest..=total)
            .map(|id| async move { (id, self.get_job(id).await) })
            .buffer_unordered(JOB_SCAN_CONCURRENCY)
            .filter_map(|(id, res)| async move {
                match res {
                    Ok(job) if self.is_self(&job.provider) => Some(job),
                    Ok(_) => None,
                    Err(e) => {
                        warn!("Failed to fetch job {}: {}", id, e);
                        None
                    }
                }
            })
            .collect()
            .await;

        // buffer_unordered yields out of order; callers log and diff by id.
        jobs.sort_unstable_by_key(|j| j.job_id);
        Ok(jobs)
    }

    pub async fn get_provider_nodes(&self) -> Result<Vec<u64>> {
        let nodes = self
            .registry
            .getProviderNodes(self.provider_address)
            .call()
            .await
            .context("getProviderNodes failed")?;
        Ok(nodes)
    }

    pub async fn heartbeat(&self, node_id: u64) -> Result<()> {
        self.registry
            .heartbeat(node_id)
            .send()
            .await
            .context("heartbeat tx failed")?
            .get_receipt()
            .await
            .context("heartbeat receipt failed")?;
        info!("Heartbeat sent for node {}", node_id);
        Ok(())
    }
}
