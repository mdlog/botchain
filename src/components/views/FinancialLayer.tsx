import { useEffect, useState } from 'react';
import { parseEther, type ReadContractReturnType } from 'viem';
import {
  Plus,
  TrendingUp,
  Cpu,
  ShieldCheck,
  Layers,
  Coins,
  ArrowDownToLine,
  Wallet,
} from 'lucide-react';
import { PageShell, PageHeader, SectionHeader } from '@/components/layout/PageShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Stat } from '@/components/ui/Stat';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select } from '@/components/ui/Field';
import { SkeletonStats, Skeleton } from '@/components/ui/Skeleton';
import { useWalletContext } from '@/context/WalletContext';
import { useToast } from '@/context/ToastContext';
import { useComputeIndexToken } from '@/hooks/useComputeIndexToken';
import { useComputeRegistry } from '@/hooks/useComputeRegistry';
import { formatBOT, formatBOTCompact, formatNodeId } from '@/lib/format';
import { describeTxError } from '@/lib/tx';
import type { computeIndexTokenAbi } from '@/config/abis';

/** One row of ComputeIndexToken.getDeposits, shaped by the generated ABI. */
type CifDeposit = ReadContractReturnType<typeof computeIndexTokenAbi, 'getDeposits'>[number];

const STEPS = [
  {
    title: 'Register and verify a node',
    body: 'Publish your hardware from My Nodes, then verify it. Only verified nodes can deposit.',
  },
  {
    title: 'Deposit compute revenue',
    body: 'Deposit the DGRAM your node earned. CIF is minted to you 1:1 against it.',
  },
  {
    title: 'Hold or trade CIF',
    body: 'CIF is a transferable ERC-20. Hold it for yield, or trade it on BDEX.',
  },
  {
    title: 'Withdraw whenever',
    body: 'Burn CIF to take DGRAM back out. A 0.5% fee stays in the protocol treasury.',
  },
];

/**
 * The amount fields are decimal text. Parsing them with BigInt() threw a
 * SyntaxError on anything with a decimal point — before any RPC call — and the
 * catch then blamed the chain for it.
 */
const AMOUNT_PATTERN = /^\d+(\.\d{1,18})?$/;

function isValidAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value.trim()) && Number(value) > 0;
}

function amountError(value: string): string | undefined {
  if (value.trim() === '') return undefined;
  if (!AMOUNT_PATTERN.test(value.trim())) return 'Numbers only, up to 18 decimal places.';
  if (Number(value) <= 0) return 'Enter an amount above zero.';
  return undefined;
}

