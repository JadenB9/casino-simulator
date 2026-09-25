// Pachinko: Sakura Storm, a machine in the Tokyo-style parlour (docs/rules/parlour-games.md §2).
// createModel builds the machine in its island for the floor; sitting down mounts the view on it.

import type { GameClientModule } from '../contract.ts';
import { machineModel, FOOTPRINT, SEAT_Z, PLAY_POSE } from './model.ts';
import { mountPachinko } from './view.ts';
import './pachinko.css';

export const pachinko: GameClientModule = {
  game: 'pachinko',
  footprint: FOOTPRINT,
  createModel: ({ quality }) => machineModel(quality),
  seats: () => [{ position: [0, 0, SEAT_Z], yaw: Math.PI }],
  playPose: () => PLAY_POSE,
  mount: (ctx) => mountPachinko(ctx),
  async preload() {
    // the board, the screen and the data lamp are painted with these faces
    await Promise.all(["600 40px 'Barlow Condensed'", '700 40px DSEG7'].map((f) => document.fonts.load(f).catch(() => [])));
  },
};
