/**
 * AI pricing engine.
 *
 * Suggests fair DGRAM/hr rates for compute, and can push them to the on-chain
 * PriceOracle — that push is what makes the oracle "AI-driven" rather than a
 * table someone seeded once at deploy time.
 *
 * AI calls go through the server-side proxy at POST /api/ai (vite-ai-proxy.ts),
 * so API keys never reach the browser. The proxy chooses the provider from its
 * own AI_PROVIDER env; VITE_AI_PROVIDER here only labels what the UI reports.
 *
 * The proxy exists in `vite dev` and `vite preview`. A static build served from
 * a CDN has no /api/ai route, and everything below falls back to the heuristic.
 */

import { formatEther, parseEther } from 'viem';

import { priceOracleAbi } from '@/config/abis';
import { CONTRACTS } from '@/config/chain';
import { GPU_CATALOG, gpuSpec } from '@/lib/domain';
import { sendTx } from '@/lib/tx';

type AiProvider = 'openai' | 'gemini';

export interface PriceSuggestion {
  pricePerHour: bigint;
  /** Basis points, 0–10000, matching the oracle's confidence field. */
  confidence: number;
  reasoning: string;
}

/**
 * DGRAM/hr for a catalog multiplier of 1.0. Calibrated so the heuristic lands
 * within a few percent of the oracle's seeded rates, which keeps the
 * "suggested rate" panel comparable to what the marketplace actually charges.
 */
const BASE_RATE_PER_HOUR = 0.6;

/** The oracle rejects anything below this, so suggesting less is pointless. */
const ORACLE_FLOOR = 0.01;

/** How far the AI may move a rate away from the current card, in either direction. */
const MAX_AI_DEVIATION = 3;

export class PricingEngine {
  private readonly provider: AiProvider;
  private availabilityChecked = false;
  private proxyAvailable = false;

  constructor() {
    this.provider = import.meta.env.VITE_AI_PROVIDER === 'openai' ? 'openai' : 'gemini';
  }

  providerName(): string {
    return this.provider;
  }

