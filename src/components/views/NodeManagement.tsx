import React, { useEffect, useState } from 'react';
import { PlusCircle, Activity, Cpu, AlertTriangle, ShieldCheck, Briefcase, CheckCircle, Play } from 'lucide-react';
import { useWalletContext } from '@/context/WalletContext';
import { useComputeRegistry } from '@/hooks/useComputeRegistry';
import { useComputeMarketplace } from '@/hooks/useComputeMarketplace';
import { formatBOT, formatBOTCompact, timeAgo, formatAddress } from '@/lib/format';
import { detectHardware, getTflopsForModel, type HardwareInfo } from '@/lib/hardware-detect';

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
  { model: 'CPU Only', vram: 0, tflops: 0 },
];

const REGIONS = ['US-EAST', 'US-WEST', 'EU-CENTRAL', 'EU-WEST', 'AP-SOUTH', 'AP-NORTHEAST'];
const STATUS_LABELS = ['Inactive', 'Active', 'Busy', 'Offline'];
const STATUS_COLORS = ['bg-compute-idle', 'bg-compute-active', 'bg-compute-idle', 'bg-compute-down'];

interface JobRow {
  jobId: bigint;
  nodeId: bigint;
  consumer: string;
  jobType: string;
  pricePerHourWei: bigint;
  durationHours: bigint;
  status: number;
  startedAt: number;
}

const JOB_LABELS = ['Pending', 'Active', 'Completed', 'Cancelled', 'Disputed'];
const JOB_COLORS = ['text-yellow-400', 'text-compute-active', 'text-primary', 'text-outline', 'text-compute-down'];

