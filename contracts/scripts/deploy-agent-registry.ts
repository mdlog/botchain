import pkg from 'hardhat';

import { deployContract, readDeployments, run, writeDeployments } from './common.ts';

const { ethers } = pkg;

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying AgentRegistry with account:', deployer.address);

  const registry = await deployContract('AgentRegistry');
  const address = await registry.getAddress();
  console.log('AgentRegistry deployed:', address);

  const deployments = readDeployments();
  deployments.contracts = { ...deployments.contracts, AgentRegistry: address };
  deployments.deployedAt = new Date().toISOString();
  writeDeployments(deployments);
  console.log('Updated deployments.json');
}

run(main);
