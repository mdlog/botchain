// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IComputeRegistry
 * @notice Node bookkeeping surface shared by the marketplace, the index fund and
 *         the off-chain Rust agent.
 * @dev The `ComputeNode` / `GpuSpecs` tuple layout is consumed by the agent's ABI
 *      decoder, so members must never be reordered, resized or removed. Both the
 *      registry and its consumers derive the layout from this single declaration
 *      so the two can never drift apart.
 */
interface IComputeRegistry {
    enum NodeStatus {
        Inactive,
        Active,
        Busy,
        Offline
    }

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

    /**
     * @notice Read a registered node.
     * @param nodeId Node identifier.
     * @return The full node record.
     */
    function getNode(uint64 nodeId) external view returns (ComputeNode memory);

    /**
     * @notice Credit settled compute revenue to a node.
     * @param nodeId Node identifier.
     * @param amount Revenue in wei.
     */
    function addRevenue(uint64 nodeId, uint96 amount) external;
}
