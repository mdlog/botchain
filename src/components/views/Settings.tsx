import React, { useState, useEffect, useCallback } from 'react';
import {
  Radio,
  Globe,
  FileCode2,
  User,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  Save,
  Power,
  Info,
  Cpu,
  Gauge,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { PageShell, PageHeader } from '@/components/layout/PageShell';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { useWalletContext } from '@/context/WalletContext';
import { useToast } from '@/context/ToastContext';
import { agentRegistryAbi, priceOracleAbi } from '@/config/abis';
import { activeChain, CONTRACTS, publicClient } from '@/config/chain';
import { useComputeRegistry } from '@/hooks/useComputeRegistry';
import { getPricingEngine } from '@/lib/pricing';
import { getProviderAgentUrlFromChain } from '@/lib/agentRegistry';
import { formatBOT, timeAgo } from '@/lib/format';
import { usePriceOracle, type OraclePrice } from '@/hooks/usePriceOracle';
import { describeTxError, sendTx } from '@/lib/tx';
import { cn } from '@/lib/utils';

const EXPLORER = activeChain.blockExplorers.default.url;

// Safe time-ago wrapper for on-chain timestamps (0 = never updated).
function timeAgoSafe(ts: number): string {
  if (!ts || ts <= 0) return 'never';
  return timeAgo(ts);
}

const CONTRACT_LABELS: { key: keyof typeof CONTRACTS; label: string }[] = [
  { key: 'ComputeRegistry', label: 'Compute Registry' },
  { key: 'ComputeMarketplace', label: 'Compute Marketplace' },
  { key: 'ComputeIndexToken', label: 'Compute Index Token (CIF)' },
  { key: 'PriceOracle', label: 'Price Oracle' },
  { key: 'AgentRegistry', label: 'Agent Registry' },
];

// ── Storage keys ──
const REFRESH_KEY = 'botchain-refresh-interval';

export function Settings() {
  const { address, chainId, isWrongChain, balance, disconnect } = useWalletContext();
  const toast = useToast();

  // ── Preferences (persisted to localStorage) ──
  const [refreshInterval, setRefreshInterval] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    return Number(localStorage.getItem(REFRESH_KEY) ?? 0);
  });

  useEffect(() => {
    localStorage.setItem(REFRESH_KEY, String(refreshInterval));
  }, [refreshInterval]);

  // ── Oracle prices state ──
  const { getAllPrices } = usePriceOracle();
  const { getTotalActiveNodes } = useComputeRegistry();
  const [oraclePrices, setOraclePrices] = useState<OraclePrice[]>([]);
  const [oracleFloor, setOracleFloor] = useState(0n);
  const [oracleLoading, setOracleLoading] = useState(false);
  const [oracleOperator, setOracleOperator] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);

  const loadOraclePrices = useCallback(async () => {
    setOracleLoading(true);
    try {
      const { prices, floor } = await getAllPrices();
      setOraclePrices(prices);
      setOracleFloor(floor);
    } catch (err) {
      console.error('[Settings] oracle prices load failed:', err);
    } finally {
      setOracleLoading(false);
    }
  }, [getAllPrices]);

  useEffect(() => {
    void loadOraclePrices();
  }, [loadOraclePrices]);

  useEffect(() => {
    publicClient
      .readContract({
        address: CONTRACTS.PriceOracle,
        abi: priceOracleAbi,
        functionName: 'aiOperator',
      })
      .then(setOracleOperator)
      .catch((err: unknown) => console.warn('[Settings] oracle operator lookup failed:', err));
  }, []);

  const isOracleOperator =
    oracleOperator !== null && address?.toLowerCase() === oracleOperator.toLowerCase();

  /**
   * Reprice the catalog with the AI engine and write the result on chain. This
   * is the step that makes the oracle AI-driven rather than a table seeded once
   * at deploy time — the contract only accepts it from the aiOperator.
   */
  async function handlePushPrices() {
    setPushing(true);
    try {
      const activeNodes = Number(await getTotalActiveNodes());
      const written = await getPricingEngine().pushPricesToOracle(0.5, activeNodes);
      await loadOraclePrices();
      toast.success(`${written.length} rates published on-chain`, {
        description: 'The marketplace prices every new lease from these.',
        txHash: written[written.length - 1]?.txHash,
      });
    } catch (err) {
      console.error('[Settings] oracle push failed:', err);
      toast.error('Rates were not published', { description: describeTxError(err) });
    } finally {
      setPushing(false);
    }
  }

  // ── Agent endpoint state ──
  const [agentUrl, setAgentUrl] = useState('');
  const [registeredUrl, setRegisteredUrl] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentSaving, setAgentSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Load the provider's currently registered agent URL
  const loadAgentUrl = useCallback(async () => {
    if (!address) {
      setRegisteredUrl('');
      return;
    }
    setAgentLoading(true);
    try {
      const url = await getProviderAgentUrlFromChain(address);
      setRegisteredUrl(url);
      if (!agentUrl) setAgentUrl(url); // pre-fill on first load
    } catch (err) {
      console.error('[Settings] load agent url failed:', err);
    } finally {
      setAgentLoading(false);
    }
  }, [address, agentUrl]);

  useEffect(() => {
    void loadAgentUrl();
  }, [address]);

  // Register/update agent URL on-chain via setAgentUrl
  async function handleSaveAgent() {
    if (!address) {
      toast.error('Connect a wallet first');
      return;
    }
    if (!agentUrl.trim()) {
      toast.error('Agent URL is required', {
        description: 'Paste the tunnel URL your agent prints on startup.',
      });
      return;
    }
    setAgentSaving(true);
    try {
      const hash = await sendTx({
        address: CONTRACTS.AgentRegistry,
        abi: agentRegistryAbi,
        functionName: 'setAgentUrl',
        args: [agentUrl.trim()],
      });
      setRegisteredUrl(agentUrl.trim());
      await loadAgentUrl();
      toast.success('Agent endpoint updated', {
        description: 'Compute jobs will route to this URL.',
        txHash: hash,
      });
    } catch (err) {
      console.error('[Settings] setAgentUrl failed:', err);
      toast.error('Endpoint was not updated', { description: describeTxError(err) });
    } finally {
      setAgentSaving(false);
    }
  }

  function copy(text: string, key: string) {
    void navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  const networkStatus = isWrongChain
    ? 'Wrong network'
    : chainId === activeChain.id
      ? 'Connected'
      : 'Not connected';

  return (
    <PageShell>
      <PageHeader
        title="Settings"
        description="Your agent endpoint, the network and contracts this app talks to, and display preferences."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* ════ 1. AGENT ENDPOINT ════ */}
        <Card className="p-5">
          <CardHeader
            icon={Radio}
            title="Compute agent endpoint"
            description="Where the network sends jobs booked on your nodes"
          />

          {!address ? (
            <EmptyState
              icon={Radio}
              title="Wallet not connected"
              description="Connect a wallet to register the endpoint for your provider address."
              className="mt-4 border-0 bg-transparent py-6"
            />
          ) : (
            <div className="mt-5 flex flex-col gap-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-eyebrow uppercase text-on-surface-variant">
                    Currently registered
                  </span>
                  {agentLoading && <span className="text-caption text-outline">loading…</span>}
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container px-3 py-2.5">
                  <span className="flex-1 truncate font-mono text-caption text-on-surface">
                    {registeredUrl || <span className="text-outline">Not registered</span>}
                  </span>
                  {registeredUrl && (
                    <CopyButton
                      copied={copied === 'reg'}
                      onClick={() => copy(registeredUrl, 'reg')}
                    />
                  )}
                </div>
              </div>

              <Field
                label="Agent URL"
                hint="Generated by cloudflared during setup. Jobs on your nodes route here."
              >
                {(p) => (
                  <Input
                    {...p}
                    type="url"
                    value={agentUrl}
                    onChange={(e) => setAgentUrl(e.target.value)}
                    placeholder="https://your-agent.trycloudflare.com"
                    className="font-mono"
                  />
                )}
              </Field>

              <Button
                variant="primary"
                icon={Save}
                fullWidth
                loading={agentSaving}
                onClick={() => void handleSaveAgent()}
              >
                {agentSaving
                  ? 'Confirming'
                  : registeredUrl
                    ? 'Update on-chain'
                    : 'Register on-chain'}
              </Button>
            </div>
          )}
        </Card>

        {/* ════ 2. NETWORK CONFIG ════ */}
        <Card className="p-5">
          <CardHeader
            icon={Globe}
            title="Network"
            description="The chain this app reads from and writes to"
          />

          <dl className="mt-5">
            <Row label="Name" value={activeChain.name} mono={false} />
            <Row label="Chain ID" value={activeChain.id.toString()} />
            <Row label="Testnet" value={activeChain.testnet ? 'Yes' : 'No'} mono={false} />
            <Row label="Currency" value={activeChain.nativeCurrency.symbol} />
            <Row
              label="Wallet"
              mono={false}
              value={
                <span
                  className={
                    isWrongChain
                      ? 'text-compute-down'
                      : chainId === activeChain.id
                        ? 'text-compute-active'
                        : 'text-on-surface-variant'
                  }
                >
                  {networkStatus}
                  {chainId ? ` · id ${chainId}` : ''}
                </span>
              }
            />
            <Row
              label="RPC"
              value={
                <a
                  href={activeChain.rpcUrls.default.http[0]}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-primary hover:underline"
                >
                  {activeChain.rpcUrls.default.http[0].replace(/^https?:\/\//, '')}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              }
            />
            {EXPLORER && (
              <Row
                label="Explorer"
                value={
                  <a
                    href={EXPLORER}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    {EXPLORER.replace(/^https?:\/\//, '')}
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                }
              />
            )}
          </dl>

          {isWrongChain && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-compute-idle/30 bg-compute-idle/8 px-3.5 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-compute-idle" aria-hidden />
              <p className="text-caption text-on-surface-variant">
                Your wallet is on a different chain. Switch it to {activeChain.name} (id{' '}
                {activeChain.id}) to sign transactions.
              </p>
            </div>
          )}
        </Card>

        {/* ════ 3. CONTRACTS ════ */}
        <Card className="p-5">
          <CardHeader
            icon={FileCode2}
            title="Contracts"
            description="Deployed addresses on the active chain"
          />

          <ul className="mt-5 flex flex-col gap-2">
            {CONTRACT_LABELS.map(({ key, label }) => {
              const addr = CONTRACTS[key];
              return (
                <li
                  key={key}
                  className="rounded-lg border border-outline-variant bg-surface-container p-3"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-eyebrow uppercase text-on-surface-variant">{label}</span>
                    <span className="flex items-center gap-1.5">
                      <CopyButton copied={copied === key} onClick={() => copy(addr, key)} />
                      {EXPLORER && <ExplorerLink href={`${EXPLORER}/address/${addr}`} />}
                    </span>
                  </div>
                  <span className="block truncate font-mono text-caption text-on-surface">
                    {addr}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* ════ 4. ACCOUNT & PREFERENCES ════ */}
        <Card className="p-5">
          <CardHeader
            icon={User}
            title="Account and preferences"
            description="Connected wallet and how numbers are shown"
          />

          <div className="mt-5 flex flex-col gap-5">
            <div>
              <span className="mb-1.5 block text-eyebrow uppercase text-on-surface-variant">
                Account
              </span>
              {!address ? (
                <p className="rounded-lg border border-outline-variant bg-surface-container px-3.5 py-3 text-caption text-on-surface-variant">
                  No wallet connected.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-outline-variant bg-surface-container p-3">
                    <div className="min-w-0">
                      <span className="block text-eyebrow uppercase text-outline">Address</span>
                      <span className="block truncate font-mono text-caption text-on-surface">
                        {address}
                      </span>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <CopyButton
                        copied={copied === 'addr'}
                        onClick={() => copy(address, 'addr')}
                      />
                      {EXPLORER && <ExplorerLink href={`${EXPLORER}/address/${address}`} />}
                    </span>
                  </div>
                  <dl>
                    <Row
                      label="Balance"
                      value={`${formatBOT(balance)} ${activeChain.nativeCurrency.symbol}`}
                    />
                  </dl>
                  <Button variant="secondary" icon={Power} fullWidth onClick={disconnect}>
                    Disconnect wallet
                  </Button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4 border-t border-outline-variant pt-5">
              <span className="block text-eyebrow uppercase text-on-surface-variant">
                Preferences
              </span>

              <Field
                label="Dashboard auto-refresh"
                hint="Takes effect the next time the Dashboard loads."
              >
                {(p) => (
                  <Select
                    {...p}
                    value={refreshInterval}
                    onChange={(e) => setRefreshInterval(Number(e.target.value))}
                  >
                    <option value={0}>Off — refresh manually</option>
                    <option value={10}>Every 10 seconds</option>
                    <option value={30}>Every 30 seconds</option>
                    <option value={60}>Every 60 seconds</option>
                  </Select>
                )}
              </Field>
            </div>

            <div className="border-t border-outline-variant pt-5">
              <span className="mb-1.5 flex items-center gap-2 text-eyebrow uppercase text-on-surface-variant">
                <Info className="h-3.5 w-3.5" aria-hidden /> About
              </span>
              <p className="text-caption text-on-surface-variant">
                BotCompute — a decentralized GPU compute marketplace on BOT Chain.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* ════ 5. ORACLE PRICES ════ */}
      <Card className="mt-4 p-5">
        <CardHeader
          icon={Gauge}
          title="Price oracle"
          description="Hourly GPU rates published on-chain by the AI pricing operator"
          actions={
            <span className="flex items-center gap-2">
              {isOracleOperator && (
                <Button
                  size="sm"
                  variant="primary"
                  icon={Sparkles}
                  loading={pushing}
                  onClick={() => void handlePushPrices()}
                >
                  Reprice with AI
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                icon={RefreshCw}
                loading={oracleLoading}
                onClick={() => void loadOraclePrices()}
              >
                Refresh
              </Button>
            </span>
          }
        />

        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-outline-variant bg-surface-container px-3.5 py-3">
          <span className="text-eyebrow uppercase text-on-surface-variant">Floor price</span>
          <span className="font-mono text-label text-primary">
            {formatBOT(oracleFloor)} DGRAM/hr
          </span>
          <span className="ml-auto text-caption text-outline">anti-manipulation minimum</span>
        </div>

        {oraclePrices.length === 0 ? (
          <p className="mt-3 rounded-lg border border-outline-variant bg-surface-container px-3.5 py-4 text-center text-caption text-on-surface-variant">
            {oracleLoading
              ? 'Loading oracle prices…'
              : 'No GPU prices published yet. Run the AI pricing engine to push rates on-chain.'}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-outline-variant">
            <table className="w-full min-w-[36rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container">
                  <th scope="col" className="px-4 py-2.5 text-eyebrow uppercase text-outline">
                    GPU model
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-eyebrow uppercase text-outline">
                    Rate / hr
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-eyebrow uppercase text-outline">
                    Confidence
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-eyebrow uppercase text-outline">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {oraclePrices.map((p) => {
                  const confPct = (p.confidence / 100).toFixed(0);
                  const confColor =
                    p.confidence >= 8000
                      ? 'text-compute-active'
                      : p.confidence >= 5000
                        ? 'text-compute-idle'
                        : 'text-compute-down';
                  return (
                    <tr key={p.model} className="border-b border-outline-variant last:border-0">
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2 text-caption text-on-surface">
                          <Cpu className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                          {p.model}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-caption text-primary">
                        {formatBOT(p.pricePerHourWei)} DGRAM
                      </td>
                      <td className={cn('px-4 py-2.5 font-mono text-caption', confColor)}>
                        {confPct}%
                      </td>
                      <td className="px-4 py-2.5 text-caption text-outline">
                        {timeAgoSafe(p.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-caption text-outline">
          Rates are written by the authorised AI operator via{' '}
          <code className="font-mono text-on-surface-variant">updatePrice()</code>. Confidence is
          how certain the engine is about each rate — higher means a more reliable market price.
        </p>
      </Card>
    </PageShell>
  );
}

/* ── Small pieces ─────────────────────────────────────── */

function Row({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-outline-variant py-2.5 last:border-0">
      <dt className="text-eyebrow uppercase text-on-surface-variant">{label}</dt>
      <dd className={cn('min-w-0 truncate text-caption text-on-surface', mono && 'font-mono')}>
        {value}
      </dd>
    </div>
  );
}

function CopyButton({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={copied ? 'Copied' : 'Copy'}
      title={copied ? 'Copied' : 'Copy'}
      className="rounded p-1 text-outline transition-colors hover:text-primary"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-compute-active" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );
}

function ExplorerLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="View on block explorer"
      title="View on block explorer"
      className="rounded p-1 text-outline transition-colors hover:text-primary"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}
