// The floor's security as the client draws them: the pit boss and the guards (shared/src/law/
// patrol.ts places them from the server's clock, detours included), and the jail's own officers,
// who keep to their posts. Characters from the players' models in uniform: security in navy with
// a peaked cap and a radio, the pit boss in charcoal with an earpiece and a tablet, the jail's
// officers in olive. Only the ones the camera could see are posed and drawn.

import * as THREE from 'three';
import { STAFF, detourOf, loopPose, poseAt, type Detour, type Pose, type StaffId, type StaffSpec } from '../../../../shared/src/law/patrol.ts';
import { pathLength, type NavGrid, type Pt } from '../life/nav.ts';
import { DEFAULT_LOOK, type Look } from '../../../../shared/src/look.ts';
import { uniformOutfit, type Characters, type LawGesture, type Person } from '../characters.ts';
import { earpiece, guardCap, hangOn, radio, tablet } from './gear.ts';

const LOOKS: Record<'boss' | 'guard' | 'officer', Look> = {
  boss: { ...DEFAULT_LOOK, outfit: uniformOutfit('blazer'), top: '#26262b', bottom: '#1e1e22', shoes: '#0d0d0d', hair: '#6f6c68', skin: 1 },
  guard: { ...DEFAULT_LOOK, outfit: uniformOutfit('blazer'), top: '#1b2233', bottom: '#161b28', shoes: '#0b0b0b', hair: '#1b1512', skin: 3 },
  officer: { ...DEFAULT_LOOK, outfit: uniformOutfit('blazer'), top: '#46503c', bottom: '#2e3328', shoes: '#0b0b0b', hair: '#2b1d14', skin: 4 },
};
/** Each guard a little different: skin and hair. */
const GUARD_SKIN = [3, 5, 1, 6];
const GUARD_HAIR = ['#1b1512', '#0e0c0b', '#4a3020', '#2b1d14'];

/** Walk animation weight per m/s (the clip is made for a brisk walk). */
const WALK_PER_MS = 0.72;
/** How fast a turn catches up with the heading (per second). */
const TURN_RATE = 7;

export interface StaffMember {
  id: StaffId | string;
  kind: 'boss' | 'guard' | 'officer';
  person: Person;
  /** Still to hang: gear waiting for the model. */
  gear: (() => boolean)[];
  yaw: number;
  /** A fixed post (the jail's officers); patrol staff have none. */
  post: { x: number; z: number; yaw: number } | null;
}

/** A detour's walks as drawn: around the tables and through the doors rather than straight. */
interface Walks {
  go: Pt[];
  back: Pt[];
  at: Pt;
}

export class LawStaff {
  readonly group = new THREE.Group();
  readonly members: StaffMember[] = [];
  private detours: Detour[] = [];
  private readonly walks = new WeakMap<Detour, Walks>();
  /** The floor's walkable grid (world/life), for detours; straight lines without it. */
  nav: NavGrid | null = null;
  private readonly _p = new THREE.Vector3();

  constructor(
    private readonly characters: Characters,
    /** Whether someone standing at (x, z) could be seen from the camera now. */
    private readonly canSee: (x: number, z: number) => boolean,
  ) {
    this.group.name = 'law-staff';
    STAFF.forEach((s, i) => {
      const kind = s.kind === 'boss' ? 'boss' : 'guard';
      const look = kind === 'boss' ? LOOKS.boss : { ...LOOKS.guard, skin: GUARD_SKIN[i % 4]!, hair: GUARD_HAIR[i % 4]! };
      this.add(s.id, kind, look, null);
    });
  }

  /** One of the jail's officers at a fixed post. */
  addOfficer(id: string, x: number, z: number, yaw: number, skin: number): StaffMember {
    return this.add(id, 'officer', { ...LOOKS.officer, skin }, { x, z, yaw });
  }

  private add(id: string, kind: StaffMember['kind'], look: Look, post: StaffMember['post']): StaffMember {
    const person = this.characters.create(look, '', { staff: true });
    person.setPace(0.9 + ((id.charCodeAt(id.length - 1) * 7) % 20) / 100, (id.length * 0.37) % 1);
    this.group.add(person.root);
    const gear: (() => boolean)[] = [];
    if (kind === 'boss') {
      // the earpiece in his right ear (-x), the tablet in his left hand (+x)
      gear.push(hangOn(person, 'Head', earpiece(), (at) => at.add(new THREE.Vector3(-0.078, 0.07, 0.0))));
      gear.push(hangOn(person, 'Wrist.L', tablet(), (at) => at.add(new THREE.Vector3(0.035, -0.12, 0.03))));
    } else {
      gear.push(hangOn(person, 'Head', guardCap(), (at) => at.add(new THREE.Vector3(0, 0.222, 0.005))));
      gear.push(hangOn(person, 'Chest', radio(), (at) => at.add(new THREE.Vector3(0.1, 0.1, 0.125)), new THREE.Euler(-0.15, 0, 0)));
    }
    const m: StaffMember = { id, kind, person, gear, yaw: post?.yaw ?? 0, post };
    if (post) {
      person.root.position.set(post.x, 0, post.z);
      person.root.rotation.y = post.yaw;
      person.sway(id.length * 13 + 5);
    }
    this.members.push(m);
    return m;
  }

