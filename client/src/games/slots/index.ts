// Slots: six one-player machines. Classic Sevens, Neon Nights and 5x Wild use the first cabinets
// and view (cabinet.ts, view.ts); Diamond Line, Lucky Cherries and Gold Rush are skins on the
// newer ones (build.ts, play.ts). createModel builds a cabinet that works as floor decor on its
// own; mounting the view takes over that cabinet's reels, meters, bulbs and candle and gives them
// back on dispose.

import type { GameClientModule } from '../contract.ts';
import { isMachineId } from '../../../../shared/src/games/slots/machines.ts';
import { buildCabinet, FOOTPRINT } from './cabinet.ts';
import { mountSlots } from './view.ts';
import { buildSkinned } from './build.ts';
import { isSkinned, mountSkinned } from './play.ts';
import './diamonds.ts';
import './cherries.ts';
import './goldrush.ts';
import './slots.css';

const FONTS = ["700 40px DSEG7", '40px Limelight', "40px 'Tilt Neon'", '600 40px Cinzel', "600 40px 'Barlow Condensed'"];

export const slots: GameClientModule = {
  game: 'slots',
  footprint: FOOTPRINT,
  createModel: ({ variant, quality }) => (isSkinned(variant) ? buildSkinned(variant, quality) : buildCabinet(isMachineId(variant) ? variant : 'sevens', quality)),
  seats: () => [{ position: [0, 0, 0.72], yaw: Math.PI }],
  playPose: (variant) =>
    variant === 'neon' || variant === 'cherries' || variant === 'goldrush'
      ? { position: [0, 1.5, 1.5], target: [0, 1.38, 0.27] }
      : { position: [0, 1.48, 1.44], target: [0, 1.37, 0.25] },
  mount: (ctx) => (isSkinned(ctx.variant) ? mountSkinned(ctx) : mountSlots(ctx)),
  async preload() {
    // canvases for the glass, reels and meters need these faces before they paint
    await Promise.all(FONTS.map((f) => document.fonts.load(f).catch(() => [])));
  },
};
