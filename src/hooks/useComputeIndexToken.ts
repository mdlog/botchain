import { useState, useCallback } from 'react';
import { type Address, type Hash } from 'viem';
import { publicClient, getWalletClient, CONTRACTS, activeChain } from '@/config/chain';
import { ABIS } from '@/config/contracts';

export function useComputeIndexToken() {
  const [loading, setLoading] = useState(false);

  const getBalance = useCallback(async (address: Address) => {
    const data = await publicClient.readContract({
      address: CONTRACTS.ComputeIndexToken,
      abi: ABIS.ComputeIndexToken as any,
      functionName: 'balanceOf',
      args: [address],
    } as any);
    return data as bigint;
  }, []);

  const getTotalSupply = useCallback(async () => {
    const data = await publicClient.readContract({
      address: CONTRACTS.ComputeIndexToken,
      abi: ABIS.ComputeIndexToken as any,
      functionName: 'totalSupply',
    } as any);
    return data as bigint;
  }, []);

  const getTVL = useCallback(async () => {
    const data = await publicClient.readContract({
      address: CONTRACTS.ComputeIndexToken,
      abi: ABIS.ComputeIndexToken as any,
      functionName: 'totalValueLocked',
    } as any);
    return data as bigint;
  }, []);

  const getIndexPrice = useCallback(async () => {
    const data = await publicClient.readContract({
      address: CONTRACTS.ComputeIndexToken,
      abi: ABIS.ComputeIndexToken as any,
      functionName: 'getIndexPrice',
    } as any);
    return data as bigint;
  }, []);

  const getDeposits = useCallback(async (provider: Address) => {
    const data = await publicClient.readContract({
      address: CONTRACTS.ComputeIndexToken,
      abi: ABIS.ComputeIndexToken as any,
      functionName: 'getDeposits',
      args: [provider],
    } as any);
    return data;
  }, []);

  const getTotalDeposited = useCallback(async (provider: Address) => {
    const data = await publicClient.readContract({
      address: CONTRACTS.ComputeIndexToken,
      abi: ABIS.ComputeIndexToken as any,
      functionName: 'totalDeposited',
      args: [provider],
    } as any);
    return data as bigint;
  }, []);

  const depositRevenue = useCallback(async (
    nodeId: bigint,
    value: bigint
  ): Promise<Hash | null> => {
    const walletClient = getWalletClient();
    if (!walletClient) return null;
    const [account] = await walletClient.getAddresses();
    const hash = await walletClient.writeContract({
      address: CONTRACTS.ComputeIndexToken,
      abi: ABIS.ComputeIndexToken as any,
      functionName: 'depositRevenue',
      args: [nodeId],
      value,
      account,
      chain: activeChain,
    } as any);
    return hash;
  }, []);

  const withdraw = useCallback(async (amount: bigint): Promise<Hash | null> => {
    const walletClient = getWalletClient();
    if (!walletClient) return null;
    const [account] = await walletClient.getAddresses();
    const hash = await walletClient.writeContract({
      address: CONTRACTS.ComputeIndexToken,
      abi: ABIS.ComputeIndexToken as any,
      functionName: 'withdraw',
      args: [amount],
      account,
      chain: activeChain,
    } as any);
    return hash;
  }, []);

  const transfer = useCallback(async (
    to: Address,
    amount: bigint
  ): Promise<Hash | null> => {
    const walletClient = getWalletClient();
    if (!walletClient) return null;
    const [account] = await walletClient.getAddresses();
    const hash = await walletClient.writeContract({
      address: CONTRACTS.ComputeIndexToken,
      abi: ABIS.ComputeIndexToken as any,
      functionName: 'transfer',
      args: [to, amount],
      account,
      chain: activeChain,
    } as any);
    return hash;
  }, []);

  return {
    loading, getBalance, getTotalSupply, getTVL, getIndexPrice,
    getDeposits, getTotalDeposited, depositRevenue, withdraw, transfer,
  };
}
