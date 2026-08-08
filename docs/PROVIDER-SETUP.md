# ComputeRWA Provider Setup Guide

Panduan lengkap setup compute node di BOT Chain DePIN — dari install hingga handle cloudflared restart.

---

## Quick Start (One Command)

```bash
curl -fsSL https://raw.githubusercontent.com/mdlog/botchain/main/setup.sh | bash
```

Script ini melakukan 7 step otomatis:
1. Konfigurasi + simpan private key ke `.env` (chmod 600)
2. Install Node.js v22 (jika belum ada)
3. Download CLI + dependencies
4. Detect hardware → register → activate → verify node on-chain
5. Install Rust toolchain
6. Build Rust compute agent (~12MB binary)
7. Install cloudflared → start tunnel → register agent URL on-chain

---

## Prerequisites

| Requirement | Keterangan |
|---|---|
| OS | Linux (Ubuntu/Debian) atau macOS. WSL2 juga didukung. |
| Node.js | v18+ (auto-installed by setup.sh) |
| Rust | v1.70+ (auto-installed by setup.sh) |
| cloudflared | Auto-installed by setup.sh |
| GPU | Optional. NVIDIA (nvidia-smi) atau AMD (rocm-smi). CPU-only didukung (vramGB=1). |
| Private Key | Wallet BOT Chain testnet dengan DGRAM balance untuk gas |
| Port 3006 | Available untuk compute agent |

---

## Manual Step-by-Step Setup

### 1. Install Directory

```bash
mkdir -p ~/.computerwa && cd ~/.computerwa
```

### 2. Download CLI

```bash
curl -fsSL https://raw.githubusercontent.com/mdlog/botchain/main/cli/cli.js -o cli.js
curl -fsSL https://raw.githubusercontent.com/mdlog/botchain/main/cli/package.json -o package.json
npm install
```

### 3. Buat `.env`

```bash
cat > .env << 'EOF'
PROVIDER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
RPC_URL=https://rpc.bohr.life
CHAIN_ID=968
REGISTRY_ADDR=0x8b68ae929A0Cbe32F6F0121881B42Ef9D9213eB5
MARKETPLACE_ADDR=0x89b6fBFB647B8a07c4d1520871440f0B01314f87
ORACLE_ADDR=0x2BF8219f6b296A85904e4A486963496c3A0d1b43
AGENT_REGISTRY_ADDR=0x176bE2A9c2917494E77E4D072c03Dc8E40Dd81c4
AGENT_PORT=3006
EOF
chmod 600 .env
```

**⚠️ Jangan commit `.env` ke repo. Pastikan ada di `.gitignore`.**

### 4. Register Node (detect → register → activate → verify)

```bash
node cli.js setup
```

Output contoh:
```
━━━ Step 1/4: Hardware Detection ━━━
✅ GPU: RTX 3060 (12GB)
✅ CPU: AMD Ryzen 9 5950X (32 cores)
✅ RAM: 78.5 GB
✅ TFLOPS: 12.96

━━━ Step 2/4: Register Node ━━━
✅ Node registered! node-id:13976493914421792007

━━━ Step 3/4: Activate Node ━━━
✅ Node activated!

━━━ Step 4/4: Verify Node ━━━
✅ Node verified!
```

### 5. Build Compute Agent (Rust)

```bash
# Install Rust jika belum
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env

# Download source
mkdir -p compute-agent-rs/src
REPO=https://raw.githubusercontent.com/mdlog/botchain/main
curl -fsSL $REPO/compute-agent-rs/Cargo.toml -o compute-agent-rs/Cargo.toml
curl -fsSL $REPO/compute-agent-rs/src/main.rs -o compute-agent-rs/src/main.rs
curl -fsSL $REPO/compute-agent-rs/src/chain.rs -o compute-agent-rs/src/chain.rs
curl -fsSL $REPO/compute-agent-rs/src/sandbox.rs -o compute-agent-rs/src/sandbox.rs
curl -fsSL $REPO/compute-agent-rs/src/monitor.rs -o compute-agent-rs/src/monitor.rs
curl -fsSL $REPO/compute-agent-rs/src/gpu.rs -o compute-agent-rs/src/gpu.rs
cp .env compute-agent-rs/.env && chmod 600 compute-agent-rs/.env

# Build
cd compute-agent-rs && cargo build --release
```

