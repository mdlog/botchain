const hre = require("hardhat");

async function main() {
  const deployments = require("../deployments.json");
  const marketplaceAddr = deployments.contracts.ComputeMarketplace;
  
  // Send 0.2 DGRAM to contract so Job #4 can complete
  const [signer] = await hre.ethers.getSigners();
  console.log("Sender:", signer.address);
  
  const balance = await hre.ethers.provider.getBalance(signer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "DGRAM");
  
  const tx = await signer.sendTransaction({
    to: marketplaceAddr,
    value: hre.ethers.parseEther("0.2"),
  });
  await tx.wait();
  console.log("✅ Sent 0.2 DGRAM to marketplace contract:", tx.hash);
  
  const contractBal = await hre.ethers.provider.getBalance(marketplaceAddr);
  console.log("Contract balance now:", hre.ethers.formatEther(contractBal), "DGRAM");
}

main().catch(console.error);
