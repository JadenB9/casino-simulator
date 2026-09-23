// Snapshot interpolation for other players on the floor: each remote player is drawn DELAY_MS in
// the past, between the two snapshots around that moment, so 10 Hz updates look like smooth
// walking. If updates stop, we extrapolate briefly on the last velocity, then hold.

export const DELAY_MS = 200;
const EXTRAPOLATE_MS = 150;
const KEEP = 24;

export interface Pose {
  x: number;
  z: number;
  r: number;
  moving: boolean;
}

interface Sample extends Pose {
  t: number;
}

export class Track {
  private samples: Sample[] = [];

  push(t: number, pose: Pose): void {
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) return;
    // After a pause, pin a hold sample just before the new one so the avatar doesn't glide from
    // where it stopped seconds ago.
    if (last && t - last.t > 500) this.samples.push({ ...last, t: t - 100 });
    this.samples.push({ ...pose, t });
    if (this.samples.length > KEEP) this.samples.splice(0, this.samples.length - KEEP);
  }

  /** Pose at server time `now - DELAY_MS`. */
  at(serverTime: number): Pose | null {
    const s = this.samples;
    if (s.length === 0) return null;
    const t = serverTime - DELAY_MS;
    if (t <= s[0]!.t) return s[0]!;
    for (let i = 1; i < s.length; i++) {
      const b = s[i]!;
      if (b.t >= t) {
        const a = s[i - 1]!;
        const k = (t - a.t) / (b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, r: lerpAngle(a.r, b.r, k), moving: b.moving };
      }
    }
    const last = s[s.length - 1]!;
    const prev = s[s.length - 2];
    if (!prev || !last.moving) return last;
    const ahead = Math.min(EXTRAPOLATE_MS, t - last.t);
    const vx = (last.x - prev.x) / (last.t - prev.t);
    const vz = (last.z - prev.z) / (last.t - prev.t);
    return { x: last.x + vx * ahead, z: last.z + vz * ahead, r: last.r, moving: true };
  }
}

/** Yaw is a byte (0-255 = one turn); interpolate the short way round. */
export function lerpAngle(a: number, b: number, k: number): number {
  let d = ((b - a + 128) % 256) - 128;
  if (d < -128) d += 256;
  return (a + d * k + 256) % 256;
}
