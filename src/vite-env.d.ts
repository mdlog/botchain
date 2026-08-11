/// <reference types="vite/client" />

/**
 * Typed client env. Without this, `import.meta.env` was `any`, which is why
 * src/lib/pricing.ts had to cast it.
 */
interface ImportMetaEnv {
  /** Which AI provider the *client* asks for. The server (AI_PROVIDER) decides. */
  readonly VITE_AI_PROVIDER?: 'openai' | 'gemini';
  /** Chain to talk to: "testnet" (968, default) or "mainnet" (677). */
  readonly VITE_CHAIN?: 'testnet' | 'mainnet';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * `deviceMemory` is a Device Memory API extension, not part of lib.dom, but it
 * is what the hardware detector uses to estimate RAM. Declaring it here beats
 * casting `navigator` to `any` at each call site.
 */
interface Navigator {
  readonly deviceMemory?: number;
}
