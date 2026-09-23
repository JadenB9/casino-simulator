// Texas Hold'em: the table on the floor, where people sit around it, where the camera goes to
// play, and the table view (view.ts).

import type { GameClientModule } from '../contract.ts';
import { tableModel, oval, SL, RR, TOP_Y } from './table.ts';
import { mountHoldem } from './view.ts';

const CHAIR_R = RR + 0.42;

export const holdem: GameClientModule = {
  game: 'holdem',
  footprint: { width: 2 * (SL + CHAIR_R) + 0.4, depth: 2 * CHAIR_R + 0.4 },
  createModel: () => tableModel(),

  // Nine chairs round the oval, the dealer's place (the middle of the far side) left free.
  seats: () =>
    Array.from({ length: 9 }, (_, k) => {
      const e = oval(k / 10, CHAIR_R);
      return { position: [e.x, 0, e.z] as [number, number, number], yaw: Math.atan2(-e.nx, -e.nz) };
    }),

  // High over the near seat and looking well down, so the board and your own two cards sit
  // together in the middle of the screen with little foreshortening, every seat in view, the far
  // nameplates below the dealer's line and yours above the tips line and the action bar.
  playPose: () => ({ position: [0, TOP_Y + 1.54, RR + 0.7], target: [0, TOP_Y - 0.24, 0] }),

  mount: (ctx) => mountHoldem(ctx),

  async preload() {
    // The felt is painted once, so make sure its lettering has the right face first.
    try {
      await Promise.all([document.fonts.load('600 40px Cinzel'), document.fonts.load('600 20px "Barlow Condensed"')]);
    } catch {
      /* the fallback face will do */
    }
  },
};
