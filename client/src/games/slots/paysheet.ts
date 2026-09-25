// The Pays screen (I) for Diamond Line, Lucky Cherries, Gold Rush and Straw, Sticks & Bricks: the pay table, the rules,
// the published PAR figures, the lines and the reel strips, all generated from the machine's own
// data, the same tables the server scores with. Same sheet and styles as the first three (pays.ts).

import { DIAMONDS } from '../../../../shared/src/games/slots/diamonds.ts';
import { CHERRIES } from '../../../../shared/src/games/slots/cherries.ts';
import { GOLDRUSH } from '../../../../shared/src/games/slots/goldrush.ts';
import { PIGS } from '../../../../shared/src/games/slots/pigs.ts';
import { el, button } from '../../ui/kit.ts';
import { skinEntry } from './build.ts';
import { lineColorOf, type SkinId } from './skin.ts';

const n = (x: number) => x.toLocaleString('en-US');

function icon(id: SkinId, sym: string, w = 54, h = 34): HTMLCanvasElement {
  const skin = skinEntry(id).skin;
  const c = el('canvas', 'slots-icon');
  const r = Math.min(2, globalThis.devicePixelRatio || 1);
  c.width = w * r;
  c.height = h * r;
  const g = c.getContext('2d')!;
  g.scale(r, r);
  g.fillStyle = skin.stripGround;
  g.fillRect(0, 0, w, h);
  g.translate(w / 2, h / 2);
  skin.drawSymbol(g, sym, w * 0.86, h * 0.9);
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

function rules(items: string[]): HTMLElement {
  const ul = el('ul', 'slots-rules');
  for (const t of items) ul.append(el('li', '', t));
  return ul;
}

function lineDiagram(id: SkinId, rows: readonly number[], line: number, height: number): HTMLCanvasElement {
  const spec = skinEntry(id).overlay!;
  const c = el('canvas', 'slots-linemap');
  const cell = 12;
  c.width = 60;
  c.height = height * cell;
  c.style.height = `${(height * 36) / 3}px`;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c0b12';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  for (let r = 0; r < 5; r++) for (let k = 0; k < height; k++) g.strokeRect(r * cell + 0.5, k * cell + 0.5, cell - 1, cell - 1);
  g.strokeStyle = lineColorOf(spec, line);
  g.lineWidth = 2.5;
  g.beginPath();
  rows.forEach((row, r) => g.lineTo(r * cell + 6, row * cell + 6));
  g.stroke();
  return c;
}

function lines(id: SkinId, lineRows: readonly (readonly number[])[], height: number): HTMLElement {
  const box = el('div', 'slots-lines');
  lineRows.forEach((rows, i) => {
    const item = el('div', 'slots-lineitem');
    item.append(el('span', '', String(i + 1)), lineDiagram(id, rows, i, height));
    box.append(item);
  });
  return box;
}

function par(published: readonly (readonly [string, string])[]): HTMLElement {
  const box = el('div', 'slots-par');
  for (const [k, v] of published) {
    const row = el('div', 'slots-par-row');
    row.append(el('span', '', k), el('span', 'money', v));
    box.append(row);
  }
  return box;
}

const DIAMOND_NAMES: Record<string, string> = { DI: 'Diamond', '7': 'Seven', '3B': 'Triple bar', '2B': 'Double bar', '1B': 'Single bar', CH: 'Cherry', BL: 'blank' };
const DIAMOND_CELLS: Record<string, string[]> = {
  threeDI: ['DI', 'DI', 'DI'], three7: ['7', '7', '7'], three3B: ['3B', '3B', '3B'], three2B: ['2B', '2B', '2B'], three1B: ['1B', '1B', '1B'],
  anyBar: ['BAR', 'BAR', 'BAR'], threeCH: ['CH', 'CH', 'CH'], twoCH: ['CH', 'CH', 'ANY'], oneCH: ['CH', 'ANY', 'ANY'],
};
const titleCase = (s: string) => (s === '10' ? 'Ten' : s.charAt(0) + s.slice(1).toLowerCase());

function diamondsSheet(box: HTMLElement): void {
  box.append(el('p', 'slots-note', 'Pays per coin on the center line. Coins multiply every pay. Only the highest win on the line is paid.'));
  const rows = DIAMONDS.pays.map((p) => [DIAMOND_CELLS[p.combo]!.map((s) => icon('diamonds', s)), p.label, n(p.pay), n(p.pay * 2), n(p.pay * 3)]);
  box.append(table(['', 'Line', '1 coin', '2 coins', '3 coins'], rows));
  box.append(
    rules([
      'The DIAMOND is wild for every symbol, cherries included. One DIAMOND in a win pays double; two pay four times.',
      'Three DIAMONDs pay 1,000 per coin.',
      'Cherries pay anywhere on the line: one pays 2, two pay 5, three pay 10. A DIAMOND counts as a cherry, so a DIAMOND on its own pays 4.',
      'Any mix of single, double and triple bars pays Any three bars.',
    ]),
  );
  box.append(el('h3', '', 'PAR sheet'), par(DIAMONDS.published));
  const strips = el('details', 'slots-strips');
  strips.append(el('summary', '', 'Reel strips'));
  const srows = DIAMONDS.reels[0]!.map((_, s) => [String(s), ...DIAMONDS.reels.flatMap((r) => [DIAMOND_NAMES[r[s]![0]] ?? r[s]![0], String(r[s]![1])])]);
  strips.append(
    el('p', 'slots-note', `22 physical stops per reel; a stop's weight is how many of the ${DIAMONDS.virtualStops} equally likely virtual stops land on it. The blanks beside the diamond and the seven are no heavier than the rest.`),
    table(['Stop', 'Reel 1', 'Wt', 'Reel 2', 'Wt', 'Reel 3', 'Wt'], srows),
  );
  box.append(strips);
}

function stripTable(strips: readonly (readonly string[])[]): HTMLTableElement {
  const rows = strips[0]!.map((_, s) => [String(s), ...strips.map((st) => titleCase(st[s]!))]);
  return table(['Stop', 'Reel 1', 'Reel 2', 'Reel 3', 'Reel 4', 'Reel 5'], rows);
}

function cherriesSheet(box: HTMLElement): void {
  box.append(el('p', 'slots-note', 'Pays per credit bet on a line, for adjacent matches from the left reel. All 10 lines play on every spin; line wins add up.'));
  const rows = (Object.entries(CHERRIES.linePays) as [string, readonly number[]][]).map(([sym, p]) => [[icon('cherries', sym)], titleCase(sym), n(p[3]!), n(p[2]!), n(p[1]!), p[0] ? n(p[0]) : '']);
  box.append(table(['', 'Fruit', '5', '4', '3', '2'], rows));
  const counts = new Map<number, number>();
  for (const p of CHERRIES.wheel) counts.set(p, (counts.get(p) ?? 0) + 1);
  const wheel = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([p, k]) => `${p}x on ${k}`).join(', ');
  box.append(
    rules([
      'Cherries pay from two on a line; every other fruit from three. There are no wilds.',
      '3, 4 or 5 BONUS symbols anywhere spin the Cherry Wheel. Its prize is paid in total bets: x1 for three BONUS, x2 for four, x5 for five, on top of any line wins.',
      `The wheel has 20 equal segments and each is equally likely: ${wheel}.`,
      'The wheel is spun for you and paid with the spin that started it.',
    ]),
  );
  box.append(el('h3', '', 'The 10 lines'), lines('cherries', CHERRIES.lineRows, 3));
  box.append(el('h3', '', 'PAR sheet'), par(CHERRIES.published));
  const strips = el('details', 'slots-strips');
  strips.append(el('summary', '', 'Reel strips'));
  strips.append(el('p', 'slots-note', 'Each reel stops uniformly on one of 30 stops; the window shows that stop and the next two.'), stripTable(CHERRIES.strips));
  box.append(strips);
}

