// What the command palette (ui/hud/palette.ts) finds on the floor besides the HUD's own actions:
// every room, and every game by name, from the floor plan. Choosing one opens the Floor Directory
// (the map's legend beside the plan, as the board in the lobby has it) with that room lit and what's
// in it under the plan, the way a click on the room's line in the legend does.

import { CATALOG } from '../../../shared/src/games/catalog.ts';
import type { FloorWorld } from '../world/index.ts';
import { roomContents } from '../world/wayfinding.ts';
import { stationName } from '../world/stations.ts';
import { icon } from '../ui/menu/icons.ts';
import type { Command } from '../ui/hud/palette.ts';

/** Open the Floor Directory at a room (by its name, as the legend says it). */
export function showRoom(world: FloorWorld, name: string): void {
  world.map.close();
  world.map.show(true);
  const pick = [...document.querySelectorAll<HTMLButtonElement>('.map-directory .map-legend-pick')].find((b) => b.querySelector('.map-legend-name')?.textContent === name);
  pick?.click();
  pick?.scrollIntoView({ block: 'nearest' });
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
  // each game once, at the first room that has it
  const seen = new Set<string>();
  for (const s of plan.stations) {
    const room = plan.rooms.find((r) => r.id === s.room);
    if (!room) continue;
    const name = s.game === 'slots' ? (CATALOG.slots.variants.find((v) => v.id === s.variant)?.name ?? 'Slots') : stationName(s.game, s.variant);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      id: `game:${name}`,
      label: name,
      hint: `In ${room.name.startsWith('The ') ? 'the' + room.name.slice(3) : `the ${room.name}`}`,
      group: 'Game',
      icon: chip,
      keywords: `${CATALOG[s.game]?.name ?? ''} ${room.name} play table`,
      run: () => showRoom(world, room.name),
    });
  }
  return out;
}
