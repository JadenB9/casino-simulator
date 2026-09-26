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
  nohome: 'There is no apartment there. Buy one at the home store across the street.',
  driving: 'Park the car first.',
};

/** Take `att`'s player to `to`: null when they went, or what to tell them when they didn't. */
export function ride(presence: Presence, att: FloorAtt, to: ZoneId, aptExists = false): string | null {
  // where the floor sees them now (a walker's attachment is only saved at rest)
  const at = presence.positionOf(att.accountId);
  if (!at) return SAY.far;
  // v7.4: a car you're still in (or the floor still thinks you are: a get-in the client gave up
  // on) doesn't hold you up: the valet takes it back to your garage and up you go
  const no = liftRefusal({ x: at.x, z: at.z, at: att.at, confine: att.confine, home: aptExists ? 1 : 0, car: null }, to);
  if (no) return SAY[no];
  const a = LIFTS[to].arrive;
  if (!presence.teleport(att.accountId, a.x, a.z, a.r)) return SAY.far;
  if (att.car) presence.setCar(att.accountId, null, null);
  return null;
}
