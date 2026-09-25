// Attract mode for the slot floor: machines nobody is playing idle the way real ones do. Each
// bulb ring breathes and runs a slow glint of its own, a beat out of step with its neighbours, and
// breaks into the full chase for a couple of seconds now and then; a band of light climbs each
// machine's glass (topper, pay glass, belly) every few seconds, rolling across the island from
// machine to machine. A machine someone is sitting at goes steady. The machine that just paid a
// big win runs the fast win chase with its candle flashing, for everyone on the floor. Calm
// (app/comfort.ts) keeps only the slow breath: no chases, the band a third as bright, a party's
// machine lit bright and steady.
//
// It costs no draw calls and no per-machine materials: the cabinets of one machine share their
// idle materials (slots/cabinet.ts, slots/build.ts), and this adds a little to those shaders. Each
// machine is told apart inside the shader by where it stands (the mesh's own origin), and the
// machines in use and the one celebrating are a handful of shared uniforms. The table view gives
// the machine you play its own materials, so none of this touches the machine in front of you.

import * as THREE from 'three';
import type { WorldStation } from './stations.ts';
import { calmUniform } from '../app/comfort.ts';

/** Machines marked busy at once (players sitting at slots); more than this is a very full floor. */
const BUSY_MAX = 24;
/** How long a machine celebrates a big win, in seconds; the last two fade out. */
const PARTY_S = 14;

interface Cabinet {
  station: WorldStation;
  /** Where the cabinet's parts have their origin: what the shaders see as modelMatrix[3]. */
  at: THREE.Vector3;
  /** The candle's lower (tinted) half, which sits apart from the cabinet's origin. */
  candle: THREE.Vector3;
}

const shared = {
  uFloorT: { value: 0 },
  uBusy: { value: Array.from({ length: BUSY_MAX }, () => new THREE.Vector4(0, -100, 0, 0)) },
  uParty: { value: new THREE.Vector4(0, -100, 0, 0) },
  uPartyCandle: { value: new THREE.Vector4(0, -100, 0, 0) },
};

const PARS = /* glsl */ `
  uniform float uFloorT;
  uniform vec4 uBusy[${BUSY_MAX}];
  uniform vec4 uParty;
  uniform vec4 uPartyCandle;
  float attractBusy(vec2 m) {
    float b = 0.0;
    for (int i = 0; i < ${BUSY_MAX}; i++) b = max(b, uBusy[i].w * step(distance(m, uBusy[i].xz), 0.3));
    return b;
  }
  float attractParty(vec2 m) {
    return uParty.w * step(distance(m, uParty.xz), 0.3);
  }
  // a fixed offset per machine, from where it stands
  float attractPhase(vec2 m) {
    return fract(sin(dot(floor(m * 4.0 + 0.5), vec2(12.9898, 78.233))) * 43758.5453);
  }
`;

export class Attract {
  private readonly cabinets: Cabinet[] = [];
  private readonly patched = new Set<THREE.Material>();
  private party: { cab: Cabinet; left: number } | null = null;
  private busyIds: string[] = [];

  constructor(stations: readonly WorldStation[]) {
    for (const station of stations) {
      if (station.game !== 'slots') continue;
      const handle = findHandle(station.model);
      if (!handle) continue;
      handle.root.updateWorldMatrix(true, false);
      const at = new THREE.Vector3().setFromMatrixPosition(handle.root.matrixWorld);
      handle.candleTint.updateWorldMatrix(true, false);
      const candle = new THREE.Vector3().setFromMatrixPosition(handle.candleTint.matrixWorld);
      this.cabinets.push({ station, at, candle });
      this.patch(handle.bulbs.material as THREE.Material, 'attract-bulbs', patchBulbs);
      this.patch(handle.printed.material as THREE.Material, 'attract-glass', patchGlass);
      this.patch(handle.candleTint.material as THREE.Material, 'attract-candle', patchCandle);
      this.patch(handle.candleWhite.material as THREE.Material, 'attract-candle', patchCandle);
    }
  }

