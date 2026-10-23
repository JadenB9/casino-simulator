// Baccarat: the mini-baccarat table on the floor, and the view you play it in.

import type { GameClientDef } from '../contract.ts';
import { seatNumber } from '../../../../shared/src/games/baccarat/rules.ts';
import { SEAT_COUNT, seatCamera, seatPlace } from './layout.ts';
import { buildTable, loadFonts } from './model.ts';

export const baccarat: GameClientDef = {
  game: 'baccarat',
  footprint: { width: 2.2, depth: 1.25 },
  createModel: ({ quality }) => buildTable(quality),
  // indexed by the engine's seat number; seat 0 sits in the middle (printed 4)
  seats: () => Array.from({ length: SEAT_COUNT }, (_, seat) => seatPlace(seatNumber(seat))),
  playPose: (_variant, seat) => seatCamera(seatNumber(seat ?? 0)),
  view: () => import('./view.ts').then((m) => (ctx) => new m.BaccaratTable(ctx)),
  preload: () => loadFonts(),
};