Binary: `target/release/computerwa-agent` (~12MB)

### 6. Install Cloudflared

```bash
# Linux — via Cloudflare deb repo (recommended)
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared

# Atau direct binary download (fallback)
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared

# macOS
brew install cloudflared
```

Verifikasi:
```bash
cloudflared --version
```

### 7. Start Compute Agent + Tunnel

```bash
cd ~/.computerwa

# Start compute agent di background
cd compute-agent-rs
nohup ./target/release/computerwa-agent > agent.log 2>&1 &
cd ~/.computerwa

# Verify agent running
curl http://localhost:3006/health
# Output: {"status":"ok"}

# Start cloudflared tunnel + auto-register URL on-chain
node cli.js tunnel --port 3006
```

CLI `tunnel` akan:
1. Spawn `cloudflared tunnel --url http://localhost:3006`
2. Capture URL dari stderr (contoh: `https://abc-def-ghi.trycloudflare.com`)
3. Call `setAgentUrl(url)` di AgentRegistry contract — tx on-chain
4. Frontend langsung baca URL baru dari chain → agent discoverable

---

## CLI Commands Reference

```bash
cd ~/.computerwa

# Setup & Registration
node cli.js setup                    # detect → register → activate → verify
node cli.js detect                   # hardware detection only
node cli.js register                 # register node on-chain
node cli.js activate <node-id>       # activate node
node cli.js verify <node-id>         # verify node
node cli.js deactivate <node-id>     # deactivate node

# Tunnel & Agent URL
node cli.js tunnel --port 3006       # start cloudflared + register URL on-chain
node cli.js set-agent-url <url>      # manually set agent URL on-chain

# Monitoring
node cli.js list                     # all nodes on network
node cli.js mine                     # your nodes
node cli.js info <node-id>           # node details
node cli.js heartbeat <node-id>      # send heartbeat
node cli.js balance                  # revenue + wallet balance
node cli.js status                   # network + contract status
```

---

## Cloudflared Restart — Update Agent URL

### Kenapa URL Berubah?

URL `*.trycloudflare.com` bersifat **ephemeral** — Cloudflare generate URL acak setiap kali cloudflared start. Jika cloudflared crash, restart, atau koneksi terputus, URL lama tidak valid dan frontend tidak bisa connect ke agent Anda.

### Cara 1: Auto via CLI tunnel (recommended)

```bash
cd ~/.computerwa

# Kill cloudflared lama
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 2

# Jalankan ulang — capture URL baru + auto-register on-chain
node cli.js tunnel --port 3006
```

CLI otomatis: start tunnel baru → capture URL → `setAgentUrl(newUrl)` on-chain → selesai.

### Cara 2: Manual set-agent-url

Jika cloudflared sudah running dan Anda tahu URL barunya:

```bash
cd ~/.computerwa
node cli.js set-agent-url https://new-url-here.trycloudflare.com
```

### Cara 3: Script auto-recovery

Buat `~/.computerwa/restart-tunnel.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd ~/.computerwa

echo "🔄 Restarting cloudflared tunnel..."

# Kill existing cloudflared
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 2

# Ensure compute agent is running
if ! curl -sf http://localhost:3006/health >/dev/null 2>&1; then
  echo "⚠️  Compute agent not running. Starting..."
  cd compute-agent-rs
  nohup ./target/release/computerwa-agent > agent.log 2>&1 &
  cd ~/.computerwa
  sleep 3
fi

# Start new tunnel + register URL on-chain
node cli.js tunnel --port 3006
```

