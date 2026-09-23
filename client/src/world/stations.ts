// Stations: every table and machine on the floor. Each gets an anchor placed from the floor plan
// with its game module's model as a child, a collision box from the module's footprint, and the
// words for its "Press E" prompt (name and table limits from the engine's own config).

import * as THREE from 'three';
import type { GameId } from '../../../shared/src/engine.ts';
import { CATALOG } from '../../../shared/src/games/catalog.ts';
import { ENGINES } from '../../../shared/src/games/index.ts';
import { formatMoney } from '../../../shared/src/money.ts';
import { GAMES } from '../games/index.ts';
import type { Quality } from '../render/engine3d.ts';
import type { Station } from './contract.ts';
import type { Collider } from './collision.ts';
import type { Footprint, FloorPlan, Placement, Zone } from './layout.ts';

export interface WorldStation extends Station {
  footprint: Footprint;
  zone: Zone;
  /** What the prompt calls it ("Blackjack", "American Roulette", "Neon Nights"). */
  name: string;
  /** "$5–$5,000", from the engine's solo table limits. */
  limits: string;
  /** The game module's model (a child of the anchor). */
  model: THREE.Object3D;
  yaw: number;
}

/** Bar-top units sit on the counter; anything taller stands on the floor in a gap in the bar. */
export type VpMode = 'bartop' | 'floor';

export const BAR_TOP = 1.08;

export function stationName(game: GameId, variant: string): string {
  const info = CATALOG[game];
  const v = info.variants.find((x) => x.id === variant);
  if (!v) return info.name;
  return game === 'slots' ? v.name : `${v.name} ${info.name}`;
}

export function limitsText(game: GameId, variant: string): string {
  try {
    const l = ENGINES[game].config(variant, 'solo').limits.default;
    return `${formatMoney(l.min)}–${formatMoney(l.max)}`;
  } catch {
    return '';
  }
}

export function buildStations(plan: FloorPlan, parent: THREE.Object3D, quality: Quality, col: Collider): { stations: WorldStation[]; vpMode: VpMode } {
  const stations: WorldStation[] = [];
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  let vpMode: VpMode = 'floor';
  const make = (p: Placement): WorldStation => {
    const anchor = new THREE.Group();
    anchor.name = `station:${p.id}`;
    anchor.position.set(p.x, 0, p.z);
    anchor.rotation.y = p.yaw;
    const model = GAMES[p.game].createModel({ variant: p.variant, quality });
    anchor.add(model);
    parent.add(anchor);
    return {
      id: p.id,
      game: p.game,
      variant: p.variant,
      anchor,
      footprint: p.fp,
      zone: p.zone,
      name: stationName(p.game, p.variant),
      limits: limitsText(p.game, p.variant),
      model,
      yaw: p.yaw,
    };
  };
  for (const p of plan.stations) {
    const s = make(p);
    if (p.game === 'videopoker' && stations.every((x) => x.game !== 'videopoker')) {
      box.setFromObject(s.model).getSize(size);
      vpMode = size.y > 0.02 && size.y < 0.9 ? 'bartop' : 'floor';
    }
    stations.push(s);
  }
  for (const s of stations) {
    if (s.game === 'videopoker' && vpMode === 'bartop') {
      // lift onto the counter, player edge flush with the bar's front
      s.anchor.position.y = BAR_TOP;
      s.anchor.position.x = plan.bar.front + s.footprint.depth / 2 + 0.06;
      continue;
    }
    // tables and cabinets block walking; the camera sees over anything lower than 1.3 m
    box.setFromObject(s.model).getSize(size);
    const top = Math.max(0.8, size.y);
    col.box(s.anchor.position.x, s.anchor.position.z, s.footprint.width, s.footprint.depth, s.yaw, top, { cam: top > 1.3 });
  }
  return { stations, vpMode };
}

/** The camera pose for playing at a station, in world space (same maths as TableStage.worldPose). */
export function playPoseWorld(s: Station, seat: number | null): { position: THREE.Vector3; target: THREE.Vector3 } {
  const p = GAMES[s.game].playPose(s.variant, seat);
  s.anchor.updateWorldMatrix(true, false);
  return {
    position: s.anchor.localToWorld(new THREE.Vector3(...p.position)),
    target: s.anchor.localToWorld(new THREE.Vector3(...p.target)),
  };
}
