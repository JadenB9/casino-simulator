import { describe, expect, it } from 'vitest';
import { EFFECTS, STATUES, effectItem, type FxEvent } from '../../shared/src/items.ts';
import { DEFAULT_LOOK } from '../../shared/src/look.ts';
import { SPAWN, planFloor, roomAt, type FloorPlan } from '../src/world/layout.ts';
import { reachFrom, reached, walkGrid } from '../src/world/reach.ts';
import { GAMES } from '../src/games/index.ts';
import { FxBook, envelope, fxKey, phaseOf, playable, reachOf } from '../src/world/fx/timing.ts';
import { PLINTH, STATUE_POST, fxRoom, inside, seenFrom, statueSpots } from '../src/world/fx/scope.ts';
import { captionOf, clock } from '../src/world/fx/caption.ts';
import { ROUND_ITEM, withGlass } from '../src/world/fx/round.ts';
import { ballSpot, shellGeometry } from '../src/world/fx/disco.ts';
import { headlineRuns } from '../src/world/marquee.ts';
import { layoutTape } from '../src/world/ledfont.ts';
import { barItem } from '../../shared/src/items.ts';
import { WALL } from '../src/world/layout.ts';

const plan = (): FloorPlan => planFloor((g) => GAMES[g].footprint, undefined, { seats: (g, v) => GAMES[g].seats(v) });
const P = plan();
const room = (id: string) => P.rooms.find((r) => r.id === id)!;

/** An event bought at the middle of a room, `at` ms from 0, lasting the item's own length. */
function ev(fx: string, at: number, o: Partial<FxEvent> = {}): FxEvent {
  const r = room(o.x !== undefined ? roomAt(P, o.x / 100, (o.z ?? 0) / 100)!.id : 'lobby');
  const secs = effectItem(fx)!.secs;
  return { fx, id: 7, name: 'Ana', at, until: at + secs * 1000, x: Math.round(r.cx * 100), z: Math.round(r.cz * 100), ...o };
}

describe('when an effect plays', () => {
  it('waits for its start, plays, then is over', () => {
    const e = ev('fx-disco', 10_000);
    expect(phaseOf(e, 5_000)).toEqual({ state: 'wait', t: 0, left: 60 });
    expect(phaseOf(e, 10_000)).toEqual({ state: 'play', t: 0, left: 60 });
    expect(phaseOf(e, 40_000)).toEqual({ state: 'play', t: 30, left: 30 });
    expect(phaseOf(e, 70_000)).toEqual({ state: 'done', t: 60, left: 0 });
    expect(phaseOf(e, 99_000).state).toBe('done');
  });

  it('rises and falls smoothly, and is 0 before the start and at the end', () => {
    expect(envelope(0, 10, 1, 2)).toBe(0);
    expect(envelope(0.5, 10, 1, 2)).toBeCloseTo(0.5);
    expect(envelope(5, 5, 1, 2)).toBe(1);
    expect(envelope(9, 1, 1, 2)).toBeCloseTo(0.5);
    expect(envelope(10, 0, 1, 2)).toBe(0);
    // monotonic on the way up
    let last = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      const k = envelope(t, 10, 1, 2);
      expect(k).toBeGreaterThanOrEqual(last);
      last = k;
    }
  });

  it('knows every effect in the catalogue and how far each reaches', () => {
    expect(EFFECTS.map((e) => reachOf(e.id))).toEqual(['you', 'you', 'room', 'you', 'you', 'room', 'casino', 'casino', 'casino']);
  });

  it('only plays events that make sense', () => {
    expect(playable(ev('fx-rain', 1000))).toBe(true);
    expect(playable({ ...ev('fx-rain', 1000), fx: 'fx-nope' })).toBe(false);
    expect(playable({ ...ev('fx-rain', 1000), until: 1000 })).toBe(false);
    // no event lasts longer than the longest effect
    expect(playable({ ...ev('fx-rain', 1000), until: 1000 + 3_600_000 })).toBe(false);
    expect(playable({ ...ev('fx-rain', 1000), x: Number.NaN })).toBe(false);
    expect(playable(null)).toBe(false);
    expect(playable({ fx: 'fx-rain' })).toBe(false);
  });
});

