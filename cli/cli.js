#!/usr/bin/env node
/**
 * ComputeRWA Provider CLI
 * Usage:
 *   node cli.js setup                      — one-command: detect → register → activate
 *   node cli.js setup --model "RTX 3060" --vram 12 --tflops 13 --region SG
 *   node cli.js detect                      — detect hardware
 *   node cli.js register                    — register node on-chain
 *   node cli.js activate <nodeId>           — set node Active
 *   node cli.js deactivate <nodeId>         — set node Inactive
 *   node cli.js verify <nodeId>             — attest a node (registry verifier only)
 *   node cli.js heartbeat <nodeId>          — send heartbeat
 *   node cli.js list                        — list all nodes
 *   node cli.js mine                        — list my nodes
 *   node cli.js info <nodeId>               — node details
 *   node cli.js balance                     — revenue + balance
 *   node cli.js status                      — network status
 */
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import os from 'os';

const PRIVATE_KEY = process.env.PROVIDER_PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL || 'https://rpc.bohr.life';
const CHAIN_ID = Number(process.env.CHAIN_ID || 968);
const REGISTRY_ADDR = process.env.REGISTRY_ADDR || '0xcBbEa600C8d15E190A1C69676d8b8a5938BFE396';
const MARKETPLACE_ADDR =
  process.env.MARKETPLACE_ADDR || '0xB72A69BeFFcd478e2ae19C20b65b1cAC1DC5d848';
const ORACLE_ADDR = process.env.ORACLE_ADDR || '0x1087701623e187D00cF05A77DFA08F2710FB66Aa';
const AGENT_REGISTRY_ADDR =
  process.env.AGENT_REGISTRY_ADDR || '0xBF0Fb1508B9E9A6FF13FE74991aA54789D31cAE7';

const chain = {
  id: CHAIN_ID,
  name: CHAIN_ID === 677 ? 'BOT Chain Mainnet' : 'BOT Chain Testnet',
  nativeCurrency: { name: 'DGRAM', symbol: 'DGRAM', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const REGISTRY_ABI = [
  {
    name: 'registerNode',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'model', type: 'string' },
      { name: 'vramGB', type: 'uint16' },
      { name: 'tflops', type: 'uint16' },
      { name: 'region', type: 'string' },
    ],
    outputs: [{ name: 'nodeId', type: 'uint64' }],
  },
  {
    name: 'updateStatus',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'nodeId', type: 'uint64' },
      { name: 'newStatus', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    name: 'heartbeat',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'nodeId', type: 'uint64' }],
    outputs: [],
  },
  {
    name: 'verifyNode',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'nodeId', type: 'uint64' }],
    outputs: [],
  },
  {
    name: 'getNode',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'nodeId', type: 'uint64' }],
    outputs: [
      {
        name: 'node',
        type: 'tuple',
        components: [
          { name: 'provider', type: 'address' },
          {
            name: 'specs',
            type: 'tuple',
            components: [
              { name: 'model', type: 'string' },
              { name: 'vramGB', type: 'uint16' },
              { name: 'tflops', type: 'uint16' },
              { name: 'region', type: 'string' },
            ],
          },
          { name: 'status', type: 'uint8' },
          { name: 'totalRevenue', type: 'uint96' },
          { name: 'registeredAt', type: 'uint64' },
          { name: 'lastHeartbeat', type: 'uint64' },
          { name: 'verified', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'getProviderNodes',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [{ name: 'nodeIds', type: 'uint64[]' }],
  },
  {
    name: 'getProviderRevenue',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [{ name: 'total', type: 'uint96' }],
  },
  {
    name: 'nodeCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalActiveNodes',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

const AGENT_REGISTRY_ABI = [
  {
    name: 'setAgentUrl',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'url', type: 'string' }],
    outputs: [],
  },
  {
    name: 'getAgentUrl',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [{ name: 'url', type: 'string' }],
  },
];

const ORACLE_ABI = [
  {
    name: 'getPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'model', type: 'string' }],
    outputs: [
      { name: 'pricePerHourWei', type: 'uint256' },
      { name: 'updatedAt', type: 'uint64' },
      { name: 'confidence', type: 'uint16' },
    ],
  },
];

const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
let walletClient = null,
  account = null;

function getWallet() {
  if (!PRIVATE_KEY) {
    console.error('❌ PROVIDER_PRIVATE_KEY not set in .env');
    process.exit(1);
  }
  if (!account) {
    account = privateKeyToAccount(PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : '0x' + PRIVATE_KEY);
    walletClient = createWalletClient({ chain, transport: http(RPC_URL), account });
  }
  return { walletClient, account };
}

const STATUS_NAMES = ['Inactive', 'Active', 'Busy', 'Offline'];

// setup.sh installs the CLI next to compute-agent-rs/; a checkout runs it from
// cli/ with the agent one level up. Resolve rather than print a path that is
// wrong in whichever layout the operator happens to be in.
const AGENT_DIR = existsSync('./compute-agent-rs') ? './compute-agent-rs' : '../compute-agent-rs';

// verifyNode is restricted to the registry verifier. A marketplace where each
// provider can set their own `verified` flag has no trust anchor, so the CLI
// must never suggest a provider can self-attest.
function printAttestationNotice(nodeId) {
  const id = nodeId ? String(nodeId) : '<nodeId>';
  console.log('\n🔎 Attestation');
  console.log('   Your node is registered and Active, but not yet verified.');
  console.log(
    '   Verification is on-chain and verifier-only — providers cannot attest to their own hardware.',
  );
  console.log('   The registry verifier runs:  node cli.js verify ' + id);
  console.log(
    '   (that command needs the verifier key in PROVIDER_PRIVATE_KEY; it reverts for anyone else)\n',
  );
}
function shortAddr(a) {
  return a.slice(0, 6) + '…' + a.slice(-4);
}
function timeAgo(ts) {
  if (!ts || ts === 0n) return 'never';
  const d = Math.floor(Date.now() / 1000) - Number(ts);
  if (d < 60) return d + 's ago';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  return Math.floor(d / 86400) + 'd ago';
}
function parseArgs(args) {
  const p = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const k = args[i].slice(2);
      const v = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      p[k] = v;
      if (v !== true) i++;
    }
  }
  return p;
}

