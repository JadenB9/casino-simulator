// What the effects are built from, made once and shared: geometries, textures and materials. An
// effect only makes its own meshes (and its own copy of a material when it animates the material's
// uniforms) and lets those go when it ends; the stock stays until the floor goes. Keeping every
// material alive also keeps its shader program, so the second disco doesn't recompile anything,
// and warm() hands the world one of everything to compile behind the loading screen, so the
// first one doesn't either.

import * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import { beamGeometry, beamMaterial, poolGeometry, poolMaterial, poolTexture, Sparks } from './particles.ts';

/** A US hundred-dollar bill's size (m), a little larger so it reads from across the room. */
export const BILL = { w: 0.156 * 1.2, h: 0.066 * 1.2 };
export const COIN = { r: 0.026, h: 0.004 };

export class Stock {
  readonly paperGeo = new THREE.PlaneGeometry(0.032, 0.02);
  readonly billGeo = new THREE.PlaneGeometry(BILL.w, BILL.h);
  readonly coinGeo = new THREE.CylinderGeometry(COIN.r, COIN.r, COIN.h, 20);
  readonly beamGeo = beamGeometry();
  /** A shaft of light: wide where it comes in, a little wider where it lands. */
  readonly shaftGeo = new THREE.CylinderGeometry(0.75, 1, 1, 20, 4, true).translate(0, -0.5, 0);
  readonly poolGeo = poolGeometry();
  readonly soft = poolTexture(0);
  readonly crisp = poolTexture(0.86);
  readonly bill = billTexture();
  private readonly made = new Map<string, THREE.Material>();

  constructor(private readonly env: () => THREE.Texture | null) {}

  private once<M extends THREE.Material>(key: string, make: () => M): M {
    let m = this.made.get(key) as M | undefined;
    if (!m) {
      m = make();
      m.name ||= `fx-${key}`;
      this.made.set(key, m);
    }
    return m;
  }

  /** Confetti: paper with a little sheen on High (the gold pieces are foil). */
  paper(q: Quality): THREE.Material {
    return this.once(`paper-${q}`, () => (q === 'high' ? new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.42, metalness: 0.3 }) : new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })));
  }

  money(q: Quality): THREE.Material {
    return this.once(`money-${q}`, () => (q === 'high' ? new THREE.MeshStandardMaterial({ map: this.bill, side: THREE.DoubleSide, roughness: 0.85 }) : new THREE.MeshLambertMaterial({ map: this.bill, side: THREE.DoubleSide })));
  }

  /** Gold coins: polished metal reflecting the casino on High; a warm gold that reads without it on Low. */
  coin(q: Quality): THREE.Material {
    const m = this.once(`coin-${q}`, () => (q === 'high' ? new THREE.MeshStandardMaterial({ color: '#ffc75a', metalness: 1, roughness: 0.3, envMapIntensity: 2.4, emissive: '#5a3a08' }) : new THREE.MeshLambertMaterial({ color: '#e0b14a', emissive: '#4a3208' })));
    // the reflections are captured after the floor compiles: take them up once they exist
    const env = q === 'high' ? this.env() : null;
    if (env && (m as THREE.MeshStandardMaterial).envMap !== env) {
      (m as THREE.MeshStandardMaterial).envMap = env;
      m.needsUpdate = true;
    }
    return m;
  }

  /** Lamp housings, stands, the spark machines: black metal. */
  dark(q: Quality): THREE.Material {
    return this.once(`dark-${q}`, () => (q === 'high' ? new THREE.MeshStandardMaterial({ color: '#141416', metalness: 0.6, roughness: 0.45 }) : new THREE.MeshLambertMaterial({ color: '#121214' })));
  }

  /** A lamp's lens seen from in front: past the bloom threshold. */
  lens(): THREE.MeshBasicMaterial {
    return this.once('lens', () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4e0').multiplyScalar(4) }));
  }

  /** A beam's material, to copy for an effect of its own (its colour and strength are uniforms). */
  beam(): THREE.ShaderMaterial {
    return this.once('beam', () => beamMaterial('#fff1d8', 0.5, 'fx-beam'));
  }

  pool(kind: 'soft' | 'crisp'): THREE.MeshBasicMaterial {
    return this.once(`pool-${kind}`, () => poolMaterial(kind === 'soft' ? this.soft : this.crisp, new THREE.Color(1, 1, 1), `fx-pool-${kind}`));
  }

  /** One of everything, for the world to compile with the floor (they're never drawn). */
  warm(q: Quality): THREE.Object3D {
    const g = new THREE.Group();
    g.name = 'fx-warm';
    const inst = (geo: THREE.BufferGeometry, m: THREE.Material) => {
      const mesh = new THREE.InstancedMesh(geo, m, 1);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3).fill(1), 3);
      return mesh;
    };
    g.add(inst(this.paperGeo, this.paper(q)), inst(this.billGeo, this.money(q)), inst(this.coinGeo, this.coin(q)), inst(this.beamGeo, this.beam()));
    g.add(new THREE.Mesh(this.beamGeo, this.beam()), new THREE.Mesh(this.poolGeo, this.pool('soft')), new THREE.Mesh(this.poolGeo, this.pool('crisp')));
    g.add(new THREE.Mesh(this.coinGeo, this.dark(q)), new THREE.Mesh(this.coinGeo, this.lens()));
    const sparks = new Sparks(1, { hot: '#fff', cool: '#fa0', gain: 1, width: 0.01, len: 0.03, name: 'fx-warm-sparks' });
    this.made.set('warm-sparks', sparks.mesh.material as THREE.Material);
    g.add(sparks.mesh);
    for (const o of g.children) {
      o.frustumCulled = false;
      o.position.y = -100;
    }
    g.visible = false;
    return g;
  }

  dispose(): void {
    for (const m of this.made.values()) m.dispose();
    this.made.clear();
    for (const g of [this.paperGeo, this.billGeo, this.coinGeo, this.beamGeo, this.shaftGeo, this.poolGeo]) g.dispose();
    for (const t of [this.soft, this.crisp, this.bill]) t.dispose();
  }
}

