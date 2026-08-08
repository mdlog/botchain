/**
 * AgentRegistry — reads provider agent URLs from AgentRegistry contract on-chain.
 *
 * Providers register their tunnel URL via `setAgentUrl(url)` during setup
 * (cloudflared auto-tunnel). Frontend reads it via `getAgentUrl(provider)`
 * to route compute execution requests to the correct provider agent.
 */

import { publicClient, CONTRACTS } from '@/config/chain';
import { type Address } from 'viem';

const AGENT_REGISTRY_ABI = [
  {
    name: 'getAgentUrl',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [{ name: 'url', type: 'string' }],
  },
] as const;

/**
 * Read a provider's agent URL from AgentRegistry contract.
 * Returns empty string if not registered.
 */
export async function getProviderAgentUrlFromChain(providerAddress: string): Promise<string> {
  try {
    const url = await publicClient.readContract({
      address: CONTRACTS.AgentRegistry,
      abi: AGENT_REGISTRY_ABI,
      functionName: 'getAgentUrl',
      args: [providerAddress as Address],
    } as any);
    return (url as string) || '';
  } catch (err) {
    console.error('[agentRegistry] getAgentUrl failed:', err);
    return '';
  }
}
