#!/usr/bin/env bash
#
# BotCompute Provider Setup Script
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
# Ordering: every check that can fail — tools, disk, arch, download and RPC
# reachability, package installs, the agent build — runs BEFORE the key prompt.
# On-chain registration is irreversible and costs gas, so a machine that cannot
# finish the install must find that out while it is still key-free.
#
set -euo pipefail

# ── Logging (compact, professional, machine-parseable) ──
# Prefix: 14-char level LJS-padded, color-coded, bracketed. Section headers
# use a ▸ marker + name (no "Step N/M" tutorial numbering).
C_RESET='\033[0m'; C_DIM='\033[2m'; C_BOLD='\033[1m'
C_GREEN='\033[32m'; C_RED='\033[31m'; C_YELLOW='\033[33m'

_log() {
  local lvl="$1" color="$2"; shift 2
  printf "%b%-7s%b %s\n" "${color}" "[$lvl]" "${C_RESET}" "$*"
}
info()  { _log INFO  "${C_BOLD}" "$*"; }
ok()    { _log OK    "${C_GREEN}" "$*"; }
warn()  { _log WARN  "${C_YELLOW}" "$*"; }
err()   { _log ERROR "${C_RED}" "$*"; }
step()  { printf "\n%b▸ %s%b\n" "${C_BOLD}" "$*" "${C_RESET}"; }

# Sub-label for indented detail under a step.
sub()   { printf "  %b·%b %s\n" "${C_DIM}" "${C_RESET}" "$*"; }
done_check() { printf "  %b✓%b %s\n" "${C_GREEN}" "${C_RESET}" "$*"; }

# This script probes a dozen optional tools; the bare `command -v` spelling
# buries the logic it guards.
have() { command -v "$1" >/dev/null 2>&1; }

# ── Banner ─────────────────────────────────────────────
printf "%b%s%b\n\n" "${C_BOLD}" \
"BotCompute Provider Setup
Decentralized GPU compute marketplace — BOT Chain DePIN
$(printf '─%.0s' {1..52})" "${C_RESET}"

# ── Config (BOT Chain Testnet) ─────────────────────────
# Testnet: Chain 968, rpc.bohr.life — free DGRAM from the faucet (onboarding).
# This release is testnet-only. Pointing the installer at another deployment is
# a matter of exporting RPC_URL/CHAIN_ID and the four contract addresses.
REPO_RAW="https://raw.githubusercontent.com/mdlog/botchain/main"
INSTALL_DIR="${COMPUTERWA_DIR:-$HOME/.computerwa}"
LOG_DIR="$INSTALL_DIR/logs"
RPC_URL="${RPC_URL:-https://rpc.bohr.life}"
CHAIN_ID="${CHAIN_ID:-968}"
AGENT_PORT="${AGENT_PORT:-3006}"
# Addresses below are the current Testnet deployment (contracts/deployments.json).
REGISTRY_ADDR="${REGISTRY_ADDR:-0xcBbEa600C8d15E190A1C69676d8b8a5938BFE396}"
MARKETPLACE_ADDR="${MARKETPLACE_ADDR:-0xB72A69BeFFcd478e2ae19C20b65b1cAC1DC5d848}"
ORACLE_ADDR="${ORACLE_ADDR:-0x1087701623e187D00cF05A77DFA08F2710FB66Aa}"
AGENT_REGISTRY_ADDR="${AGENT_REGISTRY_ADDR:-0xBF0Fb1508B9E9A6FF13FE74991aA54789D31cAE7}"

# $USER is not set in every container/cron context; systemd units and usermod
# both need a real name.
RUN_USER="${USER:-$(id -un)}"

# rustup toolchain (~1.5G) + cargo target dir (~1.5G) + terminal image (~250M),
# plus headroom for job workspaces.
MIN_FREE_KB=5242880

# Set by preflight(); empty means "no prebuilt binary for this platform".
AGENT_ARCH=""
OS_NAME="$(uname -s)"
# Bump when a new agent release is cut. Absent tags are expected, not an error —
# see download_agent_binary().
AGENT_RELEASE_TAG="v0.1.0"
AGENT_BIN="$INSTALL_DIR/compute-agent-rs/target/release/computerwa-agent"

# Which init system will own the agent; decided in the auto-start step.
SERVICE_MANAGER="none"

if [[ "$CHAIN_ID" == "968" ]]; then
  info "Network: BOT Chain Testnet (Chain 968) — free DGRAM faucet for onboarding"
else
  info "Network: BOT Chain (Chain $CHAIN_ID)"
fi

