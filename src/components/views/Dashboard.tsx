import { useEffect, useMemo, useState } from 'react';
import { motion, type Variants } from 'motion/react';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  RadialBarChart,
  RadialBar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  TrendingUp,
  Cpu,
  Activity,
  ShieldCheck,
  MapPin,
  Zap,
  DollarSign,
  Server,
  BarChart3,
  CheckCircle2,
  Layers,
  Globe,
  User,
  PieChart as PieIcon,
} from 'lucide-react';
import { PageShell, PageHeader, SectionHeader } from '@/components/layout/PageShell';
import { Card } from '@/components/ui/Card';
import { Stat } from '@/components/ui/Stat';
import { Badge, StatusDot } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonStats, Skeleton } from '@/components/ui/Skeleton';
import { useWalletContext } from '@/context/WalletContext';
import { useComputeRegistry } from '@/hooks/useComputeRegistry';
import { useComputeMarketplace } from '@/hooks/useComputeMarketplace';
import { useComputeIndexToken } from '@/hooks/useComputeIndexToken';
import { formatBOTCompact, timeAgo, formatNodeId } from '@/lib/format';

// Format aggregate compute power (TFLOPS) into a compact human label.
function formatTflops(tflops: number): { value: string; unit: string } {
  if (tflops >= 1000) return { value: (tflops / 1000).toFixed(2), unit: 'PFLOPS' };
  return { value: tflops.toString(), unit: 'TFLOPS' };
}

// ── Types ────────────────────────────────────────────────
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
  jobCount: number;
  completedJobs: number;
}

// ── Constants ────────────────────────────────────────────
const STATUS_LABELS = ['Inactive', 'Active', 'Busy', 'Offline'];
// Inactive reads as dormant, not as a warning — it gets the neutral tone
// rather than the amber it used to share with "needs attention" states.
const STATUS_COLORS = ['#6b7688', '#35d97e', '#98cbff', '#ff6b6b'];
const STATUS_TONES = ['neutral', 'success', 'accent', 'danger'] as const;

// ── Animation variants ───────────────────────────────────
const containerStagger: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};
const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
};

// ── Chart tooltip ────────────────────────────────────────
/** Recharts hands the tooltip one entry per rendered series. */
interface TooltipEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
  fill?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container px-3 py-2 shadow-xl shadow-black/40">
      {label !== undefined && (
        <p className="mb-1 font-mono text-caption text-on-surface-variant">{label}</p>
      )}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-1.5 font-mono text-caption text-on-surface">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color ?? entry.fill }}
          />
          {entry.name}: <span className="font-semibold">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

const AXIS_TICK = { fontSize: 11, fill: '#6b7688', fontFamily: 'JetBrains Mono' };

