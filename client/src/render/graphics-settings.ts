// The Settings sheet's graphics rows: Quality, which picks how the one renderer is built, so a
// change is saved now and used from the next load (as it always was: engine3d.ts savedQuality,
// with the same note and Reload now), then the options that apply at once (render/graphics.ts):
// the resolution, the glow (High) or the smoothing of edges (Low), the film look and the frame rate.
// The Theme and Flashing & motion rows stay with the rest of Settings (ui/hud/settings.ts).

import { savedQuality, saveQuality, type Quality } from './engine3d.ts';
import { graphicsPrefs, setGraphicsPref, type FrameRate, type Resolution } from './graphics.ts';
import { el } from '../ui/kit.ts';
import { segmented } from '../ui/menu/parts.ts';

// Read once at startup, which is when the renderer was built from it.
const LOADED_QUALITY = savedQuality();

const QUALITY_NOTE: Record<Quality, string> = {
  high: 'Bloom on lit signs and machines, antialiasing, up to twice the pixel density.',
  low: 'No bloom, one pixel per screen pixel, simpler materials. For older machines.',
};

const RESOLUTION_NOTE: Record<Resolution, string> = {
  auto: 'As sharp as the frame rate allows.',
  sharp: 'Every pixel your screen has, always. Needs a strong graphics card.',
  fast: 'Fewer pixels, a softer picture. For a slow graphics card.',
};
/** Low's Auto never steps: one pixel per screen pixel, as the Quality note says. */
const LOW_AUTO_NOTE = 'One pixel per screen pixel.';

const FPS_NOTE: Record<FrameRate, string> = {
  full: 'Every frame your screen shows.',
  saver: 'Thirty frames a second: cooler and quieter, longer on battery.',
};

export interface GraphicsSettingsOptions {
  /** The quality the renderer is running with now (defaults to what was saved when the page loaded). */
  quality?: Quality;
  /** Reloads the page to apply a new quality; defaults to location.reload(). */
  reload?: () => void;
  /** How a row is laid out: the Settings sheet passes its own, so these line up with the rest. */
  row?: (label: string, control: HTMLElement, note?: HTMLElement) => HTMLElement;
}

function plainRow(label: string, control: HTMLElement, note?: HTMLElement): HTMLElement {
  const r = el('div', 'set-row');
  const l = el('div', 'set-label', label);
  const c = el('div', 'set-control');
  c.append(control);
  if (note) c.append(note);
  r.append(l, c);
  return r;
}

const onOff = (label: string, value: boolean, set: (on: boolean) => void) => segmented<'on' | 'off'>(label, [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }], value ? 'on' : 'off', (v) => set(v === 'on'));

/** The graphics rows in a box of their own (the graphics dev page). */
export function graphicsSettings(opts: GraphicsSettingsOptions = {}): HTMLElement {
  const root = el('div', 'set-graphics');
  root.append(...graphicsRows(opts));
  return root;
}

/** The graphics rows, for the Settings sheet's Graphics section. */
export function graphicsRows(opts: GraphicsSettingsOptions = {}): HTMLElement[] {
  const running = opts.quality ?? LOADED_QUALITY;
  const row = opts.row ?? plainRow;
  const rows: HTMLElement[] = [];
  const prefs = graphicsPrefs();

  // quality: saved now, used from the next load
  const qNote = el('p', 'set-note', '');
  const pending = el('div', 'set-pending');
  const reload = el('button', 'btn ghost', 'Reload now');
  reload.type = 'button';
  reload.addEventListener('click', () => (opts.reload ?? (() => location.reload()))());
  pending.append(el('span', '', 'Applies after a reload.'), reload);
  const paintQuality = (q: Quality) => {
    qNote.textContent = QUALITY_NOTE[q];
    pending.hidden = q === running;
  };
  const quality = segmented<Quality>('Graphics quality', [{ id: 'high', label: 'High' }, { id: 'low', label: 'Low' }], savedQuality(), (q) => {
    saveQuality(q);
    paintQuality(q);
  });
  paintQuality(savedQuality());
  const qBox = el('div');
  qBox.append(qNote, pending);
  rows.push(row('Quality', quality.root, qBox));

  // the rest apply at once
  const resText = (r: Resolution) => (r === 'auto' && running === 'low' ? LOW_AUTO_NOTE : RESOLUTION_NOTE[r]);
  const resNote = el('p', 'set-note', resText(prefs.resolution));
  const resolution = segmented<Resolution>(
    'Resolution',
    [
      { id: 'auto', label: 'Auto' },
      { id: 'sharp', label: 'Sharp' },
      { id: 'fast', label: 'Fast' },
    ],
    prefs.resolution,
    (v) => {
      setGraphicsPref('resolution', v);
      resNote.textContent = resText(v);
    },
  );
  rows.push(row('Resolution', resolution.root, resNote));

  if (running === 'high') {
    const glow = onOff('Glow', prefs.glow, (on) => setGraphicsPref('glow', on));
    rows.push(row('Glow', glow.root, el('p', 'set-note', 'The halo round neon, bulbs and lamps. Off is a little faster.')));
  } else {
    const smooth = onOff('Smooth edges', prefs.smooth, (on) => setGraphicsPref('smooth', on));
    rows.push(row('Smooth edges', smooth.root, el('p', 'set-note', 'Softens the jagged edges of tables and walls, at a small cost.')));
  }

  const film = onOff('Film look', prefs.film, (on) => setGraphicsPref('film', on));
  rows.push(row('Film look', film.root, el('p', 'set-note', "Each room's own colour, and softly darkened corners.")));

  const fpsNote = el('p', 'set-note', FPS_NOTE[prefs.fps]);
  const fps = segmented<FrameRate>(
    'Frame rate',
    [
      { id: 'full', label: 'Full' },
      { id: 'saver', label: 'Saver' },
    ],
    prefs.fps,
    (v) => {
      setGraphicsPref('fps', v);
      fpsNote.textContent = FPS_NOTE[v];
    },
  );
  rows.push(row('Frame rate', fps.root, fpsNote));
  return rows;
}
