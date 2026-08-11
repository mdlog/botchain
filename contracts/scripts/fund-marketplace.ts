import pkg from 'hardhat';

import { readDeployments, requireAddress, run, currentChainId } from './common.ts';

const { ethers } = pkg;

/**
 * Tops the marketplace up with spare DGRAM. Settlement is fully funded by each
 * job's own escrow, so this is only ever needed to cover jobs created against an
 * older deployment of the contract.
 */
const AMOUNT = process.env.FUND_AMOUNT ?? '0.2';

async function main(): Promise<void> {
  const [signer] = await ethers.getSigners();
  const marketplace = requireAddress(readDeployments(await currentChainId()), 'ComputeMarketplace');

  console.log('Sender:', signer.address);
  console.log(
    'Balance:',
    ethers.formatEther(await ethers.provider.getBalance(signer.address)),
    'DGRAM',
  );

  const tx = await signer.sendTransaction({ to: marketplace, value: ethers.parseEther(AMOUNT) });
  await tx.wait();
  console.log(`Sent ${AMOUNT} DGRAM to ${marketplace}:`, tx.hash);
  console.log(
    'Contract balance:',
    ethers.formatEther(await ethers.provider.getBalance(marketplace)),
    'DGRAM',
  );
}

run(main);
