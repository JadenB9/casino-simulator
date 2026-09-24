// The load scripts' side of the wire: HTTP and WebSocket clients that look like the real one
// (Origin header, a client address per simulated player), with message and byte counts, plus the
// local D1 for the money checks and the workerd process for CPU time.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const START_BALANCE = 5_000_000;

/** Counts shared by every client of a scenario. */
export class Meter {
  constructor() {
    this.reset();
  }
  reset() {
    this.out = 0;
    this.in = 0;
    this.bytesOut = 0;
    this.bytesIn = 0;
    this.types = {};
    this.errs = {};
    this.closes = {};
    this.gaps = 0;
    this.started = Date.now();
  }
  seen(msg, bytes) {
    this.in++;
    this.bytesIn += bytes;
    const t = msg?.t ?? '?';
    this.types[t] = (this.types[t] ?? 0) + 1;
    if (t === 'err') this.errs[msg.code] = (this.errs[msg.code] ?? 0) + 1;
  }
  sent(bytes) {
    this.out++;
    this.bytesOut += bytes;
  }
  closed(code) {
    this.closes[code] = (this.closes[code] ?? 0) + 1;
  }
  summary() {
    const secs = Math.max(0.001, (Date.now() - this.started) / 1000);
    return {
      seconds: +secs.toFixed(1),
      sent: this.out,
      received: this.in,
      sentPerSec: +(this.out / secs).toFixed(1),
      receivedPerSec: +(this.in / secs).toFixed(1),
      kbIn: +(this.bytesIn / 1024).toFixed(1),
      kbOut: +(this.bytesOut / 1024).toFixed(1),
      types: this.types,
      errors: this.errs,
      closes: this.closes,
      seqGaps: this.gaps,
    };
  }
}

export class Server {
  constructor(port, origin) {
    this.base = `http://127.0.0.1:${port}`;
    this.ws = `ws://127.0.0.1:${port}`;
    this.origin = origin;
  }

