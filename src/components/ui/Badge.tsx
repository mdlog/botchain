import React from 'react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-container-high text-on-surface-variant',
  accent: 'bg-primary/12 text-primary',
  success: 'bg-compute-active/12 text-compute-active',
  warning: 'bg-compute-idle/12 text-compute-idle',
  danger: 'bg-compute-down/12 text-compute-down',
};

export function Badge({
  tone = 'neutral',
  icon: Icon,
  className,
  children,
}: {
  tone?: Tone;
  icon?: React.ElementType;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-eyebrow uppercase',
        TONES[tone],
        className,
      )}
    >
      {Icon && <Icon className="h-3 w-3" aria-hidden />}
      {children}
    </span>
  );
}

/** Status LED with an optional live pulse. Colour comes from
 *  `currentColor`, so wrap it in a text-* class. */
export function StatusDot({
  tone = 'neutral',
  live = false,
  className,
}: {
  tone?: Tone;
  live?: boolean;
  className?: string;
}) {
  const color = {
    neutral: 'text-outline',
    accent: 'text-primary',
    success: 'text-compute-active',
    warning: 'text-compute-idle',
    danger: 'text-compute-down',
  }[tone];

  return (
    <span aria-hidden className={cn('signal-dot', live && 'signal-dot--live', color, className)} />
  );
}
