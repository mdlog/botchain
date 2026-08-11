import React from 'react';
import { cn } from '@/lib/utils';

/**
 * An empty screen is an invitation to act, so this always has room for
 * the next step. The six views previously each rolled their own centred
 * `p-16` block with no action.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ElementType;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-outline-variant',
        'bg-surface-container-low/50 px-6 py-14 text-center',
        className,
      )}
    >
      <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-surface-container text-outline">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="text-subtitle text-on-surface">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-body text-on-surface-variant">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