# ── Preflight: everything that can fail, before any key or gas ──
preflight() {
  local missing="" t
  for t in curl awk sed grep df; do
    have "$t" || missing="$missing $t"
  done
  if [[ -n "$missing" ]]; then
    err "Missing required tools:$missing"
    err "Install them with your package manager and re-run this script."
    return 1
  fi
  done_check "Base tools present (curl, awk, sed, grep, df)"

  case "$(uname -m)" in
    x86_64|amd64)  AGENT_ARCH="linux-amd64" ;;
    aarch64|arm64) AGENT_ARCH="linux-arm64" ;;
    *)             AGENT_ARCH="" ;;
  esac
  # Published agent binaries are Linux-only, and a wrong-arch download is worse
  # than none: it installs and then dies at exec time.
  if [[ "$OS_NAME" != "Linux" ]]; then
    AGENT_ARCH=""
  fi
  if [[ -n "$AGENT_ARCH" ]]; then
    done_check "Platform: $OS_NAME $(uname -m)"
  else
    done_check "Platform: $OS_NAME $(uname -m) — agent will be compiled from source"
  fi

  local free_kb
  free_kb="$(df -Pk "$INSTALL_DIR" 2>/dev/null | awk 'NR==2 {print $4}')"
  if [[ -z "$free_kb" ]]; then
    warn "Could not read free disk space for $INSTALL_DIR — continuing."
  elif [[ "$free_kb" -lt "$MIN_FREE_KB" ]]; then
    err "Only $((free_kb / 1024 / 1024)) GB free at $INSTALL_DIR; the toolchain, build and terminal image need $((MIN_FREE_KB / 1024 / 1024)) GB."
    return 1
  else
    done_check "Disk: $((free_kb / 1024 / 1024)) GB free at $INSTALL_DIR"
  fi

  local url
  for url in "$REPO_RAW/cli/cli.js" "$REPO_RAW/cli/package.json" "$REPO_RAW/compute-agent-rs/Cargo.toml"; do
    if ! curl -fsI --max-time 20 "$url" >/dev/null 2>&1; then
      err "Cannot fetch $url"
      err "Check network/proxy access to raw.githubusercontent.com, then re-run."
      return 1
    fi
  done
  done_check "Source downloads reachable"

  # An unreachable RPC turns registration into a hang after the key is already
  # on disk, so it is a precondition rather than a runtime surprise.
  if ! curl -fsS --max-time 20 -X POST -H 'content-type: application/json' \
        --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
        "$RPC_URL" >/dev/null 2>&1; then
    err "RPC $RPC_URL is not answering. Registration would fail — aborting before any key is entered."
    return 1
  fi
  done_check "RPC reachable: $RPC_URL"
}

# ── Informed consent ───────────────────────────────────
# This installer runs code it did not build, takes a private key and grants
# root-equivalent access. Stating that out loud costs one prompt.
confirm_install() {
  printf "\n%bThis installer will:%b\n" "${C_BOLD}" "${C_RESET}"
  sub "install system packages with sudo — Node.js 22, Docker, bubblewrap, cloudflared"
  sub "add '$RUN_USER' to the docker group; docker group access is equivalent to root on this machine"
  sub "run a compute agent that is either downloaded prebuilt (unsigned, not reproducible) or compiled here from GitHub source"
  sub "install a systemd/launchd unit that starts that agent and a public Cloudflare tunnel on every boot"
  sub "expose localhost:$AGENT_PORT to the internet through that tunnel"
  sub "prompt for a wallet private key, store it at $INSTALL_DIR/.env (chmod 600), and spend gas on 3 on-chain transactions"
  printf "\n"

  if [[ "${BOTCOMPUTE_ASSUME_YES:-0}" == "1" ]]; then
    warn "BOTCOMPUTE_ASSUME_YES=1 — proceeding without confirmation."
    return 0
  fi
  # `-r /dev/tty` passes even where opening it fails (daemons, CI, containers),
  # so probe with a real open.
  if ! { : < /dev/tty; } 2>/dev/null; then
    err "No terminal available to confirm. Re-run interactively, or set BOTCOMPUTE_ASSUME_YES=1 to accept the above."
    return 1
  fi

  local reply=""
  printf "%bProceed? [y/N]:%b " "${C_BOLD}" "${C_RESET}"
  read -r reply < /dev/tty || true
  case "$reply" in
    y|Y|yes|YES) printf "\n"; return 0 ;;
    *) err "Aborted — nothing installed, no key requested."; return 1 ;;
  esac
}

# ── Package installers ─────────────────────────────────
install_node() {
  if have node; then
    local ver major
    ver="$(node -v | sed 's/v//')"
    major="$(echo "$ver" | cut -d. -f1)"
    if [[ "$major" -ge 18 ]]; then
      ok "Node.js v$ver found"
      return 0
    fi
    warn "Node.js v$ver found, need v18+"
  else
    info "Node.js not found."
  fi

  info "Installing Node.js v22..."
  if have apt-get; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null 2>&1 || true
    sudo apt-get install -y nodejs >/dev/null 2>&1 || true
  elif have dnf; then
    sudo dnf install -y nodejs >/dev/null 2>&1 || true
  elif have brew; then
    brew install node@22 >/dev/null 2>&1 || true
  fi

  if have node; then
    ok "Node.js installed: $(node -v)"
    return 0
  fi
  err "Cannot install Node.js automatically. Install v18+ manually: https://nodejs.org"
  return 1
}

