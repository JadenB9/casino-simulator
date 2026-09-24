// The 5 × 5 board on the page. Tiles you haven't turned are raised slate; a gem sits in a dark
// well with a green glow; the mine that ended a round flashes red. Where the other mines were
// shows only once the round is over, dimmed, with the gems you didn't reach.

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

export class MinesBoard {
  readonly root = el('div', 'mn-board');
  private readonly grid = el('div', 'mn-grid');
  private readonly tiles: HTMLButtonElement[] = [];
  private enabled = false;
  private live = false;

  constructor(private readonly onPick: (tile: number) => void) {
    for (let i = 0; i < TILES; i++) {
      const b = el('button', 'mn-tile');
      b.type = 'button';
      b.title = `Row ${Math.floor(i / 5) + 1}, tile ${(i % 5) + 1}`;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        if (this.enabled && this.live && b.classList.contains('closed')) this.onPick(i);
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
    this.setEnabled(this.enabled);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    for (const t of this.tiles) t.disabled = !(on && this.live && t.classList.contains('closed'));
    this.grid.classList.toggle('live', on && this.live);
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

  private face(t: HTMLButtonElement, what: 'gem' | 'mine' | null, look: 'closed' | 'lit' | 'hit' | 'dim'): void {
    t.className = `mn-tile ${look}${what ? ` ${what}` : ''}`;
    t.replaceChildren();
    if (what === 'gem') t.append(gemIcon());
    else if (what === 'mine') t.append(mineIcon());
  }
}

/** Chebyshev distance between two tiles: the rings the board turns over in. */
function dist(a: number, b: number): number {
  return Math.max(Math.abs((a % 5) - (b % 5)), Math.abs(Math.floor(a / 5) - Math.floor(b / 5)));
}
