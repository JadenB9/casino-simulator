// The LED ticker over the pit: a long dot-matrix sign hung from the coffered ceiling above the
// dealers' side, one face toward each row of tables (the south face is also the one you see
// walking in from the doors). It scrolls the floor's recent big wins; when a new one lands it
// stops, blinks the winner's name, holds the amount, runs the whole line once and goes back to
// the list.
//
// One mesh, one material, one draw call. The housing, its brass trim and the hanging rods are
// vertex-coloured parts of the same geometry as the two LED faces, told apart by UV (the housing
// has none). The faces read a "tape" (ledfont.ts), one texel per LED, from a fixed 4096 x 9 canvas
// texture that is repainted only when the message changes; scrolling is a uniform, stepped a
// whole LED at a time the way a real sign moves.
//
// Someone who buys the Headline (fx/) owns the sign for two minutes: their name blinks, holds and
// runs as tonight's headliner, over and over, instead of the list (a big win still interrupts it,
// then the headline carries on).

import * as THREE from 'three';
import type { Quality } from '../render/engine3d.ts';
import { PIT_CEILING, type FloorPlan } from './layout.ts';
import { TAPE_ROWS, centred, layoutTape, textWidth, type Run, type Tape } from './ledfont.ts';
import { Merge, SIGN_COLORS, SIGN_VERTEX, signFragment } from './signbox.ts';

/** One line on the sign: who, how much, and what paid. */
export interface SignEntry {
  name: string;
  money: string;
  detail: string;
}

/** Metres between LED centres. */
const PITCH = 0.042;
const BEZEL = 0.05;
const DEPTH = 0.16;
/** The bottom of the housing: well over the dealers and the tallest thing on a table. */
const BOTTOM = 3.25;
/** LED columns per second while scrolling. */
const SPEED = 26;
const TAPE_W = 4096;
/** Entries the list shows before it starts again. */
const LOOP_MAX = 8;

// Colours are linear; the shader multiplies them past 1 so they bloom on the floor.
// Amber LEDs: saturated, so they stay orange through tone mapping instead of burning to white.
const AMBER: Run['color'] = [1, 0.36, 0.02];
const GOLD: Run['color'] = [1, 0.56, 0.08];
const DEEP: Run['color'] = [0.85, 0.2, 0.01];
const RED: Run['color'] = [1, 0.05, 0.02];

const IDLE: Run[] = [
  { text: 'WELCOME TO CASINO SIMULATOR', color: GOLD },
  { text: '   ◆   ', color: RED },
  { text: 'BLACKJACK · ROULETTE · CRAPS · BACCARAT · POKER · SLOTS', color: AMBER },
  { text: '   ◆   ', color: RED },
  { text: 'GOOD LUCK', color: GOLD },
  { text: '   ◆   ', color: RED },
];

interface Act {
  tape: Tape;
  mode: 'loop' | 'once' | 'hold';
  /** Part of a headline (taken down with it). */
  headline?: boolean;
  /** hold: seconds on the sign. */
  hold?: number;
  /** hold: seconds per blink, 0 for steady. */
  blink?: number;
  /** once: the scroll position at which the text has left the face. */
  end?: number;
}

export class Marquee {
  readonly mesh: THREE.Mesh;
  readonly cols: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly uniforms: {
    uTape: { value: THREE.Texture };
    uTapeW: { value: number };
    uGrid: { value: THREE.Vector2 };
    uScroll: { value: number };
    uGain: { value: number };
    uOn: { value: number };
  };
  private entries: SignEntry[] = [];
  private queue: Act[] = [];
  private act: Act;
  private t = 0;
  private pos = 0;
  /** The Headline's buyer and the seconds it has left on the sign. */
  private headliner: { name: string; left: number } | null = null;

  constructor(plan: FloorPlan, quality: Quality) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = TAPE_W;
    this.canvas.height = TAPE_ROWS;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;

