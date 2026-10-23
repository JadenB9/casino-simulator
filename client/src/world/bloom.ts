// The floor's post pass. High: bloom on light brighter than the threshold (neon, LED strips,
// bulbs), then the output pass, which grades the picture for the room you're in and puts it on the
// canvas; plus the adaptive pixel ratio. Low: the scene drawn straight to the canvas, or (where the
// graphics card renders half-float targets) through one smoothing pass, FXAA, that grades it too.
//
// Bloom you can see through: only the light past the threshold goes into the glow, and only by how
// far past it it is (a soft knee rather than three's all-or-nothing cut). A neon tube at three
// times the threshold gives most of its light to its halo; a card, a paytable or a brass rail
// that's lit a little past it gives almost none, so it stays crisp and readable instead of
// vanishing into a white smear. The glow itself stays close to its source (a small radius).
//
// The grade (v8): each room's own white balance and colour, eased in as you walk from one to the
// next (warm in the pit and the bar, cool in the online lounge, the salon's green, the parlour's
// pink), a soft vignette, and a fixed fine dither so the dark ceilings don't band. It never
// flashes or pulses; the Film look option (render/graphics.ts) turns all but the dither off.
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
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import type { Engine3D } from '../render/engine3d.ts';
import { followGraphicsPrefs, graphicsPrefs, type GraphicsPrefs } from '../render/graphics.ts';
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

/**
 * A room's grade. `balance` multiplies the light before tone mapping (a white balance, kept within
 * a few percent of white), `saturation` scales colour after it (1: as drawn), `contrast` bends a
 * gentle S through the middle greys (0: none), `vignette` darkens the corners by up to that much.
 */
export interface Grade {
  balance: [number, number, number];
  saturation: number;
  contrast: number;
  vignette: number;
}

/** Nothing changed: what the Film look's Off shows, and a room without a grade of its own. */
export const NEUTRAL_GRADE: Grade = { balance: [1, 1, 1], saturation: 1, contrast: 0, vignette: 0 };
const BASE: Grade = { balance: [1.01, 1, 0.98], saturation: 1.04, contrast: 0.04, vignette: 0.15 };

/**
 * Each room's grade (rooms.ts ids, and the other zones and the dressing rooms by name). Small
 * moves: the rooms' own lights and materials make their mood, the grade only leans it.
 */
export const GRADES: Record<string, Grade> = {
  lobby: { ...BASE, balance: [1.02, 1, 0.97] },
  pit: { ...BASE, balance: [1.04, 1, 0.94], saturation: 1.07, contrast: 0.06 },
  slots: { ...BASE, balance: [1.01, 0.98, 1.01], saturation: 1.1 },
  bar: { ...BASE, balance: [1.05, 1, 0.92], saturation: 1.05, contrast: 0.06 },
  lounge: { ...BASE, balance: [1.05, 0.99, 0.91], saturation: 1.03, vignette: 0.18 },
  poker: { ...BASE, balance: [1.0, 1, 1.02], saturation: 1.04, contrast: 0.06 },
  salon: { ...BASE, balance: [0.98, 1.02, 1.0], saturation: 1.05, contrast: 0.05 },
  online: { ...BASE, balance: [0.95, 0.99, 1.07], saturation: 1.1 },
  yard: { ...BASE, balance: [1.05, 1, 0.9], saturation: 0.94, contrast: 0.09, vignette: 0.2 },
  bank: { ...BASE, balance: [1.01, 1, 0.98] },
  boutique: { ...BASE, balance: [1.0, 1, 1.0], saturation: 1.02, vignette: 0.12 },
  parlour: { ...BASE, balance: [1.02, 0.97, 1.03], saturation: 1.1 },
  cardroom: { ...BASE, balance: [1.04, 0.99, 0.94], saturation: 1.06, contrast: 0.06 },
  bingo: { ...BASE, balance: [0.99, 1.01, 1.02], saturation: 1.0, vignette: 0.12 },
  ground: { ...BASE, balance: [0.97, 0.99, 1.05], saturation: 1.04, contrast: 0.06 },
  roof: { ...BASE, balance: [1.05, 1, 0.93], saturation: 1.06, contrast: 0.05 },
  home: { ...BASE, balance: [1.02, 1, 0.97] },
  studio: { ...BASE, balance: [1, 1, 1], saturation: 1, contrast: 0, vignette: 0.08 },
};

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