describe('the book of events', () => {
  it('takes each event once, however often it arrives', () => {
    const b = new FxBook();
    const e = ev('fx-confetti', 1000);
    expect(b.add(e)).toBe(true);
    expect(b.add({ ...e })).toBe(false);
    // the list after a hello repeats it: still one
    b.sync([e], 2000);
    expect(b.size).toBe(1);
    // the same effect bought again is another event
    expect(b.add(ev('fx-confetti', 9000))).toBe(true);
    expect(b.size).toBe(2);
    expect(fxKey(e)).toBe('fx-confetti:7:1000');
  });

  it('lets go of what the server no longer lists, but not what arrived after its list left', () => {
    const b = new FxBook();
    const ended = ev('fx-disco', 1000);
    const queued = ev('fx-disco', 90_000);
    b.add(ended);
    b.add(queued);
    // reconnect at 50 s: the list has only a new one; `queued` starts later than now
    const fresh = ev('fx-rain', 45_000);
    const gone = b.sync([fresh], 50_000);
    expect(gone).toEqual([fxKey(ended)]);
    expect(b.list().map(fxKey)).toEqual([fxKey(fresh), fxKey(queued)]);
  });

  it('forgets events once they are over, and lists them in the order they start', () => {
    const b = new FxBook();
    b.add(ev('fx-rain', 30_000));
    b.add(ev('fx-confetti', 1000));
    expect(b.list().map((e) => e.fx)).toEqual(['fx-confetti', 'fx-rain']);
    b.prune(10_000);
    expect(b.list().map((e) => e.fx)).toEqual(['fx-rain']);
    b.prune(60_000);
    expect(b.size).toBe(0);
  });
});

describe('where an effect plays', () => {
  it('finds the room the buyer stood in', () => {
    for (const r of P.rooms) expect(fxRoom(P, { x: Math.round(r.cx * 100), z: Math.round(r.cz * 100) })?.id).toBe(r.id);
    // a doorstep outside the building counts as the nearest room, as the floor counts it
    expect(fxRoom(P, { x: 0, z: 1600 })?.id).toBe('lobby');
  });

  it('draws a room effect for its room and the rooms that see into it, a casino one everywhere', () => {
    const disco = ev('fx-disco', 0, { x: Math.round(room('pit').cx * 100), z: Math.round(room('pit').cz * 100) });
    expect(seenFrom(P, disco, 'pit', new Set(['pit']))).toBe(true);
    expect(seenFrom(P, disco, 'lobby', new Set(['lobby', 'pit']))).toBe(true);
    expect(seenFrom(P, disco, 'bar', new Set(['bar']))).toBe(false);
    expect(inside(P, disco, 'pit')).toBe(true);
    expect(inside(P, disco, 'lobby')).toBe(false);
    const gold = ev('fx-goldenhour', 0);
    expect(seenFrom(P, gold, 'yard', new Set(['yard']))).toBe(true);
    expect(inside(P, gold, 'yard')).toBe(true);
    // one round the buyer follows the room they're in now
    const rain = ev('fx-rain', 0);
    expect(seenFrom(P, rain, 'bar', new Set(['bar']), 'bar')).toBe(true);
    expect(seenFrom(P, rain, 'bar', new Set(['bar']), 'slots')).toBe(false);
  });
});

