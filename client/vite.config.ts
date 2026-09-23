import { defineConfig } from 'vite';

// Ports come from the environment so several worktrees can run their own stacks at once
// (scripts/dev.mjs sets both). The worker is `wrangler dev`, reached through this proxy in
// development so the page and the API share an origin.
const VITE_PORT = Number(process.env.VITE_PORT ?? 5173);
const WORKER_PORT = Number(process.env.WORKER_PORT ?? 8787);

// Where the built client talks to. Empty means "same origin" (dev, and preview through the
// proxy); the published build points at the real API host.
const API_ORIGIN = process.env.CASINO_API_ORIGIN ?? '';

// The same policy the site serves for /casino/ (see the site repo's _headers), pointed at the
// local worker. Only `vite preview` uses it: in dev, HMR injects <style> tags.
const PREVIEW_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  `connect-src 'self' blob: http://localhost:${WORKER_PORT} ws://localhost:${WORKER_PORT}`,
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

export default defineConfig({
  root: import.meta.dirname,
  base: '/casino/',
  publicDir: 'public',
  define: {
    __API_ORIGIN__: JSON.stringify(API_ORIGIN),
  },
  assetsInclude: ['**/*.glb'],
  server: {
    port: VITE_PORT,
    strictPort: true,
    proxy: {
      '/casino/api': { target: `http://localhost:${WORKER_PORT}` },
      '/casino/ws': { target: `ws://localhost:${WORKER_PORT}`, ws: true },
    },
  },
  preview: {
    port: VITE_PORT,
    strictPort: true,
    headers: { 'Content-Security-Policy': PREVIEW_CSP },
    proxy: {
      '/casino/api': { target: `http://localhost:${WORKER_PORT}` },
      '/casino/ws': { target: `ws://localhost:${WORKER_PORT}`, ws: true },
    },
  },
  build: {
    outDir: '../dist/casino',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] },
      },
    },
  },
});
