import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  decodeErrorResult,
  type Hex,
  type Abi,
  type Account,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hash,
  type SimulateContractParameters,
  type WalletClient,
} from 'viem';

import {
  agentRegistryAbi,
  computeIndexTokenAbi,
  computeMarketplaceAbi,
  computeRegistryAbi,
  priceOracleAbi,
} from '@/config/abis';
import { activeChain, getWalletClient, publicClient } from '@/config/chain';

/**
 * A call into the marketplace can revert inside the registry or the oracle, and
 * viem only decodes against the ABI of the contract it called — so those
 * selectors come back unnamed. Searching every deployed ABI turns
 * "an unknown error occurred" into the name of what actually rejected.
 */
const ALL_ABIS = [
  computeMarketplaceAbi,
  computeRegistryAbi,
  priceOracleAbi,
  computeIndexTokenAbi,
  agentRegistryAbi,
] as const;

function decodeAcrossContracts(raw: Hex | undefined): string | undefined {
  if (!raw || raw === '0x') return undefined;
  for (const abi of ALL_ABIS) {
    try {
      return decodeErrorResult({ abi, data: raw }).errorName;
    } catch {
      // Selector is not from this contract; try the next.
    }
  }
  return undefined;
}

export class WalletNotConnectedError extends Error {
  constructor() {
    super('Connect a wallet first');
    this.name = 'WalletNotConnectedError';
  }
}

async function requireWallet(): Promise<{ walletClient: WalletClient; account: Account }> {
  const walletClient = getWalletClient();
  if (!walletClient) throw new WalletNotConnectedError();
  const [address] = await walletClient.getAddresses();
  if (!address) throw new WalletNotConnectedError();
  return { walletClient, account: { address, type: 'json-rpc' } };
}

type WriteMutability = 'nonpayable' | 'payable';

/**
 * Simulate, send, and wait for the receipt.
 *
 * Simulating first matters twice over: a call that would revert fails here with
 * the contract's own error before the wallet ever opens, and the wallet is then
 * handed a request that has already been checked. Waiting for the receipt is
 * what stops the UI asserting outcomes it never observed — a success toast used
 * to fire on the transaction hash, so a reverted transaction still reported
 * "payment released".
 */
export async function sendTx<
  const abi extends Abi | readonly unknown[],
  functionName extends ContractFunctionName<abi, WriteMutability>,
  args extends ContractFunctionArgs<abi, WriteMutability, functionName>,
>(
  parameters: Omit<
    SimulateContractParameters<abi, functionName, args, typeof activeChain>,
    'account' | 'chain'
  >,
): Promise<Hash> {
  const { walletClient, account } = await requireWallet();

  // TypeScript cannot see that re-adding `account` and `chain` reconstitutes the
  // Omit above, so the widening step is explicit. Call sites keep full
  // inference on abi/functionName/args, which is the point of the wrapper.
  const simulateParams = { ...parameters, account, chain: activeChain } as unknown;

  const { request } = await publicClient.simulateContract(
    simulateParams as SimulateContractParameters<abi, functionName, args, typeof activeChain>,
  );

  const hash = await walletClient.writeContract(request as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error('Transaction reverted on chain');
  }
  return hash;
}

/**
 * Turn a viem/wallet error into something a user can act on.
 *
 * The contracts revert with named custom errors; without this every failure
 * collapsed into one hardcoded sentence, so "you are not the verifier" and
 * "the oracle has no price for this GPU" were reported identically.
 */
const ERROR_MESSAGES: Record<string, string> = {
  // Marketplace
  NodeNotVerified: 'This node has not been attested yet, so it cannot be leased.',
  NodeNotActive: 'This node is not accepting work right now.',
  InsufficientPayment: 'The amount sent is below the quoted price for this lease.',
  InvalidDuration: 'That lease duration is outside the allowed range.',
  StalePrice: 'The oracle price for this GPU is too old to lease against.',
  LowConfidence: 'The oracle is not confident enough in this GPU price to lease against it.',
  JobNotPending: 'This job is no longer pending.',
  JobNotActive: 'This job is not running.',
  JobNotExtendable: 'This lease can no longer be extended.',
  LeaseNotExpired: 'This lease has not expired yet.',
  NotConsumer: 'Only the wallet that paid for this lease can do that.',
  NotProvider: 'Only the provider of this node can do that.',
  NothingToWithdraw: 'There is nothing to withdraw.',
  // Registry
  NotVerifier: 'Only the registry verifier can attest a node.',
  NotNodeProvider: 'Only the wallet that registered this node can do that.',
  NodeNotFound: 'That node is not registered.',
  ModelRequired: 'Enter a GPU or CPU model.',
  NodeAlreadyExists: 'That node is already registered.',
  // Index fund
  ExceedsSettledRevenue: 'You can only mint CIF against revenue this node has actually settled.',
  InsufficientShares: 'You do not hold that many CIF.',
  ZeroAmount: 'Enter an amount above zero.',
  // Oracle
  NoPriceForModel: 'The oracle has no price for this model yet.',
  UnsupportedModel: 'This model is not benchmarked in the oracle.',
  BelowFloorPrice: 'That price is below the oracle floor.',
  AboveMaxPrice: 'That price is above the oracle ceiling.',
  // Agent registry
  InvalidUrlScheme: 'The agent URL must start with https://.',
  InvalidUrlLength: 'The agent URL is too short or too long.',
  // OpenZeppelin
  OwnableUnauthorizedAccount: 'This action is restricted to the contract owner.',
  ERC20InsufficientBalance: 'Insufficient balance.',
};

export function describeTxError(err: unknown): string {
  if (err instanceof WalletNotConnectedError) return err.message;

  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) {
      return 'You rejected the request in your wallet.';
    }

    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName ?? decodeAcrossContracts(reverted.raw);
      if (name && ERROR_MESSAGES[name]) return ERROR_MESSAGES[name];
      if (name) return `Rejected by the contract (${name}).`;
      // Older deployments and OpenZeppelin's require() paths still use strings.
      if (reverted.reason) return reverted.reason;
      return 'The contract rejected this call without giving a reason.';
    }

    if (/insufficient funds/i.test(err.message)) {
      return 'Not enough DGRAM to cover the amount plus gas.';
    }
    return err.shortMessage;
  }

  return err instanceof Error ? err.message : 'Something went wrong.';
}
