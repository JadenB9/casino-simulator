// Own the Night: the whole casino is the buyer's for a minute, the most expensive thing in the
// game, and it opens like a show. Every room's lights drop nearly to black for a breath; then a
// shell cracks overhead, the lights come up gold with a flash, a curtain of gold paper falls from
// the ceiling round you, and a fanfare plays. From there to the end: the buyer's name on every sign
// and screen (the pit's LED sign runs the Headline, the slots hall's win meter and every monitor in
// the online lounge say whose night it is), thrown in gold light across the floor of the room
// you're in from a gobo projector; shells bursting under the ceiling wherever you are, gold,
// champagne and crimson stars falling slowly and crackling, now and then two at once; and the
// gold of Golden Hour (the warm light, the shafts, the coins) everywhere under it all. Everyone
// sees it, in every room. The signs and screens get their own faces back at the end.

import * as THREE from 'three';
import type { FxEvent } from '../../../../shared/src/items.ts';
import type { Marquee } from '../marquee.ts';
import { ceilingAt, inRect, roomAt, type FloorPlan, type PlannedRoom } from '../layout.ts';
import { Bits, Sparks, stepPaper } from './particles.ts';
import type { Stock } from './stock.ts';
import type { Effect, FxWorld } from './types.ts';
import { envelope } from './timing.ts';
import { golden } from './golden.ts';
import { headline } from './headline.ts';
import type { Hanger } from './disco.ts';

/** Stars in a shell, and seconds between shells on average. */
const STARS = { high: 180, low: 80 };
const EVERY = 1.1;
/** The blackout before the show, in seconds. */
const REVEAL = 1.6;
/** Pieces in the curtain of gold paper at the reveal. */
const CURTAIN = { high: 520, low: 240 };
const PAPER = ['#f0c14e', '#f7dc95', '#f6f1e6', '#d9a43a'].map((c) => new THREE.Color(c));
const STAR_COLORS = ['#ffc34a', '#ffe9b8', '#d8263a', '#ffb02e'].map((c) => new THREE.Color(c));

