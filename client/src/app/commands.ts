// What the command palette (ui/hud/palette.ts) finds on the floor besides the HUD's own actions:
// every room, and every game by name, from the floor plan. A room opens the Floor Directory (the
// map's legend beside the plan, as the board in the lobby has it) with that room lit and what's in it
// under the plan; a game shows the way to its nearest table or machine, as Find a game does.

import { CATALOG } from '../../../shared/src/games/catalog.ts';
import type { FloorWorld } from '../world/index.ts';
import { gameSpots, roomContents } from '../world/wayfinding.ts';
import { icon } from '../ui/menu/icons.ts';
import type { Command } from '../ui/hud/palette.ts';

/** Open the Floor Directory at a room (by its name, as the legend says it). */
export function showRoom(world: FloorWorld, name: string): void {
  if (world.map.showRoom(name)) return;
  // (a name the map doesn't know: its legend's line, as a click would)
  world.map.close();
  world.map.show(true);
  const pick = [...document.querySelectorAll<HTMLButtonElement>('.map-directory .map-legend-pick')].find((b) => b.querySelector('.map-legend-name')?.textContent === name);
  pick?.click();
  pick?.scrollIntoView({ block: 'nearest' });
}

/** "the Pit", "the Jade Room": a room's name after "in". */
function theRoom(name: string): string {
  return name.startsWith('The ') ? 'the' + name.slice(3) : `the ${name}`;
}

export function floorCommands(world: FloorWorld): Command[] {
  const plan = world.plan;
  const out: Command[] = [];
  const pin = () => icon('pin');
  const chip = () => icon('chip');
  for (const r of plan.rooms) {
    const { games, about } = roomContents(plan, r.id);
    out.push({
      id: `room:${r.id}`,
      label: r.name,
      hint: games.length ? games.slice(0, 4).join(', ') + (games.length > 4 ? '…' : '') : about,
      group: 'Room',
      icon: pin,
      keywords: `${games.join(' ')} ${about}`,
      run: () => showRoom(world, r.name),
    });
  }
  // each game once (a high limit table is its own): Enter shows the way to the nearest one
  for (const g of gameSpots(plan)) {
    const room = g.rooms[0];
    const first = g.stations[0];
    if (!room || !first) continue;
    out.push({
      id: `game:${g.key}`,
      label: g.name,
      hint: `In ${theRoom(room)}${g.rooms.length > 1 ? ` and ${g.rooms.length - 1} more` : ''} · Show the way`,
      group: 'Game',
      icon: chip,
      keywords: `${CATALOG[first.game]?.name ?? ''} ${g.section} ${g.rooms.join(' ')} play table`,
      run: () => {
        // (no way to show from here, out of the casino or at a table: the map at its room)
        if (!world.map.goToGame(g.key)) showRoom(world, room);
      },
    });
  }
  return out;
}
