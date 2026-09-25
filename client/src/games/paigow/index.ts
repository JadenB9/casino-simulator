// Pai Gow Poker's client: the table on the floor, where its six players sit, the camera pose to
// play from, and the table view.

import type { GameClientModule } from '../contract.ts';
import { tableModel } from './model.ts';
import { SEAT_COUNT, TOP_Y, cameraPose, seatPose, spotsPose } from './layout.ts';
import { mountPaiGow } from './view.ts';
import { spotsInPlay } from '../multihand/frame.ts';

export const paigow: GameClientModule = {
  game: 'paigow',
  footprint: { width: 2.72, depth: 1.4 },
  createModel: ({ quality }) => tableModel(quality),
  seats: () => Array.from({ length: SEAT_COUNT }, (_, seat) => seatPose(seat)),
  playPose: (_variant, seat) => {
    if (seat === null) return { position: [0, 1.6, 1.3], target: [0, TOP_Y, -0.22] };
    const n = spotsInPlay('paigow');
    return n > 1 ? spotsPose(Array.from({ length: n }, (_, i) => i)) : cameraPose(seat);
  },
  mount: (ctx) => mountPaiGow(ctx),
  async preload() {
    await Promise.all(['600 40px Cinzel', '700 40px Cinzel', '600 40px "Barlow Condensed"'].map((f) => document.fonts.load(f).catch(() => [])));
  },
};
