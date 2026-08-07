import { useState, useCallback } from 'react';
import { type Hash } from 'viem';
import { publicClient, getWalletClient, CONTRACTS, activeChain } from '@/config/chain';
import { ABIS } from '@/config/contracts';

export function usePriceOracle() {
  const [loading, setLoading] = useState(false);

  const getPrice = useCallback(async (model: string) => {
    setLoading(true);
    try {
      const data = await publicClient.readContract({
        address: CONTRACTS.PriceOracle,
        abi: ABIS.PriceOracle as any,
        functionName: 'getPrice',
        args: [model],
      } as any) as [bigint, bigint, number];
      return {
        pricePerHourWei: data[0],
        updatedAt: data[1],
        confidence: data[2],
      };
    } finally {
      setLoading(false);
    }
  }, []);

  const isSupported = useCallback(async (model: string) => {
    const data = await publicClient.readContract({
      address: CONTRACTS.PriceOracle,
      abi: ABIS.PriceOracle as any,
      functionName: 'isSupported',
      args: [model],
    } as any);
    return data as boolean;
  }, []);

  const getFloorPrice = useCallback(async () => {
    const data = await publicClient.readContract({
      address: CONTRACTS.PriceOracle,
      abi: ABIS.PriceOracle as any,
      functionName: 'floorPriceWei',
    } as any);
    return data as bigint;
  }, []);

  const updatePrice = useCallback(async (
    model: string,
    pricePerHourWei: bigint,
    confidence: number
  ): Promise<Hash | null> => {
    const walletClient = getWalletClient();
    if (!walletClient) return null;
    const [account] = await walletClient.getAddresses();
    const hash = await walletClient.writeContract({
      address: CONTRACTS.PriceOracle,
      abi: ABIS.PriceOracle as any,
      functionName: 'updatePrice',
      args: [model, pricePerHourWei, confidence],
      account,
      chain: activeChain,
    } as any);
    return hash;
  }, []);

  return { loading, getPrice, isSupported, getFloorPrice, updatePrice };
}
