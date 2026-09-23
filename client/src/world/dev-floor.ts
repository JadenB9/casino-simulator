// Dev floor: walk the casino offline, no server needed.
//
//   /casino/?dev=floor                   (once main.ts routes it here)
//   /casino/src/world/dev-floor.html     (works on its own in `npm run dev`)
//
// Options: &quality=high|low, &view=entrance|overview|slots|pit|cashier|bar|poker|lounge|bigsix|table
// (a fixed camera for screenshots), &stats=1 (draw calls and frame time), &lineup=1 (every outfit
// side by side in debug colours, to check outfits.json), &slots=sevens,neon,... (the slot islands
// to lay out, instead of the catalogue's variants).

import * as THREE from 'three';
import { Engine3D, savedQuality, type Quality } from '../render/engine3d.ts';
import { el, toast } from '../ui/kit.ts';
import { DEFAULT_LOOK, OUTFITS, type Body, type Look } from '../../../shared/src/look.ts';
import { createWorld, type FloorWorld } from './index.ts';
import { checkLayout } from './layout.ts';

interface View {
  pos: [number, number, number];
  at: [number, number, number];
}

function views(w: FloorWorld): Record<string, View | 'walk'> {
  const p = w.plan;
  const pitZ = (p.staff.z0 + p.staff.z1) / 2;
  const cross = p.aisles[0]!;
  const wheel = p.stations.find((s) => s.game === 'bigsix') ?? { x: p.feature.x0 + 1, z: (p.feature.z0 + p.feature.z1) / 2 };
  return {
    entrance: 'walk',
    overview: { pos: [0.8, 1.95, p.entrance.z0 - 2.4], at: [0, 1.1, pitZ] },
    // from the south-east corner of the slot floor, across the islands toward the north-west
    slots: { pos: [p.slotsZone.x1 - 3.1, 2.5, p.slotsZone.z1 - 0.7], at: [p.slotsZone.x0 + 3, 0.8, p.slotsZone.z0 + 2] },
    pit: { pos: [5.6, 2.0, cross.z1 - 0.3], at: [-1.2, 0.9, pitZ] },
    cashier: { pos: [p.cashier.x + 4.6, 1.8, p.cashier.z + 1.1], at: [p.cashier.x - 0.4, 1.35, p.cashier.counter.z1] },
    bar: { pos: [p.bar.front - 4.6, 1.75, (p.bar.z0 + p.bar.z1) / 2 + 4.6], at: [p.bar.back, 1.3, (p.bar.z0 + p.bar.z1) / 2 - 1.6] },
    // from inside the room's south-west corner (the pit's corner column stands just outside it)
    poker: { pos: [p.pokerRoom.x0 + 0.5, 2.3, p.pokerRoom.z1 - 0.4], at: [p.pokerRoom.x1 - 1.5, 0.8, p.pokerRoom.z0 + 2.5] },
    lounge: { pos: [p.lounge.x0 - 1.2, 1.75, p.lounge.z0 - 1.0], at: [(p.lounge.x0 + p.lounge.x1) / 2, 0.7, (p.lounge.z0 + p.lounge.z1) / 2] },
    // in front of the wheel, where its players stand
    bigsix: { pos: [wheel.x + 5.2, 1.9, wheel.z + 1.4], at: [wheel.x, 1.5, wheel.z] },
  };
}

export async function runDevFloor(params: URLSearchParams): Promise<FloorWorld> {
  const q = params.get('quality');
  const quality: Quality = q === 'low' || q === 'high' ? q : savedQuality();
  const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, quality);
  const fill = document.getElementById('boot-fill');
  const world = await createWorld(engine, {
    quality,
    name: 'You',
    slotVariants: params.get('slots')?.split(',').filter(Boolean),
    onProgress: (k) => fill && (fill.style.width = `${Math.round(k * 100)}%`),
  });
  engine.onFrame((dt) => world.update(dt));
  document.getElementById('boot')?.classList.add('done');
  for (const problem of checkLayout(world.plan)) console.warn(`floor plan: ${problem}`);

  const ui = document.getElementById('ui')!;
  world.onEnter((s) => toast(`${s.name}: sitting down (no server on the dev floor). Esc to stand up.`));
  world.onCashier(() => toast('Cashier: the bank panel opens here in the game.'));

  const view = params.get('view');
  const v = view ? views(world)[view] : undefined;
  if (view === 'table') {
    const s = world.stations.find((x) => x.id === (params.get('station') ?? 'bj-1')) ?? world.stations[0]!;
    const a = s.anchor.position;
    world.teleport(a.x + Math.sin(s.yaw) * 1.6, a.z + Math.cos(s.yaw) * 1.6, s.yaw + Math.PI);
    world.enter(s);
  } else if (v && v !== 'walk') {
    // a fixed camera: the player stands aside and the camera is placed by hand
    world.player.setEnabled(false);
    world.player.character.root.visible = false;
    engine.onFrame(() => {
      engine.camera.position.set(...v.pos);
      engine.camera.lookAt(...v.at);
    });
  } else {
    ui.append(el('div', 'panel world-help', 'WASD or arrows to walk · Shift to run · click to look with the mouse, Esc to let go · or drag to look · E to sit'));
  }

  if (params.get('lineup')) lineup(world, engine);
  if (params.get('stats')) {
    const box = el('div', 'panel world-stats');
    ui.append(box);
    setInterval(() => {
      const s = world.stats();
      box.textContent = `${engine.frameMs().toFixed(1)} ms · ${s.calls} calls · ${Math.round(s.triangles / 1000)}k tris · ${s.programs} programs · pr ${s.pixelRatio}`;
    }, 500);
  }
  (window as unknown as { casino: unknown }).casino = { engine, world, THREE };
  return world;
}

/** Every outfit in a row: top red, bottom blue, shoes green, hair yellow (then natural colours). */
function lineup(world: FloorWorld, engine: Engine3D): void {
  const f = world.characterFactory;
  const all: { body: Body; outfit: string }[] = [];
  for (const body of ['m', 'f'] as Body[]) for (const outfit of OUTFITS[body]) all.push({ body, outfit });
  const z0 = world.plan.entrance.z0 - 5;
  all.forEach((o, i) => {
    const debug: Look = { v: 1, body: o.body, outfit: o.outfit, skin: 1, hair: '#f2d021', top: '#d11f1f', bottom: '#1f4fd1', shoes: '#1fae3b' };
    const plain: Look = { ...DEFAULT_LOOK, body: o.body, outfit: o.outfit, skin: (i * 3) % 8, top: '#6b2230', bottom: '#20232b', hair: '#3a2415' };
    const a = f.create(debug, `${o.body}/${o.outfit}`);
    a.root.position.set(-4.9 + i * 1.4, 0, z0);
    a.root.rotation.y = 0;
    const b = f.create(plain, '');
    b.root.position.set(-4.9 + i * 1.4, 0, z0 - 2.2);
    engine.scene.add(a.root, b.root);
    engine.onFrame((dt) => {
      a.update(dt);
      b.update(dt);
    });
  });
  world.player.setEnabled(false);
  world.player.character.root.visible = false;
  engine.onFrame(() => {
    engine.camera.position.set(0.0, 1.55, z0 + 4.4);
    engine.camera.lookAt(0.0, 0.95, z0 - 1.1);
  });
}
