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
  ComputeRegistry: '0x91778B39490e6193c27A32a35dd33b7B14F54EC0' as Address,
  PriceOracle: '0x95D102579C544BA2756F344eC2Ad09D677CFAe49' as Address,
  ComputeMarketplace: '0xd93C4006888d5A707b9e072685d6aD36a91228d2' as Address,
  ComputeIndexToken: '0xE61DD019294Ab52eF69714a948E65b9a31947c1e' as Address,
} as const;

// ── Helper: create wallet client from window.ethereum ────
export function getWalletClient() {
  if (typeof window === 'undefined' || !window.ethereum) return null;
  return createWalletClient({
    chain: activeChain,
    transport: custom(window.ethereum),
  });
}
