import { useCallback } from 'react';

/**
 * Open an authenticated interactive-terminal WebSocket to a provider's agent.
 *
 * Flow:
 *   1. Build an EIP-191 challenge: `botchain-terminal:{jobId}:{ts}`.
 *   2. Consumer signs it via wallet `personal_sign`.
 *   3. Open WS to `${agentWsUrl}/terminal/{jobId}`.
 *   4. First WS message = `{ address, signature, ts }` — the agent recovers the
 *      signer and verifies it equals the on-chain job consumer before granting a shell.
 *
 * Returns the open WebSocket (for xterm to attach to) plus a `close()` helper.
 * The caller owns closing the socket on unmount / lease expiry.
 */
export function useTerminal() {
  const openTerminal = useCallback(
    async (
      jobId: number,
      agentUrl: string,
      address: string,
      signMessage: (msg: string) => Promise<string>,
    ): Promise<{ ws: WebSocket; close: () => void }> => {
      const ts = String(Math.floor(Date.now() / 1000));
      const challenge = `botchain-terminal:${jobId}:${ts}`;
      const signature = await signMessage(challenge);

      // http(s) → ws(s); cloudflared tunnels proxy WebSocket.
      const wsBase = agentUrl.replace(/^http/, 'ws');
      const ws = new WebSocket(`${wsBase}/terminal/${jobId}`);
      // Receive binary frames as ArrayBuffer (sync) instead of the default
      // Blob (async). PTY output — including ANSI escape sequences like the
      // `clear` screen sequence — must reach xterm.js synchronously and in
      // order; Blob's async arrayBuffer() can reorder/split sequences so
      // escapes (clear, colors, cursor moves) fail to render correctly.
      ws.binaryType = 'arraybuffer';

      await new Promise<void>((resolve, reject) => {
        const onOpen = () => {
          ws.removeEventListener('open', onOpen);
          ws.removeEventListener('error', onError);
          ws.send(JSON.stringify({ address, signature, ts }));
          resolve();
        };
        const onError = () => {
          ws.removeEventListener('open', onOpen);
          ws.removeEventListener('error', onError);
          reject(new Error('Failed to connect to terminal (WS upgrade rejected)'));
        };
        ws.addEventListener('open', onOpen);
        ws.addEventListener('error', onError);
      });

      const close = () => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      return { ws, close };
    },
    [],
  );

  return { openTerminal };
}
