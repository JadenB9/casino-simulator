// The craps panel: the puck's state in words, who has the dice, the multiplayer countdown, the
// last rolls (drawn dice, sevens in red), the net of the last decided roll and the quick calls
// (Across, Inside, Hardways). Plus the hover card that names a bet spot, what it pays, its edge
// and what you have on it, and the plaque that tells each roll.

import { el, button } from '../../ui/kit.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { numberWord, stickCall } from '../../../../shared/src/games/craps/calls.ts';
import type { PointNumber } from '../../../../shared/src/games/craps/rules.ts';
import type { CrapsView } from '../../../../shared/src/games/craps/protocol.ts';
import { QUICKS, type QuickId } from './quick.ts';

function dieCanvas(face: number, size = 22): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size * 2;
  const g = c.getContext('2d')!;
  const s = size * 2;
  g.fillStyle = '#b3121c';
  g.beginPath();
  g.roundRect(1, 1, s - 2, s - 2, s * 0.18);
  g.fill();
  g.fillStyle = '#f5f1e8';
  const at: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [[0.27, 0.27], [0.73, 0.73]],
    3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
    4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
    5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
    6: [[0.27, 0.24], [0.73, 0.24], [0.27, 0.5], [0.73, 0.5], [0.27, 0.76], [0.73, 0.76]],
  };
  for (const [x, y] of at[face]!) {
    g.beginPath();
    g.arc(x * s, y * s, s * 0.085, 0, Math.PI * 2);
    g.fill();
  }
  c.className = 'craps-die';
  return c;
}

export class CrapsHud {
  readonly root = el('div', 'panel craps-hud');
  private puck = el('div', 'craps-puck-line');
  private who = el('div', 'craps-who');
  private clock = el('div', 'craps-clock');
  private net = el('div', 'craps-net');
  private history = el('div', 'craps-history');
  private note = el('div', 'craps-note');
  private quick = el('div', 'craps-quick');
  readonly quickBtns = new Map<QuickId, HTMLButtonElement>();
  readonly tip = el('div', 'panel craps-tip');
  private lastHistory = '';
  private clockText = '';

  /** `quick` puts a quick call down; `title` says what it would put down with the chip picked now. */
  constructor(parent: HTMLElement, h: { quick(id: QuickId): void; title(id: QuickId): string }) {
    this.quick.setAttribute('role', 'group');
    this.quick.setAttribute('aria-label', 'Quick bets');
    for (const q of QUICKS) {
      const b = button(q.name, () => h.quick(q.id), { cls: 'craps-quick-btn' });
      const describe = () => (b.title = h.title(q.id));
      b.addEventListener('pointerenter', describe);
      b.addEventListener('focus', describe);
      this.quickBtns.set(q.id, b);
      this.quick.append(b);
    }
    this.root.append(this.puck, this.who, this.clock, this.history, this.net, this.note, this.quick);
    this.tip.hidden = true;
    parent.append(this.root, this.tip);
  }

  /** Whether the quick calls can go down now. */
  setQuick(enabled: boolean): void {
    for (const b of this.quickBtns.values()) b.disabled = !enabled;
  }

  update(v: CrapsView, opts: { shooterName: string | null; mine: boolean; solo: boolean; leaving: boolean }): void {
    this.puck.replaceChildren();
    if (v.point === null) {
      this.puck.append(el('span', 'craps-puck off', 'OFF'), el('span', 'craps-phase', 'Coming out'));
    } else {
      this.puck.append(el('span', 'craps-puck on', 'ON'), el('span', 'craps-phase', `The point is ${numberWord(v.point).toUpperCase()}`));
    }
    const points = v.pointsMade > 0 ? ` · ${v.pointsMade} point${v.pointsMade === 1 ? '' : 's'} made` : '';
    if (opts.solo) this.who.textContent = `You have the dice${points}`;
    else if (v.phase === 'idle') this.who.textContent = 'Waiting for the leader to start';
    else if (v.shooter === null) this.who.textContent = 'The house is rolling';
    else this.who.textContent = `${opts.mine ? 'You have' : `${opts.shooterName ?? 'Seat ' + (v.shooter + 1)} has`} the dice${points}`;
    this.note.textContent = opts.leaving ? 'Your last bets ride until they are decided; then you cash out.' : '';
    this.note.hidden = !opts.leaving;
    const key = v.history.map((d) => d.join('')).join(',');
    if (key !== this.lastHistory) {
      this.lastHistory = key;
      this.history.replaceChildren();
      for (const [a, b] of v.history.slice(-10).reverse()) {
        const t = a + b;
        const item = el('div', `craps-roll${t === 7 ? ' seven' : ''}`);
        item.append(dieCanvas(a), dieCanvas(b), el('span', 'craps-total', String(t)));
        this.history.append(item);
      }
    }
  }

