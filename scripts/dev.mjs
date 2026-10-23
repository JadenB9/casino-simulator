#!/usr/bin/env node
// Local stack: apply D1 migrations to the local database, then run `wrangler dev` (the Worker
// and Durable Objects) and Vite (the client) together. PORT_BASE picks the ports so several
// checkouts can run side by side: Vite on PORT_BASE, the worker on PORT_BASE + 1.
//
//   npm run dev                  # http://localhost:5173/casino/
//   PORT_BASE=5210 npm run dev   # http://localhost:5210/casino/
//   npm run dev -- --preview     # the production build instead (built first, served by `vite
//                                # preview` with the site's CSP): real chunk and asset sizes for
//                                # scripts/e2e/loadtime.mjs; the dev pages and /casino/src/ aren't there
import { spawn, execFileSync } from 'node:child_process';

const base = Number(process.env.PORT_BASE ?? 5173);
const vitePort = base;
const workerPort = base + 1;
const preview = process.argv.includes('--preview');
const env = { ...process.env, VITE_PORT: String(vitePort), WORKER_PORT: String(workerPort) };
const bin = (name) => `node_modules/.bin/${name}`;
// (its own folder, so a preview never stands in for what `npm run build` publishes)
const previewDir = '../dist/preview';

execFileSync(bin('wrangler'), ['d1', 'migrations', 'apply', 'DB', '--local', '-c', 'server/wrangler.toml'], { stdio: 'inherit', env: { ...env, CI: '1' } });
// The page talks to the worker through the preview's proxy, as it does through the dev server's.
if (preview) execFileSync(bin('vite'), ['build', '--config', 'client/vite.config.ts', '--outDir', previewDir, '--emptyOutDir'], { stdio: 'inherit', env: { ...env, CASINO_API_ORIGIN: '' } });

const procs = [
  spawn(bin('wrangler'), ['dev', '-c', 'server/wrangler.toml', '--port', String(workerPort), '--inspector-port', '0'], { stdio: 'inherit', env }),
  spawn(bin('vite'), preview ? ['preview', '--config', 'client/vite.config.ts', '--outDir', previewDir] : ['--config', 'client/vite.config.ts'], { stdio: 'inherit', env }),
];
console.log(`\n  casino${preview ? ' (production build)' : ''}: http://localhost:${vitePort}/casino/   (worker on ${workerPort})\n`);
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { stop(); process.exit(code ?? 0); });
