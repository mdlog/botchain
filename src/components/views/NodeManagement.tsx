import React, { useEffect, useState } from 'react';
import {
  PlusCircle,
  Activity,
  Cpu,
  AlertTriangle,
  ShieldCheck,
  Briefcase,
  CheckCircle2,
  Play,
  Power,
  Server,
  Wallet,
  ScanSearch,
} from 'lucide-react';
import { PageShell, PageHeader, SectionHeader } from '@/components/layout/PageShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, StatusDot } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select } from '@/components/ui/Field';
import { Stat } from '@/components/ui/Stat';
import { Skeleton, SkeletonStats } from '@/components/ui/Skeleton';
import { useWalletContext } from '@/context/WalletContext';
import { useToast } from '@/context/ToastContext';
import { useComputeRegistry } from '@/hooks/useComputeRegistry';
import { useComputeMarketplace } from '@/hooks/useComputeMarketplace';
import { formatBOT, formatBOTCompact, formatAddress, formatNodeId } from '@/lib/format';
import {
  JOB_ACTIVE,
  JOB_PENDING,
  NODE_STATUS_ACTIVE,
  jobStatus,
  leaseCountdown,
} from '@/lib/domain';
import { describeTxError } from '@/lib/tx';
import { fetchAgentInfo } from '@/lib/agentApi';
import { detectHardware, getTflopsForModel, type HardwareInfo } from '@/lib/hardware-detect';
import { getProviderAgentUrl } from '@/config/providers';
import { cn } from '@/lib/utils';

interface NodeRow {
  nodeId: bigint;
  provider: string;
  model: string;
  vramGB: number;
  tflops: number;
  region: string;
  status: number;
  totalRevenue: bigint;
  verified: boolean;
  registeredAt: number;
  lastHeartbeat: number;
}

const GPU_OPTIONS = [
  { model: 'NVIDIA H100', vram: 80, tflops: 989 },
  { model: 'NVIDIA A100', vram: 80, tflops: 624 },
  { model: 'NVIDIA RTX 4090', vram: 24, tflops: 165 },
  { model: 'NVIDIA RTX 3090', vram: 24, tflops: 71 },
  { model: 'NVIDIA RTX 3060', vram: 12, tflops: 13 },
  { model: 'AMD Radeon GPU', vram: 12, tflops: 10 },
  { model: 'CPU Only', vram: 0, tflops: 0 },
];

// TFLOPS lookup for per-GPU estimation
const GPU_TFLOPS: Record<string, number> = {
  'nvidia h100': 989,
  'nvidia a100': 624,
  'nvidia rtx 5090': 105,
  'nvidia rtx 4090': 165,
  'nvidia rtx 4080': 97,
  'nvidia rtx 4070': 48,
  'nvidia rtx 3090': 71,
  'nvidia rtx 3080': 35,
  'nvidia rtx 3070': 21,
  'nvidia rtx 3060 ti': 8,
  'nvidia rtx 3060': 13,
  'nvidia rtx 3050': 6,
  'nvidia gtx 1660': 14,
  'nvidia gtx 1080': 9,
  'nvidia gtx 1070': 6.5,
};

function getTflopsForGpuModel(model: string): number {
  const m = model.toLowerCase();
  for (const [key, val] of Object.entries(GPU_TFLOPS)) {
    if (m.includes(key)) return val;
  }
  return 10; // fallback
}

const REGIONS = ['US-EAST', 'US-WEST', 'EU-CENTRAL', 'EU-WEST', 'AP-SOUTH', 'AP-NORTHEAST'];

const NODE_STATUS = [
  { label: 'Inactive', tone: 'neutral' as const },
  { label: 'Active', tone: 'success' as const },
  { label: 'Busy', tone: 'accent' as const },
  { label: 'Offline', tone: 'danger' as const },
];

interface JobRow {
  jobId: bigint;
  nodeId: bigint;
  consumer: string;
  jobType: string;
  pricePerHourWei: bigint;
  durationHours: bigint;
  status: number;
  startedAt: number;
  paymentAmount: bigint;
}

