import pkg from "hardhat";
const { ethers } = pkg;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying AgentRegistry with account:", deployer.address);

  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const registry = await AgentRegistry.deploy();
  await registry.waitForDeployment();
  const addr = await registry.getAddress();
  console.log("✅ AgentRegistry deployed:", addr);

  // Write to deployments.json (merge existing)
  const fs = require("fs");
  const path = require("path");
  const deploymentPath = path.resolve(__dirname, "../deployments.json");
  let existing: any = {};
  if (fs.existsSync(deploymentPath)) {
    existing = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  }
  existing.contracts = { ...(existing.contracts || {}), AgentRegistry: addr };
  existing.deployedAt = new Date().toISOString();
  fs.writeFileSync(deploymentPath, JSON.stringify(existing, null, 2));
  console.log("Updated deployments.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
