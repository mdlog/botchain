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
        enum JobStatus { Pending, Active, Completed, Cancelled, Disputed }

        struct ComputeJob {
            uint256 nodeId;
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

        function getNode(uint256 nodeId) external view returns (ComputeNode memory);
        function getProviderNodes(address provider) external view returns (uint256[] memory);
        function heartbeat(uint256 nodeId) external;
    }
}

type Mkt = ComputeMarketplace::ComputeMarketplaceInstance<Arc<DynProvider>>;
type Reg = ComputeRegistry::ComputeRegistryInstance<Arc<DynProvider>>;

pub struct ChainClient {
    marketplace: Mkt,
    registry: Reg,
    provider_address: Address,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

impl ChainClient {
    pub async fn from_env() -> Result<Self> {
        let priv_key_str = env::var("PROVIDER_PRIVATE_KEY")
            .context("PROVIDER_PRIVATE_KEY not set")?;
        let key = if priv_key_str.starts_with("0x") {
            priv_key_str
        } else {
            format!("0x{}", priv_key_str)
        };
        let signer = PrivateKeySigner::from_str(&key)
            .context("Invalid private key")?;
        let provider_address = signer.address();

        let rpc_url = env::var("RPC_URL")
            .unwrap_or_else(|_| "https://rpc.bohr.life".to_string());

        let marketplace_addr = env::var("MARKETPLACE_ADDR")
            .unwrap_or_else(|_| "0x7278045051843BbdD7786B493de0681904075f02".to_string());
        let registry_addr = env::var("REGISTRY_ADDR")
            .unwrap_or_else(|_| "0xc612111b8648B73ED23CF19f400488566af76Ddc".to_string());

        let mkt = Address::from_str(&marketplace_addr)
            .context("Invalid MARKETPLACE_ADDR")?;
        let reg = Address::from_str(&registry_addr)
            .context("Invalid REGISTRY_ADDR")?;

        // connect() is async in alloy 1.8.3
        let provider = ProviderBuilder::new()
            .wallet(signer)
            .connect(&rpc_url)
            .await?;
        let provider: Arc<DynProvider> = Arc::new(DynProvider::new(provider));

        let marketplace = ComputeMarketplace::new(mkt, provider.clone());
        let registry = ComputeRegistry::new(reg, provider);

        info!("ChainClient init: provider={:?}", provider_address);

        Ok(Self { marketplace, registry, provider_address })
    }

    pub fn address(&self) -> Address {
        self.provider_address
    }

    pub async fn get_job(&self, job_id: u64) -> Result<JobInfo> {
        let job = self.marketplace.getJob(U256::from(job_id))
            .call()
            .await
            .context("getJob failed")?;

        Ok(JobInfo {
            job_id,
            node_id: job.nodeId.to::<u64>(),
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
        let total = self.marketplace.totalJobs()
            .call()
            .await
            .context("totalJobs failed")?;
        Ok(total.to::<u64>())
    }

    pub async fn accept_job(&self, job_id: u64) -> Result<()> {
        self.marketplace.acceptJob(U256::from(job_id))
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
        self.marketplace.completeJob(U256::from(job_id))
            .send()
            .await
            .context("completeJob tx failed")?
            .get_receipt()
            .await
            .context("completeJob receipt failed")?;
        info!("Job {} completed", job_id);
        Ok(())
    }

    pub async fn get_provider_jobs(&self) -> Result<Vec<JobInfo>> {
        let total = self.total_jobs().await?;
        let mut jobs = Vec::new();
        let addr_lower = self.provider_address.to_string().to_lowercase();

        for i in 1..=total {
            match self.get_job(i).await {
                Ok(job) => {
                    if job.provider.to_lowercase() == addr_lower {
                        jobs.push(job);
                    }
                }
                Err(e) => warn!("Failed to fetch job {}: {}", i, e),
            }
        }
        Ok(jobs)
    }

    pub async fn get_provider_nodes(&self) -> Result<Vec<u64>> {
        let nodes = self.registry.getProviderNodes(self.provider_address)
            .call()
            .await
            .context("getProviderNodes failed")?;
        Ok(nodes.into_iter().map(|n| n.to::<u64>()).collect())
    }

    pub async fn heartbeat(&self, node_id: u64) -> Result<()> {
        self.registry.heartbeat(U256::from(node_id))
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