# The Rust agent's sandbox refuses to run untrusted code when bwrap is absent,
# so a node without it advertises capacity, wins jobs and then 500s on all of
# them. Installing it is not optional for a provider that wants to get paid.
install_bubblewrap() {
  if have bwrap; then
    ok "bubblewrap found: $(bwrap --version 2>&1 | head -1)"
    return 0
  fi
  info "Installing bubblewrap (sandbox for paid code execution)..."
  if have apt-get; then
    sudo apt-get update -qq >/dev/null 2>&1 || true
    sudo apt-get install -y bubblewrap >/dev/null 2>&1 || true
  elif have dnf; then
    sudo dnf install -y bubblewrap >/dev/null 2>&1 || true
  elif have yum; then
    sudo yum install -y bubblewrap >/dev/null 2>&1 || true
  elif have brew; then
    brew install bubblewrap >/dev/null 2>&1 || true
  fi
  if have bwrap; then
    ok "bubblewrap installed"
    return 0
  fi
  warn "bubblewrap unavailable — the agent will reject every /execute job on this host."
  warn "bwrap needs Linux user namespaces; on macOS run the provider node in a Linux VM or container."
  return 1
}

install_docker() {
  info "Docker not found — installing..."
  if have apt-get || have dnf || have yum; then
    local script log
    script="$(mktemp)"
    log="$LOG_DIR/docker-install.log"
    info "Installing Docker via official script (get.docker.com; log: $log)..."
    # Staged to a file rather than piped into `sudo sh` so the installer's output
    # lands in a log the provider owns, and so a truncated download cannot be
    # half-executed as root.
    if curl -fsSL https://get.docker.com -o "$script"; then
      sudo sh "$script" 2>&1 | tee "$log" \
        || warn "get.docker.com install step reported an error — see $log (continuing)..."
    else
      warn "Could not download get.docker.com (continuing)..."
    fi
    rm -f "$script"
    sudo systemctl enable --now docker >/dev/null 2>&1 || sudo service docker start >/dev/null 2>&1 || true
    sudo usermod -aG docker "$RUN_USER" >/dev/null 2>&1 || true
    if have docker; then return 0; fi
  fi
  if have brew; then
    info "Installing Docker Desktop via Homebrew (macOS)..."
    brew install --cask docker >/dev/null 2>&1 && return 0
  fi
  err "Could not auto-install Docker. Install manually: https://docs.docker.com/get-docker/"
  err "Then re-run this script, or build the image later with:"
  err "  docker build -t botchain-terminal:latest -f compute-agent-rs/Dockerfile.terminal compute-agent-rs/"
  return 1
}

install_cloudflared() {
  info "cloudflared not found — installing..."

  # Linux: Cloudflare official deb repo (most reliable)
  if have apt-get; then
    info "Adding Cloudflare apt repo..."
    sudo mkdir -p /usr/share/keyrings >/dev/null 2>&1 || true
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null 2>&1 || true
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs 2>/dev/null || echo jammy) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null 2>&1 || true
    sudo apt-get update -qq >/dev/null 2>&1 || true
    sudo apt-get install -y cloudflared >/dev/null 2>&1 && return 0
    warn "apt install failed, trying direct binary..."
  fi

  # macOS: Homebrew
  if have brew; then
    info "Installing via Homebrew..."
    brew install cloudflared >/dev/null 2>&1 && return 0
    warn "brew install failed, trying direct binary..."
  fi

  # Universal fallback: direct binary download
  local arch
  case "$(uname -m)" in
    x86_64)  arch="linux-amd64" ;;
    aarch64) arch="linux-arm64" ;;
    armv7l)  arch="linux-arm" ;;
    *)       arch="linux-amd64" ;;
  esac

  local url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${arch}"
  info "Downloading: ${url}"
  sudo curl -fsSL "$url" -o /usr/local/bin/cloudflared && sudo chmod +x /usr/local/bin/cloudflared && return 0

  err "Failed to install cloudflared."
  err "Manual: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/"
  return 1
}

# Older curl builds leave a zero-byte file behind when -f rejects an HTTP
# error, and that stub then reads as "present" to every -f test downstream.
fetch_optional() {
  local url="$1" dest="$2"
  if curl -fsSL "$url" -o "$dest" && [[ -s "$dest" ]]; then
    return 0
  fi
  rm -f "$dest"
  return 1
}

# ── Compute agent: prebuilt fast path, source build as the real route ─────
# Releases are cut by hand and lag the branch, so a missing tag or arch is the
# normal case, not a failure. The download stays silent unless it wins; the
# source build below is the route every provider is expected to take.
download_agent_binary() {
  [[ -n "$AGENT_ARCH" ]] || return 1
  local url="https://github.com/mdlog/botchain/releases/download/${AGENT_RELEASE_TAG}/computerwa-agent-${AGENT_ARCH}"
  # curl -o creates the file but not its parents; target/release only exists
  # after a cargo build, which on this path has not happened.
  mkdir -p "$(dirname "$AGENT_BIN")"
  curl -fsSL --max-time 180 "$url" -o "$AGENT_BIN" 2>/dev/null || return 1
  if [[ ! -s "$AGENT_BIN" ]]; then
    rm -f "$AGENT_BIN"
    return 1
  fi
  chmod +x "$AGENT_BIN"
  return 0
}

