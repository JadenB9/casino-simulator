// The map out of the casino (the HUD's map button or N, on the ground floor or the roof): the
// zone's plan in its own metres, north up, what each part is when you click it, and you on it.
// The casino's map (wayfinding.ts) shows this instead while you're out here.

import { STORES } from '../../../../shared/src/stores.ts';
import { el } from '../../ui/kit.ts';
import type { ZoneId } from '../../../../shared/src/zones.ts';
import { LIFTS } from '../../../../shared/src/lifts.ts';
import { GROUND, ROOF, SURFACE, VALET_STAND, type Area } from './plan.ts';

const NS = 'http://www.w3.org/2000/svg';

interface Part {
  id: string;
  name: string;
  about: string;
  area: Area;
  tint: string;
  /** Drawn but not named or clickable (a sidewalk, a lane). */
  plain?: boolean;
}

export interface ZoneMapView {
  title: string;
  body: HTMLElement;
  you: SVGGElement;
  /** What to call where (x, z) is ("the Valet Lobby"), or ''. */
  here(x: number, z: number): string;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, cls?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (cls) e.setAttribute('class', cls);
  return e;
}

function groundParts(): Part[] {
  const G = GROUND;
  const band = (x0: number, x1: number): Area => ({ x0, x1, z0: G.zone.z0, z1: G.zone.z1 });
  return [
    // v7: the loop road round the jail's and the garage's block (loop.ts)
    { id: 'street', name: 'The Street', about: 'Four lanes, crosswalks to the stores and the jail', area: { x0: G.walkWest.x0, x1: G.walkEast.x1, z0: -78.5, z1: 78.5 }, tint: '#2a2a30' },
    { id: 'road-n', name: 'Loop Road', about: 'Round the block: drive it, mind the traffic', area: { x0: G.walkWest.x0, x1: 216.5, z0: 62.5, z1: 78.5 }, tint: '#2a2a30' },
    { id: 'road-s', name: 'Loop Road', about: 'Round the block: drive it, mind the traffic', area: { x0: G.walkWest.x0, x1: 216.5, z0: -78.5, z1: -62.5 }, tint: '#2a2a30' },
    { id: 'road-e', name: 'Loop Road', about: 'Round the block: drive it, mind the traffic', area: { x0: 200.5, x1: 216.5, z0: -78.5, z1: 78.5 }, tint: '#2a2a30' },
    { id: 'guns', name: 'Ace Arms', about: 'Guns and a shooting range', area: STORES.guns.room, tint: '#5a2222' },
    { id: 'homes', name: 'Maison Home', about: 'Furniture for your apartment', area: STORES.homes.room, tint: '#2e5a44' },
    { id: 'hall', name: 'Valet Lobby', about: 'The elevators, the concierge, the doors to the drive', area: G.building, tint: '#6d6456' },
    { id: 'drive', name: 'Porte-Cochere', about: 'The valet stand, where cars pull up', area: { x0: G.curb.x0, x1: G.drive.x1, z0: G.canopy.z0, z1: G.canopy.z1 }, tint: '#7a6230' },
    { id: 'plaza', name: 'The Plaza', about: 'Palms, the name in stone, the walk to the crosswalk', area: G.plaza, tint: '#4a4a3a' },
    { id: 'stacks-n', name: 'Valet Parking', about: 'The valet’s stacked rows', area: { x0: 137.8, x1: 150, z0: -40, z1: -9.6 }, tint: '#34343c' },
    { id: 'stacks-s', name: 'Valet Parking', about: 'The valet’s stacked rows', area: { x0: 137.8, x1: 150, z0: 9.6, z1: 40 }, tint: '#34343c' },
    { id: 'lot-n', name: 'North Lot', about: 'Surface parking, four rows', area: { x0: SURFACE.x0, x1: SURFACE.x1, z0: -SURFACE.z1, z1: -SURFACE.z0 }, tint: '#34343c' },
    { id: 'lot-s', name: 'South Lot', about: 'Surface parking, four rows', area: { x0: SURFACE.x0, x1: SURFACE.x1, z0: SURFACE.z0, z1: SURFACE.z1 }, tint: '#34343c' },
    { id: 'jail', name: 'Jail', about: 'Visit the day room, or bail someone out', area: G.jail, tint: '#4a3a3a' },
    { id: 'garage', name: 'Garage', about: 'Your cars on show; buy one at the lounge desk', area: G.garage, tint: '#22386a' },
  ];
}

function roofParts(): Part[] {
  const D = ROOF.deck;
  return [
    { id: 'deck', name: 'Sky Terrace', about: 'Loungers on the rail, sofas round the fires, the sunset', area: D, tint: '#6a4424' },
    { id: 'pavilion', name: 'Elevators', about: 'Down to the casino and the street', area: { x0: ROOF.canopy.x0, x1: ROOF.pavilion.x1, z0: ROOF.canopy.z0, z1: ROOF.canopy.z1 }, tint: '#6d6456' },
    { id: 'bar', name: 'The Bar', about: 'A counter on the north rail', area: { x0: -127.8, x1: -119, z0: D.z0, z1: D.z0 + 4.1 }, tint: '#1d5856' },
  ];
}

