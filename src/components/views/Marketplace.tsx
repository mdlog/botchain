import React, { useEffect, useState } from 'react';
import { Star, Cpu, MapPin, Grid3x3, List, ShieldCheck, SlidersHorizontal, Gpu } from 'lucide-react';
import { useWalletContext } from '@/context/WalletContext';
import { usePriceOracle } from '@/hooks/usePriceOracle';
import { useComputeRegistry } from '@/hooks/useComputeRegistry';
import { publicClient, CONTRACTS } from '@/config/chain';
import { useComputeMarketplace } from '@/hooks/useComputeMarketplace';
import { formatBOT, formatBOTCompact, formatAddress, timeAgo } from '@/lib/format';
import { getPricingEngine } from '@/lib/pricing';

interface PriceInfo {
  model: string;
  pricePerHourWei: bigint;
  confidence: number;
  updatedAt: number;
}

interface NodeListing {
  nodeId: bigint;
  provider: string;
  model: string;
  vramGB: number;
  tflops: number;
  region: string;
  status: number;
  verified: boolean;
  pricePerHour: bigint;
  confidence: number;
  jobCount: number;
  completedJobs: number;
}

const GPU_MODELS = ['NVIDIA H100', 'NVIDIA A100', 'NVIDIA RTX 4090', 'NVIDIA RTX 3090', 'NVIDIA RTX 3060', 'AMD Radeon GPU', 'CPU Only'];

