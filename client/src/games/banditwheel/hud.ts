// The Bandit Wheel's DOM: the betting panel, laid out like Rust's own betting terminal (the time to
// the next spin, the five painted squares, your winnings), the strip of recent results, the list
// of players at the wheel and the name tags over their terminals. Elements, classes and
// textContent only (the page's CSP blocks inline style attributes).

import { el, button } from '../../ui/kit.ts';
import { formatMoney, type Cents, type ChipSpec } from '../../../../shared/src/money.ts';
import { NUMBERS, type WheelNumber, numberAt } from '../../../../shared/src/games/banditwheel/rules.ts';
import { chipTrayCanvases } from '../../table/chips.ts';
import { squareCanvas } from './art.ts';

const SVG = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** The (i) in Rust's info box. */
function infoIcon(): SVGSVGElement {
  const s = svg('svg', { viewBox: '0 0 24 24', class: 'bw-info-icon', 'aria-hidden': 'true' }) as SVGSVGElement;
  s.append(svg('circle', { cx: '12', cy: '12', r: '11' }), svg('rect', { x: '10.6', y: '10', width: '2.8', height: '8', rx: '0.6' }), svg('circle', { cx: '12', cy: '6.6', r: '1.7' }));
  return s;
}

export interface PanelHandlers {
  pick(n: WheelNumber): void;
  undo(): void;
  clear(): void;
  rebet(): void;
  double(): void;
  spin(): void;
}

/** What the chip picker holds: a denomination, or Max. */
export type Pick = { kind: 'chip'; spec: ChipSpec } | { kind: 'max' };

export class Panel {
  readonly root = el('section', 'bw-panel');
  readonly slots = new Map<WheelNumber, { btn: HTMLButtonElement; mine: HTMLElement; all: HTMLElement }>();
  private readonly title = el('span', 'bw-title', 'Bandit Wheel');
  private readonly seatNote = el('span', 'bw-seat');
  private readonly timeLabel = el('div', 'bw-time-label', 'Time until next spin');
  private readonly timeNote = el('div', 'bw-time-note');
  private readonly secs = el('div', 'bw-secs-num', '–');
  private readonly ring: SVGCircleElement;
  private readonly ringLen = 2 * Math.PI * 26;
  private readonly hint = el('div', 'bw-hint');
  private readonly chipBtns: { btn: HTMLButtonElement; pick: Pick }[] = [];
  readonly undoBtn: HTMLButtonElement;
  readonly clearBtn: HTMLButtonElement;
  readonly rebetBtn: HTMLButtonElement;
  readonly doubleBtn: HTMLButtonElement;
  readonly spinBtn: HTMLButtonElement;
  private readonly winValue = el('div', 'bw-win-value', '$0');
  private readonly winNote = el('div', 'bw-win-note', 'Wins come back to your stack with your bet.');
  private readonly stack = el('div', 'bw-meter-value money', '$0');
  private readonly down = el('div', 'bw-meter-value money', '$0');
  pick: Pick;
  private defaultHint = '';

