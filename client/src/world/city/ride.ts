// The elevator's screens: the car's button panel (the floors, this one lit; R, C, G or the arrows
// and Enter; Esc keeps the doors open) and the ride itself, the view going dark while the floor
// indicator counts the floors and the arrow shows the way.

import { el } from '../../ui/kit.ts';
import { focusFirst, holdKeyboard } from '../../ui/keyboard.ts';
import { FLOORS, floorOf, levelLabel } from '../../../../shared/src/lifts.ts';
import type { ZoneId } from '../../../../shared/src/zones.ts';
import './city.css';

export interface PanelHandle {
  close(): void;
}

/** The car's panel. `pick` hears the floor chosen; closing without one calls `onClose`. */
export function openPanel(
  ui: HTMLElement,
  here: ZoneId,
  pick: (to: ZoneId) => void,
  onClose: () => void,
  shows: (zone: ZoneId) => boolean = () => true,
  /** v7.1: the apartments' residents (asked for when that button is pressed), and the choice of one. */
  residents?: (done: (list: { id: number; name: string; floor: number }[], me: number | null) => void) => void,
  choose?: (apt: number) => void,
): PanelHandle {
  // v7: "Your Apartment" is on an owner's panel only
  const floors = FLOORS.filter((f) => f.zone === here || shows(f.zone));
  const root = el('div', 'lift-panel');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Elevator panel');
  root.tabIndex = -1;
  const cur = floorOf(here);
  const head = el('div', 'lift-head');
  const display = el('div', 'lift-display');
  display.append(el('span', 'lift-display-floor', cur.key));
  head.append(display, el('div', 'lift-here', cur.name));
  const list = el('ol', 'lift-floors');
  const buttons: HTMLButtonElement[] = [];
  let closed = false;
  const close = (chosen: ZoneId | null) => {
    if (closed) return;
    closed = true;
    release();
    root.classList.add('closing');
    setTimeout(() => root.remove(), 160);
    if (chosen) pick(chosen);
    else onClose();
  };
  for (const f of floors) {
    const li = el('li');
    const b = el('button', 'lift-btn');
    b.type = 'button';
    b.dataset.zone = f.zone;
    const key = el('span', 'lift-key', f.key);
    const name = el('span', 'lift-name', f.name);
    const level = el('span', 'lift-level', f.zone === 'ground' ? 'Street level' : f.zone === 'home' ? `Floor ${f.level} · private` : `Floor ${f.level}`);
    b.append(key, name, level);
    if (f.zone === here) {
      b.classList.add('here');
      b.setAttribute('aria-current', 'true');
      b.title = 'You are here';
    }
    b.addEventListener('click', () => {
      if (f.zone === here && f.zone !== 'home') return;
      // v7.1: the apartments: a second page, the residents' floors (yours first)
      if (f.zone === 'home' && residents && choose) {
        list.replaceChildren(el('li', 'lift-note', 'Finding the residents…'));
        residents((people, me) => {
          if (closed) return;
          const mine = people.filter((r) => r.id === me);
          const rest = people.filter((r) => r.id !== me);
          if (!people.length) {
            list.replaceChildren(el('li', 'lift-note', 'Nobody lives here yet. Maison Home across the street sells the apartments.'));
            return;
          }
          list.replaceChildren(
            ...[...mine, ...rest].map((r) => {
              const li = el('li');
              const rb = el('button', 'lift-btn');
              rb.type = 'button';
              rb.append(el('span', 'lift-key', String(r.floor)), el('span', 'lift-name', r.id === me ? 'Your apartment' : `${r.name}'s apartment`), el('span', 'lift-level', `Floor ${r.floor}`));
              rb.addEventListener('click', () => {
                choose(r.id);
                rb.classList.add('lit');
                setTimeout(() => close('home'), 180);
              });
              li.append(rb);
              return li;
            }),
          );
          (list.querySelector('.lift-btn') as HTMLButtonElement | null)?.focus();
        });
        return;
      }
      b.classList.add('lit');
      setTimeout(() => close(f.zone), 180);
    });
    li.append(b);
    list.append(li);
    buttons.push(b);
  }
  const stay = el('button', 'lift-stay');
  stay.type = 'button';
  stay.append(el('span', 'kc', 'Esc'), 'Doors open');
  stay.addEventListener('click', () => close(null));
  root.append(head, list, stay);
  root.addEventListener('keydown', (e) => {
    const k = e.key.toUpperCase();
    const byKey = floors.find((f) => f.key === k) ?? floors[Number(k) - 1];
    if (byKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      buttons[floors.indexOf(byKey)]!.click();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = (at + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
      buttons[next]!.focus();
    }
  });
  ui.append(root);
  const release = holdKeyboard(root, () => close(null));
  // the first floor that isn't this one takes the focus, so Enter goes there
  const first = buttons.find((b) => b.dataset.zone !== here);
  if (first) first.dataset.autofocus = '';
  focusFirst(root);
  return { close: () => close(null) };
}

/**
 * The ride: the view goes dark and the indicator counts from one floor to the other, easing in
 * and out like a car does. `done` resolves when it has counted all the way.
 */
export class RideScreen {
  private readonly root = el('div', 'lift-ride');
  private readonly floor = el('span', 'lift-ride-floor');
  private readonly arrow = el('span', 'lift-ride-arrow');
  private readonly name = el('div', 'lift-ride-name');
  private from = 0;
  private to = 0;
  private t = 0;
  readonly secs: number;
  private shown = '';

  constructor(
    private readonly ui: HTMLElement,
    from: ZoneId,
    to: ZoneId,
  ) {
    this.from = floorOf(from).level;
    this.to = floorOf(to).level;
    // a floor goes by in about a tenth of a second at speed, with a second either end
    this.secs = Math.min(3.2, 1.5 + Math.abs(this.to - this.from) * 0.04);
    const box = el('div', 'lift-ride-display');
    this.arrow.classList.add(this.to > this.from ? 'up' : 'down');
    box.append(this.arrow, this.floor);
    this.name.textContent = floorOf(to).name;
    this.root.append(box, this.name);
    this.floor.textContent = levelLabel(this.from);
    ui.append(this.root);
    // the next frame, so the fade runs
    requestAnimationFrame(() => this.root.classList.add('dark'));
  }

  /** Every frame; true once the count has reached the floor. */
  update(dt: number): boolean {
    this.t = Math.min(this.secs, this.t + dt);
    const k = this.t / this.secs;
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    const label = levelLabel(Math.round(this.from + (this.to - this.from) * e));
    if (label !== this.shown) {
      this.shown = label;
      this.floor.textContent = label;
    }
    if (this.t >= this.secs) this.arrow.classList.add('stopped');
    return this.t >= this.secs;
  }

  /** Lift the dark (the doors are about to open), then go. */
  finish(): void {
    this.root.classList.remove('dark');
    this.root.classList.add('leaving');
    setTimeout(() => this.root.remove(), 600);
  }

  /** Gone at once (a refused ride). */
  cancel(): void {
    this.root.remove();
  }

  get attached(): boolean {
    return this.root.isConnected && this.ui.contains(this.root);
  }
}