/**
 * The grade, shared by both passes: white balance before the tone mapping, then (on the tone-mapped
 * colour) saturation, the S of contrast, the vignette, and a fixed dither under a step of 8 bits.
 */
const GRADE_PARS = /* glsl */ `
uniform vec3 uBalance;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform vec2 uAspect;
uniform float uDither;
// interleaved gradient noise: a fine fixed pattern, the same every frame (nothing shimmers)
float gradeNoise( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
vec3 gradeDisplay( vec3 c ) {
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  return max( mix( vec3( l ), c, uSaturation ), 0.0 );
}
vec4 gradeFinish( vec4 c, vec2 uv ) {
  vec3 s = clamp( c.rgb, 0.0, 1.0 );
  c.rgb = mix( c.rgb, s * s * ( 3.0 - 2.0 * s ), uContrast );
  vec2 d = ( uv - 0.5 ) * uAspect;
  c.rgb *= 1.0 - uVignette * smoothstep( 0.12, 0.95, dot( d, d ) );
  c.rgb += ( gradeNoise( gl_FragCoord.xy ) - 0.5 ) * uDither;
  return c;
}`;

/** High's last pass: three's OutputShader (tone mapping, sRGB) with the grade round it. */
const GRADE_VERTEX = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const GRADE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
${GRADE_PARS}
varying vec2 vUv;
void main() {
  vec4 c = texture2D( tDiffuse, vUv );
  c.rgb *= uBalance;
  c.rgb = NeutralToneMapping( c.rgb );
  c.rgb = gradeDisplay( c.rgb );
  c = sRGBTransferOETF( c );
  gl_FragColor = gradeFinish( c, vUv );
}`;

/**
 * Low's one pass: three's FXAA, each of its taps tone-mapped and encoded as the canvas would have
 * been (the scene is drawn half-float, in linear light), then graded. Null if three's shader no
 * longer reads its taps the way this expects (Low then draws straight to the canvas).
 */
export function fxaaFragment(): string | null {
  const tap = /vec4 Sample\(\s*sampler2D\s+tex2D,\s*vec2 uv\s*\)\s*\{\s*return texture\(\s*tex2D,\s*uv\s*\);\s*\}/;
  const end = /gl_FragColor = ApplyFXAA\(\s*tDiffuse,\s*resolution\.xy,\s*vUv\s*\);/;
  const src = FXAAShader.fragmentShader;
  if (!tap.test(src) || !end.test(src)) return null;
  return `#include <tonemapping_pars_fragment>
