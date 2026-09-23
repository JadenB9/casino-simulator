// The craps panel: the puck's state in words, who has the dice, the multiplayer countdown, the
// last rolls (drawn dice, sevens in red), and the net of the last decided roll. Plus the hover
// card that names a bet spot, what it pays and what you have on it.

import { el } from '../../ui/kit.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { numberWord } from '../../../../shared/src/games/craps/calls.ts';
import type { CrapsView } from '../../../../shared/src/games/craps/protocol.ts';

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
  readonly tip = el('div', 'panel craps-tip');
  private lastHistory = '';
  private clockText = '';

  constructor(parent: HTMLElement) {
    this.root.append(this.puck, this.who, this.clock, this.history, this.net, this.note);
    this.tip.hidden = true;
    parent.append(this.root, this.tip);
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

  showTip(lines: string[] | null, x: number, y: number): void {
    if (!lines) {
      this.tip.hidden = true;
      return;
    }
    this.tip.replaceChildren(...lines.map((l, i) => el('div', i === 0 ? 'craps-tip-head' : 'craps-tip-line', l)));
    this.tip.hidden = false;
    this.tip.style.left = `${Math.min(innerWidth - 260, x + 16)}px`;
    this.tip.style.top = `${Math.max(8, y - 12)}px`;
  }

  dispose(): void {
    this.root.remove();
    this.tip.remove();
  }
}
