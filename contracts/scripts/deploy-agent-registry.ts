import pkg from 'hardhat';

import {
  deployContract,
  readDeployments,
  run,
  writeDeployments,
  currentChainId,
} from './common.ts';

const { ethers } = pkg;

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying AgentRegistry with account:', deployer.address);

  const registry = await deployContract('AgentRegistry');
  const address = await registry.getAddress();
  console.log('AgentRegistry deployed:', address);

  const chainId = await currentChainId();
  const deployment = readDeployments(chainId);
  writeDeployments(chainId, {
    ...deployment,
    contracts: { ...deployment.contracts, AgentRegistry: address },
    deployedAt: new Date().toISOString(),
  });
  console.log('Updated deployments.json');
}

run(main);
