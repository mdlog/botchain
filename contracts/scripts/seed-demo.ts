import pkg from 'hardhat';

import { attachContract, readDeployments, requireAddress, run } from './common.ts';

const { ethers } = pkg;

/**
 * Brings the signer's own machines online in a freshly deployed registry:
 * register → activate → attest. A redeploy starts with an empty registry, so
 * without this the marketplace has nothing to list and the demo has nothing to
 * lease.
 *
 * The specs below describe real hardware this operator runs. They are not
 * fabricated H100s — `registerNode` accepts self-declared specs with no proof,
 * so seeding hardware that does not exist would put a claim on chain that the
 * provider agent cannot back up.
 *
 * Attestation only succeeds when the signer is the registry `verifier`; after a
 * fresh deploy that is the deployer, which is why this runs as one script.
 */
const NODES = [
  { model: 'NVIDIA RTX 3060', vramGB: 12, tflops: 13, region: 'Makassar' },
  { model: 'CPU Only', vramGB: 0, tflops: 4, region: 'Makassar' },
];

async function main(): Promise<void> {
  const [signer] = await ethers.getSigners();
  const deployments = readDeployments();
  const registry = await attachContract(
    'ComputeRegistry',
    requireAddress(deployments, 'ComputeRegistry'),
  );

  console.log('Signer:', signer.address);
  console.log('Registry:', await registry.getAddress());

  const verifier: string = await registry.verifier();
  const canAttest = verifier.toLowerCase() === signer.address.toLowerCase();
  if (!canAttest) {
    console.log(`Verifier is ${verifier} — nodes will register but stay unattested.`);
  }

  for (const node of NODES) {
    const tx = await registry.registerNode(node.model, node.vramGB, node.tflops, node.region);
    const receipt = await tx.wait();

    // registerNode returns the id, but a transaction only yields a receipt, so
    // the id has to come back out of the event.
    const event = receipt.logs
      .map((entry: { topics: readonly string[]; data: string }) => {
        try {
          return registry.interface.parseLog(entry);
        } catch {
          return null;
        }
      })
      .find((parsed: { name: string } | null) => parsed?.name === 'NodeRegistered');

    if (event === undefined) {
      throw new Error(`registerNode for ${node.model} emitted no NodeRegistered event`);
    }
    const nodeId: bigint = event.args.nodeId;

    await (await registry.updateStatus(nodeId, 1)).wait(); // 1 = Active
    if (canAttest) {
      await (await registry.verifyNode(nodeId)).wait();
    }

    console.log(
      `  ${node.model} (${node.vramGB} GB, ${node.tflops} TFLOPS) → node ${nodeId} ` +
        `[active${canAttest ? ', attested' : ', awaiting attestation'}]`,
    );
  }

  console.log(
    `Total nodes: ${await registry.nodeCount()}, active: ${await registry.totalActiveNodes()}`,
  );
}

run(main);
