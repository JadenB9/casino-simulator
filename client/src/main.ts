// Entry point. On the dev server the dev pages run when the URL asks for them (?dev=table for one
// game's table, ?dev=floor for the floor on its own); otherwise, and always in a production build
// (the table harness logs in with a throwaway name and the dev password, which is no way to make
// accounts on the real site), the game proper boots (menu, floor, tables), in app/boot.ts.

const params = new URLSearchParams(location.search);
const done = () => document.getElementById('boot')?.classList.add('done');
const dev = import.meta.env.DEV ? params.get('dev') : null;

async function start(): Promise<void> {
  if (dev === 'table') {
    await (await import('./dev/harness.ts')).runHarness(params);
  } else if (dev === 'floor') {
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
