/**
 * Hardware Detector — browser-based GPU/CPU/RAM/storage detection
 * Uses WebGL renderer info, Navigator API, and Storage API.
 * Supports both GPU nodes and CPU-only nodes.
 */

export interface HardwareInfo {
  gpuModel: string;
  vramGB: number;
  cpuCores: number;
  cpuModel: string;
  ramGB: number;
  storageGB: number;
  screen: string;
  detected: boolean;
  rawGpuString: string;
  fingerprint: string;
  hasGpu: boolean;
}

/**
 * Detect GPU model via WebGL debug renderer info.
 */
function detectGPU(): { model: string; raw: string; hasGpu: boolean } {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
    if (!gl) return { model: 'No GPU', raw: 'No WebGL', hasGpu: false };

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) {
      const renderer = gl.getParameter(gl.RENDERER) as string;
      const parsed = parseGpuModel(renderer || 'Unknown');
      // If we only get a generic string like "Mozilla" or "Google SwiftShader", it's likely CPU/software rendering
      const hasGpu =
        parsed !== 'Unknown GPU' &&
        !parsed.toLowerCase().includes('swiftshader') &&
        !parsed.toLowerCase().includes('llvmpipe') &&
        !parsed.toLowerCase().includes('software');
      return { model: parsed, raw: renderer || 'Unknown', hasGpu };
    }

    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string;
    const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) as string;
    const raw = `${vendor} ${renderer}`.trim();
    const parsed = parseGpuModel(renderer || raw);

    // Detect software rendering (CPU-only)
    const isSoftware =
      raw.toLowerCase().includes('swiftshader') ||
      raw.toLowerCase().includes('llvmpipe') ||
      raw.toLowerCase().includes('software') ||
      raw.toLowerCase().includes('microsoft basic');
    return { model: parsed, raw, hasGpu: !isSoftware && parsed !== 'Unknown GPU' };
  } catch {
    return { model: 'No GPU', raw: 'Detection failed', hasGpu: false };
  }
}

/**
 * Detect CPU model from WebGL vendor string or user agent heuristics.
 */
function detectCpuModel(): string {
  // Browser doesn't expose CPU model directly, but we can infer from platform
  const platform = navigator.userAgent.toLowerCase();
  const cores = navigator.hardwareConcurrency || 0;

  if (platform.includes('win')) {
    if (cores >= 24) return 'High-end CPU (24+ threads)';
    if (cores >= 16) return 'CPU (16 threads)';
    if (cores >= 12) return 'CPU (12 threads)';
    if (cores >= 8) return 'CPU (8 threads)';
    return 'CPU (4+ threads)';
  }
  if (platform.includes('mac')) return 'Apple/Intel CPU';
  if (platform.includes('linux')) {
    if (cores >= 32) return 'Server CPU (32+ threads)';
    if (cores >= 16) return 'CPU (16 threads)';
    if (cores >= 8) return 'CPU (8 threads)';
    return 'CPU (4+ threads)';
  }
  return `CPU (${cores} threads)`;
}

/**
 * Parse raw GPU renderer string to extract model name.
 */
function parseGpuModel(renderer: string): string {
  const str = typeof renderer === 'string' ? renderer : String(renderer);
  const r = str.toLowerCase();

  if (r.includes('h100')) return 'NVIDIA H100';
  if (r.includes('a100')) return 'NVIDIA A100';
  if (r.includes('rtx 5090') || r.includes('rtx5090')) return 'NVIDIA RTX 5090';
  if (r.includes('rtx 4090') || r.includes('rtx4090')) return 'NVIDIA RTX 4090';
  if (r.includes('rtx 4080') || r.includes('rtx4080')) return 'NVIDIA RTX 4080';
  if (r.includes('rtx 4070') || r.includes('rtx4070')) return 'NVIDIA RTX 4070';
  if (r.includes('rtx 3090') || r.includes('rtx3090')) return 'NVIDIA RTX 3090';
  if (r.includes('rtx 3080') || r.includes('rtx3080')) return 'NVIDIA RTX 3080';
  if (r.includes('rtx 3070') || r.includes('rtx3070')) return 'NVIDIA RTX 3070';
  if (r.includes('rtx 3060 ti') || r.includes('rtx3060ti')) return 'NVIDIA RTX 3060 Ti';
  if (r.includes('rtx 3060') || r.includes('rtx3060')) return 'NVIDIA RTX 3060';
  if (r.includes('rtx 3050') || r.includes('rtx3050')) return 'NVIDIA RTX 3050';
  if (r.includes('gtx 1660')) return 'NVIDIA GTX 1660';
  if (r.includes('gtx 1080')) return 'NVIDIA GTX 1080';
  if (r.includes('gtx 1070')) return 'NVIDIA GTX 1070';
  if (r.includes('tesla')) {
    const match = str.match(/tesla\s+(v100|t4|p100|p40|k80)/i);
    if (match) return `NVIDIA Tesla ${match[1].toUpperCase()}`;
  }
  if (r.includes('radeon') || r.includes('amd')) {
    if (r.includes('rx 7900')) return 'AMD RX 7900 XTX';
    if (r.includes('rx 6900')) return 'AMD RX 6900 XT';
    if (r.includes('rx 6800')) return 'AMD RX 6800 XT';
    if (r.includes('rx 6700')) return 'AMD RX 6700 XT';
    return 'AMD Radeon GPU';
  }
  if (r.includes('intel') || r.includes('arc')) {
    if (r.includes('arc a770')) return 'Intel Arc A770';
    if (r.includes('arc a750')) return 'Intel Arc A750';
    return 'Intel GPU';
  }
  if (r.includes('apple') || r.includes('m1') || r.includes('m2') || r.includes('m3'))
    return 'Apple Silicon GPU';

  // Software rendering detection
  if (r.includes('swiftshader') || r.includes('llvmpipe') || r.includes('software'))
    return 'No GPU (Software)';

  return str.length > 40 ? str.substring(0, 40) : str;
}

