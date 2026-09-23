// Entry point. The dev pages run when the URL asks for them (?dev=table for one game's table,
// ?dev=floor for the floor on its own); otherwise the game proper boots (menu, floor, tables),
// which lives in app/boot.ts.

import { runHarness } from './dev/harness.ts';

const params = new URLSearchParams(location.search);
const done = () => document.getElementById('boot')?.classList.add('done');

async function start(): Promise<void> {
  if (params.get('dev') === 'table') {
    await runHarness(params);
  } else if (params.get('dev') === 'floor') {
    await (await import('./world/dev-floor.ts')).runDevFloor(params);
  } else {
    const { boot } = await import('./app/boot.ts');
    await boot();
  }
  done();
}

start().catch((err) => {
  console.error(err);
  const note = document.getElementById('boot-note');
  if (note) note.textContent = 'The casino failed to load. Reload to try again.';
});
