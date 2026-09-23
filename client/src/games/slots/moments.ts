// The slot machines' Tips line and win tiers. The return quoted is the machine's par sheet figure,
// the one shared/test/slots-exact.test.ts proves by enumerating every stop combination; the tiers
// count the win in bets, the way the machine presents it.

/** Big from 10 bets, huge from 50; below 10 a win gets the machine's own line, jingle and rollup. */
export const BIG_X = 10;
export const HUGE_X = 50;

export type WinTier = 'big' | 'huge';

export function winTier(win: number, bet: number): WinTier | null {
  if (bet <= 0 || win <= bet) return null;
  return win >= HUGE_X * bet ? 'huge' : win >= BIG_X * bet ? 'big' : null;
}

/** "94.4275%": the 'Return to player' row of a machine's published figures. */
export function rtpOf(m: { published: readonly (readonly [string, string])[] }): string | null {
  const row = m.published.find(([k]) => k === 'Return to player');
  return (row && /^\d+(\.\d+)?%/.exec(row[1])?.[0]) ?? null;
}

/** The one honest line: spins don't remember, and what the machine keeps over time. */
export function slotsTip(m: { published: readonly (readonly [string, string])[] }): string {
  const rtp = rtpOf(m);
  return rtp ? `Every spin is independent; this machine returns ${rtp} over time.` : 'Every spin is independent: a machine is never due.';
}

/** Whole bets a win is worth, rounded down so a banner never overstates it: "41x the bet". */
export function timesBet(win: number, bet: number): string {
  return `${Math.floor(win / bet)}x the bet`;
}

const COUNT = ['', 'One', 'Two', 'Three', 'Four', 'Five'];
const NEON_PLURAL: Record<string, string> = {
  DIAMOND: 'diamonds', SEVEN: 'sevens', BELL: 'bells', HORSESHOE: 'horseshoes', A: 'aces', K: 'kings', Q: 'queens', J: 'jacks', '10': 'tens',
};

/** Neon Nights' best line in words: "Five diamonds", "Four sevens and 2 more lines". */
export function neonHand(lines: readonly { symbol: string; count: number; win: number }[]): string | null {
  if (!lines.length) return null;
  const best = [...lines].sort((a, b) => b.win - a.win)[0]!;
  const name = `${COUNT[best.count] ?? best.count} ${NEON_PLURAL[best.symbol] ?? best.symbol.toLowerCase()}`;
  const more = lines.length - 1;
  return more > 0 ? `${name} and ${more} more line${more > 1 ? 's' : ''}` : name;
}
