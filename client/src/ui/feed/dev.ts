// Dev page for floor life, served by Vite in development only:
//   /casino/src/ui/feed/dev.html?view=<front|marquee|north|tally|tallyback|slots|island|table>
// The real floor (world/dev-floor.ts, so &quality, &stats and &slots work too) with the big-win
// sign, the day's meter, attract mode and the room's sound mounted on it, fed by a stand-in for
// the floor socket. Options: &wins=0 (no history: the sign's idle loop), &win=<seconds> (a new win
// that many seconds after load), &busy=<station,...> (players sitting there), &station=<id> (with
// view=table: sit there). Keys: B a big win somewhere, N three at once, T toasts on the floor.

import * as THREE from 'three';
import { runDevFloor } from '../../world/dev-floor.ts';
import { Sfx } from '../../audio/sfx.ts';
import type { Engine3D } from '../../render/engine3d.ts';
import type { BigWin, FloorServerMsg, WinsToday } from '../../../../shared/src/protocol.ts';
import { marqueePlacement } from '../../world/marquee.ts';
import { tallyPlacement } from '../../world/tally.ts';
import { mountFloorLife, type FloorFeed } from './index.ts';

class FakeFeed implements FloorFeed {
  you = { name: 'You' };
  players = new Map<number, { info: { at: { station: string } | null } }>();
  private subs = new Set<(m: FloorServerMsg) => void>();
  subscribe(fn: (m: FloorServerMsg) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  emit(m: FloorServerMsg): void {
    for (const f of this.subs) f(m);
  }
}

const SAMPLE: Omit<BigWin, 'at'>[] = [
  { name: 'rhett22', game: 'slots', amount: 1_248_000, what: 'Gold Rush, free games 312x', station: 'slots-goldrush-2' },
  { name: 'mara_v', game: 'roulette', amount: 350_000, what: 'Straight 17', station: 'rl-us' },
  { name: 'o_nakamura', game: 'videopoker', amount: 399_500, what: 'Royal Flush', station: 'vp-2' },
  { name: 'cj_ross', game: 'blackjack', amount: 750_000, what: 'Blackjack', station: 'bj-1' },
  { name: 'pia', game: 'sicbo', amount: 1_800_000, what: 'Triple 5-5-5', station: 'sb-1' },
  { name: 'dmitri_k', game: 'craps', amount: 300_000, what: 'Boxcars', station: 'cr-1' },
  { name: 'hollis', game: 'bigsix', amount: 400_000, what: 'Star, 40 to 1', station: 'b6-1' },
  { name: 'bellweather', game: 'holdem', amount: 612_000, what: 'Full house', station: 'he-1' },
  { name: 'tamsin', game: 'slots', amount: 86_000, what: 'Neon Nights, 172x', station: 'slots-neon-3' },
];

const params = new URLSearchParams(location.search);
const view = params.get('view');
params.delete('view');
if (view === 'table') params.set('view', 'table');

const world = await runDevFloor(params);
const casino = (window as unknown as { casino: { engine: Engine3D } & Record<string, unknown> }).casino;
const engine = casino.engine;
const sfx = new Sfx();
await sfx.load().catch(() => {});
const life = mountFloorLife({ engine, world, sfx });
const feed = new FakeFeed();
let toastsOnFloor = true;
life.connect(feed, { onFloor: () => toastsOnFloor && world.seated === null });
for (const [i, id] of (params.get('busy') ?? '').split(',').filter(Boolean).entries()) feed.players.set(i + 1, { info: { at: { station: id } } });

const now = Date.now();
const history = params.get('wins') === '0' ? [] : SAMPLE.slice(0, 8).map((w, i) => ({ ...w, at: now - (i + 1) * 95_000 }));
let today: WinsToday = { day: '2026-09-23', total: history.reduce((s, w) => s + w.amount, 0) + 2_141_300, count: history.length + 14 };
feed.emit({ t: 'bigwins', list: history, today });

let n = 0;
function win(delay = 0.2): void {
  const base = SAMPLE[n++ % SAMPLE.length]!;
  today = { ...today, total: today.total + base.amount, count: today.count + 1 };
  feed.emit({ t: 'bigwin', ...base, at: Date.now() + delay * 1000, today });
}
const at = Number(params.get('win'));
if (Number.isFinite(at) && params.has('win')) setTimeout(() => win(0), at * 1000);
addEventListener('keydown', (e) => {
  if (e.key === 'b') win();
  if (e.key === 'n') for (let i = 0; i < 3; i++) win(0.1 * i);
  if (e.key === 't') toastsOnFloor = !toastsOnFloor;
});

// fixed cameras on the new signs and the slot floor
const plan = world.plan;
const m = marqueePlacement(plan);
const t = tallyPlacement(plan);
const views: Record<string, { pos: [number, number, number]; at: [number, number, number] }> = {
  // from inside the doors: the pit's sign and the meter together
  front: { pos: [0.6, 1.75, plan.entrance.z0 - 1.6], at: [-1.6, 2.6, m.z] },
  // a player at the south row looking up past the dealers
  marquee: { pos: [m.x + 1.6, 1.7, plan.staff.z1 + 3.6], at: [m.x, 3.3, m.z] },
  north: { pos: [m.x - 1.2, 1.7, plan.staff.z0 - 3.4], at: [m.x, 3.3, m.z] },
  // the meter faces east (toward the pit's arch) and west (down the slots hall)
  tally: { pos: [t.x + 6.2, 1.7, t.z + 1.2], at: [t.x, 2.85, t.z] },
  tallyback: { pos: [t.x - 5.0, 1.7, t.z - 1.4], at: [t.x, 2.85, t.z] },
  slots: { pos: [plan.slotsZone.x1 - 3.1, 2.5, plan.slotsZone.z1 - 0.7], at: [plan.slotsZone.x0 + 3, 0.8, plan.slotsZone.z0 + 2] },
  island: { pos: [plan.banks[0]!.x + 2.6, 1.6, plan.banks[0]!.z + 3.2], at: [plan.banks[0]!.x, 1.4, plan.banks[0]!.z] },
};
const v = view ? views[view] : undefined;
if (v) {
  world.player.setEnabled(false);
  world.player.character.root.visible = false;
  engine.onFrame(() => {
    engine.camera.position.set(...v.pos);
    engine.camera.lookAt(...v.at);
  });
}
Object.assign(casino, { life, feed, win, THREE, marqueeAt: m, tallyAt: t });
