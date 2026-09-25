// The Headline: the buyer's name on the pit's LED sign (marquee.ts) for as long as it plays, and a
// short fanfare, loud in the pit and distant everywhere else. Own the Night (takeover.ts) runs it too.

import type { FxEvent } from '../../../../shared/src/items.ts';
import { marqueePlacement, type Marquee } from '../marquee.ts';
import type { Effect, FxWorld } from './types.ts';

export function headline(w: FxWorld, ev: FxEvent, late: boolean, sign: () => Marquee | null): Effect {
  let up: Marquee | null = null;
  let heard = late;
  const at = marqueePlacement(w.plan);
  return {
    update(_dt, _t, left, view) {
      const m = sign();
      if (m !== up && left > 0) {
        up?.headline(null);
        m?.headline(ev.name, left);
        up = m;
      }
      if (!heard) {
        heard = true;
        // loud in the pit where the sign hangs, a distant flourish everywhere else
        w.sounds?.marquee({ x: at.x, y: 3.5, z: at.z }, view.here === 'pit' ? 1 : 0.5);
      }
      if (left <= 0) {
        if (up?.headlining === ev.name) up.headline(null);
        up = null;
      }
      return left > 0;
    },
    dispose() {
      if (up?.headlining === ev.name) up.headline(null);
    },
  };
}
