import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const CONTROL =
  'w-full rounded-lg border border-outline-variant bg-surface-container px-3 text-body text-on-surface ' +
  'transition-colors placeholder:text-outline hover:border-outline ' +
  'focus:border-primary focus:outline-none focus-visible:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/** Label + control + hint, wired together for screen readers. Every
 *  form control in the app previously used a bare <label> with no
 *  `htmlFor`, so clicking a label did nothing. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: (props: { id: string; 'aria-describedby'?: string }) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint || error ? `${id}-hint` : undefined;

  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="mb-1.5 block text-eyebrow uppercase text-on-surface-variant">
        {label}
      </label>
      {children({ id, 'aria-describedby': hintId })}
      {(error || hint) && (
        <p
          id={hintId}
          className={cn('mt-1.5 text-caption', error ? 'text-compute-down' : 'text-outline')}
        >
          {error || hint}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(CONTROL, 'h-10', className)} />;
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={cn(CONTROL, 'h-10 appearance-none pr-9', className)}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline"
        aria-hidden
      />
    </div>
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(CONTROL, 'py-2.5', className)} />;
}
