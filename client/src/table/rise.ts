// A win's amount rising off the spot it was won on: "+$450" lifts from the chips the dealer just
// paid and fades, so what a hand paid is read where it happened, at every card table alike. Calm
// (Reduce flashing & motion): it shows and fades where it is, without the lift. A label in the
// table's space, so it stays on its spot while the camera moves; it never takes a click.

import './rise.css';
import type * as THREE from 'three';
import { formatMoney, type Cents } from '../../../shared/src/money.ts';
import { el } from '../ui/kit.ts';
import { calm } from '../app/comfort.ts';
import type { TableStage } from './stage.ts';

/** How long the amount is up, ms (rise.css's animation runs the same). */
export const RISE_MS = 1900;

/** "+$450" rising from `at` (table-local, just above the chips). Nothing for a return of nothing. */
export function riseWin(stage: TableStage, at: THREE.Vector3, amount: Cents, opts: { big?: boolean } = {}): void {
  if (!(amount > 0)) return;
  const e = el('div', `win-rise${opts.big ? ' big' : ''}${calm() ? ' still' : ''}`, formatMoney(amount, { sign: true }));
  e.setAttribute('aria-hidden', 'true');
  const obj = stage.label(e, at);
  // the label renderer centres a label on its point; this one's foot sits on it
  obj.center.set(0.5, 1);
  setTimeout(() => {
    obj.removeFromParent();
    e.remove();
  }, RISE_MS);
}
