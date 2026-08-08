#!/usr/bin/env bash
#
# ComputeRWA Provider Setup Script
# BOT Chain DePIN — One-command node registration
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/mdlog/botchain/main/setup.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/mdlog/botchain/main/setup.sh | PROVIDER_PRIVATE_KEY=0x... bash
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
echo -e "${C}"
cat << 'BANNER'
╔══════════════════════════════════════════════╗
║  ComputeRWA Provider Setup                   ║
║  BOT Chain DePIN — Node Registration         ║
╚══════════════════════════════════════════════╝
BANNER
echo -e "${N}"

# ── Config ─────────────────────────────────────────────
REPO_RAW="https://raw.githubusercontent.com/mdlog/botchain/main"
INSTALL_DIR="${COMPUTERWA_DIR:-$HOME/.computerwa}"
RPC_URL="${RPC_URL:-https://rpc.bohr.life}"
CHAIN_ID="${CHAIN_ID:-968}"
REGISTRY_ADDR="0xc612111b8648B73ED23CF19f400488566af76Ddc"
MARKETPLACE_ADDR="0x7278045051843BbdD7786B493de0681904075f02"
ORACLE_ADDR="0x8674305cb18521E75C01D0162d209ea22767fc33"

# ── Step 0: Check private key ──────────────────────────
step "Step 0/5: Configuration"

if [[ -z "${PROVIDER_PRIVATE_KEY:-}" ]]; then
  echo ""
  read -rp "$(echo -e ${B}'Enter your provider private key (0x...): '${N})" PROVIDER_PRIVATE_KEY
  if [[ -z "$PROVIDER_PRIVATE_KEY" ]]; then
    err "Private key required."
    exit 1
  fi
fi

# Validate format
if [[ ! "$PROVIDER_PRIVATE_KEY" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  err "Invalid private key format. Must be 0x + 64 hex chars."
  exit 1
fi

ok "Private key received"

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

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

info "Downloading to $INSTALL_DIR..."

# Download cli.js and package.json from GitHub raw
curl -fsSL "$REPO_RAW/cli/cli.js" -o cli.js
curl -fsSL "$REPO_RAW/cli/package.json" -o package.json

# Create .env
cat > .env << ENVFILE
PROVIDER_PRIVATE_KEY=$PROVIDER_PRIVATE_KEY
RPC_URL=$RPC_URL
CHAIN_ID=$CHAIN_ID
REGISTRY_ADDR=$REGISTRY_ADDR
MARKETPLACE_ADDR=$MARKETPLACE_ADDR
ORACLE_ADDR=$ORACLE_ADDR
ENVFILE

ok "CLI files downloaded"

# ── Step 3: Install dependencies ───────────────────────
step "Step 3/5: Install Dependencies"

info "Running npm install..."
npm install --silent 2>/dev/null
ok "Dependencies installed"

# ── Step 4: Run setup (detect + register + activate + verify) ──
step "Step 4/5: Node Setup (detect → register → activate → verify)"

#export PROVIDER_PRIVATE_KEY
#export RPC_URL CHAIN_ID REGISTRY_ADDR MARKETPLACE_ADDR ORACLE_ADDR

node cli.js setup || { err "Setup failed!"; exit 1; }

# ── Step 5: Optional — start compute agent ─────────────
step "Step 5/5: Compute Agent"

echo ""
read -rp "$(echo -e ${B}'Start compute agent now? [y/N]: '${N})" START_AGENT

if [[ "${START_AGENT:-}" =~ ^[Yy]$ ]]; then
  info "Downloading compute agent..."

  # Download compute agent files
  mkdir -p "$INSTALL_DIR/compute-agent"
  curl -fsSL "$REPO_RAW/compute-agent/server.js" -o "$INSTALL_DIR/compute-agent/server.js"
  curl -fsSL "$REPO_RAW/compute-agent/package.json" -o "$INSTALL_DIR/compute-agent/package.json"

  # Copy .env
  cp "$INSTALL_DIR/.env" "$INSTALL_DIR/compute-agent/.env"

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
  echo "Compute agent can be started later:"
  echo "  cd $INSTALL_DIR"
  echo "  curl -fsSL $REPO_RAW/compute-agent/server.js -o compute-agent/server.js"
  echo "  curl -fsSL $REPO_RAW/compute-agent/package.json -o compute-agent/package.json"
  echo "  cp .env compute-agent/.env"
  echo "  cd compute-agent && npm install && node server.js"
  echo ""
  echo "Other commands:"
  echo "  cd $INSTALL_DIR"
  echo "  node cli.js list        # list all nodes"
  echo "  node cli.js mine        # your nodes"
  echo "  node cli.js heartbeat 1 # send heartbeat"
  echo "  node cli.js balance     # check revenue"
  echo ""
fi
