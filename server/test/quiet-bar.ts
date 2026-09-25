// Tests that check a bar order's full price can't run inside a happy hour (shared/src/happyhour.ts:
// the windows come from the real clock). This moves the test clock to a stretch with none near.

import { vi } from 'vitest';
import { nextHappyHour } from '../../shared/src/happyhour.ts';

/** If a happy hour is on or starts within 20 minutes, jump the clock to a minute after it ends. */
export function awayFromHappyHour(): void {
  const now = Date.now();
  const next = nextHappyHour(now);
  if (next.start - now > 20 * 60_000) return;
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(next.end + 60_000);
}