    const { geometry, cols } = buildGeometry(plan);
    this.cols = cols;
    this.uniforms = {
      uTape: { value: this.texture },
      uTapeW: { value: 1 },
      uGrid: { value: new THREE.Vector2(cols, TAPE_ROWS) },
      uScroll: { value: 0 },
      uGain: { value: gainFor(quality) },
      uOn: { value: 1 },
    };
    const material = new THREE.ShaderMaterial({
      name: 'marquee',
      uniforms: this.uniforms,
      vertexShader: SIGN_VERTEX,
      fragmentShader: FRAGMENT,
      vertexColors: true,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'marquee';
    this.act = this.loopAct();
    this.show(this.act);
  }

  /** The list the sign loops through, newest first. Takes effect at once if the list is showing. */
  setEntries(list: readonly SignEntry[]): void {
    this.entries = list.slice(0, LOOP_MAX);
    if (this.act.mode === 'loop' && this.queue.length === 0) {
      this.act = this.loopAct();
      this.show(this.act);
    }
  }

  /** A new win: the name blinks, the amount holds, the line runs once, then back to the list. */
  announce(e: SignEntry): void {
    const nameW = textWidth(e.name);
    const moneyW = textWidth(e.money);
    const acts: Act[] = [
      { tape: layoutTape([{ text: e.name, color: GOLD }], { lead: centred(nameW, this.cols), minWidth: this.cols }), mode: 'hold', hold: 2.2, blink: 0.55 },
      { tape: layoutTape([{ text: e.money, color: GOLD }], { lead: centred(moneyW, this.cols), minWidth: this.cols }), mode: 'hold', hold: 2.4 },
      this.onceAct([
        { text: e.name, color: AMBER },
        { text: ' WON ', color: DEEP },
        { text: e.money, color: GOLD },
        { text: ' · ', color: RED },
        { text: e.detail, color: AMBER },
      ]),
    ];
    // Wins arriving together are all told, but a backlog never grows past two stories.
    while (this.queue.length >= 6) this.queue.splice(0, 3);
    this.queue.push(...acts);
    if (this.act.mode === 'loop') this.next();
  }

  /**
   * Put a name up as tonight's headliner for `secs` seconds (null takes it down). It takes over as
   * soon as whatever is on the sign now has finished; a list that's only scrolling gives way at once.
   */
  headline(name: string | null, secs = 0): void {
    const was = this.headliner?.name ?? null;
    this.headliner = name && secs > 0 ? { name, left: secs } : null;
    if (name && name !== was && this.act.mode === 'loop' && this.queue.length === 0) this.next();
    if (!name && was) {
      this.queue = this.queue.filter((a) => !a.headline);
      if (this.act.headline) this.next();
    }
  }

  /** The headliner's name while it's up. */
  get headlining(): string | null {
    return this.headliner?.name ?? null;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.headliner && (this.headliner.left -= dt) <= 0) this.headliner = null;
    const act = this.act;
    if (act.mode === 'hold') {
      this.uniforms.uScroll.value = 0;
      this.uniforms.uOn.value = act.blink && this.t % act.blink > act.blink * 0.62 ? 0 : 1;
      if (this.t >= (act.hold ?? 2)) this.next();
      return;
    }
    this.uniforms.uOn.value = 1;
    this.pos += SPEED * dt;
    if (act.mode === 'once' && this.pos >= (act.end ?? 0)) {
      this.next();
      return;
    }
    // keep the number small; the shader wraps it anyway
    if (act.mode === 'loop' && this.pos >= act.tape.width) this.pos -= act.tape.width;
    this.uniforms.uScroll.value = Math.floor(this.pos);
  }

  setQuality(q: Quality): void {
    this.uniforms.uGain.value = gainFor(q);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }

  // --- the program -------------------------------------------------------------------------------

  private next(): void {
    // with a headliner up, the headline plays whenever nothing else is waiting
    if (this.queue.length === 0 && this.headliner) this.queue.push(...this.headlineActs(this.headliner.name));
    this.act = this.queue.shift() ?? this.loopAct();
    this.show(this.act);
  }

  /** The headline: the name blinks, "HEADLINER" holds, then the whole line runs once. */
  private headlineActs(name: string): Act[] {
    const nameW = textWidth(name);
    const word = 'HEADLINER';
    return [
      { tape: layoutTape([{ text: name, color: GOLD }], { lead: centred(nameW, this.cols), minWidth: this.cols }), mode: 'hold', hold: 3, blink: 0.5, headline: true },
      { tape: layoutTape([{ text: word, color: AMBER }], { lead: centred(textWidth(word), this.cols), minWidth: this.cols }), mode: 'hold', hold: 1.6, headline: true },
      { ...this.onceAct(headlineRuns(name)), headline: true },
    ];
  }

  private show(act: Act): void {
    this.t = 0;
    this.pos = 0;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, TAPE_W, TAPE_ROWS);
    this.ctx.putImageData(new ImageData(act.tape.data as Uint8ClampedArray<ArrayBuffer>, act.tape.width, act.tape.height), 0, 0);
    this.texture.needsUpdate = true;
    this.uniforms.uTapeW.value = act.tape.width;
    this.uniforms.uScroll.value = 0;
    this.uniforms.uOn.value = 1;
  }

  /** The list: RECENT WINNERS, then each win, each followed by a diamond; the text enters from the right. */
  private loopAct(): Act {
    const runs: Run[] = [];
    if (this.entries.length === 0) {
      runs.push(...IDLE);
    } else {
      runs.push({ text: 'RECENT WINNERS', color: GOLD }, { text: '   ◆   ', color: RED });
      for (const e of this.entries) {
        runs.push(
          { text: e.name, color: AMBER },
          { text: '  ', color: AMBER },
          { text: e.money, color: GOLD },
          { text: '  ', color: AMBER },
          { text: e.detail, color: DEEP },
          { text: '   ◆   ', color: RED },
        );
      }
    }
    // Longer than the texture? Drop entries from the end until it fits.
    let tape = layoutTape(runs, { lead: this.cols, minWidth: this.cols * 2 });
    while (tape.width >= TAPE_W && runs.length > 8) {
      runs.splice(runs.length - 6, 6);
      tape = layoutTape(runs, { lead: this.cols, minWidth: this.cols * 2 });
    }
    return { tape, mode: 'loop' };
  }

  private onceAct(runs: Run[]): Act {
    const tape = layoutTape(runs, { lead: this.cols, maxWidth: TAPE_W });
    return { tape, mode: 'once', end: tape.width };
  }
}

