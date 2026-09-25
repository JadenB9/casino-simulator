// Bots against bots at the Hold'em table, from the command line: a quick look at who beats whom
// while tuning (the Monte Carlo test holds the numbers to account). Run with
//   node --experimental-strip-types scripts/poker-arena.ts [deals] [seed]
import { botPlayer, alwaysCall, alwaysRaise, alwaysShove, alwaysMinRaise, drawnTable, duplicateMatch, table, type ArenaStats } from '../shared/test/helpers/poker-arena.ts';
import { tendency, type Reads } from '../shared/src/games/holdem/reads.ts';

const deals = Number(process.argv[2] ?? 300);
const seed = Number(process.argv[3] ?? 1);
const stats: ArenaStats = { decisions: 0, refused: 0, ms: 0, slowestMs: 0 };
const run = (label: string, players: Parameters<typeof duplicateMatch>[0]) => {
  const t0 = performance.now();
  const reads: Reads = {};
  const r = duplicateMatch(players, deals, seed, stats, { reads });
  console.log(`${label} (${((performance.now() - t0) / 1000).toFixed(1)} s)\n${table(r)}`);
  for (const [name, read] of Object.entries(reads)) {
    const t = tendency(read);
    console.log(`    ${name.padEnd(14)} VPIP ${(t.vpip * 100).toFixed(0).padStart(3)}%  PFR ${(t.pfr * 100).toFixed(0).padStart(3)}%  aggression ${(t.agg * 100).toFixed(0).padStart(3)}%  folds to a bet ${(t.fold * 100).toFixed(0).padStart(3)}%`);
  }
};
const which = process.argv[4] ?? 'all';
if (which === 'all' || which === 'tiers') run('High-stakes bots against micro-stakes bots', [botPlayer('pro', 'pro', 0.99), botPlayer('reg', 'reg', 0.9), botPlayer('lag', 'lag', 0.82), botPlayer('station', 'station', 0.1), botPlayer('fish', 'fish', 0.2), botPlayer('maniac', 'maniac', 0.25)]);
if (which === 'all' || which === 'call') run('Always call against high-stakes bots', [alwaysCall('always-call'), botPlayer('pro', 'pro', 0.99), botPlayer('reg', 'reg', 0.9), botPlayer('lag', 'lag', 0.82), botPlayer('tag', 'tag', 0.82), botPlayer('pro2', 'pro', 0.95)]);
if (which === 'all' || which === 'raise') run('Always raise against high-stakes bots', [alwaysRaise('always-raise'), botPlayer('pro', 'pro', 0.99), botPlayer('reg', 'reg', 0.9), botPlayer('lag', 'lag', 0.82), botPlayer('tag', 'tag', 0.82), botPlayer('pro2', 'pro', 0.95)]);
if (which === 'all' || which === 'shove') run('Always all-in against high-stakes bots', [alwaysShove('always-shove'), botPlayer('pro', 'pro', 0.99), botPlayer('reg', 'reg', 0.9), botPlayer('lag', 'lag', 0.82), botPlayer('tag', 'tag', 0.82), botPlayer('pro2', 'pro', 0.95)]);
console.log(`decisions ${stats.decisions}, refused ${stats.refused}, mean ${(stats.ms / stats.decisions).toFixed(3)} ms, slowest ${stats.slowestMs.toFixed(1)} ms`);
if (which === 'hu') {
  for (const [id, skill] of [['station', 0.1], ['fish', 0.2], ['maniac', 0.25], ['rock', 0.45], ['tag', 0.72], ['lag', 0.75], ['reg', 0.85]] as const) {
    run(`Heads-up: a pro against a ${id}`, [botPlayer('pro', 'pro', 0.99), botPlayer(id, id, skill)]);
  }
}
if (which === 'cheese') {
  for (const bb of [100, 1_000, 10_000, 100_000, 1_000_000]) {
    for (const [label, make] of [['always call', alwaysCall], ['always raise', alwaysRaise], ['always min-raise', alwaysMinRaise], ['always all-in', alwaysShove]] as const) {
      run(`${label} at a $${bb / 100} big blind table`, [make(label), ...drawnTable(bb, 5, seed)]);
    }
  }
}
if (which === 'stakes') {
  // a table of bots drawn at each stakes, against a table drawn at another
  for (const [lo, hi] of [[100, 1_000_000], [100, 10_000], [10_000, 1_000_000]]) {
    run(`Bots drawn at a $${hi / 100} big blind against bots drawn at $${lo / 100}`, [...drawnTable(hi, 3, seed, 'hi'), ...drawnTable(lo, 3, seed + 1, 'lo')]);
  }
}