export function takeover(w: FxWorld, stock: Stock, ev: FxEvent, late: boolean, sign: () => Marquee | null, hangers: readonly Hanger[]): Effect {
  const q = w.quality();
  // the Headline's own fanfare gives way to the show's
  const parts = [headline(w, ev, true, sign), golden(w, stock, ev, late)];
  const stars = new Sparks(STARS[q] * 6, { hot: '#fffaf0', cool: '#ffffff', gain: q === 'high' ? 5 : 2.2, width: 0.03, len: 0.09, name: 'fx-fireworks' });
  const gobo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), goboMaterial(ev.name));
  gobo.frustumCulled = false;
  const curtain = new Bits(stock.paperGeo, stock.paper(q), CURTAIN[q], 'fx-curtain');
  w.root.add(stars.mesh, gobo, curtain.mesh);
  const screens = new Screens(w, ev.name);
  let goboRoom = '';
  let next = 0.4;
  let revealed = false;
  let first = true;
  let gone = false;
  const tint = new THREE.Color();
  const ahead = new THREE.Vector3();
  const id = `takeover:${ev.id}:${ev.at}`;

  const burst = () => {
    const e = w.camera.position;
    const room = roomAt(w.plan, e.x, e.z);
    if (!room) return;
    // somewhere ahead of you in the room you're in, not right over your head
    w.camera.getWorldDirection(ahead);
    const look = Math.atan2(ahead.z, ahead.x);
    for (let tries = 0; tries < 12; tries++) {
      const a = look + (Math.random() - 0.5) * 1.8;
      const d = 3 + Math.random() * 5;
      const x = e.x + Math.cos(a) * d;
      const z = e.z + Math.sin(a) * d;
      const shell = shellAt(w.plan, room, hangers, x, z);
      if (!shell) continue;
      const { y, r } = shell;
      tint.copy(STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]!);
      // the stars travel about speed / drag before the air stops them
      const speed = (r / 1.5) * (3.4 + Math.random() * 0.6);
      for (let i = 0; i < STARS[q]; i++) {
        // evenly round a sphere, a little ragged
        const u = Math.random() * 2 - 1;
        const phi = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const v = speed * (0.85 + Math.random() * 0.25);
        stars.spawn(x, y, z, s * Math.cos(phi) * v, u * v, s * Math.sin(phi) * v, 1.3 + Math.random() * 0.8, tint);
      }
      w.sounds?.firework({ x, y, z }, 1);
      return;
    }
  };

  /** The gold paper let go from the ceiling over the room round you. */
  const dropCurtain = () => {
    const e = w.camera.position;
    const room = roomAt(w.plan, e.x, e.z);
    if (!room) return;
    const L = room.inner;
    for (let i = 0; i < CURTAIN[q]; i++) {
      const x = Math.min(L.x1 - 0.2, Math.max(L.x0 + 0.2, e.x + (Math.random() - 0.5) * 11));
      const z = Math.min(L.z1 - 0.2, Math.max(L.z0 + 0.2, e.z + (Math.random() - 0.5) * 11));
      const top = Math.min(5.5, ceilingAt(w.plan, x, z) - 0.1) - Math.random() * 1.2;
      curtain.spawn(x, top, z, 0, -0.3, 0, 0.8 + Math.random() * 0.6, PAPER[i % PAPER.length]!, 6 + Math.random() * 10);
    }
  };

  return {
    update(dt, t, left, view) {
      // joined after the reveal: no blackout, no curtain, no opening sounds
      if (first) {
        first = false;
        revealed = t > REVEAL;
      }
      if (!revealed) {
        // the blackout: every room's light drops away, then the show (only dimmed, with flashing
        // and motion turned down)
        const k = Math.min(1, t / 0.5);
        w.lighting.setTint(id, { color: '#150c18', k: 0.7 * k, dim: 1 - (w.calm() ? 0.45 : 0.85) * k });
        if (t < REVEAL) return true;
        revealed = true;
        w.sounds?.firework(null, 1.5);
        w.sounds?.marquee(null, 1);
        dropCurtain();
        next = 0.1;
      }
      // the flash as the lights come up, fading into the gold
      const still = w.calm();
      // (no flash with flashing turned down: the gold comes up on its own, a second slower)
      const flash = still ? 0 : Math.max(0, 1 - (t - REVEAL) / 0.8);
      stars.uniforms.uGain.value = (q === 'high' ? 5 : 2.2) * (still ? 0.45 : 1);
      w.lighting.setTint(id, left > 0 && flash > 0 ? { color: '#ffd27a', k: 0.5 * flash, dim: 1 + 1.4 * flash } : null);
      let alive = false;
      for (const p of parts) alive = p.update(dt, Math.max(0, t - REVEAL), left, view) || alive;
      if (left > 2 && (next -= dt) <= 0) {
        next = EVERY * (0.6 + Math.random() * 0.8) * (still ? 2 : 1);
        burst();
        // now and then a second shell a beat later
        if (!still && Math.random() < 0.3) setTimeout(() => !gone && burst(), 180);
      }
      // the stars hang and drift down, the way a willow shell's do
      stars.step(dt, 2.2, 2.6);
      stars.commit();
      stepPaper(curtain, dt, { fall: 0.6, sway: 0.45, drag: 2, size: 0.03 });
      curtain.commit(Math.min(1, left / 1.5));
      // the name on the floor of the room you're in, turning slowly
      if (view.here !== goboRoom) {
        goboRoom = view.here;
        placeGobo(w, gobo, goboRoom);
      }
      gobo.rotation.y = t * 0.12;
      const k = envelope(Math.max(0, t - REVEAL), left, 1, 2);
      ((gobo.material as THREE.MeshBasicMaterial).color as THREE.Color).setRGB(1, 0.78, 0.36).multiplyScalar(0.9 * k * (still ? 0.95 : 0.9 + 0.1 * Math.sin(t * 2.3)));
      if (left > 0) screens.on();
      else screens.off();
      return alive || left > 0 || stars.n > 0;
    },
    dispose() {
      gone = true;
      for (const p of parts) p.dispose();
      w.lighting.setTint(id, null);
      screens.off();
      screens.dispose();
      stars.dispose();
      curtain.dispose();
      gobo.removeFromParent();
      gobo.geometry.dispose();
      const m = gobo.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    },
  };
}

