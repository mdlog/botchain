import { useEffect, useRef, useState } from 'react';
import { Wallet, Copy, Check, ExternalLink, Power, AlertTriangle } from 'lucide-react';
import { useWalletContext } from '@/context/WalletContext';
import { activeChain } from '@/config/chain';
import { formatAddress, formatBOT } from '@/lib/format';
import { Button } from '@/components/ui/Button';

const EXPLORER = activeChain.blockExplorers?.default?.url ?? '';

/**
 * Account control for the top bar. Disconnect used to be a "✕" glyph
 * appended to the address — easy to hit by accident and impossible to
 * label — so it now lives in a menu alongside copy and explorer.
 */
export function WalletConnect() {
  const { address, balance, isConnecting, connect, disconnect, hasEthereum, isWrongChain } =
    useWalletContext();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!address) {
    return (
      <Button
        variant="primary"
        icon={Wallet}
        onClick={() => void connect()}
        loading={isConnecting}
        disabled={!hasEthereum}
        title={hasEthereum ? undefined : 'No Ethereum wallet detected in this browser'}
      >
        {isConnecting ? 'Connecting' : hasEthereum ? 'Connect wallet' : 'No wallet found'}
      </Button>
    );
  }

  function copyAddress() {
    void navigator.clipboard?.writeText(address!);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-lg border border-outline-variant bg-surface-container py-1.5 pl-2 pr-3 transition-colors hover:border-outline hover:bg-surface-container-high"
      >
        <span
          aria-hidden
          className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 font-mono text-eyebrow text-primary"
        >
          {address.slice(2, 4).toUpperCase()}
        </span>
        <span className="flex flex-col items-start leading-none">
          <span className="font-mono text-label text-on-surface">{formatAddress(address)}</span>
          <span className="mt-1 font-mono text-eyebrow tracking-normal text-on-surface-variant">
            {formatBOT(balance)} {activeChain.nativeCurrency.symbol}
          </span>
        </span>
        {isWrongChain && (
          <AlertTriangle className="h-3.5 w-3.5 text-compute-idle" aria-label="Wrong network" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-outline-variant bg-surface-container shadow-xl shadow-black/40"
        >
          <div className="border-b border-outline-variant p-3">
            <p className="text-eyebrow uppercase text-on-surface-variant">Connected account</p>
            <p className="mt-1 break-all font-mono text-caption text-on-surface">{address}</p>
          </div>

          {isWrongChain && (
            <div className="flex items-start gap-2 border-b border-outline-variant bg-compute-idle/10 p-3">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-compute-idle"
                aria-hidden
              />
              <p className="text-caption text-on-surface-variant">
                Switch your wallet to {activeChain.name} to sign transactions.
              </p>
            </div>
          )}

          <div className="p-1.5">
            <MenuItem icon={copied ? Check : Copy} onClick={copyAddress}>
              {copied ? 'Address copied' : 'Copy address'}
            </MenuItem>
            {EXPLORER && (
              <MenuItem icon={ExternalLink} href={`${EXPLORER}/address/${address}`}>
                View on explorer
              </MenuItem>
            )}
            <MenuItem
              icon={Power}
              danger
              onClick={() => {
                setOpen(false);
                disconnect();
              }}
            >
              Disconnect
            </MenuItem>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  children,
  onClick,
  href,
  danger,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
}) {
  const className =
    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-label transition-colors ' +
    (danger
      ? 'text-on-surface-variant hover:bg-compute-down/10 hover:text-compute-down'
      : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface');

  if (href) {
    return (
      <a role="menuitem" href={href} target="_blank" rel="noreferrer" className={className}>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {children}
      </a>
    );
  }
  return (
    <button role="menuitem" onClick={onClick} className={className}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {children}
    </button>
  );
}
