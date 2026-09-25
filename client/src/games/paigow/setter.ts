// Setting a Pai Gow hand: your seven cards large along the bottom of the screen, two places for
// the low hand on the left and five for the high hand on the right. Click a card to move it
// between them; the names of both hands show as they change, and a hand that would foul (the two
// cards beating the five) can't be set. House way (H) sets the cards the way the dealer would.

import type { PgCard } from '../../../../shared/src/games/paigow/rules.ts';
import { JOKER, fouls, highName, highScore, houseWay, lowName, lowScore, rankIndex } from '../../../../shared/src/games/paigow/rules.ts';
import { button, el } from '../../ui/kit.ts';
import { paintJoker } from './joker.ts';

const base = import.meta.env.BASE_URL;

/** A card face for the panel: the deck's art, or the painted joker. */
function face(card: PgCard): HTMLElement {
  if (card === JOKER) {
    const c = el('canvas', 'pg-face');
    c.width = 128;
    c.height = 179;
    paintJoker(c);
    return c;
  }
  const img = el('img', 'pg-face');
  img.src = `${base}assets/cards/${card}.svg`;
  img.alt = card;
  img.draggable = false;
  return img;
}

/** Suits in the deck's order, for sorting cards of one rank. */
const SUIT = 'shdc';

export class HandSetter {
  readonly root = el('div', 'pg-setter panel');
  private readonly title = el('div', 'pg-set-title');
  private readonly status = el('div', 'pg-set-status');
  private readonly lowRow = el('div', 'pg-row pg-low');
  private readonly highRow = el('div', 'pg-row pg-high');
  readonly houseBtn: HTMLButtonElement;
  readonly setBtn: HTMLButtonElement;
  private cards: PgCard[] = [];
  /** Indexes (into the seven as dealt) of the cards in the low hand, in the order picked. */
  private low: number[] = [];
  private faces = new Map<PgCard, HTMLElement>();

  constructor(private readonly onSet: (low: [number, number]) => void) {
    this.houseBtn = button('House way', () => this.houseWay(), { key: 'H', title: 'Set the hand the way the dealer sets theirs (H)' });
    this.setBtn = button('Set hand', () => this.submit(), { cls: 'primary', key: 'Space' });
    const lowBox = el('div', 'pg-group');
    lowBox.append(el('div', 'pg-group-label', 'Low hand · 2'), this.lowRow);
    const highBox = el('div', 'pg-group');
    highBox.append(el('div', 'pg-group-label', 'High hand · 5'), this.highRow);
    const rows = el('div', 'pg-rows');
    rows.append(lowBox, highBox);
    const acts = el('div', 'pg-set-acts');
    acts.append(this.houseBtn, this.setBtn);
    const head = el('div', 'pg-set-head');
    head.append(this.title, this.status);
    this.root.append(head, rows, acts);
    this.root.hidden = true;
  }

  /** Show seven cards to set, nothing in the low hand yet. */
  show(cards: PgCard[], title: string): void {
    const same = this.cards.join() === cards.join() && !this.root.hidden;
    this.title.textContent = title;
    if (same) return;
    this.cards = [...cards];
    this.low = [];
    this.faces.clear();
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
    this.cards = [];
    this.low = [];
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** Put the cards the way the house way sets them. */
  houseWay(): void {
    if (!this.open) return;
    const s = houseWay(this.cards);
    this.low = s.low.map((c) => this.cards.indexOf(c));
    this.render();
  }

  submit(): void {
    if (!this.open || !this.valid()) return;
    const [i, j] = this.low as [number, number];
    this.onSet(i < j ? [i, j] : [j, i]);
  }

  private valid(): boolean {
    return this.low.length === 2 && !fouls(this.setting());
  }

  private setting(): { high: PgCard[]; low: PgCard[] } {
    return { low: this.low.map((i) => this.cards[i]!), high: this.cards.filter((_, i) => !this.low.includes(i)) };
  }

  private toggle(i: number): void {
    if (this.low.includes(i)) this.low = this.low.filter((x) => x !== i);
    else if (this.low.length < 2) this.low.push(i);
    // a third pick replaces the first
    else this.low = [this.low[1]!, i];
    this.render();
  }

  private card(i: number): HTMLElement {
    const c = this.cards[i]!;
    let f = this.faces.get(c);
    if (!f) {
      f = face(c);
      this.faces.set(c, f);
    }
    const b = el('button', 'pg-card');
    b.type = 'button';
    b.title = this.low.includes(i) ? 'Move to the high hand' : 'Move to the low hand';
    b.append(f);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle(i);
    });
    return b;
  }

  private render(): void {
    const byRank = (a: number, b: number) => rankIndex(this.cards[b]!) - rankIndex(this.cards[a]!) || SUIT.indexOf(this.cards[a]![1]!) - SUIT.indexOf(this.cards[b]![1]!);
    const high = this.cards.map((_, i) => i).filter((i) => !this.low.includes(i)).sort(byRank);
    const low = [...this.low].sort(byRank);
    this.lowRow.replaceChildren(...low.map((i) => this.card(i)), ...Array.from({ length: 2 - low.length }, () => el('div', 'pg-slot')));
    this.highRow.replaceChildren(...high.map((i) => this.card(i)));
    const s = this.setting();
    if (this.low.length < 2) {
      this.status.textContent = this.low.length === 0 ? 'Click two cards for the low hand' : 'One more card for the low hand';
      this.status.className = 'pg-set-status';
    } else if (fouls(s)) {
      this.status.textContent = `${lowName(lowScore(s.low))} in front beats ${highName(highScore(s.high))}: the high hand must be the higher`;
      this.status.className = 'pg-set-status foul';
    } else {
      this.status.textContent = `High: ${highName(highScore(s.high))} · Low: ${lowName(lowScore(s.low))}`;
      this.status.className = 'pg-set-status ok';
    }
    this.setBtn.disabled = !this.valid();
  }
}