function estimateTflops(model) {
  const m = (model || '').toLowerCase();
  const map = {
    h100: 989,
    a100: 624,
    'rtx 5090': 105,
    'rtx 4090': 165,
    'rtx 4080': 97,
    'rtx 4070': 48,
    'rtx 3090': 71,
    'rtx 3080': 35,
    'rtx 3070': 21,
    'rtx 3060': 13,
    'rtx 3050': 6,
    'gtx 1660': 14,
    'gtx 1080': 9,
    'gtx 1070': 6.5,
    'rx 7900': 61,
    'rx 6900': 51,
    'rx 6800': 41,
    'rx 6700': 24,
    radeon: 25,
  };
  for (const [k, v] of Object.entries(map)) {
    if (m.includes(k)) return v;
  }
  return 0;
}

// Normalize GPU model name to match PriceOracle entries
// nvidia-smi returns "NVIDIA GeForce RTX 3060" → oracle expects "NVIDIA RTX 3060"
function normalizeGpuName(name) {
  if (!name || name === 'CPU Only') return name;
  let n = name.trim();
  // Strip "GeForce" and "Quadro" — oracle uses short form
  n = n.replace(/GeForce\s+/i, '').replace(/Quadro\s+/i, '');
  // Strip VRAM suffix: "H100 80GB HBM3" → "NVIDIA H100"
  n = n.replace(/\s+\d+GB\s+HBM\d+/i, '');
  return n;
}

