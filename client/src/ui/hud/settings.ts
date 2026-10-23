// Settings, in sections with a rail to jump between them (a row of chips on a phone): General,
// Controls (the camera and mouse, menu/controls.ts, and the keys, menu/keybinds.ts), Graphics,
// Sound (the volume and each kind of sound's own level), Accessibility (flashing and motion, the
// interface's size), Social (big-win notes, invites) and Play (tips, the play reminder and the
// loss limit). One column that scrolls, so every row is there to find; the rail lights the
// section in view. Quality picks how the one renderer is built, so a change is saved now and used
// from the next load; everything else applies straight away.

import './hud.css';
import './settings.css';
import { tips } from '../../app/tips.ts';
import { calm, setCalm } from '../../app/comfort.ts';
import { setTheme, theme, type Theme } from '../../app/theme.ts';
import { type Quality } from '../../render/engine3d.ts';
import { graphicsRows } from '../../render/graphics-settings.ts';
import { el } from '../kit.ts';
import type { Closable, SfxLike, SoundKind } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { segmented } from '../menu/parts.ts';
import { bigWinSettings } from '../feed/settings.ts'; // features: big-win toasts
import { cardSettings } from '../../table/settings.ts'; // the card tables' deck
import { controlSettings } from '../menu/controls.ts'; // world: the camera and mouse look
import { keySettings } from '../menu/keybinds.ts';
import { keyLabel } from '../keys.ts';
import { inviteSettings } from '../lobby/invite-settings.ts'; // v6 invite6: do not disturb
import { reminderSettings } from '../menu/reminder.ts'; // v6.1 casino61: the play reminder and loss limit
import { setShowFps, setUiSize, showFps, uiSize, type UiSize } from './display.ts';

export type SettingsSection = 'general' | 'controls' | 'graphics' | 'sound' | 'access' | 'social' | 'play';

/** The sections, in order, with a line each for the palette (ui/hud/palette.ts) and the words it finds them by. */
export const SETTINGS_SECTIONS: readonly { id: SettingsSection; title: string; about: string; keywords: string }[] = [
  { id: 'general', title: 'General', about: 'Theme, frame rate', keywords: 'light dark mode theme fps frame rate' },
  { id: 'controls', title: 'Controls', about: 'Camera, mouse, keys', keywords: 'camera first person third mouse look sensitivity keys rebind bindings drinks sway' },
  { id: 'graphics', title: 'Graphics', about: 'Quality, resolution, glow, film look', keywords: 'quality high low bloom glow antialiasing smooth edges fxaa resolution sharp film look vignette colour grade frame rate saver battery 30 fps performance' },
  { id: 'sound', title: 'Sound', about: 'Volume, each kind of sound', keywords: 'volume mute audio music room ambience game sounds' },
  { id: 'access', title: 'Accessibility', about: 'Flashing and motion, interface size', keywords: 'reduce flashing motion calm size larger zoom text' },
  { id: 'social', title: 'Social', about: 'Big wins, invites', keywords: 'big win toasts notes invites do not disturb' },
  { id: 'play', title: 'Play', about: 'Tips, play reminder, loss limit', keywords: 'tips strategy reminder break loss limit responsible' },
];

export interface SettingsDeps {
  root: HTMLElement;
  sfx: SfxLike;
  /** The quality the renderer is running with now (defaults to what was saved when the page loaded). */
  quality?: Quality;
  /** Reloads the page to apply a new quality; defaults to location.reload(). */
  reload?: () => void;
  /** Open at this section (scrolled to it) rather than the top. */
  section?: SettingsSection;
  onClose?(): void;
}



type Row = (label: string, control: HTMLElement, note?: HTMLElement) => HTMLElement;

const row: Row = (label, control, note) => {
  const r = el('div', 'set-row');
  const l = el('div', 'set-label', label);
  const c = el('div', 'set-control');
  c.append(control);
  if (note) c.append(note);
  r.append(l, c);
  return r;
};

const note = (text: string): HTMLElement => el('p', 'set-note', text);

