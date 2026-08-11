import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  Play,
  Square,
  Code2,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Zap,
  PlusCircle,
  Hourglass,
  Trash2,
  Radio,
} from 'lucide-react';
import { type ExecutionResult } from '@/hooks/useComputeSession';
import { completeJobOnAgent, signChallenge } from '@/lib/agentApi';
import { useSessionContext } from '@/context/SessionContext';
import { useWalletContext } from '@/context/WalletContext';
import { useToast } from '@/context/ToastContext';
import { useComputeMarketplace } from '@/hooks/useComputeMarketplace';
import { formatBOT, formatAddress, formatNodeId } from '@/lib/format';
import { JOB_ACTIVE, jobStatus } from '@/lib/domain';
import { describeTxError } from '@/lib/tx';
import { formatCountdown } from '@/components/LeaseMeter';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { PageShell, PageHeader } from '@/components/layout/PageShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, StatusDot } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';

const SAMPLE_CODE: Record<string, string> = {
  python3: `# BotCompute — Number Loop Demo
# Running on provider's machine via BOT Chain

print("=== Looping 1 to 100 ===")
for i in range(1, 101):
    square = i * i
    cube = i * i * i
    print(f"{i:3d} -> square: {square:6d} | cube: {cube:8d}")

print("\\n=== Summary ===")
print(f"Total numbers: 100")
print(f"Sum of 1-100: {sum(range(1, 101))}")
print(f"Sum of squares: {sum(i*i for i in range(1, 101))}")
print("\\n✅ Compute delivered on BOT Chain")`,

  node: `// BotCompute — Number Loop Demo
// Running on provider's machine via BOT Chain

console.log('=== Looping 1 to 100 ===');
for (let i = 1; i <= 100; i++) {
  const square = i * i;
  const cube = i * i * i;
  console.log(String(i).padStart(3) + ' -> square: ' + String(square).padStart(6) + ' | cube: ' + String(cube).padStart(8));
}

console.log('\\n=== Summary ===');
const sum = Array.from({length: 100}, (_, i) => i + 1).reduce((a, b) => a + b, 0);
const sumSq = Array.from({length: 100}, (_, i) => (i + 1) ** 2).reduce((a, b) => a + b, 0);
console.log('Total numbers: 100');
console.log('Sum of 1-100:', sum);
console.log('Sum of squares:', sumSq);
console.log('\\n✅ Compute delivered on BOT Chain');`,
};

// ── Countdown Hook ─────────────────────────────────────
function useCountdown(startedAt: number, durationHours: bigint) {
  const [remaining, setRemaining] = useState(0); // seconds
  const [totalDuration, setTotalDuration] = useState(0); // seconds (original + extensions)

  useEffect(() => {
    if (!startedAt || durationHours === 0n) return;
    const totalSec = Number(durationHours) * 3600;
    setTotalDuration(totalSec);

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      setRemaining(Math.max(0, totalSec - (now - startedAt)));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt, durationHours]);

  const expired = totalDuration > 0 && remaining <= 0;
  const progress = totalDuration > 0 ? ((totalDuration - remaining) / totalDuration) * 100 : 0;
  const urgency =
    remaining < totalDuration * 0.1
      ? 'critical'
      : remaining < totalDuration * 0.3
        ? 'warning'
        : 'normal';

  return { remaining, totalDuration, expired, progress, urgency };
}

