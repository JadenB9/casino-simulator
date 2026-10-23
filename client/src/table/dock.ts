// The bottom of a table's screen, kept in order. One bar sits there at a time: the chip tray
// while bets go down, a game's own bar while a decision is yours (Hit or Stand, Play or Fold,
// Hold'em's action bar). The small panels that go with it (how many hands, tipping the dealer,
// a game's meters, the Tips line) stack above it, measured. Each had a fixed `bottom:` for each
// screen size, sized for a tray on one row, so wherever the tray wrapped to a second row (a
// tablet, a phone, half a laptop screen) they sat on its chips; and the tip panel showed over
// Deal until the next frame moved it.
//
// What counts: a bar is a `.tray`, or anything a game marks `data-dock="bar"`; the panels above
// it are DOCKED below (or marked `data-dock="start" | "end" | "css"`). 'start' sits over the
// bar's left end and 'end' over its right end; 'css' keeps the place its stylesheet gives it
// across (the Tips line, a game's meters) and is only ever raised. Every one goes as low as it
// can without meeting the bar, a panel placed before it, or another table panel low on the screen
// (a game's own, which isn't moved); one over an end slides along the bar first, then rises. A
// screen with no bar leaves everything where its stylesheet puts it.
//
// It runs when any of them shows, hides or changes size (a ResizeObserver, which reports after
// layout and before the frame is painted, so nothing is ever drawn in the wrong place), when the
// window changes, and from the board fit's own measuring as a backstop. One pass reads every box,
// then writes: no layout is read between two writes.

/** A bar: the chip tray, or a game's own bottom bar. */
const BAR = '.tray, [data-dock="bar"]';

type Anchor = 'start' | 'end' | 'css';

/** The panels that go above the bar, placed in this order (the lowest first). */
const DOCKED: readonly { sel: string; at: Anchor }[] = [
  { sel: '.mh-picker, [data-dock="start"]', at: 'start' },
  { sel: '.tip-dealer, [data-dock="end"]', at: 'end' },
  { sel: '[data-dock="css"]', at: 'css' },
  { sel: '.tip-line', at: 'css' },
];

/**
 * Panels that keep to the top of the screen (the History line at the top right, the dealer's line
 * under the HUD): where their stylesheet puts them, moved down below any table panel they would
 * land on (on a phone the baccarat scoreboard spans the screen there, and the meters and Rules
 * of Three Card, Let It Ride, Pai Gow and War sit at its left), and below one placed before them.
 */
const TOP = '.th-history, [data-dock="top"], .dealer-line';
/**
 * A panel that can wait for room (tipping the dealer): when the only place left for it is up in the
 * HUD's rows (Hold'em on a phone on its side, the action bar the whole height of the screen), it's
 * set aside until the bar gives the room back. Every other panel is always placed.
 */
const SPARE = '.tip-dealer';
const AWAY = 'dock-away';

/** Panels that show for a moment (and get out of the way themselves), which a top panel isn't moved for. */
const TRANSIENT = ['celebrate', 'toast'];

/** Space between the bar and a panel, and between two panels, CSS px. */
export const DOCK_GAP = 8;
/** Kept clear of the screen's sides, CSS px. */
const EDGE = 8;

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One panel to place: its size, how it sits across, and where its stylesheet puts it. */
export interface Piece {
  at: Anchor;
  w: number;
  h: number;
  /** 'css': its stylesheet's left edge, and its bottom edge (screen y; null when it has none). */
  left?: number;
  floor?: number | null;
}

