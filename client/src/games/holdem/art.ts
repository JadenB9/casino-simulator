// The poker table's surfaces, painted in code once and shared by every Hold'em table: the felt's
// weave, walnut for the racetrack and frame, the rail's black leather with its stitched seams,
// the chairs' hide, and a plain red card back for the dealer's deck and the muck.

import * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';

export const FELT_COLOR = '#16593a';

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A small random generator, so every table paints the same wood and leather. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let weaveTex: THREE.CanvasTexture | null = null;

/**
 * Speed cloth up close: a plain weave, over-under threads, as a height map (white is high). One
 * tile is eight threads each way; `repeat` sets how many tiles cover a surface.
 */
export function weave(): THREE.CanvasTexture {
  if (weaveTex) return weaveTex;
  weaveTex = canvasTexture(64, 64, (g) => {
    g.fillStyle = '#404040';
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        // each cell shows the thread on top there: along x when i + j is even, along y otherwise
        const along = (i + j) % 2 === 0;
        const grad = along ? g.createLinearGradient(0, j * 8, 0, j * 8 + 8) : g.createLinearGradient(i * 8, 0, i * 8 + 8, 0);
        grad.addColorStop(0, '#303030');
        grad.addColorStop(0.5, '#d0d0d0');
        grad.addColorStop(1, '#303030');
        g.fillStyle = grad;
        g.fillRect(i * 8, j * 8, 8, 8);
      }
    }
  }, false);
  weaveTex.wrapS = weaveTex.wrapT = THREE.RepeatWrapping;
  return weaveTex;
}

/** A weave texture set to repeat every `pitch` metres over a surface `w` x `d` metres. */
export function weaveFor(w: number, d: number, pitch = 0.024): THREE.Texture {
  const t = weave().clone();
  t.repeat.set(w / pitch, d / pitch);
  t.needsUpdate = true;
  return t;
}

/** Walnut: long, slightly wavy grain along u, with a few darker streaks. */
function walnut(): THREE.CanvasTexture {
  const r = rng(11);
  const t = canvasTexture(1024, 128, (g) => {
    g.fillStyle = '#35200f';
    g.fillRect(0, 0, 1024, 128);
    for (let i = 0; i < 140; i++) {
      const y0 = r() * 128;
      g.strokeStyle = r() < 0.75 ? '#170b05' : '#5a3620';
      g.globalAlpha = 0.07 + r() * 0.2;
      g.lineWidth = 0.6 + r() * 2.4;
      g.beginPath();
      for (let x = 0; x <= 1024; x += 16) {
        const y = y0 + Math.sin(x / (70 + i * 3) + i) * 2.5 + Math.sin(x / 13 + i * 1.7) * 0.5;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The rail's profile, round which its texture's v runs; the seams sit at these fractions of it. */
export interface RailSeams {
  inner: number;
  outer: number;
}

/**
 * Black rail leather: a fine pebble grain, and along each top shoulder a pressed seam with a row
 * of tan stitches beside it. u runs along the rail (one texture width is eight stitches), v
 * round its profile.
 */
function railLeather(seams: RailSeams): THREE.CanvasTexture {
  const r = rng(23);
  const W = 256;
  const H = 512;
  const t = canvasTexture(W, H, (g) => {
    g.fillStyle = '#121110';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.35)' : 'rgba(110,104,98,0.08)';
      g.beginPath();
      g.arc(r() * W, r() * H, 0.5 + r() * 1.3, 0, Math.PI * 2);
      g.fill();
    }
    for (const v of [seams.inner, seams.outer]) {
      // canvas rows run top to bottom, texture v bottom to top
      const y = (1 - v) * H;
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(0, y - 1.5, W, 3);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(0, y + 1.5, W, 1);
      // the stitches sit on the crown side of the seam
      const sy = v > 0.5 ? y + 7 : y - 9;
      g.fillStyle = '#9c8466';
      for (let k = 0; k < 8; k++) g.fillRect(k * (W / 8) + 4, sy, W / 8 - 12, 2.5);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Chair upholstery: a softer black hide, no seams. */
function hide(): THREE.CanvasTexture {
  const r = rng(37);
  const t = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#1b1614';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.3)' : 'rgba(130,100,80,0.08)';
      g.beginPath();
      g.arc(r() * 128, r() * 128, 0.5 + r() * 1.2, 0, Math.PI * 2);
      g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

function cardBack(): THREE.CanvasTexture {
  return canvasTexture(128, 180, (g) => {
    g.fillStyle = '#f3efe6';
    g.fillRect(0, 0, 128, 180);
    g.fillStyle = '#9b1b22';
    g.fillRect(8, 8, 112, 164);
    g.strokeStyle = 'rgba(243,239,230,0.45)';
    g.lineWidth = 1.5;
    for (let i = -180; i < 180; i += 10) {
      g.beginPath();
      g.moveTo(8 + i, 8);
      g.lineTo(8 + i + 164, 172);
      g.moveTo(120 - i, 8);
      g.lineTo(120 - i - 164, 172);
      g.stroke();
    }
  });
}

export interface PokerMaterials {
  walnut: THREE.Material;
  leather: THREE.Material;
  hide: THREE.Material;
  chrome: THREE.Material;
  brass: THREE.Material;
  recess: THREE.Material;
  tray: THREE.Material;
  chip: THREE.Material;
  cardBack: THREE.Material;
  cardEdge: THREE.Material;
  acrylic: THREE.Material;
}

const made = new Map<string, PokerMaterials>();

/** Every table built at one quality shares one set (High adds clear lacquer and a leather sheen). */
export function pokerMaterials(quality: Quality, seams: RailSeams): PokerMaterials {
  const key = `${quality}|${seams.inner.toFixed(4)}|${seams.outer.toFixed(4)}`;
  const have = made.get(key);
  if (have) return have;
  const high = quality === 'high';
  const wood = walnut();
  const m: PokerMaterials = {
    walnut: high
      ? new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.22 })
      : new THREE.MeshStandardMaterial({ map: wood, roughness: 0.45 }),
    leather: high
      ? new THREE.MeshPhysicalMaterial({ map: railLeather(seams), roughness: 0.55, sheen: 0.2, sheenColor: new THREE.Color('#2b2826'), clearcoat: 0.12, clearcoatRoughness: 0.5 })
      : new THREE.MeshStandardMaterial({ map: railLeather(seams), roughness: 0.55 }),
    hide: new THREE.MeshStandardMaterial({ map: hide(), roughness: 0.6 }),
    // brushed stainless, not a mirror: it catches the light without reading as a white ring
    chrome: new THREE.MeshStandardMaterial({ color: '#8f9296', metalness: 1, roughness: 0.38 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b8904a', metalness: 0.85, roughness: 0.3 }),
    recess: new THREE.MeshStandardMaterial({ color: '#0d0b0a', roughness: 0.85 }),
    tray: new THREE.MeshStandardMaterial({ color: '#141110', roughness: 0.32, metalness: 0.1 }),
    chip: new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.02 }),
    cardBack: new THREE.MeshStandardMaterial({ map: cardBack(), roughness: 0.6 }),
    cardEdge: new THREE.MeshStandardMaterial({ color: '#ece6da', roughness: 0.8 }),
    acrylic: new THREE.MeshPhysicalMaterial({ color: '#c9d3d8', roughness: 0.06, transparent: true, opacity: 0.32, clearcoat: 1, depthWrite: false }),
  };
  made.set(key, m);
  return m;
}
