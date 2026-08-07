import { useWalletContext } from '@/context/WalletContext';
import { formatAddress, formatBOT } from '@/lib/format';

export function WalletConnect() {
  const { address, balance, isConnecting, connect, disconnect, hasEthereum } = useWalletContext();

  if (!address) {
    return (
      <button
        onClick={connect}
        disabled={isConnecting || !hasEthereum}
        className="flex items-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2563eb] disabled:opacity-50"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12V7H5a2 2 0 010-4h14v4" />
          <path d="M3 5v14a2 2 0 002 2h16v-5" />
          <path d="M18 12a2 2 0 000 4h4v-4z" />
        </svg>
        {isConnecting ? 'Connecting...' : hasEthereum ? 'Connect Wallet' : 'No Wallet'}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col items-end">
        <span className="text-xs font-mono text-[#9ca3af]">
          {formatBOT(balance)} DGRAM
        </span>
        <button
          onClick={disconnect}
          className="text-xs font-mono text-[#3b82f6] hover:text-[#60a5fa] hover:underline"
          title="Disconnect"
        >
          {formatAddress(address)} ✕
        </button>
      </div>
      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center text-white text-sm font-bold">
        {address.slice(2, 4).toUpperCase()}
      </div>
    </div>
  );
}
