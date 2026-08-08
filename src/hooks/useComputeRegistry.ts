import { useState, useCallback } from 'react';
import { type Address, type Hash } from 'viem';
import { publicClient, getWalletClient, CONTRACTS, activeChain } from '@/config/chain';
import { ABIS } from '@/config/contracts';

export function useComputeRegistry() {
  const [loading, setLoading] = useState(false);

  const getNode = useCallback(async (nodeId: bigint) => {
    setLoading(true);
    try {
      const data = await publicClient.readContract({
        address: CONTRACTS.ComputeRegistry,
        abi: ABIS.ComputeRegistry as any,
        functionName: 'getNode',
        args: [nodeId],
      } as any);
      return data;
    } finally {
      setLoading(false);
    }
  }, []);

  const getProviderNodes = useCallback(async (provider: Address) => {
    const data = await publicClient.readContract({
      address: CONTRACTS.ComputeRegistry,
      abi: ABIS.ComputeRegistry as any,
      functionName: 'getProviderNodes',
      args: [provider],
    } as any);
    return data as bigint[];
  }, []);

  const getProviderRevenue = useCallback(async (provider: Address) => {
    const data = await publicClient.readContract({
      address: CONTRACTS.ComputeRegistry,
      abi: ABIS.ComputeRegistry as any,
      functionName: 'getProviderRevenue',
      args: [provider],
    } as any);
    return data as bigint;
  }, []);

  const getTotalActiveNodes = useCallback(async () => {
    const data = await publicClient.readContract({
      address: CONTRACTS.ComputeRegistry,
      abi: ABIS.ComputeRegistry as any,
      functionName: 'totalActiveNodes',
    } as any);
    return data as bigint;
  }, []);

  const getNodeCount = useCallback(async () => {
    const data = await publicClient.readContract({
      address: CONTRACTS.ComputeRegistry,
      abi: ABIS.ComputeRegistry as any,
      functionName: 'nodeCount',
    } as any);
    return data as bigint;
  }, []);

  const registerNode = useCallback(async (
    model: string,
    vramGB: number,
    tflops: number,
    region: string
  ): Promise<Hash | null> => {
    const walletClient = getWalletClient();
    if (!walletClient) return null;
    const [account] = await walletClient.getAddresses();
    const hash = await walletClient.writeContract({
      address: CONTRACTS.ComputeRegistry,
      abi: ABIS.ComputeRegistry as any,
      functionName: 'registerNode',
      args: [model, vramGB, tflops, region],
      account,
      chain: activeChain,
    } as any);
    return hash;
  }, []);

  const updateNodeStatus = useCallback(async (
    nodeId: bigint,
    status: number
  ): Promise<Hash | null> => {
    const walletClient = getWalletClient();
    if (!walletClient) return null;
    const [account] = await walletClient.getAddresses();
    const hash = await walletClient.writeContract({
      address: CONTRACTS.ComputeRegistry,
      abi: ABIS.ComputeRegistry as any,
      functionName: 'updateStatus',
      args: [nodeId, status],
      account,
      chain: activeChain,
    } as any);
    return hash;
  }, []);

  const verifyNode = useCallback(async (nodeId: bigint): Promise<Hash | null> => {
    const walletClient = getWalletClient();
    if (!walletClient) return null;
    const [account] = await walletClient.getAddresses();
    const hash = await walletClient.writeContract({
      address: CONTRACTS.ComputeRegistry,
      abi: ABIS.ComputeRegistry as any,
      functionName: 'verifyNode',
      args: [nodeId],
      account,
      chain: activeChain,
    } as any);
    return hash;
  }, []);

  return {
    loading,
    getNode,
    getProviderNodes,
    getProviderRevenue,
    getTotalActiveNodes,
    getNodeCount,
    registerNode,
    updateNodeStatus,
    verifyNode,
  };
}
