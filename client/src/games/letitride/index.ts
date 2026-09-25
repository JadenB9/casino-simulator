// Let It Ride's client: the table on the floor, where its seven players sit, the camera pose to
// play from, and the table view.

import type { GameClientModule } from '../contract.ts';
import { tableModel } from './model.ts';
import { SEAT_COUNT, TOP_Y, cameraPose, seatPose, spotsPose } from './layout.ts';
import { mountLetItRide } from './view.ts';
import { spotsInPlay } from '../multihand/frame.ts';

export const letitride: GameClientModule = {
  game: 'letitride',
  footprint: { width: 2.72, depth: 1.4 },
  createModel: ({ quality }) => tableModel(quality),
  seats: () => Array.from({ length: SEAT_COUNT }, (_, seat) => seatPose(seat)),
  // a spectator watches from behind the middle of the rail; a solo player on several hands is
  // framed to take them all in
  playPose: (_variant, seat) => {
    if (seat === null) return { position: [0, 1.6, 1.3], target: [0, TOP_Y, -0.22] };
    const n = spotsInPlay('letitride');
    return n > 1 ? spotsPose(Array.from({ length: n }, (_, i) => i)) : cameraPose(seat);
  },
  mount: (ctx) => mountLetItRide(ctx),
  async preload() {
    await Promise.all(['600 40px Cinzel', '700 40px Cinzel', '600 40px "Barlow Condensed"'].map((f) => document.fonts.load(f).catch(() => [])));
  },
};
