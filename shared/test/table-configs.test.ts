// The page's copy of every table's defaults (shared/src/table-configs.ts) against the engines that
// make them. The data file is written from the engines here: when an engine's config() changes,
// this fails until `npx vitest run --project unit shared/test/table-configs.test.ts -u` writes it
// again, so the page never shows a limit the table doesn't keep.

import { describe, expect, it } from 'vitest';
import type { GameId, TableMode } from '../src/engine.ts';
import { ENGINES } from '../src/games/index.ts';
import { CATALOG } from '../src/games/catalog.ts';
import { configKey, tableConfig } from '../src/table-configs.ts';

const MODES: TableMode[] = ['solo', 'multi'];
const games = Object.keys(CATALOG) as GameId[];
const variantsOf = (game: GameId): string[] => (CATALOG[game].variants.length ? CATALOG[game].variants.map((v) => v.id) : ['']);

/** The data file as the engines would write it today. */
function render(): string {
  const lines = [
    '// Written by shared/test/table-configs.test.ts from each engine\'s config(variant, mode): edit the',
    '// engine, then `npx vitest run --project unit shared/test/table-configs.test.ts -u`. See table-configs.ts.',
    '',
    "import type { TableConfig } from './engine.ts';",
    '',
    'export const CONFIGS: Record<string, TableConfig> = {',
  ];
  for (const game of games) {
    for (const variant of variantsOf(game)) {
      for (const mode of MODES) lines.push(`  '${configKey(game, variant, mode)}': ${JSON.stringify(ENGINES[game].config(variant, mode))},`);
    }
  }
  lines.push('};', '');
  return lines.join('\n');
}

describe('table configs', () => {
  it('the data file is what every engine says today', async () => {
    await expect(render()).toMatchFileSnapshot('../src/table-configs.data.ts');
  });

  it('every game, variant and mode reads back as its engine gives it, an unknown variant too', () => {
    for (const game of games) {
      for (const variant of [...variantsOf(game), '', 'no-such-variant']) {
        for (const mode of MODES) expect(tableConfig(game, variant, mode), `${game}:${variant}:${mode}`).toEqual(ENGINES[game].config(variant, mode));
      }
    }
  });

  it('hands out a copy each time, so a caller changing one changes nothing else', () => {
    const a = tableConfig('blackjack', '', 'solo');
    a.limits.default.max = 1;
    expect(tableConfig('blackjack', '', 'solo').limits.default.max).toBe(ENGINES.blackjack.config('', 'solo').limits.default.max);
  });
});