  /** Stations with somebody at them (you and everyone the floor says is sitting somewhere). */
  setBusy(stationIds: Iterable<string>): void {
    const ids = [...new Set(stationIds)].filter((id) => id.startsWith('slots-'));
    ids.sort();
    if (ids.join() === this.busyIds.join()) return;
    this.busyIds = ids;
    const slots = shared.uBusy.value;
    let n = 0;
    for (const id of ids) {
      const cab = this.cabinets.find((c) => c.station.id === id);
      if (!cab || n >= BUSY_MAX) continue;
      slots[n++]!.set(cab.at.x, cab.at.y, cab.at.z, 1);
    }
    for (; n < BUSY_MAX; n++) slots[n]!.set(0, -100, 0, 0);
  }

  /** A big win at this station: its lights go wild for a while. False if it isn't a slot machine here. */
  celebrate(stationId: string): boolean {
    const cab = this.cabinets.find((c) => c.station.id === stationId);
    if (!cab) return false;
    this.party = { cab, left: PARTY_S };
    return true;
  }

  update(dt: number): void {
    shared.uFloorT.value = (performance.now() / 1000) % 7200;
    const p = this.party;
    if (!p) return;
    p.left -= dt;
    if (p.left <= 0) {
      this.endParty();
      return;
    }
    const fade = Math.min(1, p.left / 2);
    shared.uParty.value.set(p.cab.at.x, p.cab.at.y, p.cab.at.z, fade);
    shared.uPartyCandle.value.set(p.cab.candle.x, p.cab.candle.y, p.cab.candle.z, fade);
  }

  dispose(): void {
    this.endParty();
    this.setBusy([]);
  }

  private endParty(): void {
    shared.uParty.value.set(0, -100, 0, 0);
    shared.uPartyCandle.value.set(0, -100, 0, 0);
    this.party = null;
  }

  private patch(mat: THREE.Material, key: string, edit: (shader: THREE.WebGLProgramParametersWithUniforms) => boolean): void {
    if (this.patched.has(mat) || mat.userData.attract) return;
    this.patched.add(mat);
    mat.userData.attract = true;
    const before = mat.onBeforeCompile;
    const beforeKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = (shader, renderer) => {
      before.call(mat, shader, renderer);
      if (!edit(shader)) {
        console.warn(`attract mode: ${key} found nothing to hook into`);
        return;
      }
      shader.uniforms.uFloorT = shared.uFloorT;
      shader.uniforms.uBusy = shared.uBusy;
      shader.uniforms.uParty = shared.uParty;
      shader.uniforms.uPartyCandle = shared.uPartyCandle;
      shader.uniforms.uCalm = calmUniform;
    };
    mat.customProgramCacheKey = () => `${beforeKey.call(mat)}|${key}`;
    mat.needsUpdate = true;
  }
}

/**
 * The bulb ring (cabinet.ts bulbMaterial): mode 0 is the idle chase every machine runs in step.
 * Attract replaces it with a slow breath and a glint of the machine's own, the full chase for two
 * seconds in every nineteen, steady light while someone plays, and the win comet at a party.
 */
