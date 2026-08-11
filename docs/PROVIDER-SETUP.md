# BotCompute provider setup

How to put a machine on the BOT Chain DePIN network and keep it there — install, attestation, and
surviving a tunnel restart.

The network is deployed on **BOT Chain Testnet (chain 968)** only. Get gas from the
[faucet](https://faucet.botchain.ai/basic).

---

## One command

```bash
curl -fsSL https://raw.githubusercontent.com/mdlog/botchain/main/setup.sh | bash
```

The script runs every check that can fail — required tools, CPU architecture, free disk, whether the
downloads are reachable, whether the RPC answers — **before** it asks for your private key or spends
any gas. It then asks for consent in plain terms, because three of the things it does deserve it:

- it adds your user to the `docker` group, which is root-equivalent on this machine;
- it installs a compute agent binary that is not code-signed;
- it sends three on-chain transactions from the key you provide (register, activate, publish endpoint).

After that it installs Node, Docker, bubblewrap and cloudflared, builds the agent from source,
registers and activates your node, installs boot units for both the agent and the tunnel, and
publishes the tunnel URL to `AgentRegistry`.

Override any default with an environment variable, e.g. `AGENT_PORT=4006 ... | bash`.

## Prerequisites

| Requirement | Notes                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OS          | Linux (Ubuntu/Debian) or macOS. WSL2 works.                                                                                                            |
| Node.js     | 18+, auto-installed                                                                                                                                    |
| Rust        | 1.87+, auto-installed (edition 2024)                                                                                                                   |
| Docker      | Auto-installed on Linux. Needed for the **interactive terminal** only — `/execute` works without it.                                                   |
| bubblewrap  | Auto-installed on Linux. **Required** — `/execute` returns 503 without it. Not available on macOS; use a Linux VM if you want to serve code execution. |
| cloudflared | Auto-installed                                                                                                                                         |
| GPU         | Optional. NVIDIA (`nvidia-smi`) or AMD (`rocm-smi`). CPU-only nodes are supported and register with 0 VRAM.                                            |
| Wallet      | A BOT Chain Testnet key with DGRAM for gas                                                                                                             |
| Port 3006   | Free on localhost; cloudflared is what exposes it                                                                                                      |

> **Fresh Docker installs:** group membership is not active in the shell that installed it. The
> script wraps the agent launch in `sg docker` so it works immediately; log out and back in once
> afterwards so your normal shell gets Docker access without `sudo`.

## Attestation — read this before you wait

`setup.sh` registers and activates your node. It does **not** verify it, and it cannot:
`ComputeRegistry.verifyNode` is restricted to the registry's `verifier` address. A node that could
attest itself would make the "verified" badge meaningless, and that badge is the gate on both leasing
and CIF minting — it is the basis of the whole RWA claim.

So your node comes up **Active, awaiting attestation**. Send your node id to whoever holds the
verifier key; they run:

```bash
node cli.js verify <node-id>
```

Running it yourself simulates first and tells you it was rejected, without sending a transaction or
spending gas. Check who the verifier is with `node cli.js status`.

## Manual setup

### 1. Install directory and CLI

```bash
mkdir -p ~/.computerwa && cd ~/.computerwa
curl -fsSL https://raw.githubusercontent.com/mdlog/botchain/main/cli/cli.js -o cli.js
curl -fsSL https://raw.githubusercontent.com/mdlog/botchain/main/cli/package.json -o package.json
npm install
```

### 2. Configure

```bash
cat > .env << 'EOF'
PROVIDER_PRIVATE_KEY=0x...
RPC_URL=https://rpc.bohr.life
CHAIN_ID=968
AGENT_PORT=3006

REGISTRY_ADDR=0xcBbEa600C8d15E190A1C69676d8b8a5938BFE396
MARKETPLACE_ADDR=0xB72A69BeFFcd478e2ae19C20b65b1cAC1DC5d848
ORACLE_ADDR=0x1087701623e187D00cF05A77DFA08F2710FB66Aa
AGENT_REGISTRY_ADDR=0xBF0Fb1508B9E9A6FF13FE74991aA54789D31cAE7
EOF
chmod 600 .env
```

Addresses change on every redeploy — the authoritative copy is
[`contracts/deployments.json`](../contracts/deployments.json).

### 3. Register the node

```bash
node cli.js setup     # detect → register → activate
```

### 4. Build the agent

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

mkdir -p compute-agent-rs/src
REPO=https://raw.githubusercontent.com/mdlog/botchain/main/compute-agent-rs
for f in Cargo.toml Cargo.lock Dockerfile.terminal; do curl -fsSL "$REPO/$f" -o "compute-agent-rs/$f"; done
for f in main auth chain gpu monitor sandbox terminal; do curl -fsSL "$REPO/src/$f.rs" -o "compute-agent-rs/src/$f.rs"; done

cd compute-agent-rs && cargo build --release && cd ..
cp .env compute-agent-rs/.env && chmod 600 compute-agent-rs/.env
```

Also set the origin the dashboard is served from, or browser requests will be blocked by CORS:

```bash
echo 'AGENT_ALLOWED_ORIGINS=http://localhost:3000' >> compute-agent-rs/.env
```

### 5. Build the terminal image (optional, needs Docker)

```bash
cd compute-agent-rs
docker build -f Dockerfile.terminal -t botcompute-terminal:latest .
docker images | grep botcompute-terminal
```

Without it, `/execute` still works and the terminal closes with code `4011`.

### 6. Start the agent and the tunnel

```bash
cd ~/.computerwa
nohup ./compute-agent-rs/target/release/computerwa-agent > agent.log 2>&1 &
curl -s localhost:3006/health     # {"status":"ok", ..., "sandbox":true, "docker":true}

node cli.js tunnel --port 3006    # opens the tunnel and publishes the URL on-chain
```

`sandbox: false` means bubblewrap is missing and the node cannot execute code, even though it will
still show as Active. `docker: false` means no interactive terminal.

## CLI reference

```bash
node cli.js setup                 # detect → register → activate
node cli.js detect                # hardware detection only
node cli.js register              # register a node on-chain
node cli.js activate <node-id>    # make it leasable
node cli.js deactivate <node-id>  # take it out of the marketplace
node cli.js verify <node-id>      # attest a node — VERIFIER KEY ONLY

node cli.js tunnel --port 3006    # start cloudflared and publish the URL
node cli.js set-agent-url <url>   # publish an endpoint manually

node cli.js list                  # every node on the network
node cli.js mine                  # your nodes
node cli.js info <node-id>        # one node in detail
node cli.js heartbeat <node-id>   # liveness ping
node cli.js balance               # revenue and wallet balance
node cli.js status                # network, contracts, verifier
```

## Tunnel restarts change your URL

A Cloudflare quick tunnel gets a **new hostname every start**, so the URL published on-chain goes
stale whenever cloudflared restarts. `setup.sh` installs a `botcompute-tunnel` unit that re-runs
`set-agent-url` on boot; if you are running by hand:

```bash
cd ~/.computerwa
pkill -f "cloudflared tunnel"
node cli.js tunnel --port 3006      # captures the new URL and writes it on-chain
```

Or publish it explicitly:

```bash
node cli.js set-agent-url https://new-url.trycloudflare.com
```

### Named tunnel — a stable URL

For anything long-lived, use a named tunnel and set the URL once:

```bash
cloudflared tunnel login
cloudflared tunnel create computerwa
cloudflared tunnel route dns computerwa agent.yourdomain.com

cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: computerwa
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: agent.yourdomain.com
    service: http://localhost:3006
  - service: http_status:404
EOF

cloudflared tunnel run computerwa
node cli.js set-agent-url https://agent.yourdomain.com
```

`AgentRegistry` requires an `https://` URL between 8 and 256 characters and rejects anything else
on-chain.

## Managing the service

```bash
sudo systemctl status botcompute-agent
sudo systemctl status botcompute-tunnel
journalctl -u botcompute-agent -f
tail -f ~/.computerwa/agent.log
```

## Troubleshooting

**`/execute` returns 503, `"sandbox": false` in `/health`** — bubblewrap is not installed.
`sudo apt-get install -y bubblewrap` (or `dnf install bubblewrap`).

**Terminal closes immediately with code 4010** — the agent cannot reach the Docker socket. Check
`docker ps` works for your user, and that you logged out and back in after the install.

**Terminal closes with 4001** — the signature did not match. Your wallet is not the lease's consumer,
or your clock is off by more than 60 seconds. Check with `timedatectl`.

**`/execute` or `/jobs/{id}/complete` returns 400 or 401** — these routes require a signed challenge
now. Use the dashboard rather than raw `curl`; an unauthenticated call is supposed to fail.

**Browser requests blocked by CORS** — set `AGENT_ALLOWED_ORIGINS` in `compute-agent-rs/.env` to the
origin serving the dashboard. The default allows only `http://localhost:3000`.

**`cloudflared: command not found`**

```bash
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o /tmp/cloudflared && sudo install -m755 /tmp/cloudflared /usr/local/bin/cloudflared
```

**No tunnel URL after 30 seconds** — check the agent answers `curl localhost:3006/health` first; the
tunnel has nothing to expose until it does.

**Frontend says "No agent URL registered"** — publish one with `node cli.js tunnel --port 3006` or
`node cli.js set-agent-url <url>`.

**`setAgentUrl` reverted** — the URL must start with `https://` and be 8–256 characters. Also check
the wallet has gas.

**Node stays "awaiting attestation"** — expected. Only the registry verifier can attest; see
[Attestation](#attestation--read-this-before-you-wait).

## Contract addresses — testnet (chain 968)

| Contract             | Address                                      |
| -------------------- | -------------------------------------------- |
| `ComputeRegistry`    | `0xcBbEa600C8d15E190A1C69676d8b8a5938BFE396` |
| `PriceOracle`        | `0x1087701623e187D00cF05A77DFA08F2710FB66Aa` |
| `ComputeMarketplace` | `0xB72A69BeFFcd478e2ae19C20b65b1cAC1DC5d848` |
| `ComputeIndexToken`  | `0x84137667DE83db275B0e0c1ddb94459b8382Ceea` |
| `AgentRegistry`      | `0xBF0Fb1508B9E9A6FF13FE74991aA54789D31cAE7` |

## Security notes

- The private key is read from `/dev/tty` with echo off, written to `.env` at mode `600`, and never
  passed as a command-line argument or exported into the environment.
- `.env` is gitignored in every package.
- Every mutating agent route verifies an EIP-191 signature against the on-chain party for that lease,
  with a 60-second freshness window. The scope and job id are inside the signed string, so a
  signature cannot be replayed across routes or leases.
- `/execute` runs under bubblewrap with `--unshare-all` — no network, scrubbed environment, its own
  workspace per run, and a timeout capped at 300 seconds regardless of what the caller asks for.
- The terminal container drops all capabilities, runs a read-only root filesystem with
  `no-new-privileges`, and has pid, memory and CPU limits.
- **The terminal container is not egress-filtered.** It sits on the default Docker bridge, so a lease
  holder can reach your LAN and any service on it. Run the agent on a dedicated machine or a VPS.
