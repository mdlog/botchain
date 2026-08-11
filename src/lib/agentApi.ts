/**
 * Client for a provider's compute agent.
 *
 * Every mutating route is authenticated: the caller signs a scoped EIP-191
 * challenge and the agent recovers the signer, then checks it against the
 * on-chain party for that job. The scope and job id are inside the signed
 * string, so a signature for one route or one lease cannot be replayed on
 * another. The agent rejects a challenge older than 60 seconds, which is why
 * signing happens per request rather than once per session.
 */

export type AuthScope = 'execute' | 'accept' | 'complete';

export interface SignedAuth {
  address: string;
  signature: string;
  ts: string;
}

export type SignMessage = (message: string) => Promise<string>;

export async function signChallenge(
  scope: AuthScope,
  jobId: bigint | number,
  address: string,
  signMessage: SignMessage,
): Promise<SignedAuth> {
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = await signMessage(`botchain-${scope}:${jobId}:${ts}`);
  return { address, signature, ts };
}

export class AgentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

/**
 * `fetch`, with a guard against the page's own `fetch` having been replaced.
 *
 * Wallet extensions monkey-patch `window.fetch` to intercept their own traffic,
 * and at least one of them (Backpack, via `__backpackXnftFetch`) returns
 * `undefined` for requests it does not handle instead of a Response or a
 * rejection. Every consumer of this app runs a wallet extension by definition,
 * so a broken `fetch` is an ordinary condition here, not an exotic one — and
 * without this check it surfaced as "Cannot read properties of undefined
 * (reading 'text')", which points nowhere.
 */
async function request(url: string, init?: RequestInit): Promise<Response> {
  const res: unknown = await fetch(url, init);
  if (!(res instanceof Response)) {
    throw new AgentError(
      'A browser extension has replaced this page’s network layer and returned nothing for ' +
        'the request. Disable wallet extensions for this site (Backpack is a known cause) or ' +
        'open it in a profile without them.',
      0,
    );
  }
  return res;
}

/**
 * The agent answers with JSON on every path, including failures. Reading the
 * body before checking `res.ok` used to surface a JSON parse error instead of
 * the agent's actual message.
 */
async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AgentError(text.slice(0, 200) || `Agent returned ${res.status}`, res.status);
  }
  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String(body.error)
        : `Agent returned ${res.status}`;
    throw new AgentError(message, res.status);
  }
  return body as T;
}

export interface ExecutionResult {
  executionId: string;
  status: 'completed' | 'failed' | 'error' | 'running';
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
}

export async function executeOnAgent(
  agentUrl: string,
  jobId: bigint,
  language: 'python3' | 'node',
  code: string,
  auth: SignedAuth,
): Promise<ExecutionResult> {
  const res = await request(`${agentUrl}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: Number(jobId), language, code, auth }),
  });
  return parse<ExecutionResult>(res);
}

export async function acceptJobOnAgent(
  agentUrl: string,
  jobId: bigint,
  auth: SignedAuth,
): Promise<void> {
  await parse(
    await request(`${agentUrl}/jobs/${jobId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth }),
    }),
  );
}

export async function completeJobOnAgent(
  agentUrl: string,
  jobId: bigint,
  auth: SignedAuth,
): Promise<void> {
  await parse(
    await request(`${agentUrl}/jobs/${jobId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth }),
    }),
  );
}

export interface AgentGpu {
  model?: string;
  vramMb?: number;
}

export interface AgentInfo {
  provider?: string;
  nodeIds?: string[];
  gpus?: AgentGpu[];
  gpuSummary?: {
    /** e.g. "NVIDIA RTX 3060 ×2" when the node runs more than one card. */
    unifiedModel?: string;
    /** One entry per physical card. */
    models?: string[];
    totalVramMb?: number;
    count?: number;
  };
  /** False when bubblewrap is missing — the node cannot run code at all. */
  sandbox?: boolean;
  /** False when the Docker socket is unreachable — no interactive terminal. */
  docker?: boolean;
  runtimes?: string[];
  version?: string;
}

export async function fetchAgentInfo(agentUrl: string): Promise<AgentInfo | null> {
  try {
    return await parse<AgentInfo>(await request(`${agentUrl}/info`));
  } catch {
    return null;
  }
}

/** Human-readable reasons for the agent's WebSocket close codes. */
export const TERMINAL_CLOSE_REASONS: Record<number, string> = {
  4001: 'Terminal authentication failed — the signature did not match your wallet.',
  4002: 'The agent could not read this lease from the chain.',
  4003: 'This lease is not active on this provider.',
  4004: 'This lease has expired.',
  4010: 'This provider node has no reachable Docker daemon, so the terminal is unavailable.',
  4011: 'The terminal image is missing on this provider node.',
  4012: 'The provider node could not start the session container.',
  4013: 'The provider node could not prepare the session workspace.',
};