function goldSheet(box: HTMLElement): void {
  box.append(el('p', 'slots-note', 'Pays per credit bet on a line, for 3, 4 or 5 of a kind on adjacent reels from the left. All 40 lines play on every spin; line wins add up.'));
  const rows = (Object.entries(GOLDRUSH.linePays) as [string, readonly number[]][]).map(([sym, p]) => [[icon('goldrush', sym)], titleCase(sym), n(p[3]!), n(p[2]!), n(p[1]!)]);
  box.append(table(['', 'Symbol', '5', '4', '3'], rows));
  box.append(
    rules([
      'WILD appears on reels 2 to 5 and stands in for every symbol except NUGGET. It pays nothing on its own.',
      '3, 4 or 5 NUGGETs anywhere start 8, 10 or 15 free games on the same bet.',
      'In the free games, every WILD that lands stays where it landed until the free games end.',
      'Free games spin their own reels (one WILD on each of reels 2 to 5, no NUGGET), so they can’t start more. They play automatically and are paid with the spin that started them.',
    ]),
  );
  box.append(el('h3', '', 'The 40 lines'), lines('goldrush', GOLDRUSH.lineRows, 4));
  box.append(el('h3', '', 'PAR sheet'), par(GOLDRUSH.published));
  const strips = el('details', 'slots-strips');
  strips.append(el('summary', '', 'Reel strips'));
  strips.append(
    el('p', 'slots-note', 'Each reel stops uniformly on one of 32 stops; the window shows that stop and the next three.'),
    el('h3', '', 'Base game'),
    stripTable(GOLDRUSH.strips),
    el('h3', '', 'Free games'),
    stripTable(GOLDRUSH.freeStrips),
  );
  box.append(strips);
}

