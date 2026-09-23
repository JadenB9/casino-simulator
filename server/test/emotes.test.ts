// Emotes on the floor: everyone, the sender included, sees a gesture under the sender's own id,
// and the floor's bucket (3 in a burst, then one every two seconds) drops the rest of a burst.
// Shares the floor object with nobody else in this file; each test watches only its own players.

import { describe, it, expect } from 'vitest';
import { exports } from 'cloudflare:workers';
import { EMOTES } from '../../shared/src/protocol.ts';
import { ORIGIN, connect, type Client } from './helpers.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let ipSeq = 0;

async function arrive(name: string): Promise<{ id: number; c: Client }> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': `192.0.2.${++ipSeq}` },
      body: JSON.stringify({ name }),
    }),
  );
  expect(res.status).toBe(200);
  const { token, profile } = await res.json<any>();
  const { client } = await connect('floor', token);
  await client!.next((m) => m.t === 'hello');
  return { id: profile.id, c: client! };
}

const emotesFrom = (c: Client, id: number) => c.msgs.filter((m) => m.t === 'emote' && m.id === id).map((m) => m.e);

describe('floor emotes', () => {
  it('reach everyone under the sender id the server knows, and unknown ones go nowhere', async () => {
    const a = await arrive('em_who_a');
    const b = await arrive('em_who_b');
    // A client can't name someone else as the sender: extra keys are dropped.
    a.c.send({ t: 'emote', e: 'wave', id: b.id });
    expect(await b.c.next((m) => m.t === 'emote')).toEqual({ t: 'emote', id: a.id, e: 'wave' });
    expect(await a.c.next((m) => m.t === 'emote')).toEqual({ t: 'emote', id: a.id, e: 'wave' });

    a.c.send({ t: 'emote', e: 'dance' });
    a.c.send({ t: 'emote' });
    await wait(150);
    expect(emotesFrom(b.c, a.id)).toEqual([]);
    a.c.ws.close(1000, 'bye');
    b.c.ws.close(1000, 'bye');
  });

  it('let three through in a burst, drop the rest, then one more every two seconds', async () => {
    const a = await arrive('em_burst_a');
    const b = await arrive('em_burst_b');
    const burst = [0, 1, 2, 3, 4, 0, 1, 2].map((i) => EMOTES[i]!);
    for (const e of burst) a.c.send({ t: 'emote', e });
    await wait(300);
    expect(emotesFrom(b.c, a.id)).toEqual(burst.slice(0, 3));
    expect(emotesFrom(a.c, a.id)).toEqual(burst.slice(0, 3));
    expect(a.c.closed).toBeNull();

    // Two seconds on, the bucket holds one gesture again: one of these two gets through.
    await wait(2_000);
    a.c.send({ t: 'emote', e: 'shrug' });
    a.c.send({ t: 'emote', e: 'thumbs' });
    await wait(300);
    expect(emotesFrom(b.c, a.id)).toEqual([...burst.slice(0, 3), 'shrug']);
    a.c.ws.close(1000, 'bye');
    b.c.ws.close(1000, 'bye');
  });
});