export function FinancialLayer() {
  const { address } = useWalletContext();
  const toast = useToast();
  const {
    getBalance,
    getTotalSupply,
    getTVL,
    getIndexPrice,
    getDeposits,
    depositRevenue,
    withdraw,
  } = useComputeIndexToken();
  const { getProviderNodes, getNode } = useComputeRegistry();

  const [loading, setLoading] = useState(true);
  const [cifBalance, setCifBalance] = useState(0n);
  const [cifSupply, setCifSupply] = useState(0n);
  const [tvl, setTvl] = useState(0n);
  const [indexPrice, setIndexPrice] = useState(0n);
  const [deposits, setDeposits] = useState<CifDeposit[]>([]);
  const [nodes, setNodes] = useState<{ id: bigint; model: string; verified: boolean }[]>([]);
  const [txPending, setTxPending] = useState(false);

  // Deposit form
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositNodeId, setDepositNodeId] = useState('');
  const [depositAmount, setDepositAmount] = useState('1');

  // Withdraw form
  const [withdrawAmount, setWithdrawAmount] = useState('');

  async function refreshTotals() {
    if (!address) return;
    const [bal, supply, tvlVal, idxPrice] = await Promise.all([
      getBalance(address),
      getTotalSupply(),
      getTVL(),
      getIndexPrice(),
    ]);
    setCifBalance(bal);
    setCifSupply(supply);
    setTvl(tvlVal);
    setIndexPrice(idxPrice);
  }

  useEffect(() => {
    async function loadData() {
      if (!address) {
        setLoading(false);
        return;
      }
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
        setDeposits([...deps]);

        // Load provider nodes for deposit form
        const nodeIds = await getProviderNodes(address);
        const nodeDetails: { id: bigint; model: string; verified: boolean }[] = [];
        for (const id of nodeIds) {
          try {
            const node = await getNode(id);
            if (node) {
              nodeDetails.push({
                id,
                model: node.specs?.model || 'Unknown',
                verified: node.verified,
              });
            }
          } catch (err) {
            console.warn('[FinancialLayer] skipping node', id.toString(), err);
          }
        }
        setNodes(nodeDetails);
        const firstVerified = nodeDetails.find((n) => n.verified);
        if (firstVerified) setDepositNodeId(firstVerified.id.toString());
      } catch (err) {
        console.error('[FinancialLayer] Load failed:', err);
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, [address]);

  async function handleDeposit() {
    if (!address || !depositNodeId || !isValidAmount(depositAmount)) return;
    setTxPending(true);
    try {
      const hash = await depositRevenue(BigInt(depositNodeId), parseEther(depositAmount));
      setShowDeposit(false);
      setDepositAmount('');
      await refreshTotals();
      toast.success('Revenue deposited', {
        description: `${depositAmount} DGRAM locked, CIF minted at the current index price.`,
        txHash: hash,
      });
    } catch (err) {
      console.error('[FinancialLayer] deposit failed:', err);
      toast.error('Deposit was not accepted', { description: describeTxError(err) });
    } finally {
      setTxPending(false);
    }
  }

  async function handleWithdraw() {
    if (!address || !isValidAmount(withdrawAmount)) return;
    setTxPending(true);
    try {
      const hash = await withdraw(parseEther(withdrawAmount));
      setWithdrawAmount('');
      await refreshTotals();
      toast.success('Withdrawal complete', {
        description: `${withdrawAmount} CIF burned. DGRAM returned at the index price, less the 0.5% fee.`,
        txHash: hash,
      });
    } catch (err) {
      console.error('[FinancialLayer] withdraw failed:', err);
      toast.error('Withdrawal was not completed', { description: describeTxError(err) });
    } finally {
      setTxPending(false);
    }
  }

  const verifiedNodes = nodes.filter((n) => n.verified);

  const header = (
    <PageHeader
      title="Finance"
      description="Deposit compute revenue to mint CIF — fractional ownership of real GPU earnings on BOT Chain."
      actions={
        address && (
          <Button variant="primary" icon={Plus} onClick={() => setShowDeposit(true)}>
            Deposit revenue
          </Button>
        )
      }
    />
  );

  if (!address) {
    return (
      <PageShell>
        {header}
        <EmptyState
          icon={Wallet}
          title="Connect a wallet to manage CIF"
          description="Deposits, balances and withdrawals are all tied to the address you connect."
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      {header}

      {loading ? (
        <div className="flex flex-col gap-4">
          <SkeletonStats count={4} />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {/* ── Metrics ── */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Total value locked"
              value={formatBOTCompact(tvl)}
              unit="DGRAM"
              detail="backed by real compute revenue"
              icon={TrendingUp}
            />
            <Stat
              label="CIF supply"
              value={formatBOTCompact(cifSupply)}
              unit="CIF"
              detail={cifSupply > 0n ? '100% backed' : 'nothing minted yet'}
              icon={Layers}
              tone="accent"
            />
            <Stat
              label="Index price"
              value={indexPrice > 0n ? formatBOT(indexPrice) : '—'}
              unit="DGRAM / CIF"
              detail={tvl > 0n && cifSupply > 0n ? 'TVL ÷ supply' : 'no deposits yet'}
              icon={Coins}
            />
            <Stat
              label="Your CIF"
              value={formatBOTCompact(cifBalance)}
              unit="CIF"
              detail={`≈ ${formatBOTCompact(
                indexPrice > 0n ? (cifBalance * indexPrice) / 10n ** 18n : 0n,
              )} DGRAM`}
              icon={Wallet}
              tone="success"
            />
          </section>

          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
            <div className="flex flex-col gap-6 xl:col-span-2">
              {/* ── Deposits ── */}
              <section>
                <SectionHeader
                  icon={Layers}
                  title="Your deposits"
                  description="Revenue you've tokenised, node by node"
                />
                {deposits.length === 0 ? (
                  <EmptyState
                    icon={Cpu}
                    title="No deposits yet"
                    description="Deposit revenue from a verified node to mint your first CIF."
                    action={
                      <Button variant="primary" icon={Plus} onClick={() => setShowDeposit(true)}>
                        Deposit revenue
                      </Button>
                    }
                  />
                ) : (
                  <ul className="flex flex-col gap-2">
                    {deposits.map((dep, idx) => {
                      const { nodeId, amountWei: amount, mintedTokens: minted } = dep;
                      return (
                        <li key={idx}>
                          <Card className="flex items-center justify-between gap-4 p-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-compute-active/12 text-compute-active">
                                <Cpu className="h-4 w-4" aria-hidden />
                              </span>
                              <div className="min-w-0">
                                <p
                                  className="font-mono text-label text-on-surface"
                                  title={nodeId?.toString()}
                                >
                                  {formatNodeId(nodeId ?? 0n)}
                                </p>
                                <p className="text-caption text-on-surface-variant">
                                  <span className="font-mono">{formatBOT(amount)}</span> DGRAM
                                  deposited
                                </p>
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="font-mono text-label text-primary">
                                {formatBOT(minted)}
                              </p>
                              <p className="text-eyebrow uppercase text-outline">CIF minted</p>
                            </div>
                          </Card>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {/* ── Withdraw ── */}
              {cifBalance > 0n && (
                <section>
                  <SectionHeader
                    icon={ArrowDownToLine}
                    title="Withdraw"
                    description="Burn CIF to take DGRAM back out"
                  />
                  <Card className="p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <Field
                        label="Amount to burn"
                        hint={`Available: ${formatBOT(cifBalance)} CIF · redeemed at the index price, less a 0.5% fee`}
                        error={amountError(withdrawAmount)}
                        className="flex-1"
                      >
                        {(p) => (
                          <Input
                            {...p}
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={withdrawAmount}
                            onChange={(e) => setWithdrawAmount(e.target.value)}
                          />
                        )}
                      </Field>
                      <Button
                        variant="secondary"
                        size="lg"
                        loading={txPending}
                        disabled={!isValidAmount(withdrawAmount)}
                        onClick={() => void handleWithdraw()}
                        className="mb-7 sm:mb-7"
                      >
                        {txPending ? 'Confirming' : 'Burn and withdraw'}
                      </Button>
                    </div>
                  </Card>
                </section>
              )}
            </div>

            {/* ── Side column ── */}
            <div className="flex flex-col gap-4">
              <Card className="p-5">
                <h2 className="text-subtitle text-on-surface">How CIF works</h2>
                {/* Numbered because this genuinely is a sequence — each step
                    depends on the one before it. */}
                <ol className="mt-4 flex flex-col gap-4">
                  {STEPS.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/12 font-mono text-caption font-semibold text-primary">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-label text-on-surface">{step.title}</p>
                        <p className="mt-0.5 text-caption text-on-surface-variant">{step.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>

              <Card className="border-primary/25 bg-primary/[0.04] p-5">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <h2 className="text-subtitle text-primary">Backed by real assets</h2>
                </div>
                <p className="mt-2 text-body text-on-surface-variant">
                  Every CIF token represents a share of{' '}
                  <strong className="font-medium text-on-surface">real compute revenue</strong>{' '}
                  earned by verified GPU clusters on the network.
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-outline-variant bg-surface-container p-3">
                    <dt className="text-eyebrow uppercase text-outline">Locked</dt>
                    <dd className="mt-1 font-mono text-label text-on-surface">
                      {formatBOTCompact(tvl)}{' '}
                      <span className="text-caption text-outline">DGRAM</span>
                    </dd>
                  </div>
                  <div className="rounded-lg border border-outline-variant bg-surface-container p-3">
                    <dt className="text-eyebrow uppercase text-outline">Minted</dt>
                    <dd className="mt-1 font-mono text-label text-on-surface">
                      {formatBOTCompact(cifSupply)}{' '}
                      <span className="text-caption text-outline">CIF</span>
                    </dd>
                  </div>
                </dl>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* ── Deposit dialog ── */}
      <Modal
        open={showDeposit}
        onClose={() => setShowDeposit(false)}
        icon={Plus}
        title="Deposit revenue"
        description="Lock DGRAM earned by a verified node and mint CIF against it."
        footer={
          verifiedNodes.length > 0 ? (
            <>
              <Button
                variant="primary"
                fullWidth
                loading={txPending}
                disabled={!isValidAmount(depositAmount)}
                onClick={() => void handleDeposit()}
              >
                {txPending ? 'Confirming' : 'Deposit and mint CIF'}
              </Button>
              <Button variant="ghost" onClick={() => setShowDeposit(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="secondary" fullWidth onClick={() => setShowDeposit(false)}>
              Close
            </Button>
          )
        }
      >
        {verifiedNodes.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No verified nodes"
            description="Only attested nodes can deposit revenue. Register a node in My Nodes; the registry verifier attests it."
            className="border-0 bg-transparent py-6"
          />
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Node">
              {(p) => (
                <Select
                  {...p}
                  value={depositNodeId}
                  onChange={(e) => setDepositNodeId(e.target.value)}
                >
                  {verifiedNodes.map((n) => (
                    <option key={n.id.toString()} value={n.id.toString()}>
                      {formatNodeId(n.id)} — {n.model}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="Amount (DGRAM)"
              hint="Capped at the revenue this node has actually settled on chain."
              error={amountError(depositAmount)}
            >
              {(p) => (
                <Input
                  {...p}
                  type="text"
                  inputMode="decimal"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                />
              )}
            </Field>

            <div className="flex items-baseline justify-between rounded-lg border border-outline-variant bg-surface-container p-3.5">
              <span className="text-label text-on-surface-variant">You receive</span>
              <span className="font-mono text-title text-primary">
                {isValidAmount(depositAmount) && indexPrice > 0n
                  ? formatBOT((parseEther(depositAmount) * 10n ** 18n) / indexPrice, 4)
                  : '0'}
                <span className="ml-1.5 text-caption font-normal text-on-surface-variant">CIF</span>
              </span>
            </div>
          </div>
        )}
      </Modal>
    </PageShell>
  );
}
