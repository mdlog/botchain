import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-fixed active:bg-primary-fixed-dim',
  secondary:
    'border border-outline-variant bg-surface-container text-on-surface hover:border-outline hover:bg-surface-container-high',
  ghost: 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
  danger:
    'border border-compute-down/40 bg-compute-down/10 text-compute-down hover:bg-compute-down/20',
  success:
    'border border-compute-active/40 bg-compute-active/10 text-compute-active hover:bg-compute-active/20',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-3 text-caption',
  md: 'h-9 gap-2 px-4 text-label',
  lg: 'h-11 gap-2 px-5 text-body',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and blocks interaction. Keep the label visible so
   *  the button doesn't change width mid-transaction. */
  loading?: boolean;
  icon?: React.ElementType;
  fullWidth?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon: Icon,
  fullWidth = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap',
        'transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
      ) : null}
      {children}
    </button>
  );
}
