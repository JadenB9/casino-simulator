import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { cardGeometry, faceSvg, FOUR_COLOUR, CARD_W, CARD_H } from '../src/table/cards.ts';

// The card kit's faces and shape (table/cards.ts): the four-colour deck recolours only the pips and
// indices of diamonds and clubs (never a court card's picture), and the card's shape keeps the
// material slots code reaches a face by (2 the face, 3 the back) with the face the right way up.

const svg = (code: string) => readFileSync(new URL(`../public/assets/cards/${code}.svg`, import.meta.url), 'utf8');

describe('the four-colour deck', () => {
  it('turns the diamonds blue and the clubs green, pips and indices alike', () => {
    const d = faceSvg(svg('7d'), '7d', 'four');
    expect(d).not.toMatch(/<symbol id="[SV]D7"[^]*?(fill|stroke)="red"[^]*?<\/symbol>/);
    expect(d).toContain(`fill="${FOUR_COLOUR.d}"`);
    expect(d).toContain(`stroke="${FOUR_COLOUR.d}"`);
    const c = faceSvg(svg('Tc'), 'Tc', 'four');
    expect(c).toContain(`fill="${FOUR_COLOUR.c}"`);
    expect(c).not.toMatch(/<symbol id="SCT"[^]*?fill="black"[^]*?<\/symbol>/);
  });

  it('leaves the court figures their own colours, and hearts and spades as they are', () => {
    const q = faceSvg(svg('Qd'), 'Qd', 'four');
    // the queen's picture (symbols DQ1..DQ6) keeps its red
    const pictures = [...q.matchAll(/<symbol id="DQ\d"[^]*?<\/symbol>/g)].map((m) => m[0]).join('');
    expect(pictures).toBe([...svg('Qd').matchAll(/<symbol id="DQ\d"[^]*?<\/symbol>/g)].map((m) => m[0]).join(''));
    for (const code of ['Ah', 'Ks', '9h', '2s']) expect(faceSvg(svg(code), code, 'four')).toBe(faceSvg(svg(code), code, 'classic'));
  });

  it('softens the paper’s outline in both decks, and changes nothing else in the classic one', () => {
    for (const code of ['As', '7d', 'Kc']) {
      const out = faceSvg(svg(code), code, 'classic');
      expect(out).toMatch(/<rect[^>]*fill="white"[^>]*stroke="#cfc8bb"/);
      expect(out.replace('#cfc8bb', 'black')).toBe(svg(code));
    }
  });
});

describe('the card’s shape', () => {
  const g = cardGeometry();

  it('draws in three groups: the edge, the face and the back, in the box’s material slots', () => {
    expect(g.groups.map((x) => x.materialIndex)).toEqual([0, 2, 3]);
    const total = g.groups.reduce((a, x) => a + x.count, 0);
    expect(total).toBe(g.index!.count);
  });

  it('is a poker card’s size and a hair thick, with rounded corners', () => {
    const box = g.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(CARD_W, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(CARD_H, 6);
    expect(box.max.y - box.min.y).toBeLessThan(0.001);
    // no vertex sits in a square corner
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(Math.abs(pos.getX(i)) > CARD_W / 2 - 0.0005 && Math.abs(pos.getZ(i)) > CARD_H / 2 - 0.0005).toBe(false);
  });

  it('maps the face the way the box did: the picture’s top toward -z, the face up', () => {
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const nor = g.getAttribute('normal');
    const face = g.groups[1]!;
    const idx = g.index!;
    const seen = new Set<number>();
    for (let k = face.start; k < face.start + face.count; k++) seen.add(idx.getX(k));
    for (const i of seen) {
      expect(nor.getY(i)).toBe(1);
      expect(uv.getX(i)).toBeCloseTo(pos.getX(i) / CARD_W + 0.5, 6);
      expect(uv.getY(i)).toBeCloseTo(0.5 - pos.getZ(i) / CARD_H, 6);
    }
    // its triangles face up (counter-clockwise seen from above)
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let k = face.start; k < face.start + face.count; k += 3) {
      a.fromBufferAttribute(pos, idx.getX(k));
      b.fromBufferAttribute(pos, idx.getX(k + 1));
      c.fromBufferAttribute(pos, idx.getX(k + 2));
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      expect(n.y).toBeGreaterThan(0);
    }
  });
});
