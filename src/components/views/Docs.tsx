import React, { useState, useEffect } from 'react';
import {
  BookOpen, Boxes, FileCode2, Cpu, Shield, Network,
  LayoutDashboard, Code2, Brain, Layers, Terminal, Wallet,
  ShoppingCart, Sliders, ChevronRight, CheckCircle2, AlertTriangle, Lock
} from 'lucide-react';

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: BookOpen },
  { id: 'architecture', label: 'Architecture', icon: Boxes },
  { id: 'contracts', label: 'Smart Contracts', icon: FileCode2 },
  { id: 'lifecycle', label: 'Compute Lifecycle', icon: Cpu },
  { id: 'agent-api', label: 'Compute Agent API', icon: Terminal },
  { id: 'ai-pricing', label: 'AI Pricing Engine', icon: Brain },
  { id: 'network', label: 'Network Config', icon: Network },
  { id: 'views', label: 'Frontend Views', icon: LayoutDashboard },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'tech-stack', label: 'Tech Stack', icon: Layers },
];

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mt-2 mb-4 overflow-x-auto rounded-lg bg-surface-container-low p-4 font-mono text-xs text-on-surface-variant">
      <code>{children}</code>
    </pre>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: any; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="text-lg font-semibold text-on-surface">{children}</h2>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="mb-4 overflow-x-auto">
      <table className="w-full border-collapse font-mono text-xs">
        <thead>
          <tr className="border-b border-outline-variant/20">
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-primary">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-outline-variant/10 hover:bg-surface-container-low">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-on-surface-variant">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContractCard({ name, address, desc, functions, structs }: {
  name: string; address: string; desc: string;
  functions: { sig: string; desc: string }[];
  structs?: { name: string; fields: string }[];
}) {
  return (
    <div className="mb-6 rounded-xl bg-surface-container-low p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-sm font-bold text-primary">{name}</h3>
        <code className="rounded bg-surface-container px-2 py-1 font-mono text-xs text-on-surface-variant">{address}</code>
      </div>
      <p className="mb-3 text-sm text-on-surface-variant">{desc}</p>
      {structs && structs.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold text-outline">Structs</p>
          {structs.map((s, i) => (
            <div key={i} className="mb-1 rounded bg-surface-container p-2 font-mono text-xs text-on-surface-variant">
              <span className="text-compute-active">struct {s.name}</span> {'{ '}
              <span className="text-on-surface">{s.fields}</span>
              {' }'}
            </div>
          ))}
        </div>
      )}
      <div>
        <p className="mb-1 text-xs font-semibold text-outline">Key Functions</p>
        {functions.map((f, i) => (
          <div key={i} className="mb-1 flex gap-2 font-mono text-xs">
            <code className="text-primary">{f.sig}</code>
            <span className="text-on-surface-variant">— {f.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Docs() {
  const [activeSection, setActiveSection] = useState('overview');

  useEffect(() => {
    const handleScroll = () => {
      for (const section of SECTIONS) {
        const el = document.getElementById(section.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 120 && rect.bottom >= 120) {
            setActiveSection(section.id);
            break;
          }
        }
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const offset = 80;
      const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Docs Sidebar */}
      <aside className="fixed left-72 top-16 z-30 h-[calc(100vh-4rem)] w-56 overflow-y-auto border-r border-outline-variant/10 bg-surface-container-lowest p-4">
        <p className="mb-3 px-2 text-xs font-semibold text-outline">DOCUMENTATION</p>
        <nav className="flex flex-col gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                activeSection === s.id
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              <s.icon className="h-4 w-4 shrink-0" />
              {s.label}
              {activeSection === s.id && <ChevronRight className="ml-auto h-3 w-3" />}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="ml-56 flex-1 overflow-y-auto bg-gradient-to-b from-surface/50 to-surface p-8 pb-32">
        <div className="mx-auto max-w-3xl">

          {/* Overview */}
          <section id="overview" className="mb-12 scroll-mt-20">
            <SectionTitle icon={BookOpen}>Overview</SectionTitle>
            <p className="text-sm leading-relaxed text-on-surface-variant">
              <span className="font-semibold text-on-surface">ComputeRWA</span> is an AI-Powered Compute Marketplace &
              RWA Tokenization platform built on BOT Chain. It creates a decentralized marketplace where compute
              providers register GPU nodes, consumers lease compute power on-demand, and providers earn BOT tokens
              that can be tokenized as tradeable ERC20 assets.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
              The platform features an AI pricing engine powered by Google Gemini that analyzes GPU specifications,
              market conditions, and regional demand to determine fair compute pricing in real-time. Provider revenue
              is tokenized through the <span className="font-mono text-primary">CIF (Compute Indexed Fund)</span> —
              an ERC20 token representing fractional ownership of future compute revenue streams.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-surface-container-low p-4">
                <p className="text-xs font-semibold text-outline">PROVIDERS</p>
                <p className="mt-1 text-sm text-on-surface-variant">Register GPU nodes, earn BOT for compute jobs</p>
              </div>
              <div className="rounded-lg bg-surface-container-low p-4">
                <p className="text-xs font-semibold text-outline">CONSUMERS</p>
                <p className="mt-1 text-sm text-on-surface-variant">Lease compute, run code in sandboxed agents</p>
              </div>
              <div className="rounded-lg bg-surface-container-low p-4">
                <p className="text-xs font-semibold text-outline">INVESTORS</p>
                <p className="mt-1 text-sm text-on-surface-variant">Hold CIF tokens, earn yield from compute revenue</p>
              </div>
            </div>
          </section>

          {/* Architecture */}
          <section id="architecture" className="mb-12 scroll-mt-20">
            <SectionTitle icon={Boxes}>Architecture</SectionTitle>
            <p className="text-sm leading-relaxed text-on-surface-variant">
              ComputeRWA consists of four layers: on-chain smart contracts, a React frontend, a Rust compute agent,
              and an AI pricing engine.
            </p>
            <CodeBlock>{`┌─────────────────────────────────────────────────┐
│                   Frontend (React)                │
│  Vite + React 19 + Tailwind v4 + viem 2.55      │
├────────────┬──────────────┬───────────────────────┤
│  Dashboard │  Marketplace │  Compute Session      │
│  Financial │  Node Mgmt   │  Docs                 │
├────────────┴──────────────┴───────────────────────┤
│              Smart Contracts (Solidity)           │
│  ComputeRegistry │ PriceOracle │ Marketplace │ CIF│
├───────────────────────────────────────────────────┤
│           Compute Agent (Rust 🦀)                 │
│  axum 0.8 + alloy 1.8 + tokio 1                  │
│  Sandboxed Python3 / Node.js execution           │
├───────────────────────────────────────────────────┤
│          AI Pricing Engine (Gemini API)           │
│  Fair pricing · Yield projection · Risk scoring   │
└───────────────────────────────────────────────────┘`}</CodeBlock>
          </section>

          {/* Smart Contracts */}
          <section id="contracts" className="mb-12 scroll-mt-20">
            <SectionTitle icon={FileCode2}>Smart Contracts</SectionTitle>
            <p className="text-sm text-on-surface-variant">
              Four contracts deployed on BOT Chain, compiled with Solidity 0.8.24 (optimizer enabled).
            </p>

            <ContractCard
              name="ComputeRegistry"
              address="0xc612...76Ddc"
              desc="Registers and tracks compute nodes. Stores GPU specs, provider address, node status, and accumulated revenue. Only the marketplace contract can add revenue."
              functions={[
                { sig: 'registerNode(GpuSpecs specs)', desc: 'Provider registers a new compute node' },
                { sig: 'verifyNode(uint256 nodeId)', desc: 'Admin verifies a node (owner only)' },
                { sig: 'heartbeat(uint256 nodeId)', desc: 'Provider sends heartbeat to keep node active' },
                { sig: 'addRevenue(uint256 nodeId, uint96 amount)', desc: 'Marketplace adds revenue after job completion (onlyMarketplace)' },
                { sig: 'getProviderNodes(address provider)', desc: 'Returns all node IDs for a provider' },
                { sig: 'getNode(uint256 nodeId)', desc: 'Returns full node details' },
              ]}
              structs={[
                { name: 'GpuSpecs', fields: 'string model; uint16 vramGB; uint16 tflops; string region' },
                { name: 'ComputeNode', fields: 'address provider; GpuSpecs specs; NodeStatus status; uint96 totalRevenue; uint64 registeredAt; uint64 lastHeartbeat; bool verified' },
              ]}
            />

            <ContractCard
              name="PriceOracle"
              address="0x8674...fc33"
              desc="On-chain GPU benchmark scores and AI-adjusted prices. Maintains pricing data for each GPU model with confidence scores."
              functions={[
                { sig: 'setBenchmark(string model, uint16 score)', desc: 'Set compute benchmark score for a GPU model' },
                { sig: 'updatePrice(string model, uint256 priceWei, uint16 confidence)', desc: 'Update price (DGRAM/hr) with confidence score 0-10000' },
                { sig: 'getPrice(string model)', desc: 'Returns (priceWei, confidence, lastUpdate)' },
                { sig: 'getBenchmark(string model)', desc: 'Returns benchmark score for a GPU model' },
              ]}
            />
            <p className="mb-4 text-xs font-semibold text-outline">SEEDED GPU PRICES (TESTNET)</p>
            <Table
              headers={['GPU Model', 'Price (DGRAM/hr)', 'Benchmark', 'Confidence']}
              rows={[
                ['NVIDIA H100', '3.10', '12000', '95%'],
                ['NVIDIA A100', '1.80', '8000', '95%'],
                ['RTX 4090', '0.85', '5000', '90%'],
                ['RTX 3090', '0.45', '3500', '90%'],
                ['RTX 3060', '0.15', '1300', '85%'],
                ['AMD Radeon GPU', '0.12', '1200', '85%'],
                ['CPU Only', '0.02', '100', '80%'],
              ]}
            />

            <ContractCard
              name="ComputeMarketplace"
              address="0x7278...5f02"
              desc="Core job marketplace. Consumers create jobs (pay upfront), providers accept and complete them. Proportional payment: provider paid only for actual time worked, consumer refunded unused time."
              functions={[
                { sig: 'createJob(uint256 nodeId, string jobType, uint64 durationHours)', desc: 'Consumer creates job, pays pricePerHour × durationHours upfront' },
                { sig: 'acceptJob(uint256 jobId)', desc: 'Provider accepts job → status Active, startedAt recorded' },
                { sig: 'completeJob(uint256 jobId)', desc: 'Settle: provider paid for actual time, consumer refunded remainder' },
                { sig: 'cancelJob(uint256 jobId)', desc: 'Cancel pending job, full refund to consumer' },
                { sig: 'getJob(uint256 jobId)', desc: 'Returns full job details' },
                { sig: 'totalJobs()', desc: 'Returns total job count' },
              ]}
              structs={[
                { name: 'ComputeJob', fields: 'uint256 nodeId; address consumer; address provider; string jobType; string specHash; uint256 pricePerHourWei; uint256 paymentAmount; uint64 durationHours; uint64 startedAt; uint64 completedAt; JobStatus status' },
              ]}
            />
            <div className="mb-6 rounded-lg bg-surface-container-low p-4">
              <p className="mb-2 text-xs font-semibold text-outline">JOB STATUS FLOW</p>
              <CodeBlock>{`Pending (0) ──accept──→ Active (1) ──complete──→ Completed (2)
     │                        │
     └──cancel──→ Cancelled (3)    └──dispute──→ Disputed (4)`}</CodeBlock>
            </div>

            <ContractCard
              name="ComputeIndexToken (CIF)"
              address="0x0D3F...ab1b"
              desc="ERC20 token representing fractional ownership of future compute revenue. Providers deposit earned revenue and receive CIF tokens. Holders can withdraw their proportional share of TVL."
              functions={[
                { sig: 'deposit(uint256 nodeId, uint256 amount)', desc: 'Provider deposits revenue, receives proportional CIF tokens' },
                { sig: 'withdraw(uint256 amount)', desc: 'Burn CIF tokens, withdraw proportional share of TVL (1% fee)' },
                { sig: 'totalValueLocked()', desc: 'Returns total DGRAM deposited in the contract' },
                { sig: 'balanceOf(address)', desc: 'Returns CIF token balance for an address' },
              ]}
            />
          </section>

          {/* Compute Lifecycle */}
          <section id="lifecycle" className="mb-12 scroll-mt-20">
            <SectionTitle icon={Cpu}>Compute Lifecycle</SectionTitle>
            <p className="text-sm text-on-surface-variant">End-to-end flow from node registration to revenue tokenization:</p>
            <div className="mt-4 space-y-2">
              {[
                { step: '1', title: 'Register Node', desc: 'Provider registers GPU node on ComputeRegistry (model, VRAM, TFLOPS, region)' },
                { step: '2', title: 'Verify Node', desc: 'Admin verifies the node on-chain' },
                { step: '3', title: 'Lease Compute', desc: 'Consumer browses Marketplace, selects node, creates job (pays upfront)' },
                { step: '4', title: 'Accept Job', desc: 'Provider accepts job → status Active, timer starts' },
                { step: '5', title: 'Execute Code', desc: 'Consumer runs code via provider\'s Compute Agent (POST /execute)' },
                { step: '6', title: 'Settle Job', desc: 'Job expires or provider completes → proportional payment on-chain' },
                { step: '7', title: 'Revenue Recorded', desc: 'Provider revenue added to ComputeRegistry via addRevenue()' },
                { step: '8', title: 'Tokenize Revenue', desc: 'Provider deposits revenue to CIF contract → receives ERC20 tokens' },
                { step: '9', title: 'Withdraw Yield', desc: 'CIF holders withdraw proportional share of TVL' },
              ].map((item) => (
                <div key={item.step} className="flex gap-4 rounded-lg bg-surface-container-low p-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 font-mono text-xs font-bold text-primary">
                    {item.step}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-on-surface">{item.title}</p>
                    <p className="text-xs text-on-surface-variant">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Compute Agent API */}
          <section id="agent-api" className="mb-12 scroll-mt-20">
            <SectionTitle icon={Terminal}>Compute Agent API</SectionTitle>
            <p className="text-sm text-on-surface-variant">
              High-performance Rust agent (axum + alloy + tokio) running on each provider machine.
              Handles job monitoring, code execution, and on-chain settlement.
            </p>
            <Table
              headers={['Method', 'Endpoint', 'Description']}
              rows={[
                ['GET', '/health', 'Agent status, wallet address, version'],
                ['GET', '/info', 'Provider node IDs, available runtimes'],
                ['GET', '/jobs', 'List all provider jobs with status counts'],
                ['POST', '/execute', 'Execute code in sandbox'],
                ['POST', '/jobs/{id}/accept', 'Accept pending job on-chain'],
                ['POST', '/jobs/{id}/complete', 'Complete active job on-chain'],
              ]}
            />
            <p className="mb-2 text-xs font-semibold text-outline">POST /execute — REQUEST BODY</p>
            <CodeBlock>{`{
  "jobId": 3,              // optional: verify job is active
  "language": "python3",   // "python3" | "node"
  "code": "print(42)",
  "timeoutSecs": 300       // optional, default 300s (5 min)
}`}</CodeBlock>
            <p className="mb-2 text-xs font-semibold text-outline">POST /execute — RESPONSE</p>
            <CodeBlock>{`{
  "status": "completed",
  "exitCode": 0,
  "stdout": "42\\n",
  "stderr": "",
  "durationMs": 24,
  "timedOut": false,
  "agent": "rust"
}`}</CodeBlock>
            <div className="mt-4 rounded-lg bg-surface-container-low p-4">
              <p className="mb-2 text-xs font-semibold text-outline">SANDBOXING</p>
              <div className="space-y-1 text-xs text-on-surface-variant">
                <p><CheckCircle2 className="mr-1 inline h-3 w-3 text-compute-active" />Temp workspace per job (auto-cleaned)</p>
                <p><CheckCircle2 className="mr-1 inline h-3 w-3 text-compute-active" />Wall-clock timeout via <code className="text-primary">timeout</code> command</p>
                <p><CheckCircle2 className="mr-1 inline h-3 w-3 text-compute-active" />Python3: <code className="text-primary">ulimit -v 512MB</code> virtual memory cap</p>
                <p><CheckCircle2 className="mr-1 inline h-3 w-3 text-compute-active" />Node.js: V8 <code className="text-primary">--max-old-space-size=384</code> heap limit</p>
                <p><CheckCircle2 className="mr-1 inline h-3 w-3 text-compute-active" />Background: job monitor (15s poll), heartbeat (5min)</p>
              </div>
            </div>
          </section>

          {/* AI Pricing Engine */}
          <section id="ai-pricing" className="mb-12 scroll-mt-20">
            <SectionTitle icon={Brain}>AI Pricing Engine</SectionTitle>
            <p className="text-sm leading-relaxed text-on-surface-variant">
              The AI pricing engine uses Google Gemini API to analyze GPU specifications and market conditions,
              producing fair compute prices with confidence scores. If Gemini is unavailable, a heuristic fallback
              algorithm based on benchmark scores and tier-based pricing ensures the marketplace remains operational.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-surface-container-low p-4">
                <p className="mb-2 text-xs font-semibold text-outline">INPUTS</p>
                <ul className="space-y-1 text-xs text-on-surface-variant">
                  <li>GPU model name</li>
                  <li>VRAM (GB)</li>
                  <li>TFLOPS compute power</li>
                  <li>Geographic region</li>
                  <li>Benchmark score</li>
                </ul>
              </div>
              <div className="rounded-lg bg-surface-container-low p-4">
                <p className="mb-2 text-xs font-semibold text-outline">OUTPUTS</p>
                <ul className="space-y-1 text-xs text-on-surface-variant">
                  <li>Fair price (DGRAM/hr)</li>
                  <li>Confidence score (0-10000)</li>
                  <li>Risk assessment</li>
                  <li>Yield projection</li>
                </ul>
              </div>
            </div>
            <p className="mt-3 text-xs font-semibold text-outline">PRICING FACTORS</p>
            <CodeBlock>{`price = base_tier_price
       × performance_factor    // TFLOPS / benchmark_ratio
       × regional_demand_mult  // supply/demand in region
       × depreciation_factor   // age of hardware
       × confidence_adjustment // AI certainty scaling`}</CodeBlock>
          </section>

          {/* Network Config */}
          <section id="network" className="mb-12 scroll-mt-20">
            <SectionTitle icon={Network}>Network Config</SectionTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-surface-container-low p-5">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-compute-active" />
                  <h3 className="font-mono text-sm font-bold text-compute-active">TESTNET (Current)</h3>
                </div>
                <Table
                  headers={['Field', 'Value']}
                  rows={[
                    ['Chain ID', '968'],
                    ['RPC URL', 'https://rpc.bohr.life'],
                    ['Explorer', 'https://scan.bohr.life'],
                    ['Native Token', 'DGRAM (18 decimals)'],
                    ['Faucet', 'faucet.botchain.ai'],
                  ]}
                />
              </div>
              <div className="rounded-xl bg-surface-container-low p-5">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  <h3 className="font-mono text-sm font-bold text-primary">MAINNET</h3>
                </div>
                <Table
                  headers={['Field', 'Value']}
                  rows={[
                    ['Chain ID', '677'],
                    ['RPC URL', 'https://rpc.botchain.ai'],
                    ['Explorer', 'https://scan.botchain.ai'],
                    ['Native Token', 'BOT (18 decimals)'],
                    ['Gas Price', '20 gwei'],
                  ]}
                />
              </div>
            </div>
            <p className="mt-4 text-xs font-semibold text-outline">CONTRACT ADDRESSES (TESTNET v3)</p>
            <Table
              headers={['Contract', 'Address']}
              rows={[
                ['ComputeRegistry', '0xc612111b8648B73ED23CF19f400488566af76Ddc'],
                ['PriceOracle', '0x8674305cb18521E75C01D0162d209ea22767fc33'],
                ['ComputeMarketplace', '0x7278045051843BbdD7786B493de0681904075f02'],
                ['ComputeIndexToken (CIF)', '0x0D3FeE7457066662C1a30C3DAC7f18b907Feab1b'],
              ]}
            />
          </section>

          {/* Frontend Views */}
          <section id="views" className="mb-12 scroll-mt-20">
            <SectionTitle icon={LayoutDashboard}>Frontend Views</SectionTitle>
            <div className="space-y-3">
              {[
                { icon: LayoutDashboard, name: 'Dashboard', desc: 'Provider statistics, active job count, total revenue, node health overview' },
                { icon: ShoppingCart, name: 'Marketplace', desc: 'Browse available compute nodes. Filter by GPU model, region, verified status. Grid/list view toggle. AI pricing display.' },
                { icon: Terminal, name: 'Compute Session', desc: 'Code editor with Python/Node selector. Execute on leased node via provider agent. Real-time output with stdout/stderr/exit code. Live countdown timer.' },
                { icon: Wallet, name: 'Financial Layer', desc: 'Deposit provider revenue to CIF contract. Withdraw proportional share. View TVL, token balance, yield metrics.' },
                { icon: Sliders, name: 'Node Management', desc: 'Register new compute nodes with auto-detected hardware specs. Manage node status. View provider jobs with accept/complete actions.' },
                { icon: BookOpen, name: 'Docs', desc: 'This page — complete documentation of the ComputeRWA platform.' },
              ].map((v) => (
                <div key={v.name} className="flex gap-4 rounded-lg bg-surface-container-low p-4">
                  <v.icon className="h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-semibold text-on-surface">{v.name}</p>
                    <p className="text-xs text-on-surface-variant">{v.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Security */}
          <section id="security" className="mb-12 scroll-mt-20">
            <SectionTitle icon={Shield}>Security</SectionTitle>
            <div className="space-y-3">
              <div className="flex gap-3 rounded-lg bg-surface-container-low p-4">
                <Lock className="h-5 w-5 shrink-0 text-compute-active" />
                <div>
                  <p className="text-sm font-semibold text-on-surface">Sandboxed Execution</p>
                  <p className="text-xs text-on-surface-variant">Code runs in isolated temp directories with memory limits (ulimit for Python, V8 heap cap for Node) and wall-clock timeouts. Workspace auto-cleaned after execution.</p>
                </div>
              </div>
              <div className="flex gap-3 rounded-lg bg-surface-container-low p-4">
                <Lock className="h-5 w-5 shrink-0 text-compute-active" />
                <div>
                  <p className="text-sm font-semibold text-on-surface">Private Key Safety</p>
                  <p className="text-xs text-on-surface-variant">Agent uses <code className="font-mono text-primary">privateKeyToAccount()</code> from viem/accounts to derive wallet address. Raw key never exposed in API responses or logs.</p>
                </div>
              </div>
              <div className="flex gap-3 rounded-lg bg-surface-container-low p-4">
                <Lock className="h-5 w-5 shrink-0 text-compute-active" />
                <div>
                  <p className="text-sm font-semibold text-on-surface">Contract Access Control</p>
                  <p className="text-xs text-on-surface-variant"><code className="font-mono text-primary">onlyMarketplace</code> modifier on <code className="font-mono text-primary">addRevenue()</code> — only the ComputeMarketplace contract can credit revenue to nodes. Constructor sets owner, <code className="font-mono text-primary">setMarketplace()</code> called post-deploy.</p>
                </div>
              </div>
              <div className="flex gap-3 rounded-lg bg-surface-container-low p-4">
                <Lock className="h-5 w-5 shrink-0 text-compute-active" />
                <div>
                  <p className="text-sm font-semibold text-on-surface">Proportional Payment</p>
                  <p className="text-xs text-on-surface-variant">Provider paid only for actual time worked: <code className="font-mono text-primary">actualCost = pricePerHourWei × actualSeconds / 3600</code>. Consumer refunded <code className="font-mono text-primary">paymentAmount - actualCost</code> for unused lease time.</p>
                </div>
              </div>
              <div className="flex gap-3 rounded-lg bg-surface-container-low p-4">
                <AlertTriangle className="h-5 w-5 shrink-0 text-compute-idle" />
                <div>
                  <p className="text-sm font-semibold text-on-surface">Audit History</p>
                  <p className="text-xs text-on-surface-variant">3 rounds of contract audits. v1 → v2 (paymentAmount tracking) → v3 (proportional payment). All critical bugs resolved: balance drain, missing access control, TVL miscalculation.</p>
                </div>
              </div>
            </div>
          </section>

          {/* Tech Stack */}
          <section id="tech-stack" className="mb-12 scroll-mt-20">
            <SectionTitle icon={Layers}>Tech Stack</SectionTitle>
            <Table
              headers={['Layer', 'Technology', 'Version']}
              rows={[
                ['Smart Contracts', 'Solidity', '0.8.24'],
                ['Build Tool', 'Hardhat', '2.22'],
                ['Frontend Framework', 'Vite + React', '19'],
                ['CSS', 'Tailwind CSS', 'v4'],
                ['EVM Client', 'viem', '2.55'],
                ['Compute Agent', 'Rust (axum + alloy + tokio)', '1.92 / 0.8 / 1.8 / 1'],
                ['AI Pricing', 'Google Gemini API', '—'],
                ['Language Runtime', 'Python3 + Node.js', 'System'],
              ]}
            />
            <div className="mt-4 rounded-xl bg-surface-container-low p-5">
              <p className="mb-3 text-xs font-semibold text-outline">PROJECT STRUCTURE</p>
              <CodeBlock>{`botchain-hackathon/
├── src/                    # Frontend (React)
│   ├── components/views/   # Dashboard, Marketplace, etc.
│   ├── hooks/              # useComputeMarketplace, useWallet, ...
│   ├── config/             # chain.ts, contracts.ts, ABIs
│   ├── context/            # WalletContext
│   └── lib/                # pricing.ts, hardware-detect.ts, format.ts
├── contracts/              # Smart contracts (Hardhat)
│   └── contracts/          # 4 Solidity files
│       ├── ComputeRegistry.sol
│       ├── PriceOracle.sol
│       ├── ComputeMarketplace.sol
│       └── ComputeIndexToken.sol
├── compute-agent-rs/       # Rust compute agent
│   └── src/
│       ├── main.rs         # axum HTTP server
│       ├── chain.rs        # alloy EVM client
│       ├── sandbox.rs      # sandboxed execution
│       └── monitor.rs      # job monitor + heartbeat
└── compute-agent/          # Legacy Node.js agent (backup)`}</CodeBlock>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
