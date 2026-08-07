// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ComputeIndexToken (CIF)
 * @notice ERC20 token representing fractional ownership of compute revenue
 *         from registered GPU clusters on BOT Chain DePIN network.
 *
 *         Providers deposit BOT revenue → mint CIF tokens.
 *         CIF tokens are tradeable on BDEX.
 *         Holders earn yield from compute jobs.
 *
 *         This is the core RWA primitive — tokenized real-world compute assets.
 */

interface IComputeRegistry {
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

    function getNode(uint256 nodeId) external view returns (ComputeNode memory);
    function addRevenue(uint256 nodeId, uint96 amount) external;
}

interface IPriceOracle {
    function getPrice(string calldata model)
        external
        view
        returns (uint256 pricePerHourWei, uint64 updatedAt, uint16 confidence);
}

contract ComputeIndexToken {
    // ── ERC20 State ────────────────────────────────────────
    string public constant name = "Compute Index Fund";
    string public constant symbol = "CIF";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ── RWA State ──────────────────────────────────────────
    IComputeRegistry public registry;
    IPriceOracle public oracle;

    struct Deposit {
        uint256 nodeId;        // which node backs this deposit
        uint256 amountWei;     // BOT deposited
        uint256 mintedTokens;  // CIF tokens minted
        uint64 depositedAt;
    }

    mapping(address => Deposit[]) public deposits;
    mapping(address => uint256) public totalDeposited;

    // Index tracks — average yield across all deposited nodes
    uint256 public totalValueLocked;   // total BOT deposited
    uint256 public totalNodesBacked;   // unique nodes with deposits

    // ── Events ─────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposited(address indexed provider, uint256 indexed nodeId, uint256 amountWei, uint256 mintedTokens);
    event Withdrawn(address indexed provider, uint256 amountWei, uint256 burnedTokens);

    // ── Constructor ────────────────────────────────────────
    constructor(address _registry, address _oracle) {
        registry = IComputeRegistry(_registry);
        oracle = IPriceOracle(_oracle);
    }

    // ── RWA Functions ──────────────────────────────────────

    /**
     * @notice Provider deposits BOT revenue to mint CIF tokens.
     *         The node must be registered and verified.
     *         Mint amount = deposit * issuanceRatio (based on node revenue & AI valuation).
     * @param nodeId The compute node backing this deposit
     */
    function depositRevenue(uint256 nodeId) external payable returns (uint256 minted) {
        require(msg.value > 0, "Must deposit BOT");

        IComputeRegistry.ComputeNode memory node = registry.getNode(nodeId);
        require(node.provider == msg.sender, "Not the node provider");
        require(node.verified, "Node not verified");

        // Simple minting: 1:1 ratio for MVP (1 BOT = 1 CIF)
        // In production, AI engine determines ratio based on:
        //   - Node historical revenue
        //   - GPU model depreciation
        //   - Market demand
        //   - Risk score
        minted = msg.value;

        _mint(msg.sender, minted);

        deposits[msg.sender].push(Deposit({
            nodeId: nodeId,
            amountWei: msg.value,
            mintedTokens: minted,
            depositedAt: uint64(block.timestamp)
        }));

        totalDeposited[msg.sender] += msg.value;
        totalValueLocked += msg.value;

        emit Deposited(msg.sender, nodeId, msg.value, minted);
    }

    /**
     * @notice Burn CIF tokens to withdraw BOT (minus small withdrawal fee).
     * @param amount Amount of CIF tokens to burn.
     */
    function withdraw(uint256 amount) external returns (uint256 payout) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");

        // 0.5% withdrawal fee (stays in protocol)
        uint256 fee = amount * 50 / 10000;
        payout = amount - fee;

        _burn(msg.sender, amount);

        (bool ok, ) = msg.sender.call{value: payout}("");
        require(ok, "Withdrawal failed");

        totalValueLocked -= payout;

        emit Withdrawn(msg.sender, payout, amount);
    }

    // ── View Functions ─────────────────────────────────────

    function getDeposits(address provider) external view returns (Deposit[] memory) {
        return deposits[provider];
    }

    function getDepositCount(address provider) external view returns (uint256) {
        return deposits[provider].length;
    }

    function getIndexPrice() external view returns (uint256) {
        if (totalSupply == 0) return 0;
        return (totalValueLocked * 1e18) / totalSupply;
    }

    // ── Internal ERC20 ─────────────────────────────────────

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    // ── ERC20 Standard ─────────────────────────────────────

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "Insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    // ── Receive ────────────────────────────────────────────
    receive() external payable {}
}
