// Touch controls for phones and tablets. On the floor: a thumb stick low on the left (just above
// the site's back chip, which keeps the corner itself), drag-to-look everywhere else on the floor
// view, and a large action button over the right thumb whenever a table, a machine or the cashier
// is in reach. At a table the stick and the look layer step aside so taps land on the felt and the
// table's own buttons, and a Leave button joins the HUD. A phone held upright at a table too wide
// for it (roulette, craps, the poker room, a lounge computer) gets one quiet note to turn it
// sideways.
//
// Nothing here moves the player or opens anything itself: the stick and the drags go through the
// walker's input API (Player.setMoveInput / addLook), and the two buttons press E and Esc, so a
// tap does exactly what the key does, with the same checks. The page never scrolls or zooms:
// index.html's viewport and ui/mobile.css stop most of it, and Safari's pinch is stopped here.

import { el } from '../ui/kit.ts';
import { overlayCount } from '../ui/keyboard.ts';
import { isMobile } from '../render/engine3d.ts';
import type { Player } from './player.ts';
import type { WorldStation } from './stations.ts';
import type { GameId } from '../../../shared/src/engine.ts';
import { CATALOG } from '../../../shared/src/games/catalog.ts';
import './touch.css';

/** How far the knob travels from the centre, px. */
const TRAVEL = 46;
/** Inside this share of the travel the stick is at rest (a resting thumb wobbles). */
const DEAD = 0.14;
/** Pulled this far past the rim (share of the travel), the walk becomes a run. */
const RUN_AT = 1.35;
/** Half the stick's ring, px (touch.css draws it 132 px across). */
const RING = 66;
/** The site's back chip: 30 px tall, 14 px off the bottom-left corner. The stick stays above it. */
const CHIP_TOP = 14 + 30 + 12;
/** A touch this far across from the left (share of the width), and below the top share, drives the stick. */
const STICK_X = 0.45;
const STICK_Y = 0.3;
/** A drag across the screen's shorter side turns the camera half way round (on a tablet, across 540 px). */
const LOOK_TURN = Math.PI;
const LOOK_SPAN = 540;
const LOOK_PITCH = 0.7;
/**
 * Games an upright phone can't really play: the layout runs off both sides (or, at video poker,
 * the button deck does), so they get the note, as does every computer in the online lounge (its
 * wide website). At the card tables your own spot and every button fit upright, and a slot
 * machine is tall anyway.
 */
const WIDE = new Set<GameId>(['roulette', 'craps', 'sicbo', 'bigsix', 'holdem', 'videopoker']);
const wide = (game: GameId) => WIDE.has(game) || CATALOG[game]?.online === true;
/** A portrait screen narrower than this (width / height) gets the note at a table. */
const NARROW = 0.7;
const NOTE_MS = 6000;

type Mode = 'off' | 'walk' | 'table';

export interface TouchDeps {
  player: Player;
  /** Where the controls go (#ui); the floor's "Press E" prompt lives here too. */
  ui: HTMLElement;
  /** The station the player is sitting at (from E until they stand up), if any. */
  seated(): WorldStation | null;
  /** The station within reach, if any (the cashier shows only through the floor's prompt). */
  focus(): WorldStation | null;
  /** What E would do at some other spot in reach ("Sit", "Bank"), if that's what the prompt offers. */
  spot?(): string | null;
  /** The mouse-look sensitivity setting (1 = default); drags follow it too. */
  sensitivity?(): number;
}

/**
 * Press a key the way the keyboard would, so the floor and the tables handle a tap exactly like
 * the key. From the page itself, not a text field that may still have focus: the tap meant it.
 */
function press(key: string, code: string): void {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
  document.body.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true }));
}

/**
 * What the stick says for a thumb `dx`, `dy` px from where it came down: a direction (x to the
 * right, y forward) scaled by the pace, which climbs from nothing at the edge of the dead zone to a
 * full walk at the rim, and a run once the thumb is pulled well past the rim.
 */
