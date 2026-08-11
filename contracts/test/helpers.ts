import { time } from '@nomicfoundation/hardhat-network-helpers';
import type {
  Addressable,
  ContractRunner,
  ContractTransactionReceipt,
  Interface,
  Signer,
} from 'ethers';
import pkg from 'hardhat';

const { ethers } = pkg;

/**
 * Contract handle with dynamic method access. These tests drive the deployed ABI
 * rather than generated bindings, so `npm run typecheck` never depends on
 * artifacts having been built first.
 */
export interface ContractHandle {
  [member: string]: any;
  interface: Interface;
  target: string | Addressable;
  getAddress(): Promise<string>;
  connect(runner: ContractRunner | null): ContractHandle;
}

export const HOUR = 3600;
export const H100 = 'NVIDIA H100';
export const CPU = 'CPU Only';

export const H100_PER_HOUR = ethers.parseEther('3.1');
export const CPU_PER_HOUR = ethers.parseEther('0.02');

export interface Deployment {
  owner: Signer;
  provider: Signer;
  consumer: Signer;
  outsider: Signer;
  registry: ContractHandle;
  oracle: ContractHandle;
  marketplace: ContractHandle;
  cif: ContractHandle;
  nodeId: bigint;
}

/** Deploys a contract by name and returns a dynamically typed handle. */
export async function deploy(name: string, ...args: unknown[]): Promise<ContractHandle> {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract as unknown as ContractHandle;
}

/**
 * Deploys the full stack, wires the roles, seeds two GPU benchmarks and brings a
 * verified H100 node online. The index fee starts at zero so individual tests can
 * opt in without every balance assertion having to account for it.
 */
export async function deployStack(): Promise<Deployment> {
  const [owner, provider, consumer, outsider] = await ethers.getSigners();

  const registry = await deploy('ComputeRegistry');
  const oracle = await deploy('PriceOracle');
  const marketplace = await deploy(
    'ComputeMarketplace',
    await registry.getAddress(),
    await oracle.getAddress(),
  );
  const cif = await deploy('ComputeIndexToken', await registry.getAddress());

  await registry.setMarketplace(await marketplace.getAddress());
  await cif.setMarketplace(await marketplace.getAddress());
  await marketplace.setIndexFund(await cif.getAddress());

  await oracle.setBenchmark(H100, 50000);
  await oracle.setBenchmark(CPU, 500);
  await oracle.updatePrice(H100, H100_PER_HOUR, 8500);
  await oracle.updatePrice(CPU, CPU_PER_HOUR, 7000);

  const nodeId = await registerNode(registry, provider, H100, 80, 1979, 'eu-central');
  await registry.verifyNode(nodeId);
  await registry.connect(provider).updateStatus(nodeId, 1);

  return { owner, provider, consumer, outsider, registry, oracle, marketplace, cif, nodeId };
}

/** Registers a node and returns its generated id. */
export async function registerNode(
  registry: ContractHandle,
  provider: Signer,
  model: string,
  vramGB: number,
  tflops: number,
  region: string,
): Promise<bigint> {
  await registry.connect(provider).registerNode(model, vramGB, tflops, region);
  const owned: bigint[] = await registry.getProviderNodes(await provider.getAddress());
  return owned[owned.length - 1];
}

/**
 * Runs one lease end to end for exactly `hours` of billable time and returns the
 * revenue it settled, so revenue-dependent tests do not have to re-derive it.
 */
export async function runLease(
  deployment: Deployment,
  jobId: bigint,
  hours: number,
): Promise<bigint> {
  const { marketplace, provider, consumer, nodeId } = deployment;
  const escrow = H100_PER_HOUR * BigInt(hours);

  await marketplace
    .connect(consumer)
    .createJob(nodeId, 'Inference', 'ipfs://spec', hours, { value: escrow });
  await marketplace.connect(provider).acceptJob(jobId);

  const job = await marketplace.getJob(jobId);
  await time.setNextBlockTimestamp(Number(job.startedAt) + hours * HOUR);
  await marketplace.connect(provider).completeJob(jobId);

  return escrow;
}

/** Total wei burned on gas by a mined transaction. */
export function gasCost(receipt: ContractTransactionReceipt | null): bigint {
  if (receipt === null) throw new Error('transaction was not mined');
  return receipt.gasUsed * receipt.gasPrice;
}

/** Native balance of an address, signer or contract. */
export async function balanceOf(who: Signer | ContractHandle | string): Promise<bigint> {
  const address = typeof who === 'string' ? who : await who.getAddress();
  return ethers.provider.getBalance(address);
}
