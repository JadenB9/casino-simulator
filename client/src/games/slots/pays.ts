// The Pays screen (I): the pay table, the rules, the published PAR figures and the reel strips,
// all generated from the machine's own data, the same tables the server scores with.

import { NEON, SEVENS, WILD, WILD_MULTIPLIER, type MachineId, type NeonSymbol } from '../../../../shared/src/games/slots/machines.ts';
import { el, button } from '../../ui/kit.ts';
import { drawNeonSymbol, drawStepperSymbol, STRIP_CREAM, SCREEN_NIGHT } from './symbols.ts';
import { lineColor } from './glass.ts';

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

function table(head: string[], rows: (string | HTMLElement[])[][]): HTMLTableElement {
  const t = el('table', 'slots-table');
  const tr = el('tr');
  for (const h of head) tr.append(el('th', '', h));
  t.append(tr);
  for (const r of rows) {
    const row = el('tr');
    for (const cell of r) {
      const td = el('td');
      if (typeof cell === 'string') td.textContent = cell;
      else td.append(...cell);
      row.append(td);
    }
    t.append(row);
  }
  return t;
}

const CELLS: Record<string, string[]> = {
  three7: ['7', '7', '7'], three3B: ['3B', '3B', '3B'], three2B: ['2B', '2B', '2B'], three1B: ['1B', '1B', '1B'],
  anyBar: ['BAR', 'BAR', 'BAR'], threeCH: ['CH', 'CH', 'CH'], twoCH: ['CH', 'CH', 'ANY'], oneCH: ['CH', 'ANY', 'ANY'],
  threeWX: ['WX', 'WX', 'WX'], twoWX: ['WX', 'WX', 'BLANK'], oneWX: ['WX', 'ANY', 'ANY'],
};
const NAMES: Record<string, string> = { '7': 'Seven', '3B': 'Triple bar', '2B': 'Double bar', '1B': 'Single bar', CH: 'Cherry', BL: 'blank', WX: '5X wild' };
const n = (x: number) => x.toLocaleString('en-US');

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

export function openPays(ui: HTMLElement, machine: MachineId, onClose: () => void): { close: () => void } {
  const box = el('div', 'slots-pays panel');
  box.setAttribute('role', 'dialog');
  const close = () => {
    box.remove();
    onClose();
  };
  const head = el('div', 'slots-pays-head');
  head.append(el('h2', '', `${machine === 'sevens' ? SEVENS.name : machine === 'wild' ? WILD.name : NEON.name} · Pays`), button('Close', close, { key: 'I', cls: 'ghost' }));
  box.append(head);

  if (machine === 'neon') {
    box.append(el('p', 'slots-note', 'Pays per credit bet on a line, for 3, 4 or 5 of a kind on adjacent reels from the left. All 20 lines play on every spin; line wins add up.'));
    const rows = Object.entries(NEON.linePays).map(([sym, p]) => [[icon('neon', sym)], sym === '10' ? 'Ten' : sym.charAt(0) + sym.slice(1).toLowerCase(), n(p![2]), n(p![1]), n(p![0])]);
    box.append(table(['', 'Symbol', '5', '4', '3'], rows));
    box.append(
      el('ul', 'slots-rules'),
    );
    const ul = box.lastElementChild!;
    for (const t of [
      'WILD appears on reels 2 to 5 and stands in for every symbol except SCATTER. It pays nothing on its own.',
      '3, 4 or 5 SCATTERs anywhere pay 2, 10 or 50 times the total bet, on top of line wins.',
      '3 or more SCATTERs award 10 free games on the same bet with every win tripled. 3 more during free games add 10 more.',
      'Free games play automatically and are paid with the spin that started them.',
    ])
      ul.append(el('li', '', t));
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
    const rows = mm.pays.map((p) => [CELLS[p.combo]!.map((s) => icon(machine, s)), p.label, n(p.pay), n(p.pay * 2), n(p.pay * 3)]);
    box.append(table(['', 'Line', '1 coin', '2 coins', '3 coins'], rows));
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
  if (machine === 'neon') {
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
  ui.append(box);
  return { close };
}
