import { describe, it, expect } from 'vitest';
import { planFloor } from '../src/world/layout.ts';
import { GAMES } from '../src/games/index.ts';
import { floorCommands } from '../src/app/commands.ts';
import { rank } from '../src/ui/hud/palette.ts';
import type { FloorWorld } from '../src/world/index.ts';

// What the command palette finds on the floor (app/commands.ts): every room of the real plan,
// and every game once, at the room that has it; typing a game's name finds it first.

const plan = planFloor((g) => GAMES[g].footprint, undefined, { seats: (g, v) => GAMES[g].seats(v) });
const cmds = floorCommands({ plan } as unknown as FloorWorld);

describe('the floor in the palette', () => {
  it('has every room, with what is in it', () => {
    const rooms = cmds.filter((c) => c.group === 'Room');
    expect(rooms.map((c) => c.label).sort()).toEqual(plan.rooms.map((r) => r.name).sort());
    const pit = rooms.find((c) => c.id === 'room:pit')!;
    expect(pit.hint).toMatch(/Roulette/);
    // every game in it, for the search, though the line under it shows the first few
    expect(pit.keywords).toMatch(/Blackjack/);
  });

  it('has each game once, at its room, said without a doubled "the"', () => {
    const games = cmds.filter((c) => c.group === 'Game');
    expect(new Set(games.map((c) => c.label)).size).toBe(games.length);
    expect(games.length).toBeGreaterThan(20);
    for (const g of games) expect(g.hint).toMatch(/^In the [A-Z]/);
    for (const g of games) expect(g.hint).not.toMatch(/the the/i);
  });

  it('finds a game by its name first, and a room by what it holds', () => {
    expect(rank(cmds, 'bingo')[0]!.cmd.group).toMatch(/Game|Room/);
    expect(rank(cmds, 'roulette').some((r) => r.cmd.group === 'Game' && /Roulette/.test(r.cmd.label))).toBe(true);
    expect(rank(cmds, 'pachinko')[0]!.cmd.label).toMatch(/Pachinko/);
  });
});
