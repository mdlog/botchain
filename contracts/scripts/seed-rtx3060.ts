const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log("Signer:", signer.address);

  const deployments = require("../deployments.json");
  const oracleAddr = deployments.contracts.PriceOracle;
  const oracle = await hre.ethers.getContractAt("PriceOracle", oracleAddr);

  // 1. Add RTX 3060 to benchmark whitelist
  console.log("Adding RTX 3060 to benchmark whitelist...");
  const benchTx = await oracle.setBenchmark("NVIDIA RTX 3060", 1500); // 15% above floor
  await benchTx.wait();
  console.log("✅ Benchmark set for RTX 3060");

  // 2. Verify it's supported
  const supported = await oracle.isSupported("NVIDIA RTX 3060");
  console.log("Supported:", supported);

  // 3. Seed price: 0.15 DGRAM/hr, 85% confidence
  const priceTx = await oracle.updatePrice(
    "NVIDIA RTX 3060",
    hre.ethers.parseEther("0.15"),
    8500
  );
  await priceTx.wait();
  console.log("✅ RTX 3060 price seeded: 0.15 DGRAM/hr (85% confidence)");

  // 4. Verify
  const price = await oracle.getPrice("NVIDIA RTX 3060");
  console.log("Verified on-chain:", hre.ethers.formatEther(price.pricePerHourWei), "DGRAM/hr");
}

main().catch(console.error);
