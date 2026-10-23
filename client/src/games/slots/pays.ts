// The Pays screen (I): the pay table, the rules, the published PAR figures and the reel strips,
// all generated from the machine's own data, the same tables the server scores with. The sheet
// stands just over the deck and holds the keyboard while it's up (Esc or I closes it); the pay
// table reads in credits, as the glass prints it, or in money at the bet on the deck, with the
// coins you're betting picked out.

import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { NEON, SEVENS, WILD, WILD_MULTIPLIER, type MachineId, type NeonSymbol } from '../../../../shared/src/games/slots/machines.ts';
import { el, button } from '../../ui/kit.ts';
import { holdKeyboard, isTyping } from '../../ui/keyboard.ts';
import { drawNeonSymbol, drawStepperSymbol, STRIP_CREAM, SCREEN_NIGHT } from './symbols.ts';
import { lineColor } from './glass.ts';

/** The bet on the deck, for the sheet's money column. */
export interface PaysBet {
  coins: number;
  denom: Cents;
}

export interface PaysSheet {
  close(): void;
  /** The deck's bet changed while the sheet is up. */
  bet(b: PaysBet): void;
}

/** A pay in credits, and how it turns into money at the deck's bet. */
interface PayCell {
  td: HTMLElement;
  usd: HTMLElement;
  credits: number;
  /** 'coins': already for that many coins (a stepper column), worth credits x the coin; 'line': per credit on a line. */
  per: 'coins' | 'line';
  /** The stepper column it sits in (1-3), to pick out the coins bet. */
  column?: number;
}

const UNIT_KEY = 'casino.slots.paysIn';

function savedUnit(): 'credits' | 'money' {
  try {
    return localStorage.getItem(UNIT_KEY) === 'credits' ? 'credits' : 'money';
  } catch {
    return 'money';
  }
}

const n = (x: number) => x.toLocaleString('en-US');

/**
 * The pay table's money: each cell shows its credits and (in money) what they're worth at the
 * bet, the coins column picked out. Built with the cells; `bet()` keeps it current.
 */
export class PayCells {
  private readonly cells: PayCell[] = [];
  private readonly heads: { th: HTMLElement; column: number }[] = [];
  private readonly tables: HTMLElement[] = [];
  private readonly nowLine = el('div', 'slots-pays-now');
  private unit = savedUnit();
  private last: PaysBet | null = null;
  readonly bar = el('div', 'slots-pays-bet');
  private readonly unitBtns: Record<'credits' | 'money', HTMLButtonElement>;

  constructor(private readonly lines: number, private readonly stepper: boolean) {
    const seg = el('div', 'slots-pays-unit');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Show pays');
    this.unitBtns = {
      credits: button('Credits', () => this.setUnit('credits')),
      money: button('At your bet', () => this.setUnit('money')),
    };
    seg.append(this.unitBtns.credits, this.unitBtns.money);
    this.bar.append(this.nowLine, seg);
  }

  /** A cell with `credits` in it. */
  cell(credits: number, per: 'coins' | 'line', column?: number): HTMLTableCellElement {
    const td = el('td');
    const cr = el('span', 'cr', n(credits));
    const usd = el('span', 'usd');
    td.append(cr, usd);
    this.cells.push({ td, usd, credits, per, column });
    return td;
  }

  /** A stepper's "2 coins" heading, picked out with its column. */
  head(th: HTMLElement, column: number): void {
    this.heads.push({ th, column });
  }

  table(t: HTMLElement): void {
    t.classList.add('pays');
    this.tables.push(t);
    this.paintUnit();
  }

  bet(b: PaysBet): void {
    this.last = b;
    const total = this.stepper ? b.coins * b.denom : b.coins * b.denom * this.lines;
    this.nowLine.replaceChildren(
      'Your bet ',
      el('b', '', this.stepper ? `${b.coins} coin${b.coins > 1 ? 's' : ''} × ${formatMoney(b.denom)}` : `${b.coins} per line × ${this.lines} lines × ${formatMoney(b.denom)}`),
      ` = ${formatMoney(total)}`,
    );
    for (const c of this.cells) {
      c.usd.textContent = formatMoney(c.per === 'coins' ? c.credits * b.denom : c.credits * b.coins * b.denom);
      c.td.classList.toggle('on', c.column === b.coins);
    }
    for (const h of this.heads) h.th.classList.toggle('on', h.column === b.coins);
  }

  private setUnit(u: 'credits' | 'money'): void {
    this.unit = u;
    try {
      localStorage.setItem(UNIT_KEY, u);
    } catch {
      /* kept for this sheet only */
    }
    this.paintUnit();
  }

  private paintUnit(): void {
    for (const t of this.tables) t.classList.toggle('in-money', this.unit === 'money');
    for (const [u, b] of Object.entries(this.unitBtns)) b.setAttribute('aria-pressed', String(u === this.unit));
    if (this.last) this.bet(this.last);
  }
}

let sheetSeq = 0;

