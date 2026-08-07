const hre = require("hardhat");

async function main() {
  const deployments = require("../deployments.json");
  const marketplace = await hre.ethers.getContractAt("ComputeMarketplace", deployments.contracts.ComputeMarketplace);
  
  const balance = await hre.ethers.provider.getBalance(deployments.contracts.ComputeMarketplace);
  console.log("Contract balance:", hre.ethers.formatEther(balance), "DGRAM");
  
  const job = await marketplace.getJob(4);
  const totalCost = job.pricePerHourWei * job.durationHours;
  console.log("Job #4 totalCost:", hre.ethers.formatEther(totalCost), "DGRAM");
  console.log("Provider:", job.provider);
  console.log("Consumer:", job.consumer);
  console.log("Status:", Number(job.status), ["Pending","Active","Completed","Cancelled","Disputed"][Number(job.status)]);
  
  if (balance < totalCost) {
    console.log("❌ INSUFFICIENT BALANCE — contract cannot pay provider");
  } else {
    console.log("✅ Balance sufficient for payout");
  }
}

main().catch(console.error);
