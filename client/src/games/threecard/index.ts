// Three Card Poker's client: the table on the floor, where its six players sit, the camera
// pose to play from, and the table view.

import type { GameClientModule } from '../contract.ts';
import { tableModel } from './model.ts';
import { SEAT_COUNT, TOP_Y, cameraPose, seatPose, spotsPose } from './layout.ts';
import { mountThreeCard } from './view.ts';
import { spotsInPlay } from '../multihand/frame.ts';

export const threecard: GameClientModule = {
  game: 'threecard',
  footprint: { width: 2.5, depth: 1.25 },
  createModel: ({ quality }) => tableModel(quality),
  seats: () => Array.from({ length: SEAT_COUNT }, (_, seat) => seatPose(seat)),
  // a spectator watches from behind the middle of the rail; a solo player on several hands is
  // framed to take them all in
  playPose: (_variant, seat) => {
    if (seat === null) return { position: [0, 1.5, 1.2], target: [0, TOP_Y, -0.2] };
    const n = spotsInPlay('threecard');
    return n > 1 ? spotsPose(Array.from({ length: n }, (_, i) => i)) : cameraPose(seat);
  },
  mount: (ctx) => mountThreeCard(ctx),
  async preload() {
    // the felt, the placard and the chips are painted on canvases: their fonts must be ready first
    await Promise.all(['600 40px Cinzel', '700 40px Cinzel', '600 40px "Barlow Condensed"'].map((f) => document.fonts.load(f).catch(() => [])));
  },
};
