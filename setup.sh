#!/usr/bin/env bash
#
# ComputeRWA Provider Setup Script
# BOT Chain DePIN — One-command node registration
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
║  BOT Chain DePIN — Node Registration         ║
╚══════════════════════════════════════════════╝
BANNER

# ── Config ─────────────────────────────────────────────
REPO_RAW="https://raw.githubusercontent.com/mdlog/botchain/main"
INSTALL_DIR="${COMPUTERWA_DIR:-$HOME/.computerwa}"
RPC_URL="${RPC_URL:-https://rpc.bohr.life}"
CHAIN_ID="${CHAIN_ID:-968}"
REGISTRY_ADDR="0xc612111b8648B73ED23CF19f400488566af76Ddc"
MARKETPLACE_ADDR="0x7278045051843BbdD7786B493de0681904075f02"
ORACLE_ADDR="0x8674305cb18521E75C01D0162d209ea22767fc33"

# ── Helper: securely read private key ──────────────────
# Reads key silently, validates, writes to .env, then unsets from shell
read_and_store_key() {
  # If key provided via env var (piped), use it but unset immediately after storing
  if [[ -n "${PROVIDER_PRIVATE_KEY:-}" ]]; then
    KEY="$PROVIDER_PRIVATE_KEY"
    unset PROVIDER_PRIVATE_KEY
  else
    echo ""
    echo -e "${B}Enter your provider private key (input hidden):${N}"
    # Silent read — key is NOT echoed to terminal
    read -rs KEY
    echo ""
    if [[ -z "$KEY" ]]; then
      err "Private key required."
      exit 1
    fi
  fi

  # Validate format
  if [[ ! "$KEY" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    err "Invalid private key format. Must be 0x + 64 hex chars."
    # Clear from memory
    KEY=""
    exit 1
  fi

  # Write to .env with restrictive permissions FIRST
  # Create .env with chmod 600 before writing content
  touch .env
  chmod 600 .env

  # Write using printf (no echo — avoids key in process list)
  {
    printf 'PROVIDER_PRIVATE_KEY=%s\n' "$KEY"
    printf 'RPC_URL=%s\n' "$RPC_URL"
    printf 'CHAIN_ID=%s\n' "$CHAIN_ID"
    printf 'REGISTRY_ADDR=%s\n' "$REGISTRY_ADDR"
    printf 'MARKETPLACE_ADDR=%s\n' "$MARKETPLACE_ADDR"
    printf 'ORACLE_ADDR=%s\n' "$ORACLE_ADDR"
  } > .env

  # Clear key from shell variable — only .env has it now
  KEY=""

  ok "Private key stored securely in .env (chmod 600)"
}

# ── Step 0: Configuration ──────────────────────────────
step "Step 0/5: Configuration"

# Prepare install directory
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

# ── Step 1: Check Node.js ──────────────────────────────
step "Step 1/5: Check Dependencies"

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

# ── Step 2: Download CLI files ─────────────────────────
step "Step 2/5: Download CLI"

info "Downloading CLI files..."

# Download cli.js and package.json from GitHub raw
curl -fsSL "$REPO_RAW/cli/cli.js" -o cli.js
curl -fsSL "$REPO_RAW/cli/package.json" -o package.json

ok "CLI files downloaded"

# ── Step 3: Install dependencies ───────────────────────
step "Step 3/5: Install Dependencies"

info "Running npm install..."
npm install --silent 2>/dev/null
ok "Dependencies installed"

# ── Step 4: Run setup (detect → register → activate → verify) ──
step "Step 4/5: Node Setup (detect → register → activate → verify)"

# Key is read from .env by dotenv — NOT from process environment
# This prevents key from appearing in /proc/<pid>/environ
node cli.js setup || { err "Setup failed!"; exit 1; }

# ── Step 5: Optional — start compute agent ─────────────
step "Step 5/5: Compute Agent"

echo ""
read -rp "$(echo -e ${B}'Start compute agent now? [y/N]: '${N})" START_AGENT

if [[ "${START_AGENT:-}" =~ ^[Yy]$ ]]; then
  info "Downloading compute agent..."

  mkdir -p "$INSTALL_DIR/compute-agent"
  curl -fsSL "$REPO_RAW/compute-agent/server.js" -o "$INSTALL_DIR/compute-agent/server.js"
  curl -fsSL "$REPO_RAW/compute-agent/package.json" -o "$INSTALL_DIR/compute-agent/package.json"

  # Copy .env with same restrictive permissions
  cp .env "$INSTALL_DIR/compute-agent/.env"
  chmod 600 "$INSTALL_DIR/compute-agent/.env"

  cd "$INSTALL_DIR/compute-agent"
  npm install --silent 2>/dev/null

  ok "Compute agent ready. Starting..."
  echo ""
  node server.js
else
  ok "Skipping compute agent."
  echo ""
  echo -e "${G}Setup complete!${N}"
  echo ""
  echo "Your private key is stored at:"
  echo "  $INSTALL_DIR/.env  (chmod 600)"
  echo ""
  echo "Compute agent (later):"
  echo "  cd $INSTALL_DIR"
  echo "  mkdir -p compute-agent"
  echo "  curl -fsSL $REPO_RAW/compute-agent/server.js -o compute-agent/server.js"
  echo "  curl -fsSL $REPO_RAW/compute-agent/package.json -o compute-agent/package.json"
  echo "  cp .env compute-agent/.env && chmod 600 compute-agent/.env"
  echo "  cd compute-agent && npm install && node server.js"
  echo ""
  echo "CLI commands:"
  echo "  cd $INSTALL_DIR"
  echo "  node cli.js list        # list all nodes"
  echo "  node cli.js mine        # your nodes"
  echo "  node cli.js heartbeat 1 # send heartbeat"
  echo "  node cli.js balance     # check revenue"
  echo ""
  echo -e "${Y}⚠️  Keep $INSTALL_DIR/.env private. Never share or commit it.${N}"
  echo ""
fi
