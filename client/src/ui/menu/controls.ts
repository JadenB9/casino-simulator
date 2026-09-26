// The Controls block of the Settings sheet: the camera (behind your character or through its eyes,
// F on the floor switches too), whether the floor holds the mouse (so moving it always looks
// around) or looks only while dragging, and how fast it turns the camera. All apply at once:
// world/mouse.ts tells the walking player. Touch screens have no mouse to hold, so they get the
// camera only.

import { el } from '../kit.ts';
import { keyLabel } from '../keys.ts';
import { segmented } from './parts.ts';
import { SENS_MAX, SENS_MIN, loadMouse, setMouseSettings, type View } from '../../world/mouse.ts';
import { drinkFx, setDrinkFx } from '../../world/consumables/prefs.ts';

type Row = (label: string, control: HTMLElement, note?: HTMLElement) => HTMLElement;

export function controlSettings(row: Row): HTMLElement[] {
  const m = loadMouse();
  const fine = matchMedia('(any-pointer: fine)').matches;
  const view = segmented<View>(
    'Camera',
    [
      { id: 'third', label: 'Third person' },
      { id: 'first', label: 'First person' },
    ],
    m.view,
    (v) => setMouseSettings({ view: v }),
  );
  const camera = row(
    'Camera',
    view.root,
    el('p', 'set-note', fine ? `Third person follows behind you; first person sees the floor through your eyes. ${keyLabel('view')} switches on the floor.` : 'Third person follows behind you; first person sees the floor through your eyes.'),
  );
  // the bar menu has the same switch (world/consumables/prefs.ts)
  const sway = segmented<'on' | 'off'>(
    'Drinks sway the view',
    [
      { id: 'on', label: 'On' },
      { id: 'off', label: 'Off' },
    ],
    drinkFx() ? 'on' : 'off',
    (v) => setDrinkFx(v === 'on'),
  );
  const drinks = row('Drinks sway the view', sway.root, el('p', 'set-note', 'A few drinks sway the camera a little and warm the edges of the view. Reduce flashing & motion turns the sway off too.'));
  if (!fine) return [el('h3', 'section-label', 'Controls'), camera, drinks];
  const look = segmented<'lock' | 'drag'>(
    'Mouse look',
    [
      { id: 'lock', label: 'Locked' },
      { id: 'drag', label: 'Drag' },
    ],
    m.capture ? 'lock' : 'drag',
    (v) => setMouseSettings({ capture: v === 'lock' }),
  );
  const wrap = el('div', 'set-volume');
  const input = el('input', 'range');
  input.type = 'range';
  input.min = String(SENS_MIN * 100);
  input.max = String(SENS_MAX * 100);
  input.step = '5';
  input.value = String(Math.round(m.sensitivity * 100));
  input.setAttribute('aria-label', 'Mouse sensitivity');
  const value = el('span', 'set-value money', times(m.sensitivity));
  input.addEventListener('input', () => {
    const s = Number(input.value) / 100;
    value.textContent = times(s);
    setMouseSettings({ sensitivity: s });
  });
  wrap.append(input, value);
  return [
    el('h3', 'section-label', 'Controls'),
    camera,
    row('Mouse look', look.root, el('p', 'set-note', 'Locked: on the floor, moving the mouse looks around. Esc frees the cursor and a click on the floor takes it back. Drag: hold the button and drag to look.')),
    row('Sensitivity', wrap),
    drinks,
  ];
}

function times(s: number): string {
  return `${s.toFixed(2)}×`;
}
