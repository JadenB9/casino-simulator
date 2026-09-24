// Texas Hold'em: the table on the floor, where people sit around it, where the camera goes to
// play, and the table view (view.ts).

import type { GameClientModule } from '../contract.ts';
import { chairSpots, SL, RR, TOP_Y, FOOTPRINT_R } from './table.ts';
import { tableModel } from './model.ts';
import { mountHoldem } from './view.ts';

export const holdem: GameClientModule = {
  game: 'holdem',
  // (unchanged since v1: the poker room is laid out on it; the chairs stay inside it)
  footprint: { width: 2 * (SL + FOOTPRINT_R), depth: 2 * FOOTPRINT_R },
  createModel: ({ quality }) => tableModel(quality),

  // The nine chairs round the oval, the dealer's place (the middle of the far side) left free:
  // a sitter's seat is the middle of the chair's cushion, facing the table.
  seats: () => chairSpots().map((c) => ({ position: [c.x, 0, c.z] as [number, number, number], yaw: c.yaw })),

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
