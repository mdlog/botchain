import { useCallback } from 'react';
import { getAbiItem, type Address, type Hash } from 'viem';

import { computeRegistryAbi } from '@/config/abis';
import { CONTRACTS, publicClient, type ComputeNode } from '@/config/chain';
import { sendTx } from '@/lib/tx';

const registry = { address: CONTRACTS.ComputeRegistry, abi: computeRegistryAbi } as const;

/** Node ids are keccak-derived, so they cannot be enumerated by counting. */
const NODE_REGISTERED = getAbiItem({ abi: computeRegistryAbi, name: 'NodeRegistered' });

export function useComputeRegistry() {
  const getNode = useCallback(
    (nodeId: bigint): Promise<ComputeNode> =>
      publicClient.readContract({ ...registry, functionName: 'getNode', args: [nodeId] }),
    [],
  );

  const getProviderNodes = useCallback(
    (provider: Address): Promise<readonly bigint[]> =>
      publicClient.readContract({
        ...registry,
        functionName: 'getProviderNodes',
        args: [provider],
      }),
    [],
  );

  const getProviderRevenue = useCallback(
    (provider: Address): Promise<bigint> =>
      publicClient.readContract({
        ...registry,
        functionName: 'getProviderRevenue',
        args: [provider],
      }),
    [],
  );

  const getTotalActiveNodes = useCallback(
    (): Promise<bigint> =>
      publicClient.readContract({ ...registry, functionName: 'totalActiveNodes' }),
    [],
  );

  const getNodeCount = useCallback(
    (): Promise<bigint> => publicClient.readContract({ ...registry, functionName: 'nodeCount' }),
    [],
  );

  /** Who may attest nodes. Only this address can call `verifyNode`. */
  const getVerifier = useCallback(
    (): Promise<Address> => publicClient.readContract({ ...registry, functionName: 'verifier' }),
    [],
  );

  /** Every registered node id, recovered from the registration log stream. */
  const getAllNodeIds = useCallback(async (): Promise<bigint[]> => {
    const logs = await publicClient.getLogs({
      address: CONTRACTS.ComputeRegistry,
      event: NODE_REGISTERED,
      fromBlock: 0n,
      toBlock: 'latest',
    });
    const ids = new Set<bigint>();
    for (const log of logs) {
      if (log.args.nodeId !== undefined) ids.add(log.args.nodeId);
    }
    return [...ids];
  }, []);

  /** Reads every node concurrently; the public client folds them into multicalls. */
  const getAllNodes = useCallback(async (): Promise<ComputeNode[]> => {
    const ids = await getAllNodeIds();
    const nodes = await Promise.all(ids.map((id) => getNode(id).catch(() => null)));
    return nodes.filter((node): node is ComputeNode => node !== null);
  }, [getAllNodeIds, getNode]);

  const getGlobalComputePower = useCallback(async (): Promise<{
    tflops: number;
    vram: number;
    count: number;
  }> => {
    try {
      const nodes = await getAllNodes();
      return nodes.reduce(
        (acc, node) => ({
          tflops: acc.tflops + node.specs.tflops,
          vram: acc.vram + node.specs.vramGB,
          count: acc.count + 1,
        }),
        { tflops: 0, vram: 0, count: 0 },
      );
    } catch (err) {
      console.error('[useComputeRegistry] getGlobalComputePower failed:', err);
      return { tflops: 0, vram: 0, count: 0 };
    }
  }, [getAllNodes]);

  const registerNode = useCallback(
    (model: string, vramGB: number, tflops: number, region: string): Promise<Hash> =>
      sendTx({
        ...registry,
        functionName: 'registerNode',
        args: [model, vramGB, tflops, region],
      }),
    [],
  );

  const updateNodeStatus = useCallback(
    (nodeId: bigint, status: number): Promise<Hash> =>
      sendTx({ ...registry, functionName: 'updateStatus', args: [nodeId, status] }),
    [],
  );

  const verifyNode = useCallback(
    (nodeId: bigint): Promise<Hash> =>
      sendTx({ ...registry, functionName: 'verifyNode', args: [nodeId] }),
    [],
  );

  return {
    getNode,
    getAllNodeIds,
    getAllNodes,
    getProviderNodes,
    getProviderRevenue,
    getTotalActiveNodes,
    getNodeCount,
    getVerifier,
    getGlobalComputePower,
    registerNode,
    updateNodeStatus,
    verifyNode,
  };
}
