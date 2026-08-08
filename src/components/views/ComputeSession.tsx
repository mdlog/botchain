import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, Play, Square, Code2, Cpu, Clock, CheckCircle, AlertCircle, Loader, ChevronDown, Zap, Timer, PlusCircle, Hourglass, Trash2 } from 'lucide-react';
import { useComputeSession, type ExecutionResult } from '@/hooks/useComputeSession';
import { useWalletContext } from '@/context/WalletContext';
import { useComputeMarketplace } from '@/hooks/useComputeMarketplace';
import { formatBOT, formatAddress, timeAgo } from '@/lib/format';

const SAMPLE_CODE: Record<string, string> = {
  python3: `# ComputeRWA — Number Loop Demo
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

  node: `// ComputeRWA — Number Loop Demo
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
function useCountdown(startedAt: number, durationHours: bigint, extensions: number) {
  const [remaining, setRemaining] = useState(0); // seconds
  const [totalDuration, setTotalDuration] = useState(0); // seconds (original + extensions)

  useEffect(() => {
    if (!startedAt || durationHours === 0n) return;
    const totalSec = Number(durationHours) * 3600 + extensions * 3600;
    setTotalDuration(totalSec);

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const elapsed = now - startedAt;
      const left = totalSec - elapsed;
      setRemaining(Math.max(0, left));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt, durationHours, extensions]);

  const expired = totalDuration > 0 && remaining <= 0;
  const progress = totalDuration > 0 ? ((totalDuration - remaining) / totalDuration) * 100 : 0;
  const urgency = remaining < totalDuration * 0.1 ? 'critical' : remaining < totalDuration * 0.3 ? 'warning' : 'normal';

  return { remaining, totalDuration, expired, progress, urgency };
}

function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function ComputeSession() {
  const { address } = useWalletContext();
  const { jobs, loading, executing, executeCode, getAgentUrl, reloadJobs } = useComputeSession();
  const [agentUrl, setAgentUrl] = useState<string>('');
  const { createJob } = useComputeMarketplace();

  const [selectedJobId, setSelectedJobId] = useState<bigint | null>(null);
  const [language, setLanguage] = useState<'python3' | 'node'>('python3');
  const [code, setCode] = useState(SAMPLE_CODE['python3']);
  const [results, setResults] = useState<ExecutionResult[]>([]);
  const [showAgentInfo, setShowAgentInfo] = useState(false);
  const [extensions, setExtensions] = useState(0); // hours added by extend
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extendHours, setExtendHours] = useState(1);
  const [extending, setExtending] = useState(false);
  const [autoCompleted, setAutoCompleted] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const selectedJob = jobs.find(j => j.jobId === selectedJobId);

  // Countdown
  const countdown = useCountdown(
    selectedJob && selectedJob.status === 1 ? Number(selectedJob.startedAt) : 0,
    selectedJob ? selectedJob.durationHours : 0n,
    extensions,
  );

  // Resolve agent URL when job changes
  useEffect(() => {
    if (!selectedJob) { setAgentUrl(''); return; }
    getAgentUrl(selectedJob.jobId).then(setAgentUrl);
  }, [selectedJob, getAgentUrl]);

  // Auto-complete when expired
  useEffect(() => {
    if (countdown.expired && selectedJob && selectedJob.status === 1 && !autoCompleted && agentUrl) {
      setAutoCompleted(true);
      fetch(`${agentUrl}/jobs/${selectedJob.jobId}/complete`, { method: 'POST' })
        .then(r => r.json())
        .then(data => {
          console.log('[ComputeSession] Auto-complete triggered:', data);
          reloadJobs();
        })
        .catch(err => console.error('[ComputeSession] Auto-complete failed:', err));
    }
  }, [countdown.expired, selectedJob, autoCompleted, agentUrl]);
  // Reset state when switching jobs
  useEffect(() => {
    setExtensions(0);
    setAutoCompleted(false);
    setResults([]);
  }, [selectedJobId]);

  // Auto-select first active job
  useEffect(() => {
    if (jobs.length > 0 && selectedJobId === null) {
      const active = jobs.find(j => j.status === 1);
      if (active) setSelectedJobId(active.jobId);
    }
  }, [jobs]);

  function handleLanguageChange(lang: 'python3' | 'node') {
    setLanguage(lang);
    setCode(SAMPLE_CODE[lang]);
  }

  async function handleExecute() {
    if (!selectedJobId) return;
    if (countdown.expired) {
      alert('Session expired. Extend your lease to continue executing code.');
      return;
    }
    const result = await executeCode(selectedJobId, selectedJob.nodeId, language, code);    setResults(prev => [result, ...prev]);
  }

  async function handleExtend() {
    if (!selectedJob || !address) return;
    setExtending(true);
    try {
      // Create a new job on the same node to extend the session
      const value = selectedJob.pricePerHourWei * BigInt(extendHours);
      const hash = await createJob(
        selectedJob.nodeId,
        'Extension',
        '0x' + '00'.repeat(32),
        BigInt(extendHours),
        'Extension',
      );
      if (hash) {
        setExtensions(prev => prev + extendHours);
        setShowExtendModal(false);
        alert(`Lease extended by ${extendHours}h! TX: ${hash.slice(0, 16)}...`);
        reloadJobs();
      }
    } catch (err) {
      console.error('[ComputeSession] Extend failed:', err);
      alert('Extend failed. Check console.');
    } finally {
      setExtending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleExecute();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const newCode = code.substring(0, start) + '  ' + code.substring(end);
      setCode(newCode);
      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.selectionStart = editorRef.current.selectionEnd = start + 2;
        }
      });
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center pt-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="flex h-full flex-col items-center justify-center pt-20">
        <Cpu className="mb-4 h-12 w-12 text-outline" />
        <h2 className="mb-2 text-sm font-semibold text-on-surface">Connect Wallet</h2>
        <p className="text-sm text-on-surface-variant">Connect your wallet to access execute.</p>
      </div>
    );
  }

  // Urgency colors
  const urgencyColor = {
    normal: 'text-compute-active',
    warning: 'text-warning',
    critical: 'text-error',
  }[countdown.urgency];

  const urgencyBg = {
    normal: 'bg-compute-active',
    warning: 'bg-warning',
    critical: 'bg-error',
  }[countdown.urgency];

  const urgencyBorder = {
    normal: 'border-compute-active/30',
    warning: 'border-warning/30',
    critical: 'border-error/30',
  }[countdown.urgency];

  return (
    <div className="flex h-full w-full flex-col relative z-10">
      {/* Ticker */}
      <div className="sticky top-0 z-30 flex h-12 items-center border-b border-surface-glass bg-surface/50 px-8 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-outline">Execute</span>
          <span className="font-mono text-sm text-on-surface">{jobs.length}</span>
        </div>
        <div className="ml-6 flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-outline">Active</span>
          <span className="font-mono text-sm text-compute-active">{jobs.filter(j => j.status === 1).length}</span>
        </div>
        <button
          onClick={() => setShowAgentInfo(!showAgentInfo)}
          className="ml-auto flex items-center gap-1.5 rounded border border-outline-variant/20 bg-surface-container px-3 py-1 font-mono text-[10px] text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <Zap className="h-3 w-3" /> Agent Routing: Per-Node
        </button>
      </div>

      {/* Agent routing info */}
      {showAgentInfo && (
        <div className="border-b border-surface-glass bg-surface-container-low px-8 py-3">
          <div className="font-mono text-[10px] font-semibold uppercase text-outline mb-2">Provider Agent Routing</div>
          <div className="space-y-1">
            {selectedJob ? (
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-on-surface-variant">Provider Agent</span>
                <span className="text-outline">→</span>
                <span className="text-primary">{agentUrl || 'Not registered'}</span>
              </div>
            ) : (
              <div className="font-mono text-xs text-outline">Select a job to see provider agent URL.</div>
            )}
            <p className="mt-2 text-[10px] text-outline">Agent URL resolved from job's provider address. Compute runs on the actual provider machine.</p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto bg-gradient-to-b from-surface/50 to-surface p-8 pb-32">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl bg-surface-container-low p-16">
            <Terminal className="mb-4 h-12 w-12 text-outline" />
            <h2 className="mb-2 text-sm font-semibold text-on-surface">No Compute Jobs Found</h2>
            <p className="text-sm text-on-surface-variant">Lease compute on the Marketplace first, then come back here to run your workloads.</p>
          </div>
        ) : (
          <>
            {/* Job tabs */}
            <div className="mb-4 flex flex-wrap gap-2">
              {jobs.map(job => {
                const isActive = job.status === 1;
                const isSelected = selectedJobId === job.jobId;
                return (
                  <button
                    key={job.jobId.toString()}
                    onClick={() => setSelectedJobId(job.jobId)}
                    className={`flex items-center gap-2 rounded-lg border px-4 py-2 font-mono text-xs transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-outline-variant/20 bg-surface-container text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <div className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-compute-active animate-pulse' : 'bg-outline-variant'}`}></div>
                    Job #{job.jobId.toString()}
                    <span className="text-[10px] opacity-60">
                      {job.status === 0 ? 'Pending' : job.status === 1 ? 'Active' : job.status === 2 ? 'Completed' : job.status === 3 ? 'Cancelled' : 'Disputed'}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Selected job detail + Countdown integrated */}
            {selectedJob && (
              <div className="mb-4 space-y-4">
                <div className="rounded-xl bg-surface-container-low p-4">
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
                    <div>
                      <div className="font-mono text-[10px] uppercase text-outline">Job Type</div>
                      <div className="text-sm text-on-surface">{selectedJob.jobType}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase text-outline">Node</div>
                      <div className="font-mono text-sm text-on-surface">#{selectedJob.nodeId.toString()}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase text-outline">Provider</div>
                      <div className="font-mono text-xs text-on-surface-variant">{formatAddress(selectedJob.provider as any)}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase text-outline">Rate</div>
                      <div className="font-mono text-sm text-primary">{formatBOT(selectedJob.pricePerHourWei)} DGRAM/hr</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase text-outline">Duration</div>
                      <div className="font-mono text-sm text-on-surface">{selectedJob.durationHours.toString()}h{extensions > 0 ? ` +${extensions}h` : ''}</div>
                    </div>
                    {/* Countdown integrated as 6th column */}
                    {selectedJob.status === 1 ? (
                      <div className="border-l border-outline-variant/10 pl-4">
                        <div className="flex items-center justify-between">
                          <div className="font-mono text-[10px] uppercase text-outline">
                            {countdown.expired ? 'EXPIRED' : 'TIME LEFT'}
                          </div>
                          {!countdown.expired && (
                            <button
                              onClick={() => setShowExtendModal(true)}
                              className="flex items-center gap-1 font-mono text-[10px] text-primary transition-colors hover:text-primary/80"
                            >
                              <PlusCircle className="h-3 w-3" /> Extend
                            </button>
                          )}
                        </div>
                        <div className={`font-mono text-sm font-bold ${urgencyColor} ${countdown.urgency === 'critical' ? 'animate-pulse' : ''}`}>
                          {countdown.expired ? '00:00:00' : formatCountdown(countdown.remaining)}
                        </div>
                        {/* Mini progress bar */}
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-container-highest">
                          <div
                            className={`h-full transition-all duration-1000 ${urgencyBg}`}
                            style={{ width: `${Math.min(100, countdown.progress)}%` }}
                          />
                        </div>
                        {autoCompleted && (
                          <div className="mt-1 font-mono text-[10px] text-error">Auto-completing...</div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <div className="font-mono text-[10px] uppercase text-outline">Status</div>
                        <div className="text-sm text-on-surface-variant">
                          {selectedJob.status === 0 ? 'Pending' : selectedJob.status === 2 ? 'Completed' : selectedJob.status === 3 ? 'Cancelled' : 'Disputed'}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Status warnings */}
                  {selectedJob.status !== 1 && !autoCompleted && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2">
                      <AlertCircle className="h-4 w-4 text-warning" />
                      <span className="text-xs text-on-surface-variant">
                        {selectedJob.status === 0
                          ? 'Job is pending provider acceptance. Code execution requires an active job.'
                          : selectedJob.status === 2
                          ? 'Job completed. You can review past executions below.'
                          : 'Job is no longer active.'}
                      </span>
                    </div>
                  )}
                  {autoCompleted && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-error/10 px-3 py-2">
                      <Hourglass className="h-4 w-4 text-error" />
                      <span className="text-xs text-error">
                        Session expired. Job auto-completed on-chain. Extend lease or create a new job to continue.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Code Editor + Output */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Editor */}
              <div className="flex flex-col rounded-xl bg-surface-container-low overflow-hidden">
                <div className="flex items-center justify-between border-b border-surface-glass px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Code2 className="h-4 w-4 text-on-surface-variant" />
                    <span className="font-mono text-xs font-semibold text-on-surface">Code Editor</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={language}
                      onChange={e => handleLanguageChange(e.target.value as any)}
                      className="rounded border border-outline-variant/20 bg-surface-container px-2 py-1 font-mono text-xs text-on-surface outline-none"
                    >
                      <option value="python3">Python 3</option>
                      <option value="node">Node.js</option>
                    </select>
                    <button
                      onClick={handleExecute}
                      disabled={executing || !selectedJob || selectedJob.status !== 1 || countdown.expired}
                      className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 font-mono text-xs font-semibold text-on-primary transition-colors hover:bg-primary/80 disabled:opacity-30"
                    >
                      {executing ? (
                        <><Loader className="h-3.5 w-3.5 animate-spin" /> Running...</>
                      ) : countdown.expired ? (
                        <><Square className="h-3.5 w-3.5" /> Expired</>
                      ) : (
                        <><Play className="h-3.5 w-3.5" /> Run (⌘+↵)</>
                      )}
                    </button>
                  </div>
                </div>
                <div className="relative flex flex-1 min-h-[400px]">
                  <div className="select-none border-r border-surface-glass px-3 py-3 font-mono text-xs text-outline-variant/50 leading-relaxed">
                    {code.split('\n').map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                  <textarea
                    ref={editorRef}
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    onKeyDown={handleKeyDown}
                    spellCheck={false}
                    disabled={countdown.expired}
                    className={`flex-1 resize-none bg-transparent p-3 font-mono text-xs text-on-surface leading-relaxed outline-none ${countdown.expired ? 'opacity-40' : ''}`}
                    placeholder="Write your compute code here..."
                  />
                </div>
              </div>

              {/* Output Panel */}
              <div className="flex flex-col rounded-xl bg-surface-container-low overflow-hidden">
                <div className="flex items-center justify-between border-b border-surface-glass px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-on-surface-variant" />
                    <span className="font-mono text-xs font-semibold text-on-surface">Output</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {results.length > 0 && (
                      <span className="font-mono text-[10px] text-outline">
                        {results.length} execution{results.length > 1 ? 's' : ''}
                      </span>
                    )}
                    {results.length > 0 && (
                      <button
                        onClick={() => setResults([])}
                        title="Clear output"
                        className="flex items-center gap-1 rounded bg-surface-container-highest px-2 py-1 font-mono text-[10px] font-semibold text-outline transition-colors hover:text-compute-down"
                      >
                        <Trash2 className="h-3 w-3" /> CLEAR
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 min-h-[400px]">
                  {results.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-center">
                      <Terminal className="mb-3 h-8 w-8 text-outline" />
                      <p className="text-sm text-on-surface-variant">No executions yet</p>
                      <p className="mt-1 text-xs text-outline">Write code and click Run to execute on provider's machine</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {results.map((r, i) => (
                        <div key={i} className="rounded-lg border border-surface-glass bg-surface-container p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {r.status === 'completed' && r.exitCode === 0 ? (
                                <CheckCircle className="h-3.5 w-3.5 text-compute-active" />
                              ) : r.status === 'error' ? (
                                <AlertCircle className="h-3.5 w-3.5 text-error" />
                              ) : (
                                <Loader className="h-3.5 w-3.5 animate-spin text-primary" />
                              )}
                              <span className="font-mono text-[10px] text-outline">
                                {r.executionId} · {r.duration}ms
                              </span>
                            </div>
                            <span className={`font-mono text-[10px] ${r.exitCode === 0 ? 'text-compute-active' : 'text-error'}`}>
                              exit: {r.exitCode}
                            </span>
                          </div>
                          {r.stdout && (
                            <pre className="mb-2 whitespace-pre-wrap font-mono text-xs text-on-surface bg-surface-container-lowest p-2 rounded">
                              {r.stdout}
                            </pre>
                          )}
                          {r.stderr && (
                            <pre className="whitespace-pre-wrap font-mono text-xs text-error bg-error/5 p-2 rounded">
                              {r.stderr}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Execution Guide */}
            <div className="mt-6 rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-on-surface">
                <Cpu className="h-4 w-4 text-primary" /> How Execute Work
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="rounded-lg bg-surface-container p-3">
                  <div className="mb-1 font-mono text-[10px] font-bold uppercase text-primary">1. LEASE</div>
                  <div className="text-xs text-on-surface-variant">Lease compute on Marketplace — payment locked on-chain</div>
                </div>
                <div className="rounded-lg bg-surface-container p-3">
                  <div className="mb-1 font-mono text-[10px] font-bold uppercase text-primary">2. ACTIVATE</div>
                  <div className="text-xs text-on-surface-variant">Provider accepts job — countdown timer starts</div>
                </div>
                <div className="rounded-lg bg-surface-container p-3">
                  <div className="mb-1 font-mono text-[10px] font-bold uppercase text-primary">3. EXECUTE</div>
                  <div className="text-xs text-on-surface-variant">Write code → POST to provider agent → get results</div>
                </div>
                <div className="rounded-lg bg-surface-container p-3">
                  <div className="mb-1 font-mono text-[10px] font-bold uppercase text-primary">4. SETTLE</div>
                  <div className="text-xs text-on-surface-variant">Timer expires → auto-complete → revenue settled on-chain</div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs text-outline">
                <Clock className="h-3 w-3" />
                <span>Timer starts when provider accepts. Extend before expiry to avoid interruption. Max 5 min per execution.</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── EXTEND LEASE MODAL ── */}
      {showExtendModal && selectedJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowExtendModal(false)}>
          <div className="w-full max-w-md rounded-2xl bg-surface-container-low p-4" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <PlusCircle className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-on-surface">Extend Lease</h3>
                <p className="text-xs text-on-surface-variant">Add more compute time to Job #{selectedJob.jobId.toString()}</p>
              </div>
            </div>

            {/* Current time remaining */}
            {!countdown.expired && (
              <div className="mb-4 rounded-lg bg-surface-container p-3">
                <div className="flex justify-between text-xs">
                  <span className="text-on-surface-variant">Time Remaining</span>
                  <span className={`font-mono font-semibold ${urgencyColor}`}>{formatCountdown(countdown.remaining)}</span>
                </div>
              </div>
            )}

            {/* Hours selector */}
            <div className="mb-4">
              <label className="mb-2 block font-mono text-xs font-semibold uppercase text-outline">Extension Duration</label>
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 4, 8].map(h => (
                  <button
                    key={h}
                    onClick={() => setExtendHours(h)}
                    className={`rounded-lg border px-3 py-2 font-mono text-sm transition-all ${
                      extendHours === h
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-outline-variant/20 bg-surface-container text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {h}h
                  </button>
                ))}
              </div>
            </div>

            {/* Cost summary */}
            <div className="mb-4 rounded-lg bg-surface-container p-4">
              <div className="flex justify-between text-sm">
                <span className="text-on-surface-variant">Additional Cost</span>
                <span className="font-mono text-sm text-primary">
                  {formatBOT(selectedJob.pricePerHourWei * BigInt(extendHours))} DGRAM</span>
              </div>
              <div className="mt-1 flex justify-between font-mono text-[10px] text-outline">
                <span>{formatBOT(selectedJob.pricePerHourWei)} × {extendHours}h</span>
                <span>Added to session timer on confirmation</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleExtend}
                disabled={extending}
                className="flex-1 rounded-lg bg-primary px-6 py-3 font-mono text-sm font-semibold text-on-primary disabled:opacity-50"
              >
                {extending ? 'Extending...' : `Extend +${extendHours}h`}
              </button>
              <button onClick={() => setShowExtendModal(false)} className="rounded-lg border border-outline-variant/20 px-6 py-3 font-mono text-sm text-on-surface-variant">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
