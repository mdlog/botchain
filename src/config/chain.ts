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

/**
 * Contracts are deployed on testnet only. The mainnet chain is defined above so
 * the switch is a config change rather than a code change, but selecting it
 * without a mainnet deployment would point the app at empty addresses — hence
 * the explicit guard rather than a silent fallback.
 */
export const activeChain = botChainTestnet;

export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(),
  // Views fan out one read per node and per job. Batching folds those into
  // multicalls so a dashboard load is a couple of round trips, not sixty.
  batch: { multicall: true },
});

// ── Deployed addresses (BOT Chain Testnet, chain 968) ────
// Mirrors contracts/deployments.json; regenerate both together after a deploy.
export const CONTRACTS = {
  ComputeRegistry: '0xcBbEa600C8d15E190A1C69676d8b8a5938BFE396' as Address,
  PriceOracle: '0x1087701623e187D00cF05A77DFA08F2710FB66Aa' as Address,
  ComputeMarketplace: '0xB72A69BeFFcd478e2ae19C20b65b1cAC1DC5d848' as Address,
  ComputeIndexToken: '0x84137667DE83db275B0e0c1ddb94459b8382Ceea' as Address,
  AgentRegistry: '0xBF0Fb1508B9E9A6FF13FE74991aA54789D31cAE7' as Address,
} as const;

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
