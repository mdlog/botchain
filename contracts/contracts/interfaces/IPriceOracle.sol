// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IPriceOracle
 * @notice Read surface of the AI-managed compute price feed.
 */
interface IPriceOracle {
    /**
     * @notice Latest quote for a GPU model.
     * @param model GPU model name, e.g. "NVIDIA H100".
     * @return pricePerHourWei Quoted rate in wei per hour.
     * @return updatedAt Block timestamp of the last push, used by callers to reject stale quotes.
     * @return confidence AI confidence score in bps (0-10000).
     */
    function getPrice(string calldata model)
        external
        view
        returns (uint256 pricePerHourWei, uint64 updatedAt, uint16 confidence);
}
