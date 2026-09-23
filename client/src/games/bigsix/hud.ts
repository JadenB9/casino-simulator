// Big Six's DOM pieces: the strip of recent stops, the meters, the result plaque beside the wheel,
// the spot tooltip, the betting clock and the players at the table. Elements, classes and
// textContent only (the page's CSP blocks inline style attributes).

import { el } from '../../ui/kit.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { type SymbolId, symbolAt, spotOf, paysLabel, callFor } from '../../../../shared/src/games/bigsix/rules.ts';
import { badgeCanvas } from './art.ts';

export class History {
  readonly root = el('div', 'bs-history panel');
  private readonly row = el('div', 'bs-history-row');
  private shown = '';

  constructor() {
    this.root.append(el('div', 'label', 'Last spins'), this.row);
  }

  set(stops: readonly number[]): void {
    const key = stops.slice(0, 20).join(',');
    if (key === this.shown && this.row.childElementCount) return;
    this.shown = key;
    this.row.replaceChildren();
    if (stops.length === 0) {
      this.row.append(el('span', 'bs-history-empty', 'No spins yet'));
      return;
    }
    stops.slice(0, 20).forEach((stop, i) => {
      const sym = symbolAt(stop);
      const b = badgeCanvas(sym, i === 0 ? 34 : 26);
      if (i === 0) b.classList.add('latest');
      b.title = callFor(sym);
      this.row.append(b);
    });
  }
}

export class Meters {
  readonly root = el('div', 'bs-meters panel');
  private readonly values: Record<'stack' | 'bet' | 'win', HTMLElement>;

  constructor() {
    const meter = (label: string) => {
      const box = el('div', 'bs-meter');
      const v = el('div', 'bs-meter-value money', '$0');
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

/** Beside the wheel when it stops: the symbol, "TWENTY DOLLARS", "PAYS 20 TO 1", then this player's net. */
export class Plaque {
  readonly root = el('div', 'bs-result panel');
  private readonly badge = el('div', 'bs-result-badge');
  private readonly call = el('div', 'bs-result-call');
  private readonly detail = el('div', 'bs-result-detail');
  private readonly net = el('div', 'bs-result-net');

  constructor() {
    const words = el('div', 'bs-result-words');
    words.append(this.call, this.detail, this.net);
    this.root.append(this.badge, words);
    this.root.hidden = true;
  }

  show(sym: SymbolId): void {
    this.badge.replaceChildren(badgeCanvas(sym, 56));
    this.call.textContent = callFor(sym).toUpperCase();
    this.detail.textContent = `PAYS ${paysLabel(spotOf(sym)!).toUpperCase()}`;
    this.net.textContent = '';
    this.net.className = 'bs-result-net';
    this.root.hidden = false;
  }

  setNet(text: string, kind: 'win' | 'quiet'): void {
    this.net.textContent = text;
    this.net.className = `bs-result-net ${kind}`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

export class Tooltip {
  readonly root = el('div', 'bs-tip panel');

  constructor() {
    this.root.hidden = true;
  }

  show(lines: { text: string; cls?: string }[], x: number, y: number): void {
    this.root.replaceChildren(...lines.map((l) => el('div', l.cls ?? '', l.text)));
    this.root.hidden = false;
    // above and to the right of the pointer, clear of the chips it is pointing at
    const w = this.root.offsetWidth || 200;
    const h = this.root.offsetHeight || 60;
    const left = x + 22 + w > innerWidth ? x - 22 - w : x + 22;
    this.root.style.left = `${Math.max(8, left)}px`;
    this.root.style.top = `${Math.max(8, y - 34 - h)}px`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

const SVG = 'http://www.w3.org/2000/svg';

/** The shared betting countdown: a ring that empties, with the seconds in the middle. */
export class Clock {
  readonly root = el('div', 'bs-clock');
  private readonly left: SVGCircleElement;
  private readonly secs = el('div', 'bs-clock-secs');
  private readonly caption = el('div', 'bs-clock-caption');
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
    const ring = el('div', 'bs-clock-ring');
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
  readonly root = el('div', 'bs-players panel');

  constructor() {
    this.root.hidden = true;
  }

  set(rows: PlayerRow[]): void {
    this.root.hidden = rows.length === 0;
    this.root.replaceChildren(el('div', 'label', 'At the wheel'));
    for (const r of rows) {
      const row = el('div', `bs-player${r.you ? ' you' : ''}`);
      const chip = el('span', 'bs-player-chip');
      chip.style.backgroundColor = r.color;
      const name = el('span', 'bs-player-name', r.you ? `${r.name} (you)` : r.name);
      const stack = el('span', 'bs-player-stack money', formatMoney(r.stack));
      const status = el('span', `bs-player-status ${r.statusKind ?? ''}`, r.status);
      row.append(chip, name, status, stack);
      this.root.append(row);
    }
  }
}
