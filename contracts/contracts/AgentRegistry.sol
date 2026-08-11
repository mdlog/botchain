// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title AgentRegistry
 * @notice Maps provider address → compute agent URL.
 *         Providers self-register their agent endpoint after starting
 *         a cloudflared tunnel during setup. The frontend reads this to
 *         route compute execution requests to the correct provider.
 * @dev The stored string is fetched by browsers, so the scheme is constrained
 *      on-chain: an http:// or javascript: endpoint would either break the app's
 *      mixed-content policy or turn the registry into an injection vector.
 */
contract AgentRegistry {
    // ── Errors ─────────────────────────────────────────────
    error InvalidUrlLength(uint256 length);
    error InvalidUrlScheme();

    // ── Constants ──────────────────────────────────────────

    /// @dev Long enough to hold the mandatory "https://" scheme, short enough
    ///      that a provider cannot park unbounded calldata in registry storage.
    uint256 public constant MIN_URL_LENGTH = 8;
    uint256 public constant MAX_URL_LENGTH = 256;

    // ── Storage ────────────────────────────────────────────
    mapping(address => string) private agentUrls;

    // ── Events ─────────────────────────────────────────────
    event AgentUrlSet(address indexed provider, string url);

    /**
     * @notice Set or update the agent URL for the caller (provider).
     * @param url The agent endpoint URL, e.g. https://random.trycloudflare.com.
     */
    function setAgentUrl(string calldata url) external {
        bytes calldata raw = bytes(url);
        if (raw.length < MIN_URL_LENGTH || raw.length > MAX_URL_LENGTH) revert InvalidUrlLength(raw.length);
        if (bytes8(raw[:8]) != bytes8("https://")) revert InvalidUrlScheme();

        agentUrls[msg.sender] = url;
        emit AgentUrlSet(msg.sender, url);
    }

    /**
     * @notice Get the agent URL for a provider.
     * @param provider Provider address.
     * @return The registered endpoint, or the empty string if none.
     */
    function getAgentUrl(address provider) external view returns (string memory) {
        return agentUrls[provider];
    }
}