/** The headline's running line. */
export function headlineRuns(name: string): Run[] {
  return [
    { text: "TONIGHT'S HEADLINER", color: AMBER },
    { text: '   ◆   ', color: RED },
    { text: name, color: GOLD },
    { text: '   ◆   ', color: RED },
    { text: 'LIVE ON THE FLOOR', color: DEEP },
  ];
}

function gainFor(q: Quality): number {
  // well past the floor's bloom threshold (1.65, bloom.ts) on High; seated, the threshold rises above it
  return q === 'high' ? 2.8 : 1.25;
}

// --- geometry ------------------------------------------------------------------------------------

/**
 * Where the sign hangs: centred over the staff area, on two rods that come down from the coffer
 * beams (room.ts lays them out the same way) so they never pass through a chandelier, which hang
 * in the middle of the coffers.
 */
export function marqueePlacement(plan: FloorPlan): { x: number; z: number; rods: [number, number]; length: number; cols: number; top: number } {
  const P = plan.pit;
  const pw = P.x1 - P.x0;
  const nx = Math.max(3, Math.round(pw / 2.3));
  const beams = Array.from({ length: nx + 1 }, (_, i) => P.x0 + (i * pw) / nx);
  const cx = (plan.staff.x0 + plan.staff.x1) / 2;
  const nearest = (x: number) => beams.reduce((b, v) => (Math.abs(v - x) < Math.abs(b - x) ? v : b), beams[0]!);
  let left = nearest(cx - 2.4);
  let right = nearest(cx + 2.4);
  if (right - left < 3) {
    // a narrow pit's beams are far apart: fall back to rods just inside the sign's ends
    left = cx - 2.3;
    right = cx + 2.3;
  }
  const cols = Math.floor((right - left + 0.9 - 2 * BEZEL) / PITCH);
  const length = cols * PITCH + 2 * BEZEL;
  return { x: (left + right) / 2, z: (plan.staff.z0 + plan.staff.z1) / 2, rods: [left, right], length, cols, top: PIT_CEILING - 0.34 };
}

function buildGeometry(plan: FloorPlan): { geometry: THREE.BufferGeometry; cols: number } {
  const place = marqueePlacement(plan);
  const faceW = place.cols * PITCH;
  const faceH = TAPE_ROWS * PITCH;
  const H = faceH + 2 * BEZEL;
  const cy = BOTTOM + H / 2;
  const out = new Merge();
  const { x, z } = place;

  out.box(x, cy, z, place.length, H, DEPTH, SIGN_COLORS.body);
  // brass frames round both faces, standing a little proud of the housing
  for (const side of [1, -1]) {
    const fz = z + side * (DEPTH / 2 + 0.004);
    const t = 0.012;
    out.box(x, cy + faceH / 2 + t / 2, fz, faceW + 2 * t, t, 0.008, SIGN_COLORS.brass);
    out.box(x, cy - faceH / 2 - t / 2, fz, faceW + 2 * t, t, 0.008, SIGN_COLORS.brass);
    out.box(x - faceW / 2 - t / 2, cy, fz, t, faceH, 0.008, SIGN_COLORS.brass);
    out.box(x + faceW / 2 + t / 2, cy, fz, t, faceH, 0.008, SIGN_COLORS.brass);
  }
  for (const rx of place.rods) out.rod(rx, z, cy + H / 2, place.top, SIGN_COLORS.chrome, SIGN_COLORS.brass);
  // the two LED faces, each reading left to right from its own side
  out.face(x, cy, z + DEPTH / 2 + 0.003, faceW, faceH, 0);
  out.face(x, cy, z - DEPTH / 2 - 0.003, faceW, faceH, Math.PI);
  return { geometry: out.build(), cols: place.cols };
}

// --- shader ----------------------------------------------------------------------------------------

const FRAGMENT = signFragment(
  /* glsl */ `
  uniform sampler2D uTape;
  uniform float uTapeW;
  uniform vec2 uGrid;
  uniform float uScroll;
  uniform float uGain;
  uniform float uOn;`,
  /* glsl */ `
      vec2 cell = vUv * uGrid;
      vec2 id = floor(cell);
      vec2 f = fract(cell) - 0.5;
      float x = mod(id.x + uScroll, uTapeW);
      vec3 led = texture2D(uTape, vec2((x + 0.5) / ${TAPE_W}.0, (id.y + 0.5) / uGrid.y)).rgb * uOn;
      // round LEDs, antialiased; from far off a cell is smaller than a pixel, so the dots fade to
      // their average instead of shimmering
      float w = fwidth(cell.x);
      float dotMask = 1.0 - smoothstep(0.36 - w, 0.36 + w, length(f));
      dotMask = mix(dotMask, 0.4, smoothstep(0.3, 0.8, w));
      vec3 unlit = vec3(0.05, 0.022, 0.012);
      c = (unlit + led * uGain) * dotMask + vec3(0.008, 0.006, 0.005);`,
);