/**
 * Estimate VRAM based on GPU model.
 */
function estimateVram(model: string): number {
  const m = model.toLowerCase();
  const vramMap: Record<string, number> = {
    h100: 80,
    a100: 80,
    'rtx 5090': 32,
    'rtx 4090': 24,
    'rtx 4080': 16,
    'rtx 4070': 12,
    'rtx 3090': 24,
    'rtx 3080': 10,
    'rtx 3070': 8,
    'rtx 3060 ti': 8,
    'rtx 3060': 12,
    'rtx 3050': 8,
    'gtx 1660': 6,
    'gtx 1080': 8,
    'gtx 1070': 8,
    'rx 7900': 24,
    'rx 6900': 16,
    'rx 6800': 16,
    'rx 6700': 12,
    'arc a770': 16,
    'arc a750': 8,
  };
  for (const [key, val] of Object.entries(vramMap)) {
    if (m.includes(key)) return val;
  }
  return 0;
}

/**
 * Estimate TFLOPS based on GPU model (GPU) or CPU cores (CPU-only).
 */
function estimateTflops(model: string, cpuCores: number = 0, hasGpu: boolean = true): number {
  if (hasGpu) {
    const m = model.toLowerCase();
    const tflopsMap: Record<string, number> = {
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
    };
    for (const [key, val] of Object.entries(tflopsMap)) {
      if (m.includes(key)) return val;
    }
    return 0;
  }
  // CPU-only TFLOPS estimate: ~0.5 TFLOPS per core (conservative)
  return Math.round(cpuCores * 0.5 * 10) / 10;
}

/**
 * Generate a hardware fingerprint from GPU + CPU + screen.
 */
function generateFingerprint(
  gpuRaw: string,
  cpuCores: number,
  cpuModel: string,
  screen: string,
): string {
  const combined = `${gpuRaw}|${cpuCores}|${cpuModel}|${screen}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return '0x' + Math.abs(hash).toString(16).padStart(8, '0').toUpperCase();
}

/**
 * Detect hardware info using browser APIs.
 * Works for both GPU nodes and CPU-only nodes.
 */
export async function detectHardware(): Promise<HardwareInfo> {
  const gpu = detectGPU();
  const cpuCores = navigator.hardwareConcurrency || 0;
  const cpuModel = detectCpuModel();
  const ramGB = navigator.deviceMemory ?? 0;

  let storageGB = 0;
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      storageGB = Math.floor((estimate.quota || 0) / (1024 * 1024 * 1024));
    }
  } catch {
    // navigator.storage is unavailable in some browsers and blocked in others;
    // the caller renders "unknown" rather than failing the whole detection.
  }

  const screen = `${window.screen.width}×${window.screen.height}`;

  return {
    gpuModel: gpu.hasGpu ? gpu.model : 'CPU Only',
    vramGB: gpu.hasGpu ? estimateVram(gpu.model) : 0,
    cpuCores,
    cpuModel,
    ramGB,
    storageGB,
    screen,
    detected: true, // always detected — CPU-only is valid
    rawGpuString: gpu.raw,
    fingerprint: generateFingerprint(gpu.raw, cpuCores, cpuModel, screen),
    hasGpu: gpu.hasGpu,
  };
}

/**
 * Get TFLOPS estimate for a GPU model or CPU-only node.
 */
export function getTflopsForModel(
  model: string,
  cpuCores: number = 0,
  hasGpu: boolean = true,
): number {
  return estimateTflops(model, cpuCores, hasGpu);
}
