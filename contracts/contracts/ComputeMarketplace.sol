// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IComputeIndexFund} from "./interfaces/IComputeIndexFund.sol";
import {IComputeRegistry} from "./interfaces/IComputeRegistry.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";

/**
 * @title ComputeMarketplace
 * @notice Lease compute resources on BOT Chain. Consumers escrow BOT up front,
 *         providers are paid for the time they actually served, and a protocol
 *         cut of every settlement flows to the CIF index fund.
 * @dev Settlement never trusts a counterparty to accept value: a failed transfer
 *      is booked as a `pendingWithdrawals` credit instead of reverting, so a
 *      consumer whose address rejects ether cannot brick a provider's payout.
 */
contract ComputeMarketplace is Ownable, ReentrancyGuard {
    // ── Errors ─────────────────────────────────────────────
    error ConfidenceOutOfRange(uint16 bps);
    error FeeTooHigh(uint16 bps);
    error InsufficientPayment(uint256 required, uint256 provided);
    error InvalidDuration();
    error JobNotActive();
    error JobNotExtendable();
    error JobNotPending();
    error LeaseNotExpired(uint256 settleableAt);
    error LowConfidence(uint16 confidence, uint16 required);
    error NodeNotActive();
    error NodeNotVerified();
    error NotConsumer();
    error NotProvider();
    error NothingToWithdraw();
    error StalePrice(uint64 updatedAt);
    error WithdrawFailed();
    error ZeroAddress();

    // ── Types ──────────────────────────────────────────────
    enum JobStatus {
        Pending, // 0 — created, waiting acceptance
        Active, // 1 — provider accepted, compute running
        Completed, // 2 — job finished, revenue settled
        Cancelled // 3 — cancelled by consumer (before acceptance)
    }

    struct ComputeJob {
        uint64 nodeId; // which compute node
        address consumer; // who requested the job
        address provider; // who provides compute
        string jobType; // e.g. "LLM Training", "Inference"
        string specHash; // IPFS/hash of job spec
        uint256 pricePerHourWei; // BOT/hr locked at creation
        uint256 paymentAmount; // actual BOT escrowed by consumer
        uint64 durationHours; // booked duration
        uint64 startedAt; // when provider accepted
        uint64 completedAt; // when job settled
        JobStatus status;
    }

    // ── Constants ──────────────────────────────────────────

    /// @dev The AI pricing engine pushes on a manual cadence during the testnet
    ///      demo, so a week is the widest window that still rejects a feed that
    ///      has genuinely stopped being maintained.
    uint256 public constant MAX_PRICE_AGE = 7 days;

    /// @dev Breathing room for a provider whose agent is merely slow to call
    ///      completeJob before anyone may settle the lease on its behalf.
    uint256 public constant SETTLE_GRACE = 1 hours;

    /// @dev Bounds the escrow lock-up and keeps every `startedAt + duration`
    ///      computation inside uint64.
    uint64 public constant MAX_DURATION_HOURS = 8760;

    /// @dev Hard cap on the owner-settable index cut.
    uint16 public constant MAX_INDEX_FEE_BPS = 2000;

    /// @dev Settlement forwards a bounded stipend so a counterparty cannot burn
    ///      the settler's gas to grief the payout; anything that needs more is
    ///      credited to pendingWithdrawals and pulled later.
    uint256 private constant PAYOUT_GAS_LIMIT = 50_000;

    // ── Storage ────────────────────────────────────────────
    mapping(uint256 => ComputeJob) public jobs;
    uint256 public nextJobId = 1;

    IComputeRegistry public immutable registry;
    IPriceOracle public immutable oracle;

    address public indexFund;
    uint16 public indexFeeBps;
    uint16 public minConfidenceBps;

    mapping(address => uint256) public pendingWithdrawals;

    uint256 public totalVolumeWei; // lifetime BOT volume
    uint256 public totalJobs;

    // ── Events ─────────────────────────────────────────────
    event JobCreated(
        uint256 indexed jobId,
        uint64 indexed nodeId,
        address indexed consumer,
        string jobType,
        uint64 durationHours,
        uint256 pricePerHourWei,
        uint256 paymentAmount
    );
    event JobAccepted(uint256 indexed jobId, address indexed provider, uint64 startedAt);
    event JobExtended(uint256 indexed jobId, uint64 extraHours, uint64 durationHours, uint256 paymentAmount);
    event JobCompleted(uint256 indexed jobId, uint64 completedAt, uint256 totalCost, uint256 refund);
    event JobSettledLate(uint256 indexed jobId, address indexed settler, uint256 totalCost);
    event JobCancelled(uint256 indexed jobId, uint256 refund);
    event IndexFeeRouted(uint256 indexed jobId, address indexed fund, uint256 amount);
    event PaymentDeferred(address indexed payee, uint256 amount);
    event PendingWithdrawn(address indexed payee, uint256 amount);
    event IndexFundSet(address indexed fund);
    event IndexFeeBpsSet(uint16 bps);
    event MinConfidenceBpsSet(uint16 bps);
    event Funded(address indexed from, uint256 amount);

    // ── Constructor ────────────────────────────────────────
    constructor(address registry_, address oracle_) Ownable(msg.sender) {
        if (registry_ == address(0) || oracle_ == address(0)) revert ZeroAddress();
        registry = IComputeRegistry(registry_);
        oracle = IPriceOracle(oracle_);
        minConfidenceBps = 5000;
        emit MinConfidenceBpsSet(5000);
    }

    // ── Consumer Functions ─────────────────────────────────

    /**
     * @notice Create a compute job and escrow the lease payment.
     * @dev The rate is derived from the node's own registered GPU model, never
     *      from caller-supplied input, so a lease cannot be priced against
     *      cheaper hardware than it actually reserves.
     * @param nodeId Target compute node.
     * @param jobType Type of compute work.
     * @param specHash Hash of the off-chain job specification.
     * @param durationHours How many hours of compute to book.
     * @return jobId Identifier of the new job.
     */
    function createJob(uint64 nodeId, string calldata jobType, string calldata specHash, uint64 durationHours)
        external
        payable
        nonReentrant
        returns (uint256 jobId)
    {
        if (durationHours == 0 || durationHours > MAX_DURATION_HOURS) revert InvalidDuration();

        IComputeRegistry.ComputeNode memory node = registry.getNode(nodeId);
        if (node.status != IComputeRegistry.NodeStatus.Active) revert NodeNotActive();
        if (!node.verified) revert NodeNotVerified();

        uint256 pricePerHour = _quote(node.specs.model);
        uint256 totalCost = pricePerHour * durationHours;
        if (msg.value < totalCost) revert InsufficientPayment(totalCost, msg.value);

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

    /**
     * @notice Extend an existing lease in place.
     * @dev Re-uses the rate locked at creation rather than re-quoting the oracle,
     *      so an extension can never be repriced against the consumer mid-lease.
     * @param jobId Job to extend.
     * @param extraHours Additional hours to book.
     */
    function extendJob(uint256 jobId, uint64 extraHours) external payable nonReentrant {
        ComputeJob storage job = jobs[jobId];
        if (job.consumer != msg.sender) revert NotConsumer();
        if (job.status != JobStatus.Pending && job.status != JobStatus.Active) revert JobNotExtendable();
        if (extraHours == 0) revert InvalidDuration();

        uint64 newDuration = job.durationHours + extraHours;
        if (newDuration > MAX_DURATION_HOURS) revert InvalidDuration();

        uint256 extraCost = job.pricePerHourWei * extraHours;
        if (msg.value < extraCost) revert InsufficientPayment(extraCost, msg.value);

        job.durationHours = newDuration;
        job.paymentAmount += msg.value;

        emit JobExtended(jobId, extraHours, newDuration, job.paymentAmount);
    }

    /**
     * @notice Cancel a job the provider has not accepted yet and reclaim the escrow.
     * @param jobId Job to cancel.
     */
    function cancelJob(uint256 jobId) external nonReentrant {
        ComputeJob storage job = jobs[jobId];
        if (job.status != JobStatus.Pending) revert JobNotPending();
        if (job.consumer != msg.sender) revert NotConsumer();

        job.status = JobStatus.Cancelled;

        uint256 refund = job.paymentAmount;
        _payout(job.consumer, refund);

        emit JobCancelled(jobId, refund);
    }

    // ── Provider Functions ─────────────────────────────────

    /**
     * @notice Accept a pending job and start the compute clock.
     * @param jobId Job to accept.
     */
    function acceptJob(uint256 jobId) external {
        ComputeJob storage job = jobs[jobId];
        if (job.status != JobStatus.Pending) revert JobNotPending();
        if (job.provider != msg.sender) revert NotProvider();

        job.status = JobStatus.Active;
        job.startedAt = uint64(block.timestamp);

        emit JobAccepted(jobId, msg.sender, job.startedAt);
    }

    /**
     * @notice Settle an active job. The provider is paid for elapsed time only,
     *         capped at the booked duration; the rest returns to the consumer.
     * @param jobId Job to settle.
     */
    function completeJob(uint256 jobId) external nonReentrant {
        ComputeJob storage job = jobs[jobId];
        if (job.status != JobStatus.Active) revert JobNotActive();
        if (job.provider != msg.sender) revert NotProvider();

        (uint256 cost, uint256 refund) = _settle(jobId, job, uint64(block.timestamp));
        emit JobCompleted(jobId, job.completedAt, cost, refund);
    }

    // ── Permissionless Settlement ──────────────────────────

    /**
     * @notice Settle a lease whose booked duration has elapsed, on behalf of a
     *         provider that never called completeJob.
     * @dev Without this a provider whose agent dies after acceptJob leaves the
     *      consumer's escrow locked with no timeout and no admin key to unlock it.
     *      Settlement values the lease at its full booked duration, which is what
     *      the consumer reserved and paid for.
     * @param jobId Job to settle.
     */
    function settleExpiredJob(uint256 jobId) external nonReentrant {
        ComputeJob storage job = jobs[jobId];
        if (job.status != JobStatus.Active) revert JobNotActive();

        uint256 leaseEnd = uint256(job.startedAt) + uint256(job.durationHours) * 3600;
        uint256 settleAfter = leaseEnd + SETTLE_GRACE;
        if (block.timestamp < settleAfter) revert LeaseNotExpired(settleAfter);

        (uint256 cost, uint256 refund) = _settle(jobId, job, uint64(leaseEnd));
        emit JobCompleted(jobId, job.completedAt, cost, refund);
        emit JobSettledLate(jobId, msg.sender, cost);
    }

    /**
     * @notice Claim value that a failed settlement transfer credited to the caller.
     * @return amount Wei paid out.
     */
    function withdrawPending() external nonReentrant returns (uint256 amount) {
        amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0;

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert WithdrawFailed();

        emit PendingWithdrawn(msg.sender, amount);
    }

    // ── Admin ──────────────────────────────────────────────

    /**
     * @notice Point settlement at the CIF index fund that receives the protocol cut.
     * @param fund ComputeIndexToken address, or the zero address to disable the cut.
     */
    function setIndexFund(address fund) external onlyOwner {
        indexFund = fund;
        emit IndexFundSet(fund);
    }

    /**
     * @notice Set the share of settled revenue routed to the index fund.
     * @param bps Fee in basis points, at most MAX_INDEX_FEE_BPS.
     */
    function setIndexFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_INDEX_FEE_BPS) revert FeeTooHigh(bps);
        indexFeeBps = bps;
        emit IndexFeeBpsSet(bps);
    }

    /**
     * @notice Set the minimum oracle confidence a quote must carry to price a lease.
     * @param bps Confidence floor in basis points, at most 10000.
     */
    function setMinConfidenceBps(uint16 bps) external onlyOwner {
        if (bps > 10_000) revert ConfidenceOutOfRange(bps);
        minConfidenceBps = bps;
        emit MinConfidenceBpsSet(bps);
    }

    // ── View Functions ─────────────────────────────────────

    /**
     * @notice Read a job record.
     * @param jobId Job identifier.
     * @return The full job record.
     */
    function getJob(uint256 jobId) external view returns (ComputeJob memory) {
        return jobs[jobId];
    }

    /**
     * @notice Cost of a job's full booked duration at its locked rate.
     * @param jobId Job identifier.
     * @return Cost in wei.
     */
    function getJobCost(uint256 jobId) external view returns (uint256) {
        ComputeJob memory job = jobs[jobId];
        return job.pricePerHourWei * job.durationHours;
    }

    /**
     * @notice Timestamp from which anyone may call settleExpiredJob for a job.
     * @param jobId Job identifier.
     * @return Unix timestamp; meaningless for jobs that are not Active.
     */
    function settleableAt(uint256 jobId) external view returns (uint256) {
        ComputeJob memory job = jobs[jobId];
        return uint256(job.startedAt) + uint256(job.durationHours) * 3600 + SETTLE_GRACE;
    }

    // ── Internal ───────────────────────────────────────────

    function _quote(string memory model) internal view returns (uint256 pricePerHourWei) {
        uint64 updatedAt;
        uint16 confidence;
        (pricePerHourWei, updatedAt, confidence) = oracle.getPrice(model);

        if (block.timestamp > uint256(updatedAt) + MAX_PRICE_AGE) revert StalePrice(updatedAt);
        if (confidence < minConfidenceBps) revert LowConfidence(confidence, minConfidenceBps);
    }

    function _settle(uint256 jobId, ComputeJob storage job, uint64 endedAt)
        internal
        returns (uint256 cost, uint256 refund)
    {
        job.status = JobStatus.Completed;
        job.completedAt = endedAt;

        uint256 elapsed = endedAt > job.startedAt ? uint256(endedAt - job.startedAt) : 0;
        uint256 bookedSeconds = uint256(job.durationHours) * 3600;
        if (elapsed > bookedSeconds) elapsed = bookedSeconds;

        cost = (job.pricePerHourWei * elapsed) / 3600;
        if (cost > job.paymentAmount) cost = job.paymentAmount;
        refund = job.paymentAmount - cost;

        totalVolumeWei += cost;
        registry.addRevenue(job.nodeId, uint96(cost));

        uint256 providerAmount = cost;
        address fund = indexFund;
        uint256 fee = fund == address(0) ? 0 : (cost * indexFeeBps) / 10_000;
        if (fee > 0) {
            try IComputeIndexFund(fund).receiveRevenue{value: fee}() {
                providerAmount -= fee;
                emit IndexFeeRouted(jobId, fund, fee);
            } catch {
                // A fund that will not take the cut must not strand the provider's payout.
            }
        }

        _payout(job.provider, providerAmount);
        _payout(job.consumer, refund);
    }

    function _payout(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount, gas: PAYOUT_GAS_LIMIT}("");
        if (!ok) {
            pendingWithdrawals[to] += amount;
            emit PaymentDeferred(to, amount);
        }
    }

    // ── Receive ────────────────────────────────────────────

    /// @notice Accept bare transfers so operators can top the contract up during a demo.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }
}
