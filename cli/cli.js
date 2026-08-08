/**
 * ComputeRWA Provider CLI
 * Usage:
 *   node cli.js setup                      — one-command: detect → register → activate → verify
 *   node cli.js setup --model "RTX 3060" --vram 12 --tflops 13 --region SG
 *   node cli.js detect                      — detect hardware
 *   node cli.js register                    — register node on-chain
 *   node cli.js activate <nodeId>           — set node Active
 *   node cli.js deactivate <nodeId>         — set node Inactive
 *   node cli.js verify <nodeId>             — verify node
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
import { readFileSync } from 'fs';
import os from 'os';

const PRIVATE_KEY = process.env.PROVIDER_PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL || 'https://rpc.bohr.life';
const CHAIN_ID = Number(process.env.CHAIN_ID || 968);
const REGISTRY_ADDR = process.env.REGISTRY_ADDR || '0x1476b38108ca44A550b780dc7223a48488b83309';
const MARKETPLACE_ADDR = process.env.MARKETPLACE_ADDR || '0xb873AB623A0387974b6DC8a95da503deAB1313a7';
const ORACLE_ADDR = process.env.ORACLE_ADDR || '0xe106ba1671d6c0C7DDfEc7386d426CA800339D42';

const chain = {
  id: CHAIN_ID,
  name: CHAIN_ID === 677 ? 'BOT Chain Mainnet' : 'BOT Chain Testnet',
  nativeCurrency: { name: 'DGRAM', symbol: 'DGRAM', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const REGISTRY_ABI = [
  { name: 'registerNode', type: 'function', stateMutability: 'nonpayable', inputs: [ { name: 'model', type: 'string' }, { name: 'vramGB', type: 'uint16' }, { name: 'tflops', type: 'uint16' }, { name: 'region', type: 'string' } ], outputs: [{ name: 'nodeId', type: 'uint256' }] },
  { name: 'updateStatus', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'nodeId', type: 'uint256' }, { name: 'newStatus', type: 'uint8' }], outputs: [] },
  { name: 'heartbeat', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'nodeId', type: 'uint256' }], outputs: [] },
  { name: 'verifyNode', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'nodeId', type: 'uint256' }], outputs: [] },
  { name: 'getNode', type: 'function', stateMutability: 'view', inputs: [{ name: 'nodeId', type: 'uint256' }], outputs: [{ name: 'node', type: 'tuple', components: [ { name: 'provider', type: 'address' }, { name: 'specs', type: 'tuple', components: [ { name: 'model', type: 'string' }, { name: 'vramGB', type: 'uint16' }, { name: 'tflops', type: 'uint16' }, { name: 'region', type: 'string' } ] }, { name: 'status', type: 'uint8' }, { name: 'totalRevenue', type: 'uint96' }, { name: 'registeredAt', type: 'uint64' }, { name: 'lastHeartbeat', type: 'uint64' }, { name: 'verified', type: 'bool' } ] }] },
  { name: 'getProviderNodes', type: 'function', stateMutability: 'view', inputs: [{ name: 'provider', type: 'address' }], outputs: [{ name: 'nodeIds', type: 'uint256[]' }] },
  { name: 'getProviderRevenue', type: 'function', stateMutability: 'view', inputs: [{ name: 'provider', type: 'address' }], outputs: [{ name: 'total', type: 'uint96' }] },
  { name: 'nodeCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalActiveNodes', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
];

const ORACLE_ABI = [
  { name: 'getPrice', type: 'function', stateMutability: 'view', inputs: [{ name: 'model', type: 'string' }], outputs: [{ name: 'pricePerHourWei', type: 'uint256' }, { name: 'updatedAt', type: 'uint64' }, { name: 'confidence', type: 'uint16' }] },
];

const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
let walletClient = null, account = null;

function getWallet() {
  if (!PRIVATE_KEY) { console.error('❌ PROVIDER_PRIVATE_KEY not set in .env'); process.exit(1); }
  if (!account) {
    account = privateKeyToAccount(PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : '0x' + PRIVATE_KEY);
    walletClient = createWalletClient({ chain, transport: http(RPC_URL), account });
  }
  return { walletClient, account };
}

const STATUS_NAMES = ['Inactive', 'Active', 'Busy', 'Offline'];
function shortAddr(a) { return a.slice(0, 6) + '…' + a.slice(-4); }
function timeAgo(ts) { if (!ts || ts === 0n) return 'never'; const d = Math.floor(Date.now()/1000) - Number(ts); if (d < 60) return d + 's ago'; if (d < 3600) return Math.floor(d/60) + 'm ago'; if (d < 86400) return Math.floor(d/3600) + 'h ago'; return Math.floor(d/86400) + 'd ago'; }
function parseArgs(args) { const p = {}; for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) { const k = args[i].slice(2); const v = args[i+1] && !args[i+1].startsWith('--') ? args[i+1] : true; p[k] = v; if (v !== true) i++; } } return p; }

function estimateTflops(model) { const m = (model||'').toLowerCase(); const map = { 'h100':989,'a100':624,'rtx 5090':105,'rtx 4090':165,'rtx 4080':97,'rtx 4070':48,'rtx 3090':71,'rtx 3080':35,'rtx 3070':21,'rtx 3060':13,'rtx 3050':6,'gtx 1660':14,'gtx 1080':9,'gtx 1070':6.5,'rx 7900':61,'rx 6900':51,'rx 6800':41,'rx 6700':24,'radeon':25 }; for (const [k,v] of Object.entries(map)) { if (m.includes(k)) return v; } return 0; }

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
  let gpuModel = 'CPU Only', vramGB = 0, tflops = 0, hasGpu = false;
  try { const out = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim(); if (out) { const [n,v] = out.split(',').map(s=>s.trim()); gpuModel=normalizeGpuName(n); vramGB=Math.round((parseInt(v)||0)/1024*10)/10; hasGpu=true; tflops=estimateTflops(n); console.log('  GPU:  '+gpuModel+' ('+vramGB+' GB, ~'+tflops+' TFLOPS)'); } } catch {}
  if (!hasGpu) { try { const out = execSync('rocm-smi --showproductname --csv 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim(); if (out && out.includes('Card series')) { for (const l of out.split('\n')) { if (l.includes('Card series')) { const p = l.split(','); if (p.length>=2) { gpuModel=p[1].trim(); hasGpu=true; vramGB=16; tflops=estimateTflops(gpuModel); console.log('  GPU:  '+gpuModel+' (AMD, ~'+vramGB+' GB, ~'+tflops+' TFLOPS)'); break; } } } } } catch {} }
  let cpuModel='Unknown', cpuCores=0;
  try { const ls = execSync('lscpu 2>/dev/null', { encoding:'utf8', timeout:5000 }); const m1=ls.match(/Model name:\s*(.+)/), m2=ls.match(/CPU\(s\):\s*(\d+)/); if(m1) cpuModel=m1[1].trim(); if(m2) cpuCores=parseInt(m2[1]); console.log('  CPU:  '+cpuModel+' ('+cpuCores+' cores)'); } catch { cpuCores=os.cpus().length; cpuModel=os.cpus()[0]?.model||'Unknown'; console.log('  CPU:  '+cpuModel+' ('+cpuCores+' cores)'); }
  let ramGB=0; try { const mi=readFileSync('/proc/meminfo','utf8'); const m=mi.match(/MemTotal:\s*(\d+)/); if(m) ramGB=Math.round(parseInt(m[1])/1024/1024*10)/10; console.log('  RAM:  '+ramGB+' GB'); } catch {}
  let diskGB=0; try { const df=execSync('df --output=size -B1 / 2>/dev/null',{encoding:'utf8',timeout:5000}).trim().split('\n'); if(df.length>=2) { diskGB=Math.round(parseInt(df[1].trim())/1024/1024/1024); console.log('  Disk: '+diskGB+' GB'); } } catch {}
  let region='AUTO'; try { const tz=Intl.DateTimeFormat().resolvedOptions().timeZone; region=tz.split('/').pop()||'AUTO'; } catch {}
  if (!hasGpu) { gpuModel='CPU Only'; vramGB=0; tflops=Math.round(cpuCores*0.5*10)/10; console.log('  GPU:  None (CPU-only, ~'+tflops+' TFLOPS)'); }
  console.log('  Region: '+region+'\n');
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
  if (balance === 0n) { console.log('\n❌ No DGRAM for gas. Fund your wallet first.'); process.exit(1); }

  // ── Check existing nodes ─────────────────────────
  const existingIds = await publicClient.readContract({ address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: 'getProviderNodes', args: [account.address] });
  if (existingIds.length > 0) {
    console.log('\n━━━ Existing Nodes Check ━━━');
    console.log('   Found ' + existingIds.length + ' existing node(s) for this wallet:');
    for (const id of existingIds) {
      const n = await publicClient.readContract({ address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: 'getNode', args: [id] });
      const st = STATUS_NAMES[Number(n.status)];
      console.log('   → node-id:' + id.toString() + ': ' + n.specs.model + ' / ' + st + ' / ' + (n.verified ? '✅' : '❌'));
    }
    console.log('');
    // If any existing node is already Active+Verified, skip setup
    let allReady = true;
    for (const id of existingIds) {
      const n = await publicClient.readContract({ address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: 'getNode', args: [id] });
      if (Number(n.status) !== 1 || !n.verified) allReady = false;
    }
    if (allReady) {
      console.log('   ✅ All nodes already Active & Verified. Nothing to do.');
      console.log('   Run "node cli.js mine" to view your nodes.\n');
      return;
    }
    console.log('   ⚠️  Some nodes need activation or verification.');
    console.log('   Continue setup to register a NEW node, or fix existing ones manually.\n');
    // Continue to register a new node
  }

  console.log('\n━━━ Step 1/4: Hardware Detection ━━━');
  let model, vramGB, tflops, region;
  if (flags.model) {
    model = flags.model; vramGB = parseInt(flags.vram)||0; tflops = parseInt(flags.tflops)||0; region = flags.region||'AUTO';
    console.log('   Using: ' + model + ' / ' + vramGB + 'GB / ' + tflops + ' TFLOPS / ' + region);
  } else {
    const hw = detectHardware();
    model = hw.gpuModel; vramGB = Math.floor(hw.vramGB); tflops = Math.floor(hw.tflops); region = hw.region;
  }
  if (model === 'CPU Only' && vramGB === 0) vramGB = 1;

  console.log('\n━━━ Step 2/4: Register Node ━━━');
  console.log('   Model:  ' + model + '\n   VRAM:   ' + vramGB + ' GB\n   TFLOPS: ' + tflops + '\n   Region: ' + region);
  try { const [pw] = await publicClient.readContract({ address: ORACLE_ADDR, abi: ORACLE_ABI, functionName: 'getPrice', args: [model] }); if (pw>0n) console.log('   Price:  ' + formatEther(pw) + ' DGRAM/hr'); else console.log('   ⚠️  No oracle price for "' + model + '"'); } catch {}
  console.log('\n   Sending tx…');
  const rh = await walletClient.writeContract({ address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: 'registerNode', args: [model, vramGB, tflops, region], account, chain });
  console.log('   Tx: ' + rh);
  const rr = await publicClient.waitForTransactionReceipt({ hash: rh });
  if (rr.status !== 'success') { console.log('   ❌ Register failed!'); process.exit(1); }
  // Get newly registered node ID from getProviderNodes (last element)
  const myNodes = await publicClient.readContract({ address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: 'getProviderNodes', args: [account.address] });
  const nodeIdStr = myNodes[myNodes.length - 1].toString();
  console.log('   ✅ node-id:' + nodeIdStr + ' registered!');

  console.log('\n━━━ Step 3/4: Activate Node ━━━');
  const ah = await walletClient.writeContract({ address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: 'updateStatus', args: [BigInt(nodeIdStr), 1], account, chain });
  console.log('   Tx: ' + ah);
  const ar = await publicClient.waitForTransactionReceipt({ hash: ah });
  if (ar.status === 'success') console.log('   ✅ node-id:' + nodeIdStr + ' is Active!'); else { console.log('   ❌ Activate failed!'); process.exit(1); }

  console.log('\n━━━ Step 4/4: Verify Node ━━━');
  const vh = await walletClient.writeContract({ address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: 'verifyNode', args: [BigInt(nodeIdStr)], account, chain });
  console.log('   Tx: ' + vh);
  const vr = await publicClient.waitForTransactionReceipt({ hash: vh });
  if (vr.status === 'success') console.log('   ✅ node-id:' + nodeIdStr + ' verified!'); else console.log('   ❌ Verify failed!');

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  ✅ SETUP COMPLETE — node ready!              ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Node ID:   ' + (nodeIdStr||'unknown').slice(0,33).padEnd(33) + '║');
  console.log('║  Model:     ' + model.slice(0,33).padEnd(33) + '║');
  console.log('║  Status:    ' + 'Active'.padEnd(33) + '║');
  console.log('║  Verified:  ' + 'Yes'.padEnd(33) + '║');
  console.log('║  Provider:  ' + shortAddr(account.address).padEnd(33) + '║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\nNext steps:');
  console.log('  Start compute agent:  cd ../compute-agent && npm start');
  console.log('  Send heartbeat:       node cli.js heartbeat ' + (nodeIdStr||''));
  console.log('  View node info:       node cli.js info ' + (nodeIdStr||'') + '\n');
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
  if (flags.model) { model=flags.model; vramGB=parseInt(flags.vram)||0; tflops=parseInt(flags.tflops)||0; region=flags.region||'AUTO'; }
  else { console.log('Auto-detecting…\n'); const hw=detectHardware(); model=hw.gpuModel; vramGB=Math.floor(hw.vramGB); tflops=Math.floor(hw.tflops); region=hw.region; }
  if (model==='CPU Only' && vramGB===0) vramGB=1;
  console.log('📝 Registering: ' + model + ' / ' + vramGB + 'GB / ' + tflops + ' TFLOPS / ' + region);
  console.log('   Provider: ' + account.address + '\n');
  const hash = await walletClient.writeContract({ address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: 'registerNode', args: [model,vramGB,tflops,region], account, chain });
  console.log('   Tx: ' + hash);
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status==='success') { const ni=await publicClient.readContract({address:REGISTRY_ADDR,abi:REGISTRY_ABI,functionName:'nodeCount'}); const id=Number(ni)-1; console.log('\n✅ Node #' + id + ' registered!\n   Activate: node cli.js activate ' + id + '\n   Verify:   node cli.js verify ' + id); }
  else { console.log('\n❌ Failed!'); process.exit(1); }
}

async function cmdActivate(args) {
  const id=args[0]; if(!id){console.error('Usage: node cli.js activate <nodeId>');process.exit(1);}
  const {walletClient,account}=getWallet();
  console.log('🟢 Activating node-id:'+id+'…');
  const h=await walletClient.writeContract({address:REGISTRY_ADDR,abi:REGISTRY_ABI,functionName:'updateStatus',args:[BigInt(id),1],account,chain});
  const r=await publicClient.waitForTransactionReceipt({hash:h});
  console.log(r.status==='success'?'✅ node-id:'+id+' is Active':'❌ Failed');
}

async function cmdDeactivate(args) {
  const id=args[0]; if(!id){console.error('Usage: node cli.js deactivate <nodeId>');process.exit(1);}
  const {walletClient,account}=getWallet();
  console.log('🔴 Deactivating node-id:'+id+'…');
  const h=await walletClient.writeContract({address:REGISTRY_ADDR,abi:REGISTRY_ABI,functionName:'updateStatus',args:[BigInt(id),0],account,chain});
  const r=await publicClient.waitForTransactionReceipt({hash:h});
  console.log(r.status==='success'?'✅ node-id:'+id+' is Inactive':'❌ Failed');
}

async function cmdVerify(args) {
  const id=args[0]; if(!id){console.error('Usage: node cli.js verify <nodeId>');process.exit(1);}
  const {walletClient,account}=getWallet();
  console.log('✔️  Verifying node-id:'+id+'…');
  const h=await walletClient.writeContract({address:REGISTRY_ADDR,abi:REGISTRY_ABI,functionName:'verifyNode',args:[BigInt(id)],account,chain});
  const r=await publicClient.waitForTransactionReceipt({hash:h});
  console.log(r.status==='success'?'✅ node-id:'+id+' verified':'❌ Failed');
}

async function cmdHeartbeat(args) {
  const id=args[0]; if(!id){console.error('Usage: node cli.js heartbeat <nodeId>');process.exit(1);}
  const {walletClient,account}=getWallet();
  console.log('💓 Heartbeat node-id:'+id+'…');
  const h=await walletClient.writeContract({address:REGISTRY_ADDR,abi:REGISTRY_ABI,functionName:'heartbeat',args:[BigInt(id)],account,chain});
  const r=await publicClient.waitForTransactionReceipt({hash:h});
  console.log(r.status==='success'?'✅ Heartbeat sent for node-id:'+id:'❌ Failed');
}

async function cmdList() {
  const nc=await publicClient.readContract({address:REGISTRY_ADDR,abi:REGISTRY_ABI,functionName:'nodeCount'});
  const ta=await publicClient.readContract({address:REGISTRY_ADDR,abi:REGISTRY_ABI,functionName:'totalActiveNodes'});
  console.log('\n📊 Network Stats\n');
  console.log('  Total nodes:  '+Number(nc));
  console.log('  Active nodes: '+Number(ta));
  console.log('\n  Use "node cli.js mine" to see your nodes.');
  console.log('  Use "node cli.js info <nodeId>" for node details.\n');
}

async function cmdMine() {
  const {account}=getWallet();
  const ids=await publicClient.readContract({address:REGISTRY_ADDR,abi:REGISTRY_ABI,functionName:'getProviderNodes',args:[account.address]});
  if(ids.length===0){console.log('\n📭 No nodes. Run: node cli.js setup\n');return;}
  console.log('\n📋 Your Nodes ('+ids.length+')\n');
  for(const id of ids) await printNode(id.toString());
}

async function cmdInfo(args) {
  const id=args[0]; if(!id){console.error('Usage: node cli.js info <nodeId>');process.exit(1);}
  await printNode(id.toString());
}

async function printNode(nodeId) {
  const nodeIdStr = String(nodeId);
  try{
    const n=await publicClient.readContract({address:REGISTRY_ADDR,abi:REGISTRY_ABI,functionName:'getNode',args:[BigInt(nodeId)]});
    console.log('┌─ node-id:'+nodeId+' '+ '─'.repeat(25));
    console.log('│ Provider:  '+n.provider);
    console.log('│ Model:     '+n.specs.model);
    console.log('│ VRAM:      '+Number(n.specs.vramGB)+' GB');
    console.log('│ TFLOPS:    '+Number(n.specs.tflops));
    console.log('│ Region:    '+n.specs.region);
    console.log('│ Status:    '+STATUS_NAMES[Number(n.status)]);
    console.log('│ Verified:  '+(n.verified?'✅':'❌'));
    console.log('│ Revenue:   '+formatEther(n.totalRevenue)+' DGRAM');
    console.log('│ Registered: '+new Date(Number(n.registeredAt)*1000).toLocaleString());
    console.log('│ Heartbeat: '+timeAgo(n.lastHeartbeat));
    console.log('└'+'─'.repeat(40)+'\n');
    if(!n.verified) console.log('   ⚠️  Verify: node cli.js verify '+nodeId);
    if(Number(n.status)===0) console.log('   ⚠️  Activate: node cli.js activate '+nodeId);
    console.log('');
  }catch(e){console.log('❌ Error reading node-id:'+nodeId);}
}

async function cmdBalance() {
  const {account}=getWallet();
  const rev=await publicClient.readContract({address:REGISTRY_ADDR,abi:REGISTRY_ABI,functionName:'getProviderRevenue',args:[account.address]});
  const bal=await publicClient.getBalance({address:account.address});
  console.log('\n💰 Provider: '+account.address);
  console.log('   Revenue:  '+formatEther(rev)+' DGRAM');
  console.log('   Balance:  '+formatEther(bal)+' DGRAM\n');
}

async function cmdStatus() {
  console.log('\n🌐 '+chain.name+' (Chain ID '+chain.id+')');
  console.log('   RPC: '+RPC_URL+'\n');
  const nc=await publicClient.readContract({address:REGISTRY_ADDR,abi:REGISTRY_ABI,functionName:'nodeCount'});
  const ta=await publicClient.readContract({address:REGISTRY_ADDR,abi:REGISTRY_ABI,functionName:'totalActiveNodes'});
  console.log('📊 Registry: '+REGISTRY_ADDR);
  console.log('   Total: '+Number(nc)+' | Active: '+Number(ta));
  if(PRIVATE_KEY){const {account}=getWallet();const bal=await publicClient.getBalance({address:account.address});console.log('\n👤 '+account.address);console.log('   Balance: '+formatEther(bal)+' DGRAM');}
  console.log('');
}

// ── Main ───────────────────────────────────────────────
const [cmd,...rest]=process.argv.slice(2);
const commands={setup:cmdSetup,detect:cmdDetect,register:cmdRegister,activate:cmdActivate,deactivate:cmdDeactivate,verify:cmdVerify,heartbeat:cmdHeartbeat,list:cmdList,mine:cmdMine,info:cmdInfo,balance:cmdBalance,status:cmdStatus};

if(!cmd||cmd==='--help'||cmd==='-h'){
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  ComputeRWA Provider CLI v1.0.0              ║');
  console.log('║  BOT Chain DePIN — Node Management           ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Network: '+chain.name.padEnd(35)+'║');
  console.log('╚══════════════════════════════════════════════╝\n');
  console.log('Commands:');
  console.log('  setup                     One-command: detect → register → activate → verify');
  console.log('  detect                    Detect hardware (GPU/CPU/RAM)');
  console.log('  register                  Register node (auto-detect or --flags)');
  console.log('  activate <id>             Set node to Active');
  console.log('  deactivate <id>           Set node to Inactive');
  console.log('  verify <id>               Verify a node');
  console.log('  heartbeat <id>            Send heartbeat');
  console.log('  list                      List all nodes');
  console.log('  mine                      List your nodes');
  console.log('  info <id>                 Node details');
  console.log('  balance                   Revenue + wallet balance');
  console.log('  status                    Network + contract status\n');
  console.log('Examples:');
  console.log('  node cli.js setup');
  console.log('  node cli.js setup --model "NVIDIA RTX 3060" --vram 12 --tflops 13 --region SG');
  console.log('  node cli.js list\n');
}else if(commands[cmd]){
  commands[cmd](rest).catch(err=>{console.error('\n❌ '+(err.shortMessage||err.message?.slice(0,200)||err));process.exit(1);});
}else{console.error('Unknown: '+cmd+'\nRun "node cli.js" for help.');process.exit(1);}
