import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
// vitest/config re-exports Vite's defineConfig with the `test` block typed.
import { defineConfig } from 'vitest/config';

import { aiProxyPlugin } from './vite-ai-proxy';

/**
 * `DEV_ALLOWED_HOSTS` is a comma-separated list of hostnames permitted to reach
 * the dev/preview server through a tunnel (Cloudflare, ngrok, Codespaces). It
 * used to be a hardcoded personal domain, which meant no other reviewer could
 * open the app through their own tunnel.
 */
const allowedHosts = (process.env.DEV_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react(), tailwindcss(), aiProxyPlugin()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    // The app was one 1.5 MB chunk, so the first paint waited on viem, recharts
    // and xterm together even on the dashboard. Splitting the three heavy
    // vendor trees lets the browser cache and fetch them independently.
    rollupOptions: {
      output: {
        manualChunks: {
          // React itself stays in the entry chunk — splitting it out produced
          // an empty file, because everything reaches it through the JSX runtime.
          viem: ['viem'],
          charts: ['recharts'],
          terminal: ['@xterm/xterm', '@xterm/addon-fit'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },

  server: {
    port: 3000,
    // Bind to localhost by default. Pass `npm run dev -- --host` to expose on
    // the LAN — the AI proxy below runs with a live API key, so listening on
    // 0.0.0.0 unconditionally was handing that key to the whole network.
    allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined,
    hmr: process.env.DISABLE_HMR !== 'true',
  },

  preview: {
    port: 3000,
    allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined,
  },

  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
