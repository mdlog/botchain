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
  ComputeRegistry: '0x8b68ae929A0Cbe32F6F0121881B42Ef9D9213eB5' as Address,
  PriceOracle: '0x2BF8219f6b296A85904e4A486963496c3A0d1b43' as Address,
  ComputeMarketplace: '0x89b6fBFB647B8a07c4d1520871440f0B01314f87' as Address,
  ComputeIndexToken: '0x11D29Bf60E75f3A3Dc3b46fC7dfaafc5BdB6825E' as Address,
} as const;

// ── Helper: create wallet client from window.ethereum ────
export function getWalletClient() {
  if (typeof window === 'undefined' || !window.ethereum) return null;
  return createWalletClient({
    chain: activeChain,
    transport: custom(window.ethereum),
  });
}
