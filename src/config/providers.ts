/**
 * Provider Agent URL Registry
 *
 * Maps provider wallet address → compute agent endpoint.
 * In production this would come from on-chain node metadata;
 * for hackathon MVP we use a config map keyed by provider address.
 *
 * This replaces the old NODE_AGENT_URLS map that was keyed by nodeId (1, 2, ...)
 * which broke after switching to uint64 hash-based node IDs.
 */

// Known provider agent endpoints
const PROVIDER_AGENT_URLS: Record<string, string> = {
  // mdlog-desktop — RTX 3060 node
  '0x264F463571473F0b5C1e9E30018D8B23676b7B80': 'https://agent.mdloglabs.org',
  // laptop — second provider node
  '0x7cF858145c1449e6eC1798499527632a846CEeDC': 'https://agent2.mdloglabs.org',
};

/**
 * Resolve a provider's compute agent URL from their wallet address.
 * Returns empty string if provider is not in the registry.
 */
export function getProviderAgentUrl(providerAddress: string): string {
  if (!providerAddress) return '';
  const key = providerAddress.toLowerCase();
  for (const [addr, url] of Object.entries(PROVIDER_AGENT_URLS)) {
    if (addr.toLowerCase() === key) return url;
  }
  return '';
}

/**
 * Check if a provider has a registered agent URL.
 */
export function hasProviderAgent(providerAddress: string): boolean {
  return getProviderAgentUrl(providerAddress) !== '';
}

/**
 * Get all known provider addresses (for display/debug).
 */
export function getKnownProviders(): string[] {
  return Object.keys(PROVIDER_AGENT_URLS);
}