/** How far a shell's stars travel at the most (m), and the room they're given all round. */
export const SHELL_R = 1.5;
const SHELL_CLEAR = 0.3;

/**
 * Where a shell may burst over (x, z) in a room, and how wide: sized to the room so its stars
 * stop short of the ceiling, the walls and whatever hangs there (chandeliers, signs). Null if
 * there's no room for one.
 */
export function shellAt(plan: FloorPlan, room: PlannedRoom, hangers: readonly Hanger[], x: number, z: number): { y: number; r: number } | null {
  // the lowest ceiling the stars could reach (the pit's coffers stand higher than round them)
  let top = ceilingAt(plan, x, z);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) top = Math.min(top, ceilingAt(plan, x + dx * SHELL_R, z + dz * SHELL_R));
  const y = Math.min(4.2, Math.max(2.2, top - 1.4));
  const r = Math.min(SHELL_R, top - y - SHELL_CLEAR);
  if (r < 0.6) return null;
  if (!inRect(room.inner, x, z, -(r + SHELL_CLEAR))) return null;
  if (hangers.some((h) => Math.hypot(h.x - x, h.z - z) < h.r + r + SHELL_CLEAR)) return null;
  return { y, r };
}

/** A slot machine's topper face, in its cabinet's own frame: where a name card fits over it. */
export function topperCard(l: { topper: string; top: number; width: number }): { x: number; y: number; z: number; w: number; h: number } {
  if (l.topper === 'arch') return { x: 0, y: l.top + 0.118, z: 0.156, w: 0.48, h: 0.165 };
  if (l.topper === 'sign') return { x: 0, y: l.top + 0.12, z: 0.126, w: l.width - 0.08, h: 0.17 };
  return { x: 0, y: l.top + 0.26, z: 0.136, w: 0.34, h: 0.14 };
}

/**
 * The buyer's name on every screen and sign that can show one: the online lounge's monitors (each
 * one's glass is given a picture of the name in place of its game's attract picture), the slots
 * hall's win meter (its face) and every slot machine's topper (a lit card with the name over its
 * printed face, all of them one instanced mesh). Nothing of theirs is changed: at the end each gets
 * its own back.
 */
class Screens {
  private readonly monitor: THREE.MeshBasicMaterial;
  private readonly meter: THREE.CanvasTexture;
  private readonly cards: THREE.InstancedMesh | null;
  private readonly borrowed = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private tallyFace: { uniform: { value: THREE.Texture }; own: THREE.Texture } | null = null;
  private lit = false;

  constructor(
    private readonly w: FxWorld,
    name: string,
  ) {
    const tex = new THREE.CanvasTexture(monitorCanvas(name));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.monitor = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    this.monitor.name = 'fx-takeover-screen';
    this.meter = new THREE.CanvasTexture(meterCanvas(name));
    this.meter.colorSpace = THREE.SRGBColorSpace;
    this.meter.anisotropy = 4;
    const card = new THREE.CanvasTexture(cardCanvas(name));
    card.colorSpace = THREE.SRGBColorSpace;
    card.anisotropy = 4;
    this.cards = toppers(w, card);
  }