fetch_agent_source() {
  local f
  mkdir -p compute-agent-rs/src
  # Cargo.lock is fetched with the sources on purpose: it is tracked upstream,
  # and building a provider node against a floating dependency set is how two
  # nodes end up running different code from the same commit.
  # Keep this list in step with the `mod` declarations in src/main.rs. A module
  # added upstream but missed here fails the build on every provider machine,
  # which is exactly how src/terminal.rs broke this path before.
  for f in Cargo.toml Cargo.lock src/main.rs src/auth.rs src/chain.rs src/sandbox.rs \
           src/monitor.rs src/gpu.rs src/terminal.rs; do
    if ! curl -fsSL "$REPO_RAW/compute-agent-rs/$f" -o "compute-agent-rs/$f"; then
      rm -f "compute-agent-rs/$f"
      err "Failed to download compute-agent-rs/$f — the branch does not publish it."
      return 1
    fi
  done
  # Only the interactive terminal needs this; a miss costs that feature, not the build.
  fetch_optional "$REPO_RAW/compute-agent-rs/Dockerfile.terminal" compute-agent-rs/Dockerfile.terminal \
    || warn "Dockerfile.terminal unavailable — interactive terminal will be disabled."
  return 0
}

build_agent_from_source() {
  if ! have cargo; then
    info "Installing Rust toolchain via rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y >/dev/null 2>&1 || true
    # rustup's env script does nothing but prepend this directory to PATH.
    export PATH="$HOME/.cargo/bin:$PATH"
  fi
  if ! have cargo; then
    err "Rust toolchain unavailable — cannot build the agent. Install rustup manually: https://rustup.rs"
    return 1
  fi
  ok "Rust $(rustc --version | awk '{print $2}')"

  info "Fetching agent source..."
  fetch_agent_source || return 1

  local log="$LOG_DIR/agent-build.log"

  # The release profile uses codegen-units=1 and thin LTO, which give the best
  # runtime but need the most memory to link — enough to OOM a small VPS partway
  # through 481 crates. On a low-memory host, trade some of that back so the
  # build finishes at all; a provider node is I/O bound, not codegen bound.
  local ram_mb=0
  if [[ -r /proc/meminfo ]]; then
    ram_mb=$(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo)
  elif have sysctl; then
    ram_mb=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1048576 ))
  fi
  if [[ "$ram_mb" -gt 0 && "$ram_mb" -lt 4096 ]]; then
    warn "Only ${ram_mb} MB RAM — building with less aggressive optimisation so the link does not run out of memory."
    export CARGO_PROFILE_RELEASE_LTO=false
    export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
    export CARGO_BUILD_JOBS=1
  fi

  info "Building Rust agent (several minutes; log: $log)..."
  # `set -euo pipefail` would abort the whole installer the moment cargo exits
  # non-zero, so the build is guarded — the diagnostics below are the point.
  if ! ( cd compute-agent-rs && cargo build --release ) 2>&1 | tee "$log"; then
    err "cargo build failed. Full output: $log"
    if grep -qiE "signal: 9|out of memory|Killed" "$log" 2>/dev/null; then
      err "The compiler was killed — this host ran out of memory. Add swap, or use a prebuilt binary."
    fi
    return 1
  fi
  if [[ ! -f "$AGENT_BIN" ]]; then
    err "cargo reported success but $AGENT_BIN is missing. Full output: $log"
    return 1
  fi
  return 0
}

# ── Helper: securely read private key ──────────────────
read_and_store_key() {
  # If key provided via env var (piped), use it but unset immediately after storing
  if [[ -n "${PROVIDER_PRIVATE_KEY:-}" ]]; then
    KEY="$PROVIDER_PRIVATE_KEY"
    unset PROVIDER_PRIVATE_KEY
  else
    echo ""
    printf "%bEnter your provider private key (input hidden):%b\n" "${C_BOLD}" "${C_RESET}"
    # The wallet needs a balance for on-chain registration: registerNode,
    # updateStatus and setAgentUrl (3 txs). For testnet (Chain ${CHAIN_ID})
    # get free DGRAM from the faucet first:
    printf "  %bNeed testnet DGRAM for gas? Faucet:%b https://faucet.botchain.ai/basic\n" "${C_DIM}" "${C_RESET}"
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
    printf 'AGENT_PORT=%s\n' "$AGENT_PORT"
    printf 'AGENT_REGISTRY_ADDR=%s\n' "$AGENT_REGISTRY_ADDR"
  } > .env

  # Clear key from shell variable — only .env has it now
  KEY=""

  ok "Private key stored securely in .env (chmod 600)"
}

