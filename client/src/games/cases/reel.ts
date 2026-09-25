// The reel a case opens on: a strip of item cards running under a fixed marker, slowing to a stop
// on the item the server drew. Only the winning card is the result; the rest of the strip is
// drawn here, at the case's own odds, for show. The strip stops somewhere across the winning
// card, not on its middle, then eases onto it.

import { el } from '../../ui/kit.ts';
import { tween } from '../../table/tween.ts';
import { CASE_INFO, WEIGHT, itemAt, rarityOf, type CaseId, type CaseItem } from '../../../../shared/src/games/cases/rules.ts';
import { itemIcon } from './icons.ts';

/** A card's width and the gap after it, design pixels (cases.css). */
const CARD = 132;
const GAP = 8;
const PITCH = CARD + GAP;
/** The window onto the strip: the board's width less its margins. */
const WINDOW = 902;
const LENGTH = 56;
/** Where the winner sits on a fresh strip, and where the strip starts. */
const WIN_AT = 48;
const START_AT = 3;

/** A random item at the case's odds (the page's own draw: it only decorates the strip). */
function filler(id: CaseId): number {
  return itemAt(id, Math.floor(Math.random() * WEIGHT));
}

const mult = (m: number) => `${(m / 100).toLocaleString('en-US', { minimumFractionDigits: m < 1_000 ? 2 : 0, maximumFractionDigits: 2 })}×`;

/** An item's card: its picture on a glow of its rarity, its multiplier, optionally its name. */
export function itemCard(it: CaseItem, cls: string, named = false): HTMLElement {
  const card = el('div', `${cls} r-${rarityOf(it.mult)}`);
  card.append(el('div', 'ca-glow'), itemIcon(it.kind), el('span', 'ca-card-mult', mult(it.mult)));
  if (named) card.append(el('span', 'ca-card-name', it.name));
  return card;
}

export class CaseReel {
  readonly root = el('div', 'ca-reel');
  private readonly track = el('div', 'ca-track');
  private cards: HTMLElement[] = [];
  private x = 0;
  spinning = false;

  constructor() {
    const marker = el('div', 'ca-marker');
    this.root.append(this.track, marker, el('div', 'ca-fade left'), el('div', 'ca-fade right'));
  }

  /** The strip at rest with `centre` (an item index) under the marker, or a random one. */
  show(id: CaseId, centre: number | null = null): void {
    const items = Array.from({ length: LENGTH }, () => filler(id));
    if (centre !== null) items[START_AT] = centre;
    this.build(id, items);
    this.moveTo(this.offset(START_AT, 0.5));
    if (centre !== null) this.cards[START_AT]!.classList.add('won');
  }

  /** Run a fresh strip onto `winner` over `ms`; `tick` fires as each card crosses the marker. */
  async spin(id: CaseId, winner: number, ms: number, tick: () => void): Promise<void> {
    this.spinning = true;
    const items = Array.from({ length: LENGTH }, () => filler(id));
    // the card that was showing stays where it was, so the strip picks up from it
    const shown = this.cards[this.centreIndex()]?.dataset.item;
    if (shown !== undefined) items[START_AT] = Number(shown);
    items[WIN_AT] = winner;
    this.build(id, items);
    const from = this.offset(START_AT, 0.5);
    // stop somewhere across the winning card (never within a few pixels of its edges)
    const land = 0.12 + Math.random() * 0.76;
    const to = this.offset(WIN_AT, land);
    this.root.classList.add('running');
    let last = this.centreIndex();
    await tween(
      Math.max(300, ms - 320),
      (k) => {
        this.moveTo(from + (to - from) * k);
        const i = this.centreIndex();
        if (i !== last) {
          last = i;
          tick();
        }
      },
      // a long glide that crawls over the last few cards
      (t) => 1 - (1 - t) ** 4.2,
    );
    const settled = this.offset(WIN_AT, 0.5);
    await tween(260, (k) => this.moveTo(to + (settled - to) * k));
    this.root.classList.remove('running');
    this.cards[WIN_AT]!.classList.add('won');
    this.spinning = false;
  }

  private build(id: CaseId, items: number[]): void {
    const list = CASE_INFO[id].items;
    this.cards = items.map((i) => {
      const c = itemCard(list[i]!, 'ca-card');
      c.dataset.item = String(i);
      return c;
    });
    this.track.replaceChildren(...this.cards);
  }

  /** The strip's x that puts `at` (0-1 across card i) under the marker. */
  private offset(i: number, at: number): number {
    return WINDOW / 2 - (i * PITCH + at * CARD);
  }

  private centreIndex(): number {
    return Math.floor((WINDOW / 2 - this.x) / PITCH);
  }

  private moveTo(x: number): void {
    this.x = x;
    this.track.style.transform = `translateX(${x}px)`;
  }
}
