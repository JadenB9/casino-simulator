// The one renderer, scene and camera the whole game draws with. The floor, every table view and
// the dev harness add to this scene; nothing creates a second WebGL context.

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type Quality = 'high' | 'low';

const QUALITY_KEY = 'casino.quality';

export function savedQuality(): Quality {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    if (q === 'high' || q === 'low') return q;
  } catch {
    /* storage blocked */
  }
  return 'high';
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch {
    /* storage blocked */
  }
}

export type FrameFn = (dt: number, time: number) => void;

export class Engine3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
  readonly timer = new THREE.Timer();
  private frames = new Set<FrameFn>();
  private frameTimes: number[] = [];

  constructor(canvas: HTMLCanvasElement, labelRoot: HTMLElement, readonly quality: Quality) {
    const high = quality === 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: high, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : 1));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = false;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();
    this.scene.background = new THREE.Color('#0b0908');

    this.labels = new CSS2DRenderer({ element: labelRoot });
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
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    for (const fn of this.frames) fn(dt, t / 1000);
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  private resize = (): void => {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}
