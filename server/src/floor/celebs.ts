// Celebrities and the gift box, the floor's side (shared/src/celebs.ts has the rest).
//
// A visit is planned ahead and told to everyone at once (`celeb`, and in each newcomer's
// `celebs` after hello): which celebrity, when they walk in, and a seed. From then on every client
// works out where they are from the clock, and so does this file when someone asks for a word:
// the player's position (presence) must be within TALK_REACH_M of where the route puts the
// celebrity at that moment. Each account gets one tip per visit, decided here: an amount rolled
// within the band and a line to go with it, paid as a 'grant' keyed celeb:<account>:<visit>.
//
// Happy hour (shared/src/happyhour.ts) rides along: newcomers hear when the one going on or the
// next is, and everyone hears the next when one is over.
//
// A gift box is different: where it is stays here until it appears (someone could otherwise wait
// on the spot), and whoever opens it first keeps what's in it (gift:<box>, one payment per box
// whoever asks).
//
// Nothing runs on a timer. The floor calls tick() whenever anyone does anything (a step, a word,
// a connection); plans are made, boxes appear and run out on those calls, so all of this only
// happens while people are on the floor, and the object still hibernates when nobody is.
// What must outlive hibernation (the visit, the box and what's in it, the plans) is one row in
// the floor's SQLite.

import {
  CELEBS, FIRST_GIFT_MS, FIRST_VISIT_MS, GIFT_GAP_MS, GIFT_MS, GIFT_REACH_M, GIFT_SPOTS, TALK_REACH_M, VISIT_GAP_MS,
  celebAt, celebOf, rollGift, rollTip, visitEnd,
  type CelebClientMsg, type CelebId, type CelebNo, type CelebServerMsg, type GiftBox, type Visit,
} from '../../../shared/src/celebs.ts';
import type { Cents } from '../../../shared/src/money.ts';
import { HAPPY_MS, nextHappyHour, type HappyHour } from '../../../shared/src/happyhour.ts';
import { KeyedBuckets } from '../ratelimit.ts';
import { fail, json, readJson } from '../http.ts';
import { grant, tallyStatement } from '../daily.ts';
import { startDevHappy } from '../happy.ts';

/** A box whose moment passed this long ago with nobody here to see it is put off, not left late. */
const GIFT_LATE_MS = 2 * 60_000;
/** Words with a celebrity and boxes opened, per account: a couple, then one every two seconds. */
const ASK_BURST = 3;
const ASK_PER_SEC = 0.5;

interface Stored {
  /** The visit planned or going on (null between one ending and the next being planned). */
  visit: Visit | null;
  /** When the last visit started, and who it was (the next is someone else). */
  lastStart: number | null;
  last: CelebId | null;
  /** The box waiting to be found, with what's in it (never sent to anyone). */
  gift: (GiftBox & { amount: Cents }) | null;
  /** When the next box appears. */
  giftAt: number | null;
  lastGift: number | null;
}

/** Where a player stands, as presence last heard (cm). */
export interface Here {
  accountId: number;
  name: string;
  x: number;
  z: number;
}

export interface CelebsDeps {
  sql: SqlStorage;
  db: () => D1Database;
  /** Where this socket's player stands. */
  where: (ws: WebSocket) => Here | null;
  broadcast: (msg: CelebServerMsg) => void;
  /** 0 <= x < 1; tests pass their own. */
  random?: () => number;
}

const EMPTY: Stored = { visit: null, lastStart: null, last: null, gift: null, giftAt: null, lastGift: null };

export class Celebs {
  private s: Stored;
  /** The next time tick() has anything to do. */
  private due = 0;
  private readonly asks = new KeyedBuckets(ASK_BURST, ASK_PER_SEC);
  /** Payments on their way to D1, by op id: a second ask for the same one waits for it. */
  private readonly paying = new Map<string, Promise<void>>();
  private readonly random: () => number;
  /** The happy hour the floor last told everyone about (the schedule's, or a dev one). */
  private happy: HappyHour | null = null;
  private devHappy: HappyHour | null = null;

