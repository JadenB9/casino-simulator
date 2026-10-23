// Sic Bo's DOM pieces: the last-rolls board, the meters, the result board that stands over the
// shaker, the bet tooltip, the betting clock and the players with their chip colours. Elements,
// classes and textContent only (the page's CSP blocks inline style attributes; setting
// element.style from code is fine).

import { el } from '../../ui/kit.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { diceTotal, isTriple, sorted, describeRoll } from '../../../../shared/src/games/sicbo/rules.ts';
import { PIPS } from './art.ts';

/** A die face made of elements: ivory, with the one and the four in red. */
export function domDie(face: number, cls = ''): HTMLElement {
  const d = el('span', `sb-die f${face} ${cls}`.trim());
  for (const [x, y] of PIPS[face]!) {
    const p = el('span', 'sb-pip');
    p.style.left = `${x * 100}%`;
    p.style.top = `${y * 100}%`;
    d.append(p);
  }
  return d;
}

/** Small, big or a triple: the colour a roll is marked with on the boards. */
function rollKind(d: readonly number[]): 'small' | 'big' | 'triple' {
  if (isTriple(d)) return 'triple';
  return diceTotal(d) <= 10 ? 'small' : 'big';
}

/**
 * The last rolls, and under them the table's longer log in figures: how many came small, big or
 * a triple, odd or even, and how often each face has shown.
 */
export class History {
  readonly root = el('div', 'sb-history panel');
  private readonly row = el('div', 'sb-history-row');
  private readonly count = el('span', 'sb-history-count');
  private readonly tally = el('div', 'sb-tally');
  private shown = '';

  constructor() {
    const head = el('div', 'sb-history-head');
    head.append(el('span', 'label', 'Last rolls'), this.count);
    this.tally.title = 'Every roll is a fresh one: these say what came up, not what will.';
    this.root.append(head, this.row, this.tally);
  }

  /** The log, newest first (its first twenty are the server's last twenty). */
  set(rolls: readonly (readonly number[])[]): void {
    const key = rolls.map((d) => d.join('')).join(',');
    if (key === this.shown && this.row.childElementCount) return;
    this.shown = key;
    this.row.replaceChildren();
    this.tally.replaceChildren();
    this.tally.hidden = rolls.length === 0;
    this.count.textContent = rolls.length > 13 ? `${rolls.length} rolls` : '';
    if (rolls.length === 0) {
      this.row.append(el('span', 'sb-history-empty', 'No rolls yet'));
      return;
    }
    // the latest and two rows of six (five on a phone: the stylesheet hides the rest)
    rolls.slice(0, 13).forEach((d, i) => {
      const s = sorted(d);
      const kind = rollKind(s);
      const cell = el('span', `sb-roll ${kind}${i === 0 ? ' latest' : ''}`);
      const faces = el('span', 'sb-roll-dice');
      for (const f of s) faces.append(domDie(f));
      cell.append(faces, el('span', 'sb-roll-total', String(diceTotal(s))));
      cell.title = `${s.join(' · ')} = ${diceTotal(s)}, ${kind}`;
      this.row.append(cell);
    });
    // small, big and triples; odd and even as those bets see them (a triple is neither)
    const n = { small: 0, big: 0, triple: 0, odd: 0, even: 0 };
    const faces = [0, 0, 0, 0, 0, 0];
    for (const d of rolls) {
      const kind = rollKind(d);
      n[kind]++;
      if (kind !== 'triple') n[diceTotal(d) % 2 === 1 ? 'odd' : 'even']++;
      for (const f of d) faces[f - 1]!++;
    }
    const pair = (label: string, value: number, cls = '') => {
      const t = el('span', `sb-tally-pair ${cls}`.trim());
      t.append(el('span', 'label', label), el('span', 'sb-tally-n money', String(value)));
      return t;
    };
    const kinds = el('div', 'sb-tally-row');
    kinds.append(pair('Small', n.small, 'small'), pair('Big', n.big, 'big'), pair('Triple', n.triple, 'triple'), pair('Odd', n.odd), pair('Even', n.even));
    const shown = el('div', 'sb-tally-row');
    faces.forEach((c, i) => {
      const t = el('span', 'sb-tally-face');
      t.append(domDie(i + 1), el('span', 'sb-tally-n money', String(c)));
      t.title = `${i + 1} showed on ${c} of ${rolls.length * 3} dice`;
      shown.append(t);
    });
    this.tally.append(kinds, shown);
  }
}

export class Meters {
  readonly root = el('div', 'sb-meters panel');
  private readonly values: Record<'stack' | 'bet' | 'win', HTMLElement>;

  constructor() {
    const meter = (label: string) => {
      const box = el('div', 'sb-meter');
      const v = el('div', 'sb-meter-value money', '$0');
      box.append(el('div', 'label', label), v);
      this.root.append(box);
      return v;
    };
    this.values = { stack: meter('Stack'), bet: meter('On layout'), win: meter('Last win') };
  }

