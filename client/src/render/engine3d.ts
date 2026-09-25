// The one renderer, scene and camera the whole game draws with. The floor, every table view and
// the dev harness add to this scene; nothing creates a second WebGL context.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Labels } from './labels.ts';
import { framePass } from './matrices.ts';

export type Quality = 'high' | 'low';

const QUALITY_KEY = 'casino.quality';

/**
 * Phones and tablets: a touch screen is the main pointer. They start on Low graphics and never
 * render more than 1.5 device pixels per CSS pixel; a 3x phone screen would otherwise ask for
 * four times the pixels of a laptop's, on a much smaller GPU.
 */
export function isMobile(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
}

/** The most device pixels per CSS pixel the renderer ever uses. */
export const MOBILE_MAX_PIXEL_RATIO = 1.5;

export function savedQuality(): Quality {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    if (q === 'high' || q === 'low') return q;
  } catch {
    /* storage blocked */
  }
  return isMobile() ? 'low' : 'high';
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch {
    /* storage blocked */
  }
}

export type FrameFn = (dt: number, time: number) => void;

/** Vertical field of view on a landscape or square screen, degrees. */
export const FOV = 55;

/**
 * A phone held upright would see a narrow slot of the room at 55 degrees (27 across). The view
 * opens up as the screen narrows, by the square root of the aspect so it never bulges at the
 * edges: 75 degrees tall (39 across) on a 390 x 844 phone. Landscape keeps 55.
 */
export function fovFor(aspect: number): number {
  if (!(aspect > 0) || aspect >= 1) return FOV;
  const half = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / Math.sqrt(aspect);
  return THREE.MathUtils.radToDeg(2 * Math.atan(half));
}

/** The studio room's light panels, as a share of three's, and the environment's strength. */
const ENV_PANELS = 0.3;
const ENV_INTENSITY = 0.45;

export class Engine3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: Labels;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 200);
  readonly timer = new THREE.Timer();
  private frames = new Set<FrameFn>();
  private frameTimes: number[] = [];
  /**
   * Draw nothing (and run no frame callbacks) while set: behind a loading screen there is nothing
   * to see, and drawing a scene still being built compiles each new material's shaders on the spot,
   * holding up the build, where the floor's compileAsync would compile them all in parallel.
   */
  paused = false;

  /** The ceiling on the pixel ratio: 1.5 on phones and tablets, 2 elsewhere. */
  readonly maxPixelRatio: number;

  /**
   * `antialias`: multisample the canvas itself (on High unless told otherwise). The floor passes
   * false: on High its bloom (world/bloom.ts) draws the scene into a multisampled target of its own
   * and puts only a full-screen picture on the canvas, so a multisampled canvas would be a second
   * copy of the frame four samples deep, doing nothing but costing memory and making every resize
   * (the pixel ratio stepping down) freeze the page.
   */
  constructor(canvas: HTMLCanvasElement, labelRoot: HTMLElement, readonly quality: Quality, opts: { antialias?: boolean } = {}) {
    const high = quality === 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.antialias ?? high, powerPreference: 'high-performance' });
    this.maxPixelRatio = isMobile() ? MOBILE_MAX_PIXEL_RATIO : 2;
    // Everything that sets the ratio later (the floor's adaptive step-down on High) goes through
    // the same ceiling, so a phone never renders at its full 3x.
    const setPixelRatio = this.renderer.setPixelRatio.bind(this.renderer);
    this.renderer.setPixelRatio = (value: number) => setPixelRatio(Math.min(value, this.maxPixelRatio));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : 1));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = false;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    // three's studio room with its light panels dimmed: at full strength a chrome trim or a brass
    // foot ring catches a panel as a white-hot line that blooms like a light tube
    const room = new RoomEnvironment();
    room.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m && m.emissiveIntensity > 1) m.emissiveIntensity *= ENV_PANELS;
    });
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    this.scene.environmentIntensity = ENV_INTENSITY;
    pmrem.dispose();
    this.scene.background = new THREE.Color('#0b0908');

    this.labels = new Labels({ element: labelRoot });
    this.timer.connect(document);
    addEventListener('resize', this.resize);
    this.resize();
    this.renderer.setAnimationLoop((t) => this.tick(t));
  }

  onFrame(fn: FrameFn): () => void {
    this.frames.add(fn);
    return () => this.frames.delete(fn);
  }

  /** Recent average frame time in ms (for the quality probe and the stats overlay). */
  frameMs(): number {
    if (this.frameTimes.length === 0) return 16.7;
    return this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
  }

  private tick(t: number): void {
    this.timer.update(t);
    if (this.paused) return;
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    for (const fn of this.frames) fn(dt, t / 1000);
    // hidden characters and far-off tables' models sit out the frame's matrix update (matrices.ts);
    // the labels go straight after, on the same matrices
    framePass(this.draw);
    this.labels.render(this.scene, this.camera);
  }

  private draw = (): void => this.renderer.render(this.scene, this.camera);

  private resize = (): void => {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = fovFor(w / h);
    this.camera.updateProjectionMatrix();
  };
}
