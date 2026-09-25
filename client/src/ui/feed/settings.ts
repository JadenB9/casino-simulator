// The big-win toasts' own block in Settings: a section heading and one row, built with the sheet's
// own row helper so it looks like its neighbours.

import { el } from '../kit.ts';
import { segmented } from '../menu/parts.ts';
import { bigWinToasts, setBigWinToasts } from './prefs.ts';

type Row = (label: string, control: HTMLElement, note?: HTMLElement) => HTMLElement;

export function bigWinSettings(row: Row): HTMLElement[] {
  const ctl = segmented<'on' | 'off'>('Big-win toasts', [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }], bigWinToasts() ? 'on' : 'off', (v) => setBigWinToasts(v === 'on'));
  return [
    el('h3', 'section-label', 'Floor'),
    row('Big wins', ctl.root, el('p', 'set-note', 'A note at the top of the screen when someone on the floor wins big or earns an achievement. The sign over the pit shows every big win either way.')),
  ];
}