  set(m: { stack?: Cents; bet?: Cents; win?: Cents }): void {
    if (m.stack !== undefined) this.values.stack.textContent = formatMoney(m.stack);
    if (m.bet !== undefined) this.values.bet.textContent = formatMoney(m.bet);
    if (m.win !== undefined) this.values.win.textContent = formatMoney(m.win);
  }
}

/** The result over the shaker: the three dice, the total, small or big, and this player's net. */
export class Board {
  readonly root = el('div', 'sb-board panel');
  private readonly dice = el('div', 'sb-board-dice');
  private readonly total = el('div', 'sb-board-total');
  private readonly tag = el('div', 'sb-board-tag');
  private readonly detail = el('div', 'sb-board-detail');
  private readonly net = el('div', 'sb-board-net');

  constructor() {
    const words = el('div', 'sb-board-words');
    const head = el('div', 'sb-board-head');
    head.append(this.total, this.tag);
    words.append(head, this.detail, this.net);
    this.root.append(this.dice, words);
    this.root.hidden = true;
  }

  show(d: readonly number[]): void {
    const s = sorted(d);
    const r = describeRoll(s);
    this.dice.replaceChildren(...s.map((f) => domDie(f, 'big')));
    this.total.textContent = String(r.total);
    this.tag.textContent = r.tag;
    this.tag.className = `sb-board-tag ${rollKind(s)}`;
    this.detail.textContent = r.detail;
    this.net.textContent = '';
    this.net.className = 'sb-board-net';
    this.root.hidden = false;
  }

  setNet(text: string, kind: 'win' | 'quiet'): void {
    this.net.textContent = text;
    this.net.className = `sb-board-net ${kind}`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

export class Tip {
  readonly root = el('div', 'sb-tip panel');
  private shown = '';

  constructor() {
    this.root.hidden = true;
  }

  /**
   * Above and to the right of the pointer, clear of the chips it points at; for a touch
   * (`above`), straight over the finger. The lines are rebuilt only when they change.
   */
  show(lines: { text: string; cls?: string }[], x: number, y: number, above = false): void {
    const key = lines.map((l) => `${l.cls ?? ''}:${l.text}`).join('|');
    if (key !== this.shown) {
      this.shown = key;
      this.root.replaceChildren(...lines.map((l) => el('div', l.cls ?? '', l.text)));
    }
    this.root.hidden = false;
    const w = this.root.offsetWidth || 200;
    const h = this.root.offsetHeight || 60;
    const left = above ? x - w / 2 : x + 22 + w > innerWidth ? x - 22 - w : x + 22;
    const top = above ? y - h - 48 : y - 34 - h;
    this.root.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, left))}px`;
    this.root.style.top = `${Math.max(8, top)}px`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

const SVG = 'http://www.w3.org/2000/svg';

/** The shared betting countdown: a ring that empties, with the seconds in the middle. */
export class Clock {
  readonly root = el('div', 'sb-clock');
  private readonly left: SVGCircleElement;
  private readonly secs = el('div', 'sb-clock-secs');
  private readonly caption = el('div', 'sb-clock-caption');
  private readonly len = 2 * Math.PI * 21;

  constructor() {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    const track = document.createElementNS(SVG, 'circle');
    const left = document.createElementNS(SVG, 'circle');
    for (const c of [track, left]) {
      c.setAttribute('cx', '24');
      c.setAttribute('cy', '24');
      c.setAttribute('r', '21');
    }
    track.setAttribute('class', 'track');
    left.setAttribute('class', 'left');
    left.setAttribute('stroke-dasharray', String(this.len));
    svg.append(track, left);
    this.left = left;
    const ring = el('div', 'sb-clock-ring');
    ring.append(svg, this.secs);
    this.root.append(ring, this.caption);
    this.root.hidden = true;
  }

  set(msLeft: number, total: number, caption: string): void {
    const k = Math.max(0, Math.min(1, msLeft / total));
    this.left.setAttribute('stroke-dashoffset', String(this.len * (1 - k)));
    this.secs.textContent = String(Math.ceil(msLeft / 1000));
    this.caption.textContent = caption;
    this.root.classList.toggle('late', msLeft <= 5000);
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

export interface PlayerRow {
  seat: number;
  name: string;
  color: string;
  stack: Cents;
  you: boolean;
  status: string;
  statusKind?: 'win' | 'quiet' | 'ready';
}

export class Players {
  readonly root = el('div', 'sb-players panel');

  constructor() {
    this.root.hidden = true;
  }

  set(rows: PlayerRow[]): void {
    this.root.hidden = rows.length === 0;
    this.root.replaceChildren(el('div', 'label', 'At the table'));
    for (const r of rows) {
      const row = el('div', `sb-player${r.you ? ' you' : ''}`);
      const chip = el('span', 'sb-player-chip');
      chip.style.backgroundColor = r.color;
      row.append(
        chip,
        el('span', 'sb-player-name', r.you ? `${r.name} (you)` : r.name),
        el('span', `sb-player-status ${r.statusKind ?? ''}`, r.status),
        el('span', 'sb-player-stack money', formatMoney(r.stack)),
      );
      this.root.append(row);
    }
  }
}
