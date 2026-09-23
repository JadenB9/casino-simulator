// Blackjack's client: the table on the floor, where players sit, where the camera goes, and the
// table view you play at.

import type { GameClientModule } from '../contract.ts';
import { tableModel } from './model.ts';
import { BlackjackTable } from './view.ts';
import { SEATS, seatPosition, seatPose } from './layout.ts';

export const blackjack: GameClientModule = {
  game: 'blackjack',
  footprint: { width: 2.3, depth: 1.15 },
  createModel: () => tableModel(),
  seats: () => Array.from({ length: SEATS }, (_, seat) => seatPosition(seat)),
  playPose: (_variant, seat) => seatPose(seat ?? 3),
  mount: (ctx) => new BlackjackTable(ctx),
  async preload() {
    // The felt is painted onto a canvas, which only uses a web font once it has loaded.
    await Promise.all([document.fonts.load('600 40px Cinzel'), document.fonts.load('600 40px "Barlow Condensed"')]).catch(() => {});
  },
};
