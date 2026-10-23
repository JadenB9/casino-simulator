// Blackjack's client: the table on the floor, where players sit, where the camera goes, and the
// table view you play at.

import type { GameClientDef } from '../contract.ts';
import { tableModel } from './model.ts';
import { SEATS, seatPosition, seatPose, spotsPose } from './layout.ts';
import { spotsInPlay } from '../multihand/frame.ts';

export const blackjack: GameClientDef = {
  game: 'blackjack',
  footprint: { width: 2.3, depth: 1.15 },
  createModel: () => tableModel(),
  seats: () => Array.from({ length: SEATS }, (_, seat) => seatPosition(seat)),
  // A solo player on several circles gets a camera that takes them all in.
  playPose: (_variant, seat) => {
    const n = seat === null ? 1 : spotsInPlay('blackjack');
    return n > 1 ? spotsPose(Array.from({ length: n }, (_, i) => i)) : seatPose(seat ?? 3);
  },
  view: () => import('./view.ts').then((m) => (ctx) => new m.BlackjackTable(ctx)),
  async preload() {
    // The felt is painted onto a canvas, which only uses a web font once it has loaded.
    await Promise.all([document.fonts.load('600 40px Cinzel'), document.fonts.load('600 40px "Barlow Condensed"')]).catch(() => {});
  },
};