```bash
chmod +x ~/.computerwa/restart-tunnel.sh
```

Jalankan setiap kali tunnel bermasalah:
```bash
~/.computerwa/restart-tunnel.sh
```

### Cara 4: Cron auto-check (opsional)

Cek setiap 5 menit apakah tunnel masih hidup, restart jika perlu:

```bash
# Tambahkan ke crontab
crontab -e

# Tambahkan baris ini:
*/5 * * * * ~/.computerwa/restart-tunnel.sh >> ~/.computerwa/tunnel-cron.log 2>&1
```

Atau pakai systemd timer yang lebih robust.

### Cara 5: Named Tunnel (production — URL stabil)

Untuk produksi, pakai Cloudflare Named Tunnel agar URL tidak berubah saat restart:

```bash
# Login ke Cloudflare (sekali saja)
cloudflared tunnel login

# Create named tunnel
cloudflared tunnel create computerwa

# Configure DNS route
cloudflared tunnel route dns computerwa agent.yourdomain.com

# Run dengan config file
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: computerwa
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: agent.yourdomain.com
    service: http://localhost:3006
  - service: http_status:404
EOF

# Start
cloudflared tunnel run computerwa
```

Dengan named tunnel, URL = `https://agent.yourdomain.com` — stabil, tidak berubah saat restart. Cukup `set-agent-url` sekali saja.

---

## Verifikasi Agent URL On-Chain

Cek URL yang terdaftar untuk wallet Anda:

```bash
cd ~/.computerwa
node cli.js status
```

Atau query langsung dari contract:

```bash
cd ~/.computerwa
node -e "
import 'dotenv/config';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
const pk = process.env.PROVIDER_PRIVATE_KEY;
const account = privateKeyToAccount(pk);
const pc = createPublicClient({ chain: { id: 968, name:'testnet', nativeCurrency:{name:'DGRAM',symbol:'DGRAM',decimals:18}, rpcUrls:{default:{http:['https://rpc.bohr.life']}}}, transport: http() });
const abi = [parseAbiItem('function getAgentUrl(address) view returns (string)')];
const url = await pc.readContract({ address: '0x176bE2A9c2917494E77E4D072c03Dc8E40Dd81c4', abi, functionName: 'getAgentUrl', args: [account.address] });
console.log('Provider:', account.address);
console.log('Agent URL:', url || '(not registered)');
"
```

---

## Contract Addresses (v5 — Testnet)

| Contract | Address | Fungsi |
|---|---|---|
| ComputeRegistry | `0x8b68ae929A0Cbe32F6F0121881B42Ef9D9213eB5` | Node registration, activation, verification |
| PriceOracle | `0x2BF8219f6b296A85904e4A486963496c3A0d1b43` | GPU pricing reference |
| ComputeMarketplace | `0x89b6fBFB647B8a07c4d1520871440f0B01314f87` | Job creation, leasing, completion |
| ComputeIndexToken | `0x11D29Bf60E75f3A3Dc3b46fC7dfaafc5BdB6825E` | Payment token |
| AgentRegistry | `0x176bE2A9c2917494E77E4D072c03Dc8E40Dd81c4` | Provider → agent URL mapping |

**Networks:**
- Testnet: `https://rpc.bohr.life` (chainId 968, DGRAM)
- Mainnet: `https://rpc.botchain.ai` (chainId 677, BOT)

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                 Frontend (Web DApp)                       │
│   Marketplace │ Dashboard │ ComputeSession │ NodeManagement│
└───────┬──────────────────────────────────────────────────┘
        │
        │ 1. Read agent URL from AgentRegistry contract
        │ 2. POST /execute to provider agent URL
        │
        ▼
