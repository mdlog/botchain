import pkg from "hardhat";
const { ethers } = pkg;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BOT");

  // ── 1. Deploy ComputeRegistry ───────────────────────────
  const ComputeRegistry = await ethers.getContractFactory("ComputeRegistry");
  const registry = await ComputeRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("✅ ComputeRegistry deployed:", registryAddr);

  // ── 2. Deploy PriceOracle ───────────────────────────────
  const PriceOracle = await ethers.getContractFactory("PriceOracle");
  const oracle = await PriceOracle.deploy();
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("✅ PriceOracle deployed:", oracleAddr);

  // ── 3. Deploy ComputeMarketplace ───────────────────────
  const ComputeMarketplace = await ethers.getContractFactory("ComputeMarketplace");
  const marketplace = await ComputeMarketplace.deploy(registryAddr, oracleAddr);
  await marketplace.waitForDeployment();
  const marketplaceAddr = await marketplace.getAddress();
  console.log("✅ ComputeMarketplace deployed:", marketplaceAddr);

  // ── 4. Deploy ComputeIndexToken (CIF) ──────────────────
  const ComputeIndexToken = await ethers.getContractFactory("ComputeIndexToken");
  const cif = await ComputeIndexToken.deploy(registryAddr, oracleAddr);
  await cif.waitForDeployment();
  const cifAddr = await cif.getAddress();
  console.log("✅ ComputeIndexToken (CIF) deployed:", cifAddr);

  // ── 5. Seed PriceOracle with GPU benchmarks ─────────────
  const tx1 = await oracle.setBenchmark("NVIDIA H100", 50000);
  await tx1.wait();
  const tx2 = await oracle.setBenchmark("NVIDIA A100", 30000);
  await tx2.wait();
  const tx3 = await oracle.setBenchmark("NVIDIA RTX 4090", 15000);
  await tx3.wait();
  const tx4 = await oracle.setBenchmark("NVIDIA RTX 3090", 8000);
  await tx4.wait();
  console.log("✅ GPU benchmarks set (H100, A100, RTX 4090, RTX 3090)");

  // ── 6. Seed initial prices (AI will update later) ──────
  const prices = [
    { model: "NVIDIA H100", price: ethers.parseEther("3.10"), confidence: 8500 },
    { model: "NVIDIA A100", price: ethers.parseEther("1.80"), confidence: 8800 },
    { model: "NVIDIA RTX 4090", price: ethers.parseEther("0.85"), confidence: 9200 },
    { model: "NVIDIA RTX 3090", price: ethers.parseEther("0.45"), confidence: 9000 },
  ];

  for (const p of prices) {
    const tx = await oracle.updatePrice(p.model, p.price, p.confidence);
    await tx.wait();
    console.log(`  → ${p.model}: ${ethers.formatEther(p.price)} BOT/hr (conf: ${p.confidence / 100}%)`);
  }
  console.log("✅ Initial prices seeded");

  // ── Summary ─────────────────────────────────────────────
  console.log("\n═════════════════════════════════════════════");
  console.log("  DEPLOYMENT SUMMARY");
  console.log("═════════════════════════════════════════════");
  console.log(`  ComputeRegistry:    ${registryAddr}`);
  console.log(`  PriceOracle:        ${oracleAddr}`);
  console.log(`  ComputeMarketplace: ${marketplaceAddr}`);
  console.log(`  ComputeIndexToken:  ${cifAddr}`);
  console.log("═════════════════════════════════════════════\n");

  // Write addresses to file for frontend
  const fs = require("fs");
  const path = require("path");
  const deploymentPath = path.resolve(__dirname, "../deployments.json");
  fs.writeFileSync(deploymentPath, JSON.stringify({
    network: (await ethers.provider.getNetwork()).chainId.toString(),
    contracts: {
      ComputeRegistry: registryAddr,
      PriceOracle: oracleAddr,
      ComputeMarketplace: marketplaceAddr,
      ComputeIndexToken: cifAddr,
    },
    deployedAt: new Date().toISOString(),
  }, null, 2));
  console.log("Addresses saved to deployments.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
