import React from 'react';
import { cn } from '@/lib/utils';

/**
 * KPI tile. The value is the point, so it gets the largest type on the
 * card and the unit rides alongside it instead of being demoted to a
 * caption that reads like a separate fact.
 */
export function Stat({
  label,
  value,
  unit,
  detail,
  icon: Icon,
  tone = 'default',
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** Rendered next to the value, e.g. "DGRAM", "TFLOPS". */
  unit?: string;
  detail?: React.ReactNode;
  icon?: React.ElementType;
  tone?: 'default' | 'accent' | 'success';
  className?: string;
}) {
  const valueColor = {
    default: 'text-on-surface',
    accent: 'text-primary',
    success: 'text-compute-active',
  }[tone];

  return (
    <div
      className={cn(
        'rounded-xl border border-outline-variant bg-surface-container-low p-4',
        'transition-colors hover:border-outline/60',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-eyebrow uppercase text-on-surface-variant">{label}</span>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-outline" aria-hidden />}
      </div>
      <p className="mt-2.5 flex items-baseline gap-1.5">
        <span className={cn('font-mono text-metric', valueColor)}>{value}</span>
        {unit && <span className="text-caption font-medium text-on-surface-variant">{unit}</span>}
      </p>
      {detail && <p className="mt-1 text-caption text-outline">{detail}</p>}
    </div>
  );
}
