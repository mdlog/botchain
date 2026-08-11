// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title MockConsumer
 * @notice Test double for a consumer contract that can be toggled to reject
 *         plain value transfers, exercising the marketplace's pull-payment
 *         fallback. Not part of the deployed system.
 */
contract MockConsumer {
    error TransferRejected();
    error ForwardFailed(bytes reason);

    bool public accepting;

    /**
     * @notice Choose whether plain transfers to this contract succeed.
     * @param accepting_ True to accept incoming value.
     */
    function setAccepting(bool accepting_) external {
        accepting = accepting_;
    }

    /**
     * @notice Forward an arbitrary call, so this contract can act as a consumer.
     * @param target Contract to call.
     * @param data ABI-encoded calldata.
     * @return Raw return data.
     */
    function forward(address target, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call{value: msg.value}(data);
        if (!ok) revert ForwardFailed(ret);
        return ret;
    }

    receive() external payable {
        if (!accepting) revert TransferRejected();
    }
}
