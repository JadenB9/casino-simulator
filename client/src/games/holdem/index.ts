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

  // Behind and above the near seat, looking across the felt so every seat and the board are in view.
  playPose: () => ({ position: [0, TOP_Y + 1.12, RR + 1.02], target: [0, TOP_Y - 0.12, -0.12] }),

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
