import { formatEther } from 'viem';
import { describe, expect, it } from 'vitest';

import { GPU_CATALOG, gpuSpec } from './domain';
import { heuristicPrice } from './pricing';

/** Price a card at its reference spec under a neutral market. */
function referencePrice(model: string): number {
  const spec = gpuSpec(model)!;
  return Number(formatEther(heuristicPrice(model, spec.vramGB, spec.tflops, 0.5, 20).pricePerHour));
}

describe('heuristicPrice', () => {
  it('keeps the tier ordering the oracle is seeded with', () => {
    const prices = GPU_CATALOG.map((g) => referencePrice(g.model));
    expect([...prices].sort((a, b) => b - a)).toEqual(prices);
  });

  it('prices CPU-only below an RTX 3060 rather than above it', () => {
    // Deriving the price from raw TFLOPS had CPU Only quoting several times a
    // 3060, because the two are not on one linear scale.
    expect(referencePrice('CPU Only')).toBeLessThan(referencePrice('NVIDIA RTX 3060'));
  });

  it('lands close to the rate the oracle actually charges', () => {
    const seeded: Record<string, number> = {
      'NVIDIA H100': 3.1,
      'NVIDIA A100': 1.8,
      'NVIDIA RTX 4090': 0.85,
      'NVIDIA RTX 3060': 0.15,
      'CPU Only': 0.02,
    };
    for (const [model, oracle] of Object.entries(seeded)) {
      const suggested = referencePrice(model);
      expect(suggested).toBeGreaterThan(oracle * 0.5);
      expect(suggested).toBeLessThan(oracle * 2.5);
    }
  });

  it('never suggests below the oracle floor', () => {
    const price = heuristicPrice('CPU Only', 0, 1, 0, 500).pricePerHour;
    expect(Number(formatEther(price))).toBeGreaterThanOrEqual(0.01);
  });

  it('charges more under load and less when the network is idle', () => {
    const busy = heuristicPrice('NVIDIA RTX 3060', 12, 13, 1, 20).pricePerHour;
    const idle = heuristicPrice('NVIDIA RTX 3060', 12, 13, 0, 20).pricePerHour;
    expect(busy).toBeGreaterThan(idle);
  });

  it('discounts a card that underperforms its reference spec', () => {
    const full = heuristicPrice('NVIDIA RTX 4090', 24, 165, 0.5, 20).pricePerHour;
    const halved = heuristicPrice('NVIDIA RTX 4090', 12, 80, 0.5, 20).pricePerHour;
    expect(halved).toBeLessThan(full);
  });

  it('falls back to a mid multiplier for an unknown model', () => {
    const price = heuristicPrice('Some New GPU', 48, 400, 0.5, 20).pricePerHour;
    expect(price).toBeGreaterThan(0n);
  });
});
