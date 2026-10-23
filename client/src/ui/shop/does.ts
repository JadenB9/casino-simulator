// What a drink or a plate does for you, in a word each, for the bar's card: how tipsy a whole
// glass leaves you, a quicker step and for how long, sparkling, celebrating, well fed. Read from
// the effects themselves (world/consumables), so the card can't say something the floor doesn't
// do. None of it touches the odds. Pure, so the tests can read it.

import { ITEM_EFFECTS } from '../../world/consumables/effects.ts';
import { profileOf } from '../../world/consumables/schedule.ts';

export type DoesKind = 'tipsy' | 'quick' | 'bubbly' | 'party' | 'fed';

export interface Does {
  kind: DoesKind;
  /** The word on the chip ("Tipsy", "Quick · 3 min"). */
  word: string;
  /** The longer say, for its title. */
  more: string;
}

const mins = (ms: number) => `${Math.round(ms / 60_000)} min`;

export function doesWords(id: string): Does[] {
  const fx = ITEM_EFFECTS[id];
  if (!fx) return [];
  const out: Does[] = [];
  if (fx.tipsy) {
    // drinks' worth in the whole glass: a portion's worth times how many portions it's had in
    const drinks = Math.round(fx.tipsy * profileOf(id).portions * 10) / 10;
    out.push({ kind: 'tipsy', word: drinks >= 2 ? 'Very tipsy' : drinks > 1.05 ? 'Tipsy' : 'A little tipsy', more: `About ${drinks} ${drinks === 1 ? 'drink' : 'drinks'} in it` });
  }
  if (fx.pace) out.push({ kind: 'quick', word: `Quick · ${mins(fx.pace.ms)}`, more: `A ${Math.round((fx.pace.k - 1) * 100)}% quicker step for ${mins(fx.pace.ms)}` });
  if (fx.bubbly) out.push({ kind: 'bubbly', word: `Bubbly · ${mins(fx.bubbly)}`, more: `You sparkle for ${mins(fx.bubbly)}` });
  if (fx.party) out.push({ kind: 'party', word: `Party · ${mins(fx.party)}`, more: `Celebrating for ${mins(fx.party)}` });
  if (fx.fed) out.push({ kind: 'fed', word: `Fed · ${mins(fx.fed)}`, more: `Well fed for ${mins(fx.fed)}` });
  return out;
}