/**
 * The sheet's frame: the panel, its heading and Close, standing just over the deck and holding
 * the keyboard (Esc and I close it; Tab stays inside). Focus goes in, and back where it was after.
 */
export function paysFrame(ui: HTMLElement, deck: HTMLElement, title: string, onClose: () => void): { box: HTMLElement; close: () => void } {
  const box = el('div', 'slots-pays panel');
  const id = `slots-pays-title-${++sheetSeq}`;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', id);
  box.tabIndex = -1;
  const before = document.activeElement as HTMLElement | null;
  let release = () => {};
  const place = () => {
    const d = deck.getBoundingClientRect();
    box.style.setProperty('--pays-bottom', `${Math.max(8, Math.round(innerHeight - d.top + 10))}px`);
  };
  const onKey = (e: KeyboardEvent) => {
    // I closes it as it opened it (the table doesn't hear keys while a sheet is up)
    if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e)) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const close = () => {
    if (!box.isConnected) return;
    release();
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', place);
    box.remove();
    if (before?.isConnected && before !== document.body) before.focus({ preventScroll: true });
    onClose();
  };
  const head = el('div', 'slots-pays-head');
  const h2 = el('h2', '', title);
  h2.id = id;
  head.append(h2, button('Close', close, { key: 'I', cls: 'ghost' }));
  box.append(head);
  ui.append(box);
  place();
  addEventListener('resize', place);
  addEventListener('keydown', onKey, true);
  release = holdKeyboard(box, close);
  box.focus({ preventScroll: true });
  return { box, close };
}

