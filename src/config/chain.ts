import { createPublicClient, createWalletClient, http, custom, type Address } from 'viem';
import { defineChain } from 'viem';

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

// ── Active chain (testnet for development) ───────────────
export const activeChain = botChainTestnet;

// ── Public client (read-only) ────────────────────────────
export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(),
});

// ── Contract addresses (deployed on BOT Chain Testnet) ──
export const CONTRACTS = {
  ComputeRegistry: '0x71aD5e31D0DCf1b0f9e5723Ca04D3822F2023ff3' as Address,
  PriceOracle: '0x67b0A83AA966986cACF7FbBd2a9eada201250744' as Address,
  ComputeMarketplace: '0xAa5C9673fa9a7E3ED16341420471581c10Dd23EB' as Address,
  ComputeIndexToken: '0xa07f2290F26Aca288F140D5fE83B2E9012964183' as Address,
} as const;

// ── Helper: create wallet client from window.ethereum ────
export function getWalletClient() {
  if (typeof window === 'undefined' || !window.ethereum) return null;
  return createWalletClient({
    chain: activeChain,
    transport: custom(window.ethereum),
  });
}
