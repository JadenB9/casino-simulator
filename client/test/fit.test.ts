import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bestSpace, boxPoints, lensFor, lensed, marginFor, MIN_ZOOM, projectAt, type Rect } from '../src/table/fit.ts';

const W = 1280;
const H = 720;
const inside = (a: Rect, b: Rect, eps = 0.01) => a.left >= b.left - eps && a.right <= b.right + eps && a.top >= b.top - eps && a.bottom <= b.bottom + eps;
const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('lensFor', () => {
  it('leaves a board that already fits exactly as framed', () => {
    const b = { left: 200, top: 100, right: 1000, bottom: 500 };
    expect(lensFor(b, { left: 10, top: 10, right: 1270, bottom: 700 }, W, H)).toEqual({ zoom: 1, dx: 0, dy: 0 });
  });

  it('slides a board that fits in size but not in place, by the least amount', () => {
    const b = { left: 200, top: 300, right: 1000, bottom: 700 };
    const safe = { left: 10, top: 10, right: 1270, bottom: 600 };
    const l = lensFor(b, safe, W, H);
    expect(l.zoom).toBe(1);
    expect(l.dx).toBe(0);
    expect(l.dy).toBeCloseTo(-100);
    expect(inside(lensed(b, l, W, H), safe)).toBe(true);
  });

  it('widens only as much as the tighter side needs, then fits it inside', () => {
    const b = { left: -200, top: 50, right: 1480, bottom: 650 };
    const safe = { left: 16, top: 80, right: 1264, bottom: 560 };
    const l = lensFor(b, safe, W, H);
    expect(l.zoom).toBeCloseTo(Math.min((1264 - 16) / 1680, (560 - 80) / 600));
    const out = lensed(b, l, W, H);
    expect(inside(out, safe)).toBe(true);
    // the tighter side touches its edges
    expect(out.right - out.left).toBeCloseTo(1248);
  });

  it('never zooms in, and stops widening at the minimum', () => {
    expect(lensFor({ left: 600, top: 300, right: 680, bottom: 340 }, { left: 0, top: 0, right: W, bottom: H }, W, H).zoom).toBe(1);
    expect(lensFor({ left: -9000, top: 0, right: 9000, bottom: 10 }, { left: 0, top: 0, right: W, bottom: H }, W, H).zoom).toBe(MIN_ZOOM);
  });
});

describe('bestSpace', () => {
  const hud = [
    { left: 16, top: 14, right: 320, bottom: 66 },
    { left: 480, top: 14, right: 1264, bottom: 50 },
  ];
  const tray = { left: 300, top: 620, right: 980, bottom: 700 };
  const chat = { left: 1150, top: 560, right: 1264, bottom: 600 };

  it('keeps the board clear of every control, with the margin all round', () => {
    const b = { left: 60, top: 40, right: 1220, bottom: 690 };
    const { safe, lens } = bestSpace(b, [...hud, tray, chat], W, H);
    const out = lensed(b, lens, W, H);
    expect(inside(out, safe)).toBe(true);
    for (const o of [...hud, tray, chat]) expect(overlaps(out, o)).toBe(false);
    const m = marginFor(W, H);
    expect(out.left).toBeGreaterThanOrEqual(m - 0.01);
    expect(out.right).toBeLessThanOrEqual(W - m + 0.01);
  });

  it('changes nothing when the board is already clear', () => {
    const b = { left: 200, top: 120, right: 1000, bottom: 540 };
    expect(bestSpace(b, [...hud, tray, chat], W, H).lens).toEqual({ zoom: 1, dx: 0, dy: 0 });
  });

  it('prefers sliding into a clear band over widening', () => {
    // fits between the HUD and the tray if it moves up a little
    const b = { left: 200, top: 200, right: 1000, bottom: 640 };
    const { lens } = bestSpace(b, [...hud, tray], W, H);
    expect(lens.zoom).toBe(1);
    expect(lens.dy).toBeLessThan(0);
  });

  it('goes beside a tall panel when that costs less than going above it', () => {
    // a party panel down the right: the board is tall and narrow, so it goes to the left of it
    const panel = { left: 1000, top: 80, right: 1264, bottom: 700 };
    const b = { left: 400, top: 60, right: 900, bottom: 700 };
    const { safe, lens } = bestSpace(b, [panel], W, H);
    expect(safe.right).toBeLessThanOrEqual(1000);
    expect(overlaps(lensed(b, lens, W, H), panel)).toBe(false);
  });

  it('clips controls to the screen (a tray wider than a narrow window)', () => {
    const wide = { left: -24, top: 874, right: 924, bottom: 946 };
    const b = { left: 20, top: 300, right: 880, bottom: 900 };
    const { lens } = bestSpace(b, [wide], 900, 1000);
    expect(overlaps(lensed(b, lens, 900, 1000), wide)).toBe(false);
  });

  it('falls back to the whole screen when controls leave no room at all', () => {
    const cover = { left: 0, top: 0, right: W, bottom: H };
    const b = { left: 100, top: 100, right: 400, bottom: 300 };
    const { safe } = bestSpace(b, [cover], W, H);
    expect(safe.right - safe.left).toBeGreaterThan(W / 2);
  });
});

