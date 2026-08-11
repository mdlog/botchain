import { cn } from '@/lib/utils';

/** Placeholder block matched to the shape of the content it stands in
 *  for — steadier than a full-page spinner, and it keeps the layout
 *  from jumping when data lands. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-md bg-surface-container-high', className)}
    />
  );
}

/** Row of KPI card placeholders, matching the StatCard footprint. */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-outline-variant bg-surface-container-low p-4"
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-6 w-24" />
          <Skeleton className="mt-2 h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Generic card placeholders for list/grid regions. */
export function SkeletonCards({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3', className)}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-outline-variant bg-surface-container-low p-5"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="mt-5 h-8 w-24" />
          <Skeleton className="mt-4 h-px w-full" />
          <div className="mt-4 flex items-center justify-between">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}
