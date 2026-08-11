// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IPriceOracle} from "./interfaces/IPriceOracle.sol";

/**
 * @title PriceOracle
 * @notice AI-managed price feed for compute resources on BOT Chain.
 *         Prices are pushed by an off-chain AI engine that analyzes supply/demand,
 *         hardware benchmarks and market conditions to determine fair BOT/hr rates.
 *
 *         This oracle is the RWA valuation layer — without accurate pricing,
 *         CIF shares cannot be fairly valued.
 * @dev Pushed quotes are clamped between `floorPriceWei` and `maxPriceWei`. The
 *      ceiling matters more than the floor: the marketplace escrows
 *      price * hours up front, so an unbounded quote from a compromised operator
 *      would let a single lease drain a consumer's whole balance.
 */
contract PriceOracle is IPriceOracle, Ownable {
    // ── Errors ─────────────────────────────────────────────
    error ArrayLengthMismatch();
    error BelowFloorPrice(uint256 pricePerHourWei, uint256 floorPriceWei);
    error AboveMaxPrice(uint256 pricePerHourWei, uint256 maxPriceWei);
    error ConfidenceOutOfRange(uint16 confidence);
    error InvalidPriceBounds(uint256 floorPriceWei, uint256 maxPriceWei);
    error NoPriceForModel();
    error NotOperator();
    error UnsupportedModel();
    error ZeroAddress();

    // ── Types ──────────────────────────────────────────────
    struct PriceEntry {
        uint256 pricePerHourWei; // BOT/hr in wei
        uint64 updatedAt; // block timestamp
        uint16 confidence; // 0-10000 (bps), AI confidence score
    }

    struct GPUBenchmark {
        string model; // e.g. "NVIDIA H100"
        uint16 basePriceBps; // base price multiplier (bps above floor)
        bool supported;
    }

    // ── Storage ────────────────────────────────────────────
    mapping(bytes32 => PriceEntry) public prices; // gpuModelHash → price
    mapping(bytes32 => GPUBenchmark) public benchmarks;

    address public aiOperator; // authorized AI engine address
    uint256 public floorPriceWei; // minimum BOT/hr (anti-manipulation)
    uint256 public maxPriceWei; // maximum BOT/hr (anti-manipulation)

    // ── Events ─────────────────────────────────────────────
    event PriceUpdated(bytes32 indexed modelHash, uint256 pricePerHourWei, uint16 confidence);
    event BenchmarkSet(string model, uint16 basePriceBps);
    event FloorPriceUpdated(uint256 newFloorWei);
    event MaxPriceUpdated(uint256 newMaxWei);
    event OperatorChanged(address indexed newOperator);

    // ── Modifiers ──────────────────────────────────────────
    modifier onlyOperator() {
        if (msg.sender != aiOperator && msg.sender != owner()) revert NotOperator();
        _;
    }

    constructor() Ownable(msg.sender) {
        aiOperator = msg.sender;
        floorPriceWei = 0.01 ether; // 0.01 BOT/hr minimum
        maxPriceWei = 100 ether; // 100 BOT/hr ceiling, ~30x the seeded H100 rate
        emit OperatorChanged(msg.sender);
        emit FloorPriceUpdated(floorPriceWei);
        emit MaxPriceUpdated(maxPriceWei);
    }

    // ── Admin Functions ────────────────────────────────────

    /**
     * @notice Rotate the address allowed to push prices.
     * @param newOperator The AI pricing engine's key.
     */
    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        aiOperator = newOperator;
        emit OperatorChanged(newOperator);
    }

    /**
     * @notice Set the minimum accepted quote.
     * @param floorWei New floor in wei per hour.
     */
    function setFloorPrice(uint256 floorWei) external onlyOwner {
        if (floorWei > maxPriceWei) revert InvalidPriceBounds(floorWei, maxPriceWei);
        floorPriceWei = floorWei;
        emit FloorPriceUpdated(floorWei);
    }

    /**
     * @notice Set the maximum accepted quote.
     * @param maxWei New ceiling in wei per hour.
     */
    function setMaxPrice(uint256 maxWei) external onlyOwner {
        if (maxWei < floorPriceWei) revert InvalidPriceBounds(floorPriceWei, maxWei);
        maxPriceWei = maxWei;
        emit MaxPriceUpdated(maxWei);
    }

    /**
     * @notice Whitelist a GPU model and record its benchmark weighting.
     * @param model GPU model name.
     * @param basePriceBps Base price multiplier in bps above the floor.
     */
    function setBenchmark(string calldata model, uint16 basePriceBps) external onlyOwner {
        bytes32 hash = keccak256(bytes(model));
        benchmarks[hash] = GPUBenchmark(model, basePriceBps, true);
        emit BenchmarkSet(model, basePriceBps);
    }

    // ── AI Operator Functions ───────────────────────────────

    /**
     * @notice Push a price update from the AI pricing engine.
     * @param model GPU model name (e.g. "NVIDIA H100").
     * @param pricePerHourWei Price in BOT wei per hour.
     * @param confidence AI confidence score (0-10000 bps).
     */
    function updatePrice(string calldata model, uint256 pricePerHourWei, uint16 confidence) external onlyOperator {
        _store(keccak256(bytes(model)), pricePerHourWei, confidence);
    }

    /**
     * @notice Batch update prices for multiple GPU models.
     * @param models GPU model names.
     * @param pricePerHourWeis Prices in BOT wei per hour, index-aligned with `models`.
     * @param confidences AI confidence scores in bps, index-aligned with `models`.
     */
    function batchUpdatePrices(
        string[] calldata models,
        uint256[] calldata pricePerHourWeis,
        uint16[] calldata confidences
    ) external onlyOperator {
        if (models.length != pricePerHourWeis.length || models.length != confidences.length) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i = 0; i < models.length; i++) {
            _store(keccak256(bytes(models[i])), pricePerHourWeis[i], confidences[i]);
        }
    }

    // ── View Functions ─────────────────────────────────────

    /**
     * @notice Latest quote for a GPU model.
     * @param model GPU model name.
     * @return pricePerHourWei Quoted rate in wei per hour.
     * @return updatedAt Block timestamp of the last push.
     * @return confidence AI confidence score in bps.
     */
    function getPrice(string calldata model)
        external
        view
        returns (uint256 pricePerHourWei, uint64 updatedAt, uint16 confidence)
    {
        return _read(keccak256(bytes(model)));
    }

    /**
     * @notice Latest quote addressed by keccak256 of the model name.
     * @param hash keccak256 of the GPU model name.
     * @return pricePerHourWei Quoted rate in wei per hour.
     * @return updatedAt Block timestamp of the last push.
     * @return confidence AI confidence score in bps.
     */
    function getPriceByHash(bytes32 hash)
        external
        view
        returns (uint256 pricePerHourWei, uint64 updatedAt, uint16 confidence)
    {
        return _read(hash);
    }

    /**
     * @notice Whether a GPU model has been whitelisted.
     * @param model GPU model name.
     * @return True when the model can receive price pushes.
     */
    function isSupported(string calldata model) external view returns (bool) {
        return benchmarks[keccak256(bytes(model))].supported;
    }

    // ── Internal ───────────────────────────────────────────

    function _store(bytes32 hash, uint256 pricePerHourWei, uint16 confidence) internal {
        if (!benchmarks[hash].supported) revert UnsupportedModel();
        if (pricePerHourWei < floorPriceWei) revert BelowFloorPrice(pricePerHourWei, floorPriceWei);
        if (pricePerHourWei > maxPriceWei) revert AboveMaxPrice(pricePerHourWei, maxPriceWei);
        if (confidence > 10_000) revert ConfidenceOutOfRange(confidence);

        prices[hash] =
            PriceEntry({pricePerHourWei: pricePerHourWei, updatedAt: uint64(block.timestamp), confidence: confidence});

        emit PriceUpdated(hash, pricePerHourWei, confidence);
    }

    function _read(bytes32 hash)
        internal
        view
        returns (uint256 pricePerHourWei, uint64 updatedAt, uint16 confidence)
    {
        PriceEntry memory entry = prices[hash];
        if (entry.updatedAt == 0) revert NoPriceForModel();
        return (entry.pricePerHourWei, entry.updatedAt, entry.confidence);
    }
}
