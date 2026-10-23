// Entry point. On the dev server the dev pages run when the URL asks for them (?dev=table for one
// game's table, ?dev=floor for the floor on its own); otherwise, and always in a production build
// (the table harness logs in with a throwaway name and the dev password, which is no way to make
// accounts on the real site), the game proper boots (menu, floor, tables), in app/boot.ts.
//
// The game is imported here, not on demand: that puts it in the entry chunk, so index.html names
// it and three's chunk outright and the browser fetches both as it reads the page, instead of a
// tiny entry first and the real downloads one round trip later. The dev pages stay on demand, and
// so do the tables' views (games/index.ts): the floor needs none of them to open, so they come
// once it has, in idle moments.

import { boot } from './app/boot.ts';
import { warmViews } from './games/index.ts';

const params = new URLSearchParams(location.search);
const done = () => document.getElementById('boot')?.classList.add('done');
const dev = import.meta.env.DEV ? params.get('dev') : null;

async function start(): Promise<void> {
  if (dev === 'table') {
    await (await import('./dev/harness.ts')).runHarness(params);
  } else if (dev === 'floor') {
    await (await import('./world/dev-floor.ts')).runDevFloor(params);
  } else {
    await boot();
    warmViews();
  }
  done();
}

start().catch((err) => {
  console.error(err);
  const note = document.getElementById('boot-note');
  if (note) note.textContent = 'The casino failed to load. Reload to try again.';
});
