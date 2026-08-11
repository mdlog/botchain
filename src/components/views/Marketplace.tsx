import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  Cpu,
  MapPin,
  LayoutGrid,
  List,
  ShieldCheck,
  Server,
  SlidersHorizontal,
} from 'lucide-react';
import { PageShell, PageHeader } from '@/components/layout/PageShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, StatusDot } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select } from '@/components/ui/Field';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { useWalletContext } from '@/context/WalletContext';
import { useToast } from '@/context/ToastContext';
import { usePriceOracle } from '@/hooks/usePriceOracle';
import { useComputeRegistry } from '@/hooks/useComputeRegistry';
import { useComputeMarketplace } from '@/hooks/useComputeMarketplace';
import { formatBOT, formatAddress, formatNodeId } from '@/lib/format';
import { GPU_MODELS, NODE_STATUS_ACTIVE, nodeStatus } from '@/lib/domain';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
import { describeTxError } from '@/lib/tx';
import { getPricingEngine, type PriceSuggestion } from '@/lib/pricing';
import { cn } from '@/lib/utils';

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

export function Marketplace() {
  const { address } = useWalletContext();
  const toast = useToast();
  const { getPrice } = usePriceOracle();
  const { getNode, getAllNodeIds, getTotalActiveNodes } = useComputeRegistry();
  const { createJob, getAllJobCounts, getCompletedJobStats } = useComputeMarketplace();
  const engine = getPricingEngine();

  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<NodeListing[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, PriceSuggestion>>({});
  const [leasing, setLeasing] = useState(false);

  // View mode + filters
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filterModel, setFilterModel] = useState<string>('all');
  const [filterRegion, setFilterRegion] = useState<string>('all');
  const [filterVerified, setFilterVerified] = useState(false);

  // Lease form
  const [leaseTarget, setLeaseTarget] = useState<NodeListing | null>(null);
  const [leaseHours, setLeaseHours] = useState(1);
  const [leaseType, setLeaseType] = useState('Inference');

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const active = await getTotalActiveNodes();

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
          } catch {
            // getPrice reverts for a benchmarked model the oracle has never been
            // given a price for. That is a real state, not a failure — the node
            // lists as unpriced and cannot be leased.
          }
        }

        // Node ids are keccak-derived, so the registry cannot be walked by
        // index — the hook recovers them from the registration log stream and
        // reads every node concurrently through the multicall batcher.
        const nodeIds = await getAllNodeIds();
        const nodes = await Promise.all(nodeIds.map((id) => getNode(id).catch(() => null)));

        const nodeListings: NodeListing[] = [];
        nodes.forEach((node, index) => {
          if (!node || node.provider === ZERO_ADDRESS) return;
          const priceInfo = priceInfos.find((p) => p.model === node.specs.model);
          nodeListings.push({
            nodeId: nodeIds[index],
            provider: node.provider,
            model: node.specs.model,
            vramGB: node.specs.vramGB,
            tflops: node.specs.tflops,
            region: node.specs.region,
            status: node.status,
            verified: node.verified,
            pricePerHour: priceInfo?.pricePerHourWei ?? 0n,
            confidence: priceInfo?.confidence ?? 0,
            jobCount: 0,
            completedJobs: 0,
          });
        });
        // Fetch job counts + completed job stats per node
        const [jc, completed] = await Promise.all([getAllJobCounts(), getCompletedJobStats()]);
        for (const n of nodeListings) {
          n.jobCount = jc.get(n.nodeId.toString()) ?? 0;
          n.completedJobs = completed.perNode.get(n.nodeId.toString()) ?? 0;
        }
        // Available nodes first — a marketplace should lead with what can
        // actually be leased, not with registration order.
        nodeListings.sort((a, b) => {
          if (a.status === NODE_STATUS_ACTIVE && b.status !== NODE_STATUS_ACTIVE) return -1;
          if (a.status !== NODE_STATUS_ACTIVE && b.status === NODE_STATUS_ACTIVE) return 1;
          return Number(a.pricePerHour - b.pricePerHour);
        });
        setListings(nodeListings);

        // One call prices the whole catalog against its own reference specs.
        // Asking per model let each answer pick its own scale, which is how an
        // A100 ended up quoted below an RTX 3060.
        setAiSuggestions(await engine.suggestCatalogPrices(0.5, Number(active)));
      } catch (err) {
        console.error('[Marketplace] Load failed:', err);
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, []);

  const regions = useMemo(() => [...new Set(listings.map((n) => n.region))].sort(), [listings]);

  const filtered = useMemo(
    () =>
      listings.filter((n) => {
        if (filterModel !== 'all' && n.model !== filterModel) return false;
        if (filterRegion !== 'all' && n.region !== filterRegion) return false;
        if (filterVerified && !n.verified) return false;
        return true;
      }),
    [listings, filterModel, filterRegion, filterVerified],
  );

  const availableCount = useMemo(() => filtered.filter((n) => n.status === 1).length, [filtered]);
  const filtersActive = filterModel !== 'all' || filterRegion !== 'all' || filterVerified;

  function clearFilters() {
    setFilterModel('all');
    setFilterRegion('all');
    setFilterVerified(false);
  }

  function openLease(node: NodeListing) {
    if (!address) {
      toast.error('Connect a wallet to lease compute', {
        description: 'Leasing submits an on-chain transaction from your account.',
      });
      return;
    }
    setLeaseTarget(node);
    setLeaseHours(1);
  }

  async function handleLease() {
    if (!address || !leaseTarget) return;
    setLeasing(true);
    try {
      // The model is no longer passed: the contract prices the lease from the
      // node's own registered specs, so it cannot be quoted against a cheaper card.
      const value = leaseTarget.pricePerHour * BigInt(leaseHours);
      const hash = await createJob(
        leaseTarget.nodeId,
        leaseType,
        '0x' + '00'.repeat(32),
        BigInt(leaseHours),
        value,
      );
      toast.success('Compute leased', {
        description: `${leaseHours}h on ${leaseTarget.model}. Open Execute once the provider accepts.`,
        txHash: hash,
      });
      setLeaseTarget(null);
    } catch (err) {
      console.error('[Marketplace] lease failed:', err);
      toast.error('Lease was not created', { description: describeTxError(err) });
    } finally {
      setLeasing(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Explore compute"
        description="Lease verified GPU capacity on BOT Chain. Hourly rates come from the on-chain price oracle."
        actions={
          !loading && (
            <span className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container px-3 py-2">
              <StatusDot
                tone={availableCount > 0 ? 'success' : 'neutral'}
                live={availableCount > 0}
              />
              <span className="text-label text-on-surface-variant">
                <span className="font-mono text-on-surface">{availableCount}</span> of{' '}
                <span className="font-mono">{filtered.length}</span> available now
              </span>
            </span>
          )
        }
      />

      {/* ── Filters ── */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 shrink-0 text-outline" aria-hidden />

        <Select
          aria-label="Filter by GPU model"
          value={filterModel}
          onChange={(e) => setFilterModel(e.target.value)}
          className="h-9 w-auto min-w-[9.5rem] text-label"
        >
          <option value="all">All GPUs</option>
          {GPU_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by region"
          value={filterRegion}
          onChange={(e) => setFilterRegion(e.target.value)}
          className="h-9 w-auto min-w-[9.5rem] text-label"
        >
          <option value="all">All regions</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>

        <Button
          size="sm"
          variant={filterVerified ? 'success' : 'secondary'}
          icon={ShieldCheck}
          aria-pressed={filterVerified}
          onClick={() => setFilterVerified((v) => !v)}
          className="h-9"
        >
          Verified only
        </Button>

        {filtersActive && (
          <Button size="sm" variant="ghost" onClick={clearFilters} className="h-9">
            Clear filters
          </Button>
        )}

        {/* Segmented view switch */}
        <div
          role="group"
          aria-label="Layout"
          className="ml-auto flex rounded-lg border border-outline-variant bg-surface-container p-0.5"
        >
          {(
            [
              ['grid', LayoutGrid, 'Grid'],
              ['list', List, 'List'],
            ] as const
          ).map(([mode, Icon, label]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              aria-pressed={viewMode === mode}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-caption font-medium transition-colors',
                viewMode === mode
                  ? 'bg-surface-container-highest text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Listings ── */}
      {loading ? (
        <SkeletonCards count={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Server}
          title={
            listings.length === 0
              ? 'No compute nodes registered yet'
              : 'No nodes match these filters'
          }
          description={
            listings.length === 0
              ? 'Nodes appear here as soon as providers register hardware on-chain.'
              : 'Widen the filters to see more of the network.'
          }
          action={
            filtersActive ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((node) => (
            <NodeCard key={node.nodeId.toString()} node={node} onLease={() => openLease(node)} />
          ))}
        </div>
      ) : (
        <NodeTable listings={filtered} onLease={openLease} />
      )}

      {/* ── AI pricing ── */}
      {Object.keys(aiSuggestions).length > 0 && (
        <Card className="mt-6 p-5">
          <div className="mb-4 flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 className="text-subtitle text-on-surface">Suggested rates</h2>
              <p className="mt-0.5 text-caption text-on-surface-variant">
                {aiSuggestions[GPU_MODELS[0]]?.reasoning ||
                  'The pricing engine weighs GPU supply, demand and benchmarks, then publishes rates to the on-chain oracle.'}
              </p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {Object.entries(aiSuggestions).map(([model, s]) => (
              <div
                key={model}
                className="flex items-baseline justify-between gap-2 border-b border-outline-variant py-1.5"
              >
                <dt className="truncate text-caption text-on-surface-variant">
                  {model.replace('NVIDIA ', '')}
                </dt>
                <dd className="font-mono text-caption text-primary">{formatBOT(s.pricePerHour)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {/* ── Lease dialog ── */}
      <Modal
        open={leaseTarget !== null}
        onClose={() => setLeaseTarget(null)}
        icon={Cpu}
        title="Lease compute"
        description={
          leaseTarget ? `${leaseTarget.model} · ${formatNodeId(leaseTarget.nodeId)}` : undefined
        }
        footer={
          <>
            <Button
              variant="primary"
              fullWidth
              loading={leasing}
              onClick={() => void handleLease()}
            >
              {leasing ? 'Confirming' : 'Confirm lease'}
            </Button>
            <Button variant="ghost" onClick={() => setLeaseTarget(null)}>
              Cancel
            </Button>
          </>
        }
      >
        {leaseTarget && (
          <div className="flex flex-col gap-4">
            <Field label="Workload type">
              {(p) => (
                <Select {...p} value={leaseType} onChange={(e) => setLeaseType(e.target.value)}>
                  <option value="Inference">Inference</option>
                  {/* Disabled pending implementation */}
                  <option value="LLM Training" disabled>
                    LLM training — coming soon
                  </option>
                  <option value="Fine-tuning" disabled>
                    Fine-tuning — coming soon
                  </option>
                  <option value="Image Generation" disabled>
                    Image generation — coming soon
                  </option>
                  <option value="Data Processing" disabled>
                    Data processing — coming soon
                  </option>
                </Select>
              )}
            </Field>

            <Field label="Duration" hint="Billed up front for the full duration.">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  value={leaseHours}
                  onChange={(e) => setLeaseHours(Math.max(1, Number(e.target.value) || 1))}
                />
              )}
            </Field>

            <div className="rounded-lg border border-outline-variant bg-surface-container p-3.5">
              <div className="flex items-baseline justify-between">
                <span className="text-label text-on-surface-variant">Total</span>
                <span className="font-mono text-title text-primary">
                  {formatBOT(leaseTarget.pricePerHour * BigInt(leaseHours))}
                  <span className="ml-1.5 text-caption font-normal text-on-surface-variant">
                    DGRAM
                  </span>
                </span>
              </div>
              <p className="mt-1 text-right font-mono text-caption text-outline">
                {formatBOT(leaseTarget.pricePerHour)} × {leaseHours}h
              </p>
            </div>
          </div>
        )}
      </Modal>
    </PageShell>
  );
}

/* ── Grid card ────────────────────────────────────────────
   Ranked, not flat: the machine and its price decide the lease, so
   they lead. Node id, provider and throughput are supporting detail.  */
function NodeCard({ node, onLease }: { node: NodeListing; onLease: () => void }) {
  const status = nodeStatus(node.status);
  // A node with no oracle price cannot be leased: createJob reverts inside the
  // price lookup. Showing it at "0.00/hr" with a live Lease button sent people
  // straight into that revert.
  const priced = node.pricePerHour > 0n;
  // Attestation is what createJob actually gates on. An Active node that the
  // registry verifier has not attested reverts with NodeNotVerified, so
  // offering it for lease sends the consumer straight into that revert.
  const available = node.status === NODE_STATUS_ACTIVE && priced && node.verified;

  return (
    <Card className="flex flex-col p-5 transition-colors hover:border-outline/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-subtitle text-on-surface">{node.model}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-caption text-on-surface-variant">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden />
            {node.region}
            {node.verified && (
              <>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1 text-compute-active">
                  <ShieldCheck className="h-3 w-3" aria-hidden /> Verified
                </span>
              </>
            )}
          </p>
        </div>
        <Badge tone={status.tone}>
          <StatusDot tone={status.tone} live={available} className="mr-0.5" />
          {status.label}
        </Badge>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-y border-outline-variant py-3">
        <Spec
          label={node.vramGB > 0 ? 'VRAM' : 'Type'}
          value={node.vramGB > 0 ? `${node.vramGB} GB` : 'CPU'}
        />
        <Spec label="TFLOPS" value={node.tflops.toString()} />
        <Spec label="Jobs done" value={`${node.completedJobs}/${node.jobCount}`} />
      </dl>

      <p className="mt-3 flex items-center justify-between text-caption text-outline">
        <span className="font-mono" title={node.nodeId.toString()}>
          {formatNodeId(node.nodeId)}
        </span>
        <span className="font-mono" title={node.provider}>
          {formatAddress(node.provider)}
        </span>
      </p>

      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <p>
          {priced ? (
            <>
              <span className="font-mono text-title text-primary">
                {formatBOT(node.pricePerHour)}
              </span>
              <span className="ml-1.5 text-caption text-on-surface-variant">DGRAM / hr</span>
            </>
          ) : (
            <span className="text-label text-on-surface-variant">Not priced by the oracle</span>
          )}
        </p>
        <Button
          variant={available ? 'primary' : 'secondary'}
          onClick={onLease}
          disabled={!available}
        >
          {available
            ? 'Lease'
            : !node.verified
              ? 'Awaiting attestation'
              : priced
                ? 'Unavailable'
                : 'Unpriced'}
        </Button>
      </div>
    </Card>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-eyebrow uppercase text-outline">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-label text-on-surface">{value}</dd>
    </div>
  );
}

/* ── List view ─────────────────────────────────────────── */
function NodeTable({
  listings,
  onLease,
}: {
  listings: NodeListing[];
  onLease: (n: NodeListing) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[54rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-outline-variant bg-surface-container/50">
              <Th>GPU</Th>
              <Th>Specs</Th>
              <Th>Region</Th>
              <Th>Provider</Th>
              <Th className="text-right">Rate / hr</Th>
              <Th>Status</Th>
              <Th className="text-right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {listings.map((node) => {
              const status = nodeStatus(node.status);
              const priced = node.pricePerHour > 0n;
              const available = node.status === NODE_STATUS_ACTIVE && priced && node.verified;
              return (
                <tr
                  key={node.nodeId.toString()}
                  className="border-b border-outline-variant last:border-0 transition-colors hover:bg-surface-container/40"
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
                    <p className="font-mono text-caption text-on-surface">
                      {node.vramGB > 0 ? `${node.vramGB} GB VRAM` : 'CPU only'}
                    </p>
                    <p className="font-mono text-caption text-outline">
                      {node.tflops} TFLOPS · {node.completedJobs}/{node.jobCount} done
                    </p>
                  </Td>
                  <Td>
                    <span className="flex items-center gap-1.5 text-caption text-on-surface-variant">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden /> {node.region}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className="flex items-center gap-1.5 font-mono text-caption text-on-surface-variant"
                      title={node.provider}
                    >
                      {node.verified && (
                        <ShieldCheck
                          className="h-3 w-3 shrink-0 text-compute-active"
                          aria-label="Verified"
                        />
                      )}
                      {formatAddress(node.provider)}
                    </span>
                  </Td>
                  <Td className="text-right">
                    {priced ? (
                      <>
                        <span className="font-mono text-label text-primary">
                          {formatBOT(node.pricePerHour)}
                        </span>
                        <span className="ml-1 text-caption text-outline">DGRAM</span>
                      </>
                    ) : (
                      <span className="text-caption text-outline">Unpriced</span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={status.tone}>
                      <StatusDot tone={status.tone} live={available} className="mr-0.5" />
                      {status.label}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant={available ? 'primary' : 'secondary'}
                      onClick={() => onLease(node)}
                      disabled={!available}
                    >
                      {available
                        ? 'Lease'
                        : !node.verified
                          ? 'Unattested'
                          : priced
                            ? '—'
                            : 'Unpriced'}
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
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
