const hre = require("hardhat");

async function main() {
  const deployments = require("../deployments.json");
  const marketplace = await hre.ethers.getContractAt("ComputeMarketplace", deployments.contracts.ComputeMarketplace);
  
  for (let i = 1; i <= 5; i++) {
    try {
      const job = await marketplace.getJob(i);
      const status = ["Pending","Active","Completed","Cancelled","Disputed"][Number(job.status)];
      console.log(`Job #${i}:`);
      console.log("  Node:", Number(job.nodeId));
      console.log("  Consumer:", job.consumer);
      console.log("  Provider:", job.provider);
      console.log("  Status:", status);
      console.log("  StartedAt:", Number(job.startedAt), job.startedAt > 0n ? new Date(Number(job.startedAt) * 1000).toISOString() : "(not started)");
      console.log("  CompletedAt:", Number(job.completedAt), job.completedAt > 0n ? new Date(Number(job.completedAt) * 1000).toISOString() : "(not completed)");
      console.log("  Duration:", Number(job.durationHours), "hours");
      console.log("");
    } catch (e) {
      console.log(`Job #${i}: not found`);
    }
  }
}
main().catch(console.error);