export function ComputeSession() {
  const toast = useToast();
  const { address, signMessage } = useWalletContext();
  const { jobs, loading, executing, executeCode, getAgentUrl, refreshJob } = useSessionContext();
  const [agentUrl, setAgentUrl] = useState<string>('');
  const { extendJob, settleExpiredJob } = useComputeMarketplace();

  const [selectedJobId, setSelectedJobId] = useState<bigint | null>(null);
  const [language, setLanguage] = useState<'python3' | 'node'>('python3');
  const [code, setCode] = useState(SAMPLE_CODE['python3']);
  const [results, setResults] = useState<ExecutionResult[]>([]);
  const [runMode, setRunMode] = useState<'code' | 'terminal'>('code');
  const [showAgentInfo, setShowAgentInfo] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extendHours, setExtendHours] = useState(1);
  const [extending, setExtending] = useState(false);
  const [autoCompleted, setAutoCompleted] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const selectedJob = jobs.find((j) => j.jobId === selectedJobId);

  // Countdown
  const countdown = useCountdown(
    selectedJob && selectedJob.status === JOB_ACTIVE ? Number(selectedJob.startedAt) : 0,
    selectedJob ? selectedJob.durationHours : 0n,
  );

  // Resolve agent URL when job changes
  useEffect(() => {
    if (!selectedJob) {
      setAgentUrl('');
      return;
    }
    void getAgentUrl(selectedJob.jobId).then(setAgentUrl);
  }, [selectedJob, getAgentUrl]);

  /**
   * Settle the lease once the clock runs out.
   *
   * The agent will only settle for the wallet that paid, so the request carries
   * a signed challenge. If the provider's agent is unreachable — the case that
   * used to strand the escrow forever — fall back to the permissionless
   * on-chain settlement, which anyone may call after the lease expires.
   */
  useEffect(() => {
    if (!countdown.expired || !selectedJob || selectedJob.status !== JOB_ACTIVE) return;
    if (autoCompleted || !address) return;

    const jobId = selectedJob.jobId;
    setAutoCompleted(true);

    void (async () => {
      try {
        if (agentUrl) {
          const auth = await signChallenge('complete', jobId, address, signMessage);
          await completeJobOnAgent(agentUrl, jobId, auth);
        } else {
          await settleExpiredJob(jobId);
        }
        await refreshJob(jobId);
        toast.success(`Job #${jobId.toString()} settled`, {
          description: 'The provider was paid for the time actually used; the rest was refunded.',
        });
      } catch (err) {
        console.error('[ComputeSession] settlement failed:', err);
        toast.error('Lease was not settled automatically', { description: describeTxError(err) });
      }
    })();
  }, [
    countdown.expired,
    selectedJob,
    autoCompleted,
    agentUrl,
    address,
    signMessage,
    settleExpiredJob,
    refreshJob,
    toast,
  ]);

  // Reset state when switching jobs
  useEffect(() => {
    setAutoCompleted(false);
    setResults([]);
  }, [selectedJobId]);

  // Auto-select first active job
  useEffect(() => {
    if (jobs.length > 0 && selectedJobId === null) {
      const active = jobs.find((j) => j.status === 1);
      if (active) setSelectedJobId(active.jobId);
    }
  }, [jobs]);

  function handleLanguageChange(lang: 'python3' | 'node') {
    setLanguage(lang);
    setCode(SAMPLE_CODE[lang]);
  }

  async function handleExecute() {
    if (!selectedJobId || !selectedJob) return;
    if (countdown.expired) {
      toast.error('Session expired', {
        description: 'Extend the lease to keep running code on this node.',
      });
      return;
    }
    const result = await executeCode(selectedJobId, language, code);
    setResults((prev) => [result, ...prev]);
  }

  async function handleExtend() {
    if (!selectedJob) return;
    setExtending(true);
    try {
      // extendJob re-reads the job's own locked-in rate, so the extra hours cost
      // exactly what the original lease did. The previous implementation opened
      // an unrelated second job priced against a GPU model called "Extension",
      // which the oracle had never heard of.
      const value = selectedJob.pricePerHourWei * BigInt(extendHours);
      const hash = await extendJob(selectedJob.jobId, BigInt(extendHours), value);

      await refreshJob(selectedJob.jobId);
      setShowExtendModal(false);
      toast.success(`Lease extended by ${extendHours}h`, {
        description: `${formatBOT(value)} DGRAM added to the escrow for this job.`,
        txHash: hash,
      });
    } catch (err) {
      console.error('[ComputeSession] extend failed:', err);
      toast.error('Lease was not extended', { description: describeTxError(err) });
    } finally {
      setExtending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleExecute();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      setCode(code.substring(0, start) + '  ' + code.substring(end));
      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.selectionStart = editorRef.current.selectionEnd = start + 2;
        }
      });
    }
  }

  // The line-number gutter is a sibling of the textarea, so it has to be
  // scrolled in step or the numbers drift out of line with the code.
  function syncGutter(e: React.UIEvent<HTMLTextAreaElement>) {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  }

  if (!address) {
    return (
      <PageShell>
        <PageHeader
          title="Execute"
          description="Run code on compute you've leased, or open an isolated shell on the provider's machine."
        />
        <EmptyState
          icon={Cpu}
          title="Connect a wallet to run compute"
          description="Your leased jobs are read from the address you connect."
        />
      </PageShell>
    );
  }

  const activeCount = jobs.filter((j) => j.status === 1).length;
  const urgencyColor = {
    normal: 'text-compute-active',
    warning: 'text-compute-idle',
    critical: 'text-compute-down',
  }[countdown.urgency];
  const urgencyBg = {
    normal: 'bg-compute-active',
    warning: 'bg-compute-idle',
    critical: 'bg-compute-down',
  }[countdown.urgency];

  return (
    <PageShell>
      <PageHeader
        title="Execute"
        description="Run code on compute you've leased, or open an isolated shell on the provider's machine."
        actions={
          <>
            <span className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container px-3 py-2">
              <StatusDot tone={activeCount > 0 ? 'success' : 'neutral'} live={activeCount > 0} />
              <span className="text-label text-on-surface-variant">
                <span className="font-mono text-on-surface">{activeCount}</span> active ·{' '}
                <span className="font-mono">{jobs.length}</span> total
              </span>
            </span>
            <Button
              size="md"
              variant="secondary"
              icon={Zap}
              aria-expanded={showAgentInfo}
              onClick={() => setShowAgentInfo((v) => !v)}
            >
              Agent routing
            </Button>
          </>
        }
      />

      {showAgentInfo && (
        <Card className="mb-5 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container text-primary">
              <Radio className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-subtitle text-on-surface">Provider agent</h2>
              <p className="mt-0.5 text-caption text-on-surface-variant">
                Code runs on the provider's own machine. The endpoint is resolved on-chain from the
                job's provider address.
              </p>
              <p className="mt-2 break-all font-mono text-caption text-primary">
                {selectedJob
                  ? agentUrl || 'No endpoint registered for this provider'
                  : 'Select a job to resolve its endpoint'}
              </p>
            </div>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={Terminal}
          title="No compute leased yet"
          description="Lease a node from Explore, and it appears here as soon as the provider accepts."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {/* ── Job selector ── */}
          {/* Plain buttons with aria-pressed, matching ModeButton below. A
              role="tablist" was announced here with no tabpanel, no
              aria-controls and no arrow-key handling, so a screen reader said
              "tab 1 of 4" and then nothing worked. */}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Leased jobs">
            {jobs.map((job) => {
              const status = jobStatus(job.status);
              const isSelected = selectedJobId === job.jobId;
              return (
                <button
                  key={job.jobId.toString()}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedJobId(job.jobId)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-label transition-colors',
                    isSelected
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-outline-variant bg-surface-container text-on-surface-variant hover:border-outline hover:text-on-surface',
                  )}
                >
                  <StatusDot tone={status.tone} live={job.status === JOB_ACTIVE} />
                  <span className="font-mono">Job #{job.jobId.toString()}</span>
                  <span className="text-caption opacity-70">{status.label}</span>
                </button>
              );
            })}
          </div>

          {/* ── Selected job ── */}
          {selectedJob && (
            <Card className="p-5">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 xl:grid-cols-6">
                <Fact label="Workload" value={selectedJob.jobType} />
                <Fact
                  label="Node"
                  value={formatNodeId(selectedJob.nodeId)}
                  mono
                  title={selectedJob.nodeId.toString()}
                />
                <Fact
                  label="Provider"
                  value={formatAddress(selectedJob.provider)}
                  mono
                  title={selectedJob.provider}
                />
                <Fact
                  label="Rate"
                  value={`${formatBOT(selectedJob.pricePerHourWei)} DGRAM/hr`}
                  mono
                />
                <Fact label="Duration" value={`${selectedJob.durationHours.toString()}h`} mono />

                {selectedJob.status === JOB_ACTIVE ? (
                  <div className="col-span-2 md:col-span-3 xl:col-span-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-eyebrow uppercase text-outline">
                        {countdown.expired ? 'Expired' : 'Time left'}
                      </span>
                      {!countdown.expired && (
                        <button
                          onClick={() => setShowExtendModal(true)}
                          className="flex items-center gap-1 text-caption text-primary transition-colors hover:text-primary-fixed"
                        >
                          <PlusCircle className="h-3 w-3" aria-hidden /> Extend
                        </button>
                      )}
                    </div>
                    <p
                      className={cn(
                        'mt-1 font-mono text-title',
                        urgencyColor,
                        countdown.urgency === 'critical' &&
                          !countdown.expired &&
                          'motion-safe:animate-pulse',
                      )}
                    >
                      {countdown.expired ? '00:00:00' : formatCountdown(countdown.remaining)}
                    </p>
                    <div
                      className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-container-highest"
                      role="progressbar"
                      aria-valuenow={Math.round(countdown.progress)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Lease elapsed"
                    >
                      <div
                        className={cn(
                          'h-full transition-[width] duration-1000 ease-linear',
                          urgencyBg,
                        )}
                        style={{ width: `${Math.min(100, countdown.progress)}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <Fact label="Status" value={jobStatus(selectedJob.status).label} />
                )}
              </div>

              {selectedJob.status !== JOB_ACTIVE && !autoCompleted && (
                <Notice tone="warning">
                  {selectedJob.status === 0
                    ? 'Waiting for the provider to accept. Code can run once the job is active.'
                    : selectedJob.status === 2
                      ? 'This job is complete. Past executions are still listed below.'
                      : 'This job is no longer active.'}
                </Notice>
              )}
              {autoCompleted && (
                <Notice tone="danger" icon={Hourglass}>
                  The lease ran out and the job was completed on-chain. Extend or lease again to
                  keep working.
                </Notice>
              )}
            </Card>
          )}

          {/* ── Run mode ── */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Run mode"
              className="flex rounded-lg border border-outline-variant bg-surface-container p-0.5"
            >
              <ModeButton
                active={runMode === 'code'}
                icon={Code2}
                onClick={() => setRunMode('code')}
              >
                Run code
              </ModeButton>
              <ModeButton
                active={runMode === 'terminal'}
                icon={Terminal}
                disabled={!selectedJob || selectedJob.status !== 1 || countdown.expired}
                title={
                  !selectedJob || selectedJob.status !== 1
                    ? 'Select an active job to open a terminal'
                    : countdown.expired
                      ? 'The lease has expired'
                      : 'Open an isolated shell on the provider'
                }
                onClick={() => setRunMode('terminal')}
              >
                Terminal
              </ModeButton>
            </div>
            {runMode === 'terminal' && (
              <span className="text-caption text-outline">
                Isolated shell · closes automatically when the lease ends
              </span>
            )}
          </div>

          {runMode === 'terminal' ? (
            agentUrl ? (
              <TerminalPanel
                jobId={Number(selectedJobId)}
                agentUrl={agentUrl}
                onExpired={() => setRunMode('code')}
              />
            ) : (
              <Card className="flex min-h-[360px] items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
                <span className="text-body text-on-surface-variant">Resolving provider agent…</span>
              </Card>
            )
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {/* ── Editor ── */}
              <Card className="flex flex-col overflow-hidden">
                <div className="flex items-center justify-between gap-2 border-b border-outline-variant px-4 py-2.5">
                  <span className="flex items-center gap-2 text-label text-on-surface">
                    <Code2 className="h-4 w-4 text-on-surface-variant" aria-hidden /> Editor
                  </span>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Language"
                      value={language}
                      onChange={(e) => handleLanguageChange(e.target.value as 'python3' | 'node')}
                      className="h-8 rounded-md border border-outline-variant bg-surface-container px-2 text-caption text-on-surface outline-none focus:border-primary"
                    >
                      <option value="python3">Python 3</option>
                      <option value="node">Node.js</option>
                    </select>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={countdown.expired ? Square : Play}
                      loading={executing}
                      onClick={() => void handleExecute()}
                      disabled={!selectedJob || selectedJob.status !== 1 || countdown.expired}
                      title="Ctrl/⌘ + Enter"
                    >
                      {executing ? 'Running' : countdown.expired ? 'Expired' : 'Run'}
                    </Button>
                  </div>
                </div>
                <div className="flex min-h-[420px] flex-1">
                  <div
                    ref={gutterRef}
                    aria-hidden
                    className="select-none overflow-hidden border-r border-outline-variant bg-surface-container/40 px-3 py-3 text-right font-mono text-caption leading-[1.6] text-outline"
                  >
                    {code.split('\n').map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                  <textarea
                    ref={editorRef}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onScroll={syncGutter}
                    spellCheck={false}
                    aria-label="Code to run on the provider"
                    disabled={countdown.expired}
                    className={cn(
                      'flex-1 resize-none bg-transparent p-3 font-mono text-caption leading-[1.6] text-on-surface',
                      'outline-none focus-visible:outline-none',
                      countdown.expired && 'opacity-40',
                    )}
                    placeholder="Write the code to run on the provider…"
                  />
                </div>
              </Card>

              {/* ── Output ── */}
              <Card className="flex flex-col overflow-hidden">
                <div className="flex items-center justify-between gap-2 border-b border-outline-variant px-4 py-2.5">
                  <span className="flex items-center gap-2 text-label text-on-surface">
                    <Terminal className="h-4 w-4 text-on-surface-variant" aria-hidden /> Output
                  </span>
                  {results.length > 0 && (
                    <div className="flex items-center gap-3">
                      <span className="text-caption text-outline">
                        {results.length} run{results.length > 1 ? 's' : ''}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Trash2}
                        onClick={() => setResults([])}
                      >
                        Clear
                      </Button>
                    </div>
                  )}
                </div>
                <div className="min-h-[420px] flex-1 overflow-y-auto p-4">
                  {results.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-center">
                      <Terminal className="mb-3 h-7 w-7 text-outline" aria-hidden />
                      <p className="text-body text-on-surface-variant">Nothing has run yet</p>
                      <p className="mt-1 max-w-xs text-caption text-outline">
                        Press Run to execute the editor's contents on the provider's machine.
                      </p>
                    </div>
                  ) : (
                    <ol className="flex flex-col gap-3">
                      {results.map((r, i) => (
                        <li
                          key={i}
                          className="rounded-lg border border-outline-variant bg-surface-container p-3"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2">
                              {r.status === 'completed' && r.exitCode === 0 ? (
                                <CheckCircle2
                                  className="h-3.5 w-3.5 text-compute-active"
                                  aria-hidden
                                />
                              ) : r.status === 'error' || r.status === 'failed' ? (
                                <AlertCircle
                                  className="h-3.5 w-3.5 text-compute-down"
                                  aria-hidden
                                />
                              ) : (
                                <Loader2
                                  className="h-3.5 w-3.5 animate-spin text-primary"
                                  aria-hidden
                                />
                              )}
                              <span className="font-mono text-caption text-outline">
                                {r.executionId} · {r.durationMs}ms
                              </span>
                            </span>
                            <Badge tone={r.exitCode === 0 ? 'success' : 'danger'}>
                              exit {r.exitCode}
                            </Badge>
                          </div>
                          {r.stdout && (
                            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-surface-container-lowest p-2.5 font-mono text-caption text-on-surface">
                              {r.stdout}
                            </pre>
                          )}
                          {r.stderr && (
                            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-compute-down/8 p-2.5 font-mono text-caption text-compute-down">
                              {r.stderr}
                            </pre>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* ── Extend lease ── */}
      <Modal
        open={showExtendModal && selectedJob !== undefined}
        onClose={() => setShowExtendModal(false)}
        icon={PlusCircle}
        title="Extend lease"
        description={
          selectedJob ? `Add compute time to Job #${selectedJob.jobId.toString()}` : undefined
        }
        footer={
          <>
            <Button
              variant="primary"
              fullWidth
              loading={extending}
              onClick={() => void handleExtend()}
            >
              {extending ? 'Confirming' : `Extend by ${extendHours}h`}
            </Button>
            <Button variant="ghost" onClick={() => setShowExtendModal(false)}>
              Cancel
            </Button>
          </>
        }
      >
        {selectedJob && (
          <div className="flex flex-col gap-4">
            {!countdown.expired && (
              <div className="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container px-3.5 py-3">
                <span className="text-label text-on-surface-variant">Time remaining</span>
                <span className={cn('font-mono text-label font-semibold', urgencyColor)}>
                  {formatCountdown(countdown.remaining)}
                </span>
              </div>
            )}

            <div>
              <span className="mb-1.5 block text-eyebrow uppercase text-on-surface-variant">
                Additional hours
              </span>
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 4, 8].map((h) => (
                  <button
                    key={h}
                    onClick={() => setExtendHours(h)}
                    aria-pressed={extendHours === h}
                    className={cn(
                      'rounded-lg border py-2 font-mono text-label transition-colors',
                      extendHours === h
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-outline-variant bg-surface-container text-on-surface-variant hover:border-outline hover:text-on-surface',
                    )}
                  >
                    {h}h
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-outline-variant bg-surface-container p-3.5">
              <div className="flex items-baseline justify-between">
                <span className="text-label text-on-surface-variant">Additional cost</span>
                <span className="font-mono text-title text-primary">
                  {formatBOT(selectedJob.pricePerHourWei * BigInt(extendHours))}
                  <span className="ml-1.5 text-caption font-normal text-on-surface-variant">
                    DGRAM
                  </span>
                </span>
              </div>
              <p className="mt-1 text-right font-mono text-caption text-outline">
                {formatBOT(selectedJob.pricePerHourWei)} × {extendHours}h
              </p>
            </div>
          </div>
        )}
      </Modal>
    </PageShell>
  );
}

/* ── Small pieces ─────────────────────────────────────── */

function Fact({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-eyebrow uppercase text-outline">{label}</p>
      <p
        title={title}
        className={cn('mt-1 truncate text-label text-on-surface', mono && 'font-mono')}
      >
        {value}
      </p>
    </div>
  );
}

function Notice({
  tone,
  icon: Icon = AlertCircle,
  children,
}: {
  tone: 'warning' | 'danger';
  icon?: React.ElementType;
  children: React.ReactNode;
}) {
  const styles = {
    warning: 'border-compute-idle/30 bg-compute-idle/8 text-compute-idle',
    danger: 'border-compute-down/30 bg-compute-down/8 text-compute-down',
  }[tone];
  return (
    <div className={cn('mt-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-3', styles)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="text-caption text-on-surface-variant">{children}</p>
    </div>
  );
}

function ModeButton({
  active,
  icon: Icon,
  children,
  ...props
}: {
  active: boolean;
  icon: React.ElementType;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'bg-surface-container-highest text-on-surface'
          : 'text-on-surface-variant hover:text-on-surface',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </button>
  );
}
