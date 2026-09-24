// Several hands' celebrations take turns: a banner for one hand, the next a couple of seconds
// later, so each is read on its own and their lights don't pile up on the felt.

/** Each call runs its `show` now, or `gapMs` after the one before it, whichever is later. */
export function oneAtATime(gapMs = 2100): (show: () => void) => void {
  let next = 0;
  return (show) => {
    const now = performance.now();
    const at = Math.max(now, next);
    next = at + gapMs;
    if (at <= now) show();
    else setTimeout(show, at - now);
  };
}