# ── Auto-start on reboot (daemonize) ───────────────────
# Without this, a provider reboot kills the agent + tunnel and they never come
# back until the user manually re-runs setup — uptime metric tanks and the node
# shows offline to consumers. We install a systemd unit (Linux) so the agent
# survives reboots and auto-restarts on crash. macOS uses a launchd plist.
install_systemd_units() {
  local agent_unit="/etc/systemd/system/botcompute-agent.service"
  local tunnel_unit="/etc/systemd/system/botcompute-tunnel.service"
  local workdir="$INSTALL_DIR/compute-agent-rs"
  local node_bin tmp
  node_bin="$(command -v node)"

  if [[ ! -f "$AGENT_BIN" ]]; then
    warn "Agent binary missing — skipping systemd units."
    return 1
  fi
  info "Installing systemd services (auto-start + restart-on-crash)..."

  # No EnvironmentFile: the agent reads .env from its WorkingDirectory via
  # dotenvy, which keeps the key out of the process environment (and out of
  # /proc/<pid>/environ) exactly as the header of this script promises.
  # SupplementaryGroups=docker reaches the Docker socket without an sg wrapper.
  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
[Unit]
Description=BotCompute Provider Agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
SupplementaryGroups=docker
WorkingDirectory=$workdir
ExecStart=$AGENT_BIN
Restart=on-failure
RestartSec=5
StandardOutput=append:$workdir/agent.log
StandardError=append:$workdir/agent.log

[Install]
WantedBy=multi-user.target
EOF
  if ! sudo install -m 0644 "$tmp" "$agent_unit" 2>/dev/null; then
    rm -f "$tmp"
    warn "Could not write $agent_unit (sudo unavailable) — skipping auto-start."
    return 1
  fi

  # A quick tunnel is issued a brand-new *.trycloudflare.com hostname on every
  # start, so the boot path has to re-run set-agent-url or consumers keep
  # dialling yesterday's dead hostname. `cli.js tunnel` does both, which is why
  # the unit runs it instead of cloudflared directly.
  cat > "$tmp" <<EOF
[Unit]
Description=BotCompute Cloudflare tunnel + on-chain agent URL
After=network-online.target botcompute-agent.service
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$node_bin $INSTALL_DIR/cli.js tunnel --port $AGENT_PORT
Restart=always
RestartSec=15
StandardOutput=append:$INSTALL_DIR/tunnel.log
StandardError=append:$INSTALL_DIR/tunnel.log

[Install]
WantedBy=multi-user.target
EOF
  if ! sudo install -m 0644 "$tmp" "$tunnel_unit" 2>/dev/null; then
    rm -f "$tmp"
    warn "Could not write $tunnel_unit — the tunnel will not come back after a reboot."
    return 1
  fi
  rm -f "$tmp"

  sudo systemctl daemon-reload >/dev/null 2>&1 || true
  sudo systemctl enable botcompute-agent.service botcompute-tunnel.service >/dev/null 2>&1 || true
  ok "systemd units installed — agent + tunnel auto-start on boot and restart on crash"
  info "  Manage: sudo systemctl {start,stop,status,restart} botcompute-agent botcompute-tunnel"
  info "  Logs:   journalctl -u botcompute-agent -f  (or $workdir/agent.log)"
  return 0
}

install_launchd_agents() {
  local agent_plist="$HOME/Library/LaunchAgents/com.botcompute.agent.plist"
  local tunnel_plist="$HOME/Library/LaunchAgents/com.botcompute.tunnel.plist"
  local workdir="$INSTALL_DIR/compute-agent-rs"
  local node_bin
  node_bin="$(command -v node)"

  if [[ ! -f "$AGENT_BIN" ]]; then
    warn "Agent binary missing — skipping launchd agents."
    return 1
  fi
  info "Installing launchd agents (auto-start on login)..."
  mkdir -p "$HOME/Library/LaunchAgents"

  cat > "$agent_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.botcompute.agent</string>
  <key>ProgramArguments</key><array>
    <string>$AGENT_BIN</string>
  </array>
  <key>WorkingDirectory</key><string>$workdir</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$workdir/agent.log</string>
  <key>StandardErrorPath</key><string>$workdir/agent.log</string>
</dict></plist>
EOF

  cat > "$tunnel_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.botcompute.tunnel</string>
  <key>ProgramArguments</key><array>
    <string>$node_bin</string>
    <string>$INSTALL_DIR/cli.js</string>
    <string>tunnel</string>
    <string>--port</string>
    <string>$AGENT_PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$INSTALL_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$INSTALL_DIR/tunnel.log</string>
  <key>StandardErrorPath</key><string>$INSTALL_DIR/tunnel.log</string>
</dict></plist>
EOF

  ok "launchd agents installed — agent + tunnel start on login and restart on crash"
  return 0
}

# Fallback for hosts with neither systemd nor launchd: the agent survives only
# until the next reboot, which the summary says out loud.
start_agent_nohup() {
  if [[ ! -f "$AGENT_BIN" ]]; then
    warn "Agent binary missing — nothing to start."
    return 1
  fi
  fuser -k "$AGENT_PORT/tcp" >/dev/null 2>&1 || true
  # Wrap in `sg docker` only when the docker group isn't active in this session
  # but the user IS a member, so the agent can reach the socket without a
  # re-login. If docker isn't usable at all, launch normally — the agent warns
  # and disables terminals while still serving code-run.
  (
    cd "$INSTALL_DIR/compute-agent-rs" || exit 1
    if [[ "${BOTCHAIN_AGENTS_DOCKER:-0}" == "1" ]] && [[ "${BOTCHAIN_FRESH_DOCKER:-1}" != "1" ]]; then
      nohup sg docker -c "$AGENT_BIN" > agent.log 2>&1 &
    else
      nohup "$AGENT_BIN" > agent.log 2>&1 &
    fi
  )
  sleep 2
  ok "Compute agent started (nohup — will not survive a reboot)"
  return 0
}

