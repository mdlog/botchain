import { useCallback } from 'react';
import { getAbiItem, type Address, type Hash } from 'viem';

import { computeMarketplaceAbi } from '@/config/abis';
import { CONTRACTS, publicClient, type ComputeJob } from '@/config/chain';
import { sendTx } from '@/lib/tx';

const marketplace = { address: CONTRACTS.ComputeMarketplace, abi: computeMarketplaceAbi } as const;

// getAbiItem keeps the literal event shape, so log.args stays typed per event.
const JOB_CREATED = getAbiItem({ abi: computeMarketplaceAbi, name: 'JobCreated' });
const JOB_COMPLETED = getAbiItem({ abi: computeMarketplaceAbi, name: 'JobCompleted' });

export function useComputeMarketplace() {
  const getJob = useCallback(
    (jobId: bigint): Promise<ComputeJob> =>
      publicClient.readContract({ ...marketplace, functionName: 'getJob', args: [jobId] }),
    [],
  );

  const getTotalJobs = useCallback(
    (): Promise<bigint> => publicClient.readContract({ ...marketplace, functionName: 'totalJobs' }),
    [],
  );

  const getTotalVolume = useCallback(
    (): Promise<bigint> =>
      publicClient.readContract({ ...marketplace, functionName: 'totalVolumeWei' }),
    [],
  );

  /** Unix seconds after which anyone may settle a stranded lease, 0 when not applicable. */
  const getSettleableAt = useCallback(
    (jobId: bigint): Promise<bigint> =>
      publicClient.readContract({ ...marketplace, functionName: 'settleableAt', args: [jobId] }),
    [],
  );

  const getPendingWithdrawal = useCallback(
    (account: Address): Promise<bigint> =>
      publicClient.readContract({
        ...marketplace,
        functionName: 'pendingWithdrawals',
        args: [account],
      }),
    [],
  );

  /** Reads every job concurrently — the client folds them into multicalls. */
  const getJobs = useCallback(
    async (jobIds: bigint[]): Promise<ComputeJob[]> => {
      const jobs = await Promise.all(jobIds.map((id) => getJob(id).catch(() => null)));
      return jobs.filter((job): job is ComputeJob => job !== null);
    },
    [getJob],
  );

  /**
   * The price argument is gone: the contract now reads the model off the node
   * itself, so a lease can no longer be priced against a cheaper GPU than the
   * one being rented.
   */
  const createJob = useCallback(
    (
      nodeId: bigint,
      jobType: string,
      specHash: string,
      durationHours: bigint,
      value: bigint,
    ): Promise<Hash> =>
      sendTx({
        ...marketplace,
        functionName: 'createJob',
        args: [nodeId, jobType, specHash, durationHours],
        value,
      }),
    [],
  );

  /** Extends the same job at its original locked-in rate. */
  const extendJob = useCallback(
    (jobId: bigint, extraHours: bigint, value: bigint): Promise<Hash> =>
      sendTx({ ...marketplace, functionName: 'extendJob', args: [jobId, extraHours], value }),
    [],
  );

  const acceptJob = useCallback(
    (jobId: bigint): Promise<Hash> =>
      sendTx({ ...marketplace, functionName: 'acceptJob', args: [jobId] }),
    [],
  );

  const completeJob = useCallback(
    (jobId: bigint): Promise<Hash> =>
      sendTx({ ...marketplace, functionName: 'completeJob', args: [jobId] }),
    [],
  );

  const cancelJob = useCallback(
    (jobId: bigint): Promise<Hash> =>
      sendTx({ ...marketplace, functionName: 'cancelJob', args: [jobId] }),
    [],
  );

  /** The consumer's escape hatch when a provider's agent never settles. */
  const settleExpiredJob = useCallback(
    (jobId: bigint): Promise<Hash> =>
      sendTx({ ...marketplace, functionName: 'settleExpiredJob', args: [jobId] }),
    [],
  );

  const withdrawPending = useCallback(
    (): Promise<Hash> => sendTx({ ...marketplace, functionName: 'withdrawPending' }),
    [],
  );

  const getAllJobCounts = useCallback(async (): Promise<Map<string, number>> => {
    const counts = new Map<string, number>();
    try {
      const logs = await publicClient.getLogs({
        address: CONTRACTS.ComputeMarketplace,
        event: JOB_CREATED,
        fromBlock: 0n,
        toBlock: 'latest',
      });
      for (const log of logs) {
        const id = log.args.nodeId?.toString() ?? '0';
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    } catch (err) {
      console.error('[useComputeMarketplace] getAllJobCounts failed:', err);
    }
    return counts;
  }, []);

  const getCompletedJobStats = useCallback(async (): Promise<{
    perNode: Map<string, number>;
    perType: Map<string, number>;
    total: number;
  }> => {
    const perNode = new Map<string, number>();
    const perType = new Map<string, number>();
    let total = 0;

    try {
      const [createdLogs, completedLogs] = await Promise.all([
        publicClient.getLogs({
          address: CONTRACTS.ComputeMarketplace,
          event: JOB_CREATED,
          fromBlock: 0n,
          toBlock: 'latest',
        }),
        publicClient.getLogs({
          address: CONTRACTS.ComputeMarketplace,
          event: JOB_COMPLETED,
          fromBlock: 0n,
          toBlock: 'latest',
        }),
      ]);

      const created = new Map<string, { nodeId: string; jobType: string }>();
      for (const log of createdLogs) {
        created.set(log.args.jobId?.toString() ?? '', {
          nodeId: log.args.nodeId?.toString() ?? '0',
          jobType: log.args.jobType ?? 'Unknown',
        });
      }

      for (const log of completedLogs) {
        const info = created.get(log.args.jobId?.toString() ?? '');
        if (!info) continue;
        perNode.set(info.nodeId, (perNode.get(info.nodeId) ?? 0) + 1);
        perType.set(info.jobType, (perType.get(info.jobType) ?? 0) + 1);
        total++;
      }
    } catch (err) {
      console.error('[useComputeMarketplace] getCompletedJobStats failed:', err);
    }

    return { perNode, perType, total };
  }, []);

  return {
    getJob,
    getJobs,
    getTotalJobs,
    getTotalVolume,
    getSettleableAt,
    getPendingWithdrawal,
    getAllJobCounts,
    getCompletedJobStats,
    createJob,
    extendJob,
    acceptJob,
    completeJob,
    cancelJob,
    settleExpiredJob,
    withdrawPending,
  };
}