function icon(machine: MachineId, sym: string, w = 54, h = 34): HTMLCanvasElement {
  const c = el('canvas', 'slots-icon');
  const r = Math.min(2, globalThis.devicePixelRatio || 1);
  c.width = w * r;
  c.height = h * r;
  const g = c.getContext('2d')!;
  g.scale(r, r);
  g.fillStyle = machine === 'neon' ? SCREEN_NIGHT : STRIP_CREAM;
  g.fillRect(0, 0, w, h);
  g.translate(w / 2, h / 2);
  if (machine === 'neon') drawNeonSymbol(g, sym as NeonSymbol, w * 0.9, h * 0.95);
  else if (sym === 'ANY' || sym === 'BLANK') {
    g.fillStyle = '#6b5a3a';
    g.font = `600 ${h * 0.4}px 'Barlow Condensed', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(sym, 0, 1);
  } else drawStepperSymbol(g, sym, w * 0.86, h * 0.9);
  return c;
}

/** A table: a heading row, then rows of text, pictures or ready cells. */
export function table(head: (string | HTMLElement)[], rows: (string | HTMLElement[] | HTMLTableCellElement)[][]): HTMLTableElement {
  const t = el('table', 'slots-table');
  const tr = el('tr');
  for (const h of head) tr.append(typeof h === 'string' ? el('th', '', h) : h);
  t.append(tr);
  for (const r of rows) {
    const row = el('tr');
    for (const cell of r) {
      if (cell instanceof HTMLTableCellElement) {
        row.append(cell);
        continue;
      }
      const td = el('td');
      if (typeof cell === 'string') td.textContent = cell;
      else td.append(...cell);
      row.append(td);
    }
    t.append(row);
  }
  return t;
}

/** The stepper pay table's head: the line, then 1, 2 and 3 coins (picked out with the bet). */
export function coinHeads(cells: PayCells): (string | HTMLElement)[] {
  return ['', 'Line', ...[1, 2, 3].map((k) => {
    const th = el('th', '', `${k} coin${k > 1 ? 's' : ''}`);
    cells.head(th, k);
    return th;
  })];
}

const CELLS: Record<string, string[]> = {
  three7: ['7', '7', '7'], three3B: ['3B', '3B', '3B'], three2B: ['2B', '2B', '2B'], three1B: ['1B', '1B', '1B'],
  anyBar: ['BAR', 'BAR', 'BAR'], threeCH: ['CH', 'CH', 'CH'], twoCH: ['CH', 'CH', 'ANY'], oneCH: ['CH', 'ANY', 'ANY'],
  threeWX: ['WX', 'WX', 'WX'], twoWX: ['WX', 'WX', 'BLANK'], oneWX: ['WX', 'ANY', 'ANY'],
};
const NAMES: Record<string, string> = { '7': 'Seven', '3B': 'Triple bar', '2B': 'Double bar', '1B': 'Single bar', CH: 'Cherry', BL: 'blank', WX: '5X wild' };

function lineDiagram(line: number): HTMLCanvasElement {
  const c = el('canvas', 'slots-linemap');
  c.width = 60;
  c.height = 36;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c0b1d';
  g.fillRect(0, 0, 60, 36);
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) g.strokeRect(r * 12 + 0.5, k * 12 + 0.5, 11, 11);
  g.strokeStyle = lineColor(line);
  g.lineWidth = 2.5;
  g.beginPath();
  NEON.lineRows[line]!.forEach((row, r) => g.lineTo(r * 12 + 6, row * 12 + 6));
  g.stroke();
  return c;
}

export function openPays(ui: HTMLElement, deck: HTMLElement, machine: MachineId, bet: PaysBet, onClose: () => void): PaysSheet {
  const name = machine === 'sevens' ? SEVENS.name : machine === 'wild' ? WILD.name : NEON.name;
  const { box, close } = paysFrame(ui, deck, `${name} · Pays`, onClose);
  const video = machine === 'neon';
  const cells = new PayCells(video ? NEON.lines : 1, !video);
  box.append(cells.bar);

  if (video) {
    box.append(el('p', 'slots-note', 'Pays per credit bet on a line, for 3, 4 or 5 of a kind on adjacent reels from the left. All 20 lines play on every spin; line wins add up.'));
    const rows = Object.entries(NEON.linePays).map(([sym, p]) => [[icon('neon', sym)], sym === '10' ? 'Ten' : sym.charAt(0) + sym.slice(1).toLowerCase(), cells.cell(p![2], 'line'), cells.cell(p![1], 'line'), cells.cell(p![0], 'line')]);
    const t = table(['', 'Symbol', '5', '4', '3'], rows);
    cells.table(t);
    box.append(t);
    const ul = el('ul', 'slots-rules');
    for (const t of [
      'WILD appears on reels 2 to 5 and stands in for every symbol except SCATTER. It pays nothing on its own.',
      '3, 4 or 5 SCATTERs anywhere pay 2, 10 or 50 times the total bet, on top of line wins.',
      '3 or more SCATTERs award 10 free games on the same bet with every win tripled. 3 more during free games add 10 more.',
      'Free games play automatically and are paid with the spin that started them.',
    ])
      ul.append(el('li', '', t));
    box.append(ul);
    const lines = el('div', 'slots-lines');
    NEON.lineRows.forEach((_, i) => {
      const item = el('div', 'slots-lineitem');
      item.append(el('span', '', String(i + 1)), lineDiagram(i));
      lines.append(item);
    });
    box.append(el('h3', '', 'The 20 lines'), lines);
  } else {
    const mm = machine === 'sevens' ? SEVENS : WILD;
    box.append(el('p', 'slots-note', 'Pays per coin on the center line. Coins multiply every pay. Only the highest win on the line is paid.'));
    const rows = mm.pays.map((p) => [CELLS[p.combo]!.map((s) => icon(machine, s)), p.label, ...[1, 2, 3].map((k) => cells.cell(p.pay * k, 'coins', k))]);
    const t = table(coinHeads(cells), rows);
    cells.table(t);
    box.append(t);
    const ul = el('ul', 'slots-rules');
    const rules =
      machine === 'sevens'
        ? ['Any mix of single, double and triple bars pays Any three bars.', 'Cherries count from the left reel: one on reel 1, reels 1 and 2, or all three.', 'Bars and cherries never combine.']
        : [
            `5X is wild for sevens and bars. Each 5X in a line win multiplies it by ${WILD_MULTIPLIER}: one pays x5, two pay x25.`,
            'Three 5X pay 5,000 per coin. Two 5X with a blank pay 10; one 5X with no other win pays 2.',
          ];
    for (const t of rules) ul.append(el('li', '', t));
    box.append(ul);
  }

  const par = el('div', 'slots-par');
  const mm = machine === 'sevens' ? SEVENS : machine === 'wild' ? WILD : NEON;
  for (const [k, v] of mm.published) {
    const row = el('div', 'slots-par-row');
    row.append(el('span', '', k), el('span', 'money', v));
    par.append(row);
  }
  box.append(el('h3', '', 'PAR sheet'), par);

  // the reel strips, stop by stop, with weights on the steppers
  const strips = el('details', 'slots-strips');
  strips.append(el('summary', '', 'Reel strips'));
  if (video) {
    const rows = NEON.strips[0]!.map((_, s) => [String(s), ...NEON.strips.map((st) => st[s]!)]);
    strips.append(el('p', 'slots-note', 'Each reel stops uniformly on one of 32 stops; the window shows that stop and the next two.'), table(['Stop', 'Reel 1', 'Reel 2', 'Reel 3', 'Reel 4', 'Reel 5'], rows));
  } else {
    const st = machine === 'sevens' ? SEVENS : WILD;
    const rows = st.reels[0]!.map((_, s) => [String(s), ...st.reels.flatMap((r) => [NAMES[r[s]![0]] ?? r[s]![0], String(r[s]![1])])]);
    strips.append(
      el('p', 'slots-note', `22 physical stops per reel; a stop's weight is how many of the ${st.virtualStops} equally likely virtual stops land on it.`),
      table(['Stop', 'Reel 1', 'Wt', 'Reel 2', 'Wt', 'Reel 3', 'Wt'], rows),
    );
  }
  box.append(strips);
  cells.bet(bet);
  return { close, bet: (b) => cells.bet(b) };
}