// ── Main Component ───────────────────────────────────────
export function Dashboard() {
  const { address } = useWalletContext();
  const {
    getProviderNodes,
    getNode,
    getProviderRevenue,
    getTotalActiveNodes,
    getGlobalComputePower,
  } = useComputeRegistry();
  const { getTotalJobs, getTotalVolume, getAllJobCounts, getCompletedJobStats } =
    useComputeMarketplace();
  const { getTVL, getTotalSupply } = useComputeIndexToken();

  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0n);
  const [activeNodes, setActiveNodes] = useState(0n);
  const [totalJobs, setTotalJobs] = useState(0n);
  const [totalVolume, setTotalVolume] = useState(0n);
  const [tvl, setTvl] = useState(0n);
  const [cifSupply, setCifSupply] = useState(0n);
  const [totalTflops, setTotalTflops] = useState(0);
  const [totalVram, setTotalVram] = useState(0);
  const [completedStats, setCompletedStats] = useState<{
    perNode: Map<string, number>;
    perType: Map<string, number>;
    total: number;
  }>({ perNode: new Map(), perType: new Map(), total: 0 });

  useEffect(() => {
    async function loadData(showLoading = false) {
      if (showLoading) setLoading(true);
      try {
        // ── Global network data (always load) ──
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

        // ── Global compute power: aggregate TFLOPS + VRAM across all nodes ──
        // Node IDs are hash-derived (not sequential), so the hook reads
        // NodeRegistered logs to enumerate real IDs, then sums each node's specs.
        try {
          const power = await getGlobalComputePower();
          setTotalTflops(power.tflops);
          setTotalVram(power.vram);
        } catch (err) {
          console.error('[Dashboard] Compute power aggregation failed:', err);
        }

        // ── Personal provider data (only if wallet connected) ──
        if (address) {
          const [nodeIds, revenue] = await Promise.all([
            getProviderNodes(address),
            getProviderRevenue(address),
          ]);
          setTotalRevenue(revenue);

          const [jc, completed] = await Promise.all([getAllJobCounts(), getCompletedJobStats()]);
          setCompletedStats({
            perNode: completed.perNode,
            perType: completed.perType,
            total: completed.total,
          });

          const nodeDetails: NodeInfo[] = [];
          for (const id of nodeIds.slice(0, 10)) {
            try {
              const node = await getNode(id);
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
                  jobCount: jc.get(id.toString()) ?? 0,
                  completedJobs: completed.perNode.get(id.toString()) ?? 0,
                });
              }
            } catch (err) {
              // One unreadable node must not blank the whole dashboard.
              console.warn('[Dashboard] skipping node', id.toString(), err);
            }
          }
          setNodes(nodeDetails);
        }
      } catch (err) {
        console.error('[Dashboard] Load failed:', err);
      } finally {
        if (showLoading) setLoading(false);
      }
    }

    // Initial load with loading placeholders
    void loadData(true);

    // ── Optional auto-refresh polling honoring Settings preference ──
    const refreshInterval = Number(localStorage.getItem('botchain-refresh-interval') ?? 0);
    let timer: ReturnType<typeof setInterval> | undefined;
    if (refreshInterval > 0) {
      timer = setInterval(() => void loadData(false), refreshInterval * 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [address]);

  // ── Personal derived data ──
  const revenueChartData = useMemo(
    () =>
      nodes.map((n) => ({
        name: formatNodeId(n.nodeId),
        revenue: Number(n.totalRevenue) / 1e18,
        status: n.status,
        fill: STATUS_COLORS[n.status] ?? STATUS_COLORS[0],
      })),
    [nodes],
  );

  const myTotalJobs = useMemo(() => nodes.reduce((sum, n) => sum + n.jobCount, 0), [nodes]);
  const myCompletedJobs = useMemo(
    () => nodes.reduce((sum, n) => sum + n.completedJobs, 0),
    [nodes],
  );
  const verifiedCount = useMemo(() => nodes.filter((n) => n.verified).length, [nodes]);

  const myCompletionRate = useMemo(() => {
    if (myTotalJobs === 0) return 0;
    return Math.round((myCompletedJobs / myTotalJobs) * 100);
  }, [myTotalJobs, myCompletedJobs]);

  const myDonutData = useMemo(
    () => [
      { name: 'Completed', value: myCompletedJobs, fill: '#35d97e' },
      { name: 'Pending', value: Math.max(0, myTotalJobs - myCompletedJobs), fill: '#262c38' },
    ],
    [myTotalJobs, myCompletedJobs],
  );

  const healthScore = useMemo(() => {
    const activeRatio =
      nodes.length > 0
        ? nodes.filter((n) => n.status === 1 || n.status === 2).length / nodes.length
        : 0;
    const completionRatio = myTotalJobs > 0 ? myCompletedJobs / myTotalJobs : 0;
    const verifiedRatio = nodes.length > 0 ? verifiedCount / nodes.length : 0;
    return Math.round((activeRatio * 40 + completionRatio * 35 + verifiedRatio * 25) * 100) / 100;
  }, [nodes, myTotalJobs, myCompletedJobs, verifiedCount]);

  const healthData = [
    {
      name: 'Health',
      value: healthScore,
      fill: healthScore > 70 ? '#35d97e' : healthScore > 40 ? '#f5b544' : '#ff6b6b',
    },
  ];

  const marketShare =
    Number(totalVolume) > 0
      ? ((Number(totalRevenue) / Number(totalVolume)) * 100).toFixed(1)
      : '0.0';

  const compute = formatTflops(totalTflops);

  // ── Network overview: shown whether or not a wallet is connected ──
  const networkSection = (
    <section className="mb-8">
      <SectionHeader
        icon={Globe}
        title="Network overview"
        description="Live totals across the BOT Chain DePIN network"
      />
      {loading ? (
        <SkeletonStats count={5} />
      ) : (
        <motion.div
          variants={containerStagger}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 gap-3 lg:grid-cols-5"
        >
          <motion.div variants={fadeInUp}>
            <Stat
              label="Active nodes"
              value={activeNodes.toString()}
              detail="network-wide"
              icon={Server}
              tone="accent"
            />
          </motion.div>
          <motion.div variants={fadeInUp}>
            {/* Completed counts are only fetched alongside provider data, so
                don't claim "0 completed" before a wallet is connected. */}
            <Stat
              label="Total jobs"
              value={totalJobs.toString()}
              detail={address ? `${completedStats.total} completed` : 'network-wide'}
              icon={Zap}
            />
          </motion.div>
          <motion.div variants={fadeInUp}>
            <Stat
              label="Network volume"
              value={formatBOTCompact(totalVolume)}
              unit="DGRAM"
              icon={TrendingUp}
            />
          </motion.div>
          <motion.div variants={fadeInUp}>
            <Stat
              label="Compute power"
              value={compute.value}
              unit={compute.unit}
              detail={`${totalVram.toLocaleString()} GB VRAM pooled`}
              icon={Cpu}
              tone="success"
            />
          </motion.div>
          <motion.div variants={fadeInUp}>
            <Stat
              label="CIF value locked"
              value={formatBOTCompact(tvl)}
              unit="DGRAM"
              detail={`${formatBOTCompact(cifSupply)} CIF in circulation`}
              icon={Layers}
              tone="accent"
            />
          </motion.div>
        </motion.div>
      )}
    </section>
  );

  return (
    <PageShell>
      <PageHeader
        title="Dashboard"
        description="On-chain telemetry for the network and for the compute you provide."
      />

      {networkSection}

      {/* ── Your provider ── */}
      <section>
        <SectionHeader
          icon={User}
          title="Your provider"
          description="Nodes you operate, what they earned, and how reliably they finish work"
        />

        {!address ? (
          <EmptyState
            icon={Cpu}
            title="Connect a wallet to see your nodes"
            description="Provider stats — revenue, job history and node health — are read from the address you connect."
          />
        ) : loading ? (
          <div className="flex flex-col gap-4">
            <SkeletonStats count={5} />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Personal KPI row. Market share lives here rather than in a
                separate "network context" panel that restated the totals
                already shown above. */}
            <motion.div
              variants={containerStagger}
              initial="hidden"
              animate="show"
              className="grid grid-cols-2 gap-3 lg:grid-cols-5"
            >
              <motion.div variants={fadeInUp}>
                <Stat
                  label="Revenue earned"
                  value={formatBOTCompact(totalRevenue)}
                  unit="DGRAM"
                  icon={DollarSign}
                  tone="success"
                />
              </motion.div>
              <motion.div variants={fadeInUp}>
                <Stat
                  label="Your nodes"
                  value={nodes.length.toString()}
                  detail={`${verifiedCount} verified`}
                  icon={Cpu}
                  tone="accent"
                />
              </motion.div>
              <motion.div variants={fadeInUp}>
                <Stat
                  label="Jobs received"
                  value={myTotalJobs.toString()}
                  detail={`${myCompletedJobs} completed`}
                  icon={CheckCircle2}
                />
              </motion.div>
              <motion.div variants={fadeInUp}>
                <Stat
                  label="Completion rate"
                  value={`${myCompletionRate}%`}
                  detail="jobs finished on-chain"
                  icon={Activity}
                  tone="success"
                />
              </motion.div>
              <motion.div variants={fadeInUp}>
                <Stat
                  label="Market share"
                  value={`${marketShare}%`}
                  detail="of network volume"
                  icon={PieIcon}
                  tone="accent"
                />
              </motion.div>
            </motion.div>

            {/* Charts */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Card className="p-5 xl:col-span-2">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-subtitle text-on-surface">Revenue by node</h3>
                  <BarChart3 className="h-4 w-4 text-outline" aria-hidden />
                </div>
                {revenueChartData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart
                        data={revenueChartData}
                        margin={{ top: 4, right: 4, bottom: 4, left: -16 }}
                      >
                        <XAxis
                          dataKey="name"
                          tick={AXIS_TICK}
                          axisLine={{ stroke: '#262c38' }}
                          tickLine={false}
                        />
                        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: '#262c3840' }} />
                        <Bar dataKey="revenue" radius={[4, 4, 0, 0]} maxBarSize={56}>
                          {revenueChartData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-4 border-t border-outline-variant pt-3">
                      {STATUS_LABELS.map((label, i) => (
                        <span key={i} className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: STATUS_COLORS[i] }}
                          />
                          <span className="text-caption text-on-surface-variant">{label}</span>
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex h-[200px] items-center justify-center">
                    <p className="text-caption text-outline">No revenue recorded yet</p>
                  </div>
                )}
              </Card>

              <Card className="p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-subtitle text-on-surface">Provider health</h3>
                  <Activity className="h-4 w-4 text-outline" aria-hidden />
                </div>
                <div className="relative h-[168px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadialBarChart
                      cx="50%"
                      cy="50%"
                      innerRadius="72%"
                      outerRadius="100%"
                      data={healthData}
                      startAngle={90}
                      endAngle={-270}
                    >
                      <RadialBar
                        background={{ fill: '#262c38' }}
                        dataKey="value"
                        cornerRadius={10}
                        fill={healthData[0].fill}
                      />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono text-display" style={{ color: healthData[0].fill }}>
                      {healthScore}
                    </span>
                    <span className="text-eyebrow uppercase text-outline">of 100</span>
                  </div>
                </div>
                <dl className="mt-3 flex flex-col gap-2 border-t border-outline-variant pt-3">
                  <HealthRow
                    label="Nodes online"
                    value={`${nodes.filter((n) => n.status === 1 || n.status === 2).length}/${nodes.length}`}
                  />
                  <HealthRow label="Verified" value={`${verifiedCount}/${nodes.length}`} />
                  <HealthRow label="Completion" value={`${myCompletionRate}%`} />
                </dl>
              </Card>
            </div>

            {/* Node list + job completion */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Card className="p-5 xl:col-span-2">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-subtitle text-on-surface">Your compute nodes</h3>
                  {nodes.length > 0 && (
                    <Badge tone="success">
                      <StatusDot tone="success" live className="mr-0.5" />
                      {nodes.length} registered
                    </Badge>
                  )}
                </div>

                {nodes.length === 0 ? (
                  <EmptyState
                    icon={Cpu}
                    title="No nodes registered"
                    description="Register hardware from My Nodes to start receiving compute jobs."
                    className="border-0 bg-transparent py-8"
                  />
                ) : (
                  <motion.ul
                    variants={containerStagger}
                    initial="hidden"
                    animate="show"
                    className="flex flex-col gap-2"
                  >
                    {nodes.map((node, idx) => {
                      const completionPct =
                        node.jobCount > 0
                          ? Math.round((node.completedJobs / node.jobCount) * 100)
                          : 0;
                      return (
                        <motion.li
                          key={idx}
                          variants={fadeInUp}
                          className="relative overflow-hidden rounded-lg border border-outline-variant bg-surface-container/60 p-3.5 transition-colors hover:border-outline/60 hover:bg-surface-container"
                        >
                          <span
                            aria-hidden
                            className="absolute inset-y-0 left-0 w-0.5"
                            style={{ backgroundColor: STATUS_COLORS[node.status] }}
                          />
                          <div className="flex items-start justify-between gap-3 pl-2">
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex flex-wrap items-center gap-2">
                                <span className="text-label text-on-surface">{node.model}</span>
                                <Badge tone={STATUS_TONES[node.status]}>
                                  {STATUS_LABELS[node.status]}
                                </Badge>
                                {node.verified && (
                                  <ShieldCheck
                                    className="h-3.5 w-3.5 text-compute-active"
                                    aria-label="Verified"
                                  />
                                )}
                              </div>
                              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-on-surface-variant">
                                <span className="font-mono" title={node.nodeId.toString()}>
                                  {formatNodeId(node.nodeId)}
                                </span>
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" aria-hidden /> {node.region}
                                </span>
                                {node.vramGB > 0 && (
                                  <span className="font-mono">{node.vramGB} GB VRAM</span>
                                )}
                                <span>{timeAgo(node.registeredAt)}</span>
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <span className="block text-eyebrow uppercase text-outline">
                                Revenue
                              </span>
                              <span className="font-mono text-label text-compute-active">
                                {formatBOTCompact(node.totalRevenue)}
                              </span>
                            </div>
                          </div>
                          <div className="mt-2.5 pl-2">
                            <div className="mb-1 flex items-center justify-between text-caption">
                              <span className="text-on-surface-variant">
                                <span className="font-mono">{node.completedJobs}</span> of{' '}
                                <span className="font-mono">{node.jobCount}</span> jobs completed
                              </span>
                              <span className="font-mono text-on-surface-variant">
                                {completionPct}%
                              </span>
                            </div>
                            <div
                              className="h-1 w-full overflow-hidden rounded-full bg-surface-container-highest"
                              role="progressbar"
                              aria-valuenow={completionPct}
                              aria-valuemin={0}
                              aria-valuemax={100}
                            >
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${completionPct}%` }}
                                transition={{
                                  delay: 0.2 + idx * 0.05,
                                  duration: 0.5,
                                  ease: 'easeOut',
                                }}
                                className="h-full rounded-full"
                                style={{
                                  backgroundColor:
                                    completionPct === 100
                                      ? '#35d97e'
                                      : completionPct > 50
                                        ? '#f5b544'
                                        : '#6b7688',
                                }}
                              />
                            </div>
                          </div>
                        </motion.li>
                      );
                    })}
                  </motion.ul>
                )}
              </Card>

              <Card className="p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-subtitle text-on-surface">Job completion</h3>
                  <CheckCircle2 className="h-4 w-4 text-outline" aria-hidden />
                </div>
                <div className="relative h-[168px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={myDonutData}
                        cx="50%"
                        cy="50%"
                        innerRadius={58}
                        outerRadius={78}
                        paddingAngle={3}
                        dataKey="value"
                        stroke="none"
                      >
                        {myDonutData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono text-display text-on-surface">
                      {myCompletionRate}%
                    </span>
                    <span className="text-eyebrow uppercase text-outline">completed</span>
                  </div>
                </div>
                <dl className="mt-3 flex flex-col gap-2 border-t border-outline-variant pt-3">
                  <HealthRow
                    label="Completed"
                    value={myCompletedJobs.toString()}
                    tone="text-compute-active"
                  />
                  <HealthRow
                    label="Pending"
                    value={Math.max(0, myTotalJobs - myCompletedJobs).toString()}
                  />
                </dl>
              </Card>
            </div>
          </div>
        )}
      </section>
    </PageShell>
  );
}

function HealthRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-caption text-on-surface-variant">{label}</dt>
      <dd className={`font-mono text-caption font-semibold ${tone ?? 'text-on-surface'}`}>
        {value}
      </dd>
    </div>
  );
}
