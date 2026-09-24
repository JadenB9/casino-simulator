// Snapshot interpolation for other players on the floor: each remote player is drawn DELAY_MS in
// the past, between the two samples around that moment, so a few positions a second look like
// smooth walking. DELAY_MS covers the longest gap the sender leaves (send-policy.ts: a steady
// straight line is sent every 320 ms, and the floor's snapshots go out every 100 ms); past the last
// sample we extrapolate on its velocity for a little while (that is the straight line the sender
// didn't bother to send), then hold.

export const DELAY_MS = 300;
const EXTRAPOLATE_MS = 200;
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
