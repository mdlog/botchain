import { createContext, useContext, type ReactNode } from 'react';
import { useComputeSession } from '@/hooks/useComputeSession';

type SessionValue = ReturnType<typeof useComputeSession>;

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Hoists `useComputeSession` to app scope so the running-lease meter in
 * the top bar and the Execute view read the same jobs. This is not an
 * extra fetch — the Execute view used to re-run the same enumeration on
 * every mount, and now shares this one.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useComputeSession();
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSessionContext(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSessionContext must be used within SessionProvider');
  return ctx;
}
