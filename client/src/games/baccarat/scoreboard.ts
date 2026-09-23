// The table's scoreboard: the Bead Plate and the Big Road side by side, drawn on canvases from
// the shoe's history in the view (FEATURES.md §4.5), under a header with the shoe, the coup and
// the counts. Paper-white grids like the electronic boards on a real baccarat table; red is
// Banker, blue is Player, green is Tie. When a road outgrows its grid it scrolls to the newest
// columns.

import type { RoadEntry, ShoeView } from '../../../../shared/src/games/baccarat/protocol.ts';
import { ROAD_ROWS, beadPlate, bigRoad, roadCounts } from '../../../../shared/src/games/baccarat/roads.ts';
import { el } from '../../ui/kit.ts';

export const ROAD_COLORS = { B: '#c8312f', P: '#2257c5', T: '#2c8a4d' } as const;
const PAPER = '#f4f0e6';
const GRID = '#d6cebd';

const BEAD_COLS = 10;
const BIG_COLS = 16;

interface Grid {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  cols: number;
  cell: number;
}

function grid(cols: number, cls: string, label: string): Grid {
  const canvas = el('canvas', `bc-road ${cls}`);
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  return { canvas, g: canvas.getContext('2d')!, cols, cell: 16 };
}

/** Size the canvas for the current cell size and pixel ratio, and draw the empty grid. */
function clear(gr: Grid): void {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = gr.cols * gr.cell;
  const h = ROAD_ROWS * gr.cell;
  if (gr.canvas.width !== Math.round(w * dpr)) {
    gr.canvas.width = Math.round(w * dpr);
    gr.canvas.height = Math.round(h * dpr);
  }
  const g = gr.g;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = GRID;
  g.lineWidth = 1;
  g.beginPath();
  for (let c = 1; c < gr.cols; c++) {
    g.moveTo(c * gr.cell + 0.5, 0);
    g.lineTo(c * gr.cell + 0.5, h);
  }
  for (let r = 1; r < ROAD_ROWS; r++) {
    g.moveTo(0, r * gr.cell + 0.5);
    g.lineTo(w, r * gr.cell + 0.5);
  }
  g.stroke();
}

function pairDots(g: CanvasRenderingContext2D, x: number, y: number, cell: number, bankerPair: boolean, playerPair: boolean): void {
  const r = Math.max(2, cell * 0.13);
  const off = cell * 0.3;
  for (const [on, color, dx, dy] of [[bankerPair, ROAD_COLORS.B, -off, -off], [playerPair, ROAD_COLORS.P, off, off]] as const) {
    if (!on) continue;
    g.beginPath();
    g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = PAPER;
    g.stroke();
  }
}

function drawBead(gr: Grid, history: readonly RoadEntry[]): void {
  clear(gr);
  const cells = beadPlate(history);
  const used = Math.ceil(history.length / ROAD_ROWS);
  const shift = Math.max(0, used - gr.cols);
  const g = gr.g;
  const c = gr.cell;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `600 ${Math.round(c * 0.6)}px "Barlow Condensed", sans-serif`;
  for (const { col, row, entry } of cells) {
    if (col < shift) continue;
    const x = (col - shift) * c + c / 2;
    const y = row * c + c / 2;
    g.beginPath();
    g.arc(x, y, c * 0.42, 0, Math.PI * 2);
    g.fillStyle = ROAD_COLORS[entry.w];
    g.fill();
    g.fillStyle = '#fff';
    g.fillText(entry.w, x, y + 0.5);
    pairDots(g, x, y, c, entry.bp, entry.pp);
  }
}

