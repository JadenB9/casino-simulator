// Bingo: the hall, with the caller's stage and forty places at four long tables
// (docs/rules/parlour-games.md §1). createModel builds the stage, the blower, the flashboard and
// the tables for the floor; taking a seat mounts the view on them.

import type { GameClientModule } from '../contract.ts';
import { hallModel } from './model.ts';
import { FOOTPRINT, OVERVIEW_POSE, seatPositions, seatPose } from './layout.ts';
import { mountBingo } from './view.ts';
import './bingo.css';

const SEATS = seatPositions();

export const bingo: GameClientModule = {
  game: 'bingo',
  footprint: FOOTPRINT,
  createModel: ({ quality }) => hallModel(quality),
  seats: () => SEATS,
  playPose: (_variant, seat) => (seat === null ? OVERVIEW_POSE : seatPose(seat)),
  mount: (ctx) => mountBingo(ctx),
  async preload() {
    // the flashboard and the balls are painted with these faces
    await Promise.all(["700 40px 'Barlow Condensed'", '700 40px DSEG7'].map((f) => document.fonts.load(f).catch(() => [])));
  },
};