# Poll a log file rather than the process: the tunnel is owned by systemd or
# launchd here, so its stdout is the only handle this script still has.
wait_for_log_match() {
  local log="$1" pattern="$2" timeout="$3"
  local deadline=$(( SECONDS + timeout )) hit=""
  while [[ "$SECONDS" -lt "$deadline" ]]; do
    hit="$(grep -Eom1 "$pattern" "$log" 2>/dev/null || true)"
    if [[ -n "$hit" ]]; then
      printf '%s\n' "$hit"
      return 0
    fi
    sleep 2
  done
  return 1
}

# ── Configuration + preflight ──────────────────────────
step "Configuration"

info "Install directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$LOG_DIR"
cd "$INSTALL_DIR"

step "Preflight"
preflight

confirm_install

# ── Runtime dependencies ───────────────────────────────
step "Runtime dependencies"

install_node
install_bubblewrap || true

if ! have docker; then
  install_docker || true
else
  ok "Docker found: $(docker --version 2>&1 | head -1)"
fi

if have cloudflared && cloudflared --version >/dev/null 2>&1; then
  ok "cloudflared detected: $(cloudflared --version 2>&1 | head -1)"
else
  # Binary exists but broken? Remove and reinstall.
  if have cloudflared; then
    warn "cloudflared binary present but broken — reinstalling..."
    sudo rm -f "$(command -v cloudflared)" >/dev/null 2>&1 || true
  fi
  install_cloudflared || true
fi

# ── Fetch provider CLI ─────────────────────────────────
step "Fetch provider CLI"

info "Downloading CLI files..."
for cli_file in cli.js package.json; do
  if ! curl -fsSL "$REPO_RAW/cli/$cli_file" -o "$cli_file"; then
    err "Failed to download cli/$cli_file from $REPO_RAW"
    exit 1
  fi
done
ok "CLI files downloaded"

info "Running npm install (log: $LOG_DIR/npm-install.log)..."
if ! npm install --silent > "$LOG_DIR/npm-install.log" 2>&1; then
  err "npm install failed — see $LOG_DIR/npm-install.log"
  exit 1
fi
ok "Dependencies installed"

# ── Install compute agent ──────────────────────────────
step "Install compute agent"

if download_agent_binary; then
  ok "Prebuilt agent binary installed ($(du -h "$AGENT_BIN" | cut -f1))"
else
  info "Building the agent from source (needs a Rust toolchain)..."
  if ! build_agent_from_source; then
    err "Could not obtain a compute agent. Nothing has been registered on-chain — no gas was spent."
    exit 1
  fi
  ok "Agent built from source ($(du -h "$AGENT_BIN" | cut -f1))"
fi

# Dockerfile.terminal is needed by the image build regardless of which path
# produced the binary.
if [[ ! -f compute-agent-rs/Dockerfile.terminal ]]; then
  mkdir -p compute-agent-rs
  fetch_optional "$REPO_RAW/compute-agent-rs/Dockerfile.terminal" compute-agent-rs/Dockerfile.terminal \
    || warn "Could not fetch Dockerfile.terminal — interactive terminal will be unavailable."
fi

# ── Build interactive-terminal Docker image ────────────
step "Build terminal sandbox image (Docker)"

# Decide how to invoke docker for the rest of this script + the agent launch.
# Three cases:
#   1) docker group active in THIS session        → run `docker ...` directly.
#   2) user is a docker-group member but not active (e.g. just usermod'd) →
#      run via `sg docker -c "..."` (works because sg reads /etc/group).
#   3) user not a member at all                    → try usermod -aG, then sg;
#      if that fails (no sudo), fall back to `sudo docker` for the build and
#      warn that the agent may need a re-login to reach docker.
#
# DOCKER_GROUP_ACTIVE=="1"  → the agent can run `docker` directly.
# DOCKER_GROUP_ACTIVE=="0"  → a nohup launch must wrap the agent in `sg docker -c`.
# Initialize before any branch so they are always defined under `set -u`.
DOCKER_GROUP_ACTIVE=0
AGENTS_DOCKER=0   # whether the agent will be able to reach docker (1) or not (0)
USE_SG=0

if ! have docker; then
  warn "Docker unavailable — skipping terminal image. Interactive terminal disabled; code-run (/execute) unaffected."
