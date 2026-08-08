import React, { useEffect, useState, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  RadialBarChart, RadialBar,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  TrendingUp, Cpu, Activity, ShieldCheck,
  MapPin, Zap, DollarSign, Server, BarChart3,
  CheckCircle2, Wallet, Layers, Globe, User,
} from 'lucide-react';
import { useWalletContext } from '@/context/WalletContext';
import { useComputeRegistry } from '@/hooks/useComputeRegistry';
import { useComputeMarketplace } from '@/hooks/useComputeMarketplace';
import { useComputeIndexToken } from '@/hooks/useComputeIndexToken';
import { formatBOT, formatBOTCompact, timeAgo, formatAddress } from '@/lib/format';

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
const STATUS_COLORS = ['#FFB800', '#00FF41', '#98cbff', '#FF4B4B'];
const STATUS_BG = [
  'bg-compute-idle/15 text-compute-idle',
  'bg-compute-active/15 text-compute-active',
  'bg-primary/15 text-primary',
  'bg-compute-down/15 text-compute-down',
];

// ── Animation variants ───────────────────────────────────
const containerStagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};
const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
};
const scaleIn = {
  hidden: { opacity: 0, scale: 0.95 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.35, ease: 'easeOut' } },
};

// ── Section Header ───────────────────────────────────────
function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-container-high">
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <div>
        <h2 className="text-sm font-bold text-on-background">{title}</h2>
        {subtitle && <p className="text-[10px] text-on-surface-variant">{subtitle}</p>}
      </div>
    </div>
  );
}

// ── Mini Stat Card ───────────────────────────────────────
function StatCard({ label, value, sublabel, icon: Icon, accent }: {
  label: string; value: string; sublabel?: string; icon: React.ElementType; accent: string;
}) {
  return (
    <motion.div variants={fadeInUp} className="relative overflow-hidden rounded-xl bg-surface-container-low p-3">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <span className="mb-1 block font-mono text-[9px] font-semibold uppercase tracking-wider text-outline">{label}</span>
          <span className={`block font-mono text-lg font-bold leading-tight ${accent}`}>{value}</span>
          {sublabel && <span className="mt-0.5 block font-mono text-[9px] text-outline">{sublabel}</span>}
        </div>
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/20 ${accent}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
    </motion.div>
  );
}

