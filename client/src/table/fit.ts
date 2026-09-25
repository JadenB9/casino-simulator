// Keeping the whole board in view. A game's play pose is framed for a full screen; in a laptop
// window that isn't full screen, a short wide one or a tall narrow one, the outer betting spots
// went off the edge or under the chip tray. Every table now fits its board into the part of the
// screen its own controls leave free, at any window size, and again whenever the window or the
// controls change.
//
// The camera stays exactly where the game put it and looks the same way: only its lens changes.
// It widens (camera.zoom below 1) until the board is small enough for the free space, and its
// centre slides (a view offset) until the board sits inside it. That is the same picture from the
// same eye, taken in wider and cropped off-centre, so the game's angle and feel are kept, nothing
// can come between the camera and the table, and the flights, swings and glides the games and the
// floor already run keep working untouched. A board that already fits is left exactly as framed.
//
// How a game plugs in (see also README.md in this folder):
//   - Tables with felts need nothing: the felt's regions (every betting spot) are the board.
//     A view adds what lies off the regions (the dealer's cards, the shoe, the wheel) with
//     `stage.board(...)`, which replaces the default; pass the felt itself to keep its regions.
//   - Machines and computers name their playing surface: `stage.board(reelsMesh, buttonsBox)`,
//     or the glass's corners for a DOM screen mapped onto a monitor (it follows the glass).
//   - A view that swings the camera to another shot (the roulette wheel, the dice) says what that
//     shot must show with `stage.shot(pose, ...parts)` and `stage.shot(null)` when it comes back.
// Parts are table-local: points ([x, y, z] or Vector3), boxes, objects (their box), felts.
//
// The free space is measured, not assumed: the visible controls over the scene (#ui's panels, the
// HUD's clusters, the chat, the site's back chip) are obstacles, and the largest clear rectangle
// that takes the board with the least change wins. Something that shows now and then (the
// dealer's line, a chat peek) keeps its place for a while after it hides, so the view doesn't
// breathe in and out with it.

import * as THREE from 'three';
import { Felt } from './felt.ts';
import type { Pose } from './stage.ts';

/** Screen rectangle in CSS pixels. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What the lens does: zoom (1 = the game's own framing, below 1 wider) and a slide in CSS px. */
export interface Lens {
  zoom: number;
  dx: number;
  dy: number;
}

export const NEUTRAL: Lens = { zoom: 1, dx: 0, dy: 0 };

/** The widest the lens goes (a quarter of the game's own framing would be a postage stamp). */
export const MIN_ZOOM = 0.3;

/** Clear space kept between the board and a screen edge or a control, CSS px. */
export function marginFor(w: number, h: number): number {
  return Math.round(Math.min(18, Math.max(8, Math.min(w, h) * 0.02)));
}

// --- the pure maths ---------------------------------------------------------------------------

/**
 * The lens that brings a board whose picture at the game's own framing spans `b` (CSS px, on a
 * `w` x `h` screen) inside `safe`: the least widening that makes it fit, then the least slide
 * that puts it inside. Zoom is about the screen's centre, as a camera's is.
 */
export function lensFor(b: Rect, safe: Rect, w: number, h: number): Lens {
  const bw = b.right - b.left;
  const bh = b.bottom - b.top;
  const sw = safe.right - safe.left;
  const sh = safe.bottom - safe.top;
  if (!(sw > 0 && sh > 0)) return { zoom: MIN_ZOOM, dx: 0, dy: 0 };
  const zoom = Math.max(MIN_ZOOM, Math.min(1, bw > 0 ? sw / bw : 1, bh > 0 ? sh / bh : 1));
  const cx = w / 2;
  const cy = h / 2;
  return { zoom, dx: slide(cx + zoom * (b.left - cx), cx + zoom * (b.right - cx), safe.left, safe.right), dy: slide(cy + zoom * (b.top - cy), cy + zoom * (b.bottom - cy), safe.top, safe.bottom) };
}

/** The least move that puts [a, b] inside [lo, hi] (centred on it when it can't fit). */
function slide(a: number, b: number, lo: number, hi: number): number {
  if (b - a > hi - lo) return (lo + hi) / 2 - (a + b) / 2;
  if (a < lo) return lo - a;
  if (b > hi) return hi - b;
  return 0;
}

