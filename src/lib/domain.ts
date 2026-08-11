/**
 * Single source for the vocabulary the chain speaks.
 *
 * These tables used to be re-declared inside each view, and they had drifted:
 * the same status integer rendered under different labels and different colours
 * depending on which screen you were looking at.
 */

/** Matches the Badge/StatusDot vocabulary in src/components/ui/Badge.tsx. */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

// ── Node status (ComputeRegistry.NodeStatus) ─────────────
export const NODE_STATUS = [
  { label: 'Inactive', tone: 'neutral' },
  { label: 'Available', tone: 'success' },
  { label: 'Busy', tone: 'warning' },
  { label: 'Offline', tone: 'danger' },
] as const satisfies readonly { label: string; tone: Tone }[];

export function nodeStatus(status: number) {
  return NODE_STATUS[status] ?? NODE_STATUS[0];
}

export const NODE_STATUS_ACTIVE = 1;

// ── Job status (ComputeMarketplace.JobStatus) ────────────
// Disputed was removed from the contract: there was no dispute process behind
// it, and leaving the chip in implied one existed.
export const JOB_STATUS = [
  { label: 'Pending', tone: 'warning' },
  { label: 'Active', tone: 'success' },
  { label: 'Completed', tone: 'accent' },
  { label: 'Cancelled', tone: 'neutral' },
] as const satisfies readonly { label: string; tone: Tone }[];

export function jobStatus(status: number) {
  return JOB_STATUS[status] ?? JOB_STATUS[0];
}

export const JOB_PENDING = 0;
export const JOB_ACTIVE = 1;
export const JOB_COMPLETED = 2;
export const JOB_CANCELLED = 3;

// ── GPU catalog ──────────────────────────────────────────
/**
 * The models the oracle is seeded with. `tflops` and `vramGB` are the reference
 * spec used to sanity-check what a provider self-reports and to feed the
 * pricing heuristic — the heuristic used to price every card as an 80 GB /
 * 500 TFLOPS part, which is why its suggestions were nonsense.
 */
export interface GpuSpec {
  model: string;
  vramGB: number;
  tflops: number;
  /** Relative price weight, matched to the oracle benchmark basis points. */
  multiplier: number;
}

export const GPU_CATALOG: readonly GpuSpec[] = [
  { model: 'NVIDIA H100', vramGB: 80, tflops: 990, multiplier: 5.0 },
  { model: 'NVIDIA A100', vramGB: 80, tflops: 312, multiplier: 3.0 },
  { model: 'NVIDIA RTX 4090', vramGB: 24, tflops: 165, multiplier: 1.5 },
  { model: 'NVIDIA RTX 3090', vramGB: 24, tflops: 71, multiplier: 0.8 },
  { model: 'NVIDIA RTX 3060', vramGB: 12, tflops: 13, multiplier: 0.3 },
  { model: 'AMD Radeon GPU', vramGB: 16, tflops: 20, multiplier: 0.25 },
  { model: 'CPU Only', vramGB: 0, tflops: 1, multiplier: 0.05 },
];

export const GPU_MODELS = GPU_CATALOG.map((g) => g.model);

export function gpuSpec(model: string): GpuSpec | undefined {
  return GPU_CATALOG.find((g) => g.model === model);
}

// ── Lease countdown ──────────────────────────────────────
export interface Countdown {
  /** Whole seconds left, floored at 0. */
  secondsLeft: number;
  expired: boolean;
  /** `1:04:12`, or `04:12` under an hour. */
  label: string;
  /** 0..1 of the lease consumed, for progress bars. */
  progress: number;
}

/**
 * @param startedAt unix seconds the provider accepted, 0 while still pending
 * @param durationHours booked hours
 * @param now unix seconds; injected so this stays testable
 */
export function leaseCountdown(
  startedAt: number,
  durationHours: number,
  now: number = Math.floor(Date.now() / 1000),
): Countdown {
  const total = durationHours * 3600;
  if (startedAt === 0 || total === 0) {
    return { secondsLeft: total, expired: false, label: formatDuration(total), progress: 0 };
  }

  const elapsed = Math.max(0, now - startedAt);
  const secondsLeft = Math.max(0, total - elapsed);
  return {
    secondsLeft,
    expired: secondsLeft === 0,
    label: formatDuration(secondsLeft),
    progress: Math.min(1, elapsed / total),
  };
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
