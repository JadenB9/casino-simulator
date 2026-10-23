// The "?" overlay: every key the game listens to, grouped by where it works, in cards; a filter
// finds a key by what it does or by the key itself, and Change keys opens Settings at Controls.

import './hud.css';
import './settings.css';
import { el } from '../kit.ts';
import type { Closable } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { keycap } from '../menu/parts.ts';
import { icon } from '../menu/icons.ts';
import { keyLabel, type KeyAction } from '../keys.ts';

/** Keys as keycaps; "/" between keys means "or", "-" joins a range (1-6, Q-P). */
/** A row: its keys (v7.4: or what the rebindable ones are now: ui/keys.ts) and what they do. */
type Row = [keys: string | (() => string), action: string];

/** The four walking (and driving) keys as they're bound now. */
const WALK: readonly KeyAction[] = ['forward', 'left', 'back', 'right'];
const walkKeys = () => WALK.map(keyLabel).join(' ');
/** The palette's key (ui/hud/hud.ts): Cmd on a Mac. */
const paletteKey = () => (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K');

export const SHORTCUTS: readonly { title: string; rows: readonly Row[] }[] = [
  {
    title: 'Floor',
    rows: [
      [walkKeys, 'Walk'],
      ['↑ ← ↓ →', 'Walk, on the arrow keys'],
      [() => keyLabel('run'), 'Run, held while walking'],
      [() => keyLabel('jump'), 'Jump'],
      [() => keyLabel('crouch'), 'Crouch, and stand up again'],
      ['Right-click', 'Aim in, held, with a gun out'],
      [() => keyLabel('gun'), 'Draw your gun (pick one if you own several), again to put it away; click fires'],
      [() => keyLabel('interact'), 'Whatever the prompt offers; again to stand up'],
      [() => keyLabel('view'), 'First or third person'],
      [() => keyLabel('ride'), 'Step off your ride, and back on (pick one if you own several)'],
      ['Click', 'Throw a punch (a drawn gun fires instead)'],
      [() => keyLabel('sip'), 'Take a sip or a bite of what you hold'],
      [() => keyLabel('map'), 'Map of the casino'],
      [() => `${keyLabel('chat')} or Enter`, 'Chat'],
    ],
  },
  {
    title: 'Driving',
    rows: [
      [walkKeys, 'Drive and steer (the arrow keys too)'],
      [() => keyLabel('jump'), 'Handbrake'],
      [() => keyLabel('horn'), 'Horn'],
      [() => keyLabel('carView'), 'Car camera'],
      [() => keyLabel('interact'), 'Get out (slow down first)'],
    ],
  },
  {
    title: 'Anywhere',
    rows: [
      [() => keyLabel('emotes'), 'Emotes, on the floor or at a table'],
      ['1-6', 'Pick a free emote while the emotes are open'],
      ['Q-[', 'Pick a boutique or reward emote (a locked one shows its price)'],
      ['⇧ J', 'Join the newest invite'], // v6 invite6
      ['Esc', 'Free the mouse, close a panel, stand up, leave'],
      [() => keyLabel('feats'), 'Achievements and challenges'],
      [() => keyLabel('mute'), 'Mute or unmute'],
      [paletteKey, 'Search every action, setting, room and game'],
      ['?', 'This list'],
    ],
  },
  {
    title: 'Any table',
    rows: [
      ['1-9 / 0', 'Pick a chip, left to right'],
      ['A', 'Max: the most the bet takes, or all your chips (at a layout, then click a spot)'],
      ['⌫ / ⌘ Z', 'Take back the last chip'],
      ['X', 'Clear your bets'],
      ['R', 'Rebet'],
      ['⇧ R', 'Rebet ×2'],
      ['Space', 'Deal, spin, roll or draw'],
      ['K / ⇧ K', 'Tip the dealer the table minimum, or twice it (between hands)'], // v6.1 casino61
      ['O', 'History: the last rounds at a card table'],
    ],
  },
  { title: 'Blackjack', rows: [['H', 'Hit'], ['S', 'Stand'], ['D', 'Double'], ['P', 'Split'], ['U', 'Surrender'], ['Y / N', 'Insurance or no insurance']] },
  { title: 'Roulette', rows: [['L', 'Racetrack: neighbour bets, the called bets (single zero) and your favourite layouts']] },
  { title: 'Craps', rows: [['Space', 'Roll, when you are the shooter'], ['O', 'Odds behind your line and come bets']] },
  { title: 'Baccarat', rows: [['P / B / T', 'Chip on Player, Banker or Tie']] },
  { title: 'Three Card Poker', rows: [['P', 'Play'], ['F', 'Fold']] },
  { title: 'Video poker', rows: [['1-5', 'Hold or release a card'], ['Space', 'Deal, then draw'], ['↑ / ↓', 'Bet up or down']] },
  { title: 'Slots', rows: [['Space', 'Spin'], ['↑ / ↓', 'Bet up or down'], ['I', 'Pays and rules']] },
  {
    title: 'House Originals',
    rows: [
      ['Space', 'The green button: bet or cash out'],
      ['H / L', 'Hi-Lo: higher or lower (or ↑ ↓), S skips'],
      ['1-4', 'Tower: a tile on the row'],
      ['R', 'Mines and Tower: a tile at random'],
      ['A', 'Keno: pick for me'],
      ['C', 'Keno: clear the picks'],
    ],
  },
  {
    title: "Hold'em",
    rows: [
      ['F', 'Fold'],
      ['C', 'Check or call'],
      ['R', 'Bet or raise'],
      ['A', 'All in (asks first)'],
      ['Q W E', 'Preset bet sizes'],
      ['↑ / ↓', 'Adjust the amount'],
      ['Enter', 'Confirm the amount'],
    ],
  },
];

function keys(spec: string): HTMLElement {
  const box = el('span', 'sc-keys');
  spec.split(' / ').forEach((alt, i) => {
    if (i > 0) box.append(el('span', 'sc-or', 'or'));
    const range = alt.match(/^([0-9A-Z])-([0-9A-Z])$/);
    if (range) {
      box.append(keycap(range[1]!), el('span', 'sc-or', 'to'), keycap(range[2]!));
      return;
    }
    // ("T or Enter": the word between two keys is said, not a keycap)
    for (const k of alt.split(' ')) box.append(k === 'or' ? el('span', 'sc-or', 'or') : keycap(k));
  });
  return box;
}

export interface ShortcutsOpts {
  root: HTMLElement;
  /** Settings at Controls, where the floor's keys change (Change keys). */
  onKeys?(): void;
  /** The palette's keycap, if the caller knows it better ("⌘ K"). */
  paletteKey?: string;
  onClose?(): void;
}

export function openShortcuts(deps: ShortcutsOpts): Closable {
  const sheet = openSheet(deps.root, { title: 'Keyboard', subtitle: 'Keys work whenever no text field has focus.', cls: 'shortcuts-sheet', onClose: deps.onClose });
  // a filter, by what a key does or by the key itself
  const tools = el('div', 'sc-tools');
  const filter = el('label', 'sc-filter');
  const input = el('input');
  input.type = 'search';
  input.placeholder = 'Find a key or what it does';
  input.setAttribute('aria-label', 'Find a key or what it does');
  input.autocomplete = 'off';
  input.spellcheck = false;
  filter.append(icon('search'), input);
  tools.append(filter);
  const grid = el('div', 'sc-grid');
  const none = el('p', 'sc-none', 'No key does that. Try a word like “walk”, “deal” or “map”.');
  none.hidden = true;
  const rows: { group: HTMLElement; dt: HTMLElement; dd: HTMLElement; text: string }[] = [];
  for (const group of SHORTCUTS) {
    const g = el('section', 'sc-group');
    g.append(el('h3', 'section-label', group.title));
    const list = el('dl', 'sc-list');
    for (const [k, action] of group.rows) {
      const spec = typeof k === 'function' ? (k === paletteKey && deps.paletteKey ? deps.paletteKey : k()) : k;
      const dt = el('dt');
      dt.append(keys(spec));
      const dd = el('dd', '', action);
      list.append(dt, dd);
      rows.push({ group: g, dt, dd, text: `${group.title} ${action} ${spec}`.toLowerCase() });
    }
    g.append(list);
    grid.append(g);
  }
  const foot = el('div', 'sc-foot');
  foot.append(el('span', '', 'The floor’s keys are yours to change, each one in Settings, Controls.'));
  if (deps.onKeys) {
    const change = el('button', 'btn ghost', 'Change keys');
    change.type = 'button';
    change.addEventListener('click', () => {
      sheet.close();
      deps.onKeys?.();
    });
    foot.append(change);
  }
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const shown = new Set<HTMLElement>();
    for (const r of rows) {
      const on = words.every((w) => r.text.includes(w));
      r.dt.hidden = r.dd.hidden = !on;
      if (on) shown.add(r.group);
    }
    for (const g of grid.children) (g as HTMLElement).hidden = !shown.has(g as HTMLElement);
    none.hidden = shown.size > 0;
  });
  sheet.body.append(tools, grid, none, foot);
  return { root: sheet.root, close: () => sheet.close() };
}