export function NodeManagement() {
  const { address } = useWalletContext();
  const toast = useToast();
  const { getProviderNodes, getNode, getVerifier, registerNode, updateNodeStatus, verifyNode } =
    useComputeRegistry();
  const { getJob, getTotalJobs, acceptJob, completeJob } = useComputeMarketplace();

  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [showRegister, setShowRegister] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  // Form state
  const [formModel, setFormModel] = useState(GPU_OPTIONS[0].model);
  const [formVram, setFormVram] = useState(GPU_OPTIONS[0].vram);
  const [formTflops, setFormTflops] = useState(GPU_OPTIONS[0].tflops);
  const [formRegion, setFormRegion] = useState(REGIONS[0]);
  const [, setFormGpuCount] = useState(1);
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [dupError, setDupError] = useState<string | null>(null);
  // Current unix second. Held in state rather than read during render so the
  // countdown stays a pure function of its props.
  const [tick, setTick] = useState(() => Math.floor(Date.now() / 1000));

  /**
   * Attestation is the registry verifier's call, not the provider's — a node
   * that could vouch for itself made the "verified" badge worthless. Offering
   * the button to everyone would just be a guaranteed revert, so the action
   * only appears for the wallet that actually holds the role.
   */
  const [verifier, setVerifier] = useState<string | null>(null);
  useEffect(() => {
    getVerifier()
      .then(setVerifier)
      .catch((err: unknown) => console.warn('[NodeManagement] verifier lookup failed:', err));
  }, [getVerifier]);
  const isVerifier = verifier !== null && address?.toLowerCase() === verifier.toLowerCase();

  // Live countdown ticker
  useEffect(() => {
    const hasActiveJobs = jobs.some((j) => j.status === JOB_ACTIVE);
    if (!hasActiveJobs) return;
    const interval = setInterval(() => setTick(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, [jobs]);

  async function reloadNodes() {
    if (!address) return;
    const nodeIds = await getProviderNodes(address);
    const details: NodeRow[] = [];
    for (const id of nodeIds) {
      try {
        const node = await getNode(id);
        if (node) {
          details.push({
            nodeId: id,
            provider: node.provider,
            model: node.specs?.model || 'Unknown',
            vramGB: Number(node.specs?.vramGB || 0),
            tflops: Number(node.specs?.tflops || 0),
            region: node.specs?.region || 'Unknown',
            status: Number(node.status),
            totalRevenue: node.totalRevenue,
            verified: node.verified,
            registeredAt: Number(node.registeredAt),
            lastHeartbeat: Number(node.lastHeartbeat),
          });
        }
      } catch (err) {
        console.warn('[NodeManagement] skipping unreadable node', err);
      }
    }
    setNodes(details);
  }

  // Load provider's jobs
  async function loadJobs() {
    if (!address) {
      setJobsLoading(false);
      return;
    }
    setJobsLoading(true);
    try {
      const total = await getTotalJobs();
      const jobList: JobRow[] = [];
      for (let i = 1; i <= Number(total); i++) {
        try {
          const job = await getJob(BigInt(i));
          if (job && job.provider?.toLowerCase() === address.toLowerCase()) {
            jobList.push({
              jobId: BigInt(i),
              nodeId: job.nodeId,
              consumer: job.consumer,
              jobType: job.jobType,
              pricePerHourWei: job.pricePerHourWei,
              durationHours: job.durationHours,
              status: Number(job.status),
              startedAt: Number(job.startedAt),
              paymentAmount: job.paymentAmount,
            });
          }
        } catch (err) {
          console.warn('[NodeManagement] skipping unreadable job', i, err);
        }
      }
      setJobs(jobList);
    } catch (err) {
      console.error('[NodeManagement] Jobs load failed:', err);
    } finally {
      setJobsLoading(false);
    }
  }

  useEffect(() => {
    void loadJobs();
  }, [address]);

  useEffect(() => {
    async function loadNodes() {
      if (!address) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        await reloadNodes();
      } catch (err) {
        console.error('[NodeManagement] Load failed:', err);
      } finally {
        setLoading(false);
      }
    }
    void loadNodes();
  }, [address]);

  async function handleAcceptJob(jobId: bigint) {
    setTxPending(true);
    try {
      await acceptJob(jobId);
      // startedAt comes from the block, not the browser clock — reading it back
      // is the only way the countdown matches what the contract will settle on.
      await loadJobs();
      toast.success(`Job #${jobId.toString()} accepted`, {
        description: 'The consumer can now run workloads on this node.',
      });
    } catch (err) {
      console.error('[NodeManagement] accept job failed:', err);
      toast.error('Job was not accepted', { description: describeTxError(err) });
    } finally {
      setTxPending(false);
    }
  }

  async function handleCompleteJob(jobId: bigint) {
    setTxPending(true);
    try {
      await completeJob(jobId);
      await Promise.all([loadJobs(), reloadNodes()]);
      toast.success(`Job #${jobId.toString()} completed`, {
        description: 'Paid for the time actually used; the balance went back to the consumer.',
      });
    } catch (err) {
      console.error('[NodeManagement] complete job failed:', err);
      toast.error('Job was not completed', { description: describeTxError(err) });
    } finally {
      setTxPending(false);
    }
  }

  async function handleAutoDetect() {
    setDetecting(true);
    setDupError(null);
    try {
      // First: try agent-side detection via provider's own agent
      const agentUrl = address ? getProviderAgentUrl(address) : '';
      const agentInfo = agentUrl ? await fetchAgentInfo(agentUrl) : null;
      const agentGpus = agentInfo?.gpuSummary?.count ? agentInfo.gpuSummary : null;

      if (agentGpus) {
        // Agent detected GPUs via nvidia-smi — use this (most accurate)
        const unifiedModel = agentGpus.unifiedModel ?? '';
        const count = agentGpus.count ?? 1;
        const totalVramGB = Math.round((agentGpus.totalVramMb ?? 0) / 1024);

        // Estimate TFLOPS: per-GPU × count
        const firstModel = agentGpus.models?.[0] ?? unifiedModel;
        const totalTflops = Math.round(getTflopsForGpuModel(firstModel) * count * 10) / 10;

        const existing = nodes.find((n) => n.model.toLowerCase() === unifiedModel.toLowerCase());
        if (existing) {
          setDupError(`${unifiedModel} is already registered as ${formatNodeId(existing.nodeId)}.`);
          return;
        }

        setFormModel(unifiedModel);
        setFormVram(totalVramGB);
        setFormTflops(totalTflops);
        setFormGpuCount(count);
        setHardware({
          gpuModel: unifiedModel,
          vramGB: totalVramGB,
          cpuCores: navigator.hardwareConcurrency || 0,
          cpuModel: '',
          ramGB: navigator.deviceMemory ?? 0,
          storageGB: 0,
          screen: '',
          detected: true,
          rawGpuString: `${count}× ${firstModel}`,
          fingerprint: '',
          hasGpu: true,
        });
        toast.success('Hardware detected from your agent', {
          description: `${count}× ${firstModel} · ${totalVramGB} GB VRAM`,
        });
        return;
      }

      // Fallback: browser WebGL detection (single GPU only)
      const info = await detectHardware();
      setHardware(info);
      setFormGpuCount(1);
      const existingLabel = info.hasGpu ? info.gpuModel : `CPU-${info.cpuCores}cores`;
      const existing = nodes.find((n) => n.model.toLowerCase() === existingLabel.toLowerCase());
      if (existing) {
        setDupError(`${existingLabel} is already registered as ${formatNodeId(existing.nodeId)}.`);
        return;
      }
      if (info.hasGpu) {
        const match = GPU_OPTIONS.find((g) =>
          info.gpuModel.toLowerCase().includes(g.model.toLowerCase().replace('nvidia ', '')),
        );
        if (match) {
          setFormModel(match.model);
          setFormVram(match.vram);
          setFormTflops(match.tflops);
        } else {
          setFormModel(info.gpuModel);
          setFormVram(info.vramGB || 12);
          setFormTflops(getTflopsForModel(info.gpuModel, 0, true) || 10);
        }
      } else {
        setFormModel('CPU Only');
        setFormVram(0);
        setFormTflops(getTflopsForModel('CPU Only', info.cpuCores, false));
      }
      toast.info('Hardware read from your browser', {
        description: 'Browser detection is approximate — check the values before registering.',
      });
    } catch (err) {
      console.error('[NodeManagement] Auto-detect failed:', err);
      toast.error('Could not detect hardware', {
        description: 'Enter the specs manually instead.',
      });
    } finally {
      setDetecting(false);
    }
  }

  async function handleRegister() {
    if (!address) return;
    const existing = nodes.find((n) => n.model.toLowerCase() === formModel.toLowerCase());
    if (existing) {
      setDupError(`${formModel} is already registered as ${formatNodeId(existing.nodeId)}.`);
      return;
    }
    setDupError(null);
    setTxPending(true);
    try {
      // TFLOPS is a uint16 on chain; auto-detection can produce a fraction,
      // which throws while encoding before a transaction is ever built.
      const hash = await registerNode(formModel, formVram, Math.round(formTflops), formRegion);
      setShowRegister(false);
      setHardware(null);
      await reloadNodes();
      toast.success('Node registered', {
        description: `${formModel} in ${formRegion} is on-chain. Set it active, then the registry verifier attests it.`,
        txHash: hash,
      });
    } catch (err) {
      console.error('[NodeManagement] register failed:', err);
      toast.error('Node was not registered', { description: describeTxError(err) });
    } finally {
      setTxPending(false);
    }
  }

  async function handleStatusChange(nodeId: bigint, newStatus: number) {
    setTxPending(true);
    try {
      await updateNodeStatus(nodeId, newStatus);
      setNodes((prev) => prev.map((n) => (n.nodeId === nodeId ? { ...n, status: newStatus } : n)));
      toast.success(
        newStatus === NODE_STATUS_ACTIVE
          ? `${formatNodeId(nodeId)} is now active`
          : `${formatNodeId(nodeId)} is now inactive`,
        {
          description:
            newStatus === NODE_STATUS_ACTIVE
              ? 'It will appear in Explore and can receive jobs.'
              : 'It stops appearing in Explore until you set it active again.',
        },
      );
    } catch (err) {
      console.error('[NodeManagement] status change failed:', err);
      toast.error('Status was not changed', { description: describeTxError(err) });
    } finally {
      setTxPending(false);
    }
  }

  async function handleVerify(nodeId: bigint) {
    setTxPending(true);
    try {
      await verifyNode(nodeId);
      setNodes((prev) => prev.map((n) => (n.nodeId === nodeId ? { ...n, verified: true } : n)));
      toast.success(`${formatNodeId(nodeId)} attested`, {
        description: 'Attested nodes can be leased and can deposit revenue to mint CIF.',
      });
    } catch (err) {
      console.error('[NodeManagement] attestation failed:', err);
      toast.error('Node was not attested', { description: describeTxError(err) });
    } finally {
      setTxPending(false);
    }
  }

  const header = (
    <PageHeader
      title="My Nodes"
      description="Register compute hardware on-chain, control availability, and settle the jobs it runs."
      actions={
        address && (
          <Button variant="primary" icon={PlusCircle} onClick={() => setShowRegister(true)}>
            Register node
          </Button>
        )
      }
    />
  );

  if (!address) {
    return (
      <PageShell>
        {header}
        <EmptyState
          icon={Server}
          title="Connect a wallet to manage nodes"
          description="Registering hardware and settling jobs are on-chain actions signed by your account."
        />
      </PageShell>
    );
  }

  const totalRevenue = nodes.reduce((s, n) => s + n.totalRevenue, 0n);
  const pendingJobs = jobs.filter((j) => j.status === 0).length;

  return (
    <PageShell>
      {header}

      {loading ? (
        <div className="flex flex-col gap-4">
          <SkeletonStats count={4} />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : nodes.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No nodes registered"
          description="Register your GPU or CPU hardware to start receiving compute jobs from the network."
          action={
            <Button variant="primary" icon={PlusCircle} onClick={() => setShowRegister(true)}>
              Register your first node
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {/* ── Fleet ── */}
          <section>
            <SectionHeader
              icon={Activity}
              title="Fleet"
              description="Your registered hardware at a glance"
            />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Nodes" value={nodes.length.toString()} icon={Server} />
              <Stat
                label="Active"
                value={nodes.filter((n) => n.status === 1).length.toString()}
                detail="visible in Explore"
                icon={Activity}
                tone="success"
              />
              <Stat
                label="Verified"
                value={nodes.filter((n) => n.verified).length.toString()}
                detail="eligible for CIF"
                icon={ShieldCheck}
                tone="accent"
              />
              <Stat
                label="Lifetime revenue"
                value={formatBOTCompact(totalRevenue)}
                unit="DGRAM"
                icon={Wallet}
                tone="success"
              />
            </div>
          </section>

          {/* ── Node table ── */}
          <section>
            <SectionHeader
              icon={Cpu}
              title="Nodes"
              description="Availability and earnings per machine"
            />
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-outline-variant bg-surface-container/50">
                      <Th>Node</Th>
                      <Th>Status</Th>
                      <Th>Specs</Th>
                      <Th>Region</Th>
                      <Th className="text-right">Revenue</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodes.map((node) => {
                      const status = NODE_STATUS[node.status] ?? NODE_STATUS[0];
                      return (
                        <tr
                          key={node.nodeId.toString()}
                          className="border-b border-outline-variant transition-colors last:border-0 hover:bg-surface-container/40"
                        >
                          <Td>
                            <div className="flex items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container text-on-surface-variant">
                                <Cpu className="h-4 w-4" aria-hidden />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-label text-on-surface">{node.model}</p>
                                <p
                                  className="font-mono text-caption text-outline"
                                  title={node.nodeId.toString()}
                                >
                                  {formatNodeId(node.nodeId)}
                                </p>
                              </div>
                            </div>
                          </Td>
                          <Td>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge tone={status.tone}>
                                <StatusDot
                                  tone={status.tone}
                                  live={node.status === 1}
                                  className="mr-0.5"
                                />
                                {status.label}
                              </Badge>
                              {node.verified && (
                                <ShieldCheck
                                  className="h-3.5 w-3.5 text-compute-active"
                                  aria-label="Verified"
                                />
                              )}
                            </div>
                          </Td>
                          <Td>
                            <p className="font-mono text-caption text-on-surface">
                              {node.vramGB > 0 ? `${node.vramGB} GB VRAM` : 'CPU only'}
                            </p>
                            <p className="font-mono text-caption text-outline">
                              {node.tflops} TFLOPS
                            </p>
                          </Td>
                          <Td>
                            <span className="text-caption text-on-surface-variant">
                              {node.region}
                            </span>
                          </Td>
                          <Td className="text-right">
                            <p className="font-mono text-label text-primary">
                              {formatBOT(node.totalRevenue)}
                            </p>
                            <p className="text-caption text-outline">DGRAM lifetime</p>
                          </Td>
                          <Td className="text-right">
                            <div className="flex justify-end gap-1.5">
                              {node.status !== 1 ? (
                                <Button
                                  size="sm"
                                  variant="success"
                                  icon={Play}
                                  disabled={txPending}
                                  onClick={() =>
                                    void handleStatusChange(node.nodeId, NODE_STATUS_ACTIVE)
                                  }
                                >
                                  Activate
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  icon={Power}
                                  disabled={txPending}
                                  onClick={() => void handleStatusChange(node.nodeId, 0)}
                                >
                                  Pause
                                </Button>
                              )}
                              {!node.verified &&
                                (isVerifier ? (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    icon={ShieldCheck}
                                    disabled={txPending}
                                    onClick={() => void handleVerify(node.nodeId)}
                                  >
                                    Attest
                                  </Button>
                                ) : (
                                  <span
                                    className="text-caption text-outline"
                                    title={verifier ? `Registry verifier: ${verifier}` : undefined}
                                  >
                                    Awaiting attestation
                                  </span>
                                ))}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>

          {/* ── Job queue ── */}
          <section>
            <SectionHeader
              icon={Briefcase}
              title="Job queue"
              description="Work consumers have booked on your nodes"
              actions={
                pendingJobs > 0 ? (
                  <Badge tone="warning">{pendingJobs} awaiting you</Badge>
                ) : undefined
              }
            />

            {jobsLoading ? (
              <Skeleton className="h-40 w-full rounded-xl" />
            ) : jobs.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                title="No jobs yet"
                description="When someone leases your compute from Explore, the job lands here for you to accept."
              />
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[52rem] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-outline-variant bg-surface-container/50">
                        <Th>Job</Th>
                        <Th>Node</Th>
                        <Th>Workload</Th>
                        <Th>Consumer</Th>
                        <Th className="text-right">Payment</Th>
                        <Th className="text-right">Action</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((job) => {
                        const status = jobStatus(job.status);
                        return (
                          <tr
                            key={job.jobId.toString()}
                            className="border-b border-outline-variant transition-colors last:border-0 hover:bg-surface-container/40"
                          >
                            <Td>
                              <p className="font-mono text-label text-on-surface">
                                #{job.jobId.toString()}
                              </p>
                              <Badge tone={status.tone} className="mt-1">
                                {status.label}
                              </Badge>
                            </Td>
                            <Td>
                              <span
                                className="font-mono text-caption text-on-surface-variant"
                                title={job.nodeId.toString()}
                              >
                                {formatNodeId(job.nodeId)}
                              </span>
                            </Td>
                            <Td>
                              <p className="text-caption text-on-surface">{job.jobType}</p>
                              <p className="font-mono text-caption text-outline">
                                {job.durationHours.toString()}h booked
                              </p>
                            </Td>
                            <Td>
                              <span
                                className="font-mono text-caption text-on-surface-variant"
                                title={job.consumer}
                              >
                                {formatAddress(job.consumer)}
                              </span>
                            </Td>
                            <Td className="text-right">
                              <p className="font-mono text-label text-primary">
                                {formatBOT(BigInt(job.pricePerHourWei) * BigInt(job.durationHours))}
                              </p>
                              <p className="text-caption text-outline">DGRAM total</p>
                            </Td>
                            <Td className="text-right">
                              <JobAction
                                job={job}
                                tick={tick}
                                txPending={txPending}
                                onAccept={() => void handleAcceptJob(job.jobId)}
                                onComplete={() => void handleCompleteJob(job.jobId)}
                              />
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </section>
        </div>
      )}

      {/* ── Register dialog ── */}
      <Modal
        open={showRegister}
        onClose={() => setShowRegister(false)}
        icon={Server}
        title="Register a compute node"
        description="Publish your hardware to the on-chain registry so consumers can lease it."
        className="sm:max-w-2xl"
        footer={
          <>
            <Button
              variant="primary"
              fullWidth
              loading={txPending}
              onClick={() => void handleRegister()}
            >
              {txPending ? 'Confirming' : 'Register on-chain'}
            </Button>
            <Button variant="ghost" onClick={() => setShowRegister(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Button
            variant="secondary"
            icon={ScanSearch}
            loading={detecting}
            onClick={() => void handleAutoDetect()}
          >
            {detecting ? 'Detecting hardware' : 'Detect my hardware'}
          </Button>

          {dupError && (
            <div className="flex items-start gap-2.5 rounded-lg border border-compute-down/30 bg-compute-down/8 px-3.5 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-compute-down" aria-hidden />
              <p className="text-caption text-on-surface-variant">{dupError}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="GPU model">
              {(p) => (
                <Select
                  {...p}
                  value={GPU_OPTIONS.some((g) => g.model === formModel) ? formModel : ''}
                  onChange={(e) => {
                    const opt = GPU_OPTIONS.find((g) => g.model === e.target.value);
                    if (!opt) return;
                    setFormModel(opt.model);
                    setFormVram(opt.vram);
                    setFormTflops(opt.tflops);
                  }}
                >
                  {/* A detected model may not be in the preset list; show it
                      so the field never appears blank after auto-detect. */}
                  {!GPU_OPTIONS.some((g) => g.model === formModel) && (
                    <option value="">{formModel} (detected)</option>
                  )}
                  {GPU_OPTIONS.map((g) => (
                    <option key={g.model} value={g.model}>
                      {g.model}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Region">
              {(p) => (
                <Select {...p} value={formRegion} onChange={(e) => setFormRegion(e.target.value)}>
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="VRAM (GB)" hint="0 for CPU-only nodes.">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  value={formVram}
                  onChange={(e) => setFormVram(Number(e.target.value))}
                />
              )}
            </Field>

            <Field label="TFLOPS" hint="Peak throughput, used for ranking.">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  value={formTflops}
                  onChange={(e) => setFormTflops(Number(e.target.value))}
                />
              )}
            </Field>
          </div>

          {hardware && (
            <div className="rounded-lg border border-outline-variant bg-surface-container p-4">
              <p className="mb-3 text-eyebrow uppercase text-on-surface-variant">
                Detected hardware
              </p>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <DetectRow label="GPU" value={hardware.hasGpu ? hardware.gpuModel : 'CPU only'} />
                <DetectRow label="CPU" value={`${hardware.cpuCores || '?'} threads`} />
                <DetectRow
                  label="RAM"
                  value={hardware.ramGB ? `${hardware.ramGB} GB` : 'Unknown'}
                />
                <DetectRow
                  label="Storage"
                  value={hardware.storageGB > 0 ? `${hardware.storageGB} GB` : 'Unknown'}
                />
              </dl>
              {hardware.rawGpuString && (
                <p className="mt-3 border-t border-outline-variant pt-3 font-mono text-caption text-outline">
                  {hardware.rawGpuString}
                </p>
              )}
            </div>
          )}
        </div>
      </Modal>
    </PageShell>
  );
}

/* ── Small pieces ─────────────────────────────────────── */

function JobAction({
  job,
  tick,
  txPending,
  onAccept,
  onComplete,
}: {
  job: JobRow;
  tick: number;
  txPending: boolean;
  onAccept: () => void;
  onComplete: () => void;
}) {
  if (job.status === JOB_PENDING) {
    return (
      <Button size="sm" variant="success" icon={Play} disabled={txPending} onClick={onAccept}>
        Accept
      </Button>
    );
  }

  if (job.status === JOB_ACTIVE) {
    // `tick` is the current unix second, supplied by the parent's interval.
    // Reading Date.now() here instead made the render impure — the same props
    // produced a different tree on every call.
    const { secondsLeft: remaining, label: clock } = leaseCountdown(
      job.startedAt,
      Number(job.durationHours),
      tick,
    );
    const urgency =
      remaining < 300
        ? 'text-compute-down'
        : remaining < 900
          ? 'text-compute-idle'
          : 'text-on-surface-variant';

    if (remaining === 0) {
      return (
        <Button
          size="sm"
          variant="primary"
          icon={CheckCircle2}
          disabled={txPending}
          onClick={onComplete}
        >
          Settle
        </Button>
      );
    }
    return (
      <div className="flex flex-col items-end gap-1">
        <span className={cn('font-mono text-caption font-semibold', urgency)}>{clock}</span>
        <span className="text-caption text-outline">settles when the lease ends</span>
      </div>
    );
  }

  return <span className="text-caption text-outline">—</span>;
}

function DetectRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-eyebrow uppercase text-outline">{label}</dt>
      <dd className="mt-0.5 truncate text-caption text-on-surface" title={value}>
        {value}
      </dd>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn('px-4 py-3 text-eyebrow uppercase text-outline', className)}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-4 py-3 align-middle', className)}>{children}</td>;
}
