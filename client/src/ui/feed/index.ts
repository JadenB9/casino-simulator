// Floor life: what makes the floor feel busy beyond the people walking it. The LED sign over the
// pit with the recent big wins and the day's meter over the slots (both in world/), a toast when
// someone wins big, attract mode on the idle slot machines, and the room's own sound.
//
//   const life = mountFloorLife({ engine, world, sfx });      // once the world is built
//   const stop = life.connect(link, { onFloor });             // once there is a floor socket
//
// News of a win waits until its `at` (server time): the moment the winner sees the ball land or
// the reels stop. Then the sign tells the story, the meter counts up, a bell rings from where it
// happened, a slot machine that paid it lights up, and whoever is walking the floor gets a toast
// (unless they turned toasts off). The winner gets the sign and the meter; their own table does
// the rest.

import * as THREE from 'three';
import type { Engine3D } from '../../render/engine3d.ts';
import type { FloorWorld } from '../../world/index.ts';
import type { Sfx } from '../../audio/sfx.ts';
import type { BigWin, FloorServerMsg, WinsToday } from '../../../../shared/src/protocol.ts';
import { serverNow } from '../../net/clock.ts';
import { Marquee, type SignEntry } from '../../world/marquee.ts';
import { Tally } from '../../world/tally.ts';
import { Attract } from '../../world/attract.ts';
import { Ambience, type AmbienceSpots } from '../../audio/ambience.ts';
import { WinToasts } from './toast.ts';
import { bigWinToasts } from './prefs.ts';
import { detail, wholeDollars } from './lines.ts';

/** What floor life needs from the floor socket; FloorLink has all of it. */
export interface FloorFeed {
  subscribe(fn: (msg: FloorServerMsg) => void): () => void;
  readonly you: { name: string } | null;
  readonly players: ReadonlyMap<number, { info: { at: { station: string } | null } }>;
}

export interface FloorLifeDeps {
  engine: Engine3D;
  world: FloorWorld;
  sfx: Sfx;
  /** Where toasts go (default #ui). */
  ui?: HTMLElement;
}

export interface FloorLife {
  /**
   * Hear a floor socket. `onFloor` says whether the player is out walking (toasts only then; the
   * default is "not at a table"). Returns a function that stops listening.
   */
  connect(link: FloorFeed, opts?: { onFloor?: () => boolean }): () => void;
  dispose(): void;
  readonly marquee: Marquee;
  readonly tally: Tally;
  readonly attract: Attract;
  readonly ambience: Ambience;
}

/** How many revealed wins the sign keeps (the floor sends at most this many). */
const LIST_MAX = 20;
/** Busy machines are re-read from the roster this often (seconds). */
const BUSY_EVERY = 0.5;

