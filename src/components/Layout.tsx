import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Compass,
  Terminal,
  Wallet,
  Server,
  Settings,
  Menu,
  X,
  Layers,
} from 'lucide-react';
import { Logo } from './Logo';
import { cn } from '../lib/utils';
import { WalletConnect } from './WalletConnect';
import { LeaseMeter } from './LeaseMeter';
import { useWalletContext } from '@/context/WalletContext';
import { useComputeIndexToken } from '@/hooks/useComputeIndexToken';
import { formatBOTCompact } from '@/lib/format';
import { activeChain } from '@/config/chain';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

/** Nav is grouped by whose data it shows: the network's, or yours.
 *  With six flat items that distinction was invisible. */
const NAV_GROUPS = [
  {
    label: 'Network',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'marketplace', label: 'Explore', icon: Compass },
    ],
  },
  {
    label: 'Your compute',
    items: [
      { id: 'compute', label: 'Execute', icon: Terminal },
      { id: 'node', label: 'My Nodes', icon: Server },
      { id: 'financial', label: 'Finance', icon: Wallet },
    ],
  },
  {
    label: null,
    items: [{ id: 'settings', label: 'Settings', icon: Settings }],
  },
] as const;

export function Layout({ children, activeTab, setActiveTab }: LayoutProps) {
  const { address, hasEthereum, isWrongChain } = useWalletContext();
  const { getBalance } = useComputeIndexToken();
  const [cifBalance, setCifBalance] = useState(0n);
  const [navOpen, setNavOpen] = useState(false);

  // ── Fetch connected wallet's CIF balance for the global header ──
  useEffect(() => {
    if (!address) {
      setCifBalance(0n);
      return;
    }
    let active = true;
    getBalance(address)
      .then((bal) => active && setCifBalance(bal))
      .catch((err) => console.error('[Layout] CIF balance load failed:', err));
    return () => {
      active = false;
    };
  }, [address, getBalance]);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setNavOpen(false);
  }, [activeTab]);

  /**
   * The drawer announces itself as `aria-modal`, so it has to behave like one:
   * Escape closes it, focus moves inside and is restored on close, Tab stays
   * within it, and the page behind it stops scrolling. Announcing the role
   * without the behaviour is worse than not announcing it — a screen-reader
   * user is told they are in a dialog and then Tab walks the page behind it.
   */
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!navOpen) return;
    const restoreFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = () =>
      Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    focusable()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNavOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      restoreFocus?.focus();
    };
  }, [navOpen]);

  const nav = (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-2" aria-label="Main">
      {NAV_GROUPS.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-0.5">
          {group.label && (
            <span className="mb-1 px-3 text-eyebrow uppercase text-outline">{group.label}</span>
          )}
          {group.items.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-label transition-colors',
                  // Active has to out-rank hover, so it carries weight and the
                  // brand hue as well as a tint — a tint alone sat at almost
                  // the same luminance as the hover surface.
                  isActive
                    ? 'bg-primary/15 font-semibold text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container/80 hover:text-on-surface',
                )}
              >
                {/* Active marker sits in the gutter so labels stay aligned —
                    the old border-l-4 shifted text by 4px on selection. */}
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary transition-opacity',
                    isActive ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const networkStatus = !hasEthereum
    ? { tone: 'text-outline', live: false, text: 'Wallet not detected' }
    : isWrongChain
      ? { tone: 'text-compute-idle', live: false, text: 'Wrong network' }
      : address
        ? { tone: 'text-compute-active', live: true, text: activeChain.name }
        : { tone: 'text-outline', live: false, text: 'Not connected' };

  const sidebarBody = (
    <>
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
        <Logo size={28} />
        <span className="text-subtitle tracking-tight text-on-surface">BotCompute</span>
      </div>

      {nav}

      {/* Real connection state, not a hardcoded "OPTIMAL" banner. */}
      <div className="shrink-0 border-t border-outline-variant p-3">
        <div className="flex items-center gap-2.5 rounded-lg bg-surface-container-low px-3 py-2.5">
          <span
            className={cn(
              'signal-dot',
              networkStatus.live && 'signal-dot--live',
              networkStatus.tone,
            )}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-eyebrow uppercase text-outline">Network</p>
            <p className="truncate text-caption text-on-surface-variant">{networkStatus.text}</p>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background font-sans text-on-background">
      {/* ── Sidebar: fixed rail on desktop ── */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-outline-variant bg-surface-container-lowest lg:flex">
        {sidebarBody}
      </aside>

      {/* ── Sidebar: off-canvas drawer below lg ── */}
      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setNavOpen(false)}
            aria-hidden
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-[280px] flex-col border-r border-outline-variant bg-surface-container-lowest"
          >
            <button
              onClick={() => setNavOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-4 rounded-lg p-1.5 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              <X className="h-4 w-4" />
            </button>
            {sidebarBody}
          </aside>
        </div>
      )}

      <div className="flex min-h-screen flex-col lg:pl-[248px]">
        {/* ── Top bar ── */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-outline-variant bg-background/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="-ml-1 rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 lg:hidden">
            <Logo size={24} />
            <span className="text-label font-semibold text-on-surface">BotCompute</span>
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <LeaseMeter onOpen={() => setActiveTab('compute')} />

            {address && (
              <button
                onClick={() => setActiveTab('financial')}
                title="View CIF holdings"
                className="hidden items-center gap-2 rounded-lg border border-outline-variant bg-surface-container px-3 py-1.5 transition-colors hover:border-outline hover:bg-surface-container-high sm:flex"
              >
                <Layers className="h-3.5 w-3.5 text-outline" aria-hidden />
                <span className="flex flex-col items-start leading-none">
                  <span className="text-eyebrow uppercase text-on-surface-variant">CIF</span>
                  <span className="mt-1 font-mono text-label text-on-surface">
                    {formatBOTCompact(cifBalance)}
                  </span>
                </span>
              </button>
            )}

            <WalletConnect />
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
