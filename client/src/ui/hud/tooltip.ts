// One tooltip for the whole page, in place of the browser's bare title boxes: the action and its
// key as a keycap ("Map  M"), shown under a control near the top of the screen and over one near
// the bottom, kept on screen. It comes after a short rest of the mouse (at once while moving along
// a row of controls), and on keyboard focus when Tab brought it there; any click, key, scroll or
// a move away takes it down. It takes no clicks and is never read twice by a screen reader: the
// control's own aria-label already says what it does.
//
// What gets one: anything with `data-tip` (and `data-tip-key` for its key: the HUD's tools set
// both), and any button in #ui with a title, whose "(K)" at the end becomes the keycap. A title is
// taken off while the pointer is on its control, so the browser's own box never shows as well.

import '../../styles/controls.css';
import { calm } from '../../app/comfort.ts';
import { splitKey } from './tools.ts';

const SHOW_MS = 380;
/** After one hides, the next shows at once for this long: moving along the bar. */
const WARM_MS = 450;
/** How far from the control, and from the screen's edges. */
const GAP = 8;
const EDGE = 8;

const TARGETS = '[data-tip], #ui button[title], #ui [role="button"][title], #ui a[title]';

let installed = false;
let box: HTMLElement | null = null;
let textEl: HTMLElement | null = null;
let keyEl: HTMLElement | null = null;
let current: HTMLElement | null = null;
let showTimer = 0;
let warmUntil = 0;
/** When Tab (or an arrow) last moved focus: focus that came by keyboard shows the tip. */
let navAt = -1e9;
/** Titles taken off while their control is pointed at, to put back after. */
const stashed = new WeakMap<HTMLElement, string>();

function ensureBox(): HTMLElement {
  if (box?.isConnected) return box;
  box = document.createElement('div');
  box.className = 'tooltip';
  box.setAttribute('role', 'tooltip');
  box.setAttribute('aria-hidden', 'true');
  const inner = document.createElement('div');
  inner.className = 'tooltip-in';
  textEl = document.createElement('span');
  textEl.className = 'tooltip-text';
  keyEl = document.createElement('kbd');
  keyEl.className = 'kc tooltip-key';
  inner.append(textEl, keyEl);
  box.append(inner);
  document.body.append(box);
  return box;
}

/** What a control's tip says: its data-tip (or title) and its key. */
export function tipOf(el: HTMLElement): { text: string; key: string | null } {
  const tip = el.dataset.tip;
  if (tip) return { text: tip, key: el.dataset.tipKey || null };
  const title = el.getAttribute('title') ?? stashed.get(el) ?? '';
  const split = splitKey(title);
  return { text: split.text, key: el.dataset.tipKey || split.key };
}

function targetOf(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const t = node.closest<HTMLElement>(TARGETS);
  if (!t || t.dataset.tip === '') return null;
  return t;
}

function stashTitle(el: HTMLElement): void {
  const t = el.getAttribute('title');
  if (t === null) return;
  stashed.set(el, t);
  el.removeAttribute('title');
}

function restoreTitle(el: HTMLElement): void {
  const t = stashed.get(el);
  stashed.delete(el);
  // (unless its own module has given it a new one meanwhile)
  if (t !== undefined && !el.hasAttribute('title')) el.setAttribute('title', t);
}

function place(el: HTMLElement): void {
  const b = ensureBox();
  const r = el.getBoundingClientRect();
  const w = b.offsetWidth;
  const h = b.offsetHeight;
  const below = r.top + r.height / 2 < innerHeight * 0.55;
  const x = Math.round(Math.min(innerWidth - EDGE - w, Math.max(EDGE, r.left + r.width / 2 - w / 2)));
  const y = Math.round(below ? Math.min(innerHeight - EDGE - h, r.bottom + GAP) : Math.max(EDGE, r.top - GAP - h));
  b.style.transform = `translate(${x}px, ${y}px)`;
  b.classList.toggle('above', !below);
}

function show(el: HTMLElement): void {
  if (!el.isConnected) return;
  const { text, key } = tipOf(el);
  if (!text) return;
  const b = ensureBox();
  textEl!.textContent = text;
  keyEl!.textContent = key ?? '';
  keyEl!.hidden = !key;
  b.classList.remove('on');
  place(el);
  b.classList.toggle('still', calm());
  // the next frame, so the fade starts from where it now stands
  requestAnimationFrame(() => current === el && b.classList.add('on'));
}

function hide(): void {
  clearTimeout(showTimer);
  if (current) {
    restoreTitle(current);
    if (box?.classList.contains('on')) warmUntil = performance.now() + WARM_MS;
  }
  current = null;
  box?.classList.remove('on');
}

function begin(el: HTMLElement, now: boolean): void {
  if (current === el) return;
  hide();
  current = el;
  stashTitle(el);
  const wait = now || performance.now() < warmUntil ? 0 : SHOW_MS;
  showTimer = window.setTimeout(() => current === el && show(el), wait);
}

/** Start listening (once, for the whole page). */
export function installTooltips(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener(
    'pointerover',
    (e) => {
      if (e.pointerType === 'touch') return;
      const t = targetOf(e.target);
      if (t) begin(t, false);
    },
    true,
  );
  document.addEventListener(
    'pointerout',
    (e) => {
      if (!current) return;
      const to = e.relatedTarget;
      if (to instanceof Node && current.contains(to)) return;
      if (targetOf(e.target) === current) hide();
    },
    true,
  );
  document.addEventListener(
    'focusin',
    (e) => {
      const t = targetOf(e.target);
      if (!t) return;
      // only focus the keyboard moved there (not a click, not a sheet handing focus back)
      if (performance.now() - navAt > 600 || !t.matches(':focus-visible')) return;
      begin(t, true);
    },
    true,
  );
  document.addEventListener(
    'focusout',
    (e) => {
      if (current && e.target === current) hide();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Tab' || e.key.startsWith('Arrow')) navAt = performance.now();
      if (current && document.activeElement !== current) hide();
      else if (current && e.key !== 'Tab' && e.key !== 'Shift') hide();
    },
    true,
  );
  document.addEventListener('pointerdown', hide, true);
  addEventListener('scroll', hide, true);
  addEventListener('resize', hide);
  addEventListener('blur', hide);
}

/** Take down whatever tip is up (a panel opening over it). */
export function hideTooltip(): void {
  hide();
}