  /** The multiplayer countdown; call every frame, it only touches the DOM when the text changes. */
  tick(v: CrapsView | null, now: number, mine: boolean): void {
    let text = '';
    if (v && v.phase === 'open' && v.shooter !== null && v.pauseUntil !== null && v.rollBy !== null) {
      if (!v.pauseOver && v.pauseUntil > now) text = v.rollRequested ? `Dice out in ${Math.ceil((v.pauseUntil - now) / 1000)}` : `Bets close in ${Math.ceil((v.pauseUntil - now) / 1000)}`;
      else if (v.rollBy > now) text = mine ? `Your roll · ${Math.ceil((v.rollBy - now) / 1000)} s` : `Shooter's roll · ${Math.ceil((v.rollBy - now) / 1000)} s`;
    }
    if (text !== this.clockText) {
      this.clockText = text;
      this.clock.textContent = text;
      this.clock.hidden = !text;
    }
  }

  showNet(net: Cents | null): void {
    this.net.className = `craps-net ${net === null ? '' : net > 0 ? 'win' : net < 0 ? 'lose' : ''}`;
    this.net.textContent = net === null ? '' : `Last roll ${net === 0 ? 'even' : formatMoney(net, { sign: true })}`;
  }

  /**
   * The hover card: the spot's name, what it pays, its house edge, your bet on it. Beside the
   * pointer, or for a touch (`above`) over the finger, where the hand doesn't cover it. Rebuilt
   * only when what it says changes; moving it only moves it.
   */
  showTip(lines: string[] | null, x: number, y: number, edge: string | null = null, above = false): void {
    if (!lines) {
      this.tip.hidden = true;
      this.tipKey = '';
      return;
    }
    const key = `${lines.join('|')}|${edge ?? ''}`;
    const at = `${x},${y},${above}`;
    if (key === this.tipKey && at === this.tipAt && !this.tip.hidden) return;
    this.tipAt = at;
    if (key !== this.tipKey) {
      this.tipKey = key;
      this.tip.replaceChildren(...lines.map((l, i) => el('div', i === 0 ? 'craps-tip-head' : 'craps-tip-line', l)));
      if (edge) this.tip.insertBefore(el('div', 'craps-tip-edge', edge), this.tip.children[2] ?? null);
    }
    this.tip.hidden = false;
    const w = this.tip.offsetWidth || 250;
    const h = this.tip.offsetHeight || 80;
    const left = above ? x - w / 2 : x + 16;
    const top = above ? y - h - 44 : y - 12;
    this.tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, left))}px`;
    this.tip.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, top))}px`;
  }

  private tipKey = '';
  private tipAt = '';

  dispose(): void {
    this.root.remove();
    this.tip.remove();
  }
}

/**
 * The plaque after a roll, as the other games' result boards: the two dice and their total, the
 * stickman's call, where the puck stands now, then this player's net for the roll.
 */
export class RollPlaque {
  readonly root = el('div', 'craps-result panel');
  private readonly dice = el('div', 'craps-result-dice');
  private readonly total = el('div', 'craps-result-total');
  private readonly call = el('div', 'craps-result-call');
  private readonly detail = el('div', 'craps-result-detail');
  private readonly net = el('div', 'craps-result-net');

  constructor() {
    const badge = el('div', 'craps-result-badge');
    badge.append(this.dice, this.total);
    const words = el('div', 'craps-result-words');
    words.append(this.call, this.detail, this.net);
    this.root.append(badge, words);
    this.root.setAttribute('aria-live', 'polite');
    this.root.hidden = true;
  }

  show(d1: number, d2: number, before: PointNumber | null, after: PointNumber | null): void {
    const t = d1 + d2;
    this.dice.replaceChildren(dieCanvas(d1, 30), dieCanvas(d2, 30));
    this.total.textContent = String(t);
    this.call.textContent = stickCall(before, d1, d2).split('. ')[0]!.toUpperCase();
    this.detail.textContent = after !== null ? `Point ${numberWord(after).toUpperCase()} · puck ON` : before !== null ? 'Puck OFF · coming out next' : 'Coming out again';
    this.net.textContent = '';
    this.net.className = 'craps-result-net';
    this.root.classList.toggle('seven', t === 7);
    this.root.hidden = false;
  }

  setNet(text: string, kind: 'win' | 'lose' | 'quiet'): void {
    this.net.textContent = text;
    this.net.className = `craps-result-net ${kind}`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