function detectHardware() {
  console.log('🔍 Detecting hardware…\n');
  let gpuModel = 'CPU Only',
    vramGB = 0,
    tflops = 0,
    hasGpu = false;
  try {
    const out = execSync(
      'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null',
      { encoding: 'utf8', timeout: 5000 },
    ).trim();
    if (out) {
      const [n, v] = out.split(',').map((s) => s.trim());
      gpuModel = normalizeGpuName(n);
      vramGB = Math.round(((parseInt(v) || 0) / 1024) * 10) / 10;
      hasGpu = true;
      tflops = estimateTflops(n);
      console.log('  GPU:  ' + gpuModel + ' (' + vramGB + ' GB, ~' + tflops + ' TFLOPS)');
    }
  } catch {}
  if (!hasGpu) {
    try {
      const out = execSync('rocm-smi --showproductname --csv 2>/dev/null', {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      if (out && out.includes('Card series')) {
        for (const l of out.split('\n')) {
          if (l.includes('Card series')) {
            const p = l.split(',');
            if (p.length >= 2) {
              gpuModel = p[1].trim();
              hasGpu = true;
              vramGB = 16;
              tflops = estimateTflops(gpuModel);
              console.log(
                '  GPU:  ' + gpuModel + ' (AMD, ~' + vramGB + ' GB, ~' + tflops + ' TFLOPS)',
              );
              break;
            }
          }
        }
      }
    } catch {}
  }
  let cpuModel = 'Unknown',
    cpuCores = 0;
  try {
    const ls = execSync('lscpu 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    const m1 = ls.match(/Model name:\s*(.+)/),
      m2 = ls.match(/CPU\(s\):\s*(\d+)/);
    if (m1) cpuModel = m1[1].trim();
    if (m2) cpuCores = parseInt(m2[1]);
    console.log('  CPU:  ' + cpuModel + ' (' + cpuCores + ' cores)');
  } catch {
    cpuCores = os.cpus().length;
    cpuModel = os.cpus()[0]?.model || 'Unknown';
    console.log('  CPU:  ' + cpuModel + ' (' + cpuCores + ' cores)');
  }
  let ramGB = 0;
  try {
    const mi = readFileSync('/proc/meminfo', 'utf8');
    const m = mi.match(/MemTotal:\s*(\d+)/);
    if (m) ramGB = Math.round((parseInt(m[1]) / 1024 / 1024) * 10) / 10;
    console.log('  RAM:  ' + ramGB + ' GB');
  } catch {}
  let diskGB = 0;
  try {
    const df = execSync('df --output=size -B1 / 2>/dev/null', { encoding: 'utf8', timeout: 5000 })
      .trim()
      .split('\n');
    if (df.length >= 2) {
      diskGB = Math.round(parseInt(df[1].trim()) / 1024 / 1024 / 1024);
      console.log('  Disk: ' + diskGB + ' GB');
    }
  } catch {}
  let region = 'AUTO';
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    region = tz.split('/').pop() || 'AUTO';
  } catch {}
  if (!hasGpu) {
    gpuModel = 'CPU Only';
    vramGB = 0;
    tflops = Math.round(cpuCores * 0.5 * 10) / 10;
    console.log('  GPU:  None (CPU-only, ~' + tflops + ' TFLOPS)');
  }
  console.log('  Region: ' + region + '\n');
  return { gpuModel, vramGB, tflops, region, cpuModel, cpuCores, ramGB, diskGB, hasGpu };
}

// ── setup: one-command detect → register → activate → verify ──
async function cmdSetup(args) {
  const flags = parseArgs(args);
  const { walletClient, account } = getWallet();
  console.log('🚀 ComputeRWA One-Command Setup\n');
  console.log('   Provider: ' + account.address);
  console.log('   Network:  ' + chain.name + ' (Chain ID ' + chain.id + ')\n');
  const balance = await publicClient.getBalance({ address: account.address });
  console.log('   Balance:  ' + formatEther(balance) + ' DGRAM');
  if (balance === 0n) {
    console.log('\n❌ No DGRAM for gas. Fund your wallet first.');
    process.exit(1);
  }

  // ── Check existing nodes ─────────────────────────
  const existingIds = await publicClient.readContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: 'getProviderNodes',
    args: [account.address],
  });
  if (existingIds.length > 0) {
    console.log('\n━━━ Existing Nodes Check ━━━');
    console.log('   Found ' + existingIds.length + ' existing node(s) for this wallet:');
    // Readiness is Active-only. Verification is granted by the registry
    // verifier, not the provider, so gating on it would re-register a brand-new
    // node (and burn gas) on every run until an operator happened to attest.
    let allActive = true;
    let anyUnverified = false;
    for (const id of existingIds) {
      const n = await publicClient.readContract({
        address: REGISTRY_ADDR,
        abi: REGISTRY_ABI,
        functionName: 'getNode',
        args: [id],
      });
      const st = STATUS_NAMES[Number(n.status)];
      console.log(
        '   → node-id:' +
          id.toString() +
          ': ' +
          n.specs.model +
          ' / ' +
          st +
          ' / ' +
          (n.verified ? 'verified' : 'awaiting attestation'),
      );
      if (Number(n.status) !== 1) allActive = false;
      if (!n.verified) anyUnverified = true;
    }
    console.log('');
    if (allActive) {
      console.log('   ✅ All nodes are Active. Nothing to register.');
      if (anyUnverified) printAttestationNotice();
      console.log('   Run "node cli.js mine" to view your nodes.\n');
      return;
    }
    console.log(
      '   ⚠️  Some nodes are not Active — activate them with "node cli.js activate <id>".',
    );
    console.log('   Continuing will register an ADDITIONAL node.\n');
  }

  console.log('\n━━━ Step 1/3: Hardware Detection ━━━');
  let model, vramGB, tflops, region;
  if (flags.model) {
    model = flags.model;
    vramGB = parseInt(flags.vram) || 0;
    tflops = parseInt(flags.tflops) || 0;
    region = flags.region || 'AUTO';
    console.log('   Using: ' + model + ' / ' + vramGB + 'GB / ' + tflops + ' TFLOPS / ' + region);
  } else {
    const hw = detectHardware();
    model = hw.gpuModel;
    vramGB = Math.floor(hw.vramGB);
    tflops = Math.floor(hw.tflops);
    region = hw.region;
  }
  if (model === 'CPU Only' && vramGB === 0) vramGB = 1;

  console.log('\n━━━ Step 2/3: Register Node ━━━');
  console.log(
    '   Model:  ' +
      model +
      '\n   VRAM:   ' +
      vramGB +
      ' GB\n   TFLOPS: ' +
      tflops +
      '\n   Region: ' +
      region,
  );
  try {
    const [pw] = await publicClient.readContract({
      address: ORACLE_ADDR,
      abi: ORACLE_ABI,
      functionName: 'getPrice',
      args: [model],
    });
    if (pw > 0n) console.log('   Price:  ' + formatEther(pw) + ' DGRAM/hr');
    else console.log('   ⚠️  No oracle price for "' + model + '"');
  } catch {}
  console.log('\n   Sending tx…');
  const rh = await walletClient.writeContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: 'registerNode',
    args: [model, vramGB, tflops, region],
    account,
    chain,
  });
  console.log('   Tx: ' + rh);
  const rr = await publicClient.waitForTransactionReceipt({ hash: rh });
  if (rr.status !== 'success') {
    console.log('   ❌ Register failed!');
    process.exit(1);
  }
  // Get newly registered node ID from getProviderNodes (last element)
  const myNodes = await publicClient.readContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: 'getProviderNodes',
    args: [account.address],
  });
  const nodeIdStr = myNodes[myNodes.length - 1].toString();
  console.log('   ✅ node-id:' + nodeIdStr + ' registered!');

  console.log('\n━━━ Step 3/3: Activate Node ━━━');
  const ah = await walletClient.writeContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: 'updateStatus',
    args: [BigInt(nodeIdStr), 1],
    account,
    chain,
  });
  console.log('   Tx: ' + ah);
  const ar = await publicClient.waitForTransactionReceipt({ hash: ah });
  if (ar.status === 'success') console.log('   ✅ node-id:' + nodeIdStr + ' is Active!');
  else {
    console.log('   ❌ Activate failed!');
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  ✅ NODE REGISTERED — awaiting attestation    ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Node ID:   ' + (nodeIdStr || 'unknown').slice(0, 33).padEnd(33) + '║');
  console.log('║  Model:     ' + model.slice(0, 33).padEnd(33) + '║');
  console.log('║  Status:    ' + 'Active'.padEnd(33) + '║');
  console.log('║  Verified:  ' + 'Not yet'.padEnd(33) + '║');
  console.log('║  Provider:  ' + shortAddr(account.address).padEnd(33) + '║');
  console.log('╚══════════════════════════════════════════════╝');
  printAttestationNotice(nodeIdStr);
  console.log('Next steps:');
  console.log('  Start compute agent:  cd ' + AGENT_DIR + ' && ./target/release/computerwa-agent');
  console.log('                        (or: sudo systemctl start botcompute-agent)');
  console.log(
    '  Publish agent URL:    node cli.js tunnel --port ' + (process.env.AGENT_PORT || 3006),
  );
  console.log('  Send heartbeat:       node cli.js heartbeat ' + (nodeIdStr || ''));
  console.log('  View node info:       node cli.js info ' + (nodeIdStr || '') + '\n');
}

