// Snapshot interpolation for other players on the floor: each remote player is drawn DELAY_MS in
// the past, on a smooth curve through the samples around that moment, so a few positions a second
// look like walking. DELAY_MS covers the longest gap the sender leaves (send-policy.ts: a steady
// straight line is sent every 320 ms, and the floor's snapshots go out every 100 ms); past the last
// sample we extrapolate on its velocity for a little while (that is the straight line the sender
// didn't bother to send), then hold.
//
// The curve between two samples is a cubic Hermite whose slope at each sample comes from the
// samples either side of it (none at a stop), so the walker's speed and heading change smoothly
// through every sample instead of kinking there the way straight segments do. A new sample can
// still move the path under where the walker is drawn (the slope at the newest sample is a guess
// until the next one comes, and extrapolation can turn out wrong): the drawn pose then carries on
// from where it was and the difference eases away over a few frames rather than jumping.

export const DELAY_MS = 300;
const EXTRAPOLATE_MS = 200;
const KEEP = 24;
/** After a gap this long (ms) a hold sample pins the walker where they stood until the new one. */
const PAUSE_MS = 500;
/** A correction this large (cm) is drawn at once: the walker really is somewhere else. */
const SNAP_CM = 150;
/** Corrections ease away with this time constant, ms (about three frames). */
const SETTLE_MS = 50;
/**
 * A correction only carries from one frame to the next: drawn this much later (ms) there is
 * nothing left of it, and further back than the clock's small corrections (clock.ts lets the
 * server's time creep back 20 ms a message) the last pose is no frame before this one.
 */
const BRIDGE_AHEAD_MS = 250;
const BRIDGE_BACK_MS = 50;

export interface Pose {
  x: number;
  z: number;
  r: number;
  moving: boolean;
}

interface Sample extends Pose {
  t: number;
  /** Pinned after a pause: the walker stands here (no slope through it). */
  hold?: true;
}

export class Track {
  private samples: Sample[] = [];
  /** Bumped by every sample; a pose drawn from an older path is eased onto the new one. */
  private version = 0;
  private drawnVersion = -1;
  /** What at() hands out, reused: valid until the next call on this track. */
  private readonly out: Pose = { x: 0, z: 0, r: 0, moving: false };
  private readonly scratch: Pose = { x: 0, z: 0, r: 0, moving: false };
  /** The pose last handed out and when it was for (server time, NaN before the first). */
  private shownX = 0;
  private shownZ = 0;
  private shownR = 0;
  private shownT = NaN;
  /** The correction still easing away, as of shownT (cm, cm, yaw bytes). */
  private ox = 0;
  private oz = 0;
  private or = 0;

  push(t: number, pose: Pose): void {
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) return;
    // After a pause, pin a hold sample just before the new one so the avatar doesn't glide from
    // where it stopped seconds ago.
    if (last && t - last.t > PAUSE_MS) this.samples.push({ ...last, t: t - 100, hold: true });
    this.samples.push({ x: pose.x, z: pose.z, r: pose.r, moving: pose.moving, t });
    if (this.samples.length > KEEP) this.samples.splice(0, this.samples.length - KEEP);
    this.version++;
  }

  /**
   * Pose at server time `now - DELAY_MS`, or null before there is any sample. The object is the
   * track's own and the next call rewrites it: read it, don't keep it.
   */
  at(serverTime: number): Pose | null {
    const t = serverTime - DELAY_MS;
    const out = this.out;
    if (!this.sample(t, out)) return null;
    const since = t - this.shownT;
    const bridged = since >= -BRIDGE_BACK_MS && since <= BRIDGE_AHEAD_MS;
    if (!bridged) this.ox = this.oz = this.or = 0;
    // The path changed since the last frame: the correction starts from what that frame showed.
    else if (this.drawnVersion !== this.version && this.sample(this.shownT, this.scratch)) {
      this.ox = this.shownX - this.scratch.x;
      this.oz = this.shownZ - this.scratch.z;
      this.or = turn(this.scratch.r, this.shownR);
      if (Math.hypot(this.ox, this.oz) > SNAP_CM) this.ox = this.oz = this.or = 0;
    }
    this.drawnVersion = this.version;
    if (bridged) {
      const k = Math.exp(-Math.max(0, since) / SETTLE_MS);
      this.ox *= k;
      this.oz *= k;
      this.or *= k;
    }
    out.x += this.ox;
    out.z += this.oz;
    out.r = (((out.r + this.or) % 256) + 256) % 256;
    this.shownX = out.x;
    this.shownZ = out.z;
    this.shownR = out.r;
    this.shownT = t;
    return out;
  }

  /** The path itself at time t (nothing eased), into `into`; false with no samples. */
  private sample(t: number, into: Pose): boolean {
    const s = this.samples;
    if (s.length === 0) return false;
    if (t <= s[0]!.t) return copy(s[0]!, into);
    for (let i = 1; i < s.length; i++) {
      const b = s[i]!;
      if (b.t < t) continue;
      const a = s[i - 1]!;
      const dt = b.t - a.t;
      const u = (t - a.t) / dt;
      // the cubic Hermite basis
      const u2 = u * u;
      const u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;
      into.x = h00 * a.x + h10 * dt * this.slope(i - 1, 'x') + h01 * b.x + h11 * dt * this.slope(i, 'x');
      into.z = h00 * a.z + h10 * dt * this.slope(i - 1, 'z') + h01 * b.z + h11 * dt * this.slope(i, 'z');
      // the yaw on the same curve, unwrapped the short way round from a's
      const r = h00 * a.r + h10 * dt * this.slope(i - 1, 'r') + h01 * (a.r + turn(a.r, b.r)) + h11 * dt * this.slope(i, 'r');
      into.r = ((r % 256) + 256) % 256;
      into.moving = b.moving;
      return true;
    }
    const last = s[s.length - 1]!;
    const prev = s[s.length - 2];
    copy(last, into);
    if (!prev || !last.moving) return true;
    const ahead = Math.min(EXTRAPOLATE_MS, t - last.t);
    into.x = last.x + ((last.x - prev.x) / (last.t - prev.t)) * ahead;
    into.z = last.z + ((last.z - prev.z) / (last.t - prev.t)) * ahead;
    return true;
  }

  /**
   * How fast the walker goes through sample k (cm, or yaw bytes, per ms): across the samples
   * either side of it (the one side at an end), and not at all at a stop or a hold.
   */
  private slope(k: number, axis: 'x' | 'z' | 'r'): number {
    const s = this.samples;
    const p = s[k]!;
    if (!p.moving || p.hold) return 0;
    const a = s[k - 1] ?? p;
    const b = s[k + 1] ?? p;
    if (b.t === a.t) return 0;
    return (axis === 'r' ? turn(a.r, b.r) : b[axis] - a[axis]) / (b.t - a.t);
  }
}

function copy(p: Pose, into: Pose): true {
  into.x = p.x;
  into.z = p.z;
  into.r = p.r;
  into.moving = p.moving;
  return true;
}

/** Yaw bytes from a to b the short way round, -128 to 127. */
function turn(a: number, b: number): number {
  return ((((b - a + 128) % 256) + 256) % 256) - 128;
}

/** Yaw is a byte (0-255 = one turn); interpolate the short way round. */
export function lerpAngle(a: number, b: number, k: number): number {
  let d = ((b - a + 128) % 256) - 128;
  if (d < -128) d += 256;
  return (a + d * k + 256) % 256;
}
