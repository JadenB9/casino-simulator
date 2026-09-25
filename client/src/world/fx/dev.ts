// The effects on the dev floor, with no server: `casino.fx.play('fx-disco')` plays one round you
// (or round a stranger, or at a point), `casino.fx.statues(3)` puts sample statues in the lobby,
// `casino.fx.stranger(x, z)` stands a second player on the floor for effects to follow. The URL
// can ask too: &fx=fx-confetti,fx-spotlight plays those as the floor opens, &statues=3 casts three.

import * as THREE from 'three';
import { EFFECTS, effectItem, type FxEvent, type Statue } from '../../../../shared/src/items.ts';
import { DEFAULT_LOOK, type Look } from '../../../../shared/src/look.ts';
import type { Engine3D } from '../../render/engine3d.ts';
import { serverNow } from '../../net/clock.ts';
import { Marquee, marqueePlacement } from '../marquee.ts';
import { Tally } from '../tally.ts';
import type { FloorWorld } from '../index.ts';
import type { Person } from '../characters.ts';

/** Your id on the dev floor, and the stranger's. */
const ME = 1;
const STRANGER = 2;

const SAMPLES: { name: string; look: Look }[] = [
  { name: 'Ana Castellanos', look: { ...DEFAULT_LOOK, body: 'f', outfit: 'dress', skin: 2, hair: '#3a2415', top: '#1d4a44', bottom: '#1d4a44' } },
  { name: 'Big Mike', look: { ...DEFAULT_LOOK, body: 'm', outfit: 'suit', skin: 4, hair: '#1a1410', top: '#1f2430', bottom: '#1f2430' } },
  { name: 'Lucky Sam', look: { ...DEFAULT_LOOK, body: 'm', outfit: 'casual', skin: 1, hair: '#2b1d14', top: '#6b2230', bottom: '#2a3140' } },
];

export interface FxDev {
  play(fx: string, o?: { x?: number; z?: number; who?: 'me' | 'stranger'; name?: string; delay?: number; secs?: number }): FxEvent;
  statues(n?: number): Promise<void>;
  stranger(x: number, z: number): Person;
  marquee: Marquee;
  /** Where the pit's sign hangs, and the slots hall's meter. */
  sign: { x: number; z: number };
  tally: Tally;
}

export function fxDev(world: FloorWorld, engine: Engine3D, params: URLSearchParams): FxDev {
  // a sign of our own for the Headline (in the game the floor's life hangs the real one)
  const marquee = new Marquee(world.plan, world.quality);
  engine.scene.add(marquee.mesh);
  engine.onFrame((dt) => marquee.update(dt));
  // and the slots hall's win meter, for Own the Night
  const tally = new Tally(world.plan, world.quality);
  tally.set(1_234_500_00, 18, false);
  engine.scene.add(tally.mesh);
  world.useFx({ self: () => ME, marquee, tally });
  let stranger: Person | null = null;
  world.useRemotes({ character: (id) => (id === STRANGER && stranger ? stranger : undefined) });
  engine.onFrame((dt) => stranger?.update(dt));

  const dev: FxDev = {
    marquee,
    sign: marqueePlacement(world.plan),
    tally,
    play(fx, o = {}) {
      const item = effectItem(fx) ?? EFFECTS[0]!;
      const who = o.who === 'stranger' && stranger ? stranger.root.position : null;
      const p = who ?? new THREE.Vector3(o.x ?? world.player.position.x, 0, o.z ?? world.player.position.z);
      const at = Math.round(serverNow() + (o.delay ?? 0) * 1000);
      const ev: FxEvent = {
        fx: item.id,
        id: o.who === 'stranger' ? STRANGER : ME,
        name: o.name ?? (o.who === 'stranger' ? 'Lucky Sam' : 'You'),
        at,
        until: at + (o.secs ?? item.secs) * 1000,
        x: Math.round((o.x ?? p.x) * 100),
        z: Math.round((o.z ?? p.z) * 100),
      };
      world.playFx(ev);
      return ev;
    },
    statues(n = 3) {
      const now = Date.now();
      const list: Statue[] = SAMPLES.slice(0, n).map((s, i) => ({ name: s.name, look: s.look, at: now - i * 86_400_000 * 9 }));
      return world.setStatues(list);
    },
    stranger(x, z) {
      stranger ??= world.characterFactory.create(SAMPLES[2]!.look, 'Lucky Sam');
      stranger.root.position.set(x, 0, z);
      engine.scene.add(stranger.root);
      return stranger;
    },
  };
  for (const fx of params.get('fx')?.split(',').filter(Boolean) ?? []) dev.play(fx);
  const n = Number(params.get('statues') ?? 0);
  if (n > 0) void dev.statues(n);
  return dev;
}
