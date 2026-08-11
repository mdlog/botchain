# BotCompute — decentralized GPU compute marketplace on BOT Chain

<div align="center">

**BOT Chain Builder Challenge #2 — RWA Track**

Providers register real GPU/CPU nodes on-chain, consumers lease compute time paid in DGRAM, and
settled provider revenue is tokenized as **CIF** — an ERC-20 whose backing grows with every job the
network actually completes. Run code or open an isolated interactive shell on leased hardware.

</div>

---

## What makes this an RWA, not a wrapper

The asset behind CIF is settled compute revenue, and the contracts enforce that link:

```
Provider registers a node          ComputeRegistry.registerNode
        ↓
Registry verifier attests it       ComputeRegistry.verifyNode   ← verifier-only role
        ↓
Consumer leases it                 ComputeMarketplace.createJob  ← priced from the NODE's model
        ↓
Provider runs the workload         compute-agent-rs, signature-gated per lease
        ↓
Lease settles on-chain             completeJob / settleExpiredJob
        ├── provider paid for elapsed time only, remainder refunded
        ├── node.totalRevenue += actualCost
        └── 5% of settled revenue → ComputeIndexToken.receiveRevenue()
        ↓
Provider mints CIF                 depositRevenue, capped at that node's settled revenue
        ↓
CIF redeems at the index price     backing / totalSupply, above 1.0 once revenue accrues
```

Two invariants make the claim checkable rather than asserted, and both are covered by tests and
verifiable on the live testnet deployment:

- `depositRevenue` reverts with `ExceedsSettledRevenue` above `node.totalRevenue`, so nobody can mint
  CIF against DGRAM a node did not earn.
- `getIndexPrice()` moves off `1e18` only when the marketplace routes real revenue in, and
  `receiveRevenue()` reverts with `NotMarketplace` for anyone else.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Consumer browser — React 19 · viem · Tailwind v4            │
│  Dashboard │ Explore │ Execute │ My Nodes │ Finance │ Settings│
└───────────────┬──────────────────────────────────────────────┘
                │ typed contract calls (viem, const-typed ABIs)
┌───────────────▼──────────────────────────────────────────────┐
│  BOT Chain Testnet — chain 968                               │
│                                                              │
│  ComputeRegistry ── PriceOracle ── ComputeMarketplace        │
│         │                                  │                 │
│         └────────── AgentRegistry          ▼                 │
│                          │        ComputeIndexToken (CIF)    │
└──────────────────────────┼───────────────────────────────────┘
                           │ provider publishes its endpoint
┌──────────────────────────▼───────────────────────────────────┐
│  Provider agent — compute-agent-rs (Rust · axum · alloy)     │
│  /execute        bubblewrap jail, no network, scrubbed env    │
│  /terminal/{id}  Docker session, caps dropped, read-only root │
│  every mutating route: EIP-191 signature checked against the  │
│  on-chain job.consumer / job.provider                         │
└──────────────────────────────────────────────────────────────┘
```

## Deployed contracts — BOT Chain Testnet (chain 968)

| Contract             | Address                                      | Role                                                                  |
| -------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| `ComputeRegistry`    | `0xcBbEa600C8d15E190A1C69676d8b8a5938BFE396` | Node registration, status, verifier-gated attestation, revenue ledger |
| `PriceOracle`        | `0x1087701623e187D00cF05A77DFA08F2710FB66Aa` | AI-published GPU rates with floor, ceiling and confidence             |
| `ComputeMarketplace` | `0xB72A69BeFFcd478e2ae19C20b65b1cAC1DC5d848` | Lease escrow, settlement, extension, expiry recovery                  |
| `ComputeIndexToken`  | `0x84137667DE83db275B0e0c1ddb94459b8382Ceea` | CIF — the RWA token                                                   |
| `AgentRegistry`      | `0xBF0Fb1508B9E9A6FF13FE74991aA54789D31cAE7` | Provider address → agent endpoint                                     |

Explorer: <https://scan.bohr.life> · RPC: `https://rpc.bohr.life` · Faucet: <https://faucet.botchain.ai>

Addresses live in `contracts/deployments.json`; `src/config/chain.ts` mirrors them, and
`npm run sync-abis` in `contracts/` regenerates the frontend's const-typed ABIs from the compiled
artifacts.