  get(id: string): StaffMember | undefined {
    return this.members.find((m) => m.id === id);
  }

  /** Detours the floor told us about (a new one, or the whole list after hello). */
  setDetours(list: Detour[]): void {
    this.detours = list;
  }

  addDetour(d: Detour, now: number): void {
    this.detours = [...this.detours.filter((x) => x.until > now), d];
  }

  /** Where a patrolling member of staff is at server time `now` (metres), for punches and speech. */
  poseOf(id: StaffId, now: number) {
    const spec = STAFF.find((s) => s.id === id)!;
    return poseAt(spec, now, detourOf(this.detours, id, now));
  }

  /** The detour under way that took this member of staff to this player, if any. */
  detourFor(staff: StaffId, who: number, now: number): Detour | null {
    return this.detours.find((d) => d.staff === staff && d.who === who && now < d.until) ?? null;
  }

  gesture(id: string, g: LawGesture): void {
    this.get(id)?.person.gesture(g);
  }

  /** `watch`: somewhere near the camera worth a glance (the local player's head), or null. */
  update(dt: number, now: number, watch: THREE.Vector3 | null): void {
    for (const m of this.members) {
      let x: number;
      let z: number;
      let yaw: number;
      let speed = 0;
      if (m.post) {
        ({ x, z, yaw } = m.post);
      } else {
        const spec = STAFF.find((s) => s.id === m.id)!;
        const d = detourOf(this.detours, m.id as StaffId, now);
        const p = d ? this.walked(spec, d, now) : poseAt(spec, now, null);
        x = p.x;
        z = p.z;
        yaw = p.yaw;
        if (p.moving) speed = p.busy ? 1.9 : spec.speed;
      }
      const shown = this.canSee(x, z);
      m.person.root.visible = shown;
      if (!shown) continue;
      // turn smoothly toward the heading, the short way round
      let d = yaw - m.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      m.yaw += d * Math.min(1, dt * TURN_RATE);
      m.person.root.position.set(x, 0, z);
      m.person.root.rotation.y = m.yaw;
      m.person.setMotion(speed * WALK_PER_MS);
      // an eye on you when you're close and in front
      if (watch) {
        const dx = watch.x - x;
        const dz = watch.z - z;
        const dist = Math.hypot(dx, dz);
        const ahead = dist > 0 ? (dx * Math.sin(m.yaw) + dz * Math.cos(m.yaw)) / dist : 0;
        m.person.lookAt(dist < 6 && ahead > 0.3 ? this._p.copy(watch) : null);
      }
      m.person.update(dt);
      if (m.gear.length) m.gear = m.gear.filter((hang) => !hang());
    }
  }

  /**
   * Where he is on a detour, as drawn: the same moments as the server's (patrol.ts poseAt), but
   * walking the floor's paths, and standing on open floor beside the player, not in a table.
   */
  private walked(spec: StaffSpec, d: Detour, now: number): Pose {
    const nav = this.nav;
    if (!nav) return poseAt(spec, now, d);
    let w = this.walks.get(d);
    if (!w) {
      const from = loopPose(spec, d.at);
      const home = loopPose(spec, d.until);
      const at = nav.nearestClear(d.x, d.z) ?? { x: d.x, z: d.z };
      w = { go: nav.path(from, at) ?? [from, at], back: nav.path(at, home) ?? [at, home], at };
      this.walks.set(d, w);
    }
    if (now < d.at + d.go) return along(w.go, (now - d.at) / d.go);
    const leave = d.until - d.back;
    if (now < leave) {
      // the player stands 0.9 m on from the server's spot, the way it faces
      const px = d.x + Math.sin(d.face) * 0.9;
      const pz = d.z + Math.cos(d.face) * 0.9;
      const yaw = Math.hypot(px - w.at.x, pz - w.at.z) > 0.2 ? Math.atan2(px - w.at.x, pz - w.at.z) : d.face;
      return { x: w.at.x, z: w.at.z, yaw, moving: false, busy: true };
    }
    return along(w.back, (now - leave) / d.back);
  }

  dispose(): void {
    for (const m of this.members) m.person.dispose();
    this.group.removeFromParent();
  }
}

/** The point `k` (0-1) of the way along a path, facing along it. */
function along(pts: readonly Pt[], k: number): Pose {
  let left = Math.min(1, Math.max(0, k)) * pathLength(pts);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= seg || i === pts.length - 1) {
      const t = seg > 0 ? Math.min(1, left / seg) : 1;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: Math.atan2(b.x - a.x, b.z - a.z), moving: true, busy: true };
    }
    left -= seg;
  }
  const p = pts[pts.length - 1]!;
  return { x: p.x, z: p.z, yaw: 0, moving: false, busy: true };
}
