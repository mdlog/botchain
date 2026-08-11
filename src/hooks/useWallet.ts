import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';

import { activeChain, publicClient } from '@/config/chain';

export interface WalletState {
  address: Address | null;
  chainId: number | null;
  isConnecting: boolean;
  isWrongChain: boolean;
  balance: bigint;
}

const INITIAL: WalletState = {
  address: null,
  chainId: null,
  isConnecting: false,
  isWrongChain: false,
  balance: 0n,
};

/** The top-bar balance goes stale otherwise; roughly one block on this chain. */
const BALANCE_POLL_MS = 15_000;

function getProvider() {
  return typeof window === 'undefined' ? undefined : window.ethereum;
}

export function useWallet() {
  const [state, setState] = useState<WalletState>(INITIAL);
  const hasEthereum = getProvider() !== undefined;

  const readChainId = useCallback(async (): Promise<number | null> => {
    const eth = getProvider();
    if (!eth) return null;
    const hex = (await eth.request({ method: 'eth_chainId' })) as string;
    return Number.parseInt(hex, 16);
  }, []);

  const readBalance = useCallback(async (address: Address): Promise<bigint> => {
    try {
      return await publicClient.getBalance({ address });
    } catch (err) {
      console.error('[useWallet] balance read failed:', err);
      return 0n;
    }
  }, []);

  const connect = useCallback(async () => {
    // WalletConnect already disables the button and explains why when no
    // provider is injected, so this is a guard, not a place to interrupt.
    const eth = getProvider();
    if (!eth) return;

    setState((s) => ({ ...s, isConnecting: true }));
    try {
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      const address = accounts[0] as Address | undefined;
      if (!address) {
        setState({ ...INITIAL });
        return;
      }

      if ((await readChainId()) !== activeChain.id) {
        try {
          await eth.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${activeChain.id.toString(16)}` }],
          });
        } catch (switchError) {
          const code = (switchError as { code?: number }).code;
          if (code === 4902) {
            await eth.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: `0x${activeChain.id.toString(16)}`,
                  chainName: activeChain.name,
                  nativeCurrency: activeChain.nativeCurrency,
                  rpcUrls: [activeChain.rpcUrls.default.http[0]],
                  blockExplorerUrls: [activeChain.blockExplorers.default.url],
                },
              ],
            });
          }
          // A declined switch (4001) is not an error to swallow: the wallet is
          // still on another chain, and the state below has to say so.
        }
      }

      // Read the chain back rather than assuming the switch succeeded. Assuming
      // it left `isWrongChain` permanently false, so a user who declined saw a
      // green "Connected" pill and a chain id the app had invented.
      const chainId = await readChainId();
      setState({
        address,
        chainId,
        isConnecting: false,
        isWrongChain: chainId !== activeChain.id,
        balance: await readBalance(address),
      });
    } catch (err) {
      console.error('[useWallet] connect failed:', err);
      setState((s) => ({ ...s, isConnecting: false }));
    }
  }, [readChainId, readBalance]);

  const disconnect = useCallback(() => setState({ ...INITIAL }), []);

  const refreshBalance = useCallback(async () => {
    if (!state.address) return;
    const balance = await readBalance(state.address);
    setState((s) => ({ ...s, balance }));
  }, [state.address, readBalance]);

  // `connect` is recreated on every render of the consumer, so the listener
  // effect must not depend on it directly or it would resubscribe constantly.
  const connectRef = useRef(connect);
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    const eth = getProvider();
    if (!eth) return;

    void eth.request({ method: 'eth_accounts' }).then((accounts) => {
      if ((accounts as string[]).length > 0) void connectRef.current();
    });

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      if (!accounts || accounts.length === 0) setState({ ...INITIAL });
      else void connectRef.current();
    };

    // The event carries the new chain id, so there is no reason to re-run the
    // whole connect flow (and re-prompt the wallet) just to learn it.
    const onChainChanged = (...args: unknown[]) => {
      const chainId = Number.parseInt(String(args[0]), 16);
      setState((s) => ({ ...s, chainId, isWrongChain: chainId !== activeChain.id }));
    };

    eth.on?.('accountsChanged', onAccountsChanged);
    eth.on?.('chainChanged', onChainChanged);
    return () => {
      eth.removeListener?.('accountsChanged', onAccountsChanged);
      eth.removeListener?.('chainChanged', onChainChanged);
    };
  }, []);

  useEffect(() => {
    if (!state.address) return;
    const address = state.address;
    const id = setInterval(() => {
      void readBalance(address).then((balance) => setState((s) => ({ ...s, balance })));
    }, BALANCE_POLL_MS);
    return () => clearInterval(id);
  }, [state.address, readBalance]);

  /**
   * EIP-191 personal_sign. The provider agent recovers the signer from this to
   * prove the caller holds the lease.
   *
   * The plain UTF-8 message is passed through deliberately: the wallet applies
   * the "\x19Ethereum Signed Message:\n<len>" prefix over the UTF-8 bytes and
   * the agent recomputes the same hash. Hex-encoding here changes how some
   * wallets hash it and recovery then yields a different address.
   */
  const signMessage = useCallback(
    async (message: string): Promise<string> => {
      const eth = getProvider();
      if (!eth || !state.address) throw new Error('Wallet not connected');
      return (await eth.request({
        method: 'personal_sign',
        params: [message, state.address],
      })) as string;
    },
    [state.address],
  );

  return { ...state, connect, disconnect, refreshBalance, signMessage, hasEthereum };
}
