// Dev page for the boutique, the bar and the wearables, served by Vite in development only:
//   /casino/src/ui/shop/dev.html?screen=<wear|boutique|bar>
// wear: your character in the showroom wearing what the URL says, for looking at the pieces up
// close: body=m|f, outfit=suit, chain=, grill=, clothes=, watch=, shades=, hat=, held=<bar item>,
// view=full|chest|face|head|wrist|hand, yaw=<radians> (holds the turn still).
// window.dev.wear(look, view, yaw) changes it from a script.

import '../menu/dev.css';
import * as THREE from 'three';
import { Engine3D } from '../../render/engine3d.ts';
import { Characters } from '../../world/characters.ts';
import { DEFAULT_LOOK, type Look } from '../../../../shared/src/look.ts';
import { ITEM_KINDS } from '../../../../shared/src/items.ts';
import { el } from '../kit.ts';
import { Showroom, type Framing } from './showroom.ts';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') ?? 'wear';
const ui = document.getElementById('ui')!;
const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, 'high');

function shadow(): THREE.Material {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(0,0,0,0.6)');
  r.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
}

const characters = new Characters('high', shadow());

function lookFromQuery(): Look {
  const look: Look = { ...DEFAULT_LOOK, body: q.get('body') === 'f' ? 'f' : 'm' };
  look.outfit = q.get('outfit') ?? (look.body === 'f' ? 'smart' : 'suit');
  if (look.body === 'f') {
    look.hair = '#3a2415';
    look.top = '#1d2233';
    look.bottom = '#1d2233';
  }
  for (const k of ITEM_KINDS) {
    const v = q.get(k);
    if (v) look[k] = v;
  }
  const held = q.get('held');
  if (held) look.held = { item: held, order: 'dev-order-0001', until: Date.now() + 3_600_000 };
  return look;
}

async function start(): Promise<void> {
  if (screen === 'wear') {
    const look = lookFromQuery();
    await characters.load(look).catch(() => {});
    const room = new Showroom({ engine, characters, look, name: '', area: () => ({ x0: 0, y0: 0, x1: innerWidth, y1: innerHeight }) });
    room.show((q.get('view') as Framing) ?? 'full');
    if (q.has('yaw')) room.still(Number(q.get('yaw')));
    (window as unknown as { dev: unknown }).dev = {
      engine,
      room,
      characters,
      wear(next: Look, view: Framing, yaw: number | null = null) {
        room.setLook(next);
        room.show(view);
        room.still(yaw);
      },
    };
    document.body.dataset.ready = '1';
  }
}

start().catch((err) => {
  console.error(err);
  ui.append(el('p', 'dev-error', String(err?.message ?? err)));
});
