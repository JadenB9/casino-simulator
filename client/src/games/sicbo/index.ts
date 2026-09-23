// Sic Bo: three dice under a glass dome and the classic layout of 52 bets (view.ts has the table).

import type { GameClientModule } from '../contract.ts';
import { TABLE_W, TABLE_D, tableModel } from './model.ts';
import { mountSicBo, BET_POSE, SEATS } from './view.ts';

export const sicbo: GameClientModule = {
  game: 'sicbo',
  footprint: { width: TABLE_W, depth: TABLE_D },
  createModel: ({ quality }) => tableModel(quality),
  seats: () => SEATS,
  playPose: () => BET_POSE,
  async preload() {
    // the felt and the limits sign are painted once, so their faces must be loaded first
    await Promise.all(['600 48px Cinzel', '700 48px Cinzel', '600 48px "Barlow Condensed"', '400 48px Limelight'].map((f) => document.fonts.load(f))).catch(() => {});
  },
  mount: (ctx) => mountSicBo(ctx),
};
