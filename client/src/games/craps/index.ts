// Craps: the table on the floor, where its players stand, the camera pose for each end of the
// layout, and the table view you play on (view.ts).

import type { GameClientModule } from '../contract.ts';
import { tableModel, BED_Y, OUTER } from './model.ts';
import { SEATS, seatEnd } from './seats.ts';
import { CrapsTable } from './view.ts';

export const craps: GameClientModule = {
  game: 'craps',
  footprint: { width: OUTER.w, depth: OUTER.d },
  createModel: ({ quality }) => tableModel(quality),
  seats: () => SEATS.map(([x, z, yaw]) => ({ position: [x, 0, z], yaw })),
  // Each player looks down at their own end of the layout and the proposition box beside it.
  playPose: (_variant, seat) => {
    const end = seat === null ? 1 : seatEnd(seat);
    return { position: [0.7 * end, BED_Y + 1.16, 0.86], target: [0.7 * end, BED_Y, 0.02] };
  },
  async preload() {
    // the felt is painted on a canvas, so its typefaces must be ready first
    await Promise.all([document.fonts.load('700 48px Cinzel'), document.fonts.load('600 48px Cinzel'), document.fonts.load('700 32px "Barlow Condensed"')]).catch(() => {});
  },
  mount: (ctx) => new CrapsTable(ctx),
};
