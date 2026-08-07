/**
 * ComputeRWA Provider Agent
 * 
 * Runs on provider's machine. Monitors blockchain for jobs,
 * accepts them, and executes compute workloads from consumers.
 * 
 * Flow:
 * 1. Provider starts agent → registers agent URL
 * 2. Agent polls blockchain for pending jobs on their nodes
 * 3. Auto-accepts jobs (or manual mode)
 * 4. Consumer sends code via HTTP → agent executes → returns result
 * 5. Agent marks job complete on-chain when done
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ─────────────────────────────────────────────
const PORT = process.env.AGENT_PORT || 3006;
const PROVIDER_KEY = process.env.PROVIDER_PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL || 'https://rpc.bohr.life';
const CHAIN_ID = Number(process.env.CHAIN_ID || 968);

const REGISTRY_ADDR = process.env.REGISTRY_ADDR || '0xc612111b8648B73ED23CF19f400488566af76Ddc';
const MARKETPLACE_ADDR = process.env.MARKETPLACE_ADDR || '0x7278045051843BbdD7786B493de0681904075f02';

// Chain config
const chain = {
  id: CHAIN_ID,
  name: 'BOT Chain Testnet',
  nativeCurrency: { name: 'DGRAM', symbol: 'DGRAM', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

// ABIs (minimal)
const REGISTRY_ABI = [
  {
    name: 'getProviderNodes',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [{ name: 'nodeIds', type: 'uint256[]' }],
  },
  {
    name: 'getNode',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'nodeId', type: 'uint256' }],
    outputs: [
      {
        name: 'node',
        type: 'tuple',
        components: [
          { name: 'provider', type: 'address' },
          { name: 'specs', type: 'tuple', components: [
            { name: 'model', type: 'string' },
            { name: 'vramGB', type: 'uint16' },
            { name: 'tflops', type: 'uint16' },
            { name: 'region', type: 'string' },
          ]},
          { name: 'status', type: 'uint8' },
          { name: 'totalRevenue', type: 'uint96' },
          { name: 'registeredAt', type: 'uint64' },
          { name: 'lastHeartbeat', type: 'uint64' },
          { name: 'verified', type: 'bool' },
        ],
      },
    ],
  },
];

const MARKETPLACE_ABI = [
  {
    name: 'acceptJob',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'completeJob',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getJob',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [
      {
        name: 'job',
        type: 'tuple',
        components: [
          { name: 'nodeId', type: 'uint256' },
          { name: 'consumer', type: 'address' },
          { name: 'provider', type: 'address' },
          { name: 'jobType', type: 'string' },
          { name: 'specHash', type: 'string' },
          { name: 'pricePerHourWei', type: 'uint256' },
          { name: 'durationHours', type: 'uint64' },
          { name: 'startedAt', type: 'uint64' },
          { name: 'completedAt', type: 'uint64' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
  },
  {
    name: 'nextJobId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

// ── Clients ────────────────────────────────────────────
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

let walletClient = null;
let providerAddress = null;
if (PROVIDER_KEY) {
  const account = privateKeyToAccount(PROVIDER_KEY.startsWith('0x') ? PROVIDER_KEY : `0x${PROVIDER_KEY}`);
  walletClient = createWalletClient({
    chain,
    transport: http(RPC_URL),
    account,
  });
  providerAddress = account.address;
}

// ── Job Storage ────────────────────────────────────────
const activeSessions = new Map(); // jobId → { code, output, status, startedAt }

// ── Express App ────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    provider: providerAddress || 'not configured',
    agent: 'ComputeRWA Provider Agent',
    version: '1.0.0',
    nodes: providerAddress ? 'monitoring' : 'no wallet',
  });
});

// Agent info (consumer discovers provider capabilities)
app.get('/info', async (req, res) => {
  try {
    let nodeInfo = null;
    if (providerAddress) {
      const nodeIds = await publicClient.readContract({
        address: REGISTRY_ADDR,
        abi: REGISTRY_ABI,
        functionName: 'getProviderNodes',
        args: [providerAddress],
      });
      if (nodeIds && nodeIds.length > 0) {
        const node = await publicClient.readContract({
          address: REGISTRY_ADDR,
          abi: REGISTRY_ABI,
          functionName: 'getNode',
          args: [nodeIds[0]],
        });
        nodeInfo = {
          nodeId: Number(nodeIds[0]),
          model: node.specs.model,
          vramGB: Number(node.specs.vramGB),
          tflops: Number(node.specs.tflops),
          region: node.specs.region,
          verified: node.verified,
          status: Number(node.status),
        };
      }
    }
    res.json({
      provider: providerAddress,
      node: nodeInfo,
      runtime: ['python3', 'node'],
      maxDuration: 300, // 5 min max per execution
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Execute Code ───────────────────────────────────────
/**
 * Consumer POSTs code to be executed on provider's machine.
 * Body: { jobId, language, code, args }
 * Returns: { executionId, status, output, exitCode, duration }
 */
