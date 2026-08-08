#!/usr/bin/env bash
#
# ComputeRWA Provider Setup Script
# BOT Chain DePIN — One-command node registration + Rust agent
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/mdlog/botchain/main/setup.sh | bash
#
# Security:
#   - Private key is read silently (not echoed)
#   - Written directly to .env with chmod 600
#   - Never passed as env var or CLI argument
#   - Unset from shell after writing to .env
#   - Node reads key from .env via dotenv (not from process env)
#
set -euo pipefail

# ── Colors ─────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; B='\033[1m'; N='\033[0m'
info()  { echo -e "${C}ℹ️  $1${N}"; }
ok()    { echo -e "${G}✅ $1${N}"; }
warn()  { echo -e "${Y}⚠️  $1${N}"; }
err()   { echo -e "${R}❌ $1${N}"; }
step()  { echo -e "\n${B}━━━ $1 ━━━${N}"; }

# ── Banner ─────────────────────────────────────────────
cat << 'BANNER'
╔══════════════════════════════════════════════╗
║  ComputeRWA Provider Setup                   ║
║  BOT Chain DePIN — Rust Agent + Registration ║
╚══════════════════════════════════════════════╝
BANNER

# ── Config ─────────────────────────────────────────────
REPO_RAW="https://raw.githubusercontent.com/mdlog/botchain/main"
INSTALL_DIR="${COMPUTERWA_DIR:-$HOME/.computerwa}"
RPC_URL="${RPC_URL:-https://rpc.bohr.life}"
CHAIN_ID="${CHAIN_ID:-968}"
REGISTRY_ADDR="0x8b68ae929A0Cbe32F6F0121881B42Ef9D9213eB5"
MARKETPLACE_ADDR="0x89b6fBFB647B8a07c4d1520871440f0B01314f87"
ORACLE_ADDR="0x2BF8219f6b296A85904e4A486963496c3A0d1b43"
AGENT_REGISTRY_ADDR="0x176bE2A9c2917494E77E4D072c03Dc8E40Dd81c4"