  constructor(private readonly deps: CelebsDeps) {
    this.random = deps.random ?? Math.random;
    deps.sql.exec(`CREATE TABLE IF NOT EXISTS celebs (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    const row = deps.sql.exec<{ v: string }>(`SELECT v FROM celebs WHERE k = 'state'`).toArray()[0];
    let s: Stored = { ...EMPTY };
    try {
      if (row) s = { ...EMPTY, ...(JSON.parse(row.v) as Partial<Stored>) };
    } catch {
      /* start afresh */
    }
    this.s = s;
  }

  /** The visit planned or going on, and the box waiting to be found (for the checks). */
  get visit(): Visit | null {
    return this.s.visit;
  }

  get gift(): (GiftBox & { amount: Cents }) | null {
    return this.s.gift;
  }

  /** Someone did something on the floor: plan, start and end what's due. Cheap when nothing is. */
  tick(now: number): void {
    if (now < this.due) return;
    const s = this.s;
    let changed = false;
    if (s.visit && now >= visitEnd(s.visit)) {
      s.lastStart = s.visit.start;
      s.last = s.visit.celeb;
      s.visit = null;
      changed = true;
    }
    if (!s.visit) {
      // the next one: a while after the last walked in, and never straight away
      const gap = span(VISIT_GAP_MS, this.random());
      const first = span(FIRST_VISIT_MS, this.random());
      const start = Math.max(s.lastStart === null ? 0 : s.lastStart + gap, now + first);
      this.plan(start, this.pick(s.last));
      changed = true;
    }
    if (s.gift && now >= s.gift.until) {
      this.deps.broadcast({ t: 'gift.gone', id: s.gift.id, name: null });
      s.lastGift = s.gift.id;
      s.gift = null;
      changed = true;
    }
    if (!s.gift && s.giftAt !== null && now >= s.giftAt) {
      // due while nobody was here to see it appear: put it off rather than drop it in late
      if (now - s.giftAt > GIFT_LATE_MS) s.giftAt = now + span(FIRST_GIFT_MS, this.random());
      else this.leave(now);
      changed = true;
    }
    if (!s.gift && s.giftAt === null) {
      s.giftAt = Math.max(s.lastGift === null ? 0 : s.lastGift + span(GIFT_GAP_MS, this.random()), now + span(FIRST_GIFT_MS, this.random()));
      changed = true;
    }
    if (changed) this.save();
    // happy hour: when one is over, everyone hears when the next is
    const happy = this.happyAt(now);
    if (!this.happy || happy.start !== this.happy.start) {
      const told = this.happy !== null;
      this.happy = happy;
      if (told) this.deps.broadcast({ t: 'happy', happy });
    }
    this.due = Math.min(s.visit ? visitEnd(s.visit) : now, s.gift ? s.gift.until : Infinity, s.giftAt ?? Infinity, happy.end);
  }

  /** The happy hour going on, or next: a dev one while it lasts, else the schedule's. */
  private happyAt(now: number): HappyHour {
    const dev = this.devHappy && now < this.devHappy.end ? this.devHappy : null;
    return dev ?? nextHappyHour(now);
  }

  /** Right after hello: the visit and the box, if any. */
  greet(ws: WebSocket, now: number): void {
    this.tick(now);
    const g = this.s.gift;
    send(ws, { t: 'celebs', visit: this.s.visit, gift: g ? box(g) : null, happy: this.happyAt(now) });
  }

  /** A player asked for a word with the celebrity, or opened the box. */
  async message(ws: WebSocket, msg: CelebClientMsg, now: number): Promise<void> {
    this.tick(now);
    const me = this.deps.where(ws);
    if (!me) return;
    const ref = msg.t === 'celeb.talk' ? msg.visit : msg.id;
    if (!this.asks.take(`a${me.accountId}`)) return this.no(ws, msg, ref, 'SLOW', 'One thing at a time.');
    if (msg.t === 'celeb.talk') await this.talk(ws, me, msg.visit, now);
    else await this.open(ws, me, msg.id, now);
  }

  /**
   * The dev stack's trigger (never in production: see celebsDevApi): a visit starting in a
   * moment, or a box on the floor now, at a spot if given.
   */
  force(kind: 'celeb' | 'gift' | 'happy', now: number, arg?: string | number, from?: number): Visit | (GiftBox & { amount: Cents }) | HappyHour {
    if (kind === 'happy') {
      // the window the Worker prices orders by (happy.ts startDevHappy): `from` to `arg`
      const end = typeof arg === 'number' ? arg : now;
      this.devHappy = { start: from ?? now, end };
      this.due = 0;
      this.tick(now);
      return this.devHappy;
    }
    if (kind === 'celeb') {
      const c = celebOf(arg) ?? CELEBS[Math.floor(this.random() * CELEBS.length)]!;
      if (this.s.visit && now >= this.s.visit.start) {
        this.s.lastStart = this.s.visit.start;
        this.s.last = this.s.visit.celeb;
      }
      this.plan(now + 1_500, c.id);
      this.save();
      this.due = 0;
      return this.s.visit!;
    }
    if (this.s.gift) this.deps.broadcast({ t: 'gift.gone', id: this.s.gift.id, name: null });
    this.s.gift = null;
    this.leave(now, typeof arg === 'number' ? arg : undefined);
    this.save();
    this.due = 0;
    return this.s.gift!;
  }

  // --- a word with the celebrity -------------------------------------------------------------

  private async talk(ws: WebSocket, me: Here, visitId: number, now: number): Promise<void> {
    const v = this.s.visit;
    const celeb = v ? celebOf(v.celeb) : null;
    const at = v && v.id === visitId ? celebAt(v, now) : null;
    if (!v || !celeb || !at) return this.no(ws, { t: 'celeb.talk', visit: visitId }, visitId, 'GONE', 'They have left the floor.');
    if (Math.hypot(me.x / 100 - at.x, me.z / 100 - at.z) > TALK_REACH_M) return this.no(ws, { t: 'celeb.talk', visit: visitId }, visitId, 'FAR', `Get a little closer to ${celeb.name}.`);
    const opId = `celeb:${me.accountId}:${v.id}`;
    // the same player twice at once (a double press): the first answer covers both
    if (this.paying.has(opId)) return;
    const done = defer();
    this.paying.set(opId, done.promise);
    try {
      const amount = rollTip(this.random);
      const line = Math.floor(this.random() * celeb.lines.hello.length);
      const db = this.deps.db();
      const paid = await grant(db, { opId, accountId: me.accountId, amount, now, extra: [tallyStatement(db, me.accountId, `celeb:${celeb.id}`, 1, 'add')] });
      if (paid.kind === 'dup') return this.no(ws, { t: 'celeb.talk', visit: visitId }, visitId, 'MET', `You've already met ${celeb.name} tonight.`);
      const met = await db
        .prepare(`SELECT count(*) AS n FROM casino_tally WHERE account_id = ?1 AND key LIKE 'celeb:%' AND n > 0`)
        .bind(me.accountId)
        .first<{ n: number }>();
      send(ws, { t: 'celeb.tip', visit: v.id, line, amount, balance: paid.balance, inPlay: paid.inPlay, rev: paid.rev, met: met?.n ?? 1 });
      this.deps.broadcast({ t: 'celeb.talk', visit: v.id, id: me.accountId, line });
    } finally {
      this.paying.delete(opId);
      done.resolve();
    }
  }

