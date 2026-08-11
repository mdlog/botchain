// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IComputeIndexFund
 * @notice Revenue sink implemented by ComputeIndexToken.
 */
interface IComputeIndexFund {
    /**
     * @notice Add protocol revenue to the index backing without minting new shares.
     */
    function receiveRevenue() external payable;
}
