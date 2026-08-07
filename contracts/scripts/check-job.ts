const hre = require("hardhat");

async function main() {
  const deployments = require("../deployments.json");
  const marketplace = await hre.ethers.getContractAt("ComputeMarketplace", deployments.contracts.ComputeMarketplace);
  const registry = await hre.ethers.getContractAt("ComputeRegistry", deployments.contracts.ComputeRegistry);

  // Check job #1
  const job = await marketplace.getJob(1);
  console.log("=== Job #1 ===");
  console.log("Node ID:", job.nodeId.toString());
  console.log("Consumer:", job.consumer);
  console.log("Provider:", job.provider);
  console.log("Job Type:", job.jobType);
  console.log("Price/hr:", hre.ethers.formatEther(job.pricePerHourWei), "DGRAM");
  console.log("Duration:", job.durationHours.toString(), "hours");
  console.log("Status:", job.status, "(0=Pending, 1=Active, 2=Completed, 3=Cancelled)");
  console.log("StartedAt:", Number(job.startedAt) > 0 ? new Date(Number(job.startedAt) * 1000).toISOString() : "—");
  console.log("CompletedAt:", Number(job.completedAt) > 0 ? new Date(Number(job.completedAt) * 1000).toISOString() : "—");

  // Check total volume
  const volume = await marketplace.totalVolumeWei();
  console.log("\nTotal Volume:", hre.ethers.formatEther(volume), "DGRAM");
  const totalJobs = await marketplace.totalJobs();
  console.log("Total Jobs:", totalJobs.toString());

  // Check node revenue
  const node = await registry.getNode(1);
  console.log("\n=== Node #1 After Job ===");
  console.log("Total Revenue:", hre.ethers.formatEther(node.totalRevenue), "DGRAM");
  console.log("Status:", node.status);
}

main().catch(console.error);