async function cmdDetect() {
  const hw = detectHardware();
  console.log('═══════════════════════════════════════════');
  console.log('  Hardware Summary');
  console.log('═══════════════════════════════════════════');
  console.log('  GPU:  ' + hw.gpuModel + ' (' + hw.vramGB + ' GB, ~' + hw.tflops + ' TFLOPS)');
  console.log('  CPU:  ' + hw.cpuModel + ' (' + hw.cpuCores + ' cores)');
  console.log('  RAM:  ' + hw.ramGB + ' GB');
  console.log('  Disk: ' + hw.diskGB + ' GB');
  console.log('═══════════════════════════════════════════');
  console.log('\nOne command:  node cli.js setup');
}

async function cmdRegister(args) {
  const flags = parseArgs(args);
  const { walletClient, account } = getWallet();
  let model, vramGB, tflops, region;
  if (flags.model) {
    model = flags.model;
    vramGB = parseInt(flags.vram) || 0;
    tflops = parseInt(flags.tflops) || 0;
    region = flags.region || 'AUTO';
  } else {
    console.log('Auto-detecting…\n');
    const hw = detectHardware();
    model = hw.gpuModel;
    vramGB = Math.floor(hw.vramGB);
    tflops = Math.floor(hw.tflops);
    region = hw.region;
  }
  if (model === 'CPU Only' && vramGB === 0) vramGB = 1;
  console.log(
    '📝 Registering: ' + model + ' / ' + vramGB + 'GB / ' + tflops + ' TFLOPS / ' + region,
  );
  console.log('   Provider: ' + account.address + '\n');
  const hash = await walletClient.writeContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: 'registerNode',
    args: [model, vramGB, tflops, region],
    account,
    chain,
  });
  console.log('   Tx: ' + hash);
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status === 'success') {
    // Node IDs are keccak-derived uint64s, so nodeCount-1 is not one of them;
    // the provider's own list is the only reliable source for the new id.
    const mine = await publicClient.readContract({
      address: REGISTRY_ADDR,
      abi: REGISTRY_ABI,
      functionName: 'getProviderNodes',
      args: [account.address],
    });
    const id = mine.length ? mine[mine.length - 1].toString() : '<nodeId>';
    console.log('\n✅ node-id:' + id + ' registered!\n   Activate: node cli.js activate ' + id);
    printAttestationNotice(id);
  } else {
    console.log('\n❌ Failed!');
    process.exit(1);
  }
}