export function NodeManagement() {
  const { address } = useWalletContext();
  const { getProviderNodes, getNode, registerNode, updateNodeStatus, verifyNode } = useComputeRegistry();
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
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [dupError, setDupError] = useState<string | null>(null);

  // Load provider's jobs
  async function loadJobs() {
    if (!address) { setJobsLoading(false); return; }
    setJobsLoading(true);
    try {
      const total = await getTotalJobs();
      const jobList: JobRow[] = [];
      for (let i = 1; i <= Number(total); i++) {
        try {
          const job = await getJob(BigInt(i)) as any;
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
            });
          }
        } catch {}
      }
      setJobs(jobList);
    } catch (err) {
      console.error('[NodeManagement] Jobs load failed:', err);
    } finally {
      setJobsLoading(false);
    }
  }

  useEffect(() => {
    loadJobs();
  }, [address]);

  async function handleAcceptJob(jobId: bigint) {
    setTxPending(true);
    try {
      await acceptJob(jobId);
      await new Promise(r => setTimeout(r, 2000));
      setJobs(prev => prev.map(j => j.jobId === jobId ? { ...j, status: 1, startedAt: Math.floor(Date.now()/1000) } : j));
    } catch (err) {
      console.error('[NodeManagement] Accept job failed:', err);
    } finally {
      setTxPending(false);
    }
  }

  async function handleCompleteJob(jobId: bigint) {
    setTxPending(true);
    try {
      await completeJob(jobId);
      await new Promise(r => setTimeout(r, 3000));
      setJobs(prev => prev.map(j => j.jobId === jobId ? { ...j, status: 2 } : j));
      // Reload nodes to update revenue
      if (address) {
        const nodeIds = await getProviderNodes(address);
        const details: NodeRow[] = [];
        for (const id of nodeIds) {
          try {
            const node = await getNode(id) as any;
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
          } catch {}
        }
        setNodes(details);
      }
    } catch (err) {
      console.error('[NodeManagement] Complete job failed:', err);
    } finally {
      setTxPending(false);
    }
  }

  useEffect(() => {
    async function loadNodes() {
      if (!address) { setLoading(false); return; }
      setLoading(true);
      try {
        const nodeIds = await getProviderNodes(address);
        const details: NodeRow[] = [];
        for (const id of nodeIds) {
          try {
            const node = await getNode(id) as any;
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
          } catch {}
        }
        setNodes(details);
      } catch (err) {
        console.error('[NodeManagement] Load failed:', err);
      } finally {
        setLoading(false);
      }
    }
    loadNodes();
  }, [address]);

  async function handleAutoDetect() {
    setDetecting(true);
    setDupError(null);
    try {
      const info = await detectHardware();
      setHardware(info);
      // Check for duplicate among existing nodes
      const existingLabel = info.hasGpu ? info.gpuModel : `CPU-${info.cpuCores}cores`;
      const existing = nodes.find(n => 
        n.model.toLowerCase() === existingLabel.toLowerCase()
      );
      if (existing) {
        setDupError(`"${existingLabel}" is already registered as Node #${existing.nodeId.toString()}. Duplicate registration is not allowed.`);
        return;
      }
      if (info.hasGpu) {
        // GPU node
        const match = GPU_OPTIONS.find(g => 
          info.gpuModel.toLowerCase().includes(g.model.toLowerCase().replace('nvidia ', ''))
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
        // CPU-only node
        setFormModel('CPU Only');
        setFormVram(0);
        setFormTflops(getTflopsForModel('CPU Only', info.cpuCores, false));
      }
    } catch (err) {
      console.error('[NodeManagement] Auto-detect failed:', err);
    } finally {
      setDetecting(false);
    }
  }

  async function handleRegister() {
    if (!address) return;
    // Final duplicate check
    const checkModel = formModel;
    const existing = nodes.find(n => 
      n.model.toLowerCase() === checkModel.toLowerCase()
    );
    if (existing) {
      setDupError(`"${checkModel}" is already registered as Node #${existing.nodeId.toString()}.`);
      return;
    }
    setDupError(null);
    setTxPending(true);
    try {
      const hash = await registerNode(formModel, formVram, formTflops, formRegion);
      if (hash) {
        // Wait for confirmation then reload
        await new Promise(r => setTimeout(r, 3000));
        setShowRegister(false);
        // Reload nodes
        const nodeIds = await getProviderNodes(address);
        const details: NodeRow[] = [];
        for (const id of nodeIds) {
          try {
            const node = await getNode(id) as any;
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
          } catch {}
        }
        setNodes(details);
      }
    } catch (err) {
      console.error('[NodeManagement] Register failed:', err);
    } finally {
      setTxPending(false);
    }
  }

  async function handleStatusChange(nodeId: bigint, newStatus: number) {
    setTxPending(true);
    try {
      await updateNodeStatus(nodeId, newStatus);
      await new Promise(r => setTimeout(r, 2000));
      // Update local state
      setNodes(prev => prev.map(n => n.nodeId === nodeId ? { ...n, status: newStatus } : n));
    } catch (err) {
      console.error('[NodeManagement] Status change failed:', err);
    } finally {
      setTxPending(false);
    }
  }

  async function handleVerify(nodeId: bigint) {
    setTxPending(true);
    try {
      await verifyNode(nodeId);
      await new Promise(r => setTimeout(r, 2000));
      setNodes(prev => prev.map(n => n.nodeId === nodeId ? { ...n, verified: true } : n));
    } catch (err) {
      console.error('[NodeManagement] Verify failed:', err);
    } finally {
      setTxPending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center pt-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 p-8 pb-12">
      {/* Header */}
      <div className="z-10 flex w-full flex-col items-start justify-between gap-4 lg:flex-row lg:items-end">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-base font-bold tracking-tight text-on-background">
            Node Fleet <span className="font-light text-on-surface-variant">Management</span>
          </h1>
          <p className="mt-1 text-xs text-on-surface-variant">
            Register compute hardware on-chain, manage node status, and verify GPU clusters.
          </p>
        </div>
        {address && (
          <button
            onClick={() => setShowRegister(!showRegister)}
            className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-mono text-sm font-semibold text-on-primary shadow-[0_0_20px_rgba(152,203,255,0.1)] transition-colors hover:bg-primary-fixed"
          >
            <PlusCircle className="h-5 w-5" />
            Register New Node
          </button>
        )}
      </div>

      {/* Register Form */}
      {showRegister && address && (
        <div className="rounded-2xl bg-surface-container-low p-4 border border-primary/20">
          <h3 className="mb-3 text-sm font-semibold text-on-surface">Register Compute Node</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-2 block font-mono text-xs font-semibold uppercase text-outline">GPU Model</label>
              <select
                value={formModel}
                onChange={(e) => {
                  const opt = GPU_OPTIONS.find(g => g.model === e.target.value)!;
                  setFormModel(opt.model);
                  setFormVram(opt.vram);
                  setFormTflops(opt.tflops);
                }}
                className="w-full rounded-lg border border-outline-variant/20 bg-surface-container px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary"
              >
                {GPU_OPTIONS.map(g => <option key={g.model} value={g.model}>{g.model}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-2 block font-mono text-xs font-semibold uppercase text-outline">VRAM (GB)</label>
              <input type="number" value={formVram} onChange={(e) => setFormVram(Number(e.target.value))}
                className="w-full rounded-lg border border-outline-variant/20 bg-surface-container px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary" />
            </div>
            <div>
              <label className="mb-2 block font-mono text-xs font-semibold uppercase text-outline">TFLOPS</label>
              <input type="number" value={formTflops} onChange={(e) => setFormTflops(Number(e.target.value))}
                className="w-full rounded-lg border border-outline-variant/20 bg-surface-container px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary" />
            </div>
            <div>
              <label className="mb-2 block font-mono text-xs font-semibold uppercase text-outline">Region</label>
              <select value={formRegion} onChange={(e) => setFormRegion(e.target.value)}
                className="w-full rounded-lg border border-outline-variant/20 bg-surface-container px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary">
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          {/* Auto-detect button */}
          <div className="mb-4">
            <button
              onClick={handleAutoDetect}
              disabled={detecting}
              className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 font-mono text-sm font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              {detecting ? (
                <><div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div> Detecting...</>
              ) : (
                <><Activity className="h-4 w-4" /> Auto-Detect Hardware</>
              )}
            </button>
          </div>

          {/* Duplicate warning */}
          {dupError && (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-compute-down/30 bg-compute-down/10 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-compute-down" />
              <span className="text-sm text-on-surface">{dupError}</span>
            </div>
          )}

          {/* Hardware info display */}
          {hardware && (
            <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg bg-surface-container p-4 md:grid-cols-4">
              <div>
                <div className="font-mono text-[10px] uppercase text-outline">GPU</div>
                <div className="text-sm text-on-surface">{hardware.hasGpu ? hardware.gpuModel : 'CPU Only'}</div>
                {hardware.hasGpu && <div className="font-mono text-[10px] text-outline">{hardware.vramGB} GB VRAM</div>}
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase text-outline">CPU</div>
                <div className="text-sm text-on-surface">{hardware.cpuCores || '?'} threads</div>
                <div className="font-mono text-[10px] text-outline">{hardware.cpuModel}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase text-outline">RAM</div>
                <div className="text-sm text-on-surface">{hardware.ramGB ? `${hardware.ramGB} GB` : 'N/A'}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase text-outline">STORAGE</div>
                <div className="text-sm text-on-surface">{hardware.storageGB > 0 ? `${hardware.storageGB} GB` : 'N/A'}</div>
              </div>
              <div className="col-span-2 md:col-span-4">
                <div className="font-mono text-[10px] uppercase text-outline">RAW GPU STRING</div>
                <div className="font-mono text-xs text-on-surface-variant">{hardware.rawGpuString}</div>
              </div>
              <div className="col-span-2 md:col-span-4">
                <div className="font-mono text-[10px] uppercase text-outline">HARDWARE FINGERPRINT</div>
                <div className="font-mono text-xs text-primary">{hardware.fingerprint}</div>
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-3">
            <button
              onClick={handleRegister}
              disabled={txPending}
              className="rounded-lg bg-primary px-6 py-2.5 font-mono text-sm font-semibold text-on-primary disabled:opacity-50"
            >
              {txPending ? 'Submitting...' : 'Register On-Chain'}
            </button>
            <button
              onClick={() => setShowRegister(false)}
              className="rounded-lg border border-outline-variant/20 px-6 py-2.5 font-mono text-sm text-on-surface-variant"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!address ? (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-surface-container-low p-16">
          <Cpu className="mb-4 h-12 w-12 text-outline" />
          <h2 className="mb-2 text-sm font-semibold text-on-surface">Connect Wallet to Manage Nodes</h2>
          <p className="text-sm text-on-surface-variant">Connect your wallet to register and manage compute nodes.</p>
        </div>
      ) : nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-surface-container-low p-16">
          <PlusCircle className="mb-4 h-12 w-12 text-outline" />
          <h2 className="mb-2 text-sm font-semibold text-on-surface">No Nodes Registered</h2>
          <p className="text-sm text-on-surface-variant">Click "Register New Node" to add your first compute node on-chain.</p>
        </div>
      ) : (
        <>
          {/* Top Stats */}
          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="flex flex-col gap-4 rounded-2xl bg-surface-container-low p-4 lg:col-span-8">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-3 text-base font-semibold text-on-surface">
                  <Activity className="h-6 w-6 text-primary" />
                  Fleet Overview
                </h2>
                <div className="flex items-center gap-4 font-mono text-sm text-on-surface-variant">
                  <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-compute-active"></div> Active</span>
                  <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-compute-idle"></div> Idle</span>
                  <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-compute-down"></div> Offline</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg bg-surface-container p-4 text-center">
                  <div className="font-mono text-sm text-on-surface">{nodes.filter(n => n.status === 1).length}</div>
                  <div className="font-mono text-[10px] uppercase text-outline">Active</div>
                </div>
                <div className="rounded-lg bg-surface-container p-4 text-center">
                  <div className="font-mono text-sm text-on-surface">{nodes.filter(n => n.verified).length}</div>
                  <div className="font-mono text-[10px] uppercase text-outline">Verified</div>
                </div>
                <div className="rounded-lg bg-surface-container p-4 text-center">
                  <div className="font-mono text-sm text-on-surface">{formatBOTCompact(nodes.reduce((s, n) => s + n.totalRevenue, 0n))}</div>
                  <div className="font-mono text-[10px] uppercase text-outline">Total Revenue (DGRAM)</div>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-4 rounded-2xl bg-surface-container-low p-4 lg:col-span-4">
              <h3 className="font-mono text-sm uppercase tracking-wider text-outline">Node Distribution</h3>
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center">
                  <span className="text-base font-bold text-on-surface">{nodes.length}</span>
                  <span className="mt-1 block font-mono text-xs font-semibold text-outline">TOTAL NODES</span>
                </div>
              </div>
            </div>
          </div>

          {/* Node Table */}
          <div className="overflow-hidden rounded-xl bg-surface-container-low shadow-sm">
            <div className="grid grid-cols-12 gap-4 border-b border-outline-variant/10 bg-surface-container-lowest/50 p-4 font-mono text-xs font-semibold uppercase tracking-wider text-outline">
              <div className="col-span-3">Node ID / Model</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Specs (VRAM)</div>
              <div className="col-span-2">Region</div>
              <div className="col-span-2 text-right">Revenue (DGRAM)</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>

            {nodes.map((node, idx) => (
              <div key={idx} className={`group grid grid-cols-12 items-center gap-4 border-l-2 ${node.status === 1 ? 'border-compute-active' : node.status === 3 ? 'border-compute-down' : 'border-compute-idle'} border-t border-outline-variant/10 p-4 transition-colors hover:bg-surface-container-high/50`}>
                <div className="col-span-3 flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container-highest">
                    <Cpu className="h-5 w-5 text-on-surface-variant transition-colors group-hover:text-primary" />
                  </div>
                  <div>
                    <div className="font-mono text-sm text-on-surface">NODE #{node.nodeId.toString()}</div>
                    <div className="font-mono text-xs text-outline">{node.model}</div>
                  </div>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${STATUS_COLORS[node.status]} ${node.status === 1 ? 'animate-pulse shadow-[0_0_8px_#00FF41]' : ''}`}></div>
                  <span className="text-sm text-on-surface">{STATUS_LABELS[node.status]}</span>
                  {node.verified && <ShieldCheck className="h-3.5 w-3.5 text-compute-active" />}
                </div>
                <div className="col-span-2">
                  <div className="font-mono text-sm text-on-surface">{node.vramGB} GB</div>
                  <div className="font-mono text-xs text-outline">{node.tflops} TFLOPS</div>
                </div>
                <div className="col-span-2 font-mono text-sm text-on-surface-variant">{node.region}</div>
                <div className="col-span-2 text-right">
                  <div className="font-mono text-sm text-primary">{formatBOT(node.totalRevenue)}</div>
                  <div className="font-mono text-xs uppercase text-outline">Lifetime</div>
                </div>
                <div className="col-span-1 flex justify-end gap-1">
                  {node.status !== 1 && (
                    <button
                      onClick={() => handleStatusChange(node.nodeId, 1)}
                      disabled={txPending}
                      title="Set Active"
                      className="rounded bg-compute-active/20 px-2 py-1 font-mono text-[10px] font-semibold text-compute-active disabled:opacity-50"
                    >ACT</button>
                  )}
                  {node.status === 1 && (
                    <button
                      onClick={() => handleStatusChange(node.nodeId, 0)}
                      disabled={txPending}
                      title="Set Inactive"
                      className="rounded bg-surface px-2 py-1 font-mono text-[10px] font-semibold text-outline disabled:opacity-50"
                    >IDLE</button>
                  )}
                  {!node.verified && (
                    <button
                      onClick={() => handleVerify(node.nodeId)}
                      disabled={txPending}
                      title="Verify Node"
                      className="rounded bg-primary/20 px-2 py-1 font-mono text-[10px] font-semibold text-primary disabled:opacity-50"
                    >VER</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Job Management Section */}
          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-3 text-base font-semibold text-on-surface">
                <Briefcase className="h-6 w-6 text-primary" />
                Job Queue
              </h2>
              <span className="font-mono text-xs text-outline">Jobs assigned to your nodes</span>
            </div>

            {jobsLoading ? (
              <div className="flex items-center justify-center p-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
              </div>
            ) : jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl bg-surface-container-low p-8">
                <Briefcase className="mb-3 h-8 w-8 text-outline" />
                <p className="text-sm text-on-surface-variant">No jobs yet. When consumers lease your compute, they appear here.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl bg-surface-container-low shadow-sm">
                <div className="grid grid-cols-12 gap-4 border-b border-outline-variant/10 bg-surface-container-lowest/50 p-4 font-mono text-xs font-semibold uppercase tracking-wider text-outline">
                  <div className="col-span-2">Job ID</div>
                  <div className="col-span-2">Node</div>
                  <div className="col-span-2">Type</div>
                  <div className="col-span-2">Consumer</div>
                  <div className="col-span-1">Duration</div>
                  <div className="col-span-2 text-right">Payment</div>
                  <div className="col-span-1 text-right">Actions</div>
                </div>

                {jobs.map((job, idx) => (
                  <div key={idx} className="group grid grid-cols-12 items-center gap-4 border-t border-outline-variant/10 p-4 transition-colors hover:bg-surface-container-high/50">
                    <div className="col-span-2">
                      <div className="font-mono text-sm text-on-surface">JOB #{job.jobId.toString()}</div>
                      <div className={`font-mono text-[10px] font-semibold uppercase ${JOB_COLORS[job.status]}`}>{JOB_LABELS[job.status]}</div>
                    </div>
                    <div className="col-span-2 font-mono text-sm text-on-surface-variant">Node #{job.nodeId.toString()}</div>
                    <div className="col-span-2 text-sm text-on-surface">{job.jobType}</div>
                    <div className="col-span-2 font-mono text-xs text-on-surface-variant">{formatAddress(job.consumer as any)}</div>
                    <div className="col-span-1 font-mono text-sm text-on-surface-variant">{job.durationHours.toString()}h</div>
                    <div className="col-span-2 text-right">
                      <div className="font-mono text-sm text-primary">{formatBOT(BigInt(job.pricePerHourWei) * BigInt(job.durationHours))}</div>
                      <div className="font-mono text-[10px] uppercase text-outline">DGRAM total</div>
                    </div>
                    <div className="col-span-1 flex justify-end gap-1">
                      {job.status === 0 && (
                        <button
                          onClick={() => handleAcceptJob(job.jobId)}
                          disabled={txPending}
                          title="Accept Job"
                          className="flex items-center gap-1 rounded bg-compute-active/20 px-2 py-1.5 font-mono text-[10px] font-semibold text-compute-active disabled:opacity-50"
                        >
                          <Play className="h-3 w-3" /> ACCEPT
                        </button>
                      )}
                      {job.status === 1 && (
                        <button
                          onClick={() => handleCompleteJob(job.jobId)}
                          disabled={txPending}
                          title="Complete Job"
                          className="flex items-center gap-1 rounded bg-primary/20 px-2 py-1.5 font-mono text-[10px] font-semibold text-primary disabled:opacity-50"
                        >
                          <CheckCircle className="h-3 w-3" /> DONE
                        </button>
                      )}
                      {(job.status === 2 || job.status === 3) && (
                        <span className="font-mono text-[10px] text-outline">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
