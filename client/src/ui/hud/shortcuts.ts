// The "?" overlay: every key the game listens to, grouped by where it works.

import './hud.css';
import { el } from '../kit.ts';
import type { Closable } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { keycap } from '../menu/parts.ts';
import { keyLabel, type KeyAction } from '../keys.ts';

/** Keys as keycaps; "/" between keys means "or", "-" joins a range (1-6, Q-P). */
/** A row: its keys (v7.4: or what the rebindable ones are now: ui/keys.ts) and what they do. */
type Row = [keys: string | (() => string), action: string];

export const SHORTCUTS: readonly { title: string; rows: readonly Row[] }[] = [
  {
    title: 'Floor',
    rows: [
      [() => ['forward', 'left', 'back', 'right'].map((a) => keyLabel(a as KeyAction)).join(' '), 'Walk'],
      ['↑ ← ↓ →', 'Walk, on the arrow keys'],
      [() => keyLabel('run'), 'Run, held while walking'],
      [() => keyLabel('jump'), 'Jump'],
      [() => keyLabel('crouch'), 'Crouch, and stand up again'],
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
      [() => ['forward', 'left', 'back', 'right'].map((a) => keyLabel(a as KeyAction)).join(' '), 'Drive and steer (the arrow keys too)'],
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
    ],
  },
  { title: 'Blackjack', rows: [['H', 'Hit'], ['S', 'Stand'], ['D', 'Double'], ['P', 'Split'], ['U', 'Surrender'], ['Y / N', 'Insurance or no insurance']] },
  { title: 'Roulette', rows: [['T', 'Racetrack (European wheel)']] },
  { title: 'Craps', rows: [['Space', 'Roll, when you are the shooter']] },
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
    for (const k of alt.split(' ')) box.append(keycap(k));
  });
  return box;
}

export function openShortcuts(deps: { root: HTMLElement; onClose?(): void }): Closable {
  const sheet = openSheet(deps.root, { title: 'Keyboard', subtitle: 'Keys work when no text field has focus. Settings, Keys changes any of the floor\'s.', cls: 'shortcuts-sheet', onClose: deps.onClose });
  const grid = el('div', 'sc-grid');
  for (const group of SHORTCUTS) {
    const g = el('section', 'sc-group');
    g.append(el('h3', 'section-label', group.title));
    const list = el('dl', 'sc-list');
    for (const [k, action] of group.rows) {
      const dt = el('dt');
      dt.append(keys(typeof k === 'function' ? k() : k));
      list.append(dt, el('dd', '', action));
    }
    g.append(list);
    grid.append(g);
  }
  sheet.body.append(grid);
  return { root: sheet.root, close: () => sheet.close() };
}