/** A slider from 0 to 100% with its value beside it; `sample` plays a sound at the new level once it settles. */
function slider(label: string, value: number, set: (v: number) => void, sample?: () => void): { root: HTMLElement; input: HTMLInputElement } {
  const wrap = el('div', 'set-volume');
  const input = el('input', 'range');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '5';
  input.value = String(Math.round(value * 100));
  input.setAttribute('aria-label', label);
  const shown = el('span', 'set-value money', `${input.value}%`);
  let timer = 0;
  input.addEventListener('input', () => {
    shown.textContent = `${input.value}%`;
    set(Number(input.value) / 100);
    clearTimeout(timer);
    if (sample) timer = window.setTimeout(sample, 140);
  });
  wrap.append(input, shown);
  return { root: wrap, input };
}


/** The Sound section: on or off, the volume, and each kind of sound's own level where the manager has them. */
function soundBlock(sfx: SfxLike): { nodes: HTMLElement[]; dispose(): void } {
  const sliders: HTMLInputElement[] = [];
  const sound = segmented<'on' | 'off'>('Sound', [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }], sfx.muted ? 'off' : 'on', (v) => {
    sfx.setMuted(v === 'off');
    if (v === 'on') sfx.play('ui-click', { volume: 0.5 });
    for (const s of sliders) s.disabled = v === 'off';
  });
  const volume = slider('Volume', sfx.volume, (v) => sfx.setVolume(v), () => sfx.play('chip-lay', { volume: 0.9 }));
  sliders.push(volume.input);
  const out = [row('Sound', sound.root, note(`${keyLabel('mute')} mutes and unmutes anywhere.`)), row('Volume', volume.root, note('Everything together.'))];
  if (sfx.level && sfx.setLevel) {
    const level = sfx.level.bind(sfx);
    const setLevel = sfx.setLevel.bind(sfx);
    const kinds: { kind: SoundKind; label: string; about: string; sample?: () => void }[] = [
      { kind: 'game', label: 'Game sounds', about: 'Cards, chips, wheels, machines, effects and the buttons.', sample: () => sfx.play('chip-lay', { volume: 0.9 }) },
      { kind: 'room', label: 'Room', about: "The floor's murmur, the slots' chimes, chips at other tables and the bell for a big win." },
      { kind: 'music', label: 'Music', about: 'The beat under a dance and the disco.' },
    ];
    for (const k of kinds) {
      const s = slider(k.label, level(k.kind), (v) => setLevel(k.kind, v), k.sample);
      sliders.push(s.input);
      out.push(row(k.label, s.root, note(k.about)));
    }
  }
  for (const s of sliders) s.disabled = sfx.muted;
  // the mute key works over the sheet too: the rows follow it
  let shown = sfx.muted;
  const off =
    sfx.onChange?.(() => {
      if (sfx.muted === shown) return;
      shown = sfx.muted;
      sound.set(shown ? 'off' : 'on');
      for (const s of sliders) s.disabled = shown;
    }) ?? (() => {});
  return { nodes: out, dispose: off };
}

