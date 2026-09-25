// The elevator (shared/src/lifts.ts): a ride starts only from beside the doors of the zone you're
// in, never from a table and never while the law holds you (presence's `confine`), and it moves
// you in front of the other zone's doors at once (presence.teleport, which the client hears as
// `tp`). A refusal is told as `lift.no` in words, and the car's doors open again.

import { LIFTS, liftRefusal, type LiftRefusal } from '../../../shared/src/lifts.ts';
import type { ZoneId } from '../../../shared/src/zones.ts';
import type { FloorAtt, Presence } from './presence.ts';

const SAY: Record<LiftRefusal, string> = {
  here: 'You’re already on this floor.',
  table: 'Stand up from the table first.',
  held: 'Security has you. Not now.',
  far: 'Walk up to the elevator first.',
};

/** Take `att`'s player to `to`: null when they went, or what to tell them when they didn't. */
export function ride(presence: Presence, att: FloorAtt, to: ZoneId): string | null {
  // where the floor sees them now (a walker's attachment is only saved at rest)
  const at = presence.positionOf(att.accountId);
  if (!at) return SAY.far;
  const no = liftRefusal({ x: at.x, z: at.z, at: att.at, confine: att.confine }, to);
  if (no) return SAY[no];
  const a = LIFTS[to].arrive;
  return presence.teleport(att.accountId, a.x, a.z, a.r) ? null : SAY.far;
}
