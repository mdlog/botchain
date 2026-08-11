import React from 'react';
import { cn } from '@/lib/utils';

/**
 * The single page container. Every view previously invented its own
 * gutters (`px-6 pb-8`, `p-8 pb-12`, `p-4 md:p-8`) and two of them
 * created a nested scroll container while the rest scrolled the
 * document — so pages felt like different apps. One shell, one
 * measure, one scroll.
 */
export function PageShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8', className)}
    >
      {children}
    </div>
  );
}

/** Page title, one-line description, and a slot for page-level actions. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'mb-6 flex flex-col gap-4 border-b border-outline-variant pb-6 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-display text-on-background">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-body text-on-surface-variant">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Heading for a region inside a page — one step below PageHeader. */
export function SectionHeader({
  icon: Icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: React.ElementType;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-end justify-between gap-4', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-container text-primary">
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-title text-on-background">{title}</h2>
          {description && <p className="text-caption text-on-surface-variant">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