describe('the caption', () => {
  it("names what's playing where you are, newest first, then what's next", () => {
    const pit = { x: Math.round(room('pit').cx * 100), z: Math.round(room('pit').cz * 100) };
    const list = [
      ev('fx-disco', 0, { ...pit, name: 'Ana' }),
      ev('fx-disco', 60_000, { ...pit, name: 'Sam' }),
      ev('fx-marquee', 5_000, { name: 'Mike' }),
      ev('fx-rain', 1_000, { name: 'Lee' }),
    ];
    const lines = captionOf(list, 20_000, 'pit', P);
    expect(lines.map((l) => [l.what, l.who, l.next])).toEqual([
      ['Headline', 'Mike', false],
      ['Disco Night', 'Ana', false],
      ['Disco Night', 'Sam', true],
    ]);
    expect(lines[1]!.secs).toBe(40);
    expect(lines[2]!.secs).toBe(40);
    // from the lobby: the rain round Lee (bought there), then the Headline coming up; the pit's disco isn't named
    expect(captionOf(list, 2_000, 'lobby', P).map((l) => [l.who, l.next])).toEqual([
      ['Lee', false],
      ['Mike', true],
    ]);
    expect(captionOf(list, 20_000, 'lobby', P).map((l) => l.who)).toEqual(['Mike']);
  });

  it('counts down in minutes and seconds, never showing 0:00 with time left', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(0.2)).toBe('0:01');
    expect(clock(59.5)).toBe('1:00');
    expect(clock(61)).toBe('1:01');
    expect(clock(120)).toBe('2:00');
  });
});

describe('a round on the house', () => {
  it('puts a flute in an empty hand until the round ends, and leaves a drink alone', () => {
    const look = withGlass(DEFAULT_LOOK, 70_000, 10_000, 'fx-round-7-10000')!;
    expect(look.held).toEqual({ item: ROUND_ITEM, order: 'fx-round-7-10000', until: 70_000 });
    expect(barItem(ROUND_ITEM)?.model).toBe('flute');
    const drinking = { ...DEFAULT_LOOK, held: { item: 'beer', order: 'op-12345678', until: 20_000 } };
    expect(withGlass(drinking, 70_000, 10_000, 'x')).toBeNull();
    // a drink that has run out is an empty hand again
    expect(withGlass(drinking, 70_000, 30_000, 'x')?.held?.item).toBe(ROUND_ITEM);
  });
});

describe('the statues', () => {
  const spots = statueSpots(P);

  it('have their places in the lobby, apart, clear of the walkways and doorways', () => {
    expect(spots).toHaveLength(STATUES);
    const lobby = room('lobby');
    for (const s of spots) {
      expect(roomAt(P, s.x, s.z)?.id).toBe('lobby');
      const half = PLINTH.base / 2;
      for (const a of [...P.aisles, ...P.doorways]) {
        const clear = s.x + half < a.x0 || s.x - half > a.x1 || s.z + half < a.z0 || s.z - half > a.z1;
        expect(clear, `statue at ${s.x},${s.z} on ${JSON.stringify(a)}`).toBe(true);
      }
      // out of the middle of the lobby: the way from the doors to the pit
      expect(Math.abs(s.x - lobby.cx)).toBeGreaterThan(3);
      // facing into the lobby, toward the doors
      expect(Math.sign(Math.sin(s.yaw))).toBe(-Math.sign(s.x - lobby.cx));
      expect(Math.cos(s.yaw)).toBeGreaterThan(0);
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.z - spots[j]!.z)).toBeGreaterThan(2.3);
  });

  it("don't stand in anything, or under a palm's fronds", () => {
    for (const s of spots) {
      for (const o of P.solids) {
        const r = o.round ? o.w / 2 : Math.hypot(o.w, o.d) / 2;
        expect(Math.hypot(o.x - s.x, o.z - s.z), `${o.id}`).toBeGreaterThan(r + (o.y0 >= 1.2 ? 0.45 : PLINTH.base / 2));
      }
    }
  });

  it('leave every door, room and station reachable, and the directory readable', () => {
    const extra = spots.map((s) => ({ kind: 'round' as const, x: s.x, z: s.z, r: STATUE_POST }));
    const grid = walkGrid(P, { extra });
    const seen = reachFrom(grid, SPAWN.x, SPAWN.z);
    for (const d of P.doors) {
      if (d.b === 'outside') continue;
      const m = (d.a0 + d.a1) / 2;
      const [x, z] = d.axis === 'x' ? [m, d.c] : [d.c, m];
      expect(reached(grid, seen, x, z, 0.2), `door ${d.id}`).toBe(true);
    }
    for (const r of P.rooms) expect(reached(grid, seen, r.cx, r.cz, 4), `into ${r.name}`).toBe(true);
    const dir = P.solids.find((s) => s.id.includes('directory'))!;
    expect(reached(grid, seen, dir.x + Math.sin(dir.yaw) * 0.6, dir.z + Math.cos(dir.yaw) * 0.6, 0.3), 'in front of the directory').toBe(true);
  });

  it('move with the directory and the palms', () => {
    const moved = plan();
    // the directory moved across to where the first statue would stand
    const d = moved.solids.find((s) => s.id.includes('directory'))!;
    d.x = spots[0]!.x;
    d.z = spots[0]!.z;
    const again = statueSpots(moved);
    expect(again).toHaveLength(STATUES);
    for (const s of again) expect(Math.hypot(s.x - d.x, s.z - d.z)).toBeGreaterThan(1.2);
  });
});

