// Roulette's DOM pieces: the last-numbers strip, the meters, the result plaque that stands over
// the wheel, the bet tooltip, the betting clock and the list of players and their chip colours.
// Elements, classes and textContent only (the page's CSP blocks inline style attributes).

import { el } from '../../ui/kit.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { colorOf, pocketLabel, describePocket, type Variant } from '../../../../shared/src/games/roulette/rules.ts';
import { wheelStats, shares } from './stats.ts';

/**
 * The last twenty numbers, and under them the board's figures from the table's longer log: how
 * red, black and the zeros have split, and the hot and cold numbers.
 */
export class History {
  readonly root = el('div', 'rl-history panel');
  private readonly row = el('div', 'rl-history-row');
  private readonly count = el('span', 'rl-history-count');
  private readonly stats = el('div', 'rl-stats');
  private readonly split = el('div', 'rl-split');
  private readonly hotcold = el('div', 'rl-hotcold');
  private shown = '';

  constructor(private readonly variant: Variant) {
    const head = el('div', 'rl-history-head');
    head.append(el('span', 'label', 'Last numbers'), this.count);
    this.stats.append(this.split, this.hotcold);
    this.stats.title = 'Every spin is a fresh draw: these say what came up, not what will.';
    this.root.append(head, this.row, this.stats);
  }

  /** The log, newest first (its first twenty are the server's last twenty). */
  set(log: readonly number[]): void {
    const key = log.join(',');
    if (key === this.shown && this.row.childElementCount) return;
    this.shown = key;
    this.row.replaceChildren();
    this.stats.hidden = log.length === 0;
    this.count.textContent = log.length > 20 ? `${log.length} spins` : '';
    if (log.length === 0) {
      this.row.append(el('span', 'rl-history-empty', 'No spins yet'));
      return;
    }
    log.slice(0, 20).forEach((p, i) => {
      const t = el('span', `rl-num ${colorOf(p)}${i === 0 ? ' latest' : ''}`, pocketLabel(p));
      t.title = describePocket(p).call;
      this.row.append(t);
    });

    const s = wheelStats(this.variant, log);
    const pct = shares(s);
    this.split.replaceChildren();
    for (const c of ['red', 'green', 'black'] as const) {
      if (s[c] === 0) continue;
      const seg = el('span', `rl-split-${c}`, `${pct[c]}%`);
      seg.style.flexGrow = String(s[c]);
      this.split.append(seg);
    }
    this.split.setAttribute('role', 'img');
    this.split.setAttribute('aria-label', `Over the last ${s.spins} spins: red ${pct.red}%, black ${pct.black}%, zero ${pct.green}%`);
    const tag = (n: number, count: number | null) => {
      const t = el('span', `rl-num small ${colorOf(n)}`, pocketLabel(n));
      if (count !== null) t.append(el('sub', '', `×${count}`));
      return t;
    };
    this.hotcold.replaceChildren(el('span', 'label', 'Hot'));
    if (s.hot.length) this.hotcold.append(...s.hot.map((h) => tag(h.n, h.count)));
    else this.hotcold.append(el('span', 'rl-hotcold-none', 'no repeats yet'));
    // cold says something once every number has had a spin's chance; until then, how many are still to show
    if (s.spins >= s.pockets) this.hotcold.append(el('span', 'label', 'Cold'), ...s.cold.map((c) => tag(c.n, null)));
    else this.hotcold.append(el('span', 'label', 'Not seen'), el('span', 'rl-hotcold-none', `${s.unseen} of ${s.pockets}`));
  }
}

export class Meters {
  readonly root = el('div', 'rl-meters panel');
  /** A row under the meters for the view's own buttons (the racetrack's). */
  readonly tools = el('div', 'rl-tools');
  private readonly values: Record<'stack' | 'bet' | 'win', HTMLElement>;

  constructor() {
    const row = el('div', 'rl-meter-row');
    const meter = (label: string) => {
      const box = el('div', 'rl-meter');
      const v = el('div', 'rl-meter-value money', '$0');
      box.append(el('div', 'label', label), v);
      row.append(box);
      return v;
    };
    this.values = { stack: meter('Stack'), bet: meter('On layout'), win: meter('Last win') };
    this.root.append(row, this.tools);
  }