function drawBig(gr: Grid, history: readonly RoadEntry[]): void {
  clear(gr);
  const road = bigRoad(history);
  const shift = Math.max(0, road.columns - gr.cols);
  const g = gr.g;
  const c = gr.cell;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  road.cells.forEach((cell, i) => {
    if (cell.col < shift) return;
    const x = (cell.col - shift) * c + c / 2;
    const y = cell.row * c + c / 2;
    g.beginPath();
    g.arc(x, y, c * 0.36, 0, Math.PI * 2);
    g.lineWidth = Math.max(1.5, c * 0.12);
    g.strokeStyle = ROAD_COLORS[cell.winner];
    g.stroke();
    const ties = cell.ties + (i === 0 ? road.leadingTies : 0);
    if (ties > 0) {
      g.beginPath();
      g.moveTo(x - c * 0.32, y + c * 0.32);
      g.lineTo(x + c * 0.32, y - c * 0.32);
      g.lineWidth = Math.max(1.5, c * 0.11);
      g.strokeStyle = ROAD_COLORS.T;
      g.stroke();
      if (ties > 1) {
        g.font = `600 ${Math.round(c * 0.5)}px "Barlow Condensed", sans-serif`;
        g.fillStyle = ROAD_COLORS.T;
        g.fillText(String(ties), x, y + 0.5);
      }
    }
    pairDots(g, x, y, c, cell.bankerPair, cell.playerPair);
  });
  // ties before the shoe's first decision have no mark to sit on yet
  if (road.cells.length === 0 && road.leadingTies > 0) {
    g.beginPath();
    g.moveTo(c * 0.18, c * 0.82);
    g.lineTo(c * 0.82, c * 0.18);
    g.lineWidth = Math.max(1.5, c * 0.11);
    g.strokeStyle = ROAD_COLORS.T;
    g.stroke();
  }
}

export class Scoreboard {
  readonly root = el('section', 'bc-board panel');
  private readonly shoeLine = el('span', 'bc-board-shoe');
  private readonly counts = el('div', 'bc-board-counts');
  private readonly note = el('span', 'bc-board-note');
  private readonly badge = el('span', 'bc-board-badge');
  private readonly bead = grid(BEAD_COLS, 'bc-bead', 'Bead Plate');
  private readonly big = grid(BIG_COLS, 'bc-big', 'Big Road');
  private history: readonly RoadEntry[] = [];

  constructor() {
    this.root.setAttribute('aria-label', 'Scoreboard');
    const head = el('header', 'bc-board-head');
    head.append(this.shoeLine, this.counts);
    const roads = el('div', 'bc-board-roads');
    const beadBox = el('figure', 'bc-road-box');
    beadBox.append(el('figcaption', 'label', 'Bead Plate'), this.bead.canvas);
    const bigBox = el('figure', 'bc-road-box');
    bigBox.append(el('figcaption', 'label', 'Big Road'), this.big.canvas);
    roads.append(beadBox, bigBox);
    const foot = el('footer', 'bc-board-foot');
    this.badge.hidden = true;
    foot.append(this.note, this.badge);
    this.root.append(head, roads, foot);
    addEventListener('resize', this.resize);
    this.resize();
  }

  private resize = (): void => {
    const cell = innerWidth < 900 ? 12 : innerWidth < 1200 ? 14 : 16;
    this.bead.cell = cell;
    this.big.cell = cell;
    this.draw();
  };

  set(history: readonly RoadEntry[], shoe: ShoeView): void {
    this.history = history;
    this.shoeLine.textContent = shoe.no > 0 ? `Shoe ${shoe.no} · Coup ${shoe.coups}` : 'New shoe';
    const c = roadCounts(history);
    this.counts.replaceChildren(
      ...([['B', c.banker, 'Banker'], ['P', c.player, 'Player'], ['T', c.tie, 'Tie']] as const).map(([k, n, name]) => {
        const s = el('span', `bc-count bc-${k.toLowerCase()}`);
        s.title = `${name} wins`;
        s.append(el('b', '', k), document.createTextNode(String(n)));
        return s;
      }),
      el('span', 'bc-count bc-pairs', `Pairs ${c.playerPair} · ${c.bankerPair}`),
    );
    const burn = shoe.burn ? `Burn ${shoe.burn.count}` : 'Not shuffled yet';
    this.note.textContent = `${burn} · ${shoe.left} cards in the shoe`;
    this.badge.hidden = !(shoe.lastHand || shoe.shuffleNext);
    this.badge.textContent = shoe.lastHand ? 'Last hand' : 'New shoe next coup';
    this.draw();
  }

  private draw(): void {
    drawBead(this.bead, this.history);
    drawBig(this.big, this.history);
  }

  dispose(): void {
    removeEventListener('resize', this.resize);
    this.root.remove();
  }
}
