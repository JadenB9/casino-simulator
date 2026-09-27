import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { Tower } from '../src/floor/tower.ts';
import { parseFloorMsg } from '../../shared/src/protocol.ts';
import { isGameId } from '../../shared/src/games/catalog.ts';
import { STOWED, pieceIn } from '../../shared/src/estate.ts';

// v1.1: an owner moves pieces about their apartment and picks them up; the floor keeps both in
// its tower and every visitor is sent the same places.

const stub = () => env.FLOOR.get(env.FLOOR.idFromName('tower-move-test'));

describe('the tower keeps moved and picked-up pieces', () => {
  it('moves a piece that stands on the floor, and puts it back', async () => {
    await runInDurableObject(stub(), (_i, state) => {
      const t = new Tower(state.storage.sql);
      t.upsert({ id: 901, name: 'mover', tier: 1, items: ['sofa-linen', 'tv-55'] });
      expect(t.move(901, 'sofa', { x: -14_500, z: 7_600, r: 64 })).toBe(true);
      expect(t.info(901)!.places).toEqual({ sofa: { x: -14_500, z: 7_600, r: 64 } });
      // a wall piece stays where it is; nothing goes outside the flat and its balcony
      expect(t.move(901, 'tv', { x: -14_500, z: 7_600, r: 0 })).toBe(false);
      expect(t.move(901, 'sofa', { x: -11_000, z: 7_000, r: 0 })).toBe(false);
      expect(t.move(901, 'sofa', { x: -12_500, z: 5_900, r: 0 })).toBe(false);
      expect(t.move(901, 'sofa', null)).toBe(true);
      expect(t.info(901)!.places).toEqual({});
      // nobody else's apartment
      expect(t.move(902, 'sofa', { x: -14_500, z: 7_600, r: 0 })).toBe(false);
    });
  });

  it('picks a piece up (the slot stays empty) but never the kitchen or the bathroom', async () => {
    await runInDurableObject(stub(), (_i, state) => {
      const t = new Tower(state.storage.sql);
      t.upsert({ id: 903, name: 'stower', tier: 1, items: ['sofa-linen', 'kitchen-modern'] });
      expect(t.pick(903, 'sofa', null)).toBe(true);
      const info = t.info(903)!;
      expect(info.picks.sofa).toBe(STOWED);
      expect(pieceIn('sofa', new Set(info.items), 1, info.picks.sofa ?? null)).toBeNull();
      expect(t.pick(903, 'kitchen', null)).toBe(false);
      // putting it back
      expect(t.pick(903, 'sofa', 'sofa-linen')).toBe(true);
      expect(pieceIn('sofa', new Set(info.items), 1, t.info(903)!.picks.sofa ?? null)?.id).toBe('sofa-linen');
    });
  });

  it('adds the places column to a tower from before v1.1', async () => {
    await runInDurableObject(env.FLOOR.get(env.FLOOR.idFromName('tower-move-old')), (_i, state) => {
      const sql = state.storage.sql;
      sql.exec(`DROP TABLE IF EXISTS apartments`);
      sql.exec(`CREATE TABLE apartments (account_id INTEGER PRIMARY KEY, name TEXT NOT NULL, tier INTEGER NOT NULL, floor INTEGER NOT NULL, items TEXT NOT NULL, picks TEXT NOT NULL)`);
      sql.exec(`INSERT INTO apartments VALUES (904, 'old', 1, 31, '["sofa-linen"]', '{}')`);
      const t = new Tower(sql);
      expect(t.info(904)!.places).toEqual({});
      expect(t.move(904, 'sofa', { x: -14_000, z: 7_000, r: 10 })).toBe(true);
    });
  });
});

const parse = (raw: unknown) => parseFloorMsg(raw, isGameId);

describe('home.move on the wire', () => {
  it('takes a place in the flat or null, and nothing else', () => {
    expect(parse({ t: 'home.move', slot: 'sofa', at: { x: -14_000, z: 7_000, r: 12 } })).toEqual({ t: 'home.move', slot: 'sofa', at: { x: -14_000, z: 7_000, r: 12 } });
    expect(parse({ t: 'home.move', slot: 'sofa', at: null })).toEqual({ t: 'home.move', slot: 'sofa', at: null });
    expect(parse({ t: 'home.move', slot: 'sofa', at: { x: -14_000, z: 7_000, r: 300 } })).toBeNull();
    expect(parse({ t: 'home.move', slot: 'sofa', at: { x: 0, z: 0, r: 0 } })).toBeNull();
    expect(parse({ t: 'home.move', slot: 'sofa', at: { x: 1.5, z: 7_000, r: 0 } })).toBeNull();
    expect(parse({ t: 'home.move', slot: 'Sofa!', at: null })).toBeNull();
  });
});
