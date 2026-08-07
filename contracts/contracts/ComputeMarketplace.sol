// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ComputeMarketplace
 * @notice Lease compute resources on BOT Chain.
 *         Consumers pay BOT to lease GPU time from providers.
 *         Revenue flows to ComputeRegistry for RWA attestation.
 */

interface IComputeRegistry {
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
    function addRevenue(uint256 nodeId, uint96 amount) external;
}

interface IPriceOracle {
    function getPrice(string calldata model)
        external
        view
        returns (uint256 pricePerHourWei, uint64 updatedAt, uint16 confidence);
}

contract ComputeMarketplace {
    // ── Types ──────────────────────────────────────────────
    enum JobStatus {
        Pending,    // 0 — created, waiting acceptance
        Active,     // 1 — provider accepted, compute running
        Completed,  // 2 — job finished, revenue settled
        Cancelled,  // 3 — cancelled by consumer (before acceptance)
        Disputed    // 4 — flagged for review
    }

    struct ComputeJob {
        uint256 nodeId;          // which compute node
        address consumer;        // who requested the job
        address provider;        // who provides compute
        string jobType;          // e.g. "LLM Training", "Inference"
        string specHash;         // IPFS/hash of job spec
        uint256 pricePerHourWei; // BOT/hr locked at creation
        uint256 paymentAmount;   // actual BOT paid by consumer (for refund)
        uint64 durationHours;    // requested duration
        uint64 startedAt;        // when provider accepted
        uint64 completedAt;      // when job finished
        JobStatus status;
    }

    // ── Storage ────────────────────────────────────────────
    mapping(uint256 => ComputeJob) public jobs;
    uint256 public nextJobId = 1;

    IComputeRegistry public registry;
    IPriceOracle public oracle;

    uint256 public totalVolumeWei;      // lifetime BOT volume
    uint256 public totalJobs;

    // ── Events ─────────────────────────────────────────────
    event JobCreated(uint256 indexed jobId, uint256 indexed nodeId, address indexed consumer, string jobType, uint64 durationHours, uint256 pricePerHourWei, uint256 paymentAmount);
    event JobAccepted(uint256 indexed jobId, address indexed provider);
    event JobCompleted(uint256 indexed jobId, uint64 completedAt, uint256 totalCost, uint256 refund);
    event JobCancelled(uint256 indexed jobId, uint256 refund);

    // ── Constructor ────────────────────────────────────────
    constructor(address _registry, address _oracle) {
        registry = IComputeRegistry(_registry);
        oracle = IPriceOracle(_oracle);
    }

    // ── Consumer Functions ─────────────────────────────────

    /**
     * @notice Create a compute job. Consumer sends payment upfront.
     * @param nodeId Target compute node
     * @param jobType Type of compute work
     * @param specHash Hash of job specification (off-chain)
     * @param durationHours How many hours of compute needed
     * @param gpuModel GPU model for price lookup
     */
    function createJob(
        uint256 nodeId,
        string calldata jobType,
        string calldata specHash,
        uint64 durationHours,
        string calldata gpuModel
    ) external payable returns (uint256 jobId) {
        require(durationHours > 0, "Duration must be > 0");

        // Get price from oracle
        (uint256 pricePerHour, , ) = oracle.getPrice(gpuModel);
        uint256 totalCost = pricePerHour * durationHours;
        require(msg.value >= totalCost, "Insufficient payment");

        // Verify node exists and is active
        IComputeRegistry.ComputeNode memory node = registry.getNode(nodeId);
        require(node.status == IComputeRegistry.NodeStatus.Active, "Node not active");
        require(node.provider != address(0), "Node does not exist");
        require(node.verified, "Node not verified");

        jobId = nextJobId++;
        jobs[jobId] = ComputeJob({
            nodeId: nodeId,
            consumer: msg.sender,
            provider: node.provider,
            jobType: jobType,
            specHash: specHash,
            pricePerHourWei: pricePerHour,
            paymentAmount: msg.value,
            durationHours: durationHours,
            startedAt: 0,
            completedAt: 0,
            status: JobStatus.Pending
        });

        totalJobs++;
        emit JobCreated(jobId, nodeId, msg.sender, jobType, durationHours, pricePerHour, msg.value);
    }

    // ── Provider Functions ─────────────────────────────────

    /**
     * @notice Provider accepts a pending job. Starts the compute clock.
     */
    function acceptJob(uint256 jobId) external {
        ComputeJob storage job = jobs[jobId];
        require(job.status == JobStatus.Pending, "Job not pending");
        require(job.provider == msg.sender, "Not the provider");

        job.status = JobStatus.Active;
        job.startedAt = uint64(block.timestamp);

        emit JobAccepted(jobId, msg.sender);
    }

    /**
     * @notice Provider marks job as completed. Revenue is settled.
     *         Excess payment is refunded to consumer (from this job only).
     */
    function completeJob(uint256 jobId) external {
        ComputeJob storage job = jobs[jobId];
        require(job.status == JobStatus.Active, "Job not active");
        require(job.provider == msg.sender, "Not the provider");

        job.status = JobStatus.Completed;
        job.completedAt = uint64(block.timestamp);

        uint256 totalCost = job.pricePerHourWei * job.durationHours;

        // Pay provider
        (bool ok, ) = job.provider.call{value: totalCost}("");
        require(ok, "Payment failed");

        // Refund excess to consumer — ONLY from this job's payment
        uint256 refund = job.paymentAmount - totalCost;
        if (refund > 0) {
            (bool ok2, ) = job.consumer.call{value: refund}("");
            require(ok2, "Refund failed");
        }

        // Update registry revenue
        registry.addRevenue(job.nodeId, uint96(totalCost));
        totalVolumeWei += totalCost;

        emit JobCompleted(jobId, job.completedAt, totalCost, refund);
    }

    /**
     * @notice Consumer cancels a pending job (before provider accepts).
     *         Full payment refunded.
     */
    function cancelJob(uint256 jobId) external {
        ComputeJob storage job = jobs[jobId];
        require(job.status == JobStatus.Pending, "Can only cancel pending");
        require(job.consumer == msg.sender, "Not the consumer");

        job.status = JobStatus.Cancelled;

        // Refund full payment amount
        uint256 refund = job.paymentAmount;
        if (refund > 0) {
            (bool ok, ) = job.consumer.call{value: refund}("");
            require(ok, "Refund failed");
        }

        emit JobCancelled(jobId, refund);
    }

    // ── View Functions ─────────────────────────────────────

    function getJob(uint256 jobId) external view returns (ComputeJob memory) {
        return jobs[jobId];
    }

    function getJobCost(uint256 jobId) external view returns (uint256) {
        ComputeJob memory job = jobs[jobId];
        return job.pricePerHourWei * job.durationHours;
    }

    // ── Receive ────────────────────────────────────────────
    receive() external payable {}
}
