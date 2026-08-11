import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Addressable, ContractRunner, Interface } from 'ethers';
import pkg from 'hardhat';

const { ethers } = pkg;

/**
 * Contract handle with dynamic method access. Scripts talk to freshly compiled
 * ABIs, so they deliberately do not depend on generated TypeChain bindings
 * existing at type-check time.
 */
export interface ContractHandle {
  [member: string]: any;
  interface: Interface;
  target: string | Addressable;
  getAddress(): Promise<string>;
  connect(runner: ContractRunner | null): ContractHandle;
}

export interface Deployments {
  network: string;
  contracts: Record<string, string>;
  deployedAt: string;
}

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

export const DEPLOYMENTS_PATH = path.resolve(scriptsDir, '../deployments.json');

/** Deploys a contract by name and waits for it to be mined. */
export async function deployContract(name: string, ...args: unknown[]): Promise<ContractHandle> {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract as unknown as ContractHandle;
}

/** Attaches to an already deployed contract. */
export async function attachContract(name: string, address: string): Promise<ContractHandle> {
  return (await ethers.getContractAt(name, address)) as unknown as ContractHandle;
}

/** Reads deployments.json, failing loudly when the stack has not been deployed. */
export function readDeployments(): Deployments {
  if (!existsSync(DEPLOYMENTS_PATH)) {
    throw new Error(`${DEPLOYMENTS_PATH} not found — run "npm run deploy:testnet" first`);
  }
  return JSON.parse(readFileSync(DEPLOYMENTS_PATH, 'utf8')) as Deployments;
}

/** Writes deployments.json. */
export function writeDeployments(deployments: Deployments): void {
  writeFileSync(DEPLOYMENTS_PATH, `${JSON.stringify(deployments, null, 2)}\n`);
}

/** Looks up a deployed address, failing loudly when it is missing. */
export function requireAddress(deployments: Deployments, name: string): string {
  const address = deployments.contracts[name];
  if (address === undefined || address === '') {
    throw new Error(`${name} is not present in deployments.json`);
  }
  return address;
}

/** Runs a script entrypoint and turns any failure into a non-zero exit code. */
export function run(main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
