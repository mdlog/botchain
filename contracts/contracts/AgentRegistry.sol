// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AgentRegistry
 * @notice Maps provider address → compute agent URL.
 *         Providers self-register their agent endpoint after starting
 *         a cloudflared tunnel during setup. Frontend reads this to
 *         route compute execution requests to the correct provider.
 */
contract AgentRegistry {
    mapping(address => string) private agentUrls;
    address public owner;

    event AgentUrlSet(address indexed provider, string url);

    constructor() { owner = msg.sender; }

    /**
     * @notice Set or update the agent URL for the caller (provider).
     * @param url The agent endpoint URL (e.g. https://random.trycloudflare.com)
     */
    function setAgentUrl(string calldata url) external {
        require(bytes(url).length > 0, "URL required");
        agentUrls[msg.sender] = url;
        emit AgentUrlSet(msg.sender, url);
    }

    /**
     * @notice Get the agent URL for a provider.
     */
    function getAgentUrl(address provider) external view returns (string memory) {
        return agentUrls[provider];
    }
}
