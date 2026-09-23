// Entry point. The dev harness runs when the URL asks for it; otherwise the game proper boots
// (menu, floor, tables), which lives in app/boot.ts.

import { runHarness } from './dev/harness.ts';

const params = new URLSearchParams(location.search);
const done = () => document.getElementById('boot')?.classList.add('done');

async function start(): Promise<void> {
  if (params.get('dev') === 'table') {
    await runHarness(params);
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
