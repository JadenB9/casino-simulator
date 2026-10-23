// The 5 × 5 board on the page. Tiles you haven't turned are raised slate; a gem sits in a dark
// well with a green glow; the mine that ended a round flashes red. Where the other mines were
// shows only once the round is over, dimmed, with the gems you didn't reach. A tile turns over
// in depth (it swings to edge-on and back with its face showing), and for Auto the board can
// instead take picks: the tiles a run turns each round, ringed until it's started.

import { el } from '../../ui/kit.ts';
import { wait } from '../../table/tween.ts';
import { TILES } from '../../../../shared/src/games/mines/rules.ts';
import { gemIcon, mineIcon } from './icons.ts';

export interface MinesPicture {
  revealed: number[];
  /** Every mine, once the round is over. */
  field: number[] | null;
  /** The mine that ended the round. */
  hit: number | null;
  /** A round is on and tiles take clicks. */
  live: boolean;
}

const tileName = (i: number) => `Row ${Math.floor(i / 5) + 1}, tile ${(i % 5) + 1}`;

export class MinesBoard {
  readonly root = el('div', 'mn-board');
  private readonly grid = el('div', 'mn-grid');
  private readonly tiles: HTMLButtonElement[] = [];
  private enabled = false;
  private live = false;
  /** Auto is on: its picks are ringed on closed tiles. */
  private choosing = false;
  /** Between rounds a click rings a tile (or takes its ring off) instead of turning it. */
  private takes = false;
  private chosen = new Set<number>();

  constructor(
    private readonly onPick: (tile: number) => void,
    private readonly onChoose: (tile: number) => void = () => {},
  ) {
    this.grid.setAttribute('role', 'group');
    this.grid.setAttribute('aria-label', 'The board');
    for (let i = 0; i < TILES; i++) {
      const b = el('button', 'mn-tile');
      b.type = 'button';
      b.title = tileName(i);
      b.setAttribute('aria-label', `${tileName(i)}, closed`);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        if (this.takes && !this.live) this.onChoose(i);
        else if (this.enabled && this.live && b.classList.contains('closed')) this.onPick(i);
      });
      this.tiles.push(b);
      this.grid.append(b);
    }
    this.root.append(this.grid);
  }

  /** Draw a moment of the game without animating. */
  show(p: MinesPicture): void {
    this.grid.classList.remove('shake');
    this.live = p.live;
    this.tiles.forEach((t, i) => {
      if (p.revealed.includes(i)) this.face(t, 'gem', 'lit');
      else if (p.hit === i) this.face(t, 'mine', 'hit');
      else if (p.field) this.face(t, p.field.includes(i) ? 'mine' : 'gem', 'dim');
      else this.face(t, null, 'closed');
    });
    this.paintChosen();
    this.setEnabled(this.enabled);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    const pickable = this.takes && !this.live;
    for (const t of this.tiles) t.disabled = !(pickable || (on && this.live && t.classList.contains('closed')));
    this.grid.classList.toggle('live', (on && this.live) || pickable);
  }

  /** Auto's picks: ring `chosen` while `on`, and take clicks as picks between rounds while `takes`. */
  setChoosing(on: boolean, chosen: readonly number[], takes: boolean): void {
    this.choosing = on;
    this.takes = on && takes;
    this.chosen = new Set(chosen);
    this.grid.classList.toggle('choosing', this.takes);
    this.paintChosen();
    this.setEnabled(this.enabled);
  }

  /** Turn a tile over: a gem pops in; a mine flashes and shakes the board. */
  async reveal(tile: number, safe: boolean): Promise<void> {
    const t = this.tiles[tile];
    if (!t) return;
    t.disabled = true;
    t.classList.add('flip');
    await wait(110);
    this.face(t, safe ? 'gem' : 'mine', safe ? 'lit' : 'hit');
    t.classList.add('land');
    if (!safe) {
      this.live = false;
      this.grid.classList.remove('shake');
      void this.grid.offsetWidth;
      this.grid.classList.add('shake');
      await wait(420);
    } else await wait(90);
  }

  /** The rest of the board turns over, nearest the last tile first. */
  async revealAll(field: number[], revealed: number[], from: number | null): Promise<void> {
    this.live = false;
    const at = from ?? 12;
    const order = Array.from({ length: TILES }, (_, i) => i)
      .filter((i) => !revealed.includes(i) && i !== from)
      .sort((a, b) => dist(a, at) - dist(b, at));
    let ring = -1;
    for (const i of order) {
      const d = dist(i, at);
      if (d !== ring) {
        if (ring >= 0) await wait(40);
        ring = d;
      }
      this.face(this.tiles[i]!, field.includes(i) ? 'mine' : 'gem', 'dim');
      this.tiles[i]!.classList.add('land');
    }
    this.setEnabled(this.enabled);
  }

  private paintChosen(): void {
    this.tiles.forEach((t, i) => t.classList.toggle('chosen', this.choosing && this.chosen.has(i) && t.classList.contains('closed')));
  }

  private face(t: HTMLButtonElement, what: 'gem' | 'mine' | null, look: 'closed' | 'lit' | 'hit' | 'dim'): void {
    t.className = `mn-tile ${look}${what ? ` ${what}` : ''}`;
    t.replaceChildren();
    const i = this.tiles.indexOf(t);
    t.setAttribute('aria-label', `${tileName(i)}, ${what === 'gem' ? 'a gem' : what === 'mine' ? 'a mine' : 'closed'}`);
    if (what === 'gem') t.append(gemIcon());
    else if (what === 'mine') t.append(mineIcon());
  }
}

/** Chebyshev distance between two tiles: the rings the board turns over in. */
function dist(a: number, b: number): number {
  return Math.max(Math.abs((a % 5) - (b % 5)), Math.abs(Math.floor(a / 5) - Math.floor(b / 5)));
}
