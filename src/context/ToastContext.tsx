import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, AlertCircle, Info, X, ExternalLink } from 'lucide-react';
import { activeChain } from '@/config/chain';
import { cn } from '@/lib/utils';

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Transaction hash — rendered as a link to the block explorer. */
  txHash?: string;
}

interface ToastApi {
  success: (title: string, opts?: { description?: string; txHash?: string }) => void;
  error: (title: string, opts?: { description?: string }) => void;
  info: (title: string, opts?: { description?: string }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_STYLE: Record<ToastTone, { icon: React.ElementType; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-compute-active' },
  error: { icon: AlertCircle, className: 'text-compute-down' },
  info: { icon: Info, className: 'text-primary' },
};

const EXPLORER = activeChain.blockExplorers?.default?.url ?? '';

let nextId = 1;

/**
 * Replaces the native `alert()` calls the app used for every
 * transaction result. Blocking dialogs interrupt the wallet flow and
 * can't show a link to the transaction; these can.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, title: string, opts?: { description?: string; txHash?: string }) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, tone, title, ...opts }]);
      // Errors stay longer — they usually need reading, not just noticing.
      setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 5000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, opts) => push('success', title, opts),
      error: (title, opts) => push('error', title, opts),
      info: (title, opts) => push('info', title, opts),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((t) => {
          const { icon: Icon, className } = TONE_STYLE[t.tone];
          return (
            <div
              key={t.id}
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-xl border border-outline-variant',
                'bg-surface-container p-3.5 shadow-xl shadow-black/40',
                'motion-safe:animate-[toast-in_180ms_ease-out]',
              )}
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', className)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-label text-on-surface">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-caption text-on-surface-variant">{t.description}</p>
                )}
                {t.txHash && EXPLORER && (
                  <a
                    href={`${EXPLORER}/tx/${t.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1 font-mono text-caption text-primary hover:underline"
                  >
                    {t.txHash.slice(0, 10)}…{t.txHash.slice(-6)}
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="-m-1 rounded p-1 text-outline transition-colors hover:text-on-surface"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <style>{`@keyframes toast-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }`}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
