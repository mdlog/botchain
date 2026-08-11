import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Loader2, AlertTriangle } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { useWalletContext } from '@/context/WalletContext';
import { useTerminal } from '@/hooks/useTerminal';
import { TERMINAL_CLOSE_REASONS } from '@/lib/agentApi';

interface TerminalPanelProps {
  /** Active job id to open a shell for. */
  jobId: number;
  /** Provider agent base URL (http(s)://...). */
  agentUrl: string;
  /** Called when the terminal should be torn down (lease expired). */
  onExpired?: () => void;
}

type Status = 'connecting' | 'open' | 'closed' | 'error';

/**
 * Interactive terminal backed by xterm.js ↔ WebSocket ↔ provider agent.
 * The agent authenticates the consumer (personal_sign) and runs an isolated
 * (bubblewrap) shell. See compute-agent-rs/src/terminal.rs.
 */
export function TerminalPanel({ jobId, agentUrl, onExpired }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // onExpired is passed as an inline closure by the parent and rebuilds every
  // render (the parent re-renders ~every second due to the lease countdown).
  // Keep it in a ref so it never triggers this effect's re-run — otherwise the
  // effect (and therefore the wallet personal_sign prompt) would fire on every
  // countdown tick, flooding the user with MetaMask confirmations.
  const onExpiredRef = useRef(onExpired);
  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);
  const { address, signMessage } = useWalletContext();
  const { openTerminal } = useTerminal();
  const [status, setStatus] = useState<Status>('connecting');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!address) {
      setStatus('error');
      setErrorMsg('Connect your wallet to open a terminal.');
      return;
    }
    if (!agentUrl) {
      setStatus('error');
      setErrorMsg('Agent URL not available for this job.');
      return;
    }

    let cancelled = false;
    let ws: WebSocket | null = null;
    let closeFn: (() => void) | null = null;

    // These are created inside the async setup below, but only React's cleanup
    // can dispose them. Returning a cleanup from the async IIFE did nothing —
    // React never sees it — so every open/close leaked a resize listener and a
    // ResizeObserver pointing at a disposed terminal.
    let resizeObserver: ResizeObserver | null = null;
    let onWinResize: (() => void) | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let echoReadyTimer: ReturnType<typeof setTimeout> | null = null;
    let disposeInput: { dispose: () => void } | null = null;
    let disposeResize: { dispose: () => void } | null = null;

    const term = new Terminal({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 13,
      cursorBlink: true,
      convertEol: false,
      // Mirrors the app's design tokens (src/index.css) so the shell reads
      // as part of the console rather than a pasted-in terminal.
      theme: {
        background: '#0a0c11',
        foreground: '#e6e9f0',
        cursor: '#98cbff',
        selectionBackground: '#262c38',
        black: '#0a0c11',
        red: '#ff6b6b',
        green: '#35d97e',
        yellow: '#f5b544',
        blue: '#98cbff',
        magenta: '#c792ea',
        cyan: '#00a3ff',
        white: '#e6e9f0',
      },
    });
    termRef.current = term;
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    void (async () => {
      try {
        const result = await openTerminal(jobId, agentUrl, address, signMessage);
        if (cancelled) {
          result.close();
          return;
        }
        ws = result.ws;
        closeFn = result.close;

        // Defensive: ensure the container is mounted before opening xterm.
        const containerEl = containerRef.current;
        if (!containerEl) {
          console.error('[TerminalPanel] container not mounted — aborting');
          setStatus('error');
          setErrorMsg('Terminal container not ready.');
          closeFn();
          return;
        }
        try {
          term.open(containerEl);
        } catch (e) {
          console.error('[TerminalPanel] term.open failed', e);
          setStatus('error');
          setErrorMsg('Failed to open terminal renderer.');
          closeFn();
          return;
        }
        setStatus('open');

        // WS → terminal, tracking full-screen TUI mode for local-echo gating.
        // Watch for DECSET alt-screen escapes (\x1b[?1049h / ?47h) to know when a
        // TUI (vim/nano/top) owns the screen — in that mode local echo MUST be off.
        let appScreenActive = false;
        // ESC is a control character by definition — matching it is the whole
        // point of parsing terminal escape sequences.
        // eslint-disable-next-line no-control-regex
        const APP_ON = /\x1b\[\?(1049|47)h/,
          // eslint-disable-next-line no-control-regex
          APP_OFF = /\x1b\[\?(1049|47)l/;
        let outBuf = '';
        const flushParse = () => {
          if (outBuf.length > 4096) outBuf = outBuf.slice(-4096);
          if (APP_ON.test(outBuf)) {
            appScreenActive = true;
            outBuf = '';
          } else if (APP_OFF.test(outBuf)) {
            appScreenActive = false;
            outBuf = '';
          }
        };
        ws.onmessage = (ev: MessageEvent) => {
          if (typeof ev.data === 'string') {
            term.write(ev.data);
            outBuf += ev.data;
            flushParse();
          } else if (ev.data instanceof ArrayBuffer) {
            const u = new Uint8Array(ev.data);
            term.write(u);
            outBuf += new TextDecoder('utf-8', { fatal: false }).decode(u);
            flushParse();
          } else if (ev.data instanceof Blob) {
            void ev.data.arrayBuffer().then((b) => {
              const u = new Uint8Array(b);
              term.write(u);
              outBuf += new TextDecoder('utf-8', { fatal: false }).decode(u);
              flushParse();
            });
          }
        };
        ws.onclose = (ev) => {
          if (cancelled) return;
          const reason =
            TERMINAL_CLOSE_REASONS[ev.code] ?? ev.reason ?? `connection closed (${ev.code})`;
          if (ev.code === 4004 && onExpiredRef.current) onExpiredRef.current();
          setStatus('closed');
          term.writeln(`\r\n\x1b[1;31m[ ${reason} ]\x1b[0m`);
        };
        ws.onerror = () => {
          if (cancelled) return;
          setStatus('error');
          setErrorMsg('WebSocket error.');
        };

        // terminal → WS (keystrokes) + selective local echo.
        // Over a high-latency tunnel (~200ms RTT via Cloudflare), waiting for
        // the PTY echo round-trip per keystroke makes typing feel laggy. So in
        // SHELL mode we echo printable chars (and Enter→CRLF) locally for an
        // instant feel. To avoid DOUBLED characters we send `stty -echo` once
        // on connect so bash stops echoing the same chars we already echoed;
        // readline line-editing still works (it writes via stdout, not termios
        // ECHO). When a full-screen TUI starts (vim/nano/top), it sets its own
        // termios (raw mode) and restores ours (-echo) on exit — so local echo
        // stays correct, and we also disable it while the TUI owns the screen
        // (appScreenActive) as a belt-and-suspenders guard.
        const isPrintable = (s: string) =>
          s.length === 1 && s.charCodeAt(0) >= 32 && s.charCodeAt(0) <= 126;
        // Turn off the PTY's own echo so our local echo isn't doubled. Sent
        // immediately; the server processes it within ~1 RTT.
        ws.send('stty -echo\n');
        // Suppress local echo for the first ~600ms so the `stty -echo` command
        // settles server-side (otherwise the very first typed prints twice:
        // once locally, once from PTY echo before stty took effect).
        let echoReady = false;
        echoReadyTimer = setTimeout(() => {
          echoReady = true;
        }, 600);
        disposeInput = term.onData((data) => {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
          if (echoReady && !appScreenActive) {
            if (data === '\r') term.write('\r\n');
            else if (data.length === 1 && isPrintable(data)) term.write(data);
          }
        });

        // terminal resize → notify provider PTY (debounced). Without debounce,
        // ResizeObserver fires ~dozens of times during layout transitions
        // (overlay disappearing, flex settling, font load) and each fit() →
        // onResize → SIGWINCH. A SIGWINCH storm while nano/vim is starting up
        // corrupts their redraw and leaves the TUI apparently frozen (keystrokes
        // are read but never echoed). Debounce so SIGWINCH only fires once the
        // size has been stable for 150ms.
        // Guard: drop zero/tiny sizes — a 0-row resize (container unmeasured)
        // crashes TUI apps (nano segfault). Also never shrink below floor.

        const sendResize = () => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const rows = term.rows,
            cols = term.cols;
          if (rows < 2 || cols < 10) return;
          ws.send(JSON.stringify({ resize: { rows, cols } }));
        };
        disposeResize = term.onResize(() => {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => sendResize(), 150);
        });

        // Keep xterm's grid matched to the container — and thus to the PTY — by
        // re-fitting whenever the container changes size, not only on window
        // resize. Without this, nano / vim / top draw their bottom bars at a
        // row count that doesn't match what's actually visible. The onResize
        // debounce above means only the final stable size reaches the PTY.
        const doFit = () => {
          try {
            fitAddon.fit();
          } catch (e) {
            console.warn('[TerminalPanel] fit failed', e);
          }
        };
        resizeObserver = new ResizeObserver(() => doFit());
        if (containerRef.current) resizeObserver.observe(containerRef.current);
        onWinResize = () => doFit();
        window.addEventListener('resize', onWinResize);

        // Initial fit: defer two frames so the container has its final layout
        // dimensions; onResize then debounces to a single SIGWINCH giving nano
        // the true terminal size without a startup storm.
        requestAnimationFrame(() => requestAnimationFrame(() => doFit()));
      } catch (e: unknown) {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(e instanceof Error ? e.message : 'Failed to open terminal.');
      }
    })();

    return () => {
      cancelled = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      if (echoReadyTimer) clearTimeout(echoReadyTimer);
      disposeInput?.dispose();
      disposeResize?.dispose();
      resizeObserver?.disconnect();
      if (onWinResize) window.removeEventListener('resize', onWinResize);
      closeFn?.();
      term.dispose();
      termRef.current = null;
    };
  }, [jobId, agentUrl, address, openTerminal, signMessage]);

  return (
    <div className="relative flex h-full min-h-[480px] flex-col rounded-xl border border-outline-variant bg-surface-container-lowest">
      <div ref={containerRef} className="flex-1 overflow-hidden p-2" />
      {status === 'connecting' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-surface-container-lowest/60">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="font-mono text-caption text-on-surface-variant">
            Authenticating & opening shell…
          </span>
        </div>
      )}
      {status === 'error' && (
        <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-container-lowest/90 p-4 text-center">
          <AlertTriangle className="h-5 w-5 text-compute-down" />
          <span className="text-caption text-on-surface-variant">{errorMsg}</span>
        </div>
      )}
      {status === 'closed' && (
        <div className="pointer-events-none absolute bottom-2 right-3">
          <span className="rounded-md bg-surface-container px-2 py-1 text-eyebrow uppercase text-outline">
            Session ended
          </span>
        </div>
      )}
    </div>
  );
}