┌───────────────────────┐    ┌────────────────────────────┐
│  AgentRegistry.sol    │    │  Cloudflare Tunnel         │
│  (on-chain)           │    │  *.trycloudflare.com       │
│  address → agentUrl   │    │  (ephemeral, changes on    │
│                       │    │   restart)                 │
└───────────────────────┘    └──────────┬─────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────┐
│             Compute Agent (Rust binary)                   │
│   axum HTTP server on 0.0.0.0:3006                       │
│   /health │ /info │ /jobs │ /execute                     │
│   Heartbeat → ComputeRegistry (every 5 min)              │
└──────────────────────────────────────────────────────────┘
```

**Flow:**
1. Provider runs `setup.sh` → node registered + agent running + tunnel active
2. Cloudflared memberi public HTTPS URL → registered ke AgentRegistry contract
3. Consumer lease compute di Marketplace → dapat jobId
4. Frontend baca `getAgentUrl(provider)` dari AgentRegistry → route ke agent
5. Consumer execute code via `/execute` endpoint
6. Agent run sandboxed code → return result
7. Job complete on-chain → payment settled

---

## Troubleshooting

### `Unknown: tunnel`
CLI versi lama. Update:
```bash
cd ~/.computerwa
curl -fsSL https://raw.githubusercontent.com/mdlog/botchain/main/cli/cli.js -o cli.js
curl -fsSL https://raw.githubusercontent.com/mdlog/botchain/main/cli/package.json -o package.json
npm install
```

### `cloudflared: command not found`
```bash
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
```

### Tunnel URL tidak muncul setelah 30 detik
Pastikan agent running dan port 3006 accessible:
```bash
curl http://localhost:3006/health
# Should return: {"status":"ok"}
```

Cek firewall:
```bash
sudo ufw status
# Pastikan port 3006 tidak diblokir (local only, cloudflared yang expose ke public)
```

### `setAgentUrl` tx failed
- Pastikan wallet punya DGRAM untuk gas
- Pastikan `.env` berisi `AGENT_REGISTRY_ADDR=0x176bE2A9c2917494E77E4D072c03Dc8E40Dd81c4`
- Pastikan private key di `.env` match dengan wallet yang ingin di-register

### Compute agent tidak running
```bash
cd ~/.computerwa/compute-agent-rs
./target/release/computerwa-agent
# Check logs
cat agent.log
# Verify
curl http://localhost:3006/health
```

### Frontend "No agent URL registered"
Provider belum daftar URL di AgentRegistry. Jalankan:
```bash
node cli.js tunnel --port 3006
# atau
node cli.js set-agent-url https://your-url.trycloudflare.com
```

---

## Security

- **Private key** disimpan di `.env` dengan `chmod 600`, tidak pernah di-pass sebagai env var atau CLI arg
- Setup.sh baca key via `/dev/tty` (silent read), unset setelah simpan ke `.env`
- `.env` tidak di-commit ke repo (`.gitignore`)
- Cloudflared tunnel = HTTPS (TLS encrypted)
- Code execution di sandbox terisolasi di compute agent

---

## Quick Reference

```bash
# First time setup (one command)
curl -fsSL https://raw.githubusercontent.com/mdlog/botchain/main/setup.sh | bash

# After cloudflared restart — update URL on-chain
cd ~/.computerwa && pkill -f "cloudflared tunnel" && node cli.js tunnel --port 3006

# Manual set agent URL
node cli.js set-agent-url https://new-url.trycloudflare.com

# Check everything
node cli.js status      # network + contracts
node cli.js mine        # your nodes
node cli.js balance     # revenue
node cli.js info <id>   # node details
```

---

## Registered Providers (Current)

| Provider | Wallet | Agent URL |
|---|---|---|
| Desktop | `0x264F463571473F0b5C1e9E30018D8B23676b7B80` | `https://agent.mdloglabs.org` |
| Laptop | `0x7cF858145c1449e6eC1798499527632a846CEeDC` | `https://agent2.mdloglabs.org` |
| MD-Indo (WSL) | `0x3D4D26eA1b193f5509d0dC1df85b290b685fb885` | `*.trycloudflare.com` (ephemeral) |