/** The board's picture after a lens: where `b` lands. */
export function lensed(b: Rect, lens: Lens, w: number, h: number): Rect {
  const cx = w / 2;
  const cy = h / 2;
  return {
    left: cx + lens.zoom * (b.left - cx) + lens.dx,
    right: cx + lens.zoom * (b.right - cx) + lens.dx,
    top: cy + lens.zoom * (b.top - cy) + lens.dy,
    bottom: cy + lens.zoom * (b.bottom - cy) + lens.dy,
  };
}

/**
 * Of every rectangle clear of the obstacles, the one where the board (spanning `b` at the game's
 * framing) fits the least changed: the least widening first, then the least slide, then the most
 * room. `margin` is kept inside it all round. Obstacles are clipped to the screen first.
 */
export function bestSpace(b: Rect, obstacles: Rect[], w: number, h: number, margin = marginFor(w, h)): { safe: Rect; lens: Lens } {
  const obs = obstacles
    .map((o) => ({ left: Math.max(0, o.left), top: Math.max(0, o.top), right: Math.min(w, o.right), bottom: Math.min(h, o.bottom) }))
    .filter((o) => o.right - o.left > 1 && o.bottom - o.top > 1);
  const xs = uniq([0, w, ...obs.flatMap((o) => [o.left, o.right])]);
  const ys = uniq([0, h, ...obs.flatMap((o) => [o.top, o.bottom])]);
  let best: { safe: Rect; lens: Lens; score: [number, number, number] } | null = null;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const left = xs[i]!;
      const right = xs[j]!;
      if (right - left <= 2 * margin) continue;
      // the obstacles across this column, top to bottom: the clear runs between them
      const across = obs.filter((o) => o.left < right && o.right > left);
      for (let k = 0; k < ys.length; k++) {
        const top = ys[k]!;
        for (let l = k + 1; l < ys.length; l++) {
          const bottom = ys[l]!;
          if (bottom - top <= 2 * margin) continue;
          if (across.some((o) => o.top < bottom && o.bottom > top)) break;
          const safe = { left: left + margin, top: top + margin, right: right - margin, bottom: bottom - margin };
          const lens = lensFor(b, safe, w, h);
          // a thousandth of zoom or a pixel of slide either way is a tie
          const score: [number, number, number] = [Math.round(lens.zoom * 1000), -Math.round(Math.abs(lens.dx) + Math.abs(lens.dy)), (right - left) * (bottom - top)];
          if (!best || better(score, best.score)) best = { safe, lens, score };
        }
      }
    }
  }
  if (best) return { safe: best.safe, lens: best.lens };
  // no clear space at all (a panel over everything): fit the screen, controls or not
  const safe = { left: margin, top: margin, right: w - margin, bottom: h - margin };
  return { safe, lens: lensFor(b, safe, w, h) };
}

function better(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

function uniq(v: number[]): number[] {
  return [...new Set(v.map((x) => Math.round(x)))].sort((a, b) => a - b);
}

/**
 * Where world points land on a `w` x `h` screen (CSS px) seen from `eye` at the camera's own
 * vertical field of view and no lens, and how many are behind the eye (no lens can show those).
 */
export function projectAt(points: THREE.Vector3[], eye: { position: THREE.Vector3; quaternion: THREE.Quaternion }, fov: number, w: number, h: number): { box: Rect | null; px: { x: number; y: number }[]; behind: number } {
  const inv = new THREE.Matrix4().compose(eye.position, eye.quaternion, ONE).invert();
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const tanH = tanV * (w / h);
  const px: { x: number; y: number }[] = [];
  let behind = 0;
  for (const p of points) {
    v.copy(p).applyMatrix4(inv);
    const depth = -v.z;
    if (depth < 0.02) {
      behind++;
      continue;
    }
    px.push({ x: ((v.x / (depth * tanH) + 1) / 2) * w, y: ((1 - v.y / (depth * tanV)) / 2) * h });
  }
  if (px.length === 0) return { box: null, px, behind };
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const q of px) {
    box.left = Math.min(box.left, q.x);
    box.right = Math.max(box.right, q.x);
    box.top = Math.min(box.top, q.y);
    box.bottom = Math.max(box.bottom, q.y);
  }
  return { box, px, behind };
}

const v = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

/** Ease one lens toward another: `k` of the way (0..1). */
export function blend(from: Lens, to: Lens, k: number): Lens {
  return { zoom: from.zoom + (to.zoom - from.zoom) * k, dx: from.dx + (to.dx - from.dx) * k, dy: from.dy + (to.dy - from.dy) * k };
}

