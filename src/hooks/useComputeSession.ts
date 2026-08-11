/**
 * Links on-chain leases to off-chain execution on the provider's agent.
 *
 * Consumer flow: lease on Explore → pick the job here → send code to the
 * provider's agent → read the result.
 *
 * The agent URL comes from the on-chain AgentRegistry, with a static map as a
 * fallback for providers that registered before it existed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getProviderAgentUrlAsync } from '@/config/providers';
import { useWalletContext } from '@/context/WalletContext';
import { useComputeMarketplace } from '@/hooks/useComputeMarketplace';
import {
  executeOnAgent,
  fetchAgentInfo,
  signChallenge,
  type AgentInfo,
  type ExecutionResult,
} from '@/lib/agentApi';
import { JOB_ACTIVE } from '@/lib/domain';

export interface ComputeJobInfo {
  jobId: bigint;
  nodeId: bigint;
  consumer: string;
  provider: string;
  jobType: string;
  status: number;
  durationHours: bigint;
  startedAt: bigint;
  pricePerHourWei: bigint;
  paymentAmount: bigint;
}

export type { ExecutionResult };

/** provider address → agent URL. Resolution is a chain read, so it is cached. */
const agentUrlCache = new Map<string, string>();

export function useComputeSession() {
  const { address, signMessage } = useWalletContext();
  const { getJob, getJobs, getTotalJobs } = useComputeMarketplace();

  const [jobs, setJobs] = useState<ComputeJobInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);

  // Guards against a slow earlier load landing after a newer one and winning.
  const loadGeneration = useRef(0);

  const loadJobs = useCallback(async () => {
    if (!address) {
      setJobs([]);
      setLoading(false);
      return;
    }

    const generation = ++loadGeneration.current;
    setLoading(true);
    try {
      const total = Number(await getTotalJobs());
      const ids = Array.from({ length: total }, (_, i) => BigInt(i + 1));
      const all = await getJobs(ids);

      const mine = all
        .map((job, index): ComputeJobInfo | null => {
          if (job.consumer.toLowerCase() !== address.toLowerCase()) return null;
          return {
            jobId: ids[index],
            nodeId: job.nodeId,
            consumer: job.consumer,
            provider: job.provider,
            jobType: job.jobType,
            status: Number(job.status),
            durationHours: job.durationHours,
            startedAt: job.startedAt,
            pricePerHourWei: job.pricePerHourWei,
            paymentAmount: job.paymentAmount,
          };
        })
        .filter((job): job is ComputeJobInfo => job !== null)
        .sort((a, b) => {
          if (a.status === JOB_ACTIVE && b.status !== JOB_ACTIVE) return -1;
          if (a.status !== JOB_ACTIVE && b.status === JOB_ACTIVE) return 1;
          return Number(b.jobId - a.jobId);
        });

      if (generation === loadGeneration.current) setJobs(mine);
    } catch (err) {
      console.error('[useComputeSession] load jobs failed:', err);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [address, getJobs, getTotalJobs]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const resolveAgentUrl = useCallback(async (providerAddress: string): Promise<string> => {
    if (!providerAddress) return '';
    const key = providerAddress.toLowerCase();
    const cached = agentUrlCache.get(key);
    if (cached !== undefined) return cached;
    const url = await getProviderAgentUrlAsync(providerAddress);
    agentUrlCache.set(key, url);
    return url;
  }, []);

  // `executeCode` must read the current job list without being recreated on
  // every load, or the editor would lose its handler mid-run.
  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const agentUrlForJob = useCallback(
    (jobId: bigint): Promise<string> => {
      const job = jobsRef.current.find((j) => j.jobId === jobId);
      return resolveAgentUrl(job?.provider ?? '');
    },
    [resolveAgentUrl],
  );

  const executeCode = useCallback(
    async (jobId: bigint, language: 'python3' | 'node', code: string): Promise<ExecutionResult> => {
      const fail = (stderr: string): ExecutionResult => ({
        executionId: 'error',
        status: 'error',
        exitCode: -1,
        stdout: '',
        stderr,
        durationMs: 0,
      });

      if (!address) return fail('Connect a wallet to run code on leased compute.');

      setExecuting(true);
      try {
        const job = jobsRef.current.find((j) => j.jobId === jobId);
        const url = await resolveAgentUrl(job?.provider ?? '');
        if (!url) {
          return fail(`No agent endpoint registered for provider ${job?.provider ?? 'unknown'}`);
        }

        const auth = await signChallenge('execute', jobId, address, signMessage);
        return await executeOnAgent(url, jobId, language, code, auth);
      } catch (err) {
        return fail(
          err instanceof Error ? err.message : 'Network error — is the provider agent reachable?',
        );
      } finally {
        setExecuting(false);
      }
    },
    [address, resolveAgentUrl, signMessage],
  );

  const getProviderInfo = useCallback(
    async (jobId: bigint): Promise<AgentInfo | null> => {
      const url = await agentUrlForJob(jobId);
      return url ? fetchAgentInfo(url) : null;
    },
    [agentUrlForJob],
  );

  const refreshJob = useCallback(
    async (jobId: bigint) => {
      const job = await getJob(jobId);
      setJobs((current) =>
        current.map((j) =>
          j.jobId === jobId
            ? {
                ...j,
                status: Number(job.status),
                durationHours: job.durationHours,
                startedAt: job.startedAt,
                paymentAmount: job.paymentAmount,
              }
            : j,
        ),
      );
    },
    [getJob],
  );

  return {
    jobs,
    loading,
    executing,
    executeCode,
    getProviderInfo,
    getAgentUrl: agentUrlForJob,
    refreshJob,
    reloadJobs: loadJobs,
  };
}
