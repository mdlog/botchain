import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Dialog with the behaviour a dialog is expected to have: Escape
 * closes it, focus moves inside on open and returns to the trigger on
 * close, Tab is trapped, and the page behind it can't scroll. The
 * two hand-rolled modals it replaces had none of that.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  icon?: React.ElementType;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    // Focus the first control rather than the panel, so keyboard users
    // land on something actionable.
    requestAnimationFrame(() => (focusables()[0] ?? panelRef.current)?.focus());

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-outline-variant bg-surface-container-low',
          'shadow-2xl shadow-black/50 sm:max-w-md sm:rounded-2xl',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant p-5">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                <Icon className="h-4.5 w-4.5" aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              <h2 className="text-title text-on-surface">{title}</h2>
              {description && (
                <p className="mt-1 text-caption text-on-surface-variant">{description}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="-m-1 rounded-lg p-1 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">{children}</div>

        {footer && <div className="flex gap-3 border-t border-outline-variant p-5">{footer}</div>}
      </div>
    </div>
  );
}