  // --- the gift box ----------------------------------------------------------------------------

  /** Leave a box at a spot (a random one unless given), with its amount; tell everyone where. */
  private leave(now: number, spot?: number): void {
    const i = spot !== undefined && GIFT_SPOTS[spot] ? spot : Math.floor(this.random() * GIFT_SPOTS.length);
    const [x, z] = GIFT_SPOTS[i]!;
    const g = { id: now, x, z, until: now + GIFT_MS, amount: rollGift(this.random) };
    this.s.gift = g;
    this.s.giftAt = null;
    this.deps.broadcast({ t: 'gift', gift: box(g) });
  }

  private async open(ws: WebSocket, me: Here, id: number, now: number): Promise<void> {
    const g = this.s.gift;
    const opId = `gift:${id}`;
    // someone is opening it this moment: whoever it was, the ledger will say once it lands
    const pending = this.paying.get(opId);
    if (pending) {
      await pending;
      return this.again(ws, me, id);
    }
    // gone: the one who found it, asking again after a lost answer, hears the same answer
    if (!g || g.id !== id || now >= g.until) return this.again(ws, me, id);
    if (Math.hypot(me.x / 100 - g.x, me.z / 100 - g.z) > GIFT_REACH_M) return this.no(ws, { t: 'gift.open', id }, id, 'FAR', 'Walk up to it first.');
    const done = defer();
    this.paying.set(opId, done.promise);
    try {
      const db = this.deps.db();
      const paid = await grant(db, { opId, accountId: me.accountId, amount: g.amount, now, extra: [tallyStatement(db, me.accountId, 'gifts', 1, 'add')] });
      if (paid.kind === 'dup') {
        await this.again(ws, me, id);
        return;
      }
      if (this.s.gift?.id === id) {
        this.s.lastGift = id;
        this.s.gift = null;
        this.save();
        this.due = 0;
      }
      send(ws, { t: 'gift.won', id, amount: g.amount, balance: paid.balance, inPlay: paid.inPlay, rev: paid.rev });
      this.deps.broadcast({ t: 'gift.gone', id, name: me.name });
    } finally {
      this.paying.delete(opId);
      done.resolve();
    }
  }