# ── Helper: securely read private key ──────────────────
read_and_store_key() {
  # If key provided via env var (piped), use it but unset immediately after storing
  if [[ -n "${PROVIDER_PRIVATE_KEY:-}" ]]; then
    KEY="$PROVIDER_PRIVATE_KEY"
    unset PROVIDER_PRIVATE_KEY
  else
    echo ""
    echo -e "${B}Enter your provider private key (input hidden):${N}"
    # Silent read via /dev/tty — key is NOT echoed to terminal
    # /dev/tty needed because stdin is consumed by curl in pipe mode
    read -rs KEY < /dev/tty
    echo ""
    if [[ -z "$KEY" ]]; then
      err "Private key required."
      exit 1
    fi
  fi

  # Validate format
  if [[ ! "$KEY" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    err "Invalid private key format. Must be 0x + 64 hex chars."
    KEY=""
    exit 1
  fi

  # Write to .env with restrictive permissions FIRST
  touch .env
  chmod 600 .env

  {
    printf 'PROVIDER_PRIVATE_KEY=%s\n' "$KEY"
    printf 'RPC_URL=%s\n' "$RPC_URL"
    printf 'CHAIN_ID=%s\n' "$CHAIN_ID"
    printf 'REGISTRY_ADDR=%s\n' "$REGISTRY_ADDR"
    printf 'MARKETPLACE_ADDR=%s\n' "$MARKETPLACE_ADDR"
    printf 'ORACLE_ADDR=%s\n' "$ORACLE_ADDR"
    printf 'AGENT_PORT=3006\n'
    printf 'AGENT_REGISTRY_ADDR=%s\n' "$AGENT_REGISTRY_ADDR"
  } > .env

  # Clear key from shell variable — only .env has it now
  KEY=""

  ok "Private key stored securely in .env (chmod 600)"
}

# ── Step 0: Configuration ──────────────────────────────
step "Step 0/7: Configuration"

info "Install directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Read and store private key securely
read_and_store_key

# Verify .env was written correctly (check key exists without printing it)
if ! grep -q '^PROVIDER_PRIVATE_KEY=0x[0-9a-fA-F]\{64\}$' .env 2>/dev/null; then
  err "Failed to store private key in .env"
  exit 1
fi

# ── Step 1: Check Node.js (for CLI registration only) ──
step "Step 1/7: Check Node.js (CLI registration)"

if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [[ "$NODE_MAJOR" -ge 18 ]]; then
    ok "Node.js v$NODE_VER found"
  else
    warn "Node.js v$NODE_VER found, need v18+"
    info "Installing Node.js v22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - 2>/dev/null
    sudo apt-get install -y nodejs 2>/dev/null
    ok "Node.js installed: $(node -v)"
  fi
else
  info "Node.js not found. Installing v22..."
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - 2>/dev/null
    sudo apt-get install -y nodejs 2>/dev/null
  elif command -v brew &>/dev/null; then
    brew install node@22
  else
    err "Cannot install Node.js. Please install manually: https://nodejs.org"
    exit 1
  fi
  ok "Node.js installed: $(node -v)"
fi

# ── Step 2: Download CLI (for node registration) ───────
step "Step 2/7: Download CLI"

info "Downloading CLI files..."

curl -fsSL "$REPO_RAW/cli/cli.js" -o cli.js
curl -fsSL "$REPO_RAW/cli/package.json" -o package.json

ok "CLI files downloaded"

# ── Step 3: Install CLI dependencies ───────────────────
step "Step 3/7: Install CLI Dependencies"

info "Running npm install..."
npm install --silent 2>/dev/null
ok "Dependencies installed"

# ── Step 4: Run setup (detect + register + activate + verify) ──
step "Step 4/7: Node Registration (detect → register → activate → verify)"

# Key is read from .env by dotenv — NOT from process environment
node cli.js setup || { err "Registration failed!"; exit 1; }

# ── Step 5: Check Rust toolchain ───────────────────────
step "Step 5/7: Check Rust Toolchain"

if command -v cargo &>/dev/null; then
  RUST_VER=$(rustc --version | awk '{print $2}')
  ok "Rust v$RUST_VER found"
else
  info "Rust not found. Installing via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y 2>/dev/null
  source "$HOME/.cargo/env"
  ok "Rust installed: $(rustc --version | awk '{print $2}')"
fi

# ── Step 6: Download + build Rust compute agent ────────
step "Step 6/7: Build Rust Compute Agent"

info "Downloading Rust agent source..."

mkdir -p compute-agent-rs/src

# Download Cargo.toml and source files
curl -fsSL "$REPO_RAW/compute-agent-rs/Cargo.toml" -o compute-agent-rs/Cargo.toml
curl -fsSL "$REPO_RAW/compute-agent-rs/src/main.rs" -o compute-agent-rs/src/main.rs
curl -fsSL "$REPO_RAW/compute-agent-rs/src/chain.rs" -o compute-agent-rs/src/chain.rs
curl -fsSL "$REPO_RAW/compute-agent-rs/src/sandbox.rs" -o compute-agent-rs/src/sandbox.rs
curl -fsSL "$REPO_RAW/compute-agent-rs/src/monitor.rs" -o compute-agent-rs/src/monitor.rs
curl -fsSL "$REPO_RAW/compute-agent-rs/src/gpu.rs" -o compute-agent-rs/src/gpu.rs

# Copy .env for the Rust agent
cp .env compute-agent-rs/.env
chmod 600 compute-agent-rs/.env

info "Building Rust agent (this may take 1-2 minutes)..."
cd compute-agent-rs
cargo build --release 2>&1 | tail -3
cd "$INSTALL_DIR"

ok "Rust compute agent built!"

BINARY="$INSTALL_DIR/compute-agent-rs/target/release/computerwa-agent"
if [[ ! -f "$BINARY" ]]; then
  err "Binary not found at expected path. Build may have failed."
  exit 1
fi

ok "Binary: $BINARY ($(du -h "$BINARY" | cut -f1))"

# ── Step 7: Start tunnel + register agent URL on-chain ──
step "Step 7/7: Cloudflare Tunnel + Agent URL Registration"

# ── Detect or install cloudflared ─────────────────────
install_cloudflared() {
  info "cloudflared not found — installing..."

  # Linux: Cloudflare official deb repo (most reliable)
  if command -v apt-get &>/dev/null; then
    info "Adding Cloudflare apt repo..."
    sudo mkdir -p /usr/share/keyrings 2>/dev/null
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null 2>&1
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs 2>/dev/null || echo jammy) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null 2>&1
    sudo apt-get update -qq 2>/dev/null
    sudo apt-get install -y cloudflared 2>/dev/null && return 0
    warn "apt install failed, trying direct binary..."
  fi

  # macOS: Homebrew
  if command -v brew &>/dev/null; then
    info "Installing via Homebrew..."
    brew install cloudflared 2>/dev/null && return 0
    warn "brew install failed, trying direct binary..."
  fi

  # Universal fallback: direct binary download
  local ARCH
  case "$(uname -m)" in
    x86_64)  ARCH="linux-amd64" ;;
    aarch64) ARCH="linux-arm64" ;;
    armv7l)  ARCH="linux-arm" ;;
    *)       ARCH="linux-amd64" ;;
  esac

  local URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${ARCH}"
  info "Downloading: ${URL}"
  sudo curl -fsSL "$URL" -o /usr/local/bin/cloudflared && sudo chmod +x /usr/local/bin/cloudflared && return 0

  err "Failed to install cloudflared."
  err "Manual: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/"
  return 1
}

