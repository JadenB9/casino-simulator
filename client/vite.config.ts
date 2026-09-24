import { defineConfig, type Plugin } from 'vite';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Every model gzipped beside itself in the build (`x.glb.gz`): the site's CDN sends model files as
 * they are, and render/model-bytes.ts fetches these and unpacks them in the browser (the
 * characters come to a third of their size). The plain .glb stays for browsers without
 * DecompressionStream.
 */
function packModels(): Plugin {
  let outDir = '';
  return {
    name: 'casino-pack-models',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    writeBundle() {
      const dir = join(outDir, 'assets/models');
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.glb'))) {
        writeFileSync(join(dir, `${f}.gz`), gzipSync(readFileSync(join(dir, f)), { level: 9 }));
      }
    },
  };
}

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
  plugins: [packModels()],
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
