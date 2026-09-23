// Casino War's client: the table on the floor, where its six players sit, the camera pose to play
// from, and the table view.

import type { GameClientModule } from '../contract.ts';
import { tableModel } from './model.ts';
import { SEAT_COUNT, TOP_Y, cameraPose, seatPose } from './layout.ts';
import { mountWar } from './view.ts';

export const war: GameClientModule = {
  game: 'war',
  footprint: { width: 2.5, depth: 1.25 },
  createModel: ({ quality }) => tableModel(quality),
  seats: () => Array.from({ length: SEAT_COUNT }, (_, seat) => seatPose(seat)),
  // a spectator watches from behind the middle of the rail
  playPose: (_variant, seat) => (seat === null ? { position: [0, 1.5, 1.2], target: [0, TOP_Y, -0.2] } : cameraPose(seat)),
  mount: (ctx) => mountWar(ctx),
  async preload() {
    // the felt and the limits sign are painted on canvases: their fonts must be ready first
    await Promise.all(['600 40px Cinzel', '700 40px Cinzel', '600 40px "Barlow Condensed"'].map((f) => document.fonts.load(f).catch(() => [])));
  },
};
