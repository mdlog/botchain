import { useCallback } from 'react';
import { getAbiItem, type Hash } from 'viem';

import { priceOracleAbi } from '@/config/abis';
import { CONTRACTS, publicClient } from '@/config/chain';
import { sendTx } from '@/lib/tx';

const oracle = { address: CONTRACTS.PriceOracle, abi: priceOracleAbi } as const;

const BENCHMARK_SET = getAbiItem({ abi: priceOracleAbi, name: 'BenchmarkSet' });

export interface OraclePrice {
  model: string;
  pricePerHourWei: bigint;
  updatedAt: number;
  confidence: number;
}

export function usePriceOracle() {
  const getPrice = useCallback(async (model: string) => {
    const [pricePerHourWei, updatedAt, confidence] = await publicClient.readContract({
      ...oracle,
      functionName: 'getPrice',
      args: [model],
    });
    return { pricePerHourWei, updatedAt: Number(updatedAt), confidence };
  }, []);

  const isSupported = useCallback(
    (model: string): Promise<boolean> =>
      publicClient.readContract({ ...oracle, functionName: 'isSupported', args: [model] }),
    [],
  );

  const getFloorPrice = useCallback(
    (): Promise<bigint> => publicClient.readContract({ ...oracle, functionName: 'floorPriceWei' }),
    [],
  );

  const getSupportedModels = useCallback(async (): Promise<string[]> => {
    try {
      const logs = await publicClient.getLogs({
        address: CONTRACTS.PriceOracle,
        event: BENCHMARK_SET,
        fromBlock: 0n,
        toBlock: 'latest',
      });
      const models: string[] = [];
      for (const log of logs) {
        const model = log.args.model;
        if (model && !models.includes(model)) models.push(model);
      }
      return models;
    } catch (err) {
      console.error('[usePriceOracle] getSupportedModels failed:', err);
      return [];
    }
  }, []);

  const getAllPrices = useCallback(async (): Promise<{ prices: OraclePrice[]; floor: bigint }> => {
    const [models, floor] = await Promise.all([getSupportedModels(), getFloorPrice()]);
    const settled = await Promise.all(
      models.map(async (model) => {
        try {
          const price = await getPrice(model);
          return { model, ...price };
        } catch {
          // A benchmarked model with no price yet reverts; it is simply unpriced.
          return null;
        }
      }),
    );
    return { prices: settled.filter((p): p is OraclePrice => p !== null), floor };
  }, [getSupportedModels, getFloorPrice, getPrice]);

  const updatePrice = useCallback(
    (model: string, pricePerHourWei: bigint, confidence: number): Promise<Hash> =>
      sendTx({
        ...oracle,
        functionName: 'updatePrice',
        args: [model, pricePerHourWei, confidence],
      }),
    [],
  );

  return {
    getPrice,
    isSupported,
    getFloorPrice,
    getSupportedModels,
    getAllPrices,
    updatePrice,
  };
}
