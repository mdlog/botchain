import React from 'react';
import { LayoutDashboard, ShoppingCart, Wallet, Sliders, Settings, Search, Terminal } from 'lucide-react';
import { cn } from '../lib/utils';
import { WalletConnect } from './WalletConnect';
import { useWalletContext } from '@/context/WalletContext';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'marketplace', label: 'Marketplace', icon: ShoppingCart },
  { id: 'compute', label: 'Compute Session', icon: Terminal },
  { id: 'financial', label: 'Financial Layer', icon: Wallet },
  { id: 'node', label: 'Node Management', icon: Sliders },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Layout({ children, activeTab, setActiveTab }: LayoutProps) {
  const { hasEthereum } = useWalletContext();

  return (
    <div className="flex min-h-screen bg-background font-sans text-on-background">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-outline-variant/10 bg-surface-container-lowest">
        <div className="flex items-center gap-3 p-8">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/20 text-primary">
            <span className="font-mono font-bold text-[10px]">BOT</span>
          </div>
          <span className="text-lg font-semibold tracking-tight text-primary">BOT CHAIN</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-4">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "group flex w-full items-center rounded-lg px-4 py-3 transition-all",
                activeTab === item.id
                  ? "bg-primary-container/10 text-primary border-l-4 border-primary shadow-[0_0_15px_rgba(0,163,255,0.2)]"
                  : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface border-l-4 border-transparent"
              )}
            >
              <item.icon className="mr-4 h-5 w-5" />
              <span className="text-sm">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="border-t border-outline-variant/10 p-6">
          <div className="flex items-center gap-3 rounded-xl bg-surface-container-low p-4">
            <div className="h-2 w-2 animate-pulse rounded-full bg-compute-active"></div>
            <div className="font-mono text-xs font-semibold text-on-surface-variant">NETWORK STATUS: OPTIMAL</div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex w-full flex-col pl-72">
        {/* Header */}
        <header className="fixed left-72 right-0 top-0 z-40 flex h-16 items-center justify-between border-b border-outline-variant/10 bg-surface/60 px-8 backdrop-blur-xl">
          <div className="flex w-96 items-center rounded-lg bg-surface-container-highest px-4 py-2">
            <Search className="h-4 w-4 text-outline" />
            <input
              type="text"
              placeholder="Search jobs or nodes..."
              className="ml-2 w-full bg-transparent text-sm text-on-surface outline-none placeholder:text-outline-variant"
            />
          </div>

                  <div className="flex items-center gap-6">
            <WalletConnect />
          </div>
        </header>

        {/* Page Content */}
        <main className="relative min-h-screen pt-16">
          {children}
        </main>
      </div>
    </div>
  );
}