  constructor(private readonly h: PanelHandlers) {
    this.root.setAttribute('aria-label', 'Bandit Wheel betting terminal');
    const head = el('header', 'bw-head');
    head.append(this.title, this.seatNote);

    const info = el('div', 'bw-box bw-info');
    info.append(infoIcon(), el('span', '', 'Put chips on a number. If the wheel stops on it you win that number times your bet, and your bet back.'));

    const time = el('div', 'bw-row');
    const words = el('div', 'bw-box bw-time');
    words.append(this.timeLabel, this.timeNote);
    const secsBox = el('div', 'bw-box bw-secs');
    const ringSvg = svg('svg', { viewBox: '0 0 60 60', 'aria-hidden': 'true' });
    const track = svg('circle', { cx: '30', cy: '30', r: '26', class: 'track' });
    this.ring = svg('circle', { cx: '30', cy: '30', r: '26', class: 'left', 'stroke-dasharray': String(this.ringLen) }) as SVGCircleElement;
    ringSvg.append(track, this.ring);
    secsBox.append(ringSvg, this.secs);
    time.append(words, secsBox);

    const slotBox = el('div', 'bw-box bw-slots');
    const row = el('div', 'bw-slot-row');
    NUMBERS.forEach((n, k) => {
      const btn = el('button', 'bw-slot');
      btn.type = 'button';
      btn.dataset.n = String(n);
      const face = squareCanvas(n, 112, 11 + k);
      face.className = 'bw-slot-face';
      const mine = el('span', 'bw-slot-mine money');
      const all = el('span', 'bw-slot-all money');
      btn.append(face, mine, all);
      btn.addEventListener('click', () => h.pick(n));
      btn.addEventListener('pointerenter', () => this.showHint(n));
      btn.addEventListener('focus', () => this.showHint(n));
      btn.addEventListener('pointerleave', () => this.showHint(null));
      btn.addEventListener('blur', () => this.showHint(null));
      row.append(btn);
      this.slots.set(n, { btn, mine, all });
    });
    slotBox.append(row, this.hint);

    const chips = el('div', 'bw-box bw-chips');
    const canvases = chipTrayCanvases();
    for (const { spec, canvas } of canvases) {
      const btn = el('button', 'bw-chip');
      btn.type = 'button';
      canvas.className = 'bw-chip-face';
      btn.append(canvas);
      const pick: Pick = { kind: 'chip', spec };
      btn.addEventListener('click', () => this.select(pick));
      this.chipBtns.push({ btn, pick });
      chips.append(btn);
    }
    const maxBtn = el('button', 'bw-chip bw-max', 'Max');
    maxBtn.type = 'button';
    const maxPick: Pick = { kind: 'max' };
    maxBtn.addEventListener('click', () => this.select(maxPick));
    this.chipBtns.push({ btn: maxBtn, pick: maxPick });
    chips.append(maxBtn);
    this.pick = this.chipBtns[1]!.pick;

    const acts = el('div', 'bw-acts');
    this.undoBtn = button('Undo', () => h.undo(), { title: 'Take back your last chips (Backspace)' });
    this.clearBtn = button('Clear', () => h.clear(), { title: 'Take back all your chips (X)' });
    this.rebetBtn = button('Rebet', () => h.rebet(), { title: 'The same bets as last spin (R)' });
    this.doubleBtn = button('×2', () => h.double(), { title: 'Double your chips, or last spin’s (Shift+R)' });
    this.spinBtn = button('Spin now', () => h.spin(), { cls: 'bw-go', title: 'Spin without waiting for the clock (Space)' });
    this.spinBtn.hidden = true;
    acts.append(this.undoBtn, this.clearBtn, this.rebetBtn, this.doubleBtn, this.spinBtn);

    const bottom = el('div', 'bw-row');
    const win = el('div', 'bw-box bw-win');
    win.append(el('div', 'bw-win-label', 'Winnings'), this.winValue, this.winNote);
    const meters = el('div', 'bw-box bw-meters');
    const meter = (label: string, v: HTMLElement) => {
      const m = el('div', 'bw-meter');
      m.append(el('div', 'bw-meter-label', label), v);
      return m;
    };
    meters.append(meter('Stack', this.stack), meter('Down', this.down));
    bottom.append(win, meters);

    this.root.append(head, info, time, slotBox, chips, acts, bottom);
    this.select(this.pick);
  }

  /** Which chips the table takes: none above its per-number maximum. */
  setLimits(max: Cents): void {
    for (const { btn, pick } of this.chipBtns) if (pick.kind === 'chip') btn.hidden = pick.spec.value > max;
    if (this.pick.kind === 'chip' && this.pick.spec.value > max) this.select(this.chipBtns.find((c) => !c.btn.hidden)!.pick);
    this.limitMax = max;
    this.showHint(null);
  }

  private limitMax: Cents = 0;

  select(pick: Pick): void {
    this.pick = pick;
    for (const { btn, pick: p } of this.chipBtns) btn.setAttribute('aria-pressed', String(p === pick));
    this.showHint(null);
  }

  /** Keys 1..n pick chips (the ones this table shows), M picks Max. */
  key(e: KeyboardEvent): boolean {
    if (e.key === 'm' || e.key === 'M') {
      this.select(this.chipBtns[this.chipBtns.length - 1]!.pick);
      return true;
    }
    const n = Number(e.key);
    const shown = this.chipBtns.filter((c) => c.pick.kind === 'chip' && !c.btn.hidden);
    if (Number.isInteger(n) && n >= 1 && n <= shown.length) {
      this.select(shown[n - 1]!.pick);
      return true;
    }
    return false;
  }

  /** The line under the squares: what the hovered one pays, or what a click will put down. */
  private hints: Record<number, string> = {};
  setHints(h: Record<number, string>): void {
    this.hints = h;
  }

  showHint(n: WheelNumber | null): void {
    if (n !== null && this.hints[n]) {
      this.hint.textContent = this.hints[n]!;
      return;
    }
    const lim = this.limitMax ? `up to ${formatMoney(this.limitMax)} a number` : '';
    this.defaultHint = this.pick.kind === 'max' ? `Max: the table's ${formatMoney(this.limitMax)} or your stack, whichever is less` : `${formatMoney(this.pick.spec.value)} chip${lim ? ` · ${lim}` : ''}`;
    this.hint.textContent = this.defaultHint;
  }

  setSeat(text: string): void {
    this.seatNote.textContent = text;
  }

  private timeKey = '';

  /** The time box: written only when something in it changes (it is asked every frame). */
  setTime(label: string, note: string, secs: string, k: number, late: boolean): void {
    const offset = (this.ringLen * (1 - Math.max(0, Math.min(1, k)))).toFixed(1);
    const key = `${label}|${note}|${secs}|${offset}|${late}`;
    if (key === this.timeKey) return;
    this.timeKey = key;
    this.timeLabel.textContent = label;
    this.timeNote.textContent = note;
    this.secs.textContent = secs;
    this.ring.setAttribute('stroke-dashoffset', offset);
    this.root.classList.toggle('late', late);
  }

