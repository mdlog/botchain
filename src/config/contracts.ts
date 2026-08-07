import type { Address } from 'viem';
import ComputeRegistryAbi from './ComputeRegistry.abi.json';
import PriceOracleAbi from './PriceOracle.abi.json';
import ComputeMarketplaceAbi from './ComputeMarketplace.abi.json';
import ComputeIndexTokenAbi from './ComputeIndexToken.abi.json';

export const ABIS = {
  ComputeRegistry: ComputeRegistryAbi,
  PriceOracle: PriceOracleAbi,
  ComputeMarketplace: ComputeMarketplaceAbi,
  ComputeIndexToken: ComputeIndexTokenAbi,
} as const;

export function getContractConfig(name: keyof typeof ABIS, address: Address) {
  return {
    address,
    abi: ABIS[name],
  };
}
