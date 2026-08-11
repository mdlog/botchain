import pkg from 'hardhat';

import { DEPLOYMENTS_PATH, deployContract, run, writeDeployments } from './common.ts';

const { ethers } = pkg;

/** Share of settled revenue routed to the CIF index fund, in basis points. */
const INDEX_FEE_BPS = 500;

const BENCHMARKS = [
  { model: 'NVIDIA H100', bps: 50000, price: '3.10', confidence: 8500 },
  { model: 'NVIDIA A100', bps: 30000, price: '1.80', confidence: 8800 },
  { model: 'NVIDIA RTX 4090', bps: 15000, price: '0.85', confidence: 9200 },
  { model: 'NVIDIA RTX 3090', bps: 8000, price: '0.45', confidence: 9000 },
  { model: 'NVIDIA RTX 3060', bps: 3000, price: '0.15', confidence: 8500 },
  { model: 'AMD Radeon GPU', bps: 2500, price: '0.12', confidence: 8500 },
  { model: 'CPU Only', bps: 500, price: '0.02', confidence: 7000 },
];

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log('Network:', network.name, `(chainId ${network.chainId})`);
  console.log('Deployer:', deployer.address);
  console.log(
    'Balance:',
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    'DGRAM',
  );

  const registry = await deployContract('ComputeRegistry');
  const registryAddr = await registry.getAddress();
  console.log('ComputeRegistry:', registryAddr);

  const oracle = await deployContract('PriceOracle');
  const oracleAddr = await oracle.getAddress();
  console.log('PriceOracle:', oracleAddr);

  const marketplace = await deployContract('ComputeMarketplace', registryAddr, oracleAddr);
  const marketplaceAddr = await marketplace.getAddress();
  console.log('ComputeMarketplace:', marketplaceAddr);

  const cif = await deployContract('ComputeIndexToken', registryAddr);
  const cifAddr = await cif.getAddress();
  console.log('ComputeIndexToken (CIF):', cifAddr);

  const agentRegistry = await deployContract('AgentRegistry');
  const agentRegistryAddr = await agentRegistry.getAddress();
  console.log('AgentRegistry:', agentRegistryAddr);

  await (await registry.setMarketplace(marketplaceAddr)).wait();
  await (await cif.setMarketplace(marketplaceAddr)).wait();
  await (await marketplace.setIndexFund(cifAddr)).wait();
  await (await marketplace.setIndexFeeBps(INDEX_FEE_BPS)).wait();
  console.log(`Roles wired; ${INDEX_FEE_BPS / 100}% of settled revenue routes to CIF`);

  // The attestation key is kept separate from ownership so node verification can
  // move to a dedicated signer without handing over the registry itself.
  const verifier = process.env.VERIFIER_ADDRESS;
  if (verifier !== undefined && verifier !== '' && verifier !== deployer.address) {
    await (await registry.setVerifier(verifier)).wait();
    console.log('Verifier:', verifier);
  } else {
    console.log('Verifier: deployer', deployer.address);
  }

  const aiOperator = process.env.AI_OPERATOR_ADDRESS;
  if (aiOperator !== undefined && aiOperator !== '' && aiOperator !== deployer.address) {
    await (await oracle.setOperator(aiOperator)).wait();
    console.log('Oracle operator:', aiOperator);
  }

  for (const entry of BENCHMARKS) {
    await (await oracle.setBenchmark(entry.model, entry.bps)).wait();
    await (
      await oracle.updatePrice(entry.model, ethers.parseEther(entry.price), entry.confidence)
    ).wait();
    console.log(
      `  ${entry.model}: ${entry.price} DGRAM/hr (confidence ${entry.confidence / 100}%)`,
    );
  }

  writeDeployments({
    network: network.chainId.toString(),
    contracts: {
      ComputeRegistry: registryAddr,
      PriceOracle: oracleAddr,
      ComputeMarketplace: marketplaceAddr,
      ComputeIndexToken: cifAddr,
      AgentRegistry: agentRegistryAddr,
    },
    deployedAt: new Date().toISOString(),
  });
  console.log('Addresses written to', DEPLOYMENTS_PATH);
}

run(main);
