// v8: finding your way. Find a game lists every game in the building once (by the name the prompt
// gives it), with the rooms it's in; the way to one is walkable from the doors over the waiters'
// grid and ends where its players stand; the chip's distances read well; the prompt says what E
// does first; a photo is named for when it was taken.

import { describe, expect, it } from 'vitest';
import { planFloor } from '../src/world/layout.ts';
import { GAMES } from '../src/games/index.ts';
import { walkGrid } from '../src/world/reach.ts';
import { NAV_CELL, NAV_RADIUS, NavGrid, pathLength } from '../src/world/life/nav.ts';
import { along, distanceText, gameSpots, standAt } from '../src/world/wayfinding.ts';
import { promptText } from '../src/world/interact.ts';
import { stationName } from '../src/world/stations.ts';
import { photoName } from '../src/world/photo.ts';
import { CATALOG } from '../../shared/src/games/catalog.ts';

const plan = planFloor((g) => GAMES[g].footprint, undefined, { seats: (g, v) => GAMES[g].seats(v) });
const grid = NavGrid.fromWalk(walkGrid(plan, { radius: NAV_RADIUS, cell: NAV_CELL }));
/** Just inside the street doors. */
const DOORS = { x: (plan.door.x0 + plan.door.x1) / 2, z: plan.door.z - 2 };

describe('Find a game', () => {
  const spots = gameSpots(plan);

  it('lists every station once, under the name its prompt says', () => {
    const listed = spots.flatMap((g) => g.stations.map((s) => s.id));
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.length).toBe(plan.stations.filter((s) => !CATALOG[s.game].dev).length);
    for (const g of spots) {
      for (const s of g.stations) {
        const name = s.tier === 'high' ? `High Limit ${stationName(s.game, s.variant)}` : stationName(s.game, s.variant);
        expect(name).toBe(g.name);
      }
    }
  });

  it('puts each game in its section, A to Z within it, with the rooms it is in', () => {
    const sections = spots.map((g) => g.section);
    expect([...new Set(sections)]).toEqual(['Tables', 'Machines', 'Online lounge']);
    for (const section of new Set(sections)) {
      const names = spots.filter((g) => g.section === section).map((g) => g.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
    expect(spots.find((g) => g.name === 'Blackjack')?.section).toBe('Tables');
    expect(spots.find((g) => g.name === 'Neon Nights')?.section).toBe('Machines');
    expect(spots.find((g) => g.name === 'Plinko')?.section).toBe('Online lounge');
    for (const g of spots) expect(g.rooms.length).toBeGreaterThan(0);
  });

  it('can walk you from the doors to every game, ending where its players stand', () => {
    const far: string[] = [];
    for (const g of spots) {
      const s = g.stations[0]!;
      const at = standAt(s);
      const path = grid.path(DOORS, at);
      if (!path) {
        far.push(g.name);
        continue;
      }
      // the walk ends beside the station: E's reach (interact.ts, 1.6 m) from its edge
      const end = path[path.length - 1]!;
      expect(Math.hypot(end.x - at.x, end.z - at.z), g.name).toBeLessThan(1.2);
      expect(pathLength(path), g.name).toBeLessThan(160);
    }
    expect(far).toEqual([]);
  });
});

describe('the way', () => {
  const path = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 5 },
  ];

  it('knows how far along it you are and how far is left, wherever you stand near it', () => {
    expect(along(path, 0, 0)).toEqual({ at: 0, left: 15, off: 0 });
    const mid = along(path, 4, 1);
    expect(mid.at).toBeCloseTo(4, 9);
    expect(mid.left).toBeCloseTo(11, 9);
    expect(mid.off).toBeCloseTo(1, 9);
    const round = along(path, 11, 3);
    expect(round.at).toBeCloseTo(13, 9);
    expect(round.left).toBeCloseTo(2, 9);
  });

  it('says the distance to the metre close up and to five further off', () => {
    expect(distanceText(0.4)).toBe('here');
    expect(distanceText(6.4)).toBe('6 m');
    expect(distanceText(11.6)).toBe('12 m');
    expect(distanceText(23)).toBe('25 m');
    expect(distanceText(41)).toBe('40 m');
  });
});

describe('the prompt', () => {
  it('says what E does first, then what that is about', () => {
    expect(promptText({ kind: 'station', station: { name: 'Blackjack', limits: '$5–$5,000' } })).toEqual(['Play Blackjack', '$5–$5,000']);
    expect(promptText({ kind: 'spot', spot: { label: 'Sit' } })).toEqual(['Sit', '']);
    expect(promptText({ kind: 'spot', spot: { label: 'Browse · Fur Coat' } })).toEqual(['Browse', 'Fur Coat']);
    expect(promptText({ kind: 'cashier' })[0]).toMatch(/cashier/i);
  });
});

describe('a photo', () => {
  it('is named for the local day and time it was taken', () => {
    expect(photoName(new Date(2026, 9, 23, 18, 5, 9))).toBe('casino-photo-2026-10-23-180509.png');
  });
});
