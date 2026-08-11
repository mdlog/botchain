import { describe, expect, it } from 'vitest';

import {
  GPU_CATALOG,
  JOB_STATUS,
  formatDuration,
  gpuSpec,
  jobStatus,
  leaseCountdown,
  nodeStatus,
} from './domain';

describe('status tables', () => {
  it('maps the contract enums in order', () => {
    expect(nodeStatus(1).label).toBe('Available');
    expect(jobStatus(1).label).toBe('Active');
    expect(jobStatus(3).label).toBe('Cancelled');
  });

  it('no longer carries Disputed, which the contract dropped', () => {
    expect(JOB_STATUS).toHaveLength(4);
    // An out-of-range status must not render as a blank chip.
    expect(jobStatus(4).label).toBe('Pending');
  });
});

describe('gpu catalog', () => {
  it('prices CPU-only below every GPU', () => {
    const cpu = gpuSpec('CPU Only');
    expect(cpu?.multiplier).toBeLessThan(gpuSpec('NVIDIA RTX 3060')!.multiplier);
  });

  it('orders multipliers by tier', () => {
    const multipliers = GPU_CATALOG.map((g) => g.multiplier);
    expect([...multipliers].sort((a, b) => b - a)).toEqual(multipliers);
  });

  it('returns undefined for an unknown model rather than guessing', () => {
    expect(gpuSpec('NVIDIA RTX 5090')).toBeUndefined();
  });
});

describe('leaseCountdown', () => {
  const started = 1_000_000;

  it('counts down from the accepted time', () => {
    const c = leaseCountdown(started, 2, started + 3600);
    expect(c.secondsLeft).toBe(3600);
    expect(c.expired).toBe(false);
    expect(c.label).toBe('1:00:00');
    expect(c.progress).toBeCloseTo(0.5);
  });

  it('reports the full duration while the job is still pending', () => {
    const c = leaseCountdown(0, 1, started);
    expect(c.secondsLeft).toBe(3600);
    expect(c.expired).toBe(false);
    expect(c.progress).toBe(0);
  });

  it('clamps at zero instead of going negative', () => {
    const c = leaseCountdown(started, 1, started + 99_999);
    expect(c.secondsLeft).toBe(0);
    expect(c.expired).toBe(true);
    expect(c.progress).toBe(1);
  });

  it('treats the exact expiry second as expired', () => {
    expect(leaseCountdown(started, 1, started + 3600).expired).toBe(true);
  });
});

describe('formatDuration', () => {
  it('drops the hour segment under an hour', () => {
    expect(formatDuration(59)).toBe('00:59');
    expect(formatDuration(600)).toBe('10:00');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(-5)).toBe('00:00');
  });
});
