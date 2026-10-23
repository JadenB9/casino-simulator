// A new table's defaults, as data. The page needs a table's limits, buy-in and seats before anyone
// sits there (a station's limits sign, the lobby's limits picker) but none of the engines that run
// the games, which only the server needs: importing the engines for their config() brought every
// game's rules, deals and bots into the page's first download.
//
// table-configs.data.ts is each engine's config(variant, mode) for every variant and both modes,
// written by shared/test/table-configs.test.ts. That test fails whenever an engine and the file
// disagree, and `npx vitest run --project unit shared/test/table-configs.test.ts -u` writes it again.

import type { GameId, TableConfig, TableMode } from './engine.ts';
import { variantOf } from './games/catalog.ts';
import { CONFIGS } from './table-configs.data.ts';

/** The defaults for a new table of this game, exactly as its engine's config(variant, mode) gives them. */
export function tableConfig(game: GameId, variant: string, mode: TableMode): TableConfig {
  return structuredClone(CONFIGS[configKey(game, variantOf(game, variant), mode)]!);
}

/** Where a game, variant and mode's defaults are kept in table-configs.data.ts. */
export function configKey(game: GameId, variant: string, mode: TableMode): string {
  return `${game}:${variant}:${mode}`;
}