app.post('/execute', async (req, res) => {
  const { jobId, language = 'python3', code, args = [] } = req.body;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Code is required' });
  }

  // Verify job is active (optional on-chain check)
  let jobValid = true;
  if (jobId && providerAddress) {
    try {
      const job = await publicClient.readContract({
        address: MARKETPLACE_ADDR,
        abi: MARKETPLACE_ABI,
        functionName: 'getJob',
        args: [BigInt(jobId)],
      });
      // Status 1 = Active
      if (Number(job.status) !== 1) {
        return res.status(403).json({ error: `Job #${jobId} is not active (status: ${job.status})` });
      }
      // Verify provider matches
      if (job.provider.toLowerCase() !== providerAddress.toLowerCase()) {
        return res.status(403).json({ error: 'Job does not belong to this provider' });
      }
    } catch (err) {
      console.warn('[Agent] Job verification failed, proceeding anyway:', err.message);
    }
  }

  const executionId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();
  const workDir = join(__dirname, 'workspace', executionId);
  mkdirSync(workDir, { recursive: true });

  console.log(`[Agent] Execution ${executionId} started — language: ${language}, jobId: ${jobId || 'none'}`);

  // Write code to file — use .cjs for Node to avoid ESM conflicts with agent's package.json
  const ext = language === 'python3' ? 'py' : 'cjs';
  const codeFile = join(workDir, `main.${ext}`);
  writeFileSync(codeFile, code);

  // Execute in subprocess — node resolves .cjs as CommonJS automatically
  const cmd = language === 'python3' ? 'python3' : 'node';
  const child = spawn(cmd, [codeFile, ...args], {
    cwd: workDir,
    timeout: 300_000, // 5 min max
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => {
    stdout += data.toString();
  });
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('close', (exitCode) => {
    const duration = Date.now() - startTime;
    console.log(`[Agent] Execution ${executionId} finished — exit: ${exitCode}, ${duration}ms`);

    // Cleanup workspace
    try {
      // rmSync(workDir, { recursive: true, force: true }); // disabled for debug
    } catch {}

    // Store in active sessions
    const result = {
      executionId,
      exitCode,
      stdout,
      stderr,
      duration,
      finishedAt: new Date().toISOString(),
    };

    if (jobId) {
      const session = activeSessions.get(jobId) || { executions: [] };
      session.executions.push(result);
      activeSessions.set(jobId, session);
    }
  });

  // Return immediately with execution ID for async streaming
  // For hackathon simplicity, we wait for completion
  child.on('close', () => {
    const duration = Date.now() - startTime;
    res.json({
      executionId,
      status: 'completed',
      exitCode: child.exitCode,
      stdout,
      stderr,
      duration,
    });
  });

  child.on('error', (err) => {
    console.error(`[Agent] Execution ${executionId} error:`, err);
    res.status(500).json({
      executionId,
      status: 'error',
      error: err.message,
    });
    // cleanup disabled for debug
  });
});

