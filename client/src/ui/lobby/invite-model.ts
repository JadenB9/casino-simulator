// v6 invite6: the invites' words and lists, kept apart from the DOM so the unit tests can check
// them. What a card says about the table, who the picker offers first (people you've played
// with, then whoever is nearest), the invites waiting on screen, and the two things kept per
// browser: do not disturb, and the players you've met.

import type { GameId } from '../../../../shared/src/engine.ts';
import type { Invite, InviteSkip, LobbySummary } from '../../../../shared/src/protocol.ts';
import { CATALOG } from '../../../../shared/src/games/catalog.ts';
import { limitSpec, limitsLabel } from '../../../../shared/src/limits.ts';
import { zoneOf } from '../../../../shared/src/zones.ts';

// --- what a card says ----------------------------------------------------------------------------

/** "Blackjack", "American Roulette": the game as the floor's prompt names it. */
export function tableName(game: GameId, variant: string): string {
  const info = CATALOG[game];
  const v = info.variants.find((x) => x.id === variant);
  return v ? `${v.name} ${info.name}` : info.name;
}

/** "High limit", or the limits themselves when they aren't one of the game's tiers ("$30–$3,000"). */
export function limitsWord(game: GameId, lobby: Pick<LobbySummary, 'limits'>): string | null {
  const l = lobby.limits;
  if (!l) return null;
  const tier = limitSpec(game)?.tiers.find((t) => t.min === l.min && t.max === l.max);
  return tier?.name ? tier.name : limitsLabel(game, l);
}

export function seatsLeft(lobby: Pick<LobbySummary, 'players' | 'max'>): string {
  const n = Math.max(0, lobby.max - lobby.players);
  return n === 0 ? 'Full' : n === 1 ? '1 seat left' : `${n} seats left`;
}

/** The card's second line: "High limit $500–$50,000 · 2 seats left · Private · In play". */
export function inviteDetail(inv: Pick<Invite, 'game' | 'lobby' | 'private'>): string {
  const word = limitsWord(inv.game, inv.lobby);
  const range = inv.lobby.limits ? limitsLabel(inv.game, inv.lobby.limits) : null;
  const parts = [word && range && word !== range ? `${word} ${range}` : word, seatsLeft(inv.lobby)];
  if (inv.private) parts.push('Private');
  if (inv.lobby.started) parts.push('In play');
  return parts.filter(Boolean).join(' · ');
}

/** "Sam invited you to Blackjack (High limit, 2 seats left)": the whole invite in one line, for screen readers. */
export function inviteSentence(inv: Invite): string {
  const bits = [limitsWord(inv.game, inv.lobby), seatsLeft(inv.lobby)].filter(Boolean).join(', ');
  const who = inv.all ? `${inv.from.name} invited everyone` : `${inv.from.name} invited you`;
  return `${who} to ${tableName(inv.game, inv.variant)}${bits ? ` (${bits})` : ''}.`;
}

/** "1:52": time left on an invite. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const SKIP_TEXT: Record<InviteSkip, string> = {
  offline: 'Left the casino',
  away: 'Away',
  dnd: 'Not taking invites',
  recent: 'Just invited',
  busy: 'Too many invites',
};

/** What the inviter reads after sending: "Invited Sam and Alex. Jo isn't taking invites." */
export function sentSummary(r: { all: boolean; sent: number; skipped: { name: string; why: InviteSkip }[] }, names: string[]): string {
  if (r.all) return r.sent === 0 ? 'Nobody else is on the floor to invite.' : `Invited everyone on the floor (${r.sent} ${r.sent === 1 ? 'player' : 'players'}).`;
  const out: string[] = [];
  if (names.length > 0) out.push(`Invited ${listOf(names)}.`);
  const why: Record<InviteSkip, string> = {
    offline: 'left the casino',
    away: 'is away',
    dnd: "isn't taking invites",
    recent: 'was just invited',
    busy: 'has too many invites right now',
  };
  for (const s of r.skipped) out.push(`${s.name || 'Someone'} ${why[s.why]}.`);
  return out.join(' ') || 'Nobody was invited.';
}

