// The moment you earn one: a card slides in at the right, under the HUD's buttons, clear of the
// dealer's line and the table's own banners in the middle. The medallion lights, the feat's name
// in the house serif, what came with it under that. One at a time; a round that earned three
// shows them in turn. At a table the caller waits until the round has been shown.

import './feats.css';
import { featOf } from '../../../../shared/src/feats.ts';
import { el } from '../kit.ts';
import type { SfxLike } from '../menu/deps.ts';
import { medal } from './icons.ts';
import { unlockSub } from './lines.ts';

const SHOW_MS = 5200;
const OUT_MS = 380;
/** More than this waiting and the oldest go unshown (the sheet still lists them). */
const QUEUE_MAX = 4;

export class UnlockCards {
  private box: HTMLElement | null = null;
  private queue: string[] = [];
  private busy = false;
  private timer = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly sfx?: SfxLike,
    /** Called when a card is clicked (open the sheet). */
    private readonly onOpen?: (feat: string) => void,
  ) {}

  show(feat: string): void {
    if (!featOf(feat)) return;
    this.queue.push(feat);
    while (this.queue.length > QUEUE_MAX) this.queue.shift();
    if (!this.busy) this.next();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.queue = [];
    this.busy = false;
    this.box?.remove();
    this.box = null;
  }

  private next(): void {
    const id = this.queue.shift();
    const f = id ? featOf(id) : null;
    if (!id || !f) {
      this.busy = false;
      return;
    }
    this.busy = true;
    if (!this.box) {
      this.box = el('div', 'ft-cards pass');
      this.box.setAttribute('role', 'status');
      this.box.setAttribute('aria-live', 'polite');
      this.root.append(this.box);
    }
    const card = el('button', `ft-card panel ${f.kind}`);
    card.type = 'button';
    card.title = 'Achievements (J)';
    const text = el('div', 'ft-card-text');
    text.append(
      el('div', 'ft-card-kind', f.kind === 'challenge' ? 'Challenge complete' : 'Achievement'),
      el('div', 'ft-card-name', f.name),
      el('div', 'ft-card-sub', unlockSub(f)),
    );
    card.append(medal(true), text);
    card.addEventListener('click', () => this.onOpen?.(id));
    this.box.replaceChildren(card);
    if (this.sfx && !this.sfx.muted) {
      this.sfx.play('ui-switch', { volume: 0.55 });
      if (f.reward.cash) this.sfx.play('chips-stack', { volume: 0.5, delay: 0.22 });
    }
    this.timer = window.setTimeout(() => {
      card.classList.add('out');
      this.timer = window.setTimeout(() => {
        card.remove();
        this.next();
      }, OUT_MS);
    }, SHOW_MS);
  }
}
