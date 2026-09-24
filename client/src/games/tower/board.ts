// The tower on the page: nine rows, the first at the bottom, of two to four tiles each. The row
// you're on is lit and its tiles show what it pays; rows climbed keep their egg; the rest wait
// dark above. A pick flips its tile over; the dragon shakes the tower, and when the climb ends,
// whichever way, the whole tower turns over from the bottom up.

import { el } from '../../ui/kit.ts';
import { wait } from '../../table/tween.ts';
import { LEVELS, SPECS, multiplier, type Difficulty } from '../../../../shared/src/games/tower/rules.ts';
import { multText } from '../online/screen.ts';
import { eggIcon, dragonIcon } from './icons.ts';

interface Row {
  root: HTMLElement;
  label: HTMLElement;
  tiles: HTMLButtonElement[];
}

export interface TowerPicture {
  /** Rows climbed. */
  level: number;
  picks: number[];
  /** The row waiting for a pick, or null between climbs. */
  active: number | null;
  /** The whole tower (dragons per row), once a climb is over. */
  tower: number[][] | null;
  /** The last pick found the dragon. */
  bust: boolean;
}

export class TowerBoard {
  readonly root = el('div', 'tw-board');
  private readonly tower = el('div', 'tw-tower');
  private readonly rowsEl = el('div', 'tw-rows');
  private readonly crestValue = el('span', 'tw-crest-value');
  private rows: Row[] = [];
  private difficulty: Difficulty | null = null;
  private active: number | null = null;
  private enabled = false;

  constructor(private readonly onPick: (row: number, tile: number) => void) {
    const crest = el('div', 'tw-crest');
    crest.append(eggIcon(), el('span', 'tw-crest-label', 'Top of the tower'), this.crestValue);
    this.tower.append(crest, this.rowsEl);
    this.root.append(this.tower);
  }

  /** Build the rows for a difficulty (a no-op when it hasn't changed). */
  setup(d: Difficulty): void {
    if (d === this.difficulty) return;
    this.difficulty = d;
    const { tiles } = SPECS[d];
    this.rowsEl.replaceChildren();
    this.rows = [];
    this.tower.dataset.tiles = String(tiles);
    for (let r = 0; r < LEVELS; r++) {
      const root = el('div', 'tw-row ahead');
      const label = el('span', 'tw-row-mult', multText(multiplier(d, r + 1)));
      const strip = el('div', 'tw-tiles');
      const row: Row = { root, label, tiles: [] };
      for (let t = 0; t < tiles; t++) {
        const b = el('button', 'tw-tile');
        b.type = 'button';
        b.disabled = true;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          if (this.enabled && this.active === r) this.onPick(r, t);
        });
        row.tiles.push(b);
        strip.append(b);
      }
      root.append(label, strip);
      // column-reverse: the first row sits at the bottom
      this.rowsEl.append(root);
      this.rows.push(row);
    }
    this.crestValue.textContent = multText(multiplier(d, LEVELS));
  }

  /** Draw a moment of the game without animating. */
  show(p: TowerPicture): void {
    this.tower.classList.remove('shake');
    this.rows.forEach((row, r) => {
      const picked = p.picks[r];
      const reached = r < p.picks.length;
      row.root.className = `tw-row ${p.active === r ? 'active' : reached ? 'passed' : 'ahead'}`;
      row.tiles.forEach((tile, t) => {
        const isPick = picked === t;
        if (p.tower) {
          const dragon = p.tower[r]!.includes(t);
          this.face(tile, dragon ? 'dragon' : 'egg', isPick ? 'lit' : 'dim');
        } else if (isPick) {
          this.face(tile, p.bust && r === p.picks.length - 1 ? 'dragon' : 'egg', 'lit');
        } else {
          this.face(tile, null, p.active === r ? 'open' : reached ? 'dim' : 'shut');
        }
      });
    });
    this.setActive(p.active);
  }

  /** Light the row waiting for a pick (or none), and let its tiles take clicks while `enabled`. */
  setActive(row: number | null): void {
    this.active = row;
    this.rows.forEach((r, i) => {
      if (i === row && !r.root.classList.contains('active')) {
        r.root.className = 'tw-row active';
        for (const t of r.tiles) this.face(t, null, 'open');
      }
      for (const tile of r.tiles) tile.disabled = !(this.enabled && i === row);
    });
  }

  /** Whether the lit row takes clicks right now (not while a pick is on its way). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.setActive(this.active);
  }

  /** The tile under keyboard key `n` (1-based) on the lit row. */
  pickKey(n: number): boolean {
    if (!this.enabled || this.active === null) return false;
    const row = this.rows[this.active];
    if (!row || n < 1 || n > row.tiles.length) return false;
    this.onPick(this.active, n - 1);
    return true;
  }

  /** Flip the picked tile over. An egg lights the next row; the dragon shakes the tower. */
  async pick(row: number, tile: number, safe: boolean): Promise<void> {
    const r = this.rows[row];
    if (!r) return;
    this.active = null;
    for (const t of r.tiles) t.disabled = true;
    const b = r.tiles[tile]!;
    b.classList.add('flip');
    await wait(130);
    this.face(b, safe ? 'egg' : 'dragon', 'lit');
    b.classList.remove('flip');
    b.classList.add('land');
    r.root.className = 'tw-row passed';
    for (const [t, other] of r.tiles.entries()) if (t !== tile) this.face(other, null, 'dim');
    if (!safe) {
      this.tower.classList.remove('shake');
      void this.tower.offsetWidth;
      this.tower.classList.add('shake');
    }
    await wait(safe ? 120 : 380);
  }

  /** The whole tower turns over, bottom row first. */
  async revealAll(tower: number[][], picks: number[]): Promise<void> {
    for (let r = 0; r < this.rows.length; r++) {
      const row = this.rows[r]!;
      row.root.className = `tw-row ${r < picks.length ? 'passed' : 'shown'}`;
      row.tiles.forEach((tile, t) => {
        if (picks[r] === t) return;
        this.face(tile, tower[r]!.includes(t) ? 'dragon' : 'egg', 'dim');
        tile.classList.add('land');
      });
      await wait(45);
    }
  }

  /**
   * What a tile shows: an egg, the dragon, or nothing; `lit` for picks, `dim` for the rest of a
   * revealed tower or a passed row, `open` on the row waiting for a pick (it shows what it pays),
   * `shut` above it.
   */
  private face(tile: HTMLButtonElement, what: 'egg' | 'dragon' | null, look: 'lit' | 'dim' | 'open' | 'shut'): void {
    tile.className = `tw-tile ${look}${what ? ` ${what}` : ''}`;
    tile.replaceChildren();
    if (what === 'egg') tile.append(eggIcon());
    else if (what === 'dragon') tile.append(dragonIcon());
    else if (look === 'open' && this.difficulty) {
      const r = this.rows.findIndex((row) => row.tiles.includes(tile));
      tile.append(el('span', 'tw-tile-mult', multText(multiplier(this.difficulty, r + 1))));
    }
  }
}
