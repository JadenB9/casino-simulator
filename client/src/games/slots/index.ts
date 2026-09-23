// Slots: three one-player machines (Classic Sevens, Neon Nights, 5x Wild). createModel builds a
// cabinet that works as floor decor on its own; mounting the view takes over that cabinet's reels,
// meters, bulbs and candle and gives them back on dispose.

import type { GameClientModule } from '../contract.ts';
import { isMachineId } from '../../../../shared/src/games/slots/machines.ts';
import { buildCabinet, FOOTPRINT } from './cabinet.ts';
import { mountSlots } from './view.ts';
import './slots.css';

const FONTS = ["700 40px DSEG7", '40px Limelight', "40px 'Tilt Neon'", '600 40px Cinzel', "600 40px 'Barlow Condensed'"];

export const slots: GameClientModule = {
  game: 'slots',
  footprint: FOOTPRINT,
  createModel: ({ variant, quality }) => buildCabinet(isMachineId(variant) ? variant : 'sevens', quality),
  seats: () => [{ position: [0, 0, 0.72], yaw: Math.PI }],
  playPose: (variant) =>
    variant === 'neon'
      ? { position: [0, 1.46, 1.32], target: [0, 1.31, 0.27] }
      : { position: [0, 1.43, 1.26], target: [0, 1.3, 0.25] },
  mount: (ctx) => mountSlots(ctx),
  async preload() {
    // canvases for the glass, reels and meters need these faces before they paint
    await Promise.all(FONTS.map((f) => document.fonts.load(f).catch(() => [])));
  },
};
