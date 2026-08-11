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

/** One network's deployment record. deployments.json is keyed by chain id so
 *  testnet and mainnet coexist instead of overwriting each other. */
export interface Deployment {
  name: string;
  contracts: Record<string, string>;
  deployedAt: string;
}

export type DeploymentsFile = Record<string, Deployment>;

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

/** Chain id of the network the script is connected to. */
export async function currentChainId(): Promise<number> {
  return Number((await ethers.provider.getNetwork()).chainId);
}

function readFile(): DeploymentsFile {
  if (!existsSync(DEPLOYMENTS_PATH)) return {};
  return JSON.parse(readFileSync(DEPLOYMENTS_PATH, 'utf8')) as DeploymentsFile;
}

/**
 * Reads the deployment for one chain, failing loudly when that chain has never
 * been deployed to — a script that silently targets the wrong network is worse
 * than one that stops.
 */
export function readDeployments(chainId: number): Deployment {
  const entry = readFile()[String(chainId)];
  if (entry === undefined) {
    throw new Error(
      `No deployment recorded for chain ${chainId} in ${DEPLOYMENTS_PATH}. ` +
        `Run the deploy script for that network first.`,
    );
  }
  return entry;
}

/** Merges one chain's record into the file, leaving the other chains alone. */
export function writeDeployments(chainId: number, entry: Deployment): void {
  const all = readFile();
  all[String(chainId)] = entry;
  writeFileSync(DEPLOYMENTS_PATH, `${JSON.stringify(all, null, 2)}\n`);
}

/** Looks up a deployed address, failing loudly when it is missing. */
export function requireAddress(deployment: Deployment, name: string): string {
  const address = deployment.contracts[name];
  if (address === undefined || address === '') {
    throw new Error(`${name} is not present in the deployment for ${deployment.name}`);
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
