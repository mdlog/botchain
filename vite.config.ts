import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
// vitest/config re-exports Vite's defineConfig with the `test` block typed.
import { defineConfig } from 'vitest/config';

import { aiProxyPlugin } from './vite-ai-proxy';

/**
 * Hostnames permitted to reach the dev/preview server through a reverse proxy
 * or tunnel. This used to be a hardcoded personal domain, so no other reviewer
 * could open the app through their own tunnel.
 *
 * Set `DEV_ALLOWED_HOSTS` to a comma-separated list, or to `*` when the server
 * only ever sees traffic from a proxy you control — `*` turns off Vite's
 * DNS-rebinding protection, so do not use it on a directly exposed port.
 */
function resolveAllowedHosts(raw: string): string[] | true | undefined {
  const value = raw.trim();
  if (value === '*') return true;
  const hosts = value
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : undefined;
}

export default defineConfig(({ mode }) => {
  // Vite loads .env AFTER building this config, and only exposes VITE_-prefixed
  // vars to it — so reading process.env here would ignore the file silently.
  // The empty prefix pulls in unprefixed vars too.
  const env = loadEnv(mode, process.cwd(), '');
  const allowedHosts = resolveAllowedHosts(env.DEV_ALLOWED_HOSTS ?? '');

  return {
    plugins: [react(), tailwindcss(), aiProxyPlugin()],

    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },

    build: {
      // The app was one 1.5 MB chunk, so the first paint waited on viem,
      // recharts and xterm together even on the dashboard. Splitting the heavy
      // vendor trees lets the browser cache and fetch them independently.
      rollupOptions: {
        output: {
          manualChunks: {
            // React itself stays in the entry chunk — splitting it out produced
            // an empty file, because everything reaches it through the JSX
            // runtime.
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
      // the LAN — the AI proxy runs with a live API key, so listening on
      // 0.0.0.0 unconditionally was handing that key to the whole network.
      allowedHosts,
      hmr: env.DISABLE_HMR !== 'true',
    },

    preview: {
      port: 3000,
      allowedHosts,
    },

    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