else
  # Case 1: group already active in this session?
  if id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    DOCKER_GROUP_ACTIVE=1
    AGENTS_DOCKER=1
    dock() { bash -c "$1"; }
  else
    # Case 2 or 3: is the user a member per /etc/group (added but not active)?
    if getent group docker 2>/dev/null | grep -qw "$RUN_USER"; then
      USE_SG=1
    else
      # Case 3: not a member — add the user, then sg can work.
      if sudo usermod -aG docker "$RUN_USER" 2>/dev/null; then
        ok "Added $RUN_USER to docker group (root-equivalent; active after re-login, using sg for now)."
        USE_SG=1
      else
        warn "Cannot add $RUN_USER to docker group (sudo unavailable). Falling back to sudo docker for this build; the agent will NOT be able to use docker until you re-login with docker group access."
        USE_SG=0
      fi
    fi

    if [[ "$USE_SG" == "1" ]]; then
      dock() { sg docker -c "$1"; }
      AGENTS_DOCKER=1
      # Probe: can sg actually reach the daemon?
      if ! dock 'docker info >/dev/null 2>&1'; then
        warn "Docker socket not reachable via sg (daemon perms?). Using sudo for build; agent launch will still try sg."
        AGENTS_DOCKER=1  # sg is the right wrapper; daemon issue is separate
      fi
    else
      # No group access at all in this session — build via sudo now.
      dock() { sudo bash -c "$1"; }
      AGENTS_DOCKER=0   # agent cannot use docker without re-login
    fi
  fi

  if dock 'docker image inspect botchain-terminal:latest >/dev/null 2>&1'; then
    info "botchain-terminal:latest already built — skipping."
  elif [[ ! -f compute-agent-rs/Dockerfile.terminal ]]; then
    warn "Dockerfile.terminal missing — skipping terminal image."
  else
    TERM_IMAGE_LOG="$LOG_DIR/terminal-image.log"
    info "Building botchain-terminal:latest (one-time, ~250MB; log: $TERM_IMAGE_LOG)..."
    # Guarded: an unguarded failure here trips `set -euo pipefail` and kills the
    # installer before the warning below can explain that only the interactive
    # terminal is affected.
    if ! dock 'docker build -t botchain-terminal:latest -f compute-agent-rs/Dockerfile.terminal compute-agent-rs/' 2>&1 | tee "$TERM_IMAGE_LOG"; then
      warn "Terminal image build failed — see $TERM_IMAGE_LOG. Interactive terminal will error until fixed; code-run (/execute) is unaffected."
    elif dock 'docker image inspect botchain-terminal:latest >/dev/null 2>&1'; then
      ok "Terminal session image built."
    else
      warn "Terminal image build reported success but the image is absent — see $TERM_IMAGE_LOG."
    fi
  fi
fi
export BOTCHAIN_FRESH_DOCKER="${DOCKER_GROUP_ACTIVE}"   # 1 = direct; 0 = needs sg
export BOTCHAIN_AGENTS_DOCKER="${AGENTS_DOCKER}"        # whether agent can reach docker

# ── Private key + on-chain registration ────────────────
# First point in the script that touches a key or spends gas. Everything above
# is reversible; everything below is not.
step "Provider key"

read_and_store_key

# Verify .env was written correctly (check key exists without printing it)
if ! grep -q '^PROVIDER_PRIVATE_KEY=0x[0-9a-fA-F]\{64\}$' .env 2>/dev/null; then
  err "Failed to store private key in .env"
  exit 1
fi

# The agent reads its own .env from its working directory (dotenvy).
mkdir -p compute-agent-rs
install -m 600 .env compute-agent-rs/.env

step "On-chain node registration"

# Key is read from .env by dotenv — NOT from process environment
node cli.js setup || { err "Registration failed!"; exit 1; }

step "Attestation"

# verifyNode is restricted to the registry verifier: a marketplace where every
# provider can flip their own `verified` flag has no trust anchor at all.
info "Your node is registered and Active, but NOT yet verified."
sub "Verification is performed by the registry verifier — providers cannot attest to their own hardware."
sub "The verifier attests it from the contracts workspace: NODE_ID=<nodeId> npm run attest"
sub "That reads the verifier key from contracts/.env — never pass a key on the command line, it lands in shell history and /proc"
sub "Find your node id and current state: cd $INSTALL_DIR && node cli.js mine"

# ── Auto-start on boot ─────────────────────────────────
# Installed BEFORE the tunnel: the tunnel is a long-running foreground process,
# so anything sequenced after it never runs.
step "Auto-start on boot"

if [[ "$OS_NAME" == "Darwin" ]]; then
  if install_launchd_agents; then
    SERVICE_MANAGER="launchd"
  fi
elif have systemctl; then
  if install_systemd_units; then
    SERVICE_MANAGER="systemd"
  fi
else
  warn "Neither systemd nor launchd detected — the agent and tunnel will not survive a reboot."
fi

# ── Start agent ────────────────────────────────────────
step "Start compute agent"

case "$SERVICE_MANAGER" in
  systemd)
    sudo systemctl restart botcompute-agent.service >/dev/null 2>&1 \
      || warn "systemctl could not start botcompute-agent — check: journalctl -u botcompute-agent -n 50"
    sleep 2
    if sudo systemctl is-active --quiet botcompute-agent.service; then
      ok "Compute agent running under systemd"
    else
      warn "botcompute-agent is not active — check: journalctl -u botcompute-agent -n 50"
    fi
    ;;
  launchd)
    launchctl unload "$HOME/Library/LaunchAgents/com.botcompute.agent.plist" >/dev/null 2>&1 || true
    launchctl load "$HOME/Library/LaunchAgents/com.botcompute.agent.plist" >/dev/null 2>&1 \
      || warn "launchctl could not load the agent — check $INSTALL_DIR/compute-agent-rs/agent.log"
    sleep 2
    ok "Compute agent loaded under launchd"
    ;;
  *)
    start_agent_nohup || true
    ;;
esac

