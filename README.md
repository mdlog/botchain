# ComputeRWA — AI-Powered Compute Marketplace & RWA Tokenization on BOT Chain

<div align="center">

**BOT Chain Builder Challenge #2 — RWA Track**

AI-powered decentralized compute marketplace where providers register GPU/CPU nodes, consumers lease compute time paid in BOT/DGRAM, and provider revenue is tokenized as CIF (Compute Indexed Fund) ERC20 — tradeable RWA assets.

</div>

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Consumer Browser                       │
│  (React 19 + viem + Tailwind v4)                          │
│                                                           │
│  Dashboard │ Marketplace │ Compute Session │ Financial   │
│       │           │              │               │        │
│       ▼           ▼              ▼               ▼        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │           Smart Contracts (BOT Chain)                │ │
│  │                                                       │ │
│  │  ComputeRegistry │ PriceOracle │ ComputeMarketplace  │ │
│  │                                       │               │ │
│  │              ComputeIndexToken (CIF)  │               │ │
│  └───────────────────────────────────────┼───────────────┘ │
│                                          │                 │
│            ┌─────────────────────────────┼──────────┐      │
│            ▼                             ▼          ▼      │
│  ┌──────────────────┐        ┌──────────────────┐        │
│  │  Provider Agent   │        │  Provider Agent   │        │
│  │  (Node #1)        │        │  (Node #2)        │        │
│  │  agent.mdloglabs  │        │  agent2.mdloglabs │        │
│  │  Express + viem   │        │  Express + viem   │        │
│  │  Python3/Node exec│        │  Python3/Node exec│        │
│  └──────────────────┘        └──────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

## 🔑 Core Concepts

### Compute Lifecycle
1. **Register** — Provider registers GPU/CPU node on-chain (ComputeRegistry)
2. **Verify** — Node gets verified by registry owner
3. **Price** — AI Pricing Engine (Gemini) pushes fair BOT/hr rates to PriceOracle
4. **Lease** — Consumer browses Marketplace, selects node, pays upfront (ComputeMarketplace)
5. **Activate** — Provider accepts job → countdown timer starts
6. **Execute** — Consumer writes code in Compute Session → POST to provider agent → code runs on provider's machine
7. **Settle** — Timer expires → auto-complete on-chain → revenue flows to provider
8. **Tokenize** — Provider deposits DGRAM revenue → mint CIF tokens (ERC20 RWA) → tradeable on BDEX

### CIF Token (Compute Indexed Fund)
- ERC20 token representing fractional ownership of compute revenue
- Provider deposits DGRAM → mint CIF 1:1
- Burn CIF → withdraw DGRAM
- 0.5% withdrawal fee
- Tradeable on BDEX (BOT Chain DEX)

### AI Pricing Engine
- Powered by Gemini API with heuristic fallback
- Factors: GPU model, VRAM, TFLOPS, region, demand, supply
- Outputs: fair price (BOT/hr), confidence score, risk assessment
- Pushes prices to on-chain PriceOracle contract

## 📦 Smart Contracts

| Contract | Purpose | Solidity |
|---|---|---|
| `ComputeRegistry` | Node registration, status, verification, revenue tracking | 0.8.24 |
| `PriceOracle` | AI-pushed GPU/CPU pricing with confidence scores | 0.8.24 |
| `ComputeMarketplace` | Job creation, acceptance, completion, cancellation | 0.8.24 |
| `ComputeIndexToken (CIF)` | ERC20 RWA token — deposit revenue → mint, burn → withdraw | 0.8.24 |

### Deployed Addresses (BOT Chain Testnet — Chain ID 968)

| Contract | Address |
|---|---|
| ComputeRegistry | `0x91778B39490e6193c27A32a35dd33b7B14F54EC0` |
| PriceOracle | `0x95D102579C544BA2756F344eC2Ad09D677CFAe49` |
| ComputeMarketplace | `0xd93C4006888d5A707b9e072685d6aD36a91228d2` |
| ComputeIndexToken (CIF) | `0xE61DD019294Ab52eF69714a948E65b9a31947c1e` |

### Seeded GPU Prices (Oracle)
| GPU | Price (DGRAM/hr) | Confidence |
|---|---|---|
| NVIDIA H100 | 3.10 | 85% |
| NVIDIA A100 | 1.80 | 88% |
| NVIDIA RTX 4090 | 0.85 | 92% |
| NVIDIA RTX 3090 | 0.45 | 90% |
| NVIDIA RTX 3060 | 0.15 | 85% |

## 🖥️ Frontend

**Stack:** Vite + React 19 + Tailwind v4 + viem 2.55

### Views
- **Dashboard** — Network stats (active nodes, jobs, volume, TVL, CIF supply/index price)
- **Marketplace** — Browse compute nodes, grid/list toggle, filters (GPU model, region, verified), lease compute
- **Compute Session** — Code editor (Python3/Node.js), live execution on provider machine, countdown timer, extend lease, output panel
- **Node Management** — Register node (auto-detect hardware), status control, job queue (accept/complete), revenue tracking
- **Financial Layer** — Deposit DGRAM → mint CIF, burn CIF → withdraw, TVL, index price

### Key Features
- **Hardware Auto-Detection** — WebGL renderer info + Navigator API (GPU model, VRAM, CPU cores, RAM, storage)
- **CPU-Only Node Support** — Nodes without GPU can still register (TFLOPS estimated from CPU cores)
- **Duplicate Prevention** — Frontend blocks duplicate GPU registration
- **Per-Node Agent Routing** — Each node routes compute requests to its own provider agent
- **Countdown Timer** — Auto-complete when lease expires, extend option before expiry

## ⚡ Provider Compute Agent

Express server that runs on provider's machine and executes consumer code.

### Endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Agent status |
| GET | `/info` | Provider node info + capabilities |
| GET | `/jobs` | List provider's on-chain jobs |
| POST | `/jobs/:id/accept` | Accept pending job on-chain |
| POST | `/jobs/:id/complete` | Complete job on-chain (settle revenue) |
| POST | `/execute` | Execute code (consumer → provider) |
| GET | `/sessions/:jobId` | Execution history for job |

### Supported Runtimes
- Python 3
- Node.js (CommonJS)

### Limits
- 5 minute max per execution
- Workspace isolation per execution (auto-cleanup)

## 🚀 Quick Start

### Prerequisites
- Node.js 22+
- MetaMask or compatible wallet
- BOT Chain Testnet DGRAM (faucet: https://faucet.botchain.ai)

### 1. Frontend
```bash
cd botchain-hackathon
npm install
npm run dev
```
App runs at `http://localhost:3005`

### 2. Smart Contracts (optional — already deployed)
```bash
cd contracts
npm install

# Compile
npx hardhat compile

# Deploy to testnet
npx hardhat run scripts/deploy.ts --network botchain-testnet
```

### 3. Provider Agent
```bash
cd compute-agent
npm install

# Set env (optional — works without wallet for code execution only)
export PROVIDER_PRIVATE_KEY=0x...  # provider wallet key
export AGENT_PORT=3006
export RPC_URL=https://rpc.bohr.life
export CHAIN_ID=968

node server.js
```
Agent runs at `http://localhost:3006`

### 4. Add BOT Chain Testnet to MetaMask
| Field | Value |
|---|---|
| Network Name | BOT Chain Testnet |
| Chain ID | 968 |
| RPC URL | `https://rpc.bohr.life` |
| Currency Symbol | `DGRAM` |
| Explorer | `https://scan.bohr.life` |

## 🌐 Network Configuration

### BOT Chain Testnet (Development)
| Parameter | Value |
|---|---|
| Chain ID | 968 |
| RPC | `https://rpc.bohr.life` |
| Native Token | DGRAM |
| Explorer | `https://scan.bohr.life` |
| Faucet | `https://faucet.botchain.ai` |

### BOT Chain Mainnet (Production)
| Parameter | Value |
|---|---|
| Chain ID | 677 |
| RPC | `https://rpc.botchain.ai` |
| Native Token | BOT |
| Gas | 20 gwei |

## 📁 Project Structure

```
botchain-hackathon/
├── contracts/                  # Hardhat + Solidity
│   ├── contracts/
│   │   ├── ComputeRegistry.sol
│   │   ├── PriceOracle.sol
│   │   ├── ComputeMarketplace.sol
│   │   └── ComputeIndexToken.sol
│   ├── scripts/
│   │   ├── deploy.ts
│   │   ├── check-all-nodes.ts
│   │   ├── check-cif.ts
│   │   ├── check-job.ts
│   │   └── seed-rtx3060.ts
│   ├── deployments.json
│   └── hardhat.config.ts
│
├── compute-agent/              # Provider compute agent
│   ├── server.js
│   └── package.json
│
├── src/                        # Frontend
│   ├── components/
│   │   ├── Layout.tsx
│   │   ├── WalletConnect.tsx
│   │   └── views/
│   │       ├── Dashboard.tsx
│   │       ├── Marketplace.tsx
│   │       ├── ComputeSession.tsx
│   │       ├── NodeManagement.tsx
│   │       └── FinancialLayer.tsx
│   ├── hooks/
│   │   ├── useWallet.ts
│   │   ├── useComputeRegistry.ts
│   │   ├── usePriceOracle.ts
│   │   ├── useComputeMarketplace.ts
│   │   ├── useComputeIndexToken.ts
│   │   └── useComputeSession.ts
│   ├── context/
│   │   └── WalletContext.tsx
│   ├── lib/
│   │   ├── pricing.ts          # AI pricing engine
│   │   ├── hardware-detect.ts  # Browser hardware detection
│   │   ├── format.ts           # Formatting utilities
│   │   └── utils.ts
│   ├── config/
│   │   ├── chain.ts
│   │   ├── contracts.ts
│   │   └── *.abi.json
│   └── types/
│       └── ethereum.d.ts
│
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## 🧪 Demo Flow (End-to-End)

1. **Connect Wallet** — Click connect, switch to BOT Chain Testnet
2. **Register Node** — Go to Node Management → Auto-Detect Hardware → Register
3. **Verify Node** — Owner verifies node (or pre-verified)
4. **Lease Compute** — Go to Marketplace → Select node → Lease (1 hour, 0.15 DGRAM)
5. **Accept Job** — Provider accepts in Node Management → Job Queue
6. **Run Code** — Go to Compute Session → Select job → Write code → Run
7. **Countdown** — Timer counts down from lease duration
8. **Auto-Complete** — On expiry, job auto-completes on-chain
9. **Tokenize Revenue** — Go to Financial Layer → Deposit DGRAM → Mint CIF
10. **Trade CIF** — CIF tokens tradeable on BDEX

## 🏆 BOT Chain Builder Challenge #2

- **Track:** RWA (Real World Asset)
- **Prize:** Up to $5,000 USDT
- **Timeline:** Aug 10–20, 2026
- **Compliance:** Asset authenticity (hardware fingerprint), complete business loop (lease→execute→settle→tokenize), AI as core capability (pricing engine)

## 🗺️ Roadmap

### v1 — CIF Index Fund (Current)
Single ERC20 token representing fractional ownership of **all** compute revenue on the platform (S&P 500-style index fund for GPU compute).

- ✅ Single `ComputeIndexToken` contract
- ✅ Deposit revenue → mint CIF 1:1
- ✅ Burn CIF → withdraw proportional TVL share
- ✅ Tradeable on BDEX

### v2 — Per-Provider CIF + Auto-Rebalancing Index (Production)
Two-layer token architecture for granular risk management and price discovery:

```
Layer 1: Per-Provider CIF Tokens (granular)
──────────────────────────────────────────
CIF-Node#1 (RTX 3060×4)  → backed by Node #1 revenue
CIF-Node#2 (H100)        → backed by Node #2 revenue
CIF-Node#3 (RTX 3090)    → backed by Node #3 revenue

Layer 2: CIF Index Token (aggregated)
──────────────────────────────────────────
CIF-INDEX = auto-basket of all per-provider tokens
  ├─ weighted by per-node TVL
  ├─ auto-rebalanced on each deposit
  └─ NAV = sum(per-provider NAV × weight)
```

**New contracts:**
- `ComputeIndexTokenFactory` — deploys per-provider CIF tokens, manages index composition
- `CIFNodeToken` (per-provider) — deposit/withdraw tied to specific node revenue
- `CIFIndexToken` (v2 upgrade) — auto-rebalancing basket of all `CIFNodeToken` contracts

**Benefits:**
- **Price discovery per GPU type** — H100 CIF trades at premium vs RTX 3060 CIF
- **Risk isolation** — one node going offline doesn't tank the entire pool
- **Investor choice** — pick specific providers or buy the index for diversification
- **Provider reputation** — high-performing providers earn premium pricing on their CIF tokens
- **Automated rebalancing** — index weights adjust based on revenue performance

### v3 — BDEX Integration + Secondary Market
- Native liquidity pools on BDEX for per-provider CIF tokens
- Automated market maker (AMM) for CIF-INDEX ↔ DGRAM
- Revenue streaming — providers deposit continuously, CIF minted in real-time
- On-chain risk scoring per node (uptime, job completion rate, revenue consistency)

## 📜 License

MIT
