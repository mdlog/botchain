// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title PriceOracle
 * @notice AI-managed price feed for compute resources on BOT Chain.
 *         Prices are pushed by an off-chain AI engine (Gemini-powered)
 *         that analyzes supply/demand, hardware benchmarks, and market
 *         conditions to determine fair BOT/hr rates.
 *
 *         This oracle serves as the RWA valuation layer —
 *         without accurate pricing, CIF tokens cannot be fairly valued.
 */
contract PriceOracle {
    // ── Types ──────────────────────────────────────────────
    struct PriceEntry {
        uint256 pricePerHourWei;  // BOT/hr in wei
        uint64 updatedAt;         // block timestamp
        uint16 confidence;        // 0-10000 (bps), AI confidence score
    }

    struct GPUBenchmark {
        string model;         // e.g. "NVIDIA H100"
        uint16 basePriceBps;  // base price multiplier (bps above floor)
        bool supported;
    }

    // ── Storage ────────────────────────────────────────────
    mapping(bytes32 => PriceEntry) public prices;     // gpuModelHash → price
    mapping(bytes32 => GPUBenchmark) public benchmarks;

    address public aiOperator;        // authorized AI engine address
    address public owner;
    uint256 public floorPriceWei;     // minimum BOT/hr (anti-manipulation)

    // ── Events ─────────────────────────────────────────────
    event PriceUpdated(bytes32 indexed modelHash, uint256 pricePerHourWei, uint16 confidence);
    event BenchmarkSet(string model, uint16 basePriceBps);
    event FloorPriceUpdated(uint256 newFloorWei);
    event OperatorChanged(address newOperator);

    // ── Modifiers ──────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == aiOperator || msg.sender == owner, "Not authorized");
        _;
    }

    // ── Constructor ────────────────────────────────────────
    constructor() {
        owner = msg.sender;
        aiOperator = msg.sender;
        floorPriceWei = 0.01 ether; // 0.01 BOT/hr minimum
    }

    // ── Admin Functions ────────────────────────────────────

    function setOperator(address newOperator) external onlyOwner {
        require(newOperator != address(0), "Zero address");
        aiOperator = newOperator;
        emit OperatorChanged(newOperator);
    }

    function setFloorPrice(uint256 _floorWei) external onlyOwner {
        floorPriceWei = _floorWei;
        emit FloorPriceUpdated(_floorWei);
    }

    function setBenchmark(string calldata model, uint16 basePriceBps)
        external
        onlyOwner
    {
        bytes32 hash = keccak256(bytes(model));
        benchmarks[hash] = GPUBenchmark(model, basePriceBps, true);
        emit BenchmarkSet(model, basePriceBps);
    }

    // ── AI Operator Functions ───────────────────────────────

    /**
     * @notice Push a price update from the AI pricing engine.
     * @param model GPU model name (e.g. "NVIDIA H100")
     * @param pricePerHourWei Price in BOT wei per hour
     * @param confidence AI confidence score (0-10000 bps)
     */
    function updatePrice(
        string calldata model,
        uint256 pricePerHourWei,
        uint16 confidence
    ) external onlyOperator {
        require(pricePerHourWei >= floorPriceWei, "Below floor price");
        require(confidence <= 10000, "Confidence > 100%");

        bytes32 hash = keccak256(bytes(model));
        require(benchmarks[hash].supported, "Unsupported GPU model");

        prices[hash] = PriceEntry({
            pricePerHourWei: pricePerHourWei,
            updatedAt: uint64(block.timestamp),
            confidence: confidence
        });

        emit PriceUpdated(hash, pricePerHourWei, confidence);
    }

    /**
     * @notice Batch update prices for multiple GPU models.
     */
    function batchUpdatePrices(
        string[] calldata models,
        uint256[] calldata pricePerHourWeis,
        uint16[] calldata confidences
    ) external onlyOperator {
        require(
            models.length == pricePerHourWeis.length &&
            models.length == confidences.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < models.length; i++) {
            require(pricePerHourWeis[i] >= floorPriceWei, "Below floor");
            bytes32 hash = keccak256(bytes(models[i]));
            require(benchmarks[hash].supported, "Unsupported GPU");

            prices[hash] = PriceEntry({
                pricePerHourWei: pricePerHourWeis[i],
                updatedAt: uint64(block.timestamp),
                confidence: confidences[i]
            });

            emit PriceUpdated(hash, pricePerHourWeis[i], confidences[i]);
        }
    }

    // ── View Functions ─────────────────────────────────────

    function getPrice(string calldata model)
        external
        view
        returns (uint256 pricePerHourWei, uint64 updatedAt, uint16 confidence)
    {
        bytes32 hash = keccak256(bytes(model));
        PriceEntry memory entry = prices[hash];
        require(entry.updatedAt > 0, "No price for this model");
        return (entry.pricePerHourWei, entry.updatedAt, entry.confidence);
    }

    function getPriceByHash(bytes32 hash)
        external
        view
        returns (uint256 pricePerHourWei, uint64 updatedAt, uint16 confidence)
    {
        PriceEntry memory entry = prices[hash];
        require(entry.updatedAt > 0, "No price for this hash");
        return (entry.pricePerHourWei, entry.updatedAt, entry.confidence);
    }

    function isSupported(string calldata model) external view returns (bool) {
        return benchmarks[keccak256(bytes(model))].supported;
    }
}
