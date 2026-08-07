const hre = require("hardhat");

async function main() {
  const deployments = require("../deployments.json");
  const cif = await hre.ethers.getContractAt("ComputeIndexToken", deployments.contracts.ComputeIndexToken);
  const user = "0x7cF858145c1449e6eC1798499527632a846CEeDC";

  const supply = await cif.totalSupply();
  const tvl = await cif.totalValueLocked();
  const balance = await cif.balanceOf(user);
  const price = await cif.getIndexPrice();

  console.log("=== CIF Token Stats ===");
  console.log("Total Supply:", hre.ethers.formatEther(supply), "CIF");
  console.log("TVL:", hre.ethers.formatEther(tvl), "DGRAM");
  console.log("Index Price:", hre.ethers.formatEther(price), "DGRAM/CIF");
  console.log("Your Balance:", hre.ethers.formatEther(balance), "CIF");

  // Use raw call to avoid struct decoding issues
  const deposits = await cif.getDeposits(user);
  console.log("\n=== Your Deposits ===");
  console.log("Count:", deposits.length);
  for (let i = 0; i < deposits.length; i++) {
    const d = deposits[i];
    console.log(`Deposit #${i}:`);
    console.log("  nodeId:", d[0]?.toString());
    console.log("  amountWei:", hre.ethers.formatEther(d[1] || 0));
    console.log("  mintedTokens:", hre.ethers.formatEther(d[2] || 0));
    console.log("  depositedAt:", d[3] ? new Date(Number(d[3]) * 1000).toISOString() : "—");
  }
}

main().catch(console.error);
