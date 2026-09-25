// The joker. The deck's art has no joker, so its face is painted here, in the deck's manner: cream
// paper, JOKER spelled down the corners, and a jester's cap with its bells in the middle. The same
// face goes on the table's cards (a texture) and in the hand-setting panel (a canvas).

import * as THREE from 'three';
import type { Card } from '../../../../shared/src/cards.ts';
import { JOKER, type PgCard } from '../../../../shared/src/games/paigow/rules.ts';
import { CardMesh } from '../../table/cards.ts';

const W = 256;
const H = 358;
const RED = '#b3121f';
const INK = '#1b1b1f';

/** Paint the joker's face on a canvas of any size (the card's proportions). */
export function paintJoker(c: HTMLCanvasElement): void {
  const g = c.getContext('2d')!;
  const s = c.width / W;
  g.save();
  g.scale(s, s);
  g.fillStyle = '#fbf8f1';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, W - 2, H - 2);

  // JOKER down the top-left corner and, turned, up the bottom-right
  const corner = () => {
    g.fillStyle = RED;
    g.font = '700 25px Cinzel, Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    [...'JOKER'].forEach((ch, i) => g.fillText(ch, 22, 30 + i * 25));
    // a small star under the letters
    star(g, 22, 30 + 5 * 25 + 4, 7, RED);
  };
  corner();
  g.save();
  g.translate(W, H);
  g.rotate(Math.PI);
  corner();
  g.restore();

  // the frame in the middle
  g.strokeStyle = 'rgba(179,18,31,0.55)';
  g.lineWidth = 2;
  g.strokeRect(48, 44, W - 96, H - 88);

  // the jester's cap: a band, three horns curling out, a bell at each tip
  const cx = W / 2;
  const cy = H / 2 + 6;
  g.lineJoin = 'round';
  const horn = (x0: number, x1: number, tipX: number, tipY: number, c0: [number, number], c1: [number, number], color: string) => {
    g.beginPath();
    g.moveTo(x0, cy + 10);
    g.quadraticCurveTo(c0[0], c0[1], tipX, tipY);
    g.quadraticCurveTo(c1[0], c1[1], x1, cy + 10);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.stroke();
  };
  horn(cx - 42, cx - 6, cx - 70, cy - 64, [cx - 66, cy - 6], [cx - 26, cy - 34], RED);
  horn(cx + 6, cx + 42, cx + 70, cy - 64, [cx + 26, cy - 34], [cx + 66, cy - 6], INK);
  horn(cx - 18, cx + 18, cx, cy - 92, [cx - 30, cy - 40], [cx + 30, cy - 40], RED);
  for (const [x, y] of [
    [cx - 70, cy - 64],
    [cx + 70, cy - 64],
    [cx, cy - 92],
  ] as [number, number][]) {
    g.beginPath();
    g.arc(x, y - 3, 8, 0, Math.PI * 2);
    g.fillStyle = '#d9a93a';
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1.5;
    g.stroke();
  }
  // the band, checked red and black
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i % 2 ? INK : RED;
    g.fillRect(cx - 42 + i * 14, cy + 8, 14, 16);
  }
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.strokeRect(cx - 42, cy + 8, 84, 16);
  // a diamond below, and the word
  g.beginPath();
  g.moveTo(cx, cy + 40);
  g.lineTo(cx + 11, cy + 54);
  g.lineTo(cx, cy + 68);
  g.lineTo(cx - 11, cy + 54);
  g.closePath();
  g.fillStyle = RED;
  g.fill();
  g.fillStyle = INK;
  g.font = '700 22px Cinzel, Georgia, serif';
  g.textAlign = 'center';
  g.fillText('JOKER', cx, cy + 92);
  g.restore();
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

let texture: THREE.CanvasTexture | null = null;

/** The joker's face as a texture, painted once and kept (every table's joker shares it). */
function jokerTexture(): THREE.CanvasTexture {
  if (texture) return texture;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  paintJoker(c);
  texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.userData.shared = true;
  return texture;
}

/** A card on the table that may be the joker: `face` is what it shows once turned. */
export class PgCardMesh extends CardMesh {
  face: PgCard | null = null;

  constructor(card: PgCard | null) {
    super(card === JOKER ? null : card);
    if (card) this.show(card);
  }

  /** Put this face on the card (the table's card art, or the painted joker). */
  show(card: PgCard): void {
    this.face = card;
    if (card !== JOKER) {
      this.setCard(card as Card);
      return;
    }
    const mats = this.material as THREE.MeshStandardMaterial[];
    mats[2]!.map = jokerTexture();
    mats[2]!.needsUpdate = true;
  }
}
