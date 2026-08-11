import { useCallback } from 'react';
import type { Address, Hash } from 'viem';

import { computeIndexTokenAbi } from '@/config/abis';
import { CONTRACTS, publicClient } from '@/config/chain';
import { sendTx } from '@/lib/tx';

const cif = { address: CONTRACTS.ComputeIndexToken, abi: computeIndexTokenAbi } as const;

export function useComputeIndexToken() {
  const getBalance = useCallback(
    (address: Address): Promise<bigint> =>
      publicClient.readContract({ ...cif, functionName: 'balanceOf', args: [address] }),
    [],
  );

  const getTotalSupply = useCallback(
    (): Promise<bigint> => publicClient.readContract({ ...cif, functionName: 'totalSupply' }),
    [],
  );

  const getTVL = useCallback(
    (): Promise<bigint> => publicClient.readContract({ ...cif, functionName: 'totalValueLocked' }),
    [],
  );

  /**
   * Backing per CIF, 18 decimals. Above 1e18 means settled compute revenue has
   * accrued to the fund since issuance — that spread is the yield.
   */
  const getIndexPrice = useCallback(
    (): Promise<bigint> => publicClient.readContract({ ...cif, functionName: 'getIndexPrice' }),
    [],
  );

  const getDeposits = useCallback(
    (provider: Address) =>
      publicClient.readContract({ ...cif, functionName: 'getDeposits', args: [provider] }),
    [],
  );

  const getTotalDeposited = useCallback(
    (provider: Address): Promise<bigint> =>
      publicClient.readContract({ ...cif, functionName: 'totalDeposited', args: [provider] }),
    [],
  );

  /** How much a node has already minted against; the cap is its settled revenue. */
  const getDepositedPerNode = useCallback(
    (nodeId: bigint): Promise<bigint> =>
      publicClient.readContract({ ...cif, functionName: 'depositedPerNode', args: [nodeId] }),
    [],
  );

  const depositRevenue = useCallback(
    (nodeId: bigint, value: bigint): Promise<Hash> =>
      sendTx({ ...cif, functionName: 'depositRevenue', args: [nodeId], value }),
    [],
  );

  const withdraw = useCallback(
    (amount: bigint): Promise<Hash> => sendTx({ ...cif, functionName: 'withdraw', args: [amount] }),
    [],
  );

  const transfer = useCallback(
    (to: Address, amount: bigint): Promise<Hash> =>
      sendTx({ ...cif, functionName: 'transfer', args: [to, amount] }),
    [],
  );

  return {
    getBalance,
    getTotalSupply,
    getTVL,
    getIndexPrice,
    getDeposits,
    getTotalDeposited,
    getDepositedPerNode,
    depositRevenue,
    withdraw,
    transfer,
  };
}
