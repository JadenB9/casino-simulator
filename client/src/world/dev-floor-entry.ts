// Entry for dev-floor.html: the floor on its own, before main.ts routes ?dev=floor here.
import { runDevFloor } from './dev-floor.ts';

runDevFloor(new URLSearchParams(location.search)).catch((err) => {
  console.error(err);
  const note = document.getElementById('boot-note');
  if (note) note.textContent = 'The floor failed to load. Reload to try again.';
});