async function cmdActivate(args) {
  const id = args[0];
  if (!id) {
    console.error('Usage: node cli.js activate <nodeId>');
    process.exit(1);
  }
  const { walletClient, account } = getWallet();
  console.log('🟢 Activating node-id:' + id + '…');
  const h = await walletClient.writeContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: 'updateStatus',
    args: [BigInt(id), 1],
    account,
    chain,
  });
  const r = await publicClient.waitForTransactionReceipt({ hash: h });
  console.log(r.status === 'success' ? '✅ node-id:' + id + ' is Active' : '❌ Failed');
}

async function cmdDeactivate(args) {
  const id = args[0];
  if (!id) {
    console.error('Usage: node cli.js deactivate <nodeId>');
    process.exit(1);
  }
  const { walletClient, account } = getWallet();
  console.log('🔴 Deactivating node-id:' + id + '…');
  const h = await walletClient.writeContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: 'updateStatus',
    args: [BigInt(id), 0],
    account,
    chain,
  });
  const r = await publicClient.waitForTransactionReceipt({ hash: h });
  console.log(r.status === 'success' ? '✅ node-id:' + id + ' is Inactive' : '❌ Failed');
}

// Verifier-only. Providers reaching for this command are the expected case, so
// the failure path explains the permission model instead of dumping a revert.
async function cmdVerify(args) {
  const id = args[0];
  if (!id) {
    console.error('Usage: node cli.js verify <nodeId>   (registry verifier key required)');
    process.exit(1);
  }
  const { walletClient, account } = getWallet();
  console.log('✔️  Attesting node-id:' + id + '…');
  console.log('   Signer: ' + account.address);
  console.log('   Note:   ComputeRegistry.verifyNode is restricted to the registry verifier.\n');

  // writeContract sends without simulating, so an unauthorized caller would pay
  // gas just to be told no. Simulating first makes the rejection free.
  try {
    await publicClient.simulateContract({
      address: REGISTRY_ADDR,
      abi: REGISTRY_ABI,
      functionName: 'verifyNode',
      args: [BigInt(id)],
      account,
    });
  } catch (e) {
    console.log('❌ Rejected — no transaction sent, no gas spent.');
    console.log('   Reason: ' + (e.shortMessage || e.message?.slice(0, 200) || e));
    console.log('\n   This wallet is not the registry verifier.');
    console.log('   Providers: your node stays Active; retrying will not change that —');
    console.log('   ask the registry verifier to attest it. Check state: node cli.js info ' + id);
    process.exitCode = 1;
    return;
  }

  try {
    const h = await walletClient.writeContract({
      address: REGISTRY_ADDR,
      abi: REGISTRY_ABI,
      functionName: 'verifyNode',
      args: [BigInt(id)],
      account,
      chain,
    });
    console.log('   Tx: ' + h);
    const r = await publicClient.waitForTransactionReceipt({ hash: h });
    if (r.status === 'success') {
      console.log('✅ node-id:' + id + ' verified');
      return;
    }
    console.log('❌ Verification tx reverted on-chain.');
  } catch (e) {
    console.log('❌ Verification failed: ' + (e.shortMessage || e.message?.slice(0, 200) || e));
  }
  process.exitCode = 1;
}

