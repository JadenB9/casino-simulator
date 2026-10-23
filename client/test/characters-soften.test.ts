// v8: the characters' smooth shading and planted feet. soften() gives a flat-shaded model the
// normals of the surface round each corner (keeping real edges) and joins the corners left alike;
// measureGait() reads how far a walk or run clip carries the body from its feet; motionOf() and
// speedOf() are the setMotion numbers' ground speeds, both ways.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { measureGait, soften } from '../src/world/characters.ts';
import { MOTION_MAX, RUN_CYCLE, WALK_CYCLE, motionOf, speedOf } from '../src/world/contract.ts';

/**
 * A flat-shaded hexagonal prism as the models come: every face with corners of its own and the
 * face's normal on them. Six sides (quads) and a top cap (a fan), the cap a different kind.
 */
function prism(): { geometry: THREE.BufferGeometry; slot: Uint8Array; base: Float32Array; kind: Uint8Array } {
  const ring = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)] as const;
  });
  const pos: number[] = [];
  const nor: number[] = [];
  const kind: number[] = [];
  const index: number[] = [];
  const corner = (x: number, y: number, z: number, n: THREE.Vector3, k: number) => {
    pos.push(x, y, z);
    nor.push(n.x, n.y, n.z);
    kind.push(k);
    return pos.length / 3 - 1;
  };
  for (let i = 0; i < 6; i++) {
    const [ax, az] = ring[i]!;
    const [bx, bz] = ring[(i + 1) % 6]!;
    const n = new THREE.Vector3((ax + bx) / 2, 0, (az + bz) / 2).normalize();
    const a0 = corner(ax, 0, az, n, 4);
    const b0 = corner(bx, 0, bz, n, 4);
    const b1 = corner(bx, 1, bz, n, 4);
    const a1 = corner(ax, 1, az, n, 4);
    index.push(a0, b1, b0, a0, a1, b1);
  }
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 6; i++) {
    const [ax, az] = ring[i]!;
    const [bx, bz] = ring[(i + 1) % 6]!;
    const c = corner(0, 1, 0, up, 1);
    const a = corner(ax, 1, az, up, 1);
    const b = corner(bx, 1, bz, up, 1);
    index.push(c, b, a);
  }
  const n = pos.length / 3;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  geometry.setIndex(index);
  return { geometry, slot: new Uint8Array(n).fill(5), base: new Float32Array(n * 3), kind: Uint8Array.from(kind) };
}

describe('soften', () => {
  it('shades a curve smoothly: each side corner takes the normal of the surface round it', () => {
    const out = soften(prism());
    const p = out.geometry.getAttribute('position');
    const n = out.geometry.getAttribute('normal');
    let sides = 0;
    for (let i = 0; i < p.count; i++) {
      if (out.kind[i] !== 4) continue;
      sides++;
      // straight out from the axis, through the corner itself
      const radial = new THREE.Vector3(p.getX(i), 0, p.getZ(i)).normalize();
      expect(new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)).dot(radial)).toBeCloseTo(1, 5);
    }
    expect(sides).toBe(12);
  });

  it('keeps a real edge: the top stays flat where it turns a right angle from the sides', () => {
    const out = soften(prism());
    const n = out.geometry.getAttribute('normal');
    for (let i = 0; i < n.count; i++) if (out.kind[i] === 1) expect(n.getY(i)).toBeCloseTo(1, 6);
  });

  it('joins the corners left alike, every face kept', () => {
    const before = prism();
    const out = soften(before);
    // 24 side corners become the two rings; the cap's 18 its middle and its ring
    expect(out.geometry.getAttribute('position').count).toBe(12 + 7);
    expect(out.geometry.getIndex()!.count).toBe(before.geometry.getIndex()!.count);
    expect(out.slot.length).toBe(19);
    expect(out.base.length).toBe(19 * 3);
  });

  it('says what each vertex is made of, for the material', () => {
    const out = soften(prism());
    const s = out.geometry.getAttribute('surface');
    expect(s.itemSize).toBe(4);
    expect(s.count).toBe(19);
    // cloth (4) is rougher than hair (1), and neither is skin
    const rough = (k: number) => {
      for (let i = 0; i < s.count; i++) if (out.kind[i] === k) return [s.getX(i), s.getW(i)];
      return null;
    };
    const cloth = rough(4)!;
    const hair = rough(1)!;
    expect(cloth[0]).toBeGreaterThan(hair[0]!);
    expect(cloth[1]).toBe(0);
    expect(hair[1]).toBe(0);
  });
});

