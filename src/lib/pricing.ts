/**
 * AI Pricing Engine — Powered by Gemini API
 *
 * Analyzes GPU hardware specs, market demand, and compute benchmarks
 * to determine fair BOT/hr prices for compute resources on BOT Chain.
 *
 * Pushes prices to PriceOracle contract on-chain.
 */

import { GoogleGenAI } from '@google/genai';
import { parseEther, type Address } from 'viem';
import { publicClient, getWalletClient, CONTRACTS, activeChain } from '@/config/chain';
import { ABIS } from '@/config/contracts';

// ── GPU Models tracked ───────────────────────────────────
const GPU_MODELS = [
  { model: 'NVIDIA H100', vram: 80, tflops: 989, baseMultiplier: 5.0 },
  { model: 'NVIDIA A100', vram: 80, tflops: 624, baseMultiplier: 3.0 },
  { model: 'NVIDIA RTX 4090', vram: 24, tflops: 165, baseMultiplier: 1.5 },
  { model: 'NVIDIA RTX 3090', vram: 24, tflops: 71, baseMultiplier: 0.8 },
  { model: 'NVIDIA RTX 3060', vram: 12, tflops: 13, baseMultiplier: 0.3 },
];

// ── Pricing Engine ───────────────────────────────────────
export class PricingEngine {
  private ai: GoogleGenAI | null = null;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
    if (this.apiKey && this.apiKey !== 'MY_GEMINI_API_KEY') {
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    }
  }

  isAvailable(): boolean {
    return this.ai !== null;
  }

  /**
   * AI-powered price suggestion for a GPU model.
   * Uses Gemini to analyze market conditions and suggest fair pricing.
   */
  async suggestPrice(
    model: string,
    vramGB: number,
    tflops: number,
    networkLoad: number, // 0-1
    activeNodes: number
  ): Promise<{ pricePerHour: bigint; confidence: number; reasoning: string }> {
    // ── If no API key, use heuristic fallback ──────────────
    if (!this.ai) {
      return this.heuristicPrice(model, vramGB, tflops, networkLoad, activeNodes);
    }

    try {
      const prompt = `You are a compute market pricing analyst for BOT Chain DePIN network.
Analyze and suggest a fair price (in BOT token per hour) for leasing this GPU:

GPU Model: ${model}
VRAM: ${vramGB} GB
TFLOPS: ${tflops}
Current network load: ${(networkLoad * 100).toFixed(1)}%
Active compute nodes: ${activeNodes}

Consider:
1. Hardware performance tier (H100 > A100 > RTX 4090 > RTX 3090)
2. Supply/demand dynamics (high network load = higher prices)
3. Competitive cloud GPU pricing benchmarks
4. DePIN premium for decentralized availability

Return ONLY a JSON object (no markdown, no explanation):
{"pricePerHour": <number>, "confidence": <0-100>, "reasoning": "<one sentence>"}`;

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      const text = response.text?.trim() || '';
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');

      const parsed = JSON.parse(jsonMatch[0]);
      const pricePerHour = parseEther(parsed.pricePerHour.toFixed(6));
      const confidence = Math.min(100, Math.max(0, parsed.confidence));

      return {
        pricePerHour,
        confidence: Math.round(confidence * 100), // convert to bps
        reasoning: parsed.reasoning || 'AI-generated price',
      };
    } catch (err) {
      console.error('[PricingEngine] AI failed, using heuristic:', err);
      return this.heuristicPrice(model, vramGB, tflops, networkLoad, activeNodes);
    }
  }

  /**
   * Heuristic pricing fallback (no AI needed).
   * Base price * demand multiplier * performance tier.
   */
  private heuristicPrice(
    model: string,
    vramGB: number,
    tflops: number,
    networkLoad: number,
    activeNodes: number
  ): { pricePerHour: bigint; confidence: number; reasoning: string } {
    const gpu = GPU_MODELS.find(g => g.model === model);
    const multiplier = gpu?.baseMultiplier || 1.0;

    // Base: 0.1 BOT/hr per TFLOP * multiplier
    const basePrice = (tflops * 0.001 * multiplier);

    // Demand adjustment: high load = +50%, low load = -20%
    const demandAdj = 1 + (networkLoad - 0.5) * 0.6;

    // Supply adjustment: fewer nodes = higher price
    const supplyAdj = activeNodes < 10 ? 1.3 : activeNodes < 50 ? 1.0 : 0.9;

    const finalPrice = basePrice * demandAdj * supplyAdj;

    return {
      pricePerHour: parseEther(finalPrice.toFixed(6)),
      confidence: 7500, // 75%
      reasoning: `Heuristic: ${tflops} TFLOPS × ${multiplier}x tier × ${(demandAdj * supplyAdj).toFixed(2)}x market adj`,
    };
  }

  /**
   * Batch price all GPU models and push to PriceOracle on-chain.
   * Requires wallet to be connected and be the AI operator.
   */
  async pushPricesToOracle(
    networkLoad: number,
    activeNodes: number
  ): Promise<{ success: boolean; results: any[] }> {
    const results: any[] = [];

    for (const gpu of GPU_MODELS) {
      const suggestion = await this.suggestPrice(
        gpu.model,
        gpu.vram,
        gpu.tflops,
        networkLoad,
        activeNodes
      );

      results.push({
        model: gpu.model,
        pricePerHour: suggestion.pricePerHour,
        confidence: suggestion.confidence,
        reasoning: suggestion.reasoning,
      });
    }

    // Push to oracle on-chain
    const walletClient = getWalletClient();
    if (!walletClient) {
      return { success: false, results };
    }

    try {
      const [account] = await walletClient.getAddresses();

      for (const result of results) {
        const hash = await walletClient.writeContract({
          address: CONTRACTS.PriceOracle,
          abi: ABIS.PriceOracle as any,
          functionName: 'updatePrice',
          args: [result.model, result.pricePerHour, result.confidence],
          account,
          chain: activeChain,
        } as any);
        result.txHash = hash;
      }

      return { success: true, results };
    } catch (err) {
      console.error('[PricingEngine] Oracle push failed:', err);
      return { success: false, results };
    }
  }

  /**
   * Risk score for a compute node (for CIF valuation).
   * 0 = safest, 100 = riskiest.
   */
  async assessNodeRisk(
    model: string,
    uptimePct: number,
    totalRevenue: bigint,
    registeredDays: number
  ): Promise<{ riskScore: number; yieldProjection: number; reasoning: string }> {
    if (!this.ai) {
      // Heuristic risk
      const uptimeRisk = (100 - uptimePct) * 2;
      const ageRisk = registeredDays < 7 ? 20 : registeredDays < 30 ? 10 : 5;
      const revenueBOT = Number(totalRevenue) / 1e18;
      const revenueRisk = revenueBOT < 1 ? 30 : revenueBOT < 10 ? 15 : 5;

      return {
        riskScore: Math.min(100, uptimeRisk + ageRisk + revenueRisk),
        yieldProjection: Math.max(5, 20 - (uptimeRisk + ageRisk + revenueRisk) / 10),
        reasoning: 'Heuristic risk assessment',
      };
    }

    try {
      const prompt = `Assess risk for a DePIN compute node:
GPU: ${model}
Uptime: ${uptimePct}%
Total Revenue: ${Number(totalRevenue) / 1e18} BOT
Days Active: ${registeredDays}

Return JSON only:
{"riskScore": <0-100>, "yieldProjection": <APY %>, "reasoning": "<one sentence>"}`;

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      const text = response.text?.trim() || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON');

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        riskScore: Math.min(100, Math.max(0, parsed.riskScore)),
        yieldProjection: parsed.yieldProjection,
        reasoning: parsed.reasoning,
      };
    } catch {
      return this.heuristicPrice(model, 80, 500, 0.5, 10) as any;
    }
  }
}

// ── Singleton ────────────────────────────────────────────
let engine: PricingEngine | null = null;

export function getPricingEngine(): PricingEngine {
  if (!engine) {
    engine = new PricingEngine();
  }
  return engine;
}
