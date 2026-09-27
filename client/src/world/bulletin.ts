// 1.3: the lobby's notice board, beside the directory: what's new, in the casino and out of it.
// Its face is drawn once into a canvas (headlines you can read from across the lobby); E in front
// of it opens the whole list, with the keys as you have them now. Add a line to NEWS and it's on both.

import * as THREE from 'three';
import './bulletin.css';
import { el } from '../ui/kit.ts';
import { keyLabel } from '../ui/keys.ts';
import { openSheet, type Sheet } from '../ui/menu/sheet.ts';
import type { Spot } from './interact.ts';
import type { FloorPlan } from './layout.ts';
import { FURNITURE } from './furniture-spec.ts';

interface News {
  title: string;
  /** Where it is, for the board's small line. */
  where: string;
  /** The board's one line. */
  short: string;
  /** The list's paragraph (keys as they are bound when it opens). */
  long: () => string;
}

/** Newest first. */
export const NEWS: readonly News[] = [
  {
    title: 'New this week',
    where: 'Casino 1.3',
    short: 'Map on M, crouch on Shift, run on Ctrl; everyone on the map',
    long: () =>
      `The map opens on ${keyLabel('map')}, a tap of ${keyLabel('crouch')} crouches and ${keyLabel('run')} runs (change any of them in Settings, Controls). Every map shows where everyone else is. Wins are paid once the ball lands or the cards turn. The pit boss has to be near you, or looking your way, to catch a hot streak. An invite to a table asks for your buy-in the moment you arrive. Knock a street lamp with your car and it goes over.`,
  },
  {
    title: 'Apartments',
    where: 'The Residences, via the Valet Lobby',
    short: 'Your own place in the tower: furnish it, move it about, host a game',
    long: () =>
      'Take an apartment from the concierge in the Valet Lobby downstairs: a Residence, a Grand or the Penthouse with its pool. Furnish it from Maison Home across the street, move any piece where you like or pick it up, and deal Hold\'em at your own poker table. Friends can come up in the elevator.',
  },
  {
    title: 'Cars',
    where: 'The Garage and the Porte-Cochere',
    short: 'Buy a car, have the valet bring it round, drive the Loop Road',
    long: () =>
      `Buy a car at the Garage's lounge desk. Every car you own waits in its bays (the rest in the back: "Your other cars" by the door). Ask the valet at the Porte-Cochere and it's brought round to the curb; ${keyLabel('interact')} gets in and out, ${keyLabel('horn')} is the horn. Drive the Loop Road round the block, and mind the traffic.`,
  },
  {
    title: 'Ace Arms',
    where: 'Across the street',
    short: 'Guns and a shooting range; security takes a dim view',
    long: () =>
      `Guns and a range to try them. ${keyLabel('gun')} draws or puts yours away, a click fires, the right button aims. Fire in the casino and the nearest guard comes over: a warning the first time, jail the next.`,
  },
  {
    title: 'The law',
    where: 'The county jail, across the street',
    short: 'Warned once, jailed the next time; win your bail back',
    long: () =>
      "Throw a punch or fire a gun where security can see you, or win too much where the pit boss can, and you're warned. Do it again inside two minutes and you're taken across the street. Win your bail at the jail's own tables, or a friend can pay it from the online list. Watch your pockets in the day room.",
  },
  {
    title: 'Sky Terrace',
    where: 'The roof, by elevator',
    short: 'Loungers, fire pits and a bar over the city',
    long: () => 'Take the elevator to the roof for the loungers along the rail, the sofas round the fires and a bar on the north rail, with the sunset over the city.',
  },
  {
    title: 'Rides and emotes',
    where: 'The Boutique',
    short: 'Skateboard to Hover Throne; dances and gestures',
    long: () =>
      `Skateboard, scooter, hoverboard, Segway, or the Hover Throne: ${keyLabel('ride')} gets on and off. ${keyLabel('emotes')} opens the emotes; ${keyLabel('crouch')} crouches, Space jumps.`,
  },
  {
    title: 'Drinks and food',
    where: 'The bar and the diner',
    short: 'Order a drink or a bite; too many and the room swims',
    long: () => `Order at the bar or the diner and it's brought over. ${keyLabel('sip')} sips or bites what you're holding. A few drinks too many and the room starts to swim for a while.`,
  },
  {
    title: 'The bank',
    where: 'The cashier, off the lobby',
    short: 'Savings that earn, and money sent to friends',
    long: () => 'Put money in savings to earn on it, send some to another player, or take the top-up when you run dry.',
  },
  {
    title: 'More to play',
    where: 'All over the floor',
    short: 'Bingo, Pachinko, the Jade Room, the Bandit Wheel and more',
    long: () =>
      'The Bingo Hall, the Pachinko Parlour, the Jade Room (Pai Gow and Let It Ride), the Bandit Wheel, the online lounge (Plinko, Crash, Mines, Keno and the rest), Hold\'em in the Poker Room and the High Limit Salon.',
  },
  {
    title: 'Achievements',
    where: 'Anywhere',
    short: 'Challenges, feats and statues for the lobby',
    long: () => `${keyLabel('feats')} opens your achievements and the day's challenges. Big winners can put up a statue in the lobby, and the shop has effects for the whole floor to see.`,
  },
];

