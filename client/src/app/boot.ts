// The game proper: login, menu, floor, tables. Assembled during integration from the menu
// (ui/menu), the world (world/), presence, lobbies and the game modules; until then this opens
// a simple game picker over the dev room so the whole loop can be played.

import { runHarness } from '../dev/harness.ts';
import { el } from '../ui/kit.ts';
import { CATALOG } from '../../../shared/src/games/catalog.ts';

export async function boot(): Promise<void> {
  const ui = document.getElementById('ui')!;
  const box = el('div', 'modal panel');
  box.append(el('h2', '', 'Casino Simulator'), el('p', '', 'Pick a table.'));
  const row = el('div', 'row');
  for (const g of Object.values(CATALOG)) {
    const a = el('a', 'btn', g.name);
    a.href = `?dev=table&game=${g.id}`;
    row.append(a);
  }
  box.append(row);
  const scrim = el('div', 'scrim');
  scrim.append(box);
  ui.append(scrim);
  void runHarness;
}
