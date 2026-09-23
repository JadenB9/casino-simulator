// Settings: graphics quality and sound. Quality picks how the one renderer is built, so a change
// is saved now and used from the next load; sound changes are heard straight away.

import './hud.css';
import { savedQuality, saveQuality, type Quality } from '../../render/engine3d.ts';
import { el } from '../kit.ts';
import type { Closable, SfxLike } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { segmented } from '../menu/parts.ts';
import { applyVolume, initVolume, savedVolume, saveVolume, setMuted } from './volume.ts';

export interface SettingsDeps {
  root: HTMLElement;
  sfx: SfxLike;
  /** The quality the renderer is running with now (defaults to what was saved when the page loaded). */
  quality?: Quality;
  /** Reloads the page to apply a new quality; defaults to location.reload(). */
  reload?: () => void;
  onClose?(): void;
}

// Read once at startup, which is when the renderer was built from it.
const LOADED_QUALITY = savedQuality();

const QUALITY_NOTE: Record<Quality, string> = {
  high: 'Bloom on lit signs and machines, antialiasing, up to twice the pixel density.',
  low: 'No bloom, one pixel per screen pixel, simpler materials. For older machines.',
};

function row(label: string, control: HTMLElement, note?: HTMLElement): HTMLElement {
  const r = el('div', 'set-row');
  const l = el('div', 'set-label', label);
  const c = el('div', 'set-control');
  c.append(control);
  if (note) c.append(note);
  r.append(l, c);
  return r;
}

export function openSettings(deps: SettingsDeps): Closable {
  initVolume(deps.sfx);
  const running = deps.quality ?? LOADED_QUALITY;
  const sheet = openSheet(deps.root, { title: 'Settings', cls: 'settings-sheet', onClose: deps.onClose });

  // graphics
  const qNote = el('p', 'set-note', '');
  const pending = el('div', 'set-pending');
  const reload = el('button', 'btn ghost', 'Reload now');
  reload.type = 'button';
  reload.addEventListener('click', () => (deps.reload ?? (() => location.reload()))());
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

  // sound
  const sound = segmented<'on' | 'off'>('Sound', [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }], deps.sfx.muted ? 'off' : 'on', (v) => {
    setMuted(deps.sfx, v === 'off');
    if (v === 'on') deps.sfx.play('ui-click', { volume: 0.5 });
    volume.disabled = v === 'off';
  });
  const volWrap = el('div', 'set-volume');
  const volume = el('input', 'range');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '100';
  volume.step = '5';
  volume.value = String(Math.round(savedVolume() * 100));
  volume.disabled = deps.sfx.muted;
  volume.setAttribute('aria-label', 'Volume');
  const volValue = el('span', 'set-value money', `${volume.value}%`);
  let sample = 0;
  volume.addEventListener('input', () => {
    const v = Number(volume.value) / 100;
    volValue.textContent = `${volume.value}%`;
    saveVolume(v);
    applyVolume(deps.sfx, v);
    // a chip landing at the new level, once the slider settles
    clearTimeout(sample);
    sample = window.setTimeout(() => deps.sfx.play('chip-lay', { volume: 0.9 }), 140);
  });
  volWrap.append(volume, volValue);

  sheet.body.append(
    el('h3', 'section-label', 'Graphics'),
    row('Quality', quality.root, qBox),
    el('h3', 'section-label', 'Audio'),
    row('Sound', sound.root, el('p', 'set-note', 'M mutes and unmutes anywhere.')),
    row('Volume', volWrap),
  );
  return { root: sheet.root, close: () => sheet.close() };
}
