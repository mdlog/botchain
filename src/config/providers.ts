/**
 * Provider Agent URL Registry
 *
 * Maps provider wallet address → compute agent endpoint.
 * Primary source: on-chain AgentRegistry contract (auto-registered via cloudflared tunnel).
 * Fallback: static config map for providers that haven't registered on-chain yet.
 */

import { getProviderAgentUrlFromChain } from '@/lib/agentRegistry';

// Fallback static map for providers that haven't registered on-chain yet
const FALLBACK_PROVIDER_URLS: Record<string, string> = {
  '0x264F463571473F0b5C1e9E30018D8B23676b7B80': 'https://agent.mdloglabs.org',
  '0x7cF858145c1449e6eC1798499527632a846CEeDC': 'https://agent2.mdloglabs.org',
};

/**
 * Resolve a provider's compute agent URL.
 * Primary: on-chain AgentRegistry contract (auto-registered via cloudflared tunnel).
 * Fallback: static config map for legacy providers.
 */
export async function getProviderAgentUrlAsync(providerAddress: string): Promise<string> {
  if (!providerAddress) return '';
  // Try on-chain first
  try {
    const url = await getProviderAgentUrlFromChain(providerAddress);
    if (url) return url;
  } catch {}
  // Fallback to static map
  const key = providerAddress.toLowerCase();
  for (const [addr, url] of Object.entries(FALLBACK_PROVIDER_URLS)) {
    if (addr.toLowerCase() === key) return url;
  }
  return '';
}

/**
 * Synchronous fallback — on-chain lookup requires async, so this only checks the static map.
 * Use getProviderAgentUrlAsync for the full lookup.
 */
export function getProviderAgentUrl(providerAddress: string): string {
  if (!providerAddress) return '';
  const key = providerAddress.toLowerCase();
  for (const [addr, url] of Object.entries(FALLBACK_PROVIDER_URLS)) {
    if (addr.toLowerCase() === key) return url;
  }
  return '';
}

export function hasProviderAgent(providerAddress: string): boolean {
  return getProviderAgentUrl(providerAddress) !== '';
}

export function getKnownProviders(): string[] {
  return Object.keys(FALLBACK_PROVIDER_URLS);
}