export function openSettings(deps: SettingsDeps): Closable {
  // v7.4: rebindable keys, where there's a keyboard
  const keys = matchMedia('(any-pointer: fine)').matches ? keySettings() : null;
  const sheet = openSheet(deps.root, {
    title: 'Settings',
    cls: 'settings-sheet',
    onClose: () => {
      keys?.dispose();
      sound.dispose();
      sheet.body.removeEventListener('scroll', spy);
      deps.onClose?.();
    },
  });

  // light or dark for the 2D layer (app/theme.ts): applies at once, and on every page of the site
  const themeCtl = segmented<Theme>('Theme', [{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }], theme(), (t) => setTheme(t));
  const fpsCtl = segmented<'on' | 'off'>('Show frame rate', [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }], showFps() ? 'on' : 'off', (v) => setShowFps(v === 'on'));
  // flashing and motion (app/comfort.ts): applies at once, everywhere
  const calmCtl = segmented<'full' | 'reduced'>('Reduce flashing & motion', [{ id: 'full', label: 'Full' }, { id: 'reduced', label: 'Reduced' }], calm() ? 'reduced' : 'full', (v) => setCalm(v === 'reduced'));
  const sizeCtl = segmented<UiSize>('Interface size', [{ id: 'standard', label: 'Standard' }, { id: 'large', label: 'Large' }, { id: 'larger', label: 'Larger' }], uiSize(), (v) => setUiSize(v));
  const sound = soundBlock(deps.sfx);
  const tipsCtl = segmented<'on' | 'off'>('Tips', [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }], tips.on ? 'on' : 'off', (v) => tips.set(v === 'on'));

  const content: Record<SettingsSection, HTMLElement[]> = {
    general: [
      row('Theme', themeCtl.root, note('The menus, panels and HUD. The casino keeps its own lights. Shared with the rest of j4den.com.')),
      row('Show frame rate', fpsCtl.root, note('A tile in the HUD beside your money: frames a second, and how long each one takes.')),
    ],
    // v7.4: the controls and the keys near the top, where they're found
    controls: [...controlSettings(row), ...(keys?.nodes ?? [])],
    // the renderer's own rows (render/graphics-settings.ts): Quality, then what applies at once
    graphics: graphicsRows({ quality: deps.quality, reload: deps.reload, row }),
    sound: sound.nodes,
    access: [
      row('Flashing & motion', calmCtl.root, note('Reduced: steady lights instead of flashing and chasing, fewer particles, no camera shake.')),
      row('Interface size', sizeCtl.root, note('The HUD, its panels and the notes under it. For everything else larger as well, use the browser’s own zoom (Ctrl and +).')),
    ],
    social: [...bigWinSettings(row), ...inviteSettings(row)],
    play: [
      row('Tips', tipsCtl.root, note('Shows the best play where a game has one (basic strategy, the video poker holds, Q-6-4) and which bets are better elsewhere.')),
      // the card tables' own rows (table/settings.ts): two colours or four
      ...cardSettings(row),
      ...reminderSettings(row),
    ],
  };

  const layout = el('div', 'set-layout');
  const nav = el('nav', 'set-nav');
  nav.setAttribute('aria-label', 'Settings sections');
  const sections = el('div', 'set-sections');
  const links = new Map<SettingsSection, HTMLButtonElement>();
  const heads = new Map<SettingsSection, HTMLElement>();
  for (const s of SETTINGS_SECTIONS) {
    const nodes = content[s.id];
    if (!nodes.length) continue;
    const sec = el('section', 'set-section');
    sec.dataset.section = s.id;
    const head = el('h3', 'section-label set-head', s.title);
    head.id = `set-${s.id}`;
    head.tabIndex = -1;
    sec.setAttribute('aria-labelledby', head.id);
    sec.append(head, ...nodes);
    sections.append(sec);
    heads.set(s.id, sec);
    const link = el('button', 'set-link', s.title);
    link.type = 'button';
    link.addEventListener('click', () => go(s.id, true));
    links.set(s.id, link);
    nav.append(link);
  }
  layout.append(nav, sections);
  sheet.body.append(layout);

  /** Light the rail's link for the section at the top of the view. */
  const body = sheet.body;
  let lit: SettingsSection | null = null;
  const light = (id: SettingsSection) => {
    if (id === lit) return;
    lit = id;
    for (const [sid, link] of links) {
      if (sid === id) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    // a row of chips that scrolls sideways keeps the lit one in view
    const link = links.get(id);
    if (link && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2, behavior: calm() ? 'auto' : 'smooth' });
  };
  function spy(): void {
    // on a narrow sheet the rail is a row of chips stuck over the rows (settings.css): count it
    const stacked = nav.offsetWidth > layout.offsetWidth * 0.6;
    const top = body.getBoundingClientRect().top + (stacked ? nav.offsetHeight : 0) + 24;
    let at: SettingsSection = SETTINGS_SECTIONS[0]!.id;
    for (const [id, sec] of heads) if (sec.getBoundingClientRect().top <= top) at = id;
    // the last section can't reach the top: at the bottom of the list it's the one shown
    if (body.scrollTop > 0 && body.scrollTop + body.clientHeight >= body.scrollHeight - 2) at = [...heads.keys()].at(-1) ?? at;
    light(at);
  }
  function go(id: SettingsSection, focus: boolean): void {
    const sec = heads.get(id);
    if (!sec) return;
    sec.scrollIntoView({ block: 'start', behavior: calm() || !focus ? 'auto' : 'smooth' });
    light(id);
    if (focus) sec.querySelector<HTMLElement>('.set-head')?.focus({ preventScroll: true });
  }
  body.addEventListener('scroll', spy, { passive: true });
  light(deps.section ?? SETTINGS_SECTIONS[0]!.id);
  if (deps.section) requestAnimationFrame(() => go(deps.section!, false));
  return { root: sheet.root, close: () => sheet.close() };
}
