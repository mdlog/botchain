/**
 * useComputeSession — hook linking on-chain jobs to off-chain compute execution.
 *
 * Consumer flow:
 * 1. Lease compute on Marketplace → get jobId
 * 2. Open Compute Session tab → select active job
 * 3. Write code → POST to provider agent → get result
 * 4. View output, iterate
 *
 * Provider agent URL is resolved from the job's provider address via config map.
 * See src/config/providers.ts
 */

import { useState, useEffect, useCallback } from 'react';
import { useWalletContext } from '@/context/WalletContext';
import { useComputeMarketplace } from '@/hooks/useComputeMarketplace';
import { getProviderAgentUrl } from '@/config/providers';

export interface ComputeJobInfo {
  jobId: bigint;
  nodeId: bigint;
  consumer: string;
  provider: string;
  jobType: string;
  status: number; // 0=Pending, 1=Active, 2=Completed, 3=Cancelled, 4=Disputed
  durationHours: bigint;
  startedAt: bigint;
  pricePerHourWei: bigint;
}

export interface ExecutionResult {
  executionId: string;
  status: 'completed' | 'error' | 'running';
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number; // ms
}

export function useComputeSession() {
  const { address } = useWalletContext();
  const { getJob, getTotalJobs } = useComputeMarketplace();

  const [jobs, setJobs] = useState<ComputeJobInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);

  // Load consumer's active jobs
  const loadJobs = useCallback(async () => {
    if (!address) { setLoading(false); return; }
    setLoading(true);
    try {
      const total = await getTotalJobs();
      const consumerJobs: ComputeJobInfo[] = [];
      for (let i = 1; i <= Number(total); i++) {
        try {
          const job = await getJob(BigInt(i)) as any;
          if (job && job.consumer?.toLowerCase() === address.toLowerCase()) {
            consumerJobs.push({
              jobId: BigInt(i),
              nodeId: job.nodeId,
              consumer: job.consumer,
              provider: job.provider,
              jobType: job.jobType,
              status: Number(job.status),
              durationHours: job.durationHours,
              startedAt: job.startedAt,
              pricePerHourWei: job.pricePerHourWei,
            });
          }
        } catch {}
      }
      // Sort: Active first, then by jobId desc
      consumerJobs.sort((a, b) => {
        if (a.status === 1 && b.status !== 1) return -1;
        if (a.status !== 1 && b.status === 1) return 1;
        return Number(b.jobId - a.jobId);
      });
      setJobs(consumerJobs);
    } catch (err) {
      console.error('[useComputeSession] Load jobs failed:', err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Execute code on provider's machine via their agent
  const executeCode = useCallback(async (
    jobId: bigint,
    nodeId: bigint,
    language: 'python3' | 'node',
    code: string,
  ): Promise<ExecutionResult> => {
    setExecuting(true);
    try {
      // Resolve agent URL from the job's provider address
      const job = jobs.find(j => j.jobId === jobId);
      const providerAddr = job?.provider || '';
      const url = getProviderAgentUrl(providerAddr);

      if (!url) {
        return {
          executionId: 'error',
          status: 'error',
          exitCode: -1,
          stdout: '',
          stderr: `No agent URL registered for provider ${providerAddr.slice(0, 10)}...`,
          duration: 0,
        };
      }

      const res = await fetch(`${url}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: Number(jobId),
          language,
          code,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          executionId: data.executionId || 'error',
          status: 'error',
          exitCode: -1,
          stdout: '',
          stderr: data.error || 'Execution failed',
          duration: 0,
        };
      }
      return {
        executionId: data.executionId,
        status: data.status || 'completed',
        exitCode: data.exitCode ?? 0,
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        duration: data.duration || 0,
      };
    } catch (err: any) {
      return {
        executionId: 'error',
        status: 'error',
        exitCode: -1,
        stdout: '',
        stderr: err.message || `Network error — is provider agent reachable?`,
        duration: 0,
      };
    } finally {
      setExecuting(false);
    }
  }, [jobs]);

  // Get provider agent info for a specific job (by provider address)
  const getProviderInfo = useCallback(async (jobId: bigint) => {
    try {
      const job = jobs.find(j => j.jobId === jobId);
      const providerAddr = job?.provider || '';
      const url = getProviderAgentUrl(providerAddr);
      if (!url) return null;
      const res = await fetch(`${url}/info`);
      return await res.json();
    } catch (err) {
      return null;
    }
  }, [jobs]);

  // Get agent URL for a job (resolved by provider address, not nodeId)
  const getAgentUrl = useCallback((jobId: bigint) => {
    const job = jobs.find(j => j.jobId === jobId);
    const providerAddr = job?.provider || '';
    return getProviderAgentUrl(providerAddr);
  }, [jobs]);

  return {
    jobs,
    loading,
    executing,
    executeCode,
    getProviderInfo,
    getAgentUrl,
    reloadJobs: loadJobs,
  };
}
