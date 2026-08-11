// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IComputeIndexFund} from "./interfaces/IComputeIndexFund.sol";
import {IComputeRegistry} from "./interfaces/IComputeRegistry.sol";

/**
 * @title ComputeIndexToken (CIF)
 * @notice ERC20 share of the revenue produced by verified GPU clusters on the
 *         BOT Chain DePIN network — the project's core RWA primitive.
 *
 *         Providers deposit revenue their node has actually settled and receive
 *         CIF at the current index price. The marketplace routes a protocol cut
 *         of every settlement into the same backing pool without minting, which
 *         is what makes a share worth more than the BOT that created it.
 * @dev Deposits are capped at the node's on-chain `totalRevenue` so shares can
 *      only ever be created against compute work the marketplace has settled;
 *      minting freely from faucet balance would make the index a token sale.
 */
contract ComputeIndexToken is IComputeIndexFund, ERC20, Ownable, ReentrancyGuard {
    // ── Errors ─────────────────────────────────────────────
    error ExceedsSettledRevenue(uint256 settledRevenue, uint256 requested);
    error InsufficientShares(uint256 balance, uint256 requested);
    error NoFeesToSweep();
    error NodeNotVerified();
    error NotMarketplace();
    error NotNodeProvider();
    error TransferFailed();
    error ZeroAddress();
    error ZeroAmount();

    // ── Types ──────────────────────────────────────────────
    struct Deposit {
        uint64 nodeId; // which node backs this deposit
        uint256 amountWei; // BOT deposited
        uint256 mintedTokens; // CIF shares minted
        uint64 depositedAt;
    }

    // ── Constants ──────────────────────────────────────────

    /// @dev 0.5% redemption fee, retained for the protocol treasury.
    uint16 public constant WITHDRAW_FEE_BPS = 50;

    // ── Storage ────────────────────────────────────────────
    IComputeRegistry public immutable registry;

    address public marketplace;

    mapping(address => Deposit[]) public deposits;
    mapping(address => uint256) public totalDeposited;
    mapping(uint64 => uint256) public depositedPerNode;

    uint256 public totalValueLocked; // BOT backing the outstanding shares
    uint256 public accruedFees; // redemption fees, not part of the backing
    uint256 public totalNodesBacked; // unique nodes with at least one deposit

    // ── Events ─────────────────────────────────────────────
    event Deposited(address indexed provider, uint64 indexed nodeId, uint256 amountWei, uint256 mintedTokens);
    event Withdrawn(address indexed holder, uint256 amountWei, uint256 burnedTokens, uint256 feeWei);
    event RevenueReceived(address indexed from, uint256 amountWei);
    event FeesSwept(address indexed to, uint256 amountWei);
    event MarketplaceSet(address indexed marketplace);

    // ── Constructor ────────────────────────────────────────
    constructor(address registry_) ERC20("Compute Index Fund", "CIF") Ownable(msg.sender) {
        if (registry_ == address(0)) revert ZeroAddress();
        registry = IComputeRegistry(registry_);
    }

    // ── RWA Functions ──────────────────────────────────────

    /**
     * @notice Deposit revenue a verified node has already settled and mint CIF.
     * @dev Shares are minted at the live index price, so a deposit made after the
     *      fund has appreciated does not dilute existing holders.
     * @param nodeId The compute node backing this deposit.
     * @return minted CIF shares issued to the caller.
     */
    function depositRevenue(uint64 nodeId) external payable nonReentrant returns (uint256 minted) {
        if (msg.value == 0) revert ZeroAmount();

        IComputeRegistry.ComputeNode memory node = registry.getNode(nodeId);
        if (node.provider != msg.sender) revert NotNodeProvider();
        if (!node.verified) revert NodeNotVerified();

        uint256 depositedForNode = depositedPerNode[nodeId];
        uint256 newTotal = depositedForNode + msg.value;
        if (newTotal > node.totalRevenue) revert ExceedsSettledRevenue(node.totalRevenue, newTotal);

        uint256 supply = totalSupply();
        uint256 backing = totalValueLocked;
        minted = (supply == 0 || backing == 0) ? msg.value : (msg.value * supply) / backing;

        if (depositedForNode == 0) totalNodesBacked++;
        depositedPerNode[nodeId] = newTotal;
        totalDeposited[msg.sender] += msg.value;
        totalValueLocked = backing + msg.value;

        deposits[msg.sender].push(
            Deposit({nodeId: nodeId, amountWei: msg.value, mintedTokens: minted, depositedAt: uint64(block.timestamp)})
        );

        _mint(msg.sender, minted);

        emit Deposited(msg.sender, nodeId, msg.value, minted);
    }

    /**
     * @notice Burn CIF shares and redeem the backing they represent, less the fee.
     * @param amount CIF shares to burn.
     * @return payout BOT paid to the caller in wei.
     */
    function withdraw(uint256 amount) external nonReentrant returns (uint256 payout) {
        if (amount == 0) revert ZeroAmount();
        uint256 balance = balanceOf(msg.sender);
        if (balance < amount) revert InsufficientShares(balance, amount);

        uint256 gross = (amount * totalValueLocked) / totalSupply();
        uint256 fee = (gross * WITHDRAW_FEE_BPS) / 10_000;
        payout = gross - fee;

        _burn(msg.sender, amount);
        totalValueLocked -= gross;
        accruedFees += fee;

        (bool ok,) = msg.sender.call{value: payout}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, payout, amount, fee);
    }

    /**
     * @notice Add protocol revenue to the index backing without minting new shares.
     * @dev This is the only path that moves getIndexPrice() above par; deposits
     *      mint at price and therefore leave it unchanged.
     */
    function receiveRevenue() external payable {
        if (msg.sender != marketplace) revert NotMarketplace();
        if (msg.value == 0) revert ZeroAmount();

        totalValueLocked += msg.value;

        emit RevenueReceived(msg.sender, msg.value);
    }

    // ── Admin ──────────────────────────────────────────────

    /**
     * @notice Authorize the marketplace allowed to push protocol revenue.
     * @param newMarketplace ComputeMarketplace address.
     */
    function setMarketplace(address newMarketplace) external onlyOwner {
        if (newMarketplace == address(0)) revert ZeroAddress();
        marketplace = newMarketplace;
        emit MarketplaceSet(newMarketplace);
    }

    /**
     * @notice Sweep accumulated redemption fees to the protocol treasury.
     * @param to Recipient of the fees.
     * @return amount Wei swept.
     */
    function sweepFees(address to) external onlyOwner nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        amount = accruedFees;
        if (amount == 0) revert NoFeesToSweep();
        accruedFees = 0;

        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit FeesSwept(to, amount);
    }

    // ── View Functions ─────────────────────────────────────

    /**
     * @notice Every deposit a provider has made.
     * @param provider Provider address.
     * @return The provider's deposit history.
     */
    function getDeposits(address provider) external view returns (Deposit[] memory) {
        return deposits[provider];
    }

    /**
     * @notice Number of deposits a provider has made.
     * @param provider Provider address.
     * @return Deposit count.
     */
    function getDepositCount(address provider) external view returns (uint256) {
        return deposits[provider].length;
    }

    /**
     * @notice BOT backing one CIF share, scaled by 1e18.
     * @return Index price; par (1e18) while no shares are outstanding.
     */
    function getIndexPrice() external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e18;
        return (totalValueLocked * 1e18) / supply;
    }
}
