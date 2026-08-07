const hre = require("hardhat");

async function main() {
  const deployments = require("../deployments.json");
  const registry = await hre.ethers.getContractAt("ComputeRegistry", deployments.contracts.ComputeRegistry);
  const node = await registry.getNode(1);
  console.log("=== Node #1 ===");
  console.log("Provider:", node.provider);
  console.log("Model:", node.specs.model);
  console.log("VRAM:", node.specs.vramGB.toString(), "GB");
  console.log("TFLOPS:", node.specs.tflops.toString());
  console.log("Region:", node.specs.region);
  console.log("Status:", node.status, "(0=Inactive, 1=Active, 2=Busy, 3=Offline)");
  console.log("TotalRevenue:", hre.ethers.formatEther(node.totalRevenue));
  console.log("Verified:", node.verified);
  console.log("RegisteredAt:", new Date(Number(node.registeredAt) * 1000).toISOString());
  console.log("LastHeartbeat:", new Date(Number(node.lastHeartbeat) * 1000).toISOString());
}

main().catch(console.error);
