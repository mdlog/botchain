/**
 * Vite plugin: AI pricing proxy middleware.
 *
 * Exposes POST /api/ai, which calls the configured AI provider (OpenAI or
 * Gemini) with API keys read from process.env.
 *
 * Why a server-side proxy: keys live in process.env under names WITHOUT the
 * VITE_ prefix, so Vite never bundles them into the client and they never reach
 * the browser.
 *
 * Request body: { model?, prompt }
 * Response:     { text: string } on success, { error: string } on failure.
 *
 * The provider is chosen by the server (AI_PROVIDER), not by the caller. It
 * used to be caller-supplied, which — combined with a caller-supplied model —
 * made this endpoint a free, unmetered LLM for anyone who could reach the dev
 * server. Requests are now capped in length and rate-limited per client.
 *
 * SCOPE: this middleware runs in `vite dev` and `vite preview` only. A static
 * `vite build` deployed to a CDN has no /api/ai route, and src/lib/pricing.ts
 * falls back to its heuristic pricer. To run AI pricing in production, mount
 * `handleAiRequest` in a serverless function or a small Node server.
 */

import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite';
import { loadEnv } from 'vite';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

/** Models the proxy is allowed to bill. An unknown model falls back to default. */
const ALLOWED_MODELS: Record<AiProvider, readonly string[]> = {
  openai: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
};

const DEFAULT_MODEL: Record<AiProvider, string> = {
  openai: 'gpt-4.1-mini',
  gemini: 'gemini-2.5-flash',
};

/** Pricing prompts are short; anything larger is not this endpoint's business. */
const MAX_PROMPT_CHARS = 8_000;
const MAX_BODY_BYTES = 32_000;

/** Per-client budget: enough for interactive use, useless as a free LLM. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;

type AiProvider = 'openai' | 'gemini';

interface AiRequestBody {
  model?: string;
  prompt?: string;
}

export type AiResult = { status: number; body: { text: string } | { error: string } };

const hits = new Map<string, number[]>();

function rateLimited(clientKey: string): boolean {
  const now = Date.now();
  const recent = (hits.get(clientKey) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  hits.set(clientKey, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

function resolveProvider(): AiProvider {
  return process.env.AI_PROVIDER?.toLowerCase() === 'openai' ? 'openai' : 'gemini';
}

function resolveModel(provider: AiProvider, requested: string | undefined): string {
  const configured = provider === 'openai' ? process.env.OPENAI_MODEL : process.env.GEMINI_MODEL;
  const candidate = requested ?? configured ?? DEFAULT_MODEL[provider];
  return ALLOWED_MODELS[provider].includes(candidate) ? candidate : DEFAULT_MODEL[provider];
}

async function callOpenAI(model: string, prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'MY_OPENAI_API_KEY') {
    throw new Error('OpenAI API key not set on server (OPENAI_API_KEY)');
  }
  const client = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL || undefined });
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
  });
  return res.choices[0]?.message?.content?.trim() ?? '';
}

async function callGemini(model: string, prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('Gemini API key not set on server (GEMINI_API_KEY)');
  }
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({ model, contents: prompt });
  return response.text?.trim() ?? '';
}

/**
 * Framework-agnostic handler. Kept free of Vite/Node request objects so the
 * same code can be mounted in a serverless function for a real deployment.
 */
export async function handleAiRequest(raw: string, clientKey: string): Promise<AiResult> {
  if (rateLimited(clientKey)) {
    return { status: 429, body: { error: 'Too many AI requests, slow down' } };
  }

  let body: AiRequestBody;
  try {
    body = JSON.parse(raw || '{}') as AiRequestBody;
  } catch {
    return { status: 400, body: { error: 'Invalid JSON body' } };
  }

  const prompt = body.prompt;
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return { status: 400, body: { error: 'Missing "prompt" field' } };
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return { status: 413, body: { error: `Prompt exceeds ${MAX_PROMPT_CHARS} characters` } };
  }

  const provider = resolveProvider();
  const model = resolveModel(provider, body.model);

  try {
    const text =
      provider === 'openai' ? await callOpenAI(model, prompt) : await callGemini(model, prompt);
    return { status: 200, body: { text } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI call failed';
    console.error('[ai-proxy] call failed:', message);
    return { status: 500, body: { error: message } };
  }
}

/** Adapts `handleAiRequest` to a Connect middleware, used by dev and preview. */
const middleware: Connect.SimpleHandleFunction = (req, res) => {
  void (async () => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let raw = '';
    let bytes = 0;
    for await (const chunk of req) {
      bytes += (chunk as Buffer).length;
      if (bytes > MAX_BODY_BYTES) {
        res.statusCode = 413;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
      raw += chunk;
    }

    const clientKey = req.socket.remoteAddress ?? 'unknown';
    const { status, body } = await handleAiRequest(raw, clientKey);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  })();
};

export function aiProxyPlugin(): Plugin {
  return {
    name: 'botchain-ai-proxy',

    config(_, { mode }) {
      // Load ALL .env vars (empty prefix = non-VITE_ vars too) into process.env
      // so the middleware can read the keys server-side. Vite only bundles
      // VITE_-prefixed vars into the client, so these stay off the wire.
      const env = loadEnv(mode, process.cwd(), '');
      for (const [k, v] of Object.entries(env)) {
        if (process.env[k] === undefined) process.env[k] = v;
      }
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/ai', middleware);
    },

    // Without this, `npm run preview` returned 404 for /api/ai and the app
    // silently degraded to heuristic pricing with no error shown anywhere.
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use('/api/ai', middleware);
    },
  };
}