// ── Chart tooltip ────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 shadow-xl">
      {label && <p className="mb-1 font-mono text-[10px] font-semibold text-outline">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-mono text-xs text-on-surface">
          <span className="inline-block h-2 w-2 rounded-full mr-1.5" style={{ backgroundColor: p.color || p.fill }} />
          {p.name}: <span className="font-semibold">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────
export function Dashboard() {
  const { address } = useWalletContext();
  const { getProviderNodes, getNode, getProviderRevenue, getTotalActiveNodes } = useComputeRegistry();
  const { getTotalJobs, getTotalVolume, getAllJobCounts, getCompletedJobStats } = useComputeMarketplace();
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
  const [jobCounts, setJobCounts] = useState<Map<string, number>>(new Map());
  const [completedStats, setCompletedStats] = useState<{
    perNode: Map<string, number>;
    perType: Map<string, number>;
    total: number;
  }>({ perNode: new Map(), perType: new Map(), total: 0 });

  useEffect(() => {
    async function loadData() {
      setLoading(true);
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

        // ── Personal provider data (only if wallet connected) ──
        if (address) {
          const [nodeIds, revenue, bal] = await Promise.all([
            getProviderNodes(address),
            getProviderRevenue(address),
            getBalance(address),
          ]);
          setTotalRevenue(revenue);
          setCifBalance(bal);

          const [jc, completed] = await Promise.all([
            getAllJobCounts(),
            getCompletedJobStats(),
          ]);
          setJobCounts(jc);
          setCompletedStats({ perNode: completed.perNode, perType: completed.perType, total: completed.total });

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
                  jobCount: jc.get(id.toString()) ?? 0,
                  completedJobs: completed.perNode.get(id.toString()) ?? 0,
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

  // ── Personal derived data ──
  const revenueChartData = useMemo(() =>
    nodes.map(n => ({
      name: `#${n.nodeId.toString()}`,
      revenue: Number(n.totalRevenue) / 1e18,
      status: n.status,
      fill: STATUS_COLORS[n.status] ?? STATUS_COLORS[0],
    })),
  [nodes]);

  const myCompletionRate = useMemo(() => {
    const total = nodes.reduce((sum, n) => sum + n.jobCount, 0);
    if (total === 0) return 0;
    const completed = nodes.reduce((sum, n) => sum + n.completedJobs, 0);
    return Math.round((completed / total) * 100);
  }, [nodes]);

  const myDonutData = useMemo(() => {
    const total = nodes.reduce((sum, n) => sum + n.jobCount, 0);
    const completed = nodes.reduce((sum, n) => sum + n.completedJobs, 0);
    const pending = Math.max(0, total - completed);
    return [
      { name: 'Completed', value: completed, fill: '#00FF41' },
      { name: 'Pending', value: pending, fill: '#3f4852' },
    ];
  }, [nodes]);

  const myTotalJobs = useMemo(() => nodes.reduce((sum, n) => sum + n.jobCount, 0), [nodes]);
  const myCompletedJobs = useMemo(() => nodes.reduce((sum, n) => sum + n.completedJobs, 0), [nodes]);
  const verifiedCount = useMemo(() => nodes.filter(n => n.verified).length, [nodes]);

  const healthScore = useMemo(() => {
    const activeRatio = nodes.length > 0
      ? nodes.filter(n => n.status === 1 || n.status === 2).length / nodes.length
      : 0;
    const completionRatio = myTotalJobs > 0 ? myCompletedJobs / myTotalJobs : 0;
    const verifiedRatio = nodes.length > 0 ? verifiedCount / nodes.length : 0;
    return Math.round((activeRatio * 40 + completionRatio * 35 + verifiedRatio * 25) * 100) / 100;
  }, [nodes, myTotalJobs, myCompletedJobs, verifiedCount]);

  const healthData = [{ name: 'Health', value: healthScore, fill: healthScore > 70 ? '#00FF41' : healthScore > 40 ? '#FFB800' : '#FF4B4B' }];

  // ── Loading state ──
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

  // ── Not connected ──
  if (!address) {
    return (
      <div className="px-6 pb-8 w-full">
        {/* Still show global network data */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 mt-4">
          <SectionHeader icon={Globe} title="Network Overview" subtitle="Global BOT Chain DePIN statistics" />
          <motion.div variants={containerStagger} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Active Nodes" value={activeNodes.toString()} icon={Server} accent="text-primary" />
            <StatCard label="Total Jobs" value={totalJobs.toString()} icon={Zap} accent="text-compute-idle" />
            <StatCard label="Network Volume" value={formatBOTCompact(totalVolume)} sublabel="DGRAM" icon={TrendingUp} accent="text-on-surface" />
            <StatCard label="CIF Supply" value={formatBOTCompact(cifSupply)} sublabel="DGRAM" icon={Layers} accent="text-primary" />
          </motion.div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center rounded-2xl bg-surface-container-low p-12 mt-4"
        >
          <Cpu className="mb-3 h-10 w-10 text-outline" />
          <h2 className="mb-1 text-sm font-semibold text-on-surface">Connect Wallet to View Provider Stats</h2>
          <p className="text-xs text-on-surface-variant">Connect your wallet to see your compute nodes, revenue, and earnings.</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="px-6 pb-8 w-full">
      {/* ── Page Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-6 mt-4 flex items-end justify-between"
      >
        <div>
          <h1 className="mb-1 text-base font-bold leading-tight tracking-tight text-on-background">Dashboard</h1>
          <p className="max-w-2xl text-xs text-on-surface-variant">Real-time on-chain telemetry for BOT Chain DePIN network.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end rounded-lg bg-surface-container-low px-3 py-2">
            <span className="font-mono text-[10px] font-semibold text-outline">WALLET</span>
            <span className="font-mono text-sm text-on-surface-variant">{formatAddress(address)}</span>
          </div>
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════ */}
      {/* SECTION 1: 🌐 NETWORK OVERVIEW (Global Data)        */}
      {/* ═══════════════════════════════════════════════════ */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="mb-6">
        <SectionHeader icon={Globe} title="Network Overview" subtitle="Global BOT Chain DePIN statistics" />

        {/* Global KPI Row */}
        <motion.div variants={containerStagger} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Active Nodes" value={activeNodes.toString()} sublabel="network-wide" icon={Server} accent="text-primary" />
          <StatCard label="Total Jobs" value={totalJobs.toString()} sublabel={`${completedStats.total} completed`} icon={Zap} accent="text-compute-idle" />
          <StatCard label="Network Volume" value={formatBOTCompact(totalVolume)} sublabel="DGRAM" icon={TrendingUp} accent="text-on-surface" />
          <StatCard label="CIF TVL" value={formatBOTCompact(tvl)} sublabel={`${formatBOTCompact(cifSupply)} supply`} icon={Layers} accent="text-compute-active" />
        </motion.div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════ */}
      {/* SECTION 2: 💻 YOUR PROVIDER (Personal Data)          */}
      {/* ═══════════════════════════════════════════════════ */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
        <div className="mb-4 flex items-center justify-between">
          <SectionHeader icon={User} title="Your Provider" subtitle="Your compute nodes, revenue, and performance" />
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end rounded-lg bg-surface-container-low px-3 py-2">
              <span className="font-mono text-[10px] font-semibold text-outline">CIF BALANCE</span>
              <span className="font-mono text-sm text-primary">{formatBOTCompact(cifBalance)}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          {/* ── Left: Personal KPIs + Charts ── */}
          <div className="flex flex-col gap-4 xl:col-span-8">
            {/* Personal KPI Row */}
            <motion.div variants={containerStagger} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Your Revenue" value={formatBOTCompact(totalRevenue)} sublabel="DGRAM earned" icon={DollarSign} accent="text-compute-active" />
              <StatCard label="Your Nodes" value={nodes.length.toString()} sublabel={`${verifiedCount} verified`} icon={Cpu} accent="text-primary" />
              <StatCard label="Your Jobs" value={myTotalJobs.toString()} sublabel={`${myCompletedJobs} completed`} icon={CheckCircle2} accent="text-compute-idle" />
              <StatCard label="Completion" value={`${myCompletionRate}%`} sublabel="job success rate" icon={Activity} accent="text-compute-active" />
            </motion.div>

            {/* Charts Row */}
            <motion.div variants={containerStagger} initial="hidden" animate="show" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Revenue Distribution Bar Chart */}
              <motion.div variants={scaleIn} className="rounded-2xl bg-surface-container-low p-4">
                <div className="mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-outline" />
                  <h3 className="text-xs font-semibold text-on-surface">Revenue by Node</h3>
                </div>
                {revenueChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={revenueChartData} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#88919d', fontFamily: 'JetBrains Mono' }} axisLine={{ stroke: '#3f4852' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: '#88919d', fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: '#3f485220' }} />
                      <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                        {revenueChartData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-[180px] items-center justify-center">
                    <span className="font-mono text-[10px] text-outline">No revenue data yet</span>
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
                  {STATUS_LABELS.map((label, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[i] }} />
                      <span className="font-mono text-[9px] text-outline">{label}</span>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Job Completion Donut — Personal */}
              <motion.div variants={scaleIn} className="rounded-2xl bg-surface-container-low p-4">
                <div className="mb-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-outline" />
                  <h3 className="text-xs font-semibold text-on-surface">Your Job Completion</h3>
                </div>
                <div className="relative h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={myDonutData} cx="50%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={3} dataKey="value" stroke="none">
                        {myDonutData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono text-2xl font-bold text-on-surface">{myCompletionRate}%</span>
                    <span className="font-mono text-[9px] text-outline">COMPLETION</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-center gap-4">
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-compute-active" />
                    <span className="font-mono text-[9px] text-outline">Completed: {myCompletedJobs}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-outline-variant" />
                    <span className="font-mono text-[9px] text-outline">Pending: {Math.max(0, myTotalJobs - myCompletedJobs)}</span>
                  </div>
                </div>
              </motion.div>
            </motion.div>

            {/* Node Cards + Health Gauge */}
            <motion.div variants={fadeInUp} initial="hidden" animate="show" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Provider Health Gauge */}
              <div className="rounded-2xl bg-surface-container-low p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-outline" />
                  <h3 className="text-xs font-semibold text-on-surface">Provider Health</h3>
                </div>
                <div className="relative h-[160px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadialBarChart cx="50%" cy="50%" innerRadius="70%" outerRadius="100%" data={healthData} startAngle={90} endAngle={-270}>
                      <RadialBar background={{ fill: '#3f485230' }} dataKey="value" cornerRadius={10} fill={healthData[0].fill} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono text-3xl font-bold" style={{ color: healthData[0].fill }}>{healthScore}</span>
                    <span className="font-mono text-[9px] text-outline">/ 100</span>
                  </div>
                </div>
                <div className="mt-1 flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[9px] text-outline">Active Nodes</span>
                    <span className="font-mono text-[9px] font-semibold text-compute-active">
                      {nodes.filter(n => n.status === 1 || n.status === 2).length}/{nodes.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[9px] text-outline">Verified</span>
                    <span className="font-mono text-[9px] font-semibold text-primary">{verifiedCount}/{nodes.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[9px] text-outline">Completion</span>
                    <span className="font-mono text-[9px] font-semibold text-compute-idle">{myCompletionRate}%</span>
                  </div>
                </div>
              </div>

              {/* Your Compute Nodes */}
              <div className="lg:col-span-2 rounded-2xl bg-surface-container-low p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-outline" />
                    <h3 className="text-xs font-semibold text-on-surface">Your Compute Nodes</h3>
                  </div>
                  <span className="flex items-center gap-1.5 rounded-full bg-compute-active/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-compute-active">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-compute-active"></span>
                    {nodes.length} REGISTERED
                  </span>
                </div>
                <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
                  {nodes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-6">
                      <Cpu className="mb-2 h-6 w-6 text-outline" />
                      <p className="text-xs text-on-surface-variant">No nodes registered yet.</p>
                    </div>
                  ) : (
                    <motion.div variants={containerStagger} initial="hidden" animate="show" className="flex flex-col gap-2">
                      {nodes.map((node, idx) => {
                        const completionPct = node.jobCount > 0 ? Math.round((node.completedJobs / node.jobCount) * 100) : 0;
                        const statusColor = STATUS_COLORS[node.status] ?? STATUS_COLORS[0];
                        return (
                          <motion.div
                            key={idx}
                            variants={fadeInUp}
                            whileHover={{ scale: 1.02, transition: { duration: 0.15 } }}
                            className="group relative overflow-hidden rounded-xl bg-surface-container p-3 transition-colors hover:bg-surface-container-high"
                          >
                            <div className="absolute left-0 top-0 h-full w-1" style={{ backgroundColor: statusColor }} />
                            <div className="flex items-start justify-between gap-3 pl-2">
                              <div className="min-w-0 flex-1">
                                <div className="mb-1 flex items-center gap-1.5">
                                  <span className="font-mono text-[10px] font-semibold text-outline">NODE #{node.nodeId.toString()}</span>
                                  <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${STATUS_BG[node.status]}`}>
                                    {STATUS_LABELS[node.status]}
                                  </span>
                                  {node.verified && <ShieldCheck className="h-3 w-3 text-compute-active" />}
                                </div>
                                <p className="text-xs font-medium text-on-surface">{node.model}</p>
                                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-outline">
                                  <span className="flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" /> {node.region}</span>
                                  <span>{node.vramGB} GB VRAM</span>
                                  <span>{timeAgo(node.registeredAt)}</span>
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <span className="mb-0.5 block font-mono text-[9px] font-semibold text-outline">REVENUE</span>
                                <span className="font-mono text-xs font-medium text-compute-active">{formatBOTCompact(node.totalRevenue)}</span>
                              </div>
                            </div>
                            <div className="mt-2 pl-2">
                              <div className="mb-1 flex items-center justify-between">
                                <span className="font-mono text-[9px] text-outline">Jobs: {node.completedJobs}/{node.jobCount}</span>
                                <span className="font-mono text-[9px] font-semibold text-on-surface-variant">{completionPct}%</span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${completionPct}%` }}
                                  transition={{ delay: 0.5 + idx * 0.1, duration: 0.6, ease: 'easeOut' }}
                                  className="h-full rounded-full"
                                  style={{ backgroundColor: completionPct === 100 ? '#00FF41' : completionPct > 50 ? '#FFB800' : '#FF4B4B' }}
                                />
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>

          {/* ── Right: Per-Node Revenue + Network Context ── */}
          <div className="flex flex-col gap-4 xl:col-span-4">
            {/* Per-Node Revenue Breakdown */}
            <motion.div variants={scaleIn} initial="hidden" animate="show" className="rounded-2xl bg-surface-container p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-on-surface">Per-Node Revenue</h3>
                <BarChart3 className="h-3.5 w-3.5 text-outline" />
              </div>
              <div className="flex flex-col gap-2">
                {nodes.length > 0 ? (
                  nodes.map((node, idx) => (
                    <div key={idx} className="rounded-xl bg-surface-container-low p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-on-surface">
                          <Cpu className="h-3 w-3 text-outline" /> Node #{node.nodeId.toString()}
                        </span>
                        {node.verified && <ShieldCheck className="h-3 w-3 text-compute-active" />}
                      </div>
                      <div className="flex items-end justify-between">
                        <div>
                          <span className="font-mono text-sm font-bold text-compute-active">{formatBOTCompact(node.totalRevenue)}</span>
                          <span className="ml-1 font-mono text-[10px] text-outline">DGRAM</span>
                        </div>
                        <span className="font-mono text-[9px] text-outline">{node.jobCount} jobs · {node.completedJobs} done</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-center p-4">
                    <span className="font-mono text-[10px] text-outline">No nodes registered</span>
                  </div>
                )}
                {/* Wallet */}
                {address && (
                  <div className="mt-1 rounded-xl bg-surface-container-low p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-on-surface">
                        <Wallet className="h-3 w-3 text-outline" /> Wallet
                      </span>
                    </div>
                    <span className="font-mono text-xs text-on-surface-variant">{formatAddress(address)}</span>
                  </div>
                )}
              </div>
            </motion.div>

            {/* Network Context — clearly labeled as GLOBAL, not personal */}
            <motion.div variants={fadeInUp} initial="hidden" animate="show" className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest/50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-outline" />
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-outline">Network Context</h3>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
                  <span className="font-mono text-[10px] text-on-surface-variant">Network Total Volume</span>
                  <span className="font-mono text-xs text-primary">{formatBOTCompact(totalVolume)} DGRAM</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
                  <span className="font-mono text-[10px] text-on-surface-variant">Network Total Jobs</span>
                  <span className="font-mono text-xs text-primary">{totalJobs.toString()}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
                  <span className="font-mono text-[10px] text-on-surface-variant">CIF Total Supply</span>
                  <span className="font-mono text-xs text-primary">{formatBOTCompact(cifSupply)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
                  <span className="font-mono text-[10px] text-on-surface-variant">Your Market Share</span>
                  <span className="font-mono text-xs text-compute-active">
                    {Number(totalVolume) > 0 ? ((Number(totalRevenue) / Number(totalVolume)) * 100).toFixed(1) : '0.0'}%
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