async function cmdHeartbeat(args) {
  const id = args[0];
  if (!id) {
    console.error('Usage: node cli.js heartbeat <nodeId>');
    process.exit(1);
  }
  const { walletClient, account } = getWallet();
  console.log('💓 Heartbeat node-id:' + id + '…');
  const h = await walletClient.writeContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: 'heartbeat',
    args: [BigInt(id)],
    account,
    chain,
  });
  const r = await publicClient.waitForTransactionReceipt({ hash: h });
  console.log(r.status === 'success' ? '✅ Heartbeat sent for node-id:' + id : '❌ Failed');
}

async function cmdList() {
  const nc = await publicClient.readContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: 'nodeCount',
  });
  const ta = await publicClient.readContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: 'totalActiveNodes',
  });
  console.log('\n📊 Network Stats\n');
  console.log('  Total nodes:  ' + Number(nc));
  console.log('  Active nodes: ' + Number(ta));
  console.log('\n  Use "node cli.js mine" to see your nodes.');
  console.log('  Use "node cli.js info <nodeId>" for node details.\n');
}

async function cmdMine() {
  const { account } = getWallet();
  const ids = await publicClient.readContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: 'getProviderNodes',
    args: [account.address],
  });
  if (ids.length === 0) {
    console.log('\n📭 No nodes. Run: node cli.js setup\n');
    return;
  }
  console.log('\n📋 Your Nodes (' + ids.length + ')\n');
  for (const id of ids) await printNode(id.toString());
}

async function cmdInfo(args) {
  const id = args[0];
  if (!id) {
    console.error('Usage: node cli.js info <nodeId>');
    process.exit(1);
  }
  await printNode(id.toString());
}