function listOf(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

// --- who the picker offers -------------------------------------------------------------------------

export interface Candidate {
  id: number;
  name: string;
  /** Where they are, cm (null if not known yet). */
  x: number | null;
  z: number | null;
  /** The station they're at, if any. */
  station: string | null;
}

export interface Ranked extends Candidate {
  /** Metres from you, when both positions are known and on the same floor. */
  metres: number | null;
  recent: boolean;
  /** 'ground' or 'roof' when they've taken the elevator. */
  away: 'ground' | 'roof' | null;
}

/**
 * The players to offer, best first: people you've played with or invited (most recent first),
 * then everyone else nearest first, people upstairs or downstairs last. `query` keeps names that
 * contain it (a name that starts with it first). `exclude`: you, and whoever is at the table already.
 */
export function rankCandidates(
  players: Candidate[],
  me: { x: number; z: number } | null,
  recent: readonly { id: number }[],
  exclude: ReadonlySet<number>,
  query = '',
): Ranked[] {
  const q = query.trim().toLowerCase();
  const order = new Map(recent.map((r, i) => [r.id, i]));
  const out: Ranked[] = [];
  for (const p of players) {
    if (exclude.has(p.id)) continue;
    if (q && !p.name.toLowerCase().includes(q)) continue;
    const zone = p.x !== null && p.z !== null ? zoneOf(p.x, p.z) : null;
    const away = zone === 'ground' || zone === 'roof' ? zone : null;
    const metres = me && p.x !== null && p.z !== null && !away ? Math.hypot(p.x / 100 - me.x, p.z / 100 - me.z) : null;
    out.push({ ...p, metres, recent: order.has(p.id), away });
  }
  const starts = (r: Ranked) => (q && r.name.toLowerCase().startsWith(q) ? 0 : 1);
  return out.sort(
    (a, b) =>
      starts(a) - starts(b) ||
      Number(b.recent) - Number(a.recent) ||
      (a.recent && b.recent ? order.get(a.id)! - order.get(b.id)! : 0) ||
      Number(a.away !== null) - Number(b.away !== null) ||
      (a.metres ?? Infinity) - (b.metres ?? Infinity) ||
      a.name.localeCompare(b.name),
  );
}

// --- the invites on screen -------------------------------------------------------------------------

/** The newest few invites, one per table (a newer one for the same table replaces the older). */
export class Inbox {
  private list: Invite[] = [];

  constructor(private readonly max = 3) {}

  get items(): readonly Invite[] {
    return this.list;
  }

  add(inv: Invite): void {
    this.list = [inv, ...this.list.filter((x) => x.tableId !== inv.tableId && x.id !== inv.id)].slice(0, this.max);
  }

  remove(id: string): Invite | null {
    const found = this.list.find((x) => x.id === id) ?? null;
    this.list = this.list.filter((x) => x.id !== id);
    return found;
  }

  /** Drop the ones that ran out (server time); returns whether anything went. */
  expire(now: number): boolean {
    const before = this.list.length;
    this.list = this.list.filter((x) => x.until > now);
    return this.list.length !== before;
  }

  /** Everything for this table: you're there now. */
  dropTable(tableId: string): void {
    this.list = this.list.filter((x) => x.tableId !== tableId);
  }
}

// --- kept per browser --------------------------------------------------------------------------------

const DND_KEY = 'casino.invites.dnd';
const RECENT_KEY = 'casino.invites.recent';
const RECENT_MAX = 24;
const dndListeners = new Set<(on: boolean) => void>();

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function store(): Store | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Do not disturb: no invites while it's on. */
export function doNotDisturb(s: Store | null = store()): boolean {
  try {
    return s?.getItem(DND_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDoNotDisturb(on: boolean, s: Store | null = store()): void {
  try {
    s?.setItem(DND_KEY, on ? '1' : '0');
  } catch {
    /* blocked: it lasts until the page closes */
  }
  for (const fn of dndListeners) fn(on);
}

export function onDoNotDisturb(fn: (on: boolean) => void): () => void {
  dndListeners.add(fn);
  return () => dndListeners.delete(fn);
}

export interface Met {
  id: number;
  name: string;
  at: number;
}

/** People you've sat at a table with or invited, newest first. */
export class RecentPlayers {
  private list: Met[];

  constructor(private readonly s: Store | null = store()) {
    this.list = read(s);
  }

  get items(): readonly Met[] {
    return this.list;
  }

  note(people: { id: number; name: string }[], now = Date.now()): void {
    if (people.length === 0) return;
    const ids = new Set(people.map((p) => p.id));
    this.list = [...people.map((p) => ({ id: p.id, name: p.name, at: now })), ...this.list.filter((m) => !ids.has(m.id))].slice(0, RECENT_MAX);
    try {
      this.s?.setItem(RECENT_KEY, JSON.stringify(this.list));
    } catch {
      /* full or blocked: kept for this visit */
    }
  }
}

function read(s: Store | null): Met[] {
  try {
    const raw: unknown = JSON.parse(s?.getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((m): m is Met => typeof m?.id === 'number' && typeof m?.name === 'string' && typeof m?.at === 'number')
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}
