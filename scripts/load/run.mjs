#!/usr/bin/env node
// Load and robustness runs against a real `wrangler dev` (the Worker, both Durable Objects and a
// local D1), with Node WebSocket clients that look like the browser's (Origin, a client address
// each). Every run starts from an empty database in a temporary directory and stops its own
// wrangler when it's done.
//
//   node scripts/load/run.mjs                       # everything
//   node scripts/load/run.mjs tables storm          # some of: tables storm leader money floor
//   PORT_BASE=5970 node scripts/load/run.mjs        # the worker listens on PORT_BASE + 1
//   node scripts/load/run.mjs --rounds 4 --walkers 50 --seconds 30 --json out.json
//   node scripts/load/run.mjs floor --walkers 150 --policy old --pattern zigzag   # before/after, worst case
//
// Scenarios:
//   tables   8 players in one lobby at each multiplayer game, all nine at once; money audited
//   storm    the same with sockets dropping at random mid-round and while seated, and a whole
//            table dropping at once; every return checked (same seat, bets kept)
//   leader   leader handoff with several drops, in real time
//   money    concurrent buy-ins, top-ups and cash-outs, replays, two tabs
//   floor    50 walkers on the one floor: emotes, floor seats (sit, stand, refused), bar orders
//            held in the hand (--sit and --order: the share of walkers who do them)
// After each: the D1 audit (ledger = balance, in_play = escrows, balance = grants + every round's
// net), message and byte rates, workerd CPU seconds, and the server's error lines.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, createWriteStream, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Meter, Server, audit, rng, sleep, workerdCpu } from './net.mjs';
import { tables } from './tables.mjs';
import { leader } from './leader.mjs';
import { money } from './money.mjs';
import { floor } from './floor.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const ALL = ['tables', 'storm', 'leader', 'money', 'floor'];
const chosen = argv.filter((a, i) => ALL.includes(a) && !argv[i - 1]?.startsWith('--'));
const scenarios = chosen.length ? chosen : ALL;
const base = Number(process.env.PORT_BASE ?? 5970);
const port = Number(flag('port', base + 1));
const origin = `http://localhost:${base}`;
const wrangler = join(root, 'node_modules/.bin/wrangler');
const state = mkdtempSync(join(tmpdir(), 'casino-load-'));
const logPath = join(state, 'wrangler.log');
const cfg = { root, state, wrangler };

function log(...a) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
}

// --- a fresh local stack --------------------------------------------------------------------
log(`state ${state}`);
execFileSync(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', '-c', 'server/wrangler.toml', '--persist-to', state], { cwd: root, env: { ...process.env, CI: '1' }, stdio: 'ignore' });
const out = createWriteStream(logPath);
const dev = spawn(wrangler, ['dev', '-c', 'server/wrangler.toml', '--port', String(port), '--inspector-port', '0', '--persist-to', state, '--show-interactive-dev-session=false'], {
  cwd: root,
  env: { ...process.env, CI: '1' },
  detached: true,
});
dev.stdout.pipe(out);
dev.stderr.pipe(out);
const stop = () => {
  try {
    process.kill(-dev.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
};
// Stopped from outside too: never leave a wrangler (and its file watcher) running behind us.
process.on('SIGINT', () => (stop(), process.exit(130)));
process.on('SIGTERM', () => (stop(), process.exit(143)));
process.on('exit', stop);
const server = new Server(port, origin);
for (let i = 0; ; i++) {
  if (i > 240) throw new Error('wrangler dev never answered; see ' + logPath);
  try {
    if ((await fetch(`${server.base}/casino/api/health`)).ok) break;
  } catch {
    /* not yet */
  }
  await sleep(250);
}
log(`wrangler dev on ${port} (pid ${dev.pid})`);

/** Server log lines that mean something went wrong inside (console.error from the objects, exceptions). */
let logFrom = 0;
function serverErrors() {
  const text = readFileSync(logPath, 'utf8');
  const fresh = text.slice(logFrom);
  logFrom = text.length;
  const lines = fresh.split('\n').filter((l) => /(✘|\[ERROR\]|error|failed|rejected|Uncaught|exception|stuck)/i.test(l) && !/^\s*$/.test(l));
  const counts = {};
  for (const l of lines) {
    const key = l.replace(/\x1b\[[0-9;]*m/g, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>').replace(/\b\d+\b/g, 'N').trim().slice(0, 140);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// --- scenarios ------------------------------------------------------------------------------
const report = { port, state, scenarios: {} };
const tag = `l${Date.now().toString(36).slice(-4)}`;
let failed = false;
for (const [i, name] of scenarios.entries()) {
  const meter = new Meter();
  const ctx = { server, meter, rand: rng(1_000 + i), tag: `${tag}${i}`, log, cpu: () => workerdCpu(dev.pid) };
  const cpu0 = await workerdCpu(dev.pid);
  const t0 = Date.now();
  log(`${name}: start`);
  let result;
  try {
    if (name === 'tables') result = await tables(ctx, { rounds: Number(flag('rounds', 6)) });
    else if (name === 'storm') result = await tables(ctx, { rounds: Number(flag('rounds', 6)), storm: true, dropRate: Number(flag('drop-rate', 0.03)) });
    else if (name === 'leader') result = await leader(ctx);
    else if (name === 'money') result = await money(ctx);
    else if (name === 'floor') result = await floor(ctx, { walkers: Number(flag('walkers', 50)), seconds: Number(flag('seconds', 30)), policy: flag('policy', 'new'), pattern: flag('pattern', 'waypoints'), sit: Number(flag('sit', 0.3)), order: Number(flag('order', 0.15)) });
  } catch (err) {
    result = { failed: String(err?.stack ?? err) };
  }
  await sleep(1_500); // the last cash-outs land
  const cpu1 = await workerdCpu(dev.pid);
  const traffic = meter.summary();
  const money_ = await audit(cfg, ctx.tag);
  const errors = serverErrors();
  const cpu = +(cpu1.cpu - cpu0.cpu).toFixed(2);
  const entry = {
    seconds: +((Date.now() - t0) / 1000).toFixed(1),
    result,
    audit: { accounts: money_.rows.length, problems: money_.problems, rounds: money_.rows.reduce((s, r) => s + r.rounds, 0), buyins: money_.rows.reduce((s, r) => s + r.buyins, 0), cashouts: money_.rows.reduce((s, r) => s + r.cashouts, 0), openEscrows: money_.rows.filter((r) => r.escrow > 0).length },
    traffic,
    workerd: { cpuSeconds: cpu, cpuMsPerInboundMessage: traffic.sent ? +((cpu * 1000) / traffic.sent).toFixed(3) : null, rssMb: cpu1.rssMb },
    serverErrors: errors,
  };
  report.scenarios[name] = entry;
  const bad =
    !!result?.failed ||
    result?.ok === false ||
    money_.problems.length > 0 ||
    entry.audit.openEscrows > 0 ||
    (Array.isArray(result) && result.some((r) => r.failed || r.notRestored?.length || r.betsLost?.length || r.dealtOut?.length || r.leftCleanly !== r.players));
  if (bad) failed = true;
  log(`${name}: ${bad ? 'PROBLEMS' : 'ok'} in ${entry.seconds}s`);
  console.log(JSON.stringify(entry, null, 2));
}

stop();
const json = flag('json', null);
if (json) writeFileSync(json, JSON.stringify(report, null, 2));
log(failed ? 'finished with problems' : 'finished clean');
if (!argv.includes('--keep')) {
  await sleep(1_000);
  rmSync(state, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