### Seeded oracle rates

| GPU             | DGRAM/hr | Confidence |
| --------------- | -------- | ---------- |
| NVIDIA H100     | 3.10     | 85%        |
| NVIDIA A100     | 1.80     | 88%        |
| NVIDIA RTX 4090 | 0.85     | 92%        |
| NVIDIA RTX 3090 | 0.45     | 90%        |
| NVIDIA RTX 3060 | 0.15     | 85%        |
| AMD Radeon GPU  | 0.12     | 85%        |
| CPU Only        | 0.02     | 70%        |

## AI pricing

The oracle is written by an AI pricing pass, not seeded once and forgotten. `src/lib/pricing.ts`
prices the **whole catalog in a single call** so the tiers stay internally consistent — pricing each
card in its own call let every answer pick its own scale, and an H100 came back at 23× an A100. The
prompt is anchored to the current rate card and the result is bounded to ⅓–3× of it, because DGRAM
has no external reference price for a model to calibrate against.

The `aiOperator` (or the oracle owner) gets a **Reprice with AI** action in Settings that runs the
pass and writes the result on-chain with `updatePrice`. Everyone else never sees it: the write is
simulated first and comes back `NotOperator`.

API keys stay server-side. `vite-ai-proxy.ts` exposes `POST /api/ai`, reads `GEMINI_API_KEY` /
`OPENAI_API_KEY` from `process.env` (no `VITE_` prefix, so Vite never bundles them), and enforces a
model allowlist, a prompt length cap and a per-client rate limit. It runs under `vite dev` **and**
`vite preview`. A static build served from a CDN has no `/api/ai` route and the app falls back to the
heuristic pricer — mount `handleAiRequest` in a serverless function to run AI pricing in a real
deployment.

## Quick start

Requires Node.js 20.19+ and a wallet with testnet DGRAM.

```bash
git clone https://github.com/mdlog/botchain.git
cd botchain
npm install
cp .env.example .env          # add GEMINI_API_KEY or OPENAI_API_KEY for AI pricing
npm run dev                   # http://localhost:3000
```

Add BOT Chain Testnet to your wallet — the app offers to add it on connect:

| Field        | Value                    |
| ------------ | ------------------------ |
| Network name | BOT Chain Testnet        |
| Chain ID     | 968                      |
| RPC URL      | `https://rpc.bohr.life`  |
| Currency     | DGRAM                    |
| Explorer     | `https://scan.bohr.life` |

### Contracts

```bash
cd contracts
npm install
npm run compile
npm test                      # 54 tests
npm run deploy:testnet        # needs DEPLOYER_PRIVATE_KEY in contracts/.env
npm run seed:demo             # register, activate and attest the deployer's nodes
npm run sync-abis             # regenerate src/config/abis from the artifacts
```

### Provider agent

One command on a Linux box with a GPU (or without — CPU-only nodes are supported):

```bash
curl -fsSL https://raw.githubusercontent.com/mdlog/botchain/main/setup.sh | bash
```

It checks every precondition — tools, architecture, disk, download reachability, RPC liveness —
**before** it asks for a key or spends gas, then installs Node, Docker and bubblewrap, builds the
agent, registers and activates the node, installs the boot units, and opens a Cloudflare tunnel whose
URL it publishes to `AgentRegistry`. See [docs/PROVIDER-SETUP.md](docs/PROVIDER-SETUP.md) for the
manual path and for what the script asks permission to do.

Your node then waits for the registry verifier to attest it. That is deliberate: a node that can
vouch for itself makes the "verified" badge worthless, which is the whole basis of the RWA claim.

## Provider agent API

Every mutating route requires an EIP-191 challenge signed by the party the chain says is entitled to
it, valid for 60 seconds. The scope and job id are inside the signed string, so a signature for one
route or one lease cannot be replayed on another.

