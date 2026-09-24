// The Controls block of the Settings sheet: whether the floor holds the mouse (so moving it always
// looks around) or looks only while dragging, and how fast it turns the camera. Both apply at once:
// world/mouse.ts tells the walking player. Touch screens have no mouse to hold, so they skip it.

import { el } from '../kit.ts';
import { segmented } from './parts.ts';
import { SENS_MAX, SENS_MIN, loadMouse, setMouseSettings } from '../../world/mouse.ts';

type Row = (label: string, control: HTMLElement, note?: HTMLElement) => HTMLElement;

export function controlSettings(row: Row): HTMLElement[] {
  if (!matchMedia('(any-pointer: fine)').matches) return [];
  const m = loadMouse();
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
    row('Mouse look', look.root, el('p', 'set-note', 'Locked: on the floor, moving the mouse looks around. Esc frees the cursor and a click on the floor takes it back. Drag: hold the button and drag to look.')),
    row('Sensitivity', wrap),
  ];
}

function times(s: number): string {
  return `${s.toFixed(2)}×`;
}