/** Where the board's face goes and how big it is (the directory's stand, furniture.ts). */
const FACE = { w: FURNITURE.bulletin.w - 0.12, h: 1.5, y: 1.46 };

/** The board's face: WHAT'S NEW, then each headline and its line. */
function drawBoard(): HTMLCanvasElement {
  const W = 900;
  const H = 980;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // cork, a brass edge, pinned cards
  g.fillStyle = '#4a3322';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#8a6a34';
  g.lineWidth = 4;
  g.strokeRect(14, 14, W - 28, H - 28);
  g.textAlign = 'center';
  g.fillStyle = '#f7e2b0';
  g.font = '64px "Limelight", Georgia, serif';
  g.fillText("What's New", W / 2, 92);
  g.font = '600 24px "Cinzel", Georgia, serif';
  g.fillStyle = '#e0c68e';
  g.fillText('IN THE CASINO AND ACROSS THE STREET', W / 2, 132);
  const rows = NEWS.length;
  const top = 160;
  const rowH = (H - top - 60) / rows;
  NEWS.forEach((n, i) => {
    const y = top + i * rowH;
    // a card for each, a little askew
    g.save();
    g.translate(W / 2, y + rowH / 2);
    g.rotate(((i % 3) - 1) * 0.006);
    g.fillStyle = i === 0 ? '#fff4d6' : '#f3ead8';
    g.fillRect(-W / 2 + 40, -rowH / 2 + 4, W - 80, rowH - 8);
    g.fillStyle = '#b3261e';
    g.beginPath();
    g.arc(-W / 2 + 58, -rowH / 2 + 16, 6, 0, Math.PI * 2);
    g.fill();
    g.textAlign = 'left';
    g.fillStyle = '#23180f';
    g.font = '600 25px "Cinzel", Georgia, serif';
    g.fillText(n.title.toUpperCase(), -W / 2 + 76, -rowH / 2 + 30);
    g.textAlign = 'right';
    g.font = 'italic 18px Georgia, serif';
    g.fillStyle = '#6a5440';
    g.fillText(n.where, W / 2 - 54, -rowH / 2 + 29);
    g.textAlign = 'left';
    g.font = '21px Georgia, serif';
    g.fillStyle = '#3a2c20';
    g.fillText(n.short, -W / 2 + 76, -rowH / 2 + 56, W - 140);
    g.restore();
  });
  g.textAlign = 'center';
  g.fillStyle = '#f7e2b0';
  g.font = '600 20px "Cinzel", Georgia, serif';
  g.fillText('READ THE BOARD FOR MORE', W / 2, H - 30);
  return c;
}

export class Bulletin {
  private sheet: Sheet | null = null;
  readonly meshes: THREE.Mesh[] = [];
  private texture: THREE.Texture | null = null;

  constructor(
    private readonly plan: FloorPlan,
    private readonly ui: HTMLElement,
  ) {}

  /** The face on every notice board's stand. */
  build(parent: THREE.Object3D, anisotropy: number): void {
    const boards = this.plan.furniture.filter((f) => f.kind === 'bulletin');
    if (!boards.length) return;
    const tex = new THREE.CanvasTexture(drawBoard());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    this.texture = tex;
    for (const f of boards) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FACE.w, FACE.h), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(0.92) }));
      mesh.name = 'bulletin';
      const turn = new THREE.Matrix4().makeRotationY(f.yaw);
      mesh.position.set(f.x, FACE.y, f.z).add(new THREE.Vector3(0, 0, 0.052).applyMatrix4(turn));
      mesh.rotation.y = f.yaw;
      mesh.userData.room = f.room;
      parent.add(mesh);
      this.meshes.push(mesh);
    }
  }

  /** "Read the notice board" in front of one (Interact's spot provider). */
  spots = (p: { x: number; z: number }): Spot[] => {
    const out: Spot[] = [];
    const half = FURNITURE.bulletin.w / 2;
    for (const f of this.plan.furniture) {
      if (f.kind !== 'bulletin') continue;
      const nx = Math.sin(f.yaw);
      const nz = Math.cos(f.yaw);
      if ((p.x - f.x) * nx + (p.z - f.z) * nz < 0.1) continue;
      const along = Math.max(-half, Math.min(half, (p.x - f.x) * nz - (p.z - f.z) * nx));
      const x = f.x + along * nz;
      const z = f.z - along * nx;
      const d = Math.max(0, Math.hypot(p.x - x, p.z - z) - 0.5);
      if (d <= 1.4) out.push({ key: `bulletin:${f.n}`, x, z, d, label: 'Read the notice board', use: () => this.open() });
    }
    return out;
  };

  get isOpen(): boolean {
    return this.sheet !== null;
  }

  open(): void {
    if (this.sheet) return;
    const sheet = openSheet(this.ui, { title: "What's New", subtitle: 'In the casino and across the street', cls: 'news-sheet', onClose: () => (this.sheet = null) });
    this.sheet = sheet;
    const list = el('ol', 'news-list');
    for (const n of NEWS) {
      const li = el('li', 'news-item');
      const head = el('div', 'news-head');
      head.append(el('h3', 'news-title', n.title), el('span', 'news-where', n.where));
      li.append(head, el('p', 'news-body', n.long()));
      list.append(li);
    }
    sheet.body.append(list);
  }

  dispose(): void {
    this.sheet?.close();
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.removeFromParent();
    }
    this.texture?.dispose();
  }
}