  on(): void {
    if (this.lit) return;
    this.lit = true;
    this.w.stations.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.name === 'pc-screen' && !this.borrowed.has(m)) {
        this.borrowed.set(m, m.material);
        m.material = this.monitor;
      }
    });
    if (this.cards) this.w.root.add(this.cards);
    const face = ((this.w.tally()?.material as THREE.ShaderMaterial | undefined)?.uniforms?.uFace ?? null) as { value: THREE.Texture } | null;
    if (face) {
      this.tallyFace = { uniform: face, own: face.value };
      face.value = this.meter;
    }
  }

  off(): void {
    if (!this.lit) return;
    this.lit = false;
    for (const [m, own] of this.borrowed) if (m.material === this.monitor) m.material = own;
    this.borrowed.clear();
    this.cards?.removeFromParent();
    if (this.tallyFace && this.tallyFace.uniform.value === this.meter) this.tallyFace.uniform.value = this.tallyFace.own;
    this.tallyFace = null;
  }

  dispose(): void {
    this.monitor.map?.dispose();
    this.monitor.dispose();
    this.meter.dispose();
    if (this.cards) {
      (this.cards.material as THREE.MeshBasicMaterial).map?.dispose();
      (this.cards.material as THREE.Material).dispose();
      this.cards.geometry.dispose();
      this.cards.dispose();
    }
  }
}

/** A card over every slot machine's topper (their cabinets' handles say where), sharing the monitors' picture. */
function toppers(w: FxWorld, picture: THREE.Texture): THREE.InstancedMesh | null {
  const places: THREE.Matrix4[] = [];
  const local = new THREE.Matrix4();
  w.stations.traverse((o) => {
    const h = o.userData.slots as { root?: THREE.Object3D; layout?: { topper: string; top: number; width: number } } | undefined;
    if (!h?.root || !h.layout?.topper) return;
    h.root.updateWorldMatrix(true, false);
    const c = topperCard(h.layout);
    local.compose(new THREE.Vector3(c.x, c.y, c.z), new THREE.Quaternion(), new THREE.Vector3(c.w, c.h, 1));
    places.push(h.root.matrixWorld.clone().multiply(local));
  });
  if (places.length === 0) return null;
  const m = new THREE.MeshBasicMaterial({ map: picture, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  m.name = 'fx-takeover-topper';
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), m, places.length);
  mesh.name = 'fx-toppers';
  places.forEach((p, i) => mesh.setMatrixAt(i, p));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** A monitor's picture (the attract pictures' size): the name in gold on a black stage. */
function monitorCanvas(name: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const g = c.getContext('2d')!;
  const bg = g.createRadialGradient(256, 170, 20, 256, 170, 300);
  bg.addColorStop(0, '#2a1a08');
  bg.addColorStop(1, '#070504');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 320);
  g.strokeStyle = '#c99a3e';
  g.lineWidth = 3;
  g.strokeRect(14, 14, 484, 292);
  g.lineWidth = 1;
  g.strokeRect(22, 22, 468, 276);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#d9b36a';
  g.font = '600 20px "Barlow Condensed", sans-serif';
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '6px';
  g.fillText('TONIGHT BELONGS TO', 256, 88);
  let size = 64;
  do {
    g.font = `700 ${size}px Cinzel, Georgia, serif`;
    size -= 4;
  } while (g.measureText(name.toUpperCase()).width > 440 && size > 22);
  const gold = g.createLinearGradient(0, 130, 0, 200);
  gold.addColorStop(0, '#fff1c4');
  gold.addColorStop(0.5, '#f0c14e');
  gold.addColorStop(1, '#b8862e');
  g.fillStyle = gold;
  g.fillText(name.toUpperCase(), 256, 165);
  g.fillStyle = '#d9b36a';
  g.font = '600 18px "Barlow Condensed", sans-serif';
  g.fillText('OWN THE NIGHT', 256, 248);
  return c;
}

/** A topper's card: the name in gold on black, a hairline of gold round it. */
function cardCanvas(name: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#080605';
  g.fillRect(0, 0, 768, 256);
  g.strokeStyle = '#c99a3e';
  g.lineWidth = 6;
  g.strokeRect(10, 10, 748, 236);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 120;
  do {
    g.font = `700 ${size}px Cinzel, Georgia, serif`;
    size -= 6;
  } while (g.measureText(name.toUpperCase()).width > 680 && size > 30);
  const gold = g.createLinearGradient(0, 70, 0, 190);
  gold.addColorStop(0, '#fff1c4');
  gold.addColorStop(0.5, '#f0c14e');
  gold.addColorStop(1, '#b8862e');
  g.fillStyle = gold;
  g.fillText(name.toUpperCase(), 384, 136);
  return c;
}

