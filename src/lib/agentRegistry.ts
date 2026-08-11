/**
 * AgentRegistry — reads provider agent URLs from AgentRegistry contract on-chain.
 *
 * Providers register their tunnel URL via `setAgentUrl(url)` during setup
 * (cloudflared auto-tunnel). Frontend reads it via `getAgentUrl(provider)`
 * to route compute execution requests to the correct provider agent.
 */

import { type Address } from 'viem';

import { agentRegistryAbi } from '@/config/abis';
import { CONTRACTS, publicClient } from '@/config/chain';

/**
 * Read a provider's agent URL from AgentRegistry contract.
 * Returns empty string if not registered.
 */
export async function getProviderAgentUrlFromChain(providerAddress: string): Promise<string> {
  try {
    return await publicClient.readContract({
      address: CONTRACTS.AgentRegistry,
      abi: agentRegistryAbi,
      functionName: 'getAgentUrl',
      args: [providerAddress as Address],
    });
  } catch (err) {
    console.error('[agentRegistry] getAgentUrl failed:', err);
    return '';
  }
}