  /** Probes once whether the server proxy can reach a model at all. */
  async isAvailable(): Promise<boolean> {
    if (this.availabilityChecked) return this.proxyAvailable;
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Reply with the single word: ok' }),
      });
      this.proxyAvailable = res.ok;
    } catch {
      this.proxyAvailable = false;
    }
    this.availabilityChecked = true;
    return this.proxyAvailable;
  }

  private async generateJson(prompt: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        console.error('[PricingEngine] proxy returned', res.status);
        return null;
      }
      const data = (await res.json()) as { text?: string };
      const match = /\{[\s\S]*\}/.exec(data.text ?? '');
      return match ? (JSON.parse(match[0]) as Record<string, unknown>) : null;
    } catch (err) {
      console.error('[PricingEngine] proxy call failed:', err);
      return null;
    }
  }

  /**
   * Prices the whole catalog in ONE call.
   *
   * Asking per model produced an incoherent ladder — each completion sets its
   * own scale with no sight of the others, so an H100 came back at 23× an A100.
   * Pricing the table together is the only way the relative tiers hold, and it
   * is one request instead of seven.
   */
  async suggestCatalogPrices(
    networkLoad: number,
    activeNodes: number,
  ): Promise<Record<string, PriceSuggestion>> {
    const fallback = (): Record<string, PriceSuggestion> =>
      Object.fromEntries(
        GPU_CATALOG.map((gpu) => [
          gpu.model,
          heuristicPrice(gpu.model, gpu.vramGB, gpu.tflops, networkLoad, activeNodes),
        ]),
      );

    if (!(await this.isAvailable())) return fallback();

    // Anchor the model to the current rate card. DGRAM has no external price,
    // so without a reference the model invents its own scale — one run priced
    // an H100 at 0.099/hr against a live oracle rate of 3.10.
    const reference = new Map(
      GPU_CATALOG.map((g) => [
        g.model,
        Number(formatEther(heuristicPrice(g.model, g.vramGB, g.tflops, 0.5, 20).pricePerHour)),
      ]),
    );

    const table = GPU_CATALOG.map(
      (g) =>
        `- ${g.model}: ${g.vramGB} GB VRAM, ${g.tflops} TFLOPS, current rate ${reference.get(g.model)?.toFixed(4)} DGRAM/hr`,
    ).join('\n');

    const parsed = await this.generateJson(
      `You are a compute market pricing analyst for the BOT Chain DePIN network.
Reprice this catalog of GPUs for hourly lease, in DGRAM per hour.

${table}

Current network load: ${(networkLoad * 100).toFixed(1)}%
Active compute nodes: ${activeNodes}
Network floor: ${ORACLE_FLOOR} DGRAM/hr.

Adjust each current rate for market conditions: high network load and few
active nodes justify a premium, an idle network justifies a discount. Stay
within roughly ${1 / MAX_AI_DEVIATION}x to ${MAX_AI_DEVIATION}x of the current rate — DGRAM has no
external reference price, so the existing rate card is the scale. Keep the
ladder consistent: a faster card must never cost less than a slower one.

Return ONLY a JSON object keyed by the exact model names above, no markdown:
{"prices": {"<model>": {"pricePerHour": <number>, "confidence": <0-100>, "reasoning": "<one short sentence>"}}}`,
    );

    const prices = parsed?.prices;
    if (typeof prices !== 'object' || prices === null) {
      console.warn('[PricingEngine] no usable catalog JSON from the model, using heuristic');
      return fallback();
    }

    const result: Record<string, PriceSuggestion> = {};
    for (const gpu of GPU_CATALOG) {
      const entry = (prices as Record<string, unknown>)[gpu.model];
      const value =
        typeof entry === 'object' && entry !== null
          ? (entry as { pricePerHour?: unknown; confidence?: unknown; reasoning?: unknown })
          : null;

      if (typeof value?.pricePerHour !== 'number') {
        result[gpu.model] = heuristicPrice(
          gpu.model,
          gpu.vramGB,
          gpu.tflops,
          networkLoad,
          activeNodes,
        );
        continue;
      }

      // Trust but bound. A model that ignores the anchor would otherwise write
      // a rate card the marketplace cannot honour.
      const anchor = reference.get(gpu.model) ?? ORACLE_FLOOR;
      const bounded = clamp(
        value.pricePerHour,
        anchor / MAX_AI_DEVIATION,
        anchor * MAX_AI_DEVIATION,
      );

      const confidence = typeof value.confidence === 'number' ? value.confidence : 75;
      result[gpu.model] = {
        pricePerHour: toWei(Math.max(ORACLE_FLOOR, bounded)),
        confidence: Math.round(clamp(confidence, 0, 100) * 100),
        reasoning: typeof value.reasoning === 'string' ? value.reasoning : 'AI-generated price',
      };
    }
    return result;
  }

  /**
   * Writes the catalog prices to the oracle.
   *
   * Only the oracle's `aiOperator` (or its owner) can do this — everyone else
   * gets `NotOperator` back from the simulation before a wallet ever opens.
   */
  async pushPricesToOracle(
    networkLoad: number,
    activeNodes: number,
  ): Promise<{ model: string; pricePerHour: bigint; confidence: number; txHash: string }[]> {
    const written: { model: string; pricePerHour: bigint; confidence: number; txHash: string }[] =
      [];
    const suggestions = await this.suggestCatalogPrices(networkLoad, activeNodes);

    for (const gpu of GPU_CATALOG) {
      const suggestion =
        suggestions[gpu.model] ??
        heuristicPrice(gpu.model, gpu.vramGB, gpu.tflops, networkLoad, activeNodes);
      const txHash = await sendTx({
        address: CONTRACTS.PriceOracle,
        abi: priceOracleAbi,
        functionName: 'updatePrice',
        args: [gpu.model, suggestion.pricePerHour, suggestion.confidence],
      });
      written.push({
        model: gpu.model,
        pricePerHour: suggestion.pricePerHour,
        confidence: suggestion.confidence,
        txHash,
      });
    }

    return written;
  }
}

function toWei(dgramPerHour: number): bigint {
  return parseEther(dgramPerHour.toFixed(6));
}

/**
 * Heuristic used whenever the AI proxy is unreachable.
 *
 * The tier multiplier carries the price; the reported specs only move it within
 * its tier. Deriving the price from raw TFLOPS instead made a CPU-only node
 * quote several times an RTX 3060, because the two are not on one linear scale.
 */
export function heuristicPrice(
  model: string,
  vramGB: number,
  tflops: number,
  networkLoad: number,
  activeNodes: number,
): PriceSuggestion {
  const reference = gpuSpec(model);
  const multiplier = reference?.multiplier ?? 0.5;

  let specFactor = 1;
  if (reference && (tflops > 0 || vramGB > 0)) {
    const computeRatio = reference.tflops > 0 ? tflops / reference.tflops : 1;
    const memoryRatio = reference.vramGB > 0 ? vramGB / reference.vramGB : 1;
    specFactor = clamp(computeRatio * 0.7 + memoryRatio * 0.3, 0.5, 1.5);
  }

  // Load above half the network lifts the price, below it discounts.
  const demandAdj = 1 + (clamp(networkLoad, 0, 1) - 0.5) * 0.6;
  const supplyAdj = activeNodes < 10 ? 1.3 : activeNodes < 50 ? 1.0 : 0.9;

  const price = Math.max(
    ORACLE_FLOOR,
    BASE_RATE_PER_HOUR * multiplier * specFactor * demandAdj * supplyAdj,
  );

  return {
    pricePerHour: toWei(price),
    confidence: 7500,
    reasoning: `Heuristic: ${multiplier}x tier × ${specFactor.toFixed(2)}x specs × ${(demandAdj * supplyAdj).toFixed(2)}x market`,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

let engine: PricingEngine | null = null;

export function getPricingEngine(): PricingEngine {
  engine ??= new PricingEngine();
  return engine;
}