/**
 * Two feet stepping: each slides back from `half` ahead of the middle to `half` behind while it's
 * down (the first half of its cycle), then swings forward in the air. The right foot is furthest
 * ahead `lead` of the way into the clip, the left half a cycle on.
 */
function stepping(name: string, dur: number, half: number, lead: number): THREE.AnimationClip {
  const foot = (from: number): { times: number[]; values: number[] } => {
    const times: number[] = [];
    const values: number[] = [];
    for (let i = 0; i <= 400; i++) {
      const p = (((i / 400 - from) % 1) + 1) % 1;
      const down = p <= 0.5;
      times.push((i / 400) * dur);
      values.push(0, down ? 0 : 0.1, down ? half - 4 * half * p : -half + 4 * half * (p - 0.5));
    }
    return { times, values };
  };
  const r = foot(lead);
  const l = foot(lead + 0.5);
  return new THREE.AnimationClip(name, dur, [new THREE.VectorKeyframeTrack('FootR.position', r.times, r.values), new THREE.VectorKeyframeTrack('FootL.position', l.times, l.values)]);
}

function rig(): THREE.Object3D {
  const root = new THREE.Group();
  const r = new THREE.Object3D();
  r.name = 'FootR';
  const l = new THREE.Object3D();
  l.name = 'FootL';
  root.add(r, l);
  return root;
}

describe('measureGait', () => {
  it('reads how far each clip carries the body in a cycle, from the foot that is down', () => {
    // each foot slides 0.8 m back under the body per step: a 1.6 m stride per cycle
    const g = measureGait(rig(), [stepping('Walk', 1.333, 0.4, 0), stepping('Run', 0.8, 0.55, 0.25)])!;
    expect(g).not.toBeNull();
    expect(g.walk.length).toBeCloseTo(1.6, 1);
    expect(g.walk.dur).toBeCloseTo(1.333, 6);
    expect(g.run.length).toBeCloseTo(2.2, 1);
  });

  it('notes where the right foot leads, to play the two clips in step', () => {
    const g = measureGait(rig(), [stepping('Walk', 1.333, 0.4, 0), stepping('Run', 0.8, 0.55, 0.25)])!;
    expect(g.walk.at).toBeCloseTo(0, 1);
    expect(g.run.at).toBeCloseTo(0.25, 1);
  });

  it('gives up on a model without feet or clips (the old blend by weight takes over)', () => {
    expect(measureGait(new THREE.Group(), [stepping('Walk', 1, 0.4, 0), stepping('Run', 1, 0.4, 0)])).toBeNull();
    expect(measureGait(rig(), [stepping('Walk', 1, 0.4, 0)])).toBeNull();
  });
});

describe('motion numbers', () => {
  it('are a walk at 1 and a run at 2, and nothing for standing still', () => {
    expect(motionOf(WALK_CYCLE)).toBeCloseTo(1, 9);
    expect(motionOf(RUN_CYCLE)).toBeCloseTo(2, 9);
    expect(motionOf(0)).toBe(0);
    expect(motionOf(0.01)).toBe(0);
    expect(motionOf(Number.NaN)).toBe(0);
  });

  it('turn back into the speed they were made from, up to the fastest anything goes', () => {
    for (const v of [0.3, 1, 1.75, 2.6, 4.8, 6.5]) expect(speedOf(motionOf(v))).toBeCloseTo(v, 9);
    expect(motionOf(100)).toBe(MOTION_MAX);
  });

  it('only ever grow with the speed', () => {
    let last = -1;
    for (let v = 0; v < 9; v += 0.05) {
      const m = motionOf(v);
      expect(m).toBeGreaterThanOrEqual(last);
      last = m;
    }
  });
});
