const hre = require("hardhat");

async function main() {
  const deployments = require("../deployments.json");
  const registry = await hre.ethers.getContractAt("ComputeRegistry", deployments.contracts.ComputeRegistry);
  const next = await registry.nextNodeId();
  console.log("Total nodes:", Number(next) - 1);
  for (let i = 1; i < Number(next); i++) {
    const node = await registry.getNode(i);
    const status = ["Inactive","Active","Busy","Offline"][Number(node.status)];
    console.log("---");
    console.log(`Node #${i}:`);
    console.log("  Provider:", node.provider);
    console.log("  Model:", node.specs.model);
    console.log("  VRAM:", Number(node.specs.vramGB), "GB");
    console.log("  TFLOPS:", Number(node.specs.tflops));
    console.log("  Region:", node.specs.region);
    console.log("  Status:", status);
    console.log("  Verified:", node.verified);
    console.log("  Revenue:", hre.ethers.formatEther(node.totalRevenue), "DGRAM");
    console.log("  Registered:", new Date(Number(node.registeredAt) * 1000).toISOString());
  }
}
main().catch(console.error);
