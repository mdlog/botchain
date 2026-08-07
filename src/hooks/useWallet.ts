import { useState, useEffect, useCallback } from 'react';
import { type Address, type Chain } from 'viem';
import { activeChain, publicClient, getWalletClient } from '@/config/chain';

// ── Types ────────────────────────────────────────────────
export interface WalletState {
  address: Address | null;
  chainId: number | null;
  isConnecting: boolean;
  isWrongChain: boolean;
  balance: bigint;
}

// ── Hook ─────────────────────────────────────────────────
export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    chainId: null,
    isConnecting: false,
    isWrongChain: false,
    balance: 0n,
  });

  // ── Check if window.ethereum exists ─────────────────────
  const hasEthereum = typeof window !== 'undefined' && (window as any).ethereum;

  // ── Connect wallet ──────────────────────────────────────
  const connect = useCallback(async () => {
    if (!hasEthereum) {
      alert('MetaMask tidak terdeteksi. Install MetaMask atau gunakan wallet yang mendukung window.ethereum.');
      return;
    }

    setState((s) => ({ ...s, isConnecting: true }));
    try {
      const eth = (window as any).ethereum;
      const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' });
      const chainId: string = await eth.request({ method: 'eth_chainId' });
      const parsedChainId = parseInt(chainId, 16);

      const address = accounts[0] as Address;
      const isWrongChain = parsedChainId !== activeChain.id;

      // Try switching to BOT Chain
      if (isWrongChain) {
        try {
          await eth.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${activeChain.id.toString(16)}` }],
          });
        } catch (switchError: any) {
          // Chain not added yet — add it
          if (switchError.code === 4902) {
            await eth.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: `0x${activeChain.id.toString(16)}`,
                chainName: activeChain.name,
                nativeCurrency: activeChain.nativeCurrency,
                rpcUrls: [activeChain.rpcUrls.default.http[0]],
                blockExplorerUrls: [activeChain.blockExplorers?.default.url || ''],
              }],
            });
          }
        }
      }

      // Get balance
      let balance = 0n;
      try {
        balance = await publicClient.getBalance({ address });
        console.log('[useWallet] Balance fetched:', balance.toString(), 'for', address);
      } catch (e) {
        console.error('[useWallet] Balance fetch failed:', e);
        // Fallback: use raw RPC
        try {
          const hex = await eth.request({ method: 'eth_getBalance', params: [address, 'latest'] });
          balance = BigInt(hex);
          console.log('[useWallet] Fallback balance:', balance.toString());
        } catch (e2) {
          console.error('[useWallet] Fallback also failed:', e2);
        }
      }

      setState({
        address,
        chainId: activeChain.id,
        isConnecting: false,
        isWrongChain: false,
        balance,
      });
    } catch (err) {
      console.error('Wallet connect failed:', err);
      setState((s) => ({ ...s, isConnecting: false }));
    }
  }, [hasEthereum]);

  // ── Disconnect ──────────────────────────────────────────
  const disconnect = useCallback(() => {
    setState({
      address: null,
      chainId: null,
      isConnecting: false,
      isWrongChain: false,
      balance: 0n,
    });
  }, []);

  // ── Auto-reconnect on mount ─────────────────────────────
  useEffect(() => {
    if (!hasEthereum) return;
    const eth = (window as any).ethereum;

    eth.request({ method: 'eth_accounts' }).then((accounts: string[]) => {
      if (accounts.length > 0) {
        connect();
      }
    });

    // Listen for account changes
    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnect();
      } else {
        connect();
      }
    };

    // Listen for chain changes
    const handleChainChanged = () => {
      connect();
    };

    eth.on?.('accountsChanged', handleAccountsChanged);
    eth.on?.('chainChanged', handleChainChanged);

    return () => {
      eth.removeListener?.('accountsChanged', handleAccountsChanged);
      eth.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [hasEthereum, connect, disconnect]);

  // ── Refresh balance ─────────────────────────────────────
  const refreshBalance = useCallback(async () => {
    if (!state.address) return;
    const balance = await publicClient.getBalance({ address: state.address });
    setState((s) => ({ ...s, balance }));
  }, [state.address]);

  return {
    ...state,
    connect,
    disconnect,
    refreshBalance,
    hasEthereum,
  };
}
