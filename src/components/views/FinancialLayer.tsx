import React, { useEffect, useState } from 'react';
import { Plus, TrendingUp, Cpu, ArrowRight, ArrowDown, ShieldCheck, Server } from 'lucide-react';
import { useWalletContext } from '@/context/WalletContext';
import { useComputeIndexToken } from '@/hooks/useComputeIndexToken';
import { useComputeRegistry } from '@/hooks/useComputeRegistry';
import { formatBOT, formatBOTCompact, formatAddress } from '@/lib/format';

export function FinancialLayer() {
  const { address } = useWalletContext();
  const { getBalance, getTotalSupply, getTVL, getIndexPrice, getDeposits, depositRevenue, withdraw } = useComputeIndexToken();
  const { getProviderNodes, getNode } = useComputeRegistry();

  const [loading, setLoading] = useState(true);
  const [cifBalance, setCifBalance] = useState(0n);
  const [cifSupply, setCifSupply] = useState(0n);
  const [tvl, setTvl] = useState(0n);
  const [indexPrice, setIndexPrice] = useState(0n);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [nodes, setNodes] = useState<{id: bigint, model: string, verified: boolean}[]>([]);
  const [txPending, setTxPending] = useState(false);

  // Deposit form
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositNodeId, setDepositNodeId] = useState('');
  const [depositAmount, setDepositAmount] = useState('1');

  // Withdraw form
  const [withdrawAmount, setWithdrawAmount] = useState('');

  useEffect(() => {
    async function loadData() {
      if (!address) { setLoading(false); return; }
      setLoading(true);
      try {
        const [bal, supply, tvlVal, idxPrice, deps] = await Promise.all([
          getBalance(address),
          getTotalSupply(),
          getTVL(),
          getIndexPrice(),
          getDeposits(address),
        ]);
        setCifBalance(bal);
        setCifSupply(supply);
        setTvl(tvlVal);
        setIndexPrice(idxPrice);
        setDeposits(deps as any[]);

        // Load provider nodes for deposit form
        const nodeIds = await getProviderNodes(address);
        const nodeDetails: {id: bigint, model: string, verified: boolean}[] = [];
        for (const id of nodeIds) {
          try {
            const node = await getNode(id) as any;
            if (node) {
              nodeDetails.push({
                id,
                model: node.specs?.model || 'Unknown',
                verified: node.verified,
              });
            }
          } catch {}
        }
        setNodes(nodeDetails);
        if (nodeDetails.length > 0) setDepositNodeId(nodeDetails[0].id.toString());
      } catch (err) {
        console.error('[FinancialLayer] Load failed:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [address]);

  async function handleDeposit() {
    if (!address || !depositNodeId) return;
    setTxPending(true);
    try {
      const value = BigInt(depositAmount) * 10n ** 18n;
      const hash = await depositRevenue(BigInt(depositNodeId), value);
      if (hash) {
        alert(`Deposited! TX: ${hash}`);
        setShowDeposit(false);
        // Reload
        const [bal, supply, tvlVal] = await Promise.all([
          getBalance(address),
          getTotalSupply(),
          getTVL(),
        ]);
        setCifBalance(bal);
        setCifSupply(supply);
        setTvl(tvlVal);
      }
    } catch (err) {
      console.error('[FinancialLayer] Deposit failed:', err);
      alert('Deposit failed. Make sure the node is verified.');
    } finally {
      setTxPending(false);
    }
  }

  async function handleWithdraw() {
    if (!address || !withdrawAmount) return;
    setTxPending(true);
    try {
      const amount = BigInt(withdrawAmount) * 10n ** 18n;
      const hash = await withdraw(amount);
      if (hash) {
        alert(`Withdrawn! TX: ${hash}`);
        setWithdrawAmount('');
        const [bal, supply, tvlVal] = await Promise.all([
          getBalance(address),
          getTotalSupply(),
          getTVL(),
        ]);
        setCifBalance(bal);
        setCifSupply(supply);
        setTvl(tvlVal);
      }
    } catch (err) {
      console.error('[FinancialLayer] Withdraw failed:', err);
      alert('Withdraw failed.');
    } finally {
      setTxPending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center pt-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="relative flex w-full flex-col">
      <div className="relative z-10 space-y-6 p-4 md:p-8 lg:space-y-12">
        {/* Header */}
        <header className="flex flex-col items-start justify-between gap-6 border-b border-outline-variant/10 pb-6 md:flex-row md:items-end">
          <div>
            <h1 className="text-[48px] font-bold leading-[1.1] tracking-tight text-on-background">Financial Layer</h1>
            <p className="mt-2 max-w-2xl text-lg text-on-surface-variant">
              Deposit compute revenue to mint CIF tokens — fractional ownership of real-world GPU assets on BOT Chain.
            </p>
          </div>
          {address && (
            <button
              onClick={() => setShowDeposit(!showDeposit)}
              className="flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 font-mono text-[12px] font-semibold text-on-primary shadow-[0_0_20px_rgba(152,203,255,0.3)] transition-all hover:bg-primary-fixed-dim"
            >
              <Plus className="h-4 w-4" />
              DEPOSIT REVENUE
            </button>
          )}
        </header>

        {!address ? (
          <div className="flex flex-col items-center justify-center rounded-2xl bg-surface-container-low p-16">
            <Cpu className="mb-4 h-12 w-12 text-outline" />
            <h2 className="mb-2 text-lg font-semibold text-on-surface">Connect Wallet to View Financial Layer</h2>
            <p className="text-sm text-on-surface-variant">Connect your wallet to manage CIF tokens and deposits.</p>
          </div>
        ) : (
          <>
            {/* Metrics Overview */}
            <section className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              <div className="group relative overflow-hidden rounded-2xl bg-surface-container-low p-6 backdrop-blur-xl">
                <div className="mb-2 font-mono text-[12px] font-semibold text-outline">TOTAL VALUE LOCKED</div>
                <div className="flex items-baseline gap-1 font-mono text-[32px] font-semibold text-on-surface">
                  {formatBOTCompact(tvl)}
                </div>
                <div className="mt-1 font-mono text-xs text-outline">DGRAM</div>
                <div className="mt-4 flex items-center gap-2 text-sm text-compute-active">
                  <TrendingUp className="h-4 w-4" />
                  <span>Backed by real compute revenue</span>
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-2xl border border-primary/20 bg-surface-container-low p-6 backdrop-blur-xl">
                <div className="mb-2 font-mono text-[12px] font-semibold text-primary">CIF SUPPLY</div>
                <div className="font-mono text-[32px] font-semibold text-on-surface">{formatBOTCompact(cifSupply)}</div>
                <div className="mt-1 font-mono text-xs text-outline">CIF tokens minted</div>
                <div className="mt-4 flex w-full flex-col gap-1">
                  <div className="flex justify-between text-xs text-on-surface-variant">
                    <span>Backing Ratio</span>
                    <span className="text-primary">{cifSupply > 0n ? '100%' : '—'}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: cifSupply > 0n ? '100%' : '0%' }}></div>
                  </div>
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-2xl bg-surface-container-low p-6 backdrop-blur-xl">
                <div className="mb-2 font-mono text-[12px] font-semibold text-outline">INDEX PRICE</div>
                <div className="font-mono text-[32px] font-semibold text-secondary-fixed">
                  {indexPrice > 0n ? formatBOT(indexPrice) : '—'}
                </div>
                <div className="mt-1 font-mono text-xs text-outline">DGRAM per CIF</div>
                <div className="mt-4 text-xs text-on-surface-variant">
                  {tvl > 0n && cifSupply > 0n ? 'TVL / Total Supply' : 'No deposits yet'}
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-2xl border border-compute-active/20 bg-surface-container-low p-6 backdrop-blur-xl">
                <div className="mb-2 font-mono text-[12px] font-semibold text-compute-active">YOUR CIF BALANCE</div>
                <div className="font-mono text-[32px] font-semibold text-on-surface">{formatBOTCompact(cifBalance)}</div>
                <div className="mt-1 font-mono text-xs text-outline">CIF tokens</div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-on-surface-variant">≈ {formatBOTCompact(indexPrice > 0n ? (BigInt(cifBalance) * BigInt(indexPrice)) / 10n**18n : 0n)} DGRAM</span>
                </div>
              </div>
            </section>

            {/* Deposit Form */}
            {showDeposit && (
              <div className="rounded-2xl bg-surface-container-low p-6 border border-primary/20">
                <h3 className="mb-3 text-lg font-semibold text-on-surface">Deposit Revenue → Mint CIF</h3>
                {nodes.filter(n => n.verified).length === 0 ? (
                  <p className="text-sm text-on-surface-variant">
                    No verified nodes found. Register and verify a node in Node Management first.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <label className="mb-2 block font-mono text-xs font-semibold uppercase text-outline">Select Node</label>
                      <select value={depositNodeId} onChange={e => setDepositNodeId(e.target.value)}
                        className="w-full rounded-lg border border-outline-variant/20 bg-surface-container px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary">
                        {nodes.filter(n => n.verified).map(n => (
                          <option key={n.id.toString()} value={n.id.toString()}>#{n.id.toString()} — {n.model}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-2 block font-mono text-xs font-semibold uppercase text-outline">Amount (DGRAM)</label>
                      <input type="text" value={depositAmount} onChange={e => setDepositAmount(e.target.value)}
                        className="w-full rounded-lg border border-outline-variant/20 bg-surface-container px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary" />
                    </div>
                    <div className="flex items-end">
                      <button onClick={handleDeposit} disabled={txPending}
                        className="w-full rounded-lg bg-primary px-6 py-2.5 font-mono text-sm font-semibold text-on-primary disabled:opacity-50">
                        {txPending ? 'Submitting...' : 'Deposit & Mint CIF'}
                      </button>
                    </div>
                  </div>
                )}
                <p className="mt-3 text-xs text-outline">
                  Mint ratio: 1 DGRAM = 1 CIF (MVP). AI-driven dynamic ratio coming in production.
                </p>
              </div>
            )}

            {/* Main Grid */}
            <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
              {/* Left: Your Deposits */}
              <div className="flex flex-col gap-6 xl:col-span-8">
                <section className="rounded-3xl bg-surface-container-low p-6 backdrop-blur-md md:p-8">
                  <div className="mb-8 flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-on-surface">Your CIF Deposits</h2>
                      <p className="mt-1 text-sm text-on-surface-variant">Revenue-backed tokenized positions.</p>
                    </div>
                  </div>

                  {deposits.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8">
                      <Cpu className="mb-3 h-10 w-10 text-outline" />
                      <p className="text-sm text-on-surface-variant">No deposits yet. Click "Deposit Revenue" to mint your first CIF tokens.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {deposits.map((dep: any, idx: number) => (
                        <div key={idx} className="rounded-xl border border-outline-variant/10 bg-surface-container p-5 transition-colors hover:border-primary/20">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-compute-active/10 text-compute-active">
                                <Cpu className="h-5 w-5" />
                              </div>
                              <div>
                                <div className="font-mono text-sm text-on-surface">Node #{dep.nodeId?.toString() || dep[0]?.toString()}</div>
                                <div className="text-xs text-on-surface-variant">
                                  Deposited: {formatBOT(dep.amountWei || dep[1])} DGRAM
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-mono text-lg text-primary">{formatBOT(dep.mintedTokens || dep[2])}</div>
                              <div className="font-mono text-[10px] uppercase text-outline">CIF Minted</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Withdraw Section */}
                {cifBalance > 0n && (
                  <section className="rounded-3xl bg-surface-container-low p-6 backdrop-blur-md md:p-8">
                    <h2 className="mb-3 text-lg font-semibold text-on-surface">Withdraw (Burn CIF → DGRAM)</h2>
                    <p className="mb-4 text-sm text-on-surface-variant">Burn CIF tokens to withdraw DGRAM. 0.5% withdrawal fee applies.</p>
                    <div className="flex flex-col gap-3 md:flex-row">
                      <input
                        type="text"
                        placeholder="Amount (CIF)"
                        value={withdrawAmount}
                        onChange={e => setWithdrawAmount(e.target.value)}
                        className="flex-1 rounded-lg border border-outline-variant/20 bg-surface-container px-4 py-2.5 text-sm text-on-surface outline-none focus:border-primary"
                      />
                      <button
                        onClick={handleWithdraw}
                        disabled={txPending || !withdrawAmount}
                        className="rounded-lg border border-primary/30 bg-primary/10 px-6 py-2.5 font-mono text-sm font-semibold text-primary disabled:opacity-50"
                      >
                        {txPending ? 'Withdrawing...' : 'Burn & Withdraw'}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-outline">
                      Available: {formatBOT(cifBalance)} CIF · Fee: 0.5%
                    </p>
                  </section>
                )}
              </div>

              {/* Right Column */}
              <div className="flex flex-col gap-6 xl:col-span-4">
                {/* How It Works */}
                <section className="rounded-3xl bg-surface-container-low p-6 backdrop-blur-md">
                  <h2 className="mb-3 text-lg font-semibold text-on-surface">How CIF Works</h2>
                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 font-mono text-sm font-bold text-primary">1</div>
                      <div>
                        <div className="text-sm font-semibold text-on-surface">Register & Verify Node</div>
                        <p className="text-xs text-on-surface-variant">Register GPU hardware in Node Management, get verified.</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 font-mono text-sm font-bold text-primary">2</div>
                      <div>
                        <div className="text-sm font-semibold text-on-surface">Deposit Revenue</div>
                        <p className="text-xs text-on-surface-variant">Deposit DGRAM earned from compute jobs. Minted 1:1 as CIF tokens.</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 font-mono text-sm font-bold text-primary">3</div>
                      <div>
                        <div className="text-sm font-semibold text-on-surface">Trade or Hold CIF</div>
                        <p className="text-xs text-on-surface-variant">CIF tokens are transferable ERC-20. Trade on BDEX or hold for yield.</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 font-mono text-sm font-bold text-primary">4</div>
                      <div>
                        <div className="text-sm font-semibold text-on-surface">Withdraw Anytime</div>
                        <p className="text-xs text-on-surface-variant">Burn CIF to withdraw DGRAM. 0.5% fee stays in protocol treasury.</p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* RWA Badge */}
                <section className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-6">
                  <div className="mb-3 flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    <h3 className="font-mono text-sm font-semibold uppercase tracking-wider text-primary">RWA Verified</h3>
                  </div>
                  <p className="text-sm text-on-surface-variant">
                    CIF tokens represent fractional ownership of <strong className="text-on-surface">real compute revenue</strong> from verified GPU clusters on BOT Chain DePIN network.
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-surface-container p-3">
                      <div className="font-mono text-[10px] uppercase text-outline">TVL</div>
                      <div className="font-mono text-lg text-on-surface">{formatBOTCompact(tvl)}</div>
                      <div className="font-mono text-[10px] text-outline">DGRAM</div>
                    </div>
                    <div className="rounded-lg bg-surface-container p-3">
                      <div className="font-mono text-[10px] uppercase text-outline">CIF Supply</div>
                      <div className="font-mono text-lg text-on-surface">{formatBOTCompact(cifSupply)}</div>
                      <div className="font-mono text-[10px] text-outline">Tokens</div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