  set(m: { stack?: Cents; bet?: Cents; win?: Cents }): void {
    if (m.stack !== undefined) this.values.stack.textContent = formatMoney(m.stack);
    if (m.bet !== undefined) this.values.bet.textContent = formatMoney(m.bet);
    if (m.win !== undefined) this.values.win.textContent = formatMoney(m.win);
  }
}

/** "17 BLACK", then "ODD · 1-18 · 2nd 12 · Column 2", then this player's net line. */
export class Plaque {
  readonly root = el('div', 'rl-result panel');
  private readonly badge = el('div', 'rl-result-badge');
  private readonly call = el('div', 'rl-result-call');
  private readonly detail = el('div', 'rl-result-detail');
  private readonly net = el('div', 'rl-result-net');

  constructor() {
    const words = el('div', 'rl-result-words');
    words.append(this.call, this.detail, this.net);
    this.root.append(this.badge, words);
    this.root.hidden = true;
  }

  show(pocket: number): void {
    const d = describePocket(pocket);
    this.badge.className = `rl-result-badge ${d.color}`;
    this.badge.textContent = pocketLabel(pocket);
    this.call.textContent = d.call;
    this.detail.textContent = d.detail;
    this.net.textContent = '';
    this.net.className = 'rl-result-net';
    this.root.hidden = false;
  }

  setNet(text: string, kind: 'win' | 'quiet'): void {
    this.net.textContent = text;
    this.net.className = `rl-result-net ${kind}`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

export class Tip {
  readonly root = el('div', 'rl-tip panel');
  private shown = '';

  constructor() {
    this.root.hidden = true;
  }

  /**
   * Above and to the right of the pointer, clear of the chips it points at; for a touch
   * (`above`), straight over the finger, where the hand doesn't cover it. The lines are rebuilt
   * only when they change, so following the pointer only moves the card.
   */
  show(lines: { text: string; cls?: string }[], x: number, y: number, above = false): void {
    const key = lines.map((l) => `${l.cls ?? ''}:${l.text}`).join('|');
    if (key !== this.shown) {
      this.shown = key;
      this.root.replaceChildren(...lines.map((l) => el('div', l.cls ?? '', l.text)));
    }
    this.root.hidden = false;
    this.move(x, y, above);
  }

  move(x: number, y: number, above = false): void {
    // keep it on screen
    const w = this.root.offsetWidth || 180;
    const h = this.root.offsetHeight || 40;
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
  readonly root = el('div', 'rl-clock');
  private readonly left: SVGCircleElement;
  private readonly secs = el('div', 'rl-clock-secs');
  private readonly caption = el('div', 'rl-clock-caption');
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
    const ring = el('div', 'rl-clock-ring');
    ring.append(svg, this.secs);
    this.root.append(ring, this.caption);
    this.root.hidden = true;
  }

  set(msLeft: number, total: number, caption: string): void {
    const k = Math.max(0, Math.min(1, msLeft / total));
    this.left.setAttribute('stroke-dashoffset', String(this.len * (1 - k)));
    this.secs.textContent = String(Math.ceil(msLeft / 1000));
    this.caption.textContent = caption;
    this.root.classList.toggle('late', msLeft <= 3000);
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
  readonly root = el('div', 'rl-players panel');

  constructor() {
    this.root.hidden = true;
  }

  set(rows: PlayerRow[]): void {
    this.root.hidden = rows.length === 0;
    this.root.replaceChildren(el('div', 'label', 'At the wheel'));
    for (const r of rows) {
      const row = el('div', `rl-player${r.you ? ' you' : ''}`);
      const chip = el('span', 'rl-player-chip');
      chip.style.backgroundColor = r.color;
      const name = el('span', 'rl-player-name', r.you ? `${r.name} (you)` : r.name);
      const stack = el('span', 'rl-player-stack money', formatMoney(r.stack));
      const status = el('span', `rl-player-status ${r.statusKind ?? ''}`, r.status);
      row.append(chip, name, status, stack);
      this.root.append(row);
    }
  }
}