  async api(path, { method = 'GET', token, body, ip } = {}) {
    const headers = { Origin: this.origin, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (ip) headers['CF-Connecting-IP'] = ip;
    const res = await fetch(`${this.base}/casino/api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: json, text };
  }

  /** Log in (a new name is created with this password; the field is ignored before names had them). */
  async login(name, ip, password = 'load-pass') {
    const r = await this.api('login', { method: 'POST', body: { name, password }, ip });
    if (r.status !== 200) throw new Error(`login ${name}: ${r.status} ${r.text}`);
    return { id: r.body.profile.id, name: r.body.profile.name, token: r.body.token, ip };
  }

  /** A socket to `path` (floor, table/<id>, solo/<game>) as this player. */
  connect(path, player, meter, extra = '') {
    return new Conn(`${this.ws}/casino/ws/${path}?v=1&t=${encodeURIComponent(player.token)}${extra}`, { Origin: this.origin, 'CF-Connecting-IP': player.ip }, meter);
  }
}

/** One WebSocket: a queue of parsed messages to wait on, and the meter it reports to. */
export class Conn {
  constructor(url, headers, meter) {
    this.msgs = [];
    this.waiters = [];
    this.closed = null;
    this.meter = meter;
    this.listeners = new Set();
    this.ws = new WebSocket(url, { headers });
    this.opened = new Promise((resolve) => {
      this.ws.onopen = () => resolve(true);
      this.ws.onerror = () => resolve(false);
    });
    this.ws.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      meter?.seen(m, e.data.length);
      for (const fn of this.listeners) fn(m);
      this.msgs.push(m);
      if (this.msgs.length > 500) this.msgs.splice(0, this.msgs.length - 500);
      for (const w of [...this.waiters]) {
        if (w.pred(m)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          const i = this.msgs.lastIndexOf(m);
          if (i >= 0) this.msgs.splice(i, 1);
          w.resolve(m);
        }
      }
    };
    this.done = new Promise((resolve) => {
      this.ws.onclose = (e) => {
        this.closed = { code: e.code, reason: e.reason };
        meter?.closed(e.code);
        for (const w of this.waiters.splice(0)) w.reject(new Error(`socket closed ${e.code} ${e.reason}`));
        resolve(this.closed);
      };
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  send(msg) {
    if (this.ws.readyState !== WebSocket.OPEN) return false;
    const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
    this.ws.send(data);
    this.meter?.sent(data.length);
    return true;
  }

  /** The next message matching `pred` (one already queued counts), or a rejection after `ms`. */
  next(pred, ms = 10_000) {
    const i = this.msgs.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.msgs.splice(i, 1)[0]);
    if (this.closed) return Promise.reject(new Error(`socket closed ${this.closed.code}`));
    return new Promise((resolve, reject) => {
      const w = { pred, resolve, reject };
      const t = setTimeout(() => {
        const k = this.waiters.indexOf(w);
        if (k >= 0) this.waiters.splice(k, 1);
        reject(new Error(`timed out; last: ${JSON.stringify(this.msgs.slice(-3)).slice(0, 400)}`));
      }, ms);
      w.resolve = (m) => {
        clearTimeout(t);
        resolve(m);
      };
      w.reject = (e) => {
        clearTimeout(t);
        reject(e);
      };
      this.waiters.push(w);
    });
  }

  close(code = 1000, reason = 'bye') {
    try {
      this.ws.close(code, reason);
    } catch {
      /* already closing */
    }
    return this.done;
  }
}

/** Rows from the local D1 behind `wrangler dev` (the same persisted state). */
export async function sql(cfg, query) {
  const { stdout } = await run(
    cfg.wrangler,
    ['d1', 'execute', 'DB', '--local', '--persist-to', cfg.state, '-c', 'server/wrangler.toml', '--json', '--command', query],
    { cwd: cfg.root, env: { ...process.env, CI: '1' }, maxBuffer: 64 * 1024 * 1024 },
  );
  const json = JSON.parse(stdout.slice(stdout.indexOf('[')));
  return json[0]?.results ?? [];
}

/** Money per account for names starting with `prefix`, and whether each one adds up. */
export async function audit(cfg, prefix) {
  const rows = await sql(
    cfg,
    `SELECT a.id, a.name, a.balance, a.in_play,
            (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l WHERE l.account_id = a.id) AS ledger,
            (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l WHERE l.account_id = a.id AND l.kind IN ('buyin', 'cashout', 'refund')) AS moved,
            (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l WHERE l.account_id = a.id AND l.kind IN ('grant', 'loan')) AS granted,
            (SELECT COALESCE(SUM(net), 0) FROM casino_stats s WHERE s.account_id = a.id) AS net,
            (SELECT COALESCE(SUM(rounds), 0) FROM casino_stats s WHERE s.account_id = a.id) AS rounds,
            (SELECT COALESCE(SUM(amount), 0) FROM casino_escrow e WHERE e.account_id = a.id) AS escrow,
            (SELECT COUNT(*) FROM casino_ledger l WHERE l.account_id = a.id AND l.kind = 'buyin') AS buyins,
            (SELECT COUNT(*) FROM casino_ledger l WHERE l.account_id = a.id AND l.kind = 'cashout') AS cashouts
       FROM casino_accounts a WHERE a.name LIKE '${prefix.replace(/'/g, '')}%' ORDER BY a.id`,
  );
  const problems = [];
  for (const r of rows) {
    // The ledger is every change to the balance: it must sum to it.
    if (r.ledger !== r.balance) problems.push(`${r.name}: ledger ${r.ledger} but balance ${r.balance}`);
    // Chips taken to tables are exactly the open escrows.
    if (r.in_play !== r.escrow) problems.push(`${r.name}: in_play ${r.in_play} but escrows ${r.escrow}`);
    // Conservation: balance plus chips on tables = what was granted plus every round's result.
    // (Only exact with nothing open: a live stack's wins or losses aren't in D1 until it cashes out.)
    if (r.escrow === 0 && r.balance !== r.granted + r.net) problems.push(`${r.name}: balance ${r.balance} but granted ${r.granted} + rounds' net ${r.net} = ${r.granted + r.net}`);
    // The money that moved at the edges is the rounds' results, cent for cent.
    if (r.escrow === 0 && r.moved !== r.net) problems.push(`${r.name}: ${r.moved} moved at the edges but rounds' net is ${r.net}`);
  }
  return { rows, problems };
}

/** CPU seconds used so far by the workerd processes under `pid` (the runtime running the Worker and objects). */
export async function workerdCpu(pid) {
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,time=,rss=,comm=']);
  const procs = stdout
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .map(([p, pp, time, rss, ...comm]) => ({ pid: +p, ppid: +pp, time, rss: +rss, comm: comm.join(' ') }));
  const tree = new Set([pid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of procs) if (tree.has(p.ppid) && !tree.has(p.pid)) (tree.add(p.pid), (grew = true));
  }
  let cpu = 0;
  let rss = 0;
  for (const p of procs) {
    if (!tree.has(p.pid) || !/workerd/.test(p.comm)) continue;
    cpu += p.time.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
    rss += p.rss;
  }
  return { cpu, rssMb: Math.round(rss / 1024) };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A small seeded random source, so a run can be repeated. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Addresses from the benchmarking range, one per simulated player. */
let addr = 0;
export function nextIp(base = 18) {
  addr++;
  return `198.${base}.${(addr >> 8) & 255}.${addr & 255}`;
}
