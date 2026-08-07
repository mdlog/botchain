// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ComputeRegistry
 * @notice Registers GPU compute nodes on BOT Chain DePIN network.
 *         Stores hardware specs, status, and provider info.
 *         This is the RWA attestation layer — each registered node
 *         represents a real physical compute asset.
 */
contract ComputeRegistry {
    // ── Types ──────────────────────────────────────────────
    enum NodeStatus {
        Inactive,   // 0 — registered but not active
        Active,     // 1 — online and accepting jobs
        Busy,       // 2 — online but fully allocated
        Offline     // 3 — disconnected
    }

    struct GpuSpecs {
        string model;          // e.g. "NVIDIA H100"
        uint16 vramGB;         // e.g. 80
        uint16 tflops;         // theoretical TFLOPS
        string region;         // e.g. "US-EAST"
    }

    struct ComputeNode {
        address provider;      // who owns this hardware
        GpuSpecs specs;        // hardware details
        NodeStatus status;     // current availability
        uint96 totalRevenue;   // lifetime BOT earned (in wei)
        uint64 registeredAt;   // block timestamp
        uint64 lastHeartbeat;  // last status update
        bool verified;         // verified by protocol
    }

    // ── Storage ────────────────────────────────────────────
    mapping(uint256 => ComputeNode) public nodes;
    mapping(address => uint256[]) public providerNodes;
    uint256 public nextNodeId = 1;
    uint256 public totalActiveNodes;

    // ── Events ─────────────────────────────────────────────
    event NodeRegistered(uint256 indexed nodeId, address indexed provider, string model, string region);
    event NodeStatusUpdated(uint256 indexed nodeId, NodeStatus newStatus);
    event NodeVerified(uint256 indexed nodeId);
    event RevenueUpdated(uint256 indexed nodeId, uint96 newTotal);

    // ── Modifiers ──────────────────────────────────────────
    modifier onlyProvider(uint256 nodeId) {
        require(nodes[nodeId].provider == msg.sender, "Not the provider");
        _;
    }

    modifier nodeExists(uint256 nodeId) {
        require(nodeId > 0 && nodeId < nextNodeId, "Node does not exist");
        _;
    }

    // ── External Functions ─────────────────────────────────

    /**
     * @notice Register a new compute node. Caller becomes the provider.
     * @param model GPU model name
     * @param vramGB VRAM in GB
     * @param tflops Theoretical TFLOPS
     * @param region Geographic region code
     */
    function registerNode(
        string calldata model,
        uint16 vramGB,
        uint16 tflops,
        string calldata region
    ) external returns (uint256 nodeId) {
        require(bytes(model).length > 0, "Model required");
        require(vramGB > 0, "VRAM required");

        nodeId = nextNodeId++;
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

        emit NodeRegistered(nodeId, msg.sender, model, region);
    }

    /**
     * @notice Update node status (provider only).
     */
    function updateStatus(uint256 nodeId, NodeStatus newStatus)
        external
        nodeExists(nodeId)
        onlyProvider(nodeId)
    {
        NodeStatus old = nodes[nodeId].status;
        nodes[nodeId].status = newStatus;
        nodes[nodeId].lastHeartbeat = uint64(block.timestamp);

        if (old != NodeStatus.Active && newStatus == NodeStatus.Active) {
            totalActiveNodes++;
        } else if (old == NodeStatus.Active && newStatus != NodeStatus.Active) {
            totalActiveNodes--;
        }

        emit NodeStatusUpdated(nodeId, newStatus);
    }

    /**
     * @notice Heartbeat — provider confirms node is still alive.
     */
    function heartbeat(uint256 nodeId)
        external
        nodeExists(nodeId)
        onlyProvider(nodeId)
    {
        nodes[nodeId].lastHeartbeat = uint64(block.timestamp);
    }

    /**
     * @notice Protocol owner verifies a node (attestation).
     */
    function verifyNode(uint256 nodeId) external nodeExists(nodeId) {
        // In MVP, anyone can verify — in production, restricted to attestors
        nodes[nodeId].verified = true;
        emit NodeVerified(nodeId);
    }

    /**
     * @notice Add revenue to a node (called by marketplace on job settlement).
     */
    function addRevenue(uint256 nodeId, uint96 amount)
        external
        nodeExists(nodeId)
    {
        // In production, restricted to Marketplace contract
        nodes[nodeId].totalRevenue += amount;
        emit RevenueUpdated(nodeId, nodes[nodeId].totalRevenue);
    }

    // ── View Functions ─────────────────────────────────────

    function getNode(uint256 nodeId)
        external
        view
        nodeExists(nodeId)
        returns (ComputeNode memory)
    {
        return nodes[nodeId];
    }

    function getProviderNodes(address provider)
        external
        view
        returns (uint256[] memory)
    {
        return providerNodes[provider];
    }

    function getProviderRevenue(address provider)
        external
        view
        returns (uint96 total)
    {
        uint256[] memory ids = providerNodes[provider];
        for (uint256 i = 0; i < ids.length; i++) {
            total += nodes[ids[i]].totalRevenue;
        }
    }
}