/**
 * A hundred-dollar bill, drawn: the pale green-grey paper, the portrait in its oval frame, the blue
 * security ribbon down the middle, the big 100 in the corners and the copper bell in its inkwell.
 * Both sides read the same (a bill tumbling shows its back half the time; nobody can tell).
 */
function billTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 218;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  // the paper, a little darker at the edges
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#c9cfbd');
  g.addColorStop(0.5, '#dfe2d2');
  g.addColorStop(1, '#c4cab6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // fine engraving lines
  ctx.strokeStyle = 'rgba(60, 84, 70, 0.18)';
  ctx.lineWidth = 1;
  for (let y = 6; y < h; y += 5) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.05 + y * 0.3) * 1.5);
    ctx.stroke();
  }
  // the border
  ctx.strokeStyle = '#4f6356';
  ctx.lineWidth = 7;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.lineWidth = 2;
  ctx.strokeRect(22, 22, w - 44, h - 44);
  // the portrait: an oval frame and a figure's head and shoulders in the engraving's green-brown
  const px = w * 0.5;
  const py = h * 0.5;
  ctx.fillStyle = '#b9bea8';
  ctx.beginPath();
  ctx.ellipse(px, py, 58, 78, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#46594b';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = '#5a5a44';
  ctx.beginPath();
  ctx.ellipse(px, py - 12, 22, 27, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(px, py + 52, 44, 30, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // the blue ribbon, to the left of the portrait
  ctx.fillStyle = '#2f5fa8';
  ctx.fillRect(w * 0.32, 12, 12, h - 24);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let y = 18; y < h - 16; y += 14) ctx.fillRect(w * 0.32 + 3, y, 6, 5);
  // the bell in the inkwell, copper turning green
  ctx.fillStyle = '#9a6a3a';
  ctx.beginPath();
  ctx.ellipse(w * 0.7, h * 0.56, 22, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  // the hundreds
  ctx.fillStyle = '#3f5446';
  ctx.font = 'bold 44px Georgia, serif';
  ctx.textBaseline = 'top';
  ctx.fillText('100', 30, 26);
  ctx.textAlign = 'right';
  ctx.fillText('100', w - 30, 26);
  ctx.textBaseline = 'bottom';
  ctx.fillText('100', w - 30, h - 24);
  ctx.textAlign = 'left';
  ctx.fillText('100', 30, h - 24);
  // the big gold 100 at the lower right, the note's own
  ctx.fillStyle = '#a88a3a';
  ctx.font = 'bold 60px Georgia, serif';
  ctx.textAlign = 'right';
  ctx.fillText('100', w - 60, h - 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