async function printNode(nodeId) {
  const nodeIdStr = String(nodeId);
  try {
    const n = await publicClient.readContract({
      address: REGISTRY_ADDR,
      abi: REGISTRY_ABI,
      functionName: 'getNode',
      args: [BigInt(nodeId)],
    });
    console.log('┌─ node-id:' + nodeId + ' ' + '─'.repeat(25));
    console.log('│ Provider:  ' + n.provider);
    console.log('│ Model:     ' + n.specs.model);
    console.log('│ VRAM:      ' + Number(n.specs.vramGB) + ' GB');
    console.log('│ TFLOPS:    ' + Number(n.specs.tflops));
    console.log('│ Region:    ' + n.specs.region);
    console.log('│ Status:    ' + STATUS_NAMES[Number(n.status)]);
    console.log('│ Verified:  ' + (n.verified ? '✅ attested' : '⏳ awaiting verifier'));
    console.log('│ Revenue:   ' + formatEther(n.totalRevenue) + ' DGRAM');
    console.log('│ Registered: ' + new Date(Number(n.registeredAt) * 1000).toLocaleString());
    console.log('│ Heartbeat: ' + timeAgo(n.lastHeartbeat));
    console.log('└' + '─'.repeat(40) + '\n');
    if (!n.verified)
      console.log(
        '   ⏳ Awaiting attestation by the registry verifier (verifier runs: node cli.js verify ' +
          nodeId +
          ')',
      );
    if (Number(n.status) === 0) console.log('   ⚠️  Activate: node cli.js activate ' + nodeId);
    console.log('');
  } catch (e) {
    console.log(
      '❌ Error reading node-id:' +
        nodeIdStr +
        ': ' +
        (e.shortMessage || e.message?.slice(0, 120) || e),
    );
  }
}

async function cmdBalance() {
  const { account } = getWallet();
  const rev = await publicClient.readContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: 'getProviderRevenue',
    args: [account.address],
  });
  const bal = await publicClient.getBalance({ address: account.address });
  console.log('\n💰 Provider: ' + account.address);
  console.log('   Revenue:  ' + formatEther(rev) + ' DGRAM');
  console.log('   Balance:  ' + formatEther(bal) + ' DGRAM\n');
}

// ── cloudflared tunnel: auto-create tunnel + register URL on-chain ──
async function cmdTunnel(args) {
  const flags = parseArgs(args);
  const port = flags.port || 3006;
  const { walletClient, account } = getWallet();

  console.log('🌐 Starting Cloudflare Tunnel…\n');
  console.log('   Provider: ' + account.address);
  console.log('   Local port: ' + port);
  console.log('');

  const { spawn } = await import('child_process');
  const child = spawn(
    'cloudflared',
    ['tunnel', '--url', 'http://localhost:' + port, '--protocol', 'http2'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let tunnelUrl = null;
  const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
  let stderrBuf = '';
  let resolved = false;

  return new Promise((resolve) => {
    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderrBuf += text;
      const match = text.match(urlRegex);
      if (match && !tunnelUrl) tunnelUrl = match[0];
      if (!tunnelUrl) {
        const bufMatch = stderrBuf.match(urlRegex);
        if (bufMatch) tunnelUrl = bufMatch[0];
      }

      if (tunnelUrl && !resolved) {
        resolved = true;
        setTimeout(async () => {
          console.log('   ✅ Tunnel URL: ' + tunnelUrl);
          console.log('\n📝 Registering agent URL on-chain…');
          try {
            const hash = await walletClient.writeContract({
              address: AGENT_REGISTRY_ADDR,
              abi: AGENT_REGISTRY_ABI,
              functionName: 'setAgentUrl',
              args: [tunnelUrl],
              account,
              chain,
            });
            console.log('   Tx: ' + hash);
            const rc = await publicClient.waitForTransactionReceipt({ hash });
            if (rc.status === 'success') console.log('   ✅ Agent URL registered on-chain!');
            else console.log('   ❌ Registration tx failed');
          } catch (err) {
            console.log(
              '   ❌ Register failed: ' + (err.shortMessage || err.message?.slice(0, 120)),
            );
            console.log('   Register manually: node cli.js set-agent-url ' + tunnelUrl);
          }

          console.log('\n╔══════════════════════════════════════════════╗');
          console.log('║  ✅ TUNNEL ACTIVE — agent reachable!          ║');
          console.log('╠══════════════════════════════════════════════╣');
          console.log('║  URL: ' + tunnelUrl.slice(0, 38).padEnd(38) + '║');
          console.log('║  Local: ' + ('http://localhost:' + port).slice(0, 38).padEnd(38) + '║');
          console.log('║  Provider: ' + shortAddr(account.address).padEnd(38) + '║');
          console.log('╚══════════════════════════════════════════════╝');
          console.log('\n   Tunnel running in foreground. Ctrl+C to stop.');
          console.log('   Frontend auto-discovers URL from chain.\n');
          resolve();
        }, 3000);
      }
    });

    child.on('error', (err) => {
      console.log('❌ Failed to start cloudflared: ' + err.message);
      console.log('   Install: sudo apt install cloudflared');
      resolve();
    });

    setTimeout(() => {
      if (!tunnelUrl && !resolved) {
        console.log('❌ No tunnel URL after 30s.');
        console.log('   stderr: ' + stderrBuf.slice(-200));
        child.kill();
        resolve();
      }
    }, 30000);
  });
}

