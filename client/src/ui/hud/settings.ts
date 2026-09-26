// Settings: table tips, graphics quality and flashing, sound, and the camera and mouse (menu/controls.ts).
// Quality picks how the one renderer is built, so a change is saved now and used from the next
// load; everything else applies straight away.

import './hud.css';
import { tips } from '../../app/tips.ts';
import { calm, setCalm } from '../../app/comfort.ts';
import { savedQuality, saveQuality, type Quality } from '../../render/engine3d.ts';
import { el } from '../kit.ts';
import type { Closable, SfxLike } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { segmented } from '../menu/parts.ts';
import { bigWinSettings } from '../feed/settings.ts'; // features: big-win toasts
import { controlSettings } from '../menu/controls.ts'; // world: the camera and mouse look
import { keySettings } from '../menu/keybinds.ts';
import { keyLabel } from '../keys.ts';
import { inviteSettings } from '../lobby/invite-settings.ts'; // v6 invite6: do not disturb
import { reminderSettings } from '../menu/reminder.ts'; // v6.1 casino61: the play reminder and loss limit

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
  const running = deps.quality ?? LOADED_QUALITY;
  // v7.4: rebindable keys, where there's a keyboard
  const keys = matchMedia('(any-pointer: fine)').matches ? keySettings() : null;
  const sheet = openSheet(deps.root, {
    title: 'Settings',
    cls: 'settings-sheet',
    onClose: () => {
      keys?.dispose();
      deps.onClose?.();
    },
  });

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

  // flashing and motion (app/comfort.ts): applies at once, everywhere
  const calmCtl = segmented<'full' | 'reduced'>('Reduce flashing & motion', [{ id: 'full', label: 'Full' }, { id: 'reduced', label: 'Reduced' }], calm() ? 'reduced' : 'full', (v) => setCalm(v === 'reduced'));

  // sound
  const sound = segmented<'on' | 'off'>('Sound', [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }], deps.sfx.muted ? 'off' : 'on', (v) => {
    deps.sfx.setMuted(v === 'off');
    if (v === 'on') deps.sfx.play('ui-click', { volume: 0.5 });
    volume.disabled = v === 'off';
  });
  const volWrap = el('div', 'set-volume');
  const volume = el('input', 'range');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '100';
  volume.step = '5';
  volume.value = String(Math.round(deps.sfx.volume * 100));
  volume.disabled = deps.sfx.muted;
  volume.setAttribute('aria-label', 'Volume');
  const volValue = el('span', 'set-value money', `${volume.value}%`);
  let sample = 0;
  volume.addEventListener('input', () => {
    const v = Number(volume.value) / 100;
    volValue.textContent = `${volume.value}%`;
    deps.sfx.setVolume(v);
    // a chip landing at the new level, once the slider settles
    clearTimeout(sample);
    sample = window.setTimeout(() => deps.sfx.play('chip-lay', { volume: 0.9 }), 140);
  });
  volWrap.append(volume, volValue);

  const tipsCtl = segmented<'on' | 'off'>('Tips', [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }], tips.on ? 'on' : 'off', (v) => tips.set(v === 'on'));
  sheet.body.append(
    el('h3', 'section-label', 'Tables'),
    row('Tips', tipsCtl.root, el('p', 'set-note', 'Shows the best play where a game has one (basic strategy, the video poker holds, Q-6-4) and which bets are better elsewhere.')),
    ...bigWinSettings(row), // features: big-win toasts
    ...inviteSettings(row), // v6 invite6: do not disturb
    ...reminderSettings(row), // v6.1 casino61: the play reminder and loss limit
    el('h3', 'section-label', 'Graphics'),
    row('Quality', quality.root, qBox),
    row('Flashing & motion', calmCtl.root, el('p', 'set-note', 'Reduced: steady lights instead of flashing and chasing, fewer particles, no camera shake.')),
    el('h3', 'section-label', 'Audio'),
    row('Sound', sound.root, el('p', 'set-note', `${keyLabel('mute')} mutes and unmutes anywhere.`)),
    row('Volume', volWrap),
    ...controlSettings(row), // world: the camera and mouse look
    ...(keys?.nodes ?? []),
  );
  return { root: sheet.root, close: () => sheet.close() };
}
