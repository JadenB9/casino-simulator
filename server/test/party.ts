// Helpers for tests that play lobby tables: players from addresses of their own, lobbies made the
// way POST /tables makes them, sockets, the table's deadlines, and a clock the tests can move.

import { expect, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { ORIGIN, connect, type Client } from './helpers.ts';
import type { CasinoFloor } from '../src/floor/index.ts';
import type { CasinoTable } from '../src/table/host.ts';
import type { GameId } from '../../shared/src/engine.ts';

export interface Player {
  id: number;
  name: string;
  token: string;
  ip: string;
}

let seq = 0;

/** A fresh address per call (from a range no other test file uses), so no limit is shared by accident. */
export function nextIp(): string {
  seq++;
  return `172.20.${(seq >> 8) & 255}.${seq & 255}`;
}

export async function player(tag: string, ip = nextIp()): Promise<Player> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': ip },
      body: JSON.stringify({ name: `${tag}${++seq}`.slice(0, 16) }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  return { id: body.profile.id, name: body.profile.name, token: body.token, ip };
}

export function floor(): DurableObjectStub<CasinoFloor> {
  return env.FLOOR.get(env.FLOOR.idFromName('main'));
}

export function table(id: string): DurableObjectStub<CasinoTable> {
  return env.TABLE.get(env.TABLE.idFromName(id));
}

/** What POST /tables does (it also allows the dev game, which the route refuses). */
export async function makeLobby(creator: Player, game: GameId, visibility: 'public' | 'private' = 'public'): Promise<{ tableId: string; pin: string | null }> {
  const made = await floor().createLobby({ game, visibility, accountId: creator.id, ip: nextIp() });
  if ('error' in made) throw new Error(`createLobby refused: ${made.error}`);
  await table(made.tableId).init({ name: made.tableId, game, variant: '', mode: 'multi', visibility, pin: made.pin });
  return made;
}

/** Open a table socket (from the player's own address) and wait for the snapshot. */
export async function enter(p: Player, tableId: string, pin?: string | null): Promise<[Client, any]> {
  const { client } = await connect(`table/${tableId}`, p.token, pin ? `&pin=${pin}` : '', p.ip);
  const snap = await client!.next<any>((m) => m.t === 'table');
  return [client!, snap];
}

export async function buyIn(c: Client, amount: number): Promise<void> {
  c.send({ t: 'buyin', aid: `buy${++seq}`, amount });
  await c.next((m) => m.t === 'seat' && m.status === 'seated', 5000);
}

export const aid = (tag = 'a') => `${tag}${++seq}`;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function closedWith(c: Client, ms = 1500): Promise<{ code: number; reason: string }> {
  for (let waited = 0; waited < ms; waited += 10) {
    if (c.closed) return c.closed;
    await sleep(10);
  }
  throw new Error('socket stayed open');
}

/** Run `fn` inside a table's object, its private parts in reach (the typed stub is too deep for tsc here). */
export function inTable<R>(tableId: string, fn: (t: any, state: DurableObjectState) => R | Promise<R>): Promise<R> {
  return runInDurableObject(table(tableId) as unknown as DurableObjectStub, fn as never) as Promise<R>;
}

export async function deadlines(tableId: string): Promise<Record<string, number>> {
  return runInDurableObject(table(tableId), (_t, state) =>
    Object.fromEntries(state.storage.sql.exec<{ name: string; at: number }>(`SELECT name, at FROM deadlines`).toArray().map((r) => [r.name, r.at])),
  );
}

export async function money(id: number): Promise<{ balance: number; in_play: number }> {
  return (await env.DB.prepare(`SELECT balance, in_play FROM casino_accounts WHERE id = ?1`).bind(id).first<any>())!;
}

export async function escrow(id: number, tableId: string): Promise<number | null> {
  const row = await env.DB.prepare(`SELECT amount FROM casino_escrow WHERE account_id = ?1 AND table_id = ?2`).bind(id, tableId).first<any>();
  return row ? row.amount : null;
}

/** Move the clock (it keeps running from there); deadlines then run with runDurableObjectAlarm. */
export function clockAt(t: number): void {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(t);
}

export const find = (members: any[], id: number) => members.find((m) => m.accountId === id);

const CARD_RE = /^[2-9TJQKA][shdc]$/;

/** Every card code anywhere in a message. */
export function cardsIn(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') {
    if (CARD_RE.test(x)) out.push(x);
  } else if (Array.isArray(x)) {
    for (const v of x) cardsIn(v, out);
  } else if (typeof x === 'object' && x !== null) {
    for (const v of Object.values(x)) cardsIn(v, out);
  }
  return out;
}