describe('the disco', () => {
  it('hangs the ball clear of the chandeliers and signs, inside the room', () => {
    const lobby = room('lobby');
    // a chandelier in the lobby's middle, as it has
    const spot = ballSpot(lobby, [{ x: lobby.cx, z: lobby.cz, r: 0.9 }]);
    expect(Math.hypot(spot.x - lobby.cx, spot.z - lobby.cz)).toBeGreaterThanOrEqual(1.8);
    expect(roomAt(P, spot.x, spot.z)?.id).toBe('lobby');
    expect(ballSpot(lobby, [])).toEqual({ x: (lobby.inner.x0 + lobby.inner.x1) / 2, z: (lobby.inner.z0 + lobby.inner.z1) / 2 });
  });

  it("lights the room's floor and walls but never a doorway or a shop window", () => {
    for (const r of P.rooms) {
      const g = shellGeometry(P, r).toNonIndexed();
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        // every point on the shell is inside the room's walls, just proud of them
        const e = 1e-4;
        expect(x).toBeGreaterThanOrEqual(r.bounds.x0 + WALL / 2 - e);
        expect(x).toBeLessThanOrEqual(r.bounds.x1 - WALL / 2 + e);
        expect(z).toBeGreaterThanOrEqual(r.bounds.z0 + WALL / 2 - e);
        expect(z).toBeLessThanOrEqual(r.bounds.z1 - WALL / 2 + e);
        expect(y).toBeLessThanOrEqual(r.style.ceiling + e);
      }
      // no triangle of wall is in a doorway's opening
      for (let t = 0; t < pos.count; t += 3) {
        const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
        const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
        const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
        if (cy < 0.05) continue;
        for (const d of P.doors) {
          if (d.a !== r.id && d.b !== r.id) continue;
          const along = d.axis === 'x' ? cx : cz;
          const across = d.axis === 'x' ? cz : cx;
          const inOpening = along > d.a0 + 0.01 && along < d.a1 - 0.01 && cy < d.height - 0.01 && Math.abs(across - d.c) < 0.5;
          expect(inOpening, `${r.id} shell in door ${d.id}`).toBe(false);
        }
        for (const w of P.windows) {
          if (w.neg !== r.id && w.pos !== r.id) continue;
          const along = w.axis === 'x' ? cx : cz;
          const across = w.axis === 'x' ? cz : cx;
          const onGlass = along > w.a0 + 0.01 && along < w.a1 - 0.01 && cy > w.y0 + 0.01 && cy < w.y1 - 0.01 && Math.abs(across - w.c) < 0.5;
          expect(onGlass, `${r.id} shell over a window`).toBe(false);
        }
      }
      g.dispose();
    }
  });
});

describe('the headline', () => {
  it("fits a long name on the sign's tape", () => {
    const tape = layoutTape(headlineRuns('ALEXANDRIA-OCASIO THE THIRD'), { lead: 120, maxWidth: 4096 });
    expect(tape.width).toBeLessThan(4096);
    expect(tape.width).toBeGreaterThan(120);
  });
});
