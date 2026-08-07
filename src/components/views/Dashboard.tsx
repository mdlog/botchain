import React, { useEffect, useState } from 'react';
import { TrendingUp, Cpu, Activity, ShieldCheck, ChevronRight, MapPin, Cpu as CpuIcon } from 'lucide-react';
import { useWalletContext } from '@/context/WalletContext';
import { useComputeRegistry } from '@/hooks/useComputeRegistry';
import { useComputeMarketplace } from '@/hooks/useComputeMarketplace';
import { useComputeIndexToken } from '@/hooks/useComputeIndexToken';
import { formatBOT, formatBOTCompact, timeAgo } from '@/lib/format';

interface NodeInfo {
  nodeId: bigint;
  provider: string;
  model: string;
  vramGB: number;
  region: string;
  status: number;
  totalRevenue: bigint;
  verified: boolean;
  registeredAt: number;
}

export function Dashboard() {
  const { address } = useWalletContext();
  const { getProviderNodes, getNode, getProviderRevenue, getTotalActiveNodes } = useComputeRegistry();
  const { getTotalJobs, getTotalVolume } = useComputeMarketplace();
  const { getTVL, getTotalSupply, getBalance } = useComputeIndexToken();

  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0n);
  const [activeNodes, setActiveNodes] = useState(0n);
  const [totalJobs, setTotalJobs] = useState(0n);
  const [totalVolume, setTotalVolume] = useState(0n);
  const [tvl, setTvl] = useState(0n);
  const [cifSupply, setCifSupply] = useState(0n);
  const [cifBalance, setCifBalance] = useState(0n);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [activeCount, jobsCount, volume, tvlVal, supply] = await Promise.all([
          getTotalActiveNodes(),
          getTotalJobs(),
          getTotalVolume(),
          getTVL(),
          getTotalSupply(),
        ]);
        setActiveNodes(activeCount);
        setTotalJobs(jobsCount);
        setTotalVolume(volume);
        setTvl(tvlVal);
        setCifSupply(supply);

        if (address) {
          const [nodeIds, revenue, bal] = await Promise.all([
            getProviderNodes(address),
            getProviderRevenue(address),
            getBalance(address),
          ]);
          setTotalRevenue(revenue);
          setCifBalance(bal);

          const nodeDetails: NodeInfo[] = [];
          for (const id of nodeIds.slice(0, 10)) {
            try {
              const node = await getNode(id) as any;
              if (node) {
                nodeDetails.push({
                  nodeId: id,
                  provider: node.provider,
                  model: node.specs?.model || 'Unknown',
                  vramGB: Number(node.specs?.vramGB || 0),
                  region: node.specs?.region || 'Unknown',
                  status: Number(node.status),
                  totalRevenue: node.totalRevenue,
                  verified: node.verified,
                  registeredAt: Number(node.registeredAt),
                });
              }
            } catch {}
          }
          setNodes(nodeDetails);
        }
      } catch (err) {
        console.error('[Dashboard] Load failed:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [address]);

  const statusLabels = ['Inactive', 'Active', 'Busy', 'Offline'];

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center pt-20">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
          <span className="font-mono text-xs text-outline">Loading on-chain data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pb-8 w-full">
      {/* Header */}
      <div className="mb-6 mt-4 flex items-end justify-between">
        <div>
          <h1 className="mb-1 text-base font-bold leading-tight tracking-tight text-on-background">Provider Command</h1>
          <p className="max-w-2xl text-xs text-on-surface-variant">
            Real-time on-chain telemetry for compute nodes on BOT Chain DePIN network.
          </p>
        </div>
        {address && (
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end rounded-lg bg-surface-container-low px-3 py-2">
              <span className="font-mono text-[10px] font-semibold text-outline">CIF BALANCE</span>
              <span className="font-mono text-sm text-primary">{formatBOTCompact(cifBalance)}</span>
            </div>
          </div>
        )}
      </div>

      {!address ? (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-surface-container-low p-8">
          <CpuIcon className="mb-3 h-8 w-8 text-outline" />
          <h2 className="mb-1 text-sm font-semibold text-on-surface">Connect Wallet to View Dashboard</h2>
          <p className="text-xs text-on-surface-variant">Connect your wallet to see your compute nodes and earnings.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          {/* Left Column */}
          <div className="flex flex-col gap-4 xl:col-span-8">
            {/* Earnings Overview */}
            <div className="rounded-2xl bg-surface-container-low p-4">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-outline">Total Verified Revenue</span>
                  <div className="flex items-end gap-2">
                    <span className="font-mono text-lg font-medium leading-none tracking-tight text-primary">
                      {formatBOT(totalRevenue)}
                    </span>
                    <span className="mb-0.5 font-mono text-[10px] font-semibold text-primary-fixed-dim">DGRAM</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="font-mono text-xs text-on-surface-variant">From {nodes.length} registered node(s)</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-outline">Network Volume</span>
                  <span className="block font-mono text-sm text-on-surface">{formatBOTCompact(totalVolume)} <span className="text-[10px] text-outline">DGRAM</span></span>
                </div>
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-surface-container p-3">
                  <span className="mb-0.5 block font-mono text-[9px] font-semibold uppercase text-outline">TOTAL JOBS</span>
                  <span className="font-mono text-sm text-on-surface">{totalJobs.toString()}</span>
                </div>
                <div className="rounded-lg bg-surface-container p-3">
                  <span className="mb-0.5 block font-mono text-[9px] font-semibold uppercase text-outline">ACTIVE NODES</span>
                  <span className="font-mono text-sm text-on-surface">{activeNodes.toString()}</span>
                </div>
                <div className="rounded-lg bg-surface-container p-3">
                  <span className="mb-0.5 block font-mono text-[9px] font-semibold uppercase text-outline">TVL (CIF)</span>
                  <span className="font-mono text-sm text-on-surface">{formatBOTCompact(tvl)} DGRAM</span>
                </div>
              </div>
            </div>

            {/* Registered Nodes */}
            <div className="flex flex-1 flex-col overflow-hidden rounded-2xl bg-surface-container">
              <div className="flex items-center justify-between border-b border-outline-variant/10 bg-surface-container-high/50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-outline" />
                  <h2 className="text-sm font-semibold text-on-surface">Your Compute Nodes</h2>
                </div>
                <span className="flex items-center gap-1.5 rounded-full bg-compute-active/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-compute-active">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-compute-active"></span>
                  {nodes.length} REGISTERED
                </span>
              </div>

              <div className="flex-1 overflow-y-auto">
                {nodes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8">
                    <CpuIcon className="mb-3 h-8 w-8 text-outline" />
                    <p className="text-xs text-on-surface-variant">No nodes registered yet. Go to Node Management to register.</p>
                  </div>
                ) : (
                  nodes.map((node, idx) => (
                    <div key={idx} className="group border-b border-outline-variant/10 px-4 py-3 transition-colors hover:bg-surface-container-highest/30">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-outline transition-colors group-hover:text-primary">
                            <Cpu className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="mb-0.5 flex items-center gap-1.5">
                              <span className="font-mono text-[10px] font-semibold text-outline">NODE #{node.nodeId.toString()}</span>
                              {node.verified && (
                                <span className="rounded bg-compute-active/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-compute-active">VERIFIED</span>
                              )}
                              <span className={`rounded bg-surface px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${node.status === 1 ? 'text-compute-active' : node.status === 3 ? 'text-compute-down' : 'text-on-surface-variant'}`}>
                                {statusLabels[node.status]}
                              </span>
                            </div>
                            <p className="text-xs text-on-surface">{node.model}</p>
                            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-outline">
                              <span className="flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" /> {node.region}</span>
                              <span>{node.vramGB} GB VRAM</span>
                              <span>Registered {timeAgo(node.registeredAt)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="min-w-[90px] text-right">
                            <span className="mb-0.5 block font-mono text-[9px] font-semibold text-outline">TOTAL REVENUE</span>
                            <span className="font-mono text-xs font-medium text-compute-active">{formatBOTCompact(node.totalRevenue)} DGRAM</span>
                          </div>
                          <button className="flex h-6 w-6 items-center justify-center rounded-full bg-surface text-outline transition-colors hover:bg-surface-bright hover:text-primary">
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="flex flex-col gap-4 xl:col-span-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface-container-high p-3 shadow-sm">
                <Activity className="mb-2 h-4 w-4 text-outline" />
                <div className="mb-0.5 font-mono text-sm leading-none text-on-surface">{activeNodes.toString()}</div>
                <span className="font-mono text-[9px] font-semibold uppercase text-outline">Network Active Nodes</span>
              </div>
              
              <div className="rounded-xl bg-surface-container-high p-3 shadow-sm">
                <TrendingUp className="mb-2 h-4 w-4 text-outline" />
                <div className="mb-0.5 font-mono text-sm leading-none text-on-surface">{totalJobs.toString()}</div>
                <span className="font-mono text-[9px] font-semibold uppercase text-outline">Total Jobs</span>
              </div>

              <div className="col-span-2 rounded-xl border-l-4 border-primary bg-gradient-to-br from-surface-container to-surface-container-low p-4 shadow-md">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span className="font-mono text-[10px] font-semibold uppercase text-on-surface-variant">CIF Token Supply</span>
                  </div>
                  <span className="font-mono text-xs text-primary">{formatBOTCompact(cifSupply)}</span>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-outline">
                  Total CIF tokens minted against compute revenue. Backed 1:1 by DGRAM deposits from verified GPU providers.
                </p>
              </div>
            </div>

            {/* Network Stats */}
            <div className="flex flex-1 flex-col rounded-2xl bg-surface-container p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-on-surface">Network Overview</h3>
              </div>
              <div className="flex flex-col gap-2">
                <div className="rounded-xl bg-surface-container-low p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-on-surface">TOTAL VOLUME</span>
                    <span className="font-mono text-xs text-primary">{formatBOTCompact(totalVolume)} DGRAM</span>
                  </div>
                </div>
                <div className="rounded-xl bg-surface-container-low p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-on-surface">CIF TVL</span>
                    <span className="font-mono text-xs text-primary">{formatBOTCompact(tvl)} DGRAM</span>
                  </div>
                </div>
                <div className="rounded-xl bg-surface-container-low p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-on-surface">YOUR REVENUE</span>
                    <span className="font-mono text-xs text-compute-active">{formatBOTCompact(totalRevenue)} DGRAM</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
