import { useState, useCallback } from 'react';
import { type Hash } from 'viem';
import { publicClient, getWalletClient, CONTRACTS, activeChain } from '@/config/chain';
import { ABIS } from '@/config/contracts';

export function useComputeMarketplace() {
  const [loading, setLoading] = useState(false);

  const getJob = useCallback(async (jobId: bigint) => {
    setLoading(true);
    try {
      const data = await publicClient.readContract({
        address: CONTRACTS.ComputeMarketplace,
        abi: ABIS.ComputeMarketplace as any,
        functionName: 'getJob',
        args: [jobId],
      } as any);
      return data;
    } finally {
      setLoading(false);
    }
  }, []);

  const getTotalJobs = useCallback(async () => {
    const data = await publicClient.readContract({
      address: CONTRACTS.ComputeMarketplace,
      abi: ABIS.ComputeMarketplace as any,
      functionName: 'totalJobs',
    } as any);
    return data as bigint;
  }, []);

  const getTotalVolume = useCallback(async () => {
    const data = await publicClient.readContract({
      address: CONTRACTS.ComputeMarketplace,
      abi: ABIS.ComputeMarketplace as any,
      functionName: 'totalVolumeWei',
    } as any);
    return data as bigint;
  }, []);

  const createJob = useCallback(async (
    nodeId: bigint,
    jobType: string,
    specHash: string,
    durationHours: bigint,
    gpuModel: string,
    value: bigint
  ): Promise<Hash | null> => {
    const walletClient = getWalletClient();
    if (!walletClient) return null;
    const [account] = await walletClient.getAddresses();
    const hash = await walletClient.writeContract({
      address: CONTRACTS.ComputeMarketplace,
      abi: ABIS.ComputeMarketplace as any,
      functionName: 'createJob',
      args: [nodeId, jobType, specHash, durationHours, gpuModel],
      value,
      account,
      chain: activeChain,
    } as any);
    return hash;
  }, []);

  const acceptJob = useCallback(async (jobId: bigint): Promise<Hash | null> => {
    const walletClient = getWalletClient();
    if (!walletClient) return null;
    const [account] = await walletClient.getAddresses();
    const hash = await walletClient.writeContract({
      address: CONTRACTS.ComputeMarketplace,
      abi: ABIS.ComputeMarketplace as any,
      functionName: 'acceptJob',
      args: [jobId],
      account,
      chain: activeChain,
    } as any);
    return hash;
  }, []);

  const completeJob = useCallback(async (jobId: bigint): Promise<Hash | null> => {
    const walletClient = getWalletClient();
    if (!walletClient) return null;
    const [account] = await walletClient.getAddresses();
    const hash = await walletClient.writeContract({
      address: CONTRACTS.ComputeMarketplace,
      abi: ABIS.ComputeMarketplace as any,
      functionName: 'completeJob',
      args: [jobId],
      account,
      chain: activeChain,
    } as any);
    return hash;
  }, []);

  const cancelJob = useCallback(async (jobId: bigint): Promise<Hash | null> => {
    const walletClient = getWalletClient();
    if (!walletClient) return null;
    const [account] = await walletClient.getAddresses();
    const hash = await walletClient.writeContract({
      address: CONTRACTS.ComputeMarketplace,
      abi: ABIS.ComputeMarketplace as any,
      functionName: 'cancelJob',
      args: [jobId],
      account,
      chain: activeChain,
    } as any);
    return hash;
  }, []);

  return { loading, getJob, getTotalJobs, getTotalVolume, createJob, acceptJob, completeJob, cancelJob };
}
