import { useEffect, useState } from 'react';
import { useSessionContext } from '@/context/SessionContext';
import { cn } from '@/lib/utils';

/** Seconds → HH:MM:SS. */
export function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, '0')).join(':');
}

/**
 * Compute is time you paid for, and it is running out — that is the one
 * thing this product has that a generic dashboard doesn't. It used to be
 * the sixth column of a grid on a single page; here it rides in the top
 * bar on every page for as long as a lease is live, and disappears
 * entirely when nothing is running.
 *
 * The ring depletes as the lease burns down and shifts accent → warning
 * → danger in the last 30% / 10%.
 */
export function LeaseMeter({ onOpen }: { onOpen: () => void }) {
  const { jobs } = useSessionContext();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const active = jobs.filter((j) => j.status === 1);

  // Only run a timer while something is actually counting down.
  useEffect(() => {
    if (active.length === 0) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [active.length]);

  if (active.length === 0) return null;

  // Show the lease closest to expiry — that's the one that needs a decision.
  const soonest = active
    .map((j) => {
      const total = Number(j.durationHours) * 3600;
      const remaining = Math.max(0, Number(j.startedAt) + total - now);
      return { job: j, total, remaining };
    })
    .sort((a, b) => a.remaining - b.remaining)[0];

  const { job, total, remaining } = soonest;
  const ratio = total > 0 ? remaining / total : 0;
  const urgency = ratio <= 0.1 ? 'danger' : ratio <= 0.3 ? 'warning' : 'normal';

  const color = {
    normal: 'text-primary',
    warning: 'text-compute-idle',
    danger: 'text-compute-down',
  }[urgency];

  const R = 9;
  const CIRC = 2 * Math.PI * R;

  return (
    <button
      onClick={onOpen}
      title={`Job #${job.jobId.toString()} — ${formatCountdown(remaining)} remaining`}
      className={cn(
        'flex items-center gap-2.5 rounded-lg border border-outline-variant bg-surface-container',
        'py-1.5 pl-2 pr-3 transition-colors hover:border-outline hover:bg-surface-container-high',
      )}
    >
      <span className={cn('relative flex h-6 w-6 items-center justify-center', color)}>
        <svg viewBox="0 0 24 24" className="h-6 w-6 -rotate-90" aria-hidden>
          <circle
            cx="12"
            cy="12"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="opacity-15"
          />
          <circle
            cx="12"
            cy="12"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - ratio)}
            className="transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        </svg>
      </span>

      <span className="flex flex-col items-start leading-none">
        <span className="text-eyebrow uppercase text-on-surface-variant">
          {active.length > 1 ? `${active.length} leases` : 'Lease'}
        </span>
        <span className={cn('mt-1 font-mono text-label font-semibold', color)}>
          {formatCountdown(remaining)}
        </span>
      </span>
    </button>
  );
}