async function cmdSetAgentUrl(args) {
  const url = args[0];
  if (!url) {
    console.error('Usage: node cli.js set-agent-url <https://...>');
    process.exit(1);
  }
  const { walletClient, account } = getWallet();
  console.log('📝 Setting agent URL: ' + url);
  console.log('   Provider: ' + account.address);
  const hash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDR,
    abi: AGENT_REGISTRY_ABI,
    functionName: 'setAgentUrl',
    args: [url],
    account,
    chain,
  });
  console.log('   Tx: ' + hash);
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  console.log(rc.status === 'success' ? '✅ Agent URL set!' : '❌ Failed');
}

async function cmdStatus() {
  console.log('\n🌐 ' + chain.name + ' (Chain ID ' + chain.id + ')');
  console.log('   RPC: ' + RPC_URL + '\n');
  const nc = await publicClient.readContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: 'nodeCount',
  });
  const ta = await publicClient.readContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: 'totalActiveNodes',
  });
  console.log('📊 Registry: ' + REGISTRY_ADDR);
  console.log('   Total: ' + Number(nc) + ' | Active: ' + Number(ta));
  if (PRIVATE_KEY) {
    const { account } = getWallet();
    const bal = await publicClient.getBalance({ address: account.address });
    console.log('\n👤 ' + account.address);
    console.log('   Balance: ' + formatEther(bal) + ' DGRAM');
  }
  console.log('');
}

// ── Main ───────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  setup: cmdSetup,
  detect: cmdDetect,
  register: cmdRegister,
  activate: cmdActivate,
  deactivate: cmdDeactivate,
  verify: cmdVerify,
  heartbeat: cmdHeartbeat,
  list: cmdList,
  mine: cmdMine,
  info: cmdInfo,
  balance: cmdBalance,
  status: cmdStatus,
  tunnel: cmdTunnel,
  'set-agent-url': cmdSetAgentUrl,
};

if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  ComputeRWA Provider CLI v1.0.0              ║');
  console.log('║  BOT Chain DePIN — Node Management           ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Network: ' + chain.name.padEnd(35) + '║');
  console.log('╚══════════════════════════════════════════════╝\n');
  console.log('Commands:');
  console.log('  setup                     One-command: detect → register → activate');
  console.log('  detect                    Detect hardware (GPU/CPU/RAM)');
  console.log('  register                  Register node (auto-detect or --flags)');
  console.log('  activate <id>             Set node to Active');
  console.log('  deactivate <id>           Set node to Inactive');
  console.log('  verify <id>               Attest a node — registry verifier key only');
  console.log('  heartbeat <id>            Send heartbeat');
  console.log('  list                      List all nodes');
  console.log('  mine                      List your nodes');
  console.log('  info <id>                 Node details');
  console.log('  balance                   Revenue + wallet balance');
  console.log('  status                    Network + contract status');
  console.log('  tunnel                    Start cloudflared tunnel + register URL on-chain');
  console.log('  set-agent-url <url>       Manually set agent URL on-chain\n');
  console.log('Examples:');
  console.log('  node cli.js setup');
  console.log('  node cli.js setup --model "NVIDIA RTX 3060" --vram 12 --tflops 13 --region SG');
  console.log('  node cli.js list\n');
} else if (commands[cmd]) {
  commands[cmd](rest).catch((err) => {
    console.error('\n❌ ' + (err.shortMessage || err.message?.slice(0, 200) || err));
    process.exit(1);
  });
} else {
  console.error('Unknown: ' + cmd + '\nRun "node cli.js" for help.');
  process.exit(1);
}