describe('projectAt', () => {
  const cam = new THREE.PerspectiveCamera(55, W / H, 0.05, 100);
  cam.position.set(0, 1.6, 1.2);
  cam.lookAt(0, 0.8, 0);
  cam.updateMatrixWorld();

  it('agrees with three.js projecting through the camera', () => {
    const pts = boxPoints(new THREE.Box3(new THREE.Vector3(-0.8, 0.78, -0.4), new THREE.Vector3(0.8, 0.8, 0.4)));
    const { px, behind } = projectAt(pts, { position: cam.position, quaternion: cam.quaternion }, 55, W, H);
    expect(behind).toBe(0);
    pts.forEach((p, i) => {
      const n = p.clone().project(cam);
      expect(px[i]!.x).toBeCloseTo(((n.x + 1) / 2) * W, 3);
      expect(px[i]!.y).toBeCloseTo(((1 - n.y) / 2) * H, 3);
    });
  });

  it('counts points behind the eye apart', () => {
    const r = projectAt([new THREE.Vector3(0, 1.6, 3)], { position: cam.position, quaternion: cam.quaternion }, 55, W, H);
    expect(r.behind).toBe(1);
    expect(r.box).toBeNull();
  });

  it('a lensed camera draws the board inside the space the fit chose', () => {
    // a board wider than the screen from this eye, a tray along the bottom
    const pts = boxPoints(new THREE.Box3(new THREE.Vector3(-1.4, 0.78, -0.5), new THREE.Vector3(1.4, 0.8, 0.5)));
    const tray = { left: 200, top: 600, right: 1080, bottom: 700 };
    const eye = { position: cam.position, quaternion: cam.quaternion };
    const { box } = projectAt(pts, eye, 55, W, H);
    const { safe, lens } = bestSpace(box!, [tray], W, H);
    expect(lens.zoom).toBeLessThan(1);
    const c = cam.clone();
    c.zoom = lens.zoom;
    c.setViewOffset(W, H, -lens.dx, -lens.dy, W, H);
    c.updateProjectionMatrix();
    for (const p of pts) {
      const n = p.clone().project(c);
      const x = ((n.x + 1) / 2) * W;
      const y = ((1 - n.y) / 2) * H;
      expect(x).toBeGreaterThanOrEqual(safe.left - 0.01);
      expect(x).toBeLessThanOrEqual(safe.right + 0.01);
      expect(y).toBeGreaterThanOrEqual(safe.top - 0.01);
      expect(y).toBeLessThanOrEqual(safe.bottom + 0.01);
    }
  });
});
