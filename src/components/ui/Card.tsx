import React from 'react';
import { cn } from '@/lib/utils';

/** Surface primitive. One radius (`rounded-xl`) across the whole app —
 *  views previously mixed rounded-lg / xl / 2xl / 3xl arbitrarily. */
export function Card({
  className,
  as: Tag = 'div',
  ...props
}: React.HTMLAttributes<HTMLElement> & { as?: React.ElementType }) {
  return (
    <Tag
      {...props}
      className={cn('rounded-xl border border-outline-variant bg-surface-container-low', className)}
    />
  );
}

/** Card header: an icon chip, a title, and an optional description,
 *  with room for actions on the right. */
export function CardHeader({
  icon: Icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: React.ElementType;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container text-primary">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-subtitle text-on-surface">{title}</h2>
          {description && (
            <p className="mt-0.5 text-caption text-on-surface-variant">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
