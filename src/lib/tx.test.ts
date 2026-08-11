import {
  type BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
} from 'viem';
import { describe, expect, it } from 'vitest';

import { WalletNotConnectedError, describeTxError } from './tx';

/** Wraps a revert the way viem nests it under a contract call. */
function revertWith(errorName: string): BaseError {
  const reverted = new ContractFunctionRevertedError({
    abi: [{ type: 'error', name: errorName, inputs: [] }],
    data: `0x${'00'.repeat(4)}`,
    functionName: 'createJob',
  });
  // viem derives `data` from the ABI selector; set it directly so the test does
  // not depend on which selector a given name happens to hash to.
  Object.assign(reverted, { data: { errorName, args: [] } });

  return new ContractFunctionExecutionError(reverted, {
    abi: [],
    functionName: 'createJob',
  });
}

describe('describeTxError', () => {
  it('translates a named custom error into something actionable', () => {
    expect(describeTxError(revertWith('NodeNotVerified'))).toMatch(/not been attested/i);
    expect(describeTxError(revertWith('NotVerifier'))).toMatch(/registry verifier/i);
    expect(describeTxError(revertWith('ExceedsSettledRevenue'))).toMatch(/actually settled/i);
    expect(describeTxError(revertWith('StalePrice'))).toMatch(/too old/i);
  });

  it('still names an error it has no copy for, rather than hiding it', () => {
    const message = describeTxError(revertWith('SomeUnmappedError'));
    expect(message).toContain('SomeUnmappedError');
  });

  it('separates a user rejection from a contract failure', () => {
    const rejected = new ContractFunctionExecutionError(
      new UserRejectedRequestError(new Error('User rejected the request.')),
      { abi: [], functionName: 'createJob' },
    );
    expect(describeTxError(rejected)).toMatch(/rejected the request in your wallet/i);
  });

  it('recognises a missing wallet', () => {
    expect(describeTxError(new WalletNotConnectedError())).toBe('Connect a wallet first');
  });

  it('passes through a plain Error and never returns an empty string', () => {
    expect(describeTxError(new Error('boom'))).toBe('boom');
    expect(describeTxError('not an error')).toBe('Something went wrong.');
  });
});