const overlaps = (a: Box, b: Box): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Where each piece goes over `bar` on a `w`-wide screen, given what's already low on it
 * (`others`: the visible bars and a game's own panels). Pure, for the tests: screen px, y down.
 */
export function stack(bar: Box, pieces: readonly Piece[], others: readonly Box[], w: number): Box[] {
  const placed: Box[] = [...others];
  const out: Box[] = [];
  for (const p of pieces) {
    const width = Math.min(p.w, w - 2 * EDGE);
    let left: number;
    if (p.at === 'start') left = bar.left;
    else if (p.at === 'end') left = bar.right - width;
    else left = p.left ?? bar.left;
    left = Math.max(EDGE, Math.min(left, w - EDGE - width));
    // as low as allowed: just over the bar, or (a 'css' piece clear of the bar) where its
    // stylesheet has it, if that's no lower than the bar's bottom
    let bottom = bar.top - DOCK_GAP;
    const across = left < bar.right && left + width > bar.left;
    if (p.at === 'css' && !across && p.floor != null) bottom = Math.max(bottom, Math.min(p.floor, bar.bottom));
    let box = { left, right: left + width, top: bottom - p.h, bottom };
    for (let n = 0; n < 12; n++) {
      const hit = placed.find((o) => overlaps(box, o));
      if (!hit) break;
      // over an end of the bar: slide along it toward the middle while there's room on the bar
      if (p.at !== 'css') {
        const slid = p.at === 'start' ? { ...box, left: hit.right + DOCK_GAP, right: hit.right + DOCK_GAP + width } : { ...box, right: hit.left - DOCK_GAP, left: hit.left - DOCK_GAP - width };
        if (slid.left >= Math.max(EDGE, bar.left) && slid.right <= Math.min(w - EDGE, bar.right) && !placed.some((o) => overlaps(slid, o))) {
          box = slid;
          break;
        }
      }
      box = { ...box, bottom: hit.top - DOCK_GAP, top: hit.top - DOCK_GAP - p.h };
    }
    placed.push(box);
    out.push(box);
  }
  return out;
}

const visible = (e: HTMLElement): boolean => !e.hidden && e.offsetWidth > 1 && e.offsetHeight > 1;
/** A box, in whole pixels, for comparing one arrangement's inputs with the next. */
const box = (e: HTMLElement): string => {
  const r = e.getBoundingClientRect();
  return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
};
/** What the board fit doesn't count either: boards drawn in the DOM, overlays that come and go (More, the command palette). */
const ignored = (e: HTMLElement): boolean => e.dataset.fit === 'ignore';

export class Dock {
  private readonly resized: ResizeObserver | null;
  private readonly added: MutationObserver | null;
  private readonly watched = new Set<Element>();
  /** The panels it has moved, so it can give them back to their stylesheet. */
  private readonly moved = new Set<HTMLElement>();
  private disposed = false;

  constructor(private readonly ui: HTMLElement) {
    this.resized = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.arrange()) : null;
    this.added = typeof MutationObserver === 'function' ? new MutationObserver(() => this.watchNew()) : null;
    this.added?.observe(ui, { childList: true });
    addEventListener('resize', this.arrange);
    this.watchNew();
  }

  /** Watch whatever is new among the UI's children (a bar or a panel shows up as a view mounts). */
  private watchNew(): void {
    if (this.disposed) return;
    for (const e of this.watched) {
      if (e.parentElement === this.ui) continue;
      this.resized?.unobserve(e);
      this.watched.delete(e);
    }
    for (const e of this.ui.children) {
      if (this.watched.has(e) || !(e instanceof HTMLElement) || !this.matters(e)) continue;
      this.watched.add(e);
      this.resized?.observe(e);
    }
    this.arrange();
  }

  private matters(e: HTMLElement): boolean {
    return e.matches(BAR) || e.matches(TOP) || DOCKED.some((d) => e.matches(d.sel)) || e.classList.contains('panel');
  }

  /** What the last arrangement was worked out from: the window, and every box that counts. */
  private last = '';

  /**
   * Put every panel that goes with the bar above it (and give them back when there's no bar).
   * Nothing is written when nothing it depends on has changed since the last time (the board fit
   * calls it a few times a second as a backstop): a glance at the boxes, read as they stand.
   */
  readonly arrange = (): void => {
    if (this.disposed) return;
    const kids = [...this.ui.children].filter((e): e is HTMLElement => e instanceof HTMLElement);
    const sig = [innerWidth, innerHeight, ...kids.filter((e) => this.watched.has(e)).map((e) => (visible(e) ? box(e) : '-'))].join('|');
    if (sig === this.last) return;
    const pieces: { el: HTMLElement; at: Anchor }[] = [];
    for (const d of DOCKED) for (const e of kids) if (e.matches(d.sel) && !pieces.some((p) => p.el === e)) pieces.push({ el: e, at: d.at });
    // writes first: each panel back to its stylesheet's place, so what's read next is that place
    for (const e of this.moved) for (const k of ['left', 'right', 'bottom', 'top', 'transform'] as const) e.style[k] = '';
    this.moved.clear();
    for (const p of pieces) p.el.classList.remove(AWAY);
    // then every read
    const W = innerWidth;
    const H = innerHeight;
    // (TOP's order: the History line first, then the dealer's line, which keeps clear of it)
    const tops = ['.th-history', '[data-dock="top"]', '.dealer-line'].flatMap((sel) => kids.filter((e) => e.matches(sel))).filter(visible);
    const steady = kids.filter((o) => !o.matches(TOP) && o.classList.contains('panel') && !TRANSIENT.some((c) => o.classList.contains(c)) && !ignored(o) && !o.closest('.chat') && visible(o)).map((o) => o.getBoundingClientRect());
    const placedTops: Box[] = [];
    const below = tops.map((e) => {
      const r = e.getBoundingClientRect();
      let top = r.top;
      // under every other table panel up here that it would meet (not what comes and goes: a
      // celebration's banner, a toast), and under a top panel placed before it
      for (let n = 0; n < 8; n++) {
        const box = { left: r.left, right: r.right, top, bottom: top + r.height };
        const hit = [...steady, ...placedTops].find((o) => overlaps(box, o));
        if (!hit) break;
        top = hit.bottom + DOCK_GAP;
      }
      placedTops.push({ left: r.left, right: r.right, top, bottom: top + r.height });
      return top === r.top ? null : top;
    });
    // (written last, with the rest: every read comes before any write)
    const writeTops = () =>
      tops.forEach((e, i) => {
        const top = below[i];
        if (top == null) return;
        e.style.top = `${Math.round(top)}px`;
        this.moved.add(e);
      });
    const bars = kids.filter((e) => e.matches(BAR) && visible(e)).map((e) => e.getBoundingClientRect());
    if (bars.length === 0) {
      writeTops();
      return this.settled();
    }
    const bar = bars.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    const shown = pieces.filter((p) => visible(p.el));
    const docked = new Set<Element>(pieces.map((p) => p.el));
    // a game's own panels low on the screen, which stay put: kept clear of (the chat moves itself)
    const others: Box[] = [...bars];
    for (const e of kids) {
      if (docked.has(e) || e.matches(BAR) || e.matches(TOP) || !e.classList.contains('panel') || ignored(e) || e.closest('.chat') || !visible(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.top > H * 0.4) others.push(r);
    }
    const sized = shown.map((p) => {
      const r = p.el.getBoundingClientRect();
      const b = getComputedStyle(p.el).bottom;
      return { at: p.at, w: r.width, h: r.height, left: r.left, floor: b.endsWith('px') ? H - parseFloat(b) : null };
    });
    const boxes = stack(bar, sized, others, W);
    // the HUD's rows: a spare panel that would have to go up there waits instead
    const hud = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--below-hud')) || 82;
    // and the writes
    writeTops();
    shown.forEach((p, i) => {
      const b = boxes[i]!;
      if (b.top < hud && p.el.matches(SPARE)) return void p.el.classList.add(AWAY);
      const s = p.el.style;
      s.bottom = `${Math.round(H - b.bottom)}px`;
      if (p.at !== 'css') {
        s.left = `${Math.round(b.left)}px`;
        s.right = 'auto';
        s.transform = 'none';
      }
      this.moved.add(p.el);
    });
    this.settled();
  };

  /** Note the boxes as the arrangement leaves them (read on the next frame, after the writes have taken). */
  private settled(): void {
    this.last = '';
    requestAnimationFrame(() => {
      if (this.disposed) return;
      const kids = [...this.ui.children].filter((e): e is HTMLElement => e instanceof HTMLElement);
      this.last = [innerWidth, innerHeight, ...kids.filter((e) => this.watched.has(e)).map((e) => (visible(e) ? box(e) : '-'))].join('|');
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resized?.disconnect();
    this.added?.disconnect();
    removeEventListener('resize', this.arrange);
    for (const e of this.moved) for (const k of ['left', 'right', 'bottom', 'top', 'transform'] as const) e.style[k] = '';
    this.moved.clear();
    this.watched.clear();
  }
}