// ── Get Execution History ──────────────────────────────
app.get('/sessions/:jobId', (req, res) => {
  const { jobId } = req.params;
  const session = activeSessions.get(jobId);
  if (!session) {
    return res.json({ jobId, executions: [] });
  }
  res.json({ jobId, ...session });
});

// ── List Active Jobs (from blockchain) ─────────────────
app.get('/jobs', async (req, res) => {
  if (!providerAddress) {
    return res.json({ jobs: [] });
  }
  try {
    const nextId = await publicClient.readContract({
      address: MARKETPLACE_ADDR,
      abi: MARKETPLACE_ABI,
      functionName: 'nextJobId',
    });
    const jobs = [];
    for (let i = 1; i < Number(nextId); i++) {
      try {
        const job = await publicClient.readContract({
          address: MARKETPLACE_ADDR,
          abi: MARKETPLACE_ABI,
          functionName: 'getJob',
          args: [BigInt(i)],
        });
        if (job.provider.toLowerCase() === providerAddress.toLowerCase()) {
          jobs.push({
            jobId: i,
            nodeId: Number(job.nodeId),
            consumer: job.consumer,
            jobType: job.jobType,
            status: ['Pending', 'Active', 'Completed', 'Cancelled', 'Disputed'][Number(job.status)],
            durationHours: Number(job.durationHours),
            startedAt: Number(job.startedAt),
            pricePerHourWei: job.pricePerHourWei.toString(),
          });
        }
      } catch {}
    }
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Accept Job (on-chain) ──────────────────────────────
app.post('/jobs/:jobId/accept', async (req, res) => {
  if (!walletClient) {
    return res.status(400).json({ error: 'Provider wallet not configured' });
  }
  try {
    const hash = await walletClient.writeContract({
      address: MARKETPLACE_ADDR,
      abi: MARKETPLACE_ABI,
      functionName: 'acceptJob',
      args: [BigInt(req.params.jobId)],
      account: walletClient.account,
      chain,
    });
    res.json({ txHash: hash, status: 'accepted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Complete Job (on-chain) ────────────────────────────
app.post('/jobs/:jobId/complete', async (req, res) => {
  if (!walletClient) {
    return res.status(400).json({ error: 'Provider wallet not configured' });
  }
  try {
    const hash = await walletClient.writeContract({
      address: MARKETPLACE_ADDR,
      abi: MARKETPLACE_ABI,
      functionName: 'completeJob',
      args: [BigInt(req.params.jobId)],
      account: walletClient.account,
      chain,
    });
    res.json({ txHash: hash, status: 'completed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start Server ───────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  ComputeRWA Provider Agent — v1.0.0          ║`);
  console.log(`╠══════════════════════════════════════════════╣`);
  console.log(`║  Port:     ${PORT.toString().padEnd(33)}║`);
  console.log(`║  RPC:      ${RPC_URL.slice(0, 33).padEnd(33)}║`);
  console.log(`║  Chain:    ${('ID ' + CHAIN_ID).padEnd(33)}║`);
  console.log(`║  Provider: ${(providerAddress || 'NOT SET').slice(0, 33).padEnd(33)}║`);
  console.log(`╚══════════════════════════════════════════════╝`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /health          — Agent status`);
  console.log(`  GET  /info            — Provider node info`);
  console.log(`  GET  /jobs            — List provider jobs`);
  console.log(`  POST /jobs/:id/accept — Accept pending job`);
  console.log(`  POST /jobs/:id/complete — Complete job on-chain`);
  console.log(`  POST /execute         — Execute code (consumer→provider)`);
  console.log(`  GET  /sessions/:jobId — Execution history`);
  console.log(`\n${providerAddress ? '✅ Wallet connected' : '⚠️  No wallet — set PROVIDER_PRIVATE_KEY'}\n`);
});
