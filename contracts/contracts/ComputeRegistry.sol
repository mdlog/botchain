// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ComputeRegistry
 * @notice Registers GPU compute nodes on BOT Chain DePIN network.
 *         Node IDs are uint64 derived from keccak256 hash (8 bytes),
 *         giving short unique IDs like 0xa1b2c3d4e5f6a7b8.
 */
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

    // ── Storage ────────────────────────────────────────────
    mapping(uint64 => ComputeNode) public nodes;
    mapping(address => uint64[]) public providerNodes;
    uint64 public nodeCount;
    address public owner;
    uint256 public totalActiveNodes;
    address public marketplace;

    // ── Events ─────────────────────────────────────────────
    event NodeRegistered(uint64 indexed nodeId, address indexed provider, string model, string region);
    event NodeStatusUpdated(uint64 indexed nodeId, NodeStatus newStatus);
    event NodeVerified(uint64 indexed nodeId);
    event RevenueUpdated(uint64 indexed nodeId, uint96 newTotal);
    event MarketplaceSet(address marketplace);

    // ── Modifiers ──────────────────────────────────────────
    modifier onlyProvider(uint64 nodeId) {
        require(nodes[nodeId].provider == msg.sender, "Not the provider");
        _;
    }

    modifier nodeExists(uint64 nodeId) {
        require(nodes[nodeId].provider != address(0), "Node does not exist");
        _;
    }

    modifier onlyMarketplace() {
        require(msg.sender == marketplace, "Only marketplace");
        _;
    }

    constructor() { owner = msg.sender; }

    // ── Register ───────────────────────────────────────────
    function registerNode(
        string calldata model,
        uint16 vramGB,
        uint16 tflops,
        string calldata region
    ) external returns (uint64 nodeId) {
        require(bytes(model).length > 0, "Model required");
        require(vramGB > 0, "VRAM required");

        nodeId = uint64(bytes8(keccak256(abi.encodePacked(
            msg.sender, model, vramGB, tflops, region, block.timestamp, block.number
        ))));

        require(nodes[nodeId].provider == address(0), "Node already exists");

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

    function updateStatus(uint64 nodeId, NodeStatus newStatus)
        external nodeExists(nodeId) onlyProvider(nodeId)
    {
        NodeStatus old = nodes[nodeId].status;
        nodes[nodeId].status = newStatus;
        nodes[nodeId].lastHeartbeat = uint64(block.timestamp);
        if (old != NodeStatus.Active && newStatus == NodeStatus.Active) totalActiveNodes++;
        else if (old == NodeStatus.Active && newStatus != NodeStatus.Active) totalActiveNodes--;
        emit NodeStatusUpdated(nodeId, newStatus);
    }

    function heartbeat(uint64 nodeId) external nodeExists(nodeId) onlyProvider(nodeId) {
        nodes[nodeId].lastHeartbeat = uint64(block.timestamp);
    }

    function verifyNode(uint64 nodeId) external nodeExists(nodeId) {
        nodes[nodeId].verified = true;
        emit NodeVerified(nodeId);
    }

    function setMarketplace(address _marketplace) external {
        require(msg.sender == owner || marketplace == address(0), "Not authorized");
        marketplace = _marketplace;
        emit MarketplaceSet(_marketplace);
    }

    function addRevenue(uint64 nodeId, uint96 amount)
        external nodeExists(nodeId) onlyMarketplace
    {
        nodes[nodeId].totalRevenue += amount;
        emit RevenueUpdated(nodeId, nodes[nodeId].totalRevenue);
    }

    // ── Views ──────────────────────────────────────────────
    function getNode(uint64 nodeId) external view nodeExists(nodeId) returns (ComputeNode memory) {
        return nodes[nodeId];
    }

    function getProviderNodes(address provider) external view returns (uint64[] memory) {
        return providerNodes[provider];
    }

    function getProviderRevenue(address provider) external view returns (uint96 total) {
        uint64[] memory ids = providerNodes[provider];
        for (uint256 i = 0; i < ids.length; i++) total += nodes[ids[i]].totalRevenue;
    }
}
