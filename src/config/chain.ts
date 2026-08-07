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
  ComputeRegistry: '0xc612111b8648B73ED23CF19f400488566af76Ddc' as Address,
  PriceOracle: '0x8674305cb18521E75C01D0162d209ea22767fc33' as Address,
  ComputeMarketplace: '0x7278045051843BbdD7786B493de0681904075f02' as Address,
  ComputeIndexToken: '0x0D3FeE7457066662C1a30C3DAC7f18b907Feab1b' as Address,
} as const;

// ── Helper: create wallet client from window.ethereum ────
export function getWalletClient() {
  if (typeof window === 'undefined' || !window.ethereum) return null;
  return createWalletClient({
    chain: activeChain,
    transport: custom(window.ethereum),
  });
}
