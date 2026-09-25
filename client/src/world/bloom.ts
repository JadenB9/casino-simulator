// High-quality post: bloom on light brighter than the threshold (neon, LED strips, bulbs), plus
// the adaptive pixel ratio.
//
// Bloom you can see through: only the light past the threshold goes into the glow, and only by how
// far past it it is (a soft knee rather than three's all-or-nothing cut). A neon tube at three
// times the threshold gives most of its light to its halo; a card, a paytable or a brass rail
// that's lit a little past it gives almost none, so it stays crisp and readable instead of
// vanishing into a white smear. The glow itself stays close to its source (a small radius).
//
// three r186's own route is `renderer.setEffects([bloom])`, but that needs the renderer to have
// been created with `outputBufferType: HalfFloatType`, and Engine3D creates it without one. So the
// floor scene does it itself through its render hooks: onBeforeRender points the frame at a
// multisampled HalfFloat target, onAfterRender copies it to a plain HalfFloat buffer, blooms that
// and tone-maps it to the canvas. If the renderer ever does have a HalfFloat output buffer (the
// scene then renders into the renderer's own target), the same bloom pass is handed to
// setEffects() instead and the hooks stand down.

import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import type { Engine3D } from '../render/engine3d.ts';
import { CALM_BLOOM, calmScale, onCalm } from '../app/comfort.ts';

type Mode = 'probe' | 'hooks' | 'effects' | 'off';

export interface BloomLook {
  /** Past this brightness light glows; the knee softens the start; strength and radius size the halo. */
  threshold: number;
  knee: number;
  strength: number;
  radius: number;
}

/**
 * Walking the floor: past the brightest lit surface (white printing and chips under the pit's
 * spots peak near 1.5, lighting.ts), so only light sources glow: neon, LED strips, bulbs, the
 * machines' lamps, a specular glint on chrome. Kept modest and tight (v6.1): a sign reads lit at
 * night with a halo a hand wide, not a haze over the room.
 */
export const FLOOR_BLOOM: BloomLook = { threshold: 1.75, knee: 0.3, strength: 0.46, radius: 0.12 };
/**
 * Seated at a table, a metre from felt, cards and chips under the pit's spots: lit white printing
 * reaches three or so, so nothing on the table glows at all; only the strongest light sources do.
 */
export const TABLE_BLOOM: BloomLook = { threshold: 4.2, knee: 0.5, strength: 0.35, radius: 0.12 };
/** Seated at a machine: its bulbs, candle and glass are the point, and glow a little. */
export const MACHINE_BLOOM: BloomLook = { threshold: 2.6, knee: 0.4, strength: 0.3, radius: 0.12 };
/**
 * The dressing rooms under the floor (the look editor's, the boutique's): a white tuxedo or shirt
 * under their key and rim lights reaches two or so and must stay cloth; the podium's brass catches
 * a glint.
 */
export const STUDIO_BLOOM: BloomLook = { threshold: 2.8, knee: 0.4, strength: 0.45, radius: 0.16 };
/** A camera below this height (m) is in a dressing room. */
export const STUDIO_BELOW = -20;