  /** A box that's no longer here: yours if the ledger says you opened it, otherwise someone was quicker. */
  private async again(ws: WebSocket, me: Here, id: number): Promise<void> {
    const db = this.deps.db();
    const row = await db.prepare(`SELECT account_id, amount FROM casino_ledger WHERE op_id = ?1`).bind(`gift:${id}`).first<{ account_id: number; amount: number }>();
    if (row && row.account_id === me.accountId) {
      const m = await db.prepare(`SELECT balance, in_play, rev FROM casino_accounts WHERE id = ?1`).bind(me.accountId).first<{ balance: number; in_play: number; rev: number }>();
      send(ws, { t: 'gift.won', id, amount: row.amount, balance: m?.balance ?? 0, inPlay: m?.in_play ?? 0, rev: m?.rev ?? 0 });
      return;
    }
    this.no(ws, { t: 'gift.open', id }, id, 'GONE', row ? 'Someone got there first.' : 'The box is gone.');
  }

  // --- plumbing --------------------------------------------------------------------------------

  private plan(start: number, celeb: CelebId): void {
    const visit: Visit = { id: start, celeb, start, seed: Math.floor(this.random() * 0x7fffffff) };
    this.s.visit = visit;
    this.deps.broadcast({ t: 'celeb', visit });
  }

  /** Anyone but whoever came last. */
  private pick(last: CelebId | null): CelebId {
    const pool = CELEBS.filter((c) => c.id !== last);
    return pool[Math.floor(this.random() * pool.length)]!.id;
  }

  private no(ws: WebSocket, msg: CelebClientMsg, ref: number, code: CelebNo, text: string): void {
    send(ws, msg.t === 'celeb.talk' ? { t: 'celeb.no', visit: ref, code, msg: text } : { t: 'gift.no', id: ref, code, msg: text });
  }

  private save(): void {
    this.deps.sql.exec(`INSERT OR REPLACE INTO celebs (k, v) VALUES ('state', ?1)`, JSON.stringify(this.s));
  }
}

/** A box as everyone sees it: never what's inside. */
function box(g: GiftBox): GiftBox {
  return { id: g.id, x: g.x, z: g.z, until: g.until };
}

function defer(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function span(range: readonly [number, number], u: number): number {
  return Math.round(range[0] + (range[1] - range[0]) * u);
}

function send(ws: WebSocket, msg: CelebServerMsg): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* closing */
  }
}

/**
 * POST /api/dev/celeb {celeb?}, POST /api/dev/gift {spot?} and POST /api/dev/happy {ms?}: a
 * celebrity walks in, a box is left, or happy hour starts, right now. Only on the dev stack (CASINO_DEV in server/wrangler.toml, which production
 * never sets), for the headless checks.
 */
export async function celebsDevApi(request: Request, env: Env, route: string, cors: Record<string, string>, floor: { celebDev(kind: 'celeb' | 'gift' | 'happy', arg?: string | number, from?: number): Promise<unknown> | unknown }): Promise<Response> {
  if (request.method !== 'POST') return fail(404, 'NOT_FOUND', 'Not here.', cors);
  const body = (await readJson(request)) as { celeb?: unknown; spot?: unknown; ms?: unknown } | null;
  // a happy hour from now: the Worker's price (a row every isolate reads) and the floor's news
  if (route === 'dev/happy') {
    const h = await startDevHappy(env.DB, Date.now(), typeof body?.ms === 'number' && body.ms > 0 ? Math.min(body.ms, HAPPY_MS) : HAPPY_MS);
    return json({ happy: await floor.celebDev('happy', h.end, h.start) }, 200, cors);
  }
  if (route === 'dev/celeb') return json({ visit: await floor.celebDev('celeb', typeof body?.celeb === 'string' ? body.celeb : undefined) }, 200, cors);
  if (route === 'dev/gift') return json({ gift: await floor.celebDev('gift', typeof body?.spot === 'number' ? body.spot : undefined) }, 200, cors);
  return fail(404, 'NOT_FOUND', 'Not here.', cors);
}
