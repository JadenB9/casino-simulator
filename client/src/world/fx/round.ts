// Round on the House: a glass of champagne in the hand of everyone in the buyer's room for a
// minute. It's drawn, not worn: each character in the room is shown holding a flute (the bar's own
// flute and the carrying pose, wearables.ts) through a look that exists only on this page, and
// nothing is saved or sent. Someone who already has a drink keeps theirs; someone who walks in
// while the round is on gets a glass too, and keeps it until the round is over, wherever they go.

import * as THREE from 'three';
import type { FxEvent } from '../../../../shared/src/items.ts';
import type { Look } from '../../../../shared/src/look.ts';
import { roomAt } from '../layout.ts';
import type { Effect, FxPerson, FxWorld } from './types.ts';
import { fxRoom } from './scope.ts';

/** The bar item the glass is drawn as (items.ts BAR_MENU: a flute of brut). */
export const ROUND_ITEM = 'champagne';

/**
 * The look to draw someone in during the round: theirs with a flute in the hand, or null to leave
 * them be (they're holding a drink of their own).
 */
export function withGlass(look: Look, until: number, now: number, op: string): Look | null {
  if (look.held && look.held.until > now) return null;
  return { ...look, held: { item: ROUND_ITEM, order: op, until } };
}

export function round(w: FxWorld, ev: FxEvent, late: boolean): Effect {
  const room = fxRoom(w.plan, ev)?.id ?? null;
  /** Everyone given a glass: the look they had, and the one we drew them in. */
  const given = new Map<FxPerson, { was: Look; drawn: Look }>();
  const op = `fx-round-${ev.id}-${ev.at}`;
  let heard = late;
  let scan = 0;

  const give = (now: number) => {
    for (const { ch } of w.people()) {
      const g = given.get(ch);
      if (g) {
        if (ch.currentLook === g.drawn) continue;
        // their look changed under us (a new outfit came over the network, a drink of their own):
        // that's the look to go back to, with the glass put back in an empty hand
        const was = ch.currentLook;
        const again = withGlass(was, ev.until, now, op);
        if (again) ch.setLook(again);
        given.set(ch, { was, drawn: ch.currentLook });
        continue;
      }
      const p = ch.root.getWorldPosition(_p);
      if (p.y < -1 || roomAt(w.plan, p.x, p.z)?.id !== room) continue;
      const was = ch.currentLook;
      const look = withGlass(was, ev.until, now, op);
      if (!look) continue;
      ch.setLook(look);
      // setLook keeps its own copy: remember that one, to know if someone else changes it
      given.set(ch, { was, drawn: ch.currentLook });
    }
  };

  /** Everyone still drawn goes back to the look they had (whoever left took their glass with them). */
  const giveBack = () => {
    const live = new Set<FxPerson>();
    for (const { ch } of w.people()) live.add(ch);
    for (const [ch, g] of given) if (live.has(ch) && ch.currentLook === g.drawn) ch.setLook(g.was);
    given.clear();
  };

  return {
    update(dt, t, left) {
      if (!heard && t >= 0) {
        heard = true;
        const at = w.where(ev.id);
        w.sounds?.round(at ? { x: at.x, y: 1.3, z: at.z } : null);
      }
      // a quarter of a second between looks round the room is plenty
      scan -= dt;
      if (left > 0 && room && scan <= 0) {
        scan = 0.25;
        give(ev.at + t * 1000);
      }
      if (left <= 0) giveBack();
      return left > 0;
    },
    dispose() {
      giveBack();
    },
  };
}

const _p = new THREE.Vector3();