/** The high pass: each pixel keeps only the part of its light past the threshold (soft-kneed). */
const EXCESS_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float luminosityThreshold;
uniform float smoothWidth;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D( tDiffuse, vUv );
  float bright = max( texel.r, max( texel.g, texel.b ) );
  float knee = max( smoothWidth, 1e-4 );
  float soft = clamp( bright - luminosityThreshold + knee, 0.0, 2.0 * knee );
  soft = soft * soft / ( 4.0 * knee );
  float excess = max( soft, bright - luminosityThreshold ) / max( bright, 1e-4 );
  gl_FragColor = vec4( texel.rgb * excess, 1.0 );
}`;

export class Bloom {
  readonly pass: UnrealBloomPass;
  private copy = new ShaderPass(CopyShader);
  private output = new OutputPass();
  private sceneRT: THREE.WebGLRenderTarget;
  private postRT: THREE.WebGLRenderTarget;
  private mode: Mode = 'off';
  private enabled = false;
  private redirected = false;
  private size = new THREE.Vector2();
  private dt = 0;
  private prevBefore: THREE.Scene['onBeforeRender'];
  private prevAfter: THREE.Scene['onAfterRender'];

  constructor(private readonly engine: Engine3D) {
    const r = engine.renderer;
    r.getDrawingBufferSize(this.size);
    this.pass = new UnrealBloomPass(this.size.clone(), FLOOR_BLOOM.strength, FLOOR_BLOOM.radius, FLOOR_BLOOM.threshold);
    this.pass.materialHighPassFilter.fragmentShader = EXCESS_FRAGMENT;
    this.pass.materialHighPassFilter.needsUpdate = true;
    this.setLook(FLOOR_BLOOM);
    this.sceneRT = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.postRT = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, depthBuffer: false });
    this.output.renderToScreen = true;
    const scene = engine.scene;
    this.prevBefore = scene.onBeforeRender;
    this.prevAfter = scene.onAfterRender;
    // for a Scene, the renderer passes the bound render target where Object3D's hook has geometry
    const before = (...args: Parameters<THREE.Scene['onBeforeRender']>) => {
      this.prevBefore.apply(scene, args);
      this.before(args[0], args[2], args[3] as unknown as THREE.WebGLRenderTarget | null);
    };
    const after = (...args: Parameters<THREE.Scene['onAfterRender']>) => {
      this.prevAfter.apply(scene, args);
      this.after(args[0], args[2]);
    };
    scene.onBeforeRender = before;
    scene.onAfterRender = after;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.mode === 'effects') this.engine.renderer.setEffects(on ? [this.pass] : []);
    if (on && this.mode === 'off') this.mode = 'probe';
  }

  private muted = false;
  private strength = 0;
  // calm (app/comfort.ts): the same glow, a little softer
  private readonly offCalm = onCalm(() => this.mute(this.muted));

  /**
   * Hold the glow at nothing (or give it back) without changing how the frame is drawn: the same
   * HDR target and tone mapping, so a frame with and without it differ only by the glow itself.
   */
  mute(on: boolean): void {
    this.muted = on;
    this.pass.strength = on ? 0 : this.strength * calmScale(CALM_BLOOM);
  }

  /** How the glow looks: FLOOR_BLOOM on the floor, TABLE_BLOOM or MACHINE_BLOOM seated. */
  setLook(l: BloomLook): void {
    this.pass.threshold = l.threshold;
    this.strength = l.strength;
    this.pass.strength = this.muted ? 0 : l.strength * calmScale(CALM_BLOOM);
    this.pass.radius = l.radius;
    (this.pass.highPassUniforms as { smoothWidth: { value: number } }).smoothWidth.value = l.knee;
  }

  get active(): boolean {
    return this.enabled && (this.mode === 'hooks' || this.mode === 'effects');
  }

  /** Per frame, before the engine renders. */
  update(dt: number): void {
    this.dt = dt;
  }

  private before(renderer: THREE.WebGLRenderer, camera: THREE.Camera, target: THREE.WebGLRenderTarget | null): void {
    this.redirected = false;
    if (!this.enabled || camera !== this.engine.camera) return;
    if (this.mode === 'probe') {
      // a target already bound for the main pass means the renderer has its own HDR output
      if (target !== null) {
        this.mode = 'effects';
        renderer.setEffects([this.pass]);
        return;
      }
      this.mode = 'hooks';
    }
    if (this.mode !== 'hooks' || target !== null) return;
    renderer.getDrawingBufferSize(this.size);
    if (this.sceneRT.width !== this.size.x || this.sceneRT.height !== this.size.y) {
      this.sceneRT.setSize(this.size.x, this.size.y);
      this.postRT.setSize(this.size.x, this.size.y);
      this.pass.setSize(this.size.x, this.size.y);
    }
    renderer.setRenderTarget(this.sceneRT);
    this.redirected = true;
  }

  private after(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (!this.redirected || camera !== this.engine.camera) return;
    this.redirected = false;
    // multisampled scene -> plain buffer (the bloom blends into its input) -> bloom -> tone map to the canvas
    this.copy.render(renderer, this.postRT, this.sceneRT, this.dt, false);
    this.pass.render(renderer, null as unknown as THREE.WebGLRenderTarget, this.postRT, this.dt, false);
    renderer.setRenderTarget(null);
    this.output.render(renderer, null as unknown as THREE.WebGLRenderTarget, this.postRT, this.dt, false);
  }

  dispose(): void {
    this.offCalm();
    this.engine.scene.onBeforeRender = this.prevBefore;
    this.engine.scene.onAfterRender = this.prevAfter;
    if (this.mode === 'effects') this.engine.renderer.setEffects([]);
    this.sceneRT.dispose();
    this.postRT.dispose();
    this.pass.dispose();
    this.copy.dispose();
    this.output.dispose();
  }
}

/**
 * Pixel ratio on High: start at min(devicePixelRatio, 2); step down 0.25 (not below 1.25) when the
 * 90th-percentile frame is over 17 ms for two seconds, back up when under 12 ms for eight, but
 * never within half a minute of stepping down. Every step resizes the canvas, which stalls the page
 * while the GPU catches up (a fifth of a second or more on a busy machine), so a frame rate hovering
 * near the line mustn't see-saw.
 */
export class PixelRatio {
  private samples: number[] = [];
  private slow = 0;
  private fast = 0;
  /** Seconds since the last step down. */
  private since = Infinity;
  private enabled = false;
  private max = 1;
  current = 1;

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  set(high: boolean): void {
    this.enabled = high;
    this.max = high ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.apply(this.max);
  }

  update(dt: number): void {
    if (!this.enabled || dt <= 0) return;
    this.samples.push(dt * 1000);
    if (this.samples.length > 60) this.samples.shift();
    if (this.samples.length < 30) return;
    const p90 = [...this.samples].sort((a, b) => a - b)[Math.floor(this.samples.length * 0.9)]!;
    if (p90 > 17) {
      this.slow += dt;
      this.fast = 0;
    } else if (p90 < 12) {
      this.fast += dt;
      this.slow = 0;
    } else {
      this.slow = this.fast = 0;
    }
    this.since += dt;
    if (this.slow > 2 && this.current > 1.25) {
      this.apply(Math.max(1.25, this.current - 0.25));
      this.since = 0;
    } else if (this.fast > 8 && this.current < this.max && this.since > 30) this.apply(Math.min(this.max, this.current + 0.25));
  }

  private apply(pr: number): void {
    this.current = pr;
    this.slow = this.fast = 0;
    this.samples.length = 0;
    if (this.renderer.getPixelRatio() !== pr) this.renderer.setPixelRatio(pr);
  }
}