${GRADE_PARS}
${src
  // the edges of things smoothed, the carpet's fine pattern left alone: only a clear step in
  // brightness counts as an edge, and a lone bright pixel is blended in by half, not whole
  .replace(/float _RelativeThreshold = [0-9.]+;/, 'float _RelativeThreshold = 0.125;')
  .replace(/float _ContrastThreshold = [0-9.]+;/, 'float _ContrastThreshold = 0.0625;')
  .replace(/float _SubpixelBlending = [0-9.]+;/, 'float _SubpixelBlending = 0.5;')
  .replace(
    tap,
    `vec4 Sample( sampler2D tex2D, vec2 uv ) {
      vec4 c = texture( tex2D, uv );
      c.rgb = gradeDisplay( NeutralToneMapping( c.rgb * uBalance ) );
      return sRGBTransferOETF( c );
    }`,
  )
  .replace(end, 'gl_FragColor = gradeFinish( ApplyFXAA( tDiffuse, resolution.xy, vUv ), vUv );')}`;
}

/** Uniforms for a graded pass. */
function gradeUniforms(): Record<string, THREE.IUniform> {
  return {
    tDiffuse: { value: null },
    toneMappingExposure: { value: 1 },
    uBalance: { value: new THREE.Vector3(1, 1, 1) },
    uSaturation: { value: 1 },
    uContrast: { value: 0 },
    uVignette: { value: 0 },
    uAspect: { value: new THREE.Vector2(1, 1) },
    uDither: { value: 1 / 255 },
  };
}

export class Bloom {
  readonly pass: UnrealBloomPass;
  private copy = new ShaderPass(CopyShader);
  private readonly gradeMat: THREE.RawShaderMaterial;
  private readonly gradeQuad: FullScreenQuad;
  private sceneRT: THREE.WebGLRenderTarget;
  private postRT: THREE.WebGLRenderTarget;
  /** Low's smoothing: its target (made the first time it's used) and pass, or null where it can't. */
  private lowRT: THREE.WebGLRenderTarget | null = null;
  private readonly fxaaMat: THREE.ShaderMaterial | null;
  private readonly fxaaQuad: FullScreenQuad | null;
  private readonly canSmooth: boolean;
  private mode: Mode = 'off';
  private enabled = false;
  /** Where this frame went: High's targets, Low's, or straight to the canvas. */
  private redirected: 'high' | 'low' | null = null;
  private size = new THREE.Vector2();
  private dt = 0;
  private prevBefore: THREE.Scene['onBeforeRender'];
  private prevAfter: THREE.Scene['onAfterRender'];
  /** The player's options (render/graphics.ts): the glow, the film look, Low's smoothing. */
  private prefs: Readonly<GraphicsPrefs> = graphicsPrefs();
  private readonly offPrefs: () => void;
  /** The grade being shown (eased toward the room's), and the room's. */
  private readonly grade: Grade = { balance: [1, 1, 1], saturation: 1, contrast: 0, vignette: 0 };
  private want: Grade = NEUTRAL_GRADE;
  private graded = false;

  constructor(private readonly engine: Engine3D) {
    const r = engine.renderer;
    r.getDrawingBufferSize(this.size);
    this.pass = new UnrealBloomPass(this.size.clone(), FLOOR_BLOOM.strength, FLOOR_BLOOM.radius, FLOOR_BLOOM.threshold);
    this.pass.materialHighPassFilter.fragmentShader = EXCESS_FRAGMENT;
    this.pass.materialHighPassFilter.needsUpdate = true;
    this.setLook(FLOOR_BLOOM);
    this.sceneRT = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.postRT = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, depthBuffer: false });
    this.gradeMat = new THREE.RawShaderMaterial({ name: 'FloorGrade', uniforms: gradeUniforms(), vertexShader: GRADE_VERTEX, fragmentShader: GRADE_FRAGMENT, depthTest: false, depthWrite: false });
    this.gradeQuad = new FullScreenQuad(this.gradeMat);
    // Low's smoothing draws the scene into a half-float target first: only where that's allowed
    const ext = r.extensions;
    const fragment = fxaaFragment();
    this.canSmooth = !!fragment && (ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float'));
    if (this.canSmooth && fragment) {
      // toneMapped off: the pass tone-maps its own taps, so three adds none of its own
      this.fxaaMat = new THREE.ShaderMaterial({ name: 'FloorSmooth', uniforms: { ...gradeUniforms(), resolution: { value: new THREE.Vector2(1, 1) } }, vertexShader: FXAAShader.vertexShader, fragmentShader: fragment, toneMapped: false, depthTest: false, depthWrite: false });
      this.fxaaQuad = new FullScreenQuad(this.fxaaMat);
    } else {
      this.fxaaMat = null;
      this.fxaaQuad = null;
    }
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
    this.offPrefs = followGraphicsPrefs((p) => {
      this.prefs = p;
      this.mute(this.muted);
      this.want = this.gradeFor(this.room);
    });
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
   * HDR target, grade and tone mapping, so a frame with and without it differ only by the glow itself.
   */
  mute(on: boolean): void {
    this.muted = on;
    this.pass.strength = on || !this.prefs.glow ? 0 : this.strength * calmScale(CALM_BLOOM);
  }

  /** How the glow looks: FLOOR_BLOOM on the floor, TABLE_BLOOM or MACHINE_BLOOM seated. */
  setLook(l: BloomLook): void {
    this.pass.threshold = l.threshold;
    this.strength = l.strength;
    this.mute(this.muted);
    this.pass.radius = l.radius;
    (this.pass.highPassUniforms as { smoothWidth: { value: number } }).smoothWidth.value = l.knee;
  }

  private room = '';

  /** The room (or zone, or 'studio') the camera is in: its grade eases in over a second or so. */
  setRoom(room: string): void {
    if (room === this.room) return;
    this.room = room;
    this.want = this.gradeFor(room);
    // the first room is simply there, not eased in from nothing
    if (!this.graded) {
      this.graded = true;
      copyGrade(this.grade, this.want);
    }
  }

  private gradeFor(room: string): Grade {
    return this.prefs.film ? (GRADES[room] ?? BASE) : NEUTRAL_GRADE;
  }

  get active(): boolean {
    return this.enabled && (this.mode === 'hooks' || this.mode === 'effects');
  }

  /** Whether Low smooths its edges (the option is on and the graphics card can). */
  get smoothing(): boolean {
    return !this.enabled && this.canSmooth && this.prefs.smooth;
  }

  /** Per frame, before the engine renders. */
  update(dt: number): void {
    this.dt = dt;
    // the grade eases toward the room's: no step as you cross a doorway
    const k = 1 - Math.exp(-dt * 1.6);
    const g = this.grade;
    const w = this.want;
    for (let i = 0; i < 3; i++) g.balance[i]! += (w.balance[i]! - g.balance[i]!) * k;
    g.saturation += (w.saturation - g.saturation) * k;
    g.contrast += (w.contrast - g.contrast) * k;
    g.vignette += (w.vignette - g.vignette) * k;
  }

  private before(renderer: THREE.WebGLRenderer, camera: THREE.Camera, target: THREE.WebGLRenderTarget | null): void {
    this.redirected = null;
    if (camera !== this.engine.camera) return;
    if (!this.enabled) {
      // Low: through the smoothing pass, where it's on
      if (!this.smoothing || target !== null) return;
      renderer.getDrawingBufferSize(this.size);
      if (!this.lowRT) this.lowRT = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType });
      else if (this.lowRT.width !== this.size.x || this.lowRT.height !== this.size.y) this.lowRT.setSize(this.size.x, this.size.y);
      renderer.setRenderTarget(this.lowRT);
      this.redirected = 'low';
      return;
    }
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
    this.redirected = 'high';
  }

  /** The graded pass's uniforms for this frame. */
  private paint(u: Record<string, THREE.IUniform>, renderer: THREE.WebGLRenderer, source: THREE.Texture): void {
    const g = this.grade;
    u.tDiffuse!.value = source;
    u.toneMappingExposure!.value = renderer.toneMappingExposure;
    (u.uBalance!.value as THREE.Vector3).set(g.balance[0], g.balance[1], g.balance[2]);
    u.uSaturation!.value = g.saturation;
    u.uContrast!.value = g.contrast;
    u.uVignette!.value = g.vignette;
    const aspect = this.size.y > 0 ? this.size.x / this.size.y : 1;
    (u.uAspect!.value as THREE.Vector2).set(aspect, 1);
  }

  private after(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const where = this.redirected;
    if (!where || camera !== this.engine.camera) return;
    this.redirected = null;
    if (where === 'low') {
      renderer.setRenderTarget(null);
      const u = this.fxaaMat!.uniforms;
      this.paint(u, renderer, this.lowRT!.texture);
      (u.resolution!.value as THREE.Vector2).set(1 / this.size.x, 1 / this.size.y);
      this.fxaaQuad!.render(renderer);
      return;
    }
    let source = this.sceneRT.texture;
    if (this.pass.strength > 0) {
      // multisampled scene -> plain buffer (the bloom blends into its input) -> bloom
      this.copy.render(renderer, this.postRT, this.sceneRT, this.dt, false);
      this.pass.render(renderer, null as unknown as THREE.WebGLRenderTarget, this.postRT, this.dt, false);
      source = this.postRT.texture;
    }
    // (no glow: the resolved scene goes straight to the grade, two passes and six blurs saved)
    renderer.setRenderTarget(null);
    this.paint(this.gradeMat.uniforms, renderer, source);
    this.gradeQuad.render(renderer);
  }

  dispose(): void {
    this.offCalm();
    this.offPrefs();
    this.engine.scene.onBeforeRender = this.prevBefore;
    this.engine.scene.onAfterRender = this.prevAfter;
    if (this.mode === 'effects') this.engine.renderer.setEffects([]);
    this.sceneRT.dispose();
    this.postRT.dispose();
    this.lowRT?.dispose();
    this.pass.dispose();
    this.copy.dispose();
    this.gradeMat.dispose();
    this.gradeQuad.dispose();
    this.fxaaMat?.dispose();
    this.fxaaQuad?.dispose();
  }
}

function copyGrade(to: Grade, from: Grade): void {
  for (let i = 0; i < 3; i++) to.balance[i] = from.balance[i]!;
  to.saturation = from.saturation;
  to.contrast = from.contrast;
  to.vignette = from.vignette;
}

/** The p90 of the last frames is over `ms` when at least this many of `n` are (no sorting). */
function tail(n: number): number {
  return n - Math.floor(n * 0.9);
}

/**
 * Pixel ratio on High: start at min(devicePixelRatio, 2); step down 0.25 (not below 1.25) when the
 * 90th-percentile frame is over 17 ms for two seconds, back up when under 12 ms for eight, but
 * never within half a minute of stepping down. Every step resizes the canvas, which stalls the page
 * while the GPU catches up (a fifth of a second or more on a busy machine), so a frame rate hovering
 * near the line mustn't see-saw. The Resolution option (render/graphics.ts) can hold it instead:
 * Sharp at the screen's own, Fast at one (three quarters on Low); and the battery saver's thirty
 * frames a second would read as slow frames, so it holds it too.
 */
export class PixelRatio {
  /** The last 60 frame times (ms), as a ring. */
  private readonly samples = new Float32Array(60);
  private count = 0;
  private next = 0;
  private slow = 0;
  private fast = 0;
  /** Seconds since the last step down. */
  private since = Infinity;
  private enabled = false;
  private high = false;
  private max = 1;
  current = 1;
  private readonly offPrefs: () => void;
  private prefs: Readonly<GraphicsPrefs> = graphicsPrefs();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    /** The engine's ceiling (2, a phone's 1.5). */
    private readonly ceiling = 2,
  ) {
    this.offPrefs = followGraphicsPrefs((p) => {
      const changed = p.resolution !== this.prefs.resolution || p.fps !== this.prefs.fps;
      this.prefs = p;
      if (changed) this.set(this.high);
    });
  }

  set(high: boolean): void {
    this.high = high;
    const dpr = window.devicePixelRatio || 1;
    const res = this.prefs.resolution;
    const auto = res === 'auto';
    // adapting only on High's Auto at full frame rate
    this.enabled = high && auto && this.prefs.fps === 'full';
    this.max = res === 'sharp' ? Math.min(dpr, this.ceiling) : res === 'fast' ? (high ? Math.min(1, dpr) : 0.75) : high ? Math.min(dpr, this.ceiling) : 1;
    this.apply(this.max);
  }

  update(dt: number): void {
    if (!this.enabled || dt <= 0) return;
    this.samples[this.next] = dt * 1000;
    this.next = (this.next + 1) % this.samples.length;
    if (this.count < this.samples.length) this.count++;
    if (this.count < 30) return;
    const m = tail(this.count);
    let over = 0;
    let notFast = 0;
    for (let i = 0; i < this.count; i++) {
      const s = this.samples[i]!;
      if (s > 17) over++;
      if (s >= 12) notFast++;
    }
    if (over >= m) {
      this.slow += dt;
      this.fast = 0;
    } else if (notFast < m) {
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
    this.count = 0;
    this.next = 0;
    if (this.renderer.getPixelRatio() !== pr) this.renderer.setPixelRatio(pr);
  }

  dispose(): void {
    this.offPrefs();
  }
}