function patchBulbs(shader: THREE.WebGLProgramParametersWithUniforms): boolean {
  const hook = 'vLit = uMode < 0.5 ? 0.3 + 0.7 * chase :';
  const calmHook = 'float calmIdle = 0.72;';
  if (!shader.vertexShader.includes(hook) || !shader.vertexShader.includes(calmHook)) return false;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${PARS}`)
    .replace(
      hook,
      `vec2 attractAt = modelMatrix[3].xz;
        float attractT = uFloorT + attractPhase(attractAt) * 40.0;
        float attractRun = fract(bulbId / 9.0 - attractT * 0.5);
        float attractGentle = 0.26 + 0.16 * (0.5 + 0.5 * sin(attractT * 1.1)) + 0.8 * pow(attractRun, 8.0);
        float attractIdle = mix(attractGentle, 0.3 + 0.7 * chase, step(fract(attractT / 19.0), 0.1));
        attractIdle = mix(attractIdle, 0.78, attractBusy(attractAt));
        attractIdle = mix(attractIdle, comet * 1.2, attractParty(attractAt));
        // calm: only the slow breath; steady while someone plays, steady and bright at a party
        float attractCalm = mix(mix(0.3 + 0.1 * sin(attractT * 0.37), 0.78, attractBusy(attractAt)), 1.05, attractParty(attractAt));
        vLit = uMode < 0.5 ? attractIdle :`,
    )
    .replace(calmHook, 'float calmIdle = attractCalm;');
  return true;
}

/** The printed glass: a soft band of light climbs it every eight seconds, faster at a party. */
function patchGlass(shader: THREE.WebGLProgramParametersWithUniforms): boolean {
  const hook = '#include <emissivemap_fragment>';
  if (!shader.fragmentShader.includes(hook) || !shader.vertexShader.includes('#include <begin_vertex>')) return false;
  // Everything that depends only on which machine this is is worked out per vertex.
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${PARS}\nvarying vec3 vAttractLocal;\nvarying vec4 vAttractState;`)
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vAttractLocal = position;
      vec2 attractAt = modelMatrix[3].xz;
      vAttractState = vec4(attractBusy(attractAt), attractParty(attractAt), attractPhase(attractAt) * 40.0 + attractAt.x * 0.35, 0.0);`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uFloorT;\nuniform float uCalm;\nvarying vec3 vAttractLocal;\nvarying vec4 vAttractState;')
    .replace(
      hook,
      `${hook}
    {
      float busy = vAttractState.x;
      float party = vAttractState.y;
      float t = uFloorT + vAttractState.z;
      // calm: the band keeps its slow pace at a party too, at a third of the light
      float sweep = fract(t / mix(8.0, 1.4, party * (1.0 - uCalm))) * 4.2 - 0.7;
      float d = vAttractLocal.y + vAttractLocal.x * 0.55 - sweep;
      float band = exp(-d * d * 55.0) * (1.0 - 0.67 * uCalm);
      float idle = 0.95 + 0.05 * sin(t * 1.1) + band * 0.85;
      totalEmissiveRadiance *= mix(mix(idle, 1.0, busy), 1.15 + band * 1.6, party);
    }`,
    );
  return true;
}

/**
 * The candle on top: at a party its two halves flash in turn, the way a machine calls for a hand
 * pay. Both halves share this, a half cycle apart by their height.
 */
function patchCandle(shader: THREE.WebGLProgramParametersWithUniforms): boolean {
  const hook = '#include <color_fragment>';
  if (!shader.fragmentShader.includes(hook) || !shader.vertexShader.includes('#include <begin_vertex>')) return false;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vCandleAt;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCandleAt = vec3(modelMatrix[3]);');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${PARS}\nuniform float uCalm;\nvarying vec3 vCandleAt;`).replace(
    hook,
    `${hook}
    {
      vec3 dc = vCandleAt - uPartyCandle.xyz;
      float mine = uPartyCandle.w * step(length(dc.xz), 0.05) * step(abs(dc.y), 0.12);
      float on = step(0.5, fract(uFloorT * 3.0 + vCandleAt.y * 6.67));
      // calm: both halves lit and steady
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * mix(0.25 + 2.6 * on, 1.8, uCalm), mine);
    }`,
  );
  return true;
}

interface CabinetParts {
  root: THREE.Object3D;
  bulbs: THREE.InstancedMesh;
  printed: THREE.Mesh;
  candleTint: THREE.Mesh;
  candleWhite: THREE.Mesh;
}

/** The cabinet handle a slots model carries (userData.slots or .slots2), wherever it sits under the model. */
function findHandle(model: THREE.Object3D): CabinetParts | null {
  let found: CabinetParts | null = null;
  model.traverse((o) => {
    const h = (o.userData.slots ?? o.userData.slots2) as CabinetParts | undefined;
    if (!found && h?.bulbs && h.printed && h.root && h.candleTint && h.candleWhite) found = h;
  });
  return found;
}