export function Marketplace() {
  const { address } = useWalletContext();
  const { getPrice, isSupported } = usePriceOracle();
  const { getNode, getNodeCount, getTotalActiveNodes } = useComputeRegistry();
  const { createJob, getTotalJobs, getTotalVolume, getAllJobCounts, getCompletedJobStats } = useComputeMarketplace();
  const engine = getPricingEngine();

  const [loading, setLoading] = useState(true);
  const [prices, setPrices] = useState<PriceInfo[]>([]);
  const [listings, setListings] = useState<NodeListing[]>([]);
  const [totalJobs, setTotalJobs] = useState(0n);
  const [totalVolume, setTotalVolume] = useState(0n);
  const [activeNodes, setActiveNodes] = useState(0n);
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, any>>({});
  const [jobCounts, setJobCounts] = useState<Map<string, number>>(new Map());
  const [completedStats, setCompletedStats] = useState<{ perNode: Map<string, number>, perType: Map<string, number>, total: number }>({ perNode: new Map(), perType: new Map(), total: 0 });
  const [leasing, setLeasing] = useState<number | null>(null);

  // View mode + filters
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filterModel, setFilterModel] = useState<string>('all');
  const [filterRegion, setFilterRegion] = useState<string>('all');
  const [filterVerified, setFilterVerified] = useState(false);
  const [showFilters, setShowFilters] = useState(true);

  // Lease form
  const [showLeaseForm, setShowLeaseForm] = useState<NodeListing | null>(null);
  const [leaseHours, setLeaseHours] = useState(1);
  const [leaseType, setLeaseType] = useState('Inference');

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [jobs, volume, active] = await Promise.all([
          getTotalJobs(),
          getTotalVolume(),
          getTotalActiveNodes(),
        ]);
        setTotalJobs(jobs);
        setTotalVolume(volume);
        setActiveNodes(active);

        const priceInfos: PriceInfo[] = [];
        for (const model of GPU_MODELS) {
          try {
            const p = await getPrice(model);
            priceInfos.push({
              model,
              pricePerHourWei: p.pricePerHourWei,
              confidence: p.confidence,
              updatedAt: Number(p.updatedAt),
            });
          } catch {}
        }
        setPrices(priceInfos);

        // Fetch all NodeRegistered events to discover hash-based node IDs
        const logs = await publicClient.getLogs({
          address: CONTRACTS.ComputeRegistry,
          event: {
            type: 'event',
            name: 'NodeRegistered',
            inputs: [
              { type: 'uint64', name: 'nodeId', indexed: true },
              { type: 'address', name: 'provider', indexed: true },
              { type: 'string', name: 'model', indexed: false },
              { type: 'string', name: 'region', indexed: false },
            ],
          },
          fromBlock: 0n,
          toBlock: 'latest',
        });

        const nodeListings: NodeListing[] = [];
        for (const log of logs) {
          try {
            const nodeId = (log.args as any).nodeId;
            const node = await getNode(nodeId) as any;
            if (node && node.provider !== '0x0000000000000000000000000000000000000000') {
              const priceInfo = priceInfos.find(p => p.model === node.specs?.model);
              nodeListings.push({
                nodeId: nodeId,
                provider: node.provider,
                model: node.specs?.model || 'Unknown',
                vramGB: Number(node.specs?.vramGB || 0),
                tflops: Number(node.specs?.tflops || 0),
                region: node.specs?.region || 'Unknown',
                status: Number(node.status),
                verified: node.verified,
                pricePerHour: priceInfo?.pricePerHourWei || 0n,
                confidence: priceInfo?.confidence || 0,
                jobCount: 0,
                completedJobs: 0,
              });
            }
          } catch {}
        }
        // Fetch job counts + completed job stats per node
        const [jc, completed] = await Promise.all([
          getAllJobCounts(),
          getCompletedJobStats(),
        ]);
        setJobCounts(jc);
        setCompletedStats(completed);
        for (const n of nodeListings) {
          n.jobCount = jc.get(n.nodeId.toString()) ?? 0;
          n.completedJobs = completed.perNode.get(n.nodeId.toString()) ?? 0;
        }
        setListings(nodeListings);

        if (engine.isAvailable()) {
          const suggestions: Record<string, any> = {};
          for (const model of GPU_MODELS) {
            try {
              const s = await engine.suggestPrice(model, 80, 500, 0.5, Number(active));
              suggestions[model] = s;
            } catch {}
          }
          setAiSuggestions(suggestions);
        }
      } catch (err) {
        console.error('[Marketplace] Load failed:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Filtered listings
  const filteredListings = listings.filter(n => {
    if (filterModel !== 'all' && n.model !== filterModel) return false;
    if (filterRegion !== 'all' && n.region !== filterRegion) return false;
    if (filterVerified && !n.verified) return false;
    return true;
  });

  const regions = [...new Set(listings.map(n => n.region))];

  async function handleLease(node: NodeListing) {
    if (!address) return;
    setLeasing(Number(node.nodeId));
    try {
      const value = node.pricePerHour * BigInt(leaseHours);
      const hash = await createJob(
        node.nodeId,
        leaseType,
        '0x' + '00'.repeat(32),
        BigInt(leaseHours),
        node.model,
        value
      );
      if (hash) {
        alert(`Job created! TX: ${hash}`);
        setShowLeaseForm(null);
      }
    } catch (err) {
      console.error('[Marketplace] Lease failed:', err);
      alert('Lease failed. Check console.');
    } finally {
      setLeasing(null);
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
    <div className="flex h-full w-full flex-col relative z-10">
      {/* Ticker */}
      <div className="sticky top-0 z-30 flex h-12 items-center overflow-hidden border-b border-surface-glass bg-surface/50 px-8 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-compute-active"></div>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-outline">Total Jobs</span>
            <span className="font-mono text-sm text-primary">{totalJobs.toString()}</span>
          </div>
          <div className="h-4 w-px bg-outline-variant/30"></div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-outline">Network Volume</span>
            <span className="font-mono text-sm text-on-surface">{formatBOTCompact(totalVolume)} DGRAM</span>
          </div>
          <div className="h-4 w-px bg-outline-variant/30"></div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-outline">Active Nodes</span>
            <span className="font-mono text-sm text-secondary-fixed">{activeNodes.toString()}</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto bg-gradient-to-b from-surface/50 to-surface p-8 pb-32">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-base font-semibold text-on-surface">Explore Compute</h2>
          <p className="mt-1 text-sm text-on-surface-variant">Lease verified GPU compute on BOT Chain. Prices set by AI oracle.</p>
        </div>

        {/* Filters Bar (inline, above listings) */}
        <div className="mb-6 rounded-xl bg-surface-container-low p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 rounded-lg border border-outline-variant/20 bg-surface-container px-3 py-2 font-mono text-xs font-semibold text-on-surface-variant transition-colors hover:text-on-surface"
            >
              <SlidersHorizontal className="h-4 w-4" /> Filters
            </button>

            {/* GPU Model filter */}
            <select
              value={filterModel}
              onChange={e => setFilterModel(e.target.value)}
              className="rounded-lg border border-outline-variant/20 bg-surface-container px-3 py-2 font-mono text-xs text-on-surface outline-none focus:border-primary"
            >
              <option value="all">All GPUs</option>
              {GPU_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>

            {/* Region filter */}
            <select
              value={filterRegion}
              onChange={e => setFilterRegion(e.target.value)}
              className="rounded-lg border border-outline-variant/20 bg-surface-container px-3 py-2 font-mono text-xs text-on-surface outline-none focus:border-primary"
            >
              <option value="all">All Regions</option>
              {regions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>

            {/* Verified only */}
            <button
              onClick={() => setFilterVerified(!filterVerified)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 font-mono text-xs font-semibold transition-colors ${filterVerified ? 'border-compute-active/40 bg-compute-active/10 text-compute-active' : 'border-outline-variant/20 bg-surface-container text-on-surface-variant'}`}
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Verified Only
            </button>

            {/* Grid / List toggle — right aligned */}
            <div className="ml-auto flex items-center gap-2">
              <div className="flex rounded-lg border border-outline-variant/20 bg-surface-container p-1">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-xs font-semibold transition-colors ${viewMode === 'grid' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
                >
                  <Grid3x3 className="h-4 w-4" /> Grid
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-xs font-semibold transition-colors ${viewMode === 'list' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
                >
                  <List className="h-4 w-4" /> List
                </button>
              </div>
            </div>
          </div>

          {/* Expandable filter content: AI pricing only */}
          {showFilters && (
            <div className="mt-4 border-t border-outline-variant/10 pt-4">
              {engine.isAvailable() && Object.keys(aiSuggestions).length > 0 && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <h3 className="mb-3 flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest text-primary">
                    <Star className="h-3.5 w-3.5" /> AI Pricing Engine
                  </h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {Object.entries(aiSuggestions).map(([model, s]: [string, any]) => (
                      <div key={model} className="flex justify-between text-xs">
                        <span className="text-on-surface-variant">{model.replace('NVIDIA ', '')}</span>
                        <span className="font-mono text-primary">{formatBOT(s.pricePerHour)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-outline">{aiSuggestions[GPU_MODELS[0]]?.reasoning || 'AI-powered pricing'}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Listings */}
        {filteredListings.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl bg-surface-container-low p-16">
            <Cpu className="mb-4 h-12 w-12 text-outline" />
            <h2 className="mb-2 text-sm font-semibold text-on-surface">No Compute Nodes Found</h2>
            <p className="text-sm text-on-surface-variant">
              {listings.length === 0
                ? 'Nodes will appear here once providers register them. Go to Node Management to register.'
                : 'No nodes match your current filters. Try adjusting them.'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          /* GRID VIEW */
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredListings.map((node, idx) => (
              <div key={idx} className="group rounded-lg border border-surface-glass bg-surface-container-low p-5 transition-all hover:-translate-y-1 hover:border-outline-variant/50 hover:shadow-lg">
                <div className="mb-3 flex items-start justify-between">
                  <div className="font-mono text-sm text-on-surface">{node.model}</div>
                  <div className="flex items-center gap-1">
                    {node.verified && <ShieldCheck className="h-3.5 w-3.5 text-compute-active" />}
                    <div className="flex items-center gap-1 rounded bg-surface-container-high px-2 py-0.5 font-mono text-[10px] font-semibold text-outline">
                      <MapPin className="h-3 w-3" /> {node.region}
                    </div>
                  </div>
                </div>

                <div className="mb-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-[10px] font-semibold text-outline-variant">NODE ID</span>
                    <span className="font-mono text-xs text-on-surface-variant">#{node.nodeId.toString()}</span>
                  </div>
                  {node.vramGB > 0 ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-mono text-[10px] font-semibold text-outline-variant">VRAM</span>
                      <span className="font-mono text-sm text-on-surface">{node.vramGB} GB</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-mono text-[10px] font-semibold text-outline-variant">TYPE</span>
                      <span className="font-mono text-xs text-secondary-fixed">CPU Only</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-[10px] font-semibold text-outline-variant">TFLOPS</span>
                    <span className="font-mono text-sm text-on-surface">{node.tflops}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-[10px] font-semibold text-outline-variant">JOBS TOTAL</span>
                    <span className="font-mono text-sm text-on-surface">{node.jobCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-[10px] font-semibold text-outline-variant">COMPLETED</span>
                    <span className="font-mono text-sm text-compute-active">{node.completedJobs}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-[10px] font-semibold text-outline-variant">PROVIDER</span>
                    <span className="font-mono text-xs text-on-surface-variant">{formatAddress(node.provider as any)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-[10px] font-semibold text-outline-variant">STATUS</span>
                    <span className={`font-mono text-xs ${node.status === 1 ? 'text-compute-active' : 'text-outline'}`}>
                      {node.status === 1 ? 'Active' : node.status === 3 ? 'Offline' : 'Inactive'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-surface-glass pt-4">
                  <div>
                    <div className="font-mono text-xs leading-none text-primary">{formatBOT(node.pricePerHour)}</div>
                    <div className="font-mono text-[10px] font-semibold text-outline">DGRAM/hr</div>
                  </div>
                  <button
                    onClick={() => {
                      if (!address) { alert('Connect wallet first'); return; }
                      if (node.status !== 1) { alert('Node not active'); return; }
                      setShowLeaseForm(node);
                      setLeaseHours(1);
                    }}
                    disabled={node.status !== 1}
                    className="rounded border border-surface-glass bg-surface-container-high px-4 py-1.5 font-mono text-xs font-semibold text-on-surface transition-colors hover:border-primary/50 hover:bg-primary/20 hover:text-primary disabled:opacity-30"
                  >
                    LEASE
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* LIST VIEW */
          <div className="overflow-hidden rounded-xl bg-surface-container-low shadow-sm">
            <div className="grid grid-cols-12 gap-4 border-b border-outline-variant/10 bg-surface-container-lowest/50 p-4 font-mono text-xs font-semibold uppercase tracking-wider text-outline">
              <div className="col-span-3">GPU Model / Node</div>
              <div className="col-span-2">Specs</div>
              <div className="col-span-2">Region</div>
              <div className="col-span-2">Provider</div>
              <div className="col-span-1 text-right">Price</div>
              <div className="col-span-1 text-right">Status</div>
              <div className="col-span-1 text-right">Action</div>
            </div>
            {filteredListings.map((node, idx) => (
              <div key={idx} className={`group grid grid-cols-12 items-center gap-4 border-l-2 ${node.status === 1 ? 'border-compute-active' : 'border-compute-idle'} border-t border-outline-variant/10 p-4 transition-colors hover:bg-surface-container-high/50`}>
                <div className="col-span-3 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-highest">
                    <Cpu className="h-4 w-4 text-on-surface-variant group-hover:text-primary" />
                  </div>
                  <div>
                    <div className="text-sm text-on-surface">{node.model}</div>
                    <div className="font-mono text-xs text-outline">#{node.nodeId.toString()}</div>
                  </div>
                </div>
                <div className="col-span-2">
                  {node.vramGB > 0 ? (
                    <>
                      <div className="font-mono text-xs text-on-surface">{node.vramGB} GB VRAM</div>
                      <div className="font-mono text-xs text-outline">{node.tflops} TFLOPS · {node.completedJobs}/{node.jobCount} done</div>
                    </>
                  ) : (
                    <>
                      <div className="font-mono text-xs text-secondary-fixed">CPU Only</div>
                      <div className="font-mono text-xs text-outline">{node.tflops} TFLOPS · {node.completedJobs}/{node.jobCount} done</div>
                    </>
                  )}
                </div>
                <div className="col-span-2 flex items-center gap-1 font-mono text-xs text-on-surface-variant">
                  <MapPin className="h-3 w-3" /> {node.region}
                </div>
                <div className="col-span-2 font-mono text-xs text-on-surface-variant">
                  <div className="flex items-center gap-1">
                    {node.verified && <ShieldCheck className="h-3 w-3 text-compute-active" />}
                    {formatAddress(node.provider as any)}
                  </div>
                </div>
                <div className="col-span-1 text-right">
                  <div className="font-mono text-sm text-primary">{formatBOT(node.pricePerHour)}</div>
                  <div className="font-mono text-[10px] text-outline">DGRAM/hr</div>
                </div>
                <div className="col-span-1 text-right">
                  <span className={`font-mono text-xs ${node.status === 1 ? 'text-compute-active' : 'text-outline'}`}>
                    {node.status === 1 ? '● Active' : node.status === 3 ? '● Offline' : '● Idle'}
                  </span>
                </div>
                <div className="col-span-1 flex justify-end">
                  <button
                    onClick={() => {
                      if (!address) { alert('Connect wallet first'); return; }
                      if (node.status !== 1) { alert('Node not active'); return; }
                      setShowLeaseForm(node);
                      setLeaseHours(1);
                    }}
                    disabled={node.status !== 1}
                    className="rounded border border-surface-glass bg-surface-container-high px-3 py-1.5 font-mono text-[10px] font-semibold text-on-surface transition-colors hover:border-primary/50 hover:bg-primary/20 hover:text-primary disabled:opacity-30"
                  >
                    LEASE
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* AI Pricing Engine Card */}
        {engine.isAvailable() && (
          <div className="mt-8 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-4">
            <div className="mb-4 flex items-center gap-3">
              <Star className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-semibold text-on-surface">AI Pricing Engine Active</h3>
            </div>
            <p className="text-sm text-on-surface-variant">
              Gemini-powered pricing engine is monitoring GPU supply, demand, and benchmarks to push fair prices to the on-chain oracle.
            </p>
          </div>
        )}
      </div>

      {/* Lease Modal */}
      {showLeaseForm && address && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowLeaseForm(null)}>
          <div className="w-full max-w-md rounded-2xl bg-surface-container-low p-4" onClick={e => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold text-on-surface">Lease Compute</h3>
            <div className="mb-4">
              <div className="mb-2 text-sm text-on-surface-variant">{showLeaseForm.model} · Node #{showLeaseForm.nodeId.toString()}</div>
              <div className="mb-3 font-mono text-sm text-primary">{formatBOT(showLeaseForm.pricePerHour)} DGRAM/hr</div>
            </div>
            <div className="mb-4">
              <label className="mb-2 block font-mono text-xs font-semibold uppercase text-outline">Job Type</label>
              <select value={leaseType} onChange={e => setLeaseType(e.target.value)}
                className="w-full rounded-lg border border-outline-variant/20 bg-surface-container px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary">
                <option>Inference</option>
                <option>LLM Training</option>
                <option>Fine-tuning</option>
                <option>Image Generation</option>
                <option>Data Processing</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="mb-2 block font-mono text-xs font-semibold uppercase text-outline">Duration (hours)</label>
              <input type="number" min={1} value={leaseHours} onChange={e => setLeaseHours(Number(e.target.value))}
                className="w-full rounded-lg border border-outline-variant/20 bg-surface-container px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary" />
            </div>
            <div className="mb-4 rounded-lg bg-surface-container p-4">
              <div className="flex justify-between text-sm">
                <span className="text-on-surface-variant">Total Cost</span>
                <span className="font-mono text-sm text-primary">{formatBOT(showLeaseForm.pricePerHour * BigInt(leaseHours))} DGRAM</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handleLease(showLeaseForm)}
                disabled={leasing !== null}
                className="flex-1 rounded-lg bg-primary px-6 py-3 font-mono text-sm font-semibold text-on-primary disabled:opacity-50"
              >
                {leasing !== null ? 'Submitting...' : 'Confirm Lease'}
              </button>
              <button onClick={() => setShowLeaseForm(null)} className="rounded-lg border border-outline-variant/20 px-6 py-3 font-mono text-sm text-on-surface-variant">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