export function stickInput(dx: number, dy: number): { x: number; y: number; run: boolean } {
  const d = Math.hypot(dx, dy);
  if (!(d >= TRAVEL * DEAD)) return { x: 0, y: 0, run: false };
  const pace = (Math.min(d, TRAVEL) / TRAVEL - DEAD) / (1 - DEAD);
  return { x: (dx / d) * pace, y: (-dy / d) * pace, run: d > TRAVEL * RUN_AT };
}

const NS = 'http://www.w3.org/2000/svg';

/** A line icon on the menu icons' 24-unit grid (ui/menu/icons.ts). */
function lineIcon(...paths: string[]): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ico');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  for (const d of paths) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}

/** A door with an arrow leaving through it. */
const leaveIcon = () => lineIcon('M13.5 4.5H6.8v15h6.7', 'M10.5 12h9.5', 'M16.6 8.6 20 12l-3.4 3.4');
/** A phone turning onto its side. */
const rotateIcon = () =>
  lineIcon('M5.5 13.5v-9a1.5 1.5 0 0 1 1.5-1.5h5a1.5 1.5 0 0 1 1.5 1.5v4', 'M8.6 5.4h1.8', 'M10.5 19.5h9a1.5 1.5 0 0 0 1.5-1.5v-5a1.5 1.5 0 0 0-1.5-1.5h-9A1.5 1.5 0 0 0 9 13v5a1.5 1.5 0 0 0 1.5 1.5z', 'M3.6 16.4a5 5 0 0 0 4 3.9', 'M6.4 21.2l1.3-.9-.9-1.3');

export class TouchControls {
  private on: boolean;
  private mode: Mode = 'off';
  private readonly layer = el('div', 'touch-layer');
  private readonly ring = el('div', 'touch-stick');
  private readonly knob = el('div', 'touch-knob');
  private readonly act = el('button', 'touch-act');
  private readonly actLabel = el('span', 'touch-act-label');
  private readonly caption = el('div', 'touch-caption');
  private readonly leave = el('button', 'touch-leave');
  private readonly note = el('div', 'touch-note');
  private readonly noteText = el('span');
  /** The finger on the stick and where it came down. */
  private stick: { id: number; x0: number; y0: number } | null = null;
  private look: { id: number; x: number; y: number } | null = null;
  /** Whether the touch that just came down landed on something that scrolls or slides. */
  private mayScroll = false;
  private prompt: HTMLElement | null = null;
  private target = '';
  /** The station the note was last shown (or dismissed) for; it comes back at the next table. */
  private notedFor: WorldStation | null = null;
  private noteTimer = 0;

  constructor(private readonly deps: TouchDeps) {
    this.on = isMobile();
    this.layer.hidden = true;
    this.layer.setAttribute('aria-hidden', 'true');
    this.ring.append(this.knob);
    this.layer.append(this.ring);

    this.act.type = 'button';
    this.act.hidden = true;
    this.act.append(this.actLabel);
    this.act.addEventListener('click', () => press('e', 'KeyE'));
    this.caption.hidden = true;
    this.caption.setAttribute('role', 'status');

    this.leave.type = 'button';
    this.leave.hidden = true;
    this.leave.title = 'Leave the table';
    this.leave.setAttribute('aria-label', 'Leave the table');
    this.leave.append(leaveIcon(), el('span', 'touch-leave-label', 'Leave'));
    this.leave.addEventListener('click', () => press('Escape', 'Escape'));

    this.note.hidden = true;
    this.note.setAttribute('role', 'status');
    this.note.append(rotateIcon(), this.noteText);
    this.note.addEventListener('click', () => this.hideNote());

    deps.ui.prepend(this.layer);
    deps.ui.append(this.caption, this.act, this.note);

    this.layer.addEventListener('pointerdown', this.onDown);
    this.layer.addEventListener('pointermove', this.onMove);
    this.layer.addEventListener('pointerup', this.onUp);
    this.layer.addEventListener('pointercancel', this.onUp);
    this.layer.addEventListener('lostpointercapture', this.onUp);
    this.layer.addEventListener('contextmenu', this.stopDefault);
    addEventListener('pointerdown', this.onAnyPointer, true);
    addEventListener('blur', this.onBlur);
    // Safari ignores user-scalable=no; its pinch arrives as gesture events and two-finger touchmoves.
    document.addEventListener('gesturestart', this.stopDefault);
    document.addEventListener('gesturechange', this.stopDefault);
    document.addEventListener('touchstart', this.onTouchStart, { passive: true });
    document.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.paintOn();
  }