const PIG_NAMES: Record<string, string> = { BRICKPIG: 'Brick pig', STICKPIG: 'Stick pig', STRAWPIG: 'Straw pig', POT: 'Pot', CHURN: 'Churn', APPLE: 'Apple', TURNIP: 'Turnip' };

function pigsSheet(box: HTMLElement): void {
  box.append(el('p', 'slots-note', 'Pays per credit bet on a line, for 3, 4 or 5 of a kind on adjacent reels from the left. All 20 lines play on every spin; line wins add up.'));
  const rows = (Object.entries(PIGS.linePays) as [string, readonly number[]][]).map(([sym, p]) => [[icon('pigs', sym)], PIG_NAMES[sym] ?? titleCase(sym), n(p[3]!), n(p[2]!), n(p[1]!)]);
  box.append(table(['', 'Symbol', '5', '4', '3'], rows));
  const b = PIGS.bonus;
  const list = (g: number) => b.prizes[g]!.map((x) => `${x}x`).join(', ');
  box.append(
    rules([
      'The WOLF appears on reels 2 to 5 and stands in for every pig and picture. It pays nothing on its own and never stands in for a house.',
      `Houses (straw, sticks and brick) never pay on a line. ${PIGS.trigger} or more anywhere start the Blowdown, on top of any line wins.`,
      `The Blowdown: the houses stay where they are and the other ${b.cells - PIGS.trigger} or fewer plots spin on their own. You get ${b.respins} spins; each spin that builds a house puts the count back to ${b.respins}.`,
      `On every spin each empty plot builds a house with chance ${b.land[0]} in ${b.land[1]}: straw ${b.grade[0]} times in ${b.gradeDen}, sticks ${b.grade[1]} in ${b.gradeDen}, brick ${b.grade[2]} in ${b.gradeDen}.`,
      `Before each spin every standing house may be rebuilt one grade stronger: straw to sticks ${b.upgrade[0]} in ${b.upgradeDen}, sticks to brick ${b.upgrade[1]} in ${b.upgradeDen}, brick to a gold mansion ${b.upgrade[2]} in ${b.upgradeDen}.`,
      `When the spins run out the wolf blows every house down and each pays what it was hiding, in total bets, each amount on its list equally likely: straw ${list(0)}; sticks ${list(1)}; brick ${list(2)}; the gold mansion ${list(3)}.`,
      `All ${b.cells} plots built is the Whole Street: ${n(b.street)} times the total bet on top of the houses.`,
      'The Blowdown plays automatically and is paid with the spin that started it.',
    ]),
  );
  box.append(el('h3', '', 'The 20 lines'), lines('pigs', PIGS.lineRows, 3));
  box.append(el('h3', '', 'PAR sheet'), par(PIGS.published));
  const strips = el('details', 'slots-strips');
  strips.append(el('summary', '', 'Reel strips'));
  strips.append(el('p', 'slots-note', 'Each reel stops uniformly on one of 30 stops; the window shows that stop and the next two.'), stripTable(PIGS.strips));
  box.append(strips);
}

const NAMES: Record<SkinId, string> = { diamonds: DIAMONDS.name, cherries: CHERRIES.name, goldrush: GOLDRUSH.name, pigs: PIGS.name };

export function openPaysheet(ui: HTMLElement, id: SkinId, onClose: () => void): { close: () => void } {
  const box = el('div', 'slots-pays panel');
  box.setAttribute('role', 'dialog');
  const close = () => {
    box.remove();
    onClose();
  };
  const head = el('div', 'slots-pays-head');
  head.append(el('h2', '', `${NAMES[id]} · Pays`), button('Close', close, { key: 'I', cls: 'ghost' }));
  box.append(head);
  if (id === 'diamonds') diamondsSheet(box);
  else if (id === 'cherries') cherriesSheet(box);
  else if (id === 'pigs') pigsSheet(box);
  else goldSheet(box);
  ui.append(box);
  return { close };
}
