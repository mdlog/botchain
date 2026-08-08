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

  const getJobCountByNode = useCallback(async (nodeId: bigint): Promise<number> => {
    try {
      const logs = await publicClient.getLogs({
        address: CONTRACTS.ComputeMarketplace,
        event: {
          type: 'event',
          name: 'JobCreated',
          inputs: [
            { type: 'uint256', name: 'jobId', indexed: true },
            { type: 'uint64', name: 'nodeId', indexed: true },
            { type: 'address', name: 'consumer', indexed: true },
            { type: 'string', name: 'jobType', indexed: false },
            { type: 'uint64', name: 'durationHours', indexed: false },
            { type: 'uint256', name: 'pricePerHourWei', indexed: false },
            { type: 'uint256', name: 'paymentAmount', indexed: false },
          ],
        },
        args: [undefined, nodeId],
        fromBlock: 0n,
        toBlock: 'latest',
      });
      return logs.length;
    } catch { return 0; }
  }, []);

  const getAllJobCounts = useCallback(async (): Promise<Map<string, number>> => {
    const counts = new Map<string, number>();
    try {
      const logs = await publicClient.getLogs({
        address: CONTRACTS.ComputeMarketplace,
        event: {
          type: 'event',
          name: 'JobCreated',
          inputs: [
            { type: 'uint256', name: 'jobId', indexed: true },
            { type: 'uint64', name: 'nodeId', indexed: true },
            { type: 'address', name: 'consumer', indexed: true },
            { type: 'string', name: 'jobType', indexed: false },
            { type: 'uint64', name: 'durationHours', indexed: false },
            { type: 'uint256', name: 'pricePerHourWei', indexed: false },
            { type: 'uint256', name: 'paymentAmount', indexed: false },
          ],
        },
        fromBlock: 0n,
        toBlock: 'latest',
      });
      for (const log of logs) {
        const id = (log.args as any).nodeId?.toString() ?? '0';
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    } catch {}
    return counts;
  }, []);

  const getCompletedJobStats = useCallback(async (): Promise<{ perNode: Map<string, number>, perType: Map<string, number>, total: number }> => {
    const perNode = new Map<string, number>();
    const perType = new Map<string, number>();
    let total = 0;
    try {
      // 1. Fetch all JobCreated events → map jobId → { nodeId, jobType }
      const createdLogs = await publicClient.getLogs({
        address: CONTRACTS.ComputeMarketplace,
        event: {
          type: 'event',
          name: 'JobCreated',
          inputs: [
            { type: 'uint256', name: 'jobId', indexed: true },
            { type: 'uint64', name: 'nodeId', indexed: true },
            { type: 'address', name: 'consumer', indexed: true },
            { type: 'string', name: 'jobType', indexed: false },
            { type: 'uint64', name: 'durationHours', indexed: false },
            { type: 'uint256', name: 'pricePerHourWei', indexed: false },
            { type: 'uint256', name: 'paymentAmount', indexed: false },
          ],
        },
        fromBlock: 0n,
        toBlock: 'latest',
      });

      const jobMap = new Map<string, { nodeId: string; jobType: string }>();
      for (const log of createdLogs) {
        const jobId = (log.args as any).jobId?.toString() ?? '';
        const nodeId = (log.args as any).nodeId?.toString() ?? '0';
        const jobType = (log.args as any).jobType ?? 'Unknown';
        jobMap.set(jobId, { nodeId, jobType });
      }

      // 2. Fetch all JobCompleted events → cross-reference with jobMap
      const completedLogs = await publicClient.getLogs({
        address: CONTRACTS.ComputeMarketplace,
        event: {
          type: 'event',
          name: 'JobCompleted',
          inputs: [
            { type: 'uint256', name: 'jobId', indexed: true },
            { type: 'uint64', name: 'completedAt', indexed: false },
            { type: 'uint256', name: 'totalCost', indexed: false },
            { type: 'uint256', name: 'refund', indexed: false },
          ],
        },
        fromBlock: 0n,
        toBlock: 'latest',
      });

      for (const log of completedLogs) {
        const jobId = (log.args as any).jobId?.toString() ?? '';
        const info = jobMap.get(jobId);
        if (info) {
          perNode.set(info.nodeId, (perNode.get(info.nodeId) ?? 0) + 1);
          perType.set(info.jobType, (perType.get(info.jobType) ?? 0) + 1);
          total++;
        }
      }
    } catch {}
    return { perNode, perType, total };
  }, []);

  return { loading, getJob, getTotalJobs, getTotalVolume, getJobCountByNode, getAllJobCounts, getCompletedJobStats, createJob, acceptJob, completeJob, cancelJob };
}
