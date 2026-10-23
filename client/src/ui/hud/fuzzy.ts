// The palette's matcher: how well what was typed fits a name. Every typed character has to appear
// in order; a run of them together, or one at the start of a word, counts for more, and the whole
// query found as it stands counts most (at the start of the name, more still). Pure, for the tests.

const WORD_EDGE = /[\s\-_:,.()&'/·]/;

/** The score of `query` against `text` (higher is better), or null when it doesn't match. */
export function fuzzy(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return 0;
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) {
    const edge = at === 0 || WORD_EDGE.test(t[at - 1]!);
    return 200 + (at === 0 ? 60 : edge ? 30 : 0) + q.length * 4 - Math.min(at, 40);
  }
  // each word of the query on its own, in any order, as substrings ("vol sound")
  const words = q.split(' ');
  if (words.length > 1 && words.every((w) => t.includes(w))) return 150 + q.length * 2;
  let score = 0;
  let from = 0;
  let last = -2;
  for (const ch of q.replace(/ /g, '')) {
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    const edge = i === 0 || WORD_EDGE.test(t[i - 1]!);
    score += i === last + 1 ? 7 : edge ? 6 : 1;
    // a long way between letters counts against it
    score -= Math.min(6, i - from) * 0.25;
    last = i;
    from = i + 1;
  }
  return score;
}

/** The best of a name and its other words: the name counts in full, the other words a little less. */
export function bestScore(query: string, label: string, extra = ''): number | null {
  const a = fuzzy(query, label);
  const b = extra ? fuzzy(query, extra) : null;
  if (a === null && b === null) return null;
  return Math.max(a ?? -Infinity, (b ?? -Infinity) * 0.7);
}