  /** Every frame: which controls the moment calls for, and what the action button would do. */
  update(): void {
    const seated = this.deps.seated();
    const clear = overlayCount() === 0;
    const mode: Mode = !this.on || !clear ? 'off' : seated ? 'table' : this.deps.player.isEnabled ? 'walk' : 'off';
    if (mode !== this.mode) this.setMode(mode);
    if (mode === 'walk') this.paintTarget();
    else if (mode === 'table') this.paintTable(seated!);
  }

  dispose(): void {
    this.setMode('off');
    clearTimeout(this.noteTimer);
    removeEventListener('pointerdown', this.onAnyPointer, true);
    removeEventListener('blur', this.onBlur);
    document.removeEventListener('gesturestart', this.stopDefault);
    document.removeEventListener('gesturechange', this.stopDefault);
    document.removeEventListener('touchstart', this.onTouchStart);
    document.removeEventListener('touchmove', this.onTouchMove);
    document.documentElement.classList.remove('touch-ui');
    this.layer.remove();
    this.caption.remove();
    this.act.remove();
    this.leave.remove();
    this.note.remove();
  }

  // --- modes --------------------------------------------------------------------------------------

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.endStick();
    this.endLook();
    this.layer.hidden = mode !== 'walk';
    this.target = '';
    this.act.hidden = true;
    this.caption.hidden = true;
    if (mode !== 'table') {
      this.leave.hidden = true;
      this.leave.remove();
      this.hideNote();
    }
    // Stood up: the next table gets its note again.
    if (!this.deps.seated()) this.notedFor = null;
  }

  /** The action button: shown while the floor's prompt is (a station or the cashier in reach). */
  private paintTarget(): void {
    const prompt = this.prompt?.isConnected ? this.prompt : (this.prompt = this.deps.ui.querySelector<HTMLElement>('.world-prompt'));
    const station = this.deps.focus();
    const spot = station ? null : (this.deps.spot?.() ?? null);
    const key = !prompt || prompt.hidden ? '' : (station?.id ?? (spot ? `spot:${spot}` : 'cashier'));
    if (key === this.target) return;
    this.target = key;
    this.act.hidden = this.caption.hidden = !key;
    if (!key) return;
    if (spot) {
      // "Order a drink" is the whole caption; the button says its first word. A one-word spot
      // ("Sit", "Bank", "Browse") is all on the button: the caption would only say it again.
      const first = spot.split(' ')[0]!;
      this.actLabel.textContent = first;
      this.act.setAttribute('aria-label', spot);
      this.caption.textContent = spot;
      this.caption.hidden = first === spot;
      return;
    }
    this.actLabel.textContent = station ? 'Play' : 'Visit';
    this.act.setAttribute('aria-label', station ? `Play ${station.name}` : 'Open the cashier');
    this.caption.textContent = station ? [station.name, station.limits].filter(Boolean).join(' · ') : 'Cashier';
  }

  /** At a table: the Leave button in the HUD's controls, and the note for an upright phone. */
  private paintTable(station: WorldStation): void {
    if (this.leave.hidden || !this.leave.isConnected) {
      // In the HUD's right-hand bar when there is one (the game proper), else on its own.
      const bar = document.querySelector('.hud .hud-right');
      this.leave.classList.toggle('alone', !bar);
      if (bar) bar.prepend(this.leave);
      else this.deps.ui.append(this.leave);
      this.leave.hidden = false;
    }
    const upright = innerWidth / innerHeight < NARROW;
    if (!upright || !wide(station.game)) {
      this.hideNote();
      return;
    }
    // After the station's panel (single player or a lobby) has gone: that choice fits upright.
    if (this.notedFor !== station && !document.querySelector('.lobby')) {
      this.notedFor = station;
      const what = station.game === 'videopoker' ? 'machine' : CATALOG[station.game]?.online ? 'screen' : 'table';
      this.noteText.textContent = `Turn your phone sideways to see the whole ${what}.`;
      this.note.hidden = false;
      clearTimeout(this.noteTimer);
      this.noteTimer = window.setTimeout(() => this.hideNote(), NOTE_MS);
    }
  }

  private hideNote(): void {
    clearTimeout(this.noteTimer);
    this.note.hidden = true;
  }

  // --- the stick and the look drags ---------------------------------------------------------------

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    e.preventDefault();
    const inStickZone = e.clientX < innerWidth * STICK_X && e.clientY > innerHeight * STICK_Y;
    if (inStickZone && !this.stick) {
      // The ring comes to the thumb, kept whole on screen and clear of the back chip.
      const cx = Math.max(RING + 8, Math.min(innerWidth * STICK_X, e.clientX));
      const cy = Math.max(RING + 8, Math.min(innerHeight - CHIP_TOP - RING, e.clientY));
      this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      this.ring.classList.add('held');
      this.ring.style.left = `${cx - RING}px`;
      this.ring.style.top = `${cy - RING}px`;
      this.ring.style.bottom = 'auto';
      this.knob.style.transform = '';
    } else if (!this.look) {
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    } else {
      return;
    }
    this.layer.setPointerCapture?.(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    const s = this.stick;
    if (s && e.pointerId === s.id) {
      const dx = e.clientX - s.x0;
      const dy = e.clientY - s.y0;
      const d = Math.hypot(dx, dy);
      const k = d > TRAVEL ? TRAVEL / d : 1;
      this.knob.style.transform = `translate(${(dx * k).toFixed(1)}px, ${(dy * k).toFixed(1)}px)`;
      const move = stickInput(dx, dy);
      this.ring.classList.toggle('run', move.run);
      this.deps.player.setMoveInput(move.x, move.y, move.run);
      return;
    }
    const l = this.look;
    if (l && e.pointerId === l.id) {
      const rate = (LOOK_TURN / Math.max(1, Math.min(innerWidth, innerHeight, LOOK_SPAN))) * (this.deps.sensitivity?.() ?? 1);
      this.deps.player.addLook((e.clientX - l.x) * rate, (e.clientY - l.y) * rate * LOOK_PITCH);
      l.x = e.clientX;
      l.y = e.clientY;
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (this.stick?.id === e.pointerId) this.endStick();
    else if (this.look?.id === e.pointerId) this.endLook();
  };

  private endStick(): void {
    const s = this.stick;
    this.stick = null;
    this.deps.player.setMoveInput(0, 0);
    this.ring.classList.remove('held', 'run');
    this.ring.style.left = this.ring.style.top = this.ring.style.bottom = '';
    this.knob.style.transform = '';
    if (s && this.layer.hasPointerCapture?.(s.id)) this.layer.releasePointerCapture(s.id);
  }

  private endLook(): void {
    const l = this.look;
    this.look = null;
    if (l && this.layer.hasPointerCapture?.(l.id)) this.layer.releasePointerCapture(l.id);
  }

  // --- touch or mouse -----------------------------------------------------------------------------

  /** A touch turns the controls on (a touch laptop, say); a mouse click turns them off again. */
  private onAnyPointer = (e: PointerEvent): void => {
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (touch === this.on || (e.pointerType !== 'mouse' && !touch)) return;
    this.on = touch;
    this.paintOn();
  };

  private paintOn(): void {
    document.documentElement.classList.toggle('touch-ui', this.on);
  }

  private onBlur = (): void => {
    this.endStick();
    this.endLook();
  };

  private onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length === 1) this.mayScroll = scrollsOrSlides(e.target);
  };

  /** No page scroll or pinch: only a sheet's own scrolling list, or a slider, may take a drag. */
  private onTouchMove = (e: TouchEvent): void => {
    if (e.cancelable && (e.touches.length > 1 || !this.mayScroll)) e.preventDefault();
  };

  private stopDefault = (e: Event): void => e.preventDefault();
}

/** Whether a drag starting on `t` belongs to something that scrolls or slides under the finger. */
function scrollsOrSlides(t: EventTarget | null): boolean {
  for (let n = t instanceof Element ? t : null; n && n !== document.body; n = n.parentElement) {
    if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement || n instanceof HTMLSelectElement) return true;
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return true;
    const ox = getComputedStyle(n).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth) return true;
  }
  return false;
}
