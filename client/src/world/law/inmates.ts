// v7: the jail's inmates, drawn: five men in orange walking their loops (shared/src/law/inmates.ts,
// the same function of the time the floor uses), and a theft played out: the floor's `law` event
// of kind 'theft' sends that inmate over to whoever he robs; he throws a punch, they reel, and he
// walks back to his loop. A shot knocks one down for a moment like anyone else.

import * as THREE from 'three';
import type { Look } from '../../../../shared/src/look.ts';
import { INMATE_IDS, THEFT_WALK_MS, inmatePose, type InmateId } from '../../../../shared/src/law/inmates.ts';
import type { Characters, Person } from '../characters.ts';

const LOOKS: Look[] = [
  { v: 1, body: 'm', outfit: 'hoodie', skin: 1, hair: '#1a1410', top: '#e8641c', bottom: '#e0601a', shoes: '#f2f2f0' },
  { v: 1, body: 'm', outfit: 'hoodie', skin: 5, hair: '#0e0c0b', top: '#e8641c', bottom: '#e0601a', shoes: '#f2f2f0' },
  { v: 1, body: 'm', outfit: 'hoodie', skin: 3, hair: '#5a3a22', top: '#e8641c', bottom: '#e0601a', shoes: '#f2f2f0' },
  { v: 1, body: 'm', outfit: 'hoodie', skin: 7, hair: '#0e0c0b', top: '#e8641c', bottom: '#e0601a', shoes: '#f2f2f0' },
  { v: 1, body: 'm', outfit: 'hoodie', skin: 2, hair: '#c9a060', top: '#e8641c', bottom: '#e0601a', shoes: '#f2f2f0' },
];

interface Errand {
  /** Server time it started, where the victim stood, whether the punch has landed. */
  at: number;
  x: number;
  z: number;
  thrown: boolean;
  /** Called once when the punch lands (the victim reels, the money goes). */
  land: () => void;
}

export class Inmates {
  readonly group = new THREE.Group();
  private readonly people = new Map<InmateId, Person>();
  private readonly errands = new Map<InmateId, Errand>();
  private readonly last = new Map<InmateId, { x: number; z: number }>();

  constructor(characters: Characters) {
    this.group.name = 'inmates';
    INMATE_IDS.forEach((id, i) => {
      const p = characters.create(LOOKS[i]!, '', { staff: true });
      p.showTag(false);
      this.people.set(id, p);
      this.group.add(p.root);
    });
  }

  /** An inmate goes over to (x, z), punches, and `land` runs when the fist lands. */
  rob(index: number, x: number, z: number, at: number, land: () => void): void {
    const id = INMATE_IDS[index];
    if (!id) return;
    this.errands.set(id, { at, x, z, thrown: false, land });
  }

  /** A shot or a punch put him down for a moment. */
  knock(id: string): void {
    const p = this.people.get(id as InmateId);
    (p?.gesture as ((e: string) => void) | undefined)?.('knock');
  }

  update(dt: number, now: number, shown: boolean): void {
    this.group.visible = shown;
    if (!shown) return;
    for (const [id, p] of this.people) {
      let pose = inmatePose(id, now);
      const e = this.errands.get(id);
      let x = pose.x;
      let z = pose.z;
      let yaw = pose.yaw;
      let moving = pose.moving;
      if (e) {
        const t = now - e.at;
        const walk = THEFT_WALK_MS;
        const back = 2600;
        // to beside the victim, the punch, a moment, and back to wherever his loop has got to
        const stand = { x: e.x - 0.8 * Math.sign(e.x - pose.x || 1), z: e.z };
        if (t < walk) {
          const from = inmatePose(id, e.at);
          const k = t / walk;
          x = from.x + (stand.x - from.x) * k;
          z = from.z + (stand.z - from.z) * k;
          yaw = Math.atan2(stand.x - from.x, stand.z - from.z);
          moving = true;
        } else if (t < walk + 1500) {
          x = stand.x;
          z = stand.z;
          yaw = Math.atan2(e.x - x, e.z - z);
          moving = false;
          if (!e.thrown) {
            e.thrown = true;
            p.gesture('punch');
            setTimeout(e.land, 200);
          }
        } else if (t < walk + 1500 + back) {
          const k = (t - walk - 1500) / back;
          pose = inmatePose(id, now);
          x = stand.x + (pose.x - stand.x) * k;
          z = stand.z + (pose.z - stand.z) * k;
          yaw = Math.atan2(pose.x - stand.x, pose.z - stand.z);
          moving = true;
        } else this.errands.delete(id);
      }
      p.root.position.set(x, 0, z);
      p.root.rotation.y = yaw;
      const l = this.last.get(id);
      const speed = l && dt > 0 ? Math.hypot(x - l.x, z - l.z) / dt : 0;
      this.last.set(id, { x, z });
      p.setMotion(moving ? Math.min(2, speed / 1.75) : 0);
      p.update(dt);
    }
  }

  dispose(): void {
    for (const p of this.people.values()) {
      p.root.removeFromParent();
      p.dispose();
    }
    this.group.removeFromParent();
  }
}