  setSlot(n: WheelNumber, mine: Cents, all: Cents): void {
    const s = this.slots.get(n)!;
    s.mine.textContent = mine > 0 ? formatMoney(mine) : '';
    s.all.textContent = all > mine ? `all ${formatMoney(all)}` : '';
    s.btn.classList.toggle('has', mine > 0);
  }

  setOpen(open: boolean): void {
    this.root.classList.toggle('closed', !open);
    for (const { btn } of this.slots.values()) btn.disabled = !open;
  }

  /** Light the number that came up on the panel's squares (null: none). */
  setWinner(n: WheelNumber | null): void {
    for (const [k, { btn }] of this.slots) btn.classList.toggle('won', k === n);
  }

  setTipPicks(on: boolean): void {
    for (const n of [1, 3, 5] as WheelNumber[]) this.slots.get(n)!.btn.classList.toggle('tip-pick', on);
  }

  setWin(value: string, note: string, kind: 'win' | 'quiet'): void {
    this.winValue.textContent = value;
    this.winValue.className = `bw-win-value ${kind}`;
    this.winNote.textContent = note;
  }

  setMeters(stack: Cents | undefined, down: Cents | undefined): void {
    if (stack !== undefined) this.stack.textContent = formatMoney(stack);
    if (down !== undefined) this.down.textContent = formatMoney(down);
  }
}

/** The strip of recent results, newest first. */
export class History {
  readonly root = el('div', 'bw-history');
  private readonly row = el('div', 'bw-history-row');
  private shown = '';

  constructor() {
    this.root.append(el('div', 'bw-history-label', 'Last spins'), this.row);
  }

  set(slots: readonly number[]): void {
    const key = slots.join(',');
    if (key === this.shown && this.row.childElementCount) return;
    this.shown = key;
    this.row.replaceChildren();
    if (slots.length === 0) {
      this.row.append(el('span', 'bw-history-empty', 'No spins yet'));
      return;
    }
    slots.slice(0, 24).forEach((slot, i) => {
      const n = numberAt(slot);
      const c = squareCanvas(n, i === 0 ? 64 : 48, slot + 3);
      c.className = i === 0 ? 'bw-hist latest' : 'bw-hist';
      c.title = String(n);
      this.row.append(c);
    });
  }
}

export interface PlayerRow {
  seat: number;
  name: string;
  stack: Cents;
  you: boolean;
  away: boolean;
  bets: Partial<Record<WheelNumber, Cents>>;
  /** After a spin: what the round came to (null before one, or for a seat that had nothing down). */
  net: Cents | null;
}

/** Everyone at the wheel: name, what they have down on each number, their stack; after a spin, how they did. */
export class Players {
  readonly root = el('div', 'bw-players');

  constructor() {
    this.root.hidden = true;
  }

  set(rows: PlayerRow[]): void {
    this.root.hidden = rows.length === 0;
    const head = el('div', 'bw-players-label', 'At the wheel');
    const list: HTMLElement[] = [head];
    for (const r of rows) {
      const row = el('div', `bw-player${r.you ? ' you' : ''}${r.away ? ' away' : ''}`);
      const name = el('span', 'bw-player-name', r.you ? `${r.name} (you)` : r.name);
      const bets = el('span', 'bw-player-bets');
      for (const n of NUMBERS) {
        const a = r.bets[n];
        if (!a) continue;
        const tag = el('span', `bw-bet-tag n${n}`);
        tag.append(el('b', '', String(n)), document.createTextNode(formatMoney(a)));
        bets.append(tag);
      }
      let status = '';
      let cls = 'bw-player-status';
      if (r.away) status = 'away';
      else if (r.net !== null) {
        status = r.net > 0 ? `+${formatMoney(r.net)}` : r.net < 0 ? `−${formatMoney(-r.net)}` : 'even';
        cls += r.net > 0 ? ' win' : ' quiet';
      }
      row.append(name, bets, el('span', cls, status), el('span', 'bw-player-stack money', formatMoney(r.stack)));
      list.push(row);
    }
    this.root.replaceChildren(...list);
  }
}

/** The tag over an occupied terminal: who sits there and what they have down (or won). */
export class TerminalTag {
  readonly root = el('div', 'bw-tag');
  private readonly name = el('div', 'bw-tag-name');
  private readonly note = el('div', 'bw-tag-note money');

  constructor() {
    this.root.append(this.name, this.note);
  }

  set(name: string, note: string, kind: 'down' | 'win' | 'quiet' | '', you: boolean): void {
    this.name.textContent = name;
    this.note.textContent = note;
    this.note.className = `bw-tag-note money ${kind}`;
    this.root.classList.toggle('you', you);
  }
}
