const hre = require("hardhat");

async function main() {
  const deployments = require("../deployments.json");
  const oracle = await hre.ethers.getContractAt("PriceOracle", deployments.contracts.PriceOracle);

  // Step 1: Add benchmark (must be owner)
  const benchTx = await oracle.setBenchmark("AMD Radeon GPU", 1200);
  await benchTx.wait();
  console.log("✅ Benchmark set for AMD Radeon GPU");

  // Step 2: Update price (must be operator — owner is operator by default)
  const priceTx = await oracle.updatePrice("AMD Radeon GPU", hre.ethers.parseEther("0.12"), 8500);
  await priceTx.wait();
  console.log("✅ Price set: 0.12 DGRAM/hr, confidence 85%");

  // Verify
  const [price, updatedAt, confidence] = await oracle.getPrice("AMD Radeon GPU");
  console.log("Verify:", hre.ethers.formatEther(price), "DGRAM/hr, confidence:", Number(confidence));
}

main().catch(console.error);