# Detect cloudflared
if command -v cloudflared &>/dev/null && cloudflared --version &>/dev/null 2>&1; then
  ok "cloudflared detected: $(cloudflared --version 2>&1 | head -1)"
else
  # Binary exists but broken? Remove and reinstall
  if command -v cloudflared &>/dev/null; then
    warn "cloudflared binary present but broken — reinstalling..."
    sudo rm -f "$(command -v cloudflared)" 2>/dev/null
  fi
  install_cloudflared || true
fi

# Verify after install
if command -v cloudflared &>/dev/null && cloudflared --version &>/dev/null 2>&1; then
  ok "cloudflared ready: $(cloudflared --version 2>&1 | head -1)"

  # Start compute agent in background first
  info "Starting compute agent in background..."
  BINARY="$INSTALL_DIR/compute-agent-rs/target/release/computerwa-agent"
  if [[ -f "$BINARY" ]]; then
    # Kill any existing agent on port 3006
    fuser -k 3006/tcp 2>/dev/null || true
    cd "$INSTALL_DIR/compute-agent-rs"
    nohup ./target/release/computerwa-agent > agent.log 2>&1 &
    AGENT_PID=$!
    cd "$INSTALL_DIR"
    sleep 2
    ok "Compute agent started (PID: $AGENT_PID)"
  else
    warn "Binary not found, skipping agent start. Tunnel will still be created."
  fi

  info "Starting Cloudflare tunnel (this gives you a public HTTPS URL)..."
  info "Registering tunnel URL on-chain so frontend can discover your agent..."
  echo ""

  # Run tunnel command — it captures the URL and registers on-chain
  node cli.js tunnel --port 3006 || warn "Tunnel failed. Run manually: node cli.js tunnel"
else
  warn "cloudflared not installed. Agent URL not registered."
  warn "Install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/"
fi

# ── Done ───────────────────────────────────────────────
echo ""
echo -e "${G}╔══════════════════════════════════════════════╗${N}"
echo -e "${G}║  ✅ SETUP COMPLETE                            ║${N}"
echo -e "${G}╚══════════════════════════════════════════════╝${N}"
echo ""
echo "Your private key is stored at:"
echo "  $INSTALL_DIR/.env  (chmod 600)"
echo ""
echo "Start the Rust compute agent:"
echo "  cd $INSTALL_DIR/compute-agent-rs"
echo "  ./target/release/computerwa-agent"
echo ""
echo "CLI commands (registration, monitoring):"
echo "  cd $INSTALL_DIR"
echo "  node cli.js list        # list all nodes"
echo "  node cli.js mine        # your nodes"
echo "  node cli.js heartbeat 1 # send heartbeat"
echo "  node cli.js balance     # check revenue"
echo "  node cli.js info 1      # node details"
echo ""
echo -e "${Y}⚠️  Keep $INSTALL_DIR/.env private. Never share or commit it.${N}"
echo ""

