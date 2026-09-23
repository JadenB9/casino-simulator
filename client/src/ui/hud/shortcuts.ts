// The "?" overlay: every key the game listens to, grouped by where it works.

import './hud.css';
import { el } from '../kit.ts';
import type { Closable } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { keycap } from '../menu/parts.ts';

/** Keys as keycaps; "/" between keys means "or", "-" joins a range. */
type Row = [keys: string, action: string];

export const SHORTCUTS: readonly { title: string; rows: readonly Row[] }[] = [
  { title: 'Floor', rows: [['W A S D', 'Walk'], ['↑ ← ↓ →', 'Walk, on the arrow keys'], ['E', 'Sit down, use a machine, visit the cashier']] },
  { title: 'Anywhere', rows: [['Esc', 'Leave the table or close a panel'], ['M', 'Mute or unmute'], ['?', 'This list']] },
  {
    title: 'Any table',
    rows: [
      ['1-7', 'Pick a chip, left to right'],
      ['⌫ / ⌘ Z', 'Take back the last chip'],
      ['X', 'Clear your bets'],
      ['R', 'Rebet'],
      ['⇧ R', 'Rebet ×2'],
      ['Space', 'Deal, spin, roll or draw'],
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
    const range = alt.match(/^(\d)-(\d)$/);
    if (range) {
      box.append(keycap(range[1]!), el('span', 'sc-or', 'to'), keycap(range[2]!));
      return;
    }
    for (const k of alt.split(' ')) box.append(keycap(k));
  });
  return box;
}

export function openShortcuts(deps: { root: HTMLElement; onClose?(): void }): Closable {
  const sheet = openSheet(deps.root, { title: 'Keyboard', subtitle: 'Keys work when no text field has focus.', cls: 'shortcuts-sheet', onClose: deps.onClose });
  const grid = el('div', 'sc-grid');
  for (const group of SHORTCUTS) {
    const g = el('section', 'sc-group');
    g.append(el('h3', 'section-label', group.title));
    const list = el('dl', 'sc-list');
    for (const [k, action] of group.rows) {
      const dt = el('dt');
      dt.append(keys(k));
      list.append(dt, el('dd', '', action));
    }
    g.append(list);
    grid.append(g);
  }
  sheet.body.append(grid);
  return { root: sheet.root, close: () => sheet.close() };
}