| Method | Path                     | Auth                                                      |
| ------ | ------------------------ | --------------------------------------------------------- |
| `GET`  | `/health`                | —                                                         |
| `GET`  | `/info`                  | —                                                         |
| `GET`  | `/jobs`                  | —                                                         |
| `POST` | `/execute`               | `botchain-execute:{jobId}:{ts}` signed by `job.consumer`  |
| `GET`  | `/terminal/{jobId}` (WS) | `botchain-terminal:{jobId}:{ts}` signed by `job.consumer` |
| `POST` | `/jobs/{id}/accept`      | `botchain-accept:{jobId}:{ts}` signed by `job.provider`   |
| `POST` | `/jobs/{id}/complete`    | `botchain-complete:{jobId}:{ts}` signed by `job.consumer` |

Isolation: `/execute` runs under `bubblewrap` with `--unshare-all` (no network), a scrubbed
environment and a per-execution workspace. `/terminal` runs a Docker container with all capabilities
dropped, a read-only root filesystem, `no-new-privileges`, and pid/memory/CPU limits. CORS is an
explicit allowlist (`AGENT_ALLOWED_ORIGINS`), and concurrent executions are bounded by a semaphore
sized to the CPU count.

## Repository layout

```
botchain/
├── contracts/              Hardhat + Solidity 0.8.24, OpenZeppelin
│   ├── contracts/          5 contracts + shared interfaces + a test mock
│   ├── test/               54 tests across all five contracts
│   └── scripts/            deploy · seed:demo · sync-abis · fund
├── compute-agent-rs/       Provider agent (Rust, axum, alloy, bollard)
│   └── src/                main · auth · chain · gpu · monitor · sandbox · terminal
├── cli/                    Provider CLI — register, activate, status, tunnel
├── src/                    Frontend
│   ├── components/         ui/ design system · views/ · layout/ · terminal/
│   ├── config/             chain.ts, providers.ts, abis/ (generated)
│   ├── hooks/              one hook per contract + wallet, session, terminal
│   └── lib/                tx (simulate→send→receipt), domain, pricing, agentApi
├── docs/PROVIDER-SETUP.md
└── setup.sh                One-command provider installer
```

## Development

```bash
npm run dev          # Vite dev server on :3000, AI proxy mounted
npm run typecheck    # tsc --noEmit, strict
npm run lint         # ESLint 9 flat config, typed rules
npm run format       # Prettier
npm test             # Vitest — formatting, domain, pricing, error mapping
npm run build        # typecheck, then production build
npm run preview      # serve the build WITH the AI proxy
```

CI runs the frontend gate, the contract test suite, `cargo fmt --check` + `cargo clippy -D warnings`

- `cargo build --release`, and `shellcheck setup.sh` on every push and pull request.

## Known limitations

Stated plainly, because a submission that hides these is worse than one that names them.

- **Testnet only.** No mainnet deployment. `src/config/chain.ts` defines both chains but only chain
  968 has contracts.
- **Node specs are self-declared.** `registerNode` accepts whatever hardware a provider claims; there
  is no stake, proof or slashing. Attestation by the registry verifier is the only gate, and it is a
  single trusted address. Hardware-fingerprint attestation is the obvious next step — the agent
  already collects real GPU data.
- **The oracle is one operator.** `PriceOracle` has a floor, a ceiling, a confidence field and
  staleness rejection at the marketplace, but the writer is a single EOA rather than a committee.
- **Provider egress is not filtered.** The terminal container is well-confined against the host but
  sits on the default Docker bridge, so a lease holder can reach the provider's LAN. Run the agent on
  a dedicated box or a VPS.
- **The AI proxy is a dev/preview server route.** Deploying the static build without a serverless
  function means heuristic pricing only.
- **No upgrade path.** The contracts are not proxied; fixing one means redeploying and updating the
  addresses in `contracts/deployments.json` and `src/config/chain.ts`.

## Roadmap

**v1 (current)** — one CIF token indexing all compute revenue on the platform: attested nodes,
escrowed leases, proportional settlement, revenue-capped minting, index-priced redemption.

**v2 — per-provider CIF + rebalancing index.** A `CIFNodeToken` per provider backed by that node's
revenue, and a `CIFIndexToken` holding an auto-rebalanced basket of them. Gives price discovery per
GPU tier, isolates one node going offline from the whole pool, and lets holders pick a provider or
buy the index.

**v3 — secondary market.** BDEX liquidity for per-provider CIF, an AMM for CIF-INDEX ↔ DGRAM,
streaming revenue deposits, and on-chain risk scoring per node from uptime and completion history.

## License

[MIT](LICENSE)