/** The win meter's face for the night: the name in its red lamps (they glow), gold lettering over it. */
function meterCanvas(name: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 320;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0706';
  g.fillRect(0, 0, 1024, 320);
  g.strokeStyle = '#5c4020';
  g.lineWidth = 3;
  g.strokeRect(10, 10, 1004, 300);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#e0bd77';
  g.font = '600 40px Cinzel, Georgia, serif';
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '8px';
  g.fillText('TONIGHT BELONGS TO', 512, 70);
  let size = 130;
  do {
    g.font = `700 ${size}px "Barlow Condensed", sans-serif`;
    size -= 6;
  } while (g.measureText(name.toUpperCase()).width > 920 && size > 40);
  g.fillStyle = '#ff2410';
  g.fillText(name.toUpperCase(), 512, 200);
  return c;
}

/**
 * The projector's spot in a room: its middle if the floor there is clear (the lobby's compass
 * rose), else the walkway nearest the middle, as large as fits.
 */
function placeGobo(w: FxWorld, gobo: THREE.Mesh, roomId: string): void {
  const room = w.plan.rooms.find((r) => r.id === roomId);
  gobo.visible = !!room;
  if (!room) return;
  const L = room.inner;
  const cx = (L.x0 + L.x1) / 2;
  const cz = (L.z0 + L.z1) / 2;
  const clear = (x: number, z: number, r: number) =>
    w.plan.stations.every((s) => Math.hypot(s.x - x, s.z - z) > r + Math.max(s.fp.width, s.fp.depth) / 2) &&
    w.plan.solids.every((s) => s.y0 > 1.2 || Math.hypot(s.x - x, s.z - z) > r + Math.max(s.w, s.d) / 2);
  let at = { x: cx, z: cz, size: Math.min(L.x1 - L.x0, L.z1 - L.z0) * 0.5 };
  if (!clear(cx, cz, 1.6)) {
    const aisles = w.plan.aisles.filter((a) => inRect(L, (a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2));
    const near = aisles.sort((a, b) => Math.hypot((a.x0 + a.x1) / 2 - cx, (a.z0 + a.z1) / 2 - cz) - Math.hypot((b.x0 + b.x1) / 2 - cx, (b.z0 + b.z1) / 2 - cz))[0];
    if (near) at = { x: (near.x0 + near.x1) / 2, z: (near.z0 + near.z1) / 2, size: Math.min(near.x1 - near.x0, near.z1 - near.z0) };
  }
  const size = Math.max(2.2, Math.min(4.2, at.size + 0.8));
  gobo.position.set(at.x, 0.016, at.z);
  gobo.scale.set(size, 1, size);
}

/** The name in light: a ring of stars round it, as a gobo would cut it. */
function goboMaterial(name: string): THREE.MeshBasicMaterial {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 512, 512);
  ctx.translate(256, 256);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, 236, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 222, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, -200);
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const r = k % 2 === 0 ? 8 : 3;
      const b = (k / 8) * Math.PI * 2;
      ctx.lineTo(Math.sin(b) * r, -Math.cos(b) * r);
    }
    ctx.fill();
    ctx.restore();
  }
  const text = name.toUpperCase();
  let size = 84;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '6px';
  do {
    ctx.font = `700 ${size}px Cinzel, Georgia, serif`;
    size -= 4;
  } while (ctx.measureText(text).width > 360 && size > 24);
  ctx.fillText(text, 0, 0);
  ctx.font = '600 22px Cinzel, Georgia, serif';
  ctx.fillText('OWNS THE NIGHT', 0, size * 0.9 + 18);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0, 0, 0), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.name = 'fx-gobo';
  return m;
}
