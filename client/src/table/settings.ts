// The card tables' block in Settings: which deck the cards come from. Built with the sheet's own
// row helper, as the big-win toasts' block is, so it looks like its neighbours: the Settings sheet
// puts it in its Tables section with `...cardSettings(row)`. The choice applies at once to every
// card on every table (cards.ts repaints the faces) and is kept on this device.

import './settings.css';
import { el } from '../ui/kit.ts';
import { segmented } from '../ui/menu/parts.ts';
import { deck, onDeck, setDeck, FOUR_COLOUR, SUIT_PATHS, type Deck } from './cards.ts';

type Row = (label: string, control: HTMLElement, note?: HTMLElement) => HTMLElement;

const SVG = 'http://www.w3.org/2000/svg';
const SUITS = ['s', 'h', 'd', 'c'] as const;
const NAMES = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' } as const;

/** The colour a suit is printed in, in a deck. */
export function suitColour(suit: (typeof SUITS)[number], d: Deck): string {
  if (suit === 'h') return '#d40000';
  if (suit === 's') return '#141414';
  return d === 'four' ? FOUR_COLOUR[suit] : suit === 'd' ? '#d40000' : '#141414';
}

/** The four suits in a deck's colours, on a slip of card: what the choice looks like. */
function preview(): { root: SVGSVGElement; paint(d: Deck): void } {
  const root = document.createElementNS(SVG, 'svg');
  root.setAttribute('class', 'deck-preview');
  root.setAttribute('viewBox', '0 0 1300 360');
  root.setAttribute('aria-hidden', 'true');
  const paper = document.createElementNS(SVG, 'rect');
  for (const [k, v] of [['x', '4'], ['y', '4'], ['width', '1292'], ['height', '352'], ['rx', '44'], ['class', 'deck-paper']]) paper.setAttribute(k!, v!);
  root.append(paper);
  const pips = SUITS.map((s, i) => {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', SUIT_PATHS[s]);
    p.setAttribute('transform', `translate(${190 + i * 307} 180) scale(0.27)`);
    root.append(p);
    return p;
  });
  return {
    root,
    paint(d) {
      SUITS.forEach((s, i) => pips[i]!.setAttribute('fill', suitColour(s, d)));
    },
  };
}

function plainRow(label: string, control: HTMLElement, note?: HTMLElement): HTMLElement {
  const r = el('div', 'set-row');
  const c = el('div', 'set-control');
  c.append(control);
  if (note) c.append(note);
  r.append(el('div', 'set-label', label), c);
  return r;
}

/** The Card deck row: two colours or four, with the four suits shown as they'll be dealt. */
export function cardSettings(row: Row = plainRow): HTMLElement[] {
  const look = preview();
  look.paint(deck());
  const ctl = segmented<Deck>(
    'Card deck',
    [
      { id: 'classic', label: 'Two colours' },
      { id: 'four', label: 'Four colours' },
    ],
    deck(),
    (d) => {
      look.paint(d);
      void setDeck(d);
    },
  );
  // changed somewhere else meanwhile: follow (and stop listening once the sheet has closed)
  const off = onDeck((d) => {
    if (!ctl.root.isConnected) return void off();
    ctl.set(d);
    look.paint(d);
  });
  const note = el('div', 'deck-note');
  note.append(look.root, el('p', 'set-note', `Four colours tells the suits apart at a glance: ${SUITS.map((s) => `${NAMES[s]} ${s === 's' ? 'black' : s === 'h' ? 'red' : s === 'd' ? 'blue' : 'green'}`).join(', ')}. Every card table on this device.`));
  return [row('Card deck', ctl.root, note)];
}
