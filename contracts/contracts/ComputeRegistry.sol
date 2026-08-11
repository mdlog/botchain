// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IComputeRegistry} from "./interfaces/IComputeRegistry.sol";

/**
 * @title ComputeRegistry
 * @notice Registers GPU compute nodes on the BOT Chain DePIN network.
 *         Node IDs are uint64 derived from keccak256 hash (8 bytes),
 *         giving short unique IDs like 0xa1b2c3d4e5f6a7b8.
 * @dev `verified` is the gate that lets a node earn on the marketplace and back
 *      CIF shares, so verification is restricted to a dedicated attestation key
 *      that can be rotated without moving contract ownership.
 */
contract ComputeRegistry is IComputeRegistry, Ownable {
    // ── Errors ─────────────────────────────────────────────
    error ModelRequired();
    error NodeAlreadyExists(uint64 nodeId);
    error NodeNotFound(uint64 nodeId);
    error NotNodeProvider(uint64 nodeId);
    error NotMarketplace();
    error NotVerifier();
    error ZeroAddress();

    // ── Storage ────────────────────────────────────────────
    mapping(uint64 => ComputeNode) public nodes;
    mapping(address => uint64[]) public providerNodes;
    uint64 public nodeCount;
    uint256 public totalActiveNodes;
    address public marketplace;
    address public verifier;

    // ── Events ─────────────────────────────────────────────
    event NodeRegistered(uint64 indexed nodeId, address indexed provider, string model, string region);
    event NodeStatusUpdated(uint64 indexed nodeId, NodeStatus newStatus);
    event NodeHeartbeat(uint64 indexed nodeId, uint64 timestamp);
    event NodeVerified(uint64 indexed nodeId, address indexed verifier);
    event NodeUnverified(uint64 indexed nodeId, address indexed verifier);
    event RevenueUpdated(uint64 indexed nodeId, uint96 newTotal);
    event MarketplaceSet(address indexed marketplace);
    event VerifierSet(address indexed verifier);

    // ── Modifiers ──────────────────────────────────────────
    modifier onlyProvider(uint64 nodeId) {
        if (nodes[nodeId].provider != msg.sender) revert NotNodeProvider(nodeId);
        _;
    }

    modifier nodeExists(uint64 nodeId) {
        if (nodes[nodeId].provider == address(0)) revert NodeNotFound(nodeId);
        _;
    }

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert NotMarketplace();
        _;
    }

    modifier onlyVerifier() {
        if (msg.sender != verifier && msg.sender != owner()) revert NotVerifier();
        _;
    }

    constructor() Ownable(msg.sender) {
        verifier = msg.sender;
        emit VerifierSet(msg.sender);
    }

    // ── Register ───────────────────────────────────────────

    /**
     * @notice Register a compute node owned by the caller.
     * @dev `vramGB` may be zero: the setup flow offers a "CPU Only" tier whose
     *      hardware probe reports no dedicated VRAM.
     * @param model GPU model name, must match a PriceOracle benchmark to be leasable.
     * @param vramGB Dedicated video memory in GB, zero for CPU-only nodes.
     * @param tflops Benchmarked throughput in TFLOPS.
     * @param region Geographic region tag, e.g. "eu-central".
     * @return nodeId The freshly minted node identifier.
     */
    function registerNode(string calldata model, uint16 vramGB, uint16 tflops, string calldata region)
        external
        returns (uint64 nodeId)
    {
        if (bytes(model).length == 0) revert ModelRequired();

        nodeId = uint64(
            bytes8(
                keccak256(abi.encodePacked(msg.sender, model, vramGB, tflops, region, block.timestamp, block.number))
            )
        );

        if (nodes[nodeId].provider != address(0)) revert NodeAlreadyExists(nodeId);

        nodes[nodeId] = ComputeNode({
            provider: msg.sender,
            specs: GpuSpecs(model, vramGB, tflops, region),
            status: NodeStatus.Inactive,
            totalRevenue: 0,
            registeredAt: uint64(block.timestamp),
            lastHeartbeat: uint64(block.timestamp),
            verified: false
        });
        providerNodes[msg.sender].push(nodeId);
        nodeCount++;

        emit NodeRegistered(nodeId, msg.sender, model, region);
    }

    /**
     * @notice Update a node's availability. Only the node's provider may call.
     * @param nodeId Node identifier.
     * @param newStatus The new availability state.
     */
    function updateStatus(uint64 nodeId, NodeStatus newStatus) external nodeExists(nodeId) onlyProvider(nodeId) {
        NodeStatus old = nodes[nodeId].status;
        nodes[nodeId].status = newStatus;
        nodes[nodeId].lastHeartbeat = uint64(block.timestamp);
        if (old != NodeStatus.Active && newStatus == NodeStatus.Active) totalActiveNodes++;
        else if (old == NodeStatus.Active && newStatus != NodeStatus.Active) totalActiveNodes--;
        emit NodeStatusUpdated(nodeId, newStatus);
    }

    /**
     * @notice Refresh a node's liveness timestamp. Only the node's provider may call.
     * @param nodeId Node identifier.
     */
    function heartbeat(uint64 nodeId) external nodeExists(nodeId) onlyProvider(nodeId) {
        nodes[nodeId].lastHeartbeat = uint64(block.timestamp);
        emit NodeHeartbeat(nodeId, uint64(block.timestamp));
    }

    // ── Attestation ────────────────────────────────────────

    /**
     * @notice Attest that a node's declared hardware matches reality.
     * @param nodeId Node identifier.
     */
    function verifyNode(uint64 nodeId) external nodeExists(nodeId) onlyVerifier {
        nodes[nodeId].verified = true;
        emit NodeVerified(nodeId, msg.sender);
    }

    /**
     * @notice Revoke a node's attestation, blocking new leases and CIF deposits.
     * @param nodeId Node identifier.
     */
    function unverifyNode(uint64 nodeId) external nodeExists(nodeId) onlyVerifier {
        nodes[nodeId].verified = false;
        emit NodeUnverified(nodeId, msg.sender);
    }

    // ── Admin ──────────────────────────────────────────────

    /**
     * @notice Rotate the attestation key.
     * @param newVerifier Address allowed to verify and unverify nodes.
     */
    function setVerifier(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) revert ZeroAddress();
        verifier = newVerifier;
        emit VerifierSet(newVerifier);
    }

    /**
     * @notice Point the registry at the marketplace allowed to book revenue.
     * @param newMarketplace ComputeMarketplace address.
     */
    function setMarketplace(address newMarketplace) external onlyOwner {
        if (newMarketplace == address(0)) revert ZeroAddress();
        marketplace = newMarketplace;
        emit MarketplaceSet(newMarketplace);
    }

    /**
     * @notice Credit settled compute revenue to a node.
     * @param nodeId Node identifier.
     * @param amount Revenue in wei.
     */
    function addRevenue(uint64 nodeId, uint96 amount) external nodeExists(nodeId) onlyMarketplace {
        nodes[nodeId].totalRevenue += amount;
        emit RevenueUpdated(nodeId, nodes[nodeId].totalRevenue);
    }

    // ── Views ──────────────────────────────────────────────

    /**
     * @notice Read a registered node.
     * @param nodeId Node identifier.
     * @return The full node record.
     */
    function getNode(uint64 nodeId) external view nodeExists(nodeId) returns (ComputeNode memory) {
        return nodes[nodeId];
    }

    /**
     * @notice List every node registered by a provider.
     * @param provider Provider address.
     * @return Node identifiers in registration order.
     */
    function getProviderNodes(address provider) external view returns (uint64[] memory) {
        return providerNodes[provider];
    }

    /**
     * @notice Sum settled revenue across all of a provider's nodes.
     * @param provider Provider address.
     * @return total Lifetime revenue in wei.
     */
    function getProviderRevenue(address provider) external view returns (uint96 total) {
        uint64[] memory ids = providerNodes[provider];
        for (uint256 i = 0; i < ids.length; i++) total += nodes[ids[i]].totalRevenue;
    }
}