/** v7.1: an apartment's rooms. */
function homeParts(): Part[] {
  return [
    { id: 'living', name: 'Living Room', about: 'Sofa, television, piano, the city', area: { x0: -146, x1: -130, z0: 74, z1: 84 }, tint: '#5a4a38' },
    { id: 'games', name: 'Games Corner', about: 'Pool table, arcade, the gun wall', area: { x0: -154, x1: -146, z0: 74, z1: 84 }, tint: '#3a4a3a' },
    { id: 'dining', name: 'Kitchen & Dining', about: 'The kitchen along the glass, the table under the chandelier', area: { x0: -143, x1: -130, z0: 58, z1: 74 }, tint: '#4a4238' },
    { id: 'bedroom', name: 'Bedroom', about: 'The bed and the safe', area: { x0: -154, x1: -143, z0: 58, z1: 65.8 }, tint: '#3a3448' },
    { id: 'hall', name: 'Elevator', about: 'Back down to the casino and the street', area: { x0: -154, x1: -150, z0: 66, z1: 74 }, tint: '#6d6456' },
    { id: 'terrace', name: 'Terrace', about: 'The pool and the hot tub (the Penthouse step)', area: { x0: -130, x1: -121.4, z0: 60, z1: 82 }, tint: '#2a4a5a' },
  ];
}

/** The map of a zone out of the casino. */
export function zoneMap(zone: Exclude<ZoneId, 'casino'>): ZoneMapView {
  const parts = zone === 'ground' ? groundParts() : zone === 'home' ? homeParts() : roofParts();
  const view = zone === 'ground' ? { x0: GROUND.zone.x0, x1: 218, z0: -80, z1: 80 } : zone === 'home' ? { x0: -156, x1: -120, z0: 56, z1: 86 } : { x0: ROOF.deck.x0 - 2, x1: ROOF.pavilion.x1 + 1, z0: ROOF.deck.z0 - 2, z1: ROOF.deck.z1 + 2 };
  const svg = svgEl('svg', { viewBox: `${view.x0} ${view.z0} ${view.x1 - view.x0} ${view.z1 - view.z0}`, role: 'img', 'aria-label': `${zone === 'ground' ? 'The ground floor' : 'The roof'}, north at the top` }, 'map-svg city-map');
  const size = zone === 'ground' ? 2.6 : 1.1;
  const rects = new Map<string, SVGRectElement>();
  const caption = el('div', 'map-caption');
  const pick = (id: string) => {
    const p = parts.find((q) => q.id === id);
    for (const [pid, r] of rects) r.classList.toggle('on', parts.find((q) => q.id === pid)?.name === p?.name);
    caption.replaceChildren();
    if (!p) {
      caption.append(el('p', 'map-hint', 'Click a place to see what’s there.'));
      return;
    }
    caption.append(el('h3', 'map-name', p.name), el('p', 'map-about', p.about));
  };
  const areas = svgEl('g');
  for (const p of parts) {
    const a = p.area;
    const r = svgEl('rect', { x: a.x0, y: a.z0, width: a.x1 - a.x0, height: a.z1 - a.z0, fill: p.tint }, 'map-room');
    r.addEventListener('click', () => pick(p.id));
    areas.append(r);
    rects.set(p.id, r);
  }
  const marks = svgEl('g', {}, 'map-walls');
  if (zone === 'ground') {
    // the road's middle and the crosswalk
    const G = GROUND;
    const mid = (G.road.x0 + G.road.x1) / 2;
    marks.append(svgEl('line', { x1: mid, y1: G.zone.z0, x2: mid, y2: G.crosswalk.z0 - 2 }), svgEl('line', { x1: mid, y1: G.crosswalk.z1 + 2, x2: mid, y2: G.zone.z1 }));
    for (let x = G.road.x0 + 0.6; x < G.road.x1; x += 1.6) marks.append(svgEl('line', { x1: x, y1: G.crosswalk.z0, x2: x, y2: G.crosswalk.z1 }, 'city-map-zebra'));
    marks.append(svgEl('rect', { x: VALET_STAND.x - 0.6, y: VALET_STAND.z - 0.8, width: 1.2, height: 1.6 }, 'city-map-mark'));
  }
  const lift = LIFTS[zone];
  const lx = lift.x / 100;
  const lz = lift.z / 100;
  const half = (lift.cars * 1.9) / 2 + 0.4;
  marks.append(svgEl('rect', { x: lift.r === 64 ? lx - 2 : lx, y: lz - half, width: 2, height: half * 2 }, 'city-map-lift'));
  const labels = svgEl('g', {}, 'map-labels');
  const named = new Set<string>();
  for (const p of parts) {
    if (p.plain || named.has(p.id)) continue;
    named.add(p.id);
    const a = p.area;
    const w = a.x1 - a.x0;
    const h = a.z1 - a.z0;
    const vertical = h > w * 2.2;
    const t = svgEl('text', { x: (a.x0 + a.x1) / 2, y: (a.z0 + a.z1) / 2, 'font-size': Math.min(size, (vertical ? h : w) / 7).toFixed(2), 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    if (vertical) t.setAttribute('transform', `rotate(-90 ${(a.x0 + a.x1) / 2} ${(a.z0 + a.z1) / 2})`);
    t.textContent = p.name.toUpperCase();
    labels.append(t);
  }
  const you = svgEl('g', {}, 'map-you');
  const s = zone === 'ground' ? 2.2 : 0.9;
  you.append(svgEl('circle', { r: 1.3 * s }, 'map-you-halo'), svgEl('circle', { r: 0.55 * s }), svgEl('path', { d: `M 0 ${1.6 * s} L ${-0.55 * s} ${0.45 * s} L ${0.55 * s} ${0.45 * s} Z` }));
  svg.append(areas, marks, labels, you);
  const body = el('div', 'city-map-body');
  body.append(svg, caption);
  pick('');
  return {
    title: zone === 'ground' ? 'Ground Floor' : 'Sky Terrace',
    body,
    you,
    here(x, z) {
      const hit = [...parts].reverse().find((p) => x >= p.area.x0 && x <= p.area.x1 && z >= p.area.z0 && z <= p.area.z1);
      return hit ? `You are ${hit.id === 'street' ? 'on' : 'at'} the ${hit.name.replace(/^The /, '')}` : '';
    },
  };
}