export function sameLens(a: Lens, b: Lens): boolean {
  return Math.abs(a.zoom - b.zoom) < 1e-4 && Math.abs(a.dx - b.dx) < 0.1 && Math.abs(a.dy - b.dy) < 0.1;
}

// --- board parts --------------------------------------------------------------------------------

/** Something on the table the board is made of, in table-local terms. */
export type BoardPart = THREE.Vector3 | readonly [number, number, number] | THREE.Box3 | THREE.Object3D | Felt;

/** Eight points a circle is taken as; a region's circle is small enough that eight hold its edge. */
const RING = 8;

/** The key points of a felt: its regions' outlines at the felt's height (the whole felt when it has none). */
export function feltPoints(felt: Felt, y = felt.mesh.position.y): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const regions = felt.spec.regions;
  if (regions.length === 0) {
    const hw = felt.spec.width / 2;
    const hd = felt.spec.depth / 2;
    const { x, z } = felt.mesh.position;
    for (const [a, b] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as const) out.push(new THREE.Vector3(x + a, y, z + b));
    return out;
  }
  for (const r of regions) {
    const s = r.shape;
    if (s.kind === 'rect') for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) out.push(new THREE.Vector3(s.x + (a * s.w) / 2, y, s.z + (b * s.d) / 2));
    else if (s.kind === 'circle') for (let i = 0; i < RING; i++) out.push(new THREE.Vector3(s.x + s.r * Math.cos((i / RING) * Math.PI * 2), y, s.z + s.r * Math.sin((i / RING) * Math.PI * 2)));
    else for (const [a, b] of s.points) out.push(new THREE.Vector3(a, y, b));
  }
  return out;
}

export function boxPoints(b: THREE.Box3): THREE.Vector3[] {
  if (b.isEmpty()) return [];
  const out: THREE.Vector3[] = [];
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

/** An object's box in `root`'s frame (tighter than a world box when the table is turned). */
export function localBox(obj: THREE.Object3D, root: THREE.Object3D): THREE.Box3 {
  root.updateWorldMatrix(true, false);
  obj.updateWorldMatrix(true, true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const out = new THREE.Box3();
  const m = new THREE.Matrix4();
  const b = new THREE.Box3();
  obj.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!g || !o.visible) return;
    if (!g.boundingBox) g.computeBoundingBox();
    b.copy(g.boundingBox!).applyMatrix4(m.multiplyMatrices(toRoot, o.matrixWorld));
    out.union(b);
  });
  return out;
}

/** Table-local key points of a board made of these parts. */
export function partPoints(parts: readonly BoardPart[], root: THREE.Object3D): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const p of parts) {
    if (p instanceof Felt) out.push(...feltPoints(p));
    else if (p instanceof THREE.Vector3) out.push(p.clone());
    else if (p instanceof THREE.Box3) out.push(...boxPoints(p));
    else if (p instanceof THREE.Object3D) out.push(...boxPoints(localBox(p, root)));
    else out.push(new THREE.Vector3(p[0], p[1], p[2]));
  }
  return out;
}

// --- the controls over the scene -----------------------------------------------------------------

/** Never obstacles: prompts that come and go (a modal, a toast), and boards drawn in the DOM. */
const NOT_CHROME = ['modal', 'scrim', 'toasts', 'toast', 'world-prompt', 'os-screen', 'celebrate'];
/** How long something that showed keeps its place after it hides, ms. */
const REMEMBER = 12_000;
/** How often the controls are measured, ms (and at once when the window changes size). */
const MEASURE_EVERY = 250;

/**
 * The visible controls over the scene, as screen rectangles: the given elements (#ui's children),
 * and the children of see-through wrappers among them (`.pass`: the HUD's clusters, not the HUD's
 * full width).
 * Skipped: prompts and boards (NOT_CHROME, `data-fit="ignore"`), anything hidden, and anything
 * covering most of the screen (a menu or the map, which closes before you play).
 */