# ── Tunnel + on-chain agent URL ────────────────────────
step "Public tunnel + on-chain agent URL"

TUNNEL_LOG="$INSTALL_DIR/tunnel.log"
: > "$TUNNEL_LOG"

if ! have cloudflared; then
  warn "cloudflared not installed — agent URL not registered, so consumers cannot reach this node."
  warn "Install it, then run: cd $INSTALL_DIR && node cli.js tunnel --port $AGENT_PORT"
else
  case "$SERVICE_MANAGER" in
    systemd)
      info "Starting botcompute-tunnel (systemd)..."
      sudo systemctl restart botcompute-tunnel.service >/dev/null 2>&1 \
        || warn "systemctl could not start botcompute-tunnel — see $TUNNEL_LOG"
      ;;
    launchd)
      info "Starting the tunnel (launchd)..."
      launchctl unload "$HOME/Library/LaunchAgents/com.botcompute.tunnel.plist" >/dev/null 2>&1 || true
      launchctl load "$HOME/Library/LaunchAgents/com.botcompute.tunnel.plist" >/dev/null 2>&1 \
        || warn "launchctl could not load the tunnel — see $TUNNEL_LOG"
      ;;
    *)
      # `cli.js tunnel` blocks for as long as the tunnel lives, so it has to be
      # backgrounded here or the rest of this script never runs.
      info "Starting the tunnel in the background..."
      nohup node cli.js tunnel --port "$AGENT_PORT" >> "$TUNNEL_LOG" 2>&1 &
      ;;
  esac

  info "Waiting for the tunnel hostname (up to 120s)..."
  TUNNEL_URL="$(wait_for_log_match "$TUNNEL_LOG" 'https://[a-z0-9-]+\.trycloudflare\.com' 120)" || TUNNEL_URL=""
  if [[ -n "$TUNNEL_URL" ]]; then
    ok "Tunnel URL: $TUNNEL_URL"
    if wait_for_log_match "$TUNNEL_LOG" 'Agent URL registered on-chain' 90 >/dev/null; then
      ok "Agent URL registered on-chain — consumers can discover this node."
    else
      warn "Tunnel is up but the on-chain registration was not confirmed (see $TUNNEL_LOG). Register manually:"
      warn "  cd $INSTALL_DIR && node cli.js set-agent-url $TUNNEL_URL"
    fi
  else
    warn "No tunnel hostname after 120s — see $TUNNEL_LOG"
    warn "Retry with: cd $INSTALL_DIR && node cli.js tunnel --port $AGENT_PORT"
  fi
fi

# ── Done ───────────────────────────────────────────────
printf "\n%bSetup complete%b\n\n" "${C_GREEN}${C_BOLD}" "${C_RESET}"
printf "  Private key:    %s/.env %b(chmod 600)%b\n" "$INSTALL_DIR" "${C_DIM}" "${C_RESET}"
printf "  Install dir:    %s\n" "$INSTALL_DIR"
printf "  Agent binary:   %s\n" "$AGENT_BIN"
printf "  Logs:           %s\n" "$LOG_DIR"
printf "\n%bNext steps%b\n" "${C_BOLD}" "${C_RESET}"
case "$SERVICE_MANAGER" in
  systemd)
    printf "  %bAgent + tunnel run as systemd units — both auto-start on boot.%b\n" "${C_DIM}" "${C_RESET}"
    printf "  %bsudo systemctl status botcompute-agent botcompute-tunnel%b\n" "${C_DIM}" "${C_RESET}"
    printf "  %bjournalctl -u botcompute-agent -f%b   # tail agent logs\n" "${C_DIM}" "${C_RESET}"
    ;;
  launchd)
    printf "  %bAgent + tunnel run as launchd agents — both start on login.%b\n" "${C_DIM}" "${C_RESET}"
    printf "  %btail -f %s/compute-agent-rs/agent.log%b\n" "${C_DIM}" "$INSTALL_DIR" "${C_RESET}"
    ;;
  *)
    printf "  %bNo service manager — re-run this script after a reboot to bring the node back.%b\n" "${C_YELLOW}" "${C_RESET}"
    printf "  %bcd %s/compute-agent-rs && ./target/release/computerwa-agent%b\n" "${C_DIM}" "$INSTALL_DIR" "${C_RESET}"
    ;;
esac
printf "\n%bProvider CLI%b\n" "${C_BOLD}" "${C_RESET}"
printf "  %bcd %s && node cli.js mine%b        # your nodes\n" "${C_DIM}" "$INSTALL_DIR" "${C_RESET}"
printf "  %bnode cli.js list%b                # all nodes\n" "${C_DIM}" "${C_RESET}"
printf "  %bnode cli.js balance%b             # revenue\n" "${C_DIM}" "${C_RESET}"
printf "  %bnode cli.js heartbeat <id>%b      # heartbeat\n" "${C_DIM}" "${C_RESET}"
printf "\n  %bNode stays unverified until the registry verifier attests it.%b\n" "${C_DIM}" "${C_RESET}"
printf "\n%bKeep %s/.env private — never share or commit it.%b\n" "${C_YELLOW}" "$INSTALL_DIR" "${C_RESET}"
printf "\n"
