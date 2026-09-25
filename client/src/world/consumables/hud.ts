// On screen while you drink and eat: what's in your hand (how much is left, the key that takes the
// next sip or bite, and a button for it on a touch screen), and a chip for each thing a drink or a
// plate is doing for you, with the time it has left. Under the HUD's top-left bar. And the warm
// edge a few drinks put round the view.

import './dine.css';
import { el } from '../../ui/kit.ts';
import { barItem } from '../../../../shared/src/items.ts';
import type { Chip } from './effects.ts';

export interface HeldInfo {
  item: string;
  /** What's left, 1 full to 0 empty. */
  level: number;
  /** The key's action ("Sip", "Bite", "Pop the cork"...), or null when there's nothing more to have. */
  action: string | null;
  /** A line under it (finished, a toast to be had...). */
  note: string;
}

export class DineHud {
  readonly root = el('div', 'dine-hud');
  private readonly card = el('div', 'dine-card');
  private readonly name = el('span', 'dine-card-name');
  private readonly bar = el('div', 'dine-card-bar');
  private readonly fill = el('div', 'dine-card-fill');
  private readonly act = el('button', 'dine-act');
  private readonly actLabel = el('span', 'dine-act-label');
  private readonly note = el('span', 'dine-card-note');
  private readonly chips = el('div', 'dine-chips');
  private readonly vignette = el('div', 'dine-vignette');
  private chipEls = new Map<string, { root: HTMLElement; time: HTMLElement; name: HTMLElement; bar: HTMLElement }>();

  constructor(ui: HTMLElement, onAct: () => void) {
    const head = el('div', 'dine-card-head');
    head.append(this.name);
    this.bar.append(this.fill);
    this.act.type = 'button';
    this.act.append(el('kbd', 'kc', 'Q'), this.actLabel);
    this.act.addEventListener('click', (e) => {
      e.stopPropagation();
      onAct();
    });
    // a tap here isn't a click on the floor behind
    this.act.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.card.append(head, this.bar, this.act, this.note);
    this.card.hidden = true;
    this.root.append(this.card, this.chips);
    this.vignette.setAttribute('aria-hidden', 'true');
    ui.append(this.vignette, this.root);
  }

  show(on: boolean): void {
    this.root.hidden = !on;
    if (!on) this.vignette.style.opacity = '0';
  }

  held(h: HeldInfo | null): void {
    this.card.hidden = !h;
    if (!h) return;
    const it = barItem(h.item);
    this.name.textContent = it?.name ?? 'Your order';
    this.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, h.level)).toFixed(3)})`;
    this.act.hidden = !h.action;
    if (h.action) {
      this.actLabel.textContent = h.action;
      this.act.setAttribute('aria-label', `${h.action} (Q)`);
    }
    this.note.textContent = h.note;
    this.note.hidden = !h.note;
  }

  setChips(list: readonly Chip[]): void {
    const keep = new Set<string>(list.map((c) => c.id));
    for (const [id, c] of this.chipEls) {
      if (!keep.has(id)) {
        c.root.remove();
        this.chipEls.delete(id);
      }
    }
    for (const c of list) {
      let e = this.chipEls.get(c.id);
      if (!e) {
        const root = el('div', `dine-chip dine-chip-${c.id}`);
        const name = el('span', 'dine-chip-name');
        const time = el('span', 'dine-chip-time');
        const bar = el('span', 'dine-chip-bar');
        root.append(el('span', 'dine-chip-dot'), name, time, bar);
        e = { root, time, name, bar };
        this.chipEls.set(c.id, e);
        this.chips.append(root);
      }
      e.name.textContent = c.name;
      e.time.textContent = c.left === null ? '' : clock(c.left);
      e.time.hidden = c.left === null;
      // tipsy shows how strong; the rest how long is left of the most they last
      e.bar.style.transform = `scaleX(${(c.left === null ? c.level : Math.min(1, c.left / 300_000)).toFixed(3)})`;
    }
  }

  /** The warm edge round the view, 0 none to 1 the most (a few drinks). */
  warmth(k: number): void {
    this.vignette.style.opacity = (Math.max(0, Math.min(1, k)) * 0.85).toFixed(3);
  }

  dispose(): void {
    this.root.remove();
    this.vignette.remove();
  }
}

/** "3:05", "0:42" */
function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