export function measureChrome(elements: Iterable<Element>, w: number, h: number): { el: Element; rect: Rect }[] {
  const out: { el: Element; rect: Rect }[] = [];
  const visit = (e: Element, depth: number) => {
    if (!(e instanceof HTMLElement) || e.hidden) return;
    if (e.dataset.fit === 'ignore' || NOT_CHROME.some((c) => e.classList.contains(c))) return;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return;
    if (e.classList.contains('pass') || e.dataset.fit === 'pass') {
      if (depth < 3) for (const c of e.children) visit(c, depth + 1);
      return;
    }
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0 || r.left >= w || r.top >= h) return;
    if (r.width * r.height > 0.45 * w * h) return;
    out.push({ el: e, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
  };
  for (const e of elements) visit(e, 0);
  return out;
}

// --- the lens on the camera ----------------------------------------------------------------------

/** The lens each camera wears now; shared, so a table that opens as another closes takes it over. */
const worn = new WeakMap<THREE.PerspectiveCamera, { lens: Lens; w: number; h: number; owner: BoardFit | null }>();

function wear(camera: THREE.PerspectiveCamera, lens: Lens, owner: BoardFit | null): void {
  const w = innerWidth;
  const h = innerHeight;
  const cur = worn.get(camera);
  if (cur && cur.w === w && cur.h === h && sameLens(cur.lens, lens) && camera.zoom === lens.zoom) {
    cur.owner = owner;
    return;
  }
  worn.set(camera, { lens, w, h, owner });
  camera.zoom = lens.zoom;
  if (Math.abs(lens.dx) < 0.1 && Math.abs(lens.dy) < 0.1) camera.view = null;
  else {
    // a view offset slides the frustum's window: the picture moves the other way
    camera.setViewOffset(w, h, -lens.dx, -lens.dy, w, h);
  }
  camera.updateProjectionMatrix();
}

/** How quickly the lens follows a change (seconds to cover about two thirds of it). */
const EASE = 0.14;

/** Is fitting switched off (?fit=off, for comparing with the game's own framing)? */
function fitOff(): boolean {
  try {
    return new URLSearchParams(location.search).get('fit') === 'off' || localStorage.getItem('casino.fit') === 'off';
  } catch {
    return false;
  }
}

/**
 * One table's fit: its board, the controls over it, and the lens that keeps one clear of the
 * other. The stage owns it; the table session calls update() every frame and gives it the UI root.
 */
export class BoardFit {
  private parts: readonly BoardPart[] | null = null;
  private points: THREE.Vector3[] | null = null;
  private shotPose: Pose | null = null;
  private shotParts: readonly BoardPart[] | null = null;
  private shotPoints: THREE.Vector3[] | null = null;
  private roots: Element[] = [];
  private seen = new Map<Element, { rect: Rect; at: number }>();
  private measuredAt = -Infinity;
  private size = { w: 0, h: 0 };
  private target: Lens = NEUTRAL;
  private last: { safe: Rect | null; box: Rect | null; behind: number; obstacles: Rect[] } = { safe: null, box: null, behind: 0, obstacles: [] };
  private key = '';
  private disposed = false;
  readonly off = fitOff();

  constructor(
    private readonly root: THREE.Object3D,
    private readonly camera: THREE.PerspectiveCamera,
    /** The felts on the table now (the board when the view names none). */
    private readonly felts: () => readonly Felt[],
    /** Where the camera rests at this table (the stage's rest pose). */
    private readonly rest: () => { pos: THREE.Vector3; quat: THREE.Quaternion },
  ) {}

  /** The controls to keep the board clear of: the table UI's root (#ui). */
  watch(...roots: Element[]): void {
    this.roots = roots;
    this.measuredAt = -Infinity;
  }

  /** The board: what must stay in view from the resting pose. Nothing given = the felts' regions. */
  setBoard(parts: readonly BoardPart[] | null): void {
    this.parts = parts && parts.length ? parts : null;
    this.points = null;
  }

  /** Another shot (table-local pose) and what it must show, until setShot(null). */
  setShot(pose: Pose | null, parts: readonly BoardPart[] = []): void {
    this.shotPose = pose;
    this.shotParts = pose ? parts : null;
    this.shotPoints = null;
  }

  /** The board's key points in world space, as the fit uses them now (for checks). */
  keyPoints(): THREE.Vector3[] {
    this.root.updateWorldMatrix(true, false);
    return this.localPoints().map((p) => p.clone().applyMatrix4(this.root.matrixWorld));
  }

  private localPoints(): THREE.Vector3[] {
    if (this.shotPose) return (this.shotPoints ??= partPoints(this.shotParts ?? [], this.root));
    if (this.parts) return (this.points ??= partPoints(this.parts, this.root));
    // the felts' regions, as they are now (a view adds its felts as it mounts)
    return partPoints(this.felts(), this.root);
  }

  /** The pose the board is fitted from: the shot's, else the table's resting pose. */
  private eye(): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
    if (this.shotPose) {
      this.root.updateWorldMatrix(true, false);
      const position = this.root.localToWorld(new THREE.Vector3(...this.shotPose.position));
      const target = this.root.localToWorld(new THREE.Vector3(...this.shotPose.target));
      return { position, quaternion: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(position, target, this.camera.up)) };
    }
    const r = this.rest();
    return { position: r.pos, quaternion: r.quat };
  }

  update(dt: number): void {
    if (this.disposed) return;
    const w = innerWidth;
    const h = innerHeight;
    const now = performance.now();
    const resized = w !== this.size.w || h !== this.size.h;
    if (resized) {
      // everything moves when the window does: forget where things were
      this.size = { w, h };
      this.seen.clear();
    }
    if (resized || now - this.measuredAt >= MEASURE_EVERY) {
      this.measuredAt = now;
      this.measure(now, w, h);
    }
    this.target = this.off ? NEUTRAL : this.solve(w, h);
    const cur = worn.get(this.camera);
    const from = cur && cur.w === w && cur.h === h ? cur.lens : cur ? { ...cur.lens, dx: 0, dy: 0 } : NEUTRAL;
    // a resize snaps (the picture jumps with the window anyway); a change of controls eases
    const k = resized ? 1 : 1 - Math.exp(-dt / EASE);
    const next = blend(from, this.target, k);
    wear(this.camera, sameLens(next, this.target) ? this.target : next, this);
  }

  private measure(now: number, w: number, h: number): void {
    // the site's back chip owns the bottom-left corner (j4den.com puts it over every page)
    const back = document.querySelector('.j4-back');
    const top = this.roots.flatMap((r) => [...r.children]);
    for (const { el, rect } of measureChrome(back ? [...top, back] : top, w, h)) this.seen.set(el, { rect, at: now });
    for (const [el, s] of this.seen) if (now - s.at > REMEMBER) this.seen.delete(el);
  }

  private solve(w: number, h: number): Lens {
    const pts = this.localPoints();
    if (pts.length === 0) return NEUTRAL;
    this.root.updateWorldMatrix(true, false);
    const world = pts.map((p) => p.clone().applyMatrix4(this.root.matrixWorld));
    const eye = this.eye();
    const { box, behind } = projectAt(world, eye, this.camera.fov, w, h);
    const obstacles = [...this.seen.values()].map((s) => s.rect);
    if (!box) {
      this.last = { safe: null, box: null, behind, obstacles };
      return NEUTRAL;
    }
    // the rectangle search only when something it depends on changed (it's a few thousand boxes)
    const key = [w, h, box.left, box.top, box.right, box.bottom, ...obstacles.flatMap((o) => [o.left, o.top, o.right, o.bottom])].map((x) => Math.round(x)).join(',');
    if (key !== this.key || !this.last.safe) {
      this.key = key;
      const { safe, lens } = bestSpace(box, obstacles, w, h);
      this.last = { safe, box, behind, obstacles };
      this.fitted = lens;
    }
    return this.fitted;
  }

  private fitted: Lens = NEUTRAL;

  /** What the fit sees and does now, for the e2e checks and the debug overlay. */
  debug(): { lens: Lens; target: Lens; safe: Rect | null; board: Rect | null; behind: number; obstacles: Rect[]; off: boolean } {
    return { lens: worn.get(this.camera)?.lens ?? NEUTRAL, target: this.target, safe: this.last.safe, board: this.last.box, behind: this.last.behind, obstacles: this.last.obstacles, off: this.off };
  }

  /** The table is closing: hand the camera back to the game's own framing, easing out over the flight away. */
  dispose(engine: { onFrame(fn: (dt: number) => void): () => void }): void {
    if (this.disposed) return;
    this.disposed = true;
    const cam = this.camera;
    const off = engine.onFrame((dt) => {
      const cur = worn.get(cam);
      // another table has the lens now, or it's already neutral
      if (!cur || (cur.owner && cur.owner !== this)) return off();
      const next = blend(cur.lens, NEUTRAL, 1 - Math.exp(-dt / EASE));
      const done = sameLens(next, NEUTRAL);
      wear(cam, done ? NEUTRAL : next, this);
      if (done) {
        cur.owner = null;
        worn.delete(cam);
        off();
      }
    });
  }
}
