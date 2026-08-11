import pkg from 'hardhat';

import { attachContract, readDeployments, requireAddress, run, currentChainId } from './common.ts';

const { ethers } = pkg;

const MODEL = 'AMD Radeon GPU';
const PRICE = '0.12';
const CONFIDENCE = 8500;

async function main(): Promise<void> {
  const deployments = readDeployments(await currentChainId());
  const oracle = await attachContract('PriceOracle', requireAddress(deployments, 'PriceOracle'));

  await (await oracle.setBenchmark(MODEL, 2500)).wait();
  console.log('Benchmark set for', MODEL);

  await (await oracle.updatePrice(MODEL, ethers.parseEther(PRICE), CONFIDENCE)).wait();

  const [price, , confidence] = await oracle.getPrice(MODEL);
  console.log(
    `${MODEL}: ${ethers.formatEther(price)} DGRAM/hr, confidence ${Number(confidence) / 100}%`,
  );
}

run(main);
