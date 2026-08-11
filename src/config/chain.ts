import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type Address,
  type ReadContractReturnType,
} from 'viem';

import { type computeMarketplaceAbi, type computeRegistryAbi } from './abis';

// ── BOT Chain Mainnet (Chain ID 677) ─────────────────────
export const botChain = defineChain({
  id: 677,
  name: 'BOT Chain',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.botchain.ai'] },
    public: { http: ['https://rpc.botchain.ai'] },
  },
  blockExplorers: {
    default: { name: 'BOT Scan', url: 'https://scan.botchain.ai' },
  },
  testnet: false,
});

// ── BOT Chain Testnet (Chain ID 968) ─────────────────────
export const botChainTestnet = defineChain({
  id: 968,
  name: 'BOT Chain Testnet',
  nativeCurrency: { name: 'DGRAM', symbol: 'DGRAM', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.bohr.life'] },
    public: { http: ['https://rpc.bohr.life'] },
  },
  blockExplorers: {
    default: { name: 'BOT Scan Testnet', url: 'https://scan.bohr.life' },
  },
  testnet: true,
});

export interface ContractAddresses {
  ComputeRegistry: Address;
  PriceOracle: Address;
  ComputeMarketplace: Address;
  ComputeIndexToken: Address;
  AgentRegistry: Address;
}

/**
 * Deployments per chain id, mirroring contracts/deployments.json. Update both
 * together after a deploy — `npm run deploy:*` writes the JSON, this is the
 * copy the client bundles.
 *
 * A chain with no entry is not selectable: the app fails at load rather than
 * pointing every read at a zero address and rendering an empty marketplace as
 * if the network were simply quiet.
 */
export const DEPLOYMENTS: Partial<Record<number, ContractAddresses>> = {
  // BOT Chain Testnet
  968: {
    ComputeRegistry: '0xcBbEa600C8d15E190A1C69676d8b8a5938BFE396',
    PriceOracle: '0x1087701623e187D00cF05A77DFA08F2710FB66Aa',
    ComputeMarketplace: '0xB72A69BeFFcd478e2ae19C20b65b1cAC1DC5d848',
    ComputeIndexToken: '0x84137667DE83db275B0e0c1ddb94459b8382Ceea',
    AgentRegistry: '0xBF0Fb1508B9E9A6FF13FE74991aA54789D31cAE7',
  },
  // BOT Chain Mainnet — add the addresses here after `npm run deploy:mainnet`.
};

/**
 * Which chain the client talks to. Set VITE_CHAIN=mainnet to switch; the point
 * of routing it through config is that going to mainnet is a deploy plus an env
 * var, not a source edit made under time pressure.
 */
export const activeChain = import.meta.env.VITE_CHAIN === 'mainnet' ? botChain : botChainTestnet;

export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(),
  // Views fan out one read per node and per job. Batching folds those into
  // multicalls so a dashboard load is a couple of round trips, not sixty.
  batch: { multicall: true },
});

function resolveContracts(chainId: number): ContractAddresses {
  const addresses = DEPLOYMENTS[chainId];
  if (addresses === undefined) {
    throw new Error(
      `No contract deployment recorded for chain ${chainId} (${activeChain.name}). ` +
        `Deploy with "npm run deploy:mainnet" in contracts/, then add the addresses ` +
        `to DEPLOYMENTS in src/config/chain.ts.`,
    );
  }
  return addresses;
}

export const CONTRACTS = resolveContracts(activeChain.id);

/** Struct shapes come from the generated ABIs, so they cannot drift from chain. */
export type ComputeNode = ReadContractReturnType<typeof computeRegistryAbi, 'getNode'>;
export type ComputeJob = ReadContractReturnType<typeof computeMarketplaceAbi, 'getJob'>;

export function getWalletClient() {
  if (typeof window === 'undefined' || !window.ethereum) return null;
  return createWalletClient({
    chain: activeChain,
    transport: custom(window.ethereum),
  });
}

export function explorerTxUrl(hash: string): string {
  return `${activeChain.blockExplorers.default.url}/tx/${hash}`;
}
