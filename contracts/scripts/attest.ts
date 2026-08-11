import pkg from 'hardhat';

import { attachContract, currentChainId, readDeployments, requireAddress, run } from './common.ts';

const { ethers } = pkg;

/**
 * Attest a node, or revoke an attestation.
 *
 * `verifyNode` is restricted to the registry's verifier, which is a different
 * wallet from the provider's — a provider that could vouch for its own hardware
 * would make the "verified" badge meaningless, and that badge is the only gate
 * on both leasing and CIF minting.
 *
 * The verifier key is read from contracts/.env (mode 600) like every other
 * script here. Passing it on the command line would put it in shell history and
 * in /proc/<pid>/cmdline, where any other user on the box can read it.
 *
 *   NODE_ID=123 npm run attest
 *   NODE_ID=123 REVOKE=1 npm run attest
 */
async function main(): Promise<void> {
  const raw = process.env.NODE_ID;
  if (raw === undefined || raw.trim() === '') {
    throw new Error('Set NODE_ID to the node you are attesting, e.g. NODE_ID=123 npm run attest');
  }
  const nodeId = BigInt(raw.trim());
  const revoke = process.env.REVOKE === '1';

  const [signer] = await ethers.getSigners();
  const registry = await attachContract(
    'ComputeRegistry',
    requireAddress(readDeployments(await currentChainId()), 'ComputeRegistry'),
  );

  const verifier: string = await registry.verifier();
  if (verifier.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `${signer.address} is not the registry verifier (${verifier}). ` +
        `Run this with the verifier's key in contracts/.env.`,
    );
  }

  const node = await registry.getNode(nodeId);
  console.log(`node ${nodeId}`);
  console.log(`  provider : ${node.provider}`);
  console.log(
    `  hardware : ${node.specs.model}, ${node.specs.vramGB} GB, ${node.specs.tflops} TFLOPS`,
  );
  console.log(`  region   : ${node.specs.region}`);
  console.log(`  status   : ${node.status} (1 = Active)`);
  console.log(`  attested : ${node.verified}`);

  if (node.verified === !revoke) {
    console.log(`Already ${revoke ? 'revoked' : 'attested'} — nothing to do.`);
    return;
  }

  // Simulate first so a bad call costs nothing.
  const fn = revoke ? 'unverifyNode' : 'verifyNode';
  await registry[fn].staticCall(nodeId);

  const tx = await registry[fn](nodeId);
  const receipt = await tx.wait();
  console.log(`${fn} ok — block ${receipt.blockNumber}, tx ${receipt.hash}`);
  console.log(`  attested : ${(await registry.getNode(nodeId)).verified}`);
}

run(main);