export function mountFloorLife(deps: FloorLifeDeps): FloorLife {
  const { engine, world, sfx } = deps;
  const group = new THREE.Group();
  group.name = 'floor-life';
  const marquee = new Marquee(world.plan, world.quality);
  const tally = new Tally(world.plan, world.quality);
  group.add(marquee.mesh, tally.mesh);
  engine.scene.add(group);
  const attract = new Attract(world.stations);
  const ambience = new Ambience(sfx, spotsOf(world));
  const toasts = new WinToasts(deps.ui ?? document.getElementById('ui') ?? document.body);
  // the machines' shaders just changed: compile them now rather than on the first frame they show
  void engine.renderer.compileAsync(engine.scene, engine.camera).catch(() => {});

  let quality = world.quality;
  let busyIn = 0;
  let link: FloorFeed | null = null;
  const offFrame = engine.onFrame((dt) => {
    marquee.update(dt);
    tally.update(dt);
    attract.update(dt);
    ambience.update(dt, engine.camera, world.seated !== null);
    if (world.quality !== quality) {
      quality = world.quality;
      marquee.setQuality(quality);
      tally.setQuality(quality);
    }
    busyIn -= dt;
    if (busyIn <= 0) {
      busyIn = BUSY_EVERY;
      const ids: string[] = [];
      if (world.seated) ids.push(world.seated.id);
      if (link) for (const p of link.players.values()) if (p.info.at?.station) ids.push(p.info.at.station);
      attract.setBusy(ids);
    }
  });

  // --- the news ---------------------------------------------------------------------------------

  let list: BigWin[] = [];
  let day = '';
  const waiting = new Map<string, number>();
  const told = new Set<string>();
  let onFloor: () => boolean = () => world.seated === null;

  const showList = () => marquee.setEntries(list.map(entry));

  const setToday = (t: WinsToday, countUp: boolean) => {
    // a new day starts the meter again; within a day it only ever climbs
    const fresh = t.day !== day;
    day = t.day;
    tally.set(t.total, t.count, countUp && !fresh);
  };

  const reveal = (w: BigWin, today: WinsToday) => {
    list = [w, ...list.filter((x) => key(x) !== key(w))].slice(0, LIST_MAX);
    marquee.announce(entry(w));
    showList();
    setToday(today, true);
    const you = link?.you?.name.toLowerCase();
    if (you && w.name.toLowerCase() === you) return;
    const station = w.station ? world.stations.find((s) => s.id === w.station) : undefined;
    const at = station ? station.anchor.getWorldPosition(new THREE.Vector3()) : null;
    ambience.bell(at ? { x: at.x, z: at.z } : null);
    if (station && world.seated?.id !== station.id) attract.celebrate(station.id);
    if (onFloor() && bigWinToasts()) toasts.show(w);
  };

  const schedule = (w: BigWin, today: WinsToday) => {
    const k = key(w);
    if (waiting.has(k) || told.has(k)) return;
    const wait = Math.max(0, w.at - serverNow());
    waiting.set(
      k,
      window.setTimeout(() => {
        waiting.delete(k);
        told.add(k);
        if (told.size > 60) told.delete(told.values().next().value!);
        reveal(w, today);
      }, wait),
    );
  };

  const hear = (m: FloorServerMsg) => {
    if (m.t === 'bigwins') {
      // (re)connected: the recent list, less anything its winner hasn't seen yet
      const now = serverNow();
      const later = m.list.filter((w) => w.at > now && !told.has(key(w)));
      list = m.list.filter((w) => !later.includes(w)).slice(0, LIST_MAX);
      for (const w of list) told.add(key(w));
      showList();
      const held = later.reduce((s, w) => s + w.amount, 0);
      setToday({ ...m.today, total: Math.max(0, m.today.total - held), count: Math.max(0, m.today.count - later.length) }, false);
      // oldest first, so the sign tells them in order
      for (const w of [...later].reverse()) schedule(w, m.today);
    } else if (m.t === 'bigwin') {
      const { t: _t, today, ...w } = m;
      schedule(w, today);
    }
  };

  let unsubscribe: (() => void) | null = null;

  return {
    marquee,
    tally,
    attract,
    ambience,
    connect(l, opts = {}) {
      unsubscribe?.();
      link = l;
      if (opts.onFloor) onFloor = opts.onFloor;
      unsubscribe = l.subscribe(hear);
      return () => {
        unsubscribe?.();
        unsubscribe = null;
        if (link === l) link = null;
        for (const t of waiting.values()) clearTimeout(t);
        waiting.clear();
      };
    },
    dispose() {
      unsubscribe?.();
      for (const t of waiting.values()) clearTimeout(t);
      waiting.clear();
      offFrame();
      toasts.dispose();
      ambience.dispose();
      attract.dispose();
      marquee.dispose();
      tally.dispose();
      group.removeFromParent();
    },
  };
}

function key(w: BigWin): string {
  return `${w.name}|${w.at}|${w.amount}`;
}

function entry(w: BigWin): SignEntry {
  return { name: w.name, money: wholeDollars(w.amount), detail: detail(w) };
}

/** Where the room's sounds come from, from the floor plan. */
function spotsOf(world: FloorWorld): AmbienceSpots {
  const p = world.plan;
  const mid = (r: { x0: number; x1: number; z0: number; z1: number }) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
  return {
    crowd: [
      { ...mid(p.pit), size: 3 },
      { ...mid(p.pokerRoom), size: 1.2 },
      { x: p.bar.front - 1.4, z: (p.bar.z0 + p.bar.z1) / 2, size: 1.6 },
      { ...mid(p.lounge), size: 0.7 },
      { ...mid(p.slotsZone), size: 1.2 },
    ],
    slots: p.banks.map((b) => ({ x: b.x, z: b.z })),
    tables: world.stations.filter((s) => s.zone === 'pit' || s.zone === 'poker' || s.zone === 'feature').map((s) => ({ x: s.anchor.position.x, z: s.anchor.position.z })),
  };
}
