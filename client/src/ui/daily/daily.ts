// The daily bonus on screen: a button in the HUD's right-hand bar (a brass dot on it while today's
// is waiting), and the sheet it opens, which also opens by itself when you walk onto the floor
// with today's bonus still to take (once a day per tab). The sheet shows the week: seven days,
// each paying more than the last, the ones already taken in this streak, today's with its Claim,
// and when the day turns over. Under it, the celebrities you've met on the floor.

import './daily.css';
import { el, button } from '../kit.ts';
import { openSheet, overlayCount, type Sheet } from '../menu/sheet.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { CELEBS, type DailyStatus } from '../../../../shared/src/celebs.ts';
import type { DailyApi } from './api.ts';
import type { Sfx } from '../../audio/sfx.ts';

export interface DailyDeps {
  root: HTMLElement;
  /** Where the HUD button goes (before `before`, when given). */
  bar: Element;
  before?: Element | null;
  api: DailyApi;
  /** The balance after a claim (session.balance). */
  money(m: { balance: number; inPlay: number; rev: number }): void;
  sfx?: Sfx | null;
}

export interface DailyHandle {
  open(): void;
  /** Ask the server where things stand (the button's dot, and the sheet if it's open). */
  refresh(): Promise<void>;
  dispose(): void;
}

const SHOWN_KEY = 'casino.daily.shown';
const NS = 'http://www.w3.org/2000/svg';

/** A wrapped present from the front, the ribbon over it and a bow on top (the HUD's line style). */
function giftIcon(): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ico');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  for (const d of ['M4.5 9.5h15v3h-15z', 'M5.8 12.5v7.5h12.4v-7.5', 'M12 9.5V20', 'M12 9.5c-1.6-3.6-5.6-4.4-5.9-2.2-.3 1.8 3 2.2 5.9 2.2', 'M12 9.5c1.6-3.6 5.6-4.4 5.9-2.2.3 1.8-3 2.2-5.9 2.2']) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}

/** "5h 12m", "38m", "under a minute". */
export function untilText(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'under a minute';
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

/** Whole dollars in a day's tile: "$2,500", "$50,000". */
const whole = (c: number) => formatMoney(Math.floor(c / 100) * 100);

export function mountDaily(deps: DailyDeps): DailyHandle {
  let status: DailyStatus | null = null;
  let sheet: Sheet | null = null;
  let busy = false;
  let disposed = false;
  let render: (() => void) | null = null;

  const btn = el('button', 'hud-btn daily-btn');
  btn.type = 'button';
  btn.title = 'Daily bonus';
  btn.setAttribute('aria-label', 'Daily bonus');
  btn.append(giftIcon(), el('span', 'daily-dot'));
  btn.addEventListener('click', () => open());
  deps.bar.insertBefore(btn, deps.before ?? null);

  const mark = () => {
    const waiting = status !== null && !status.claimed;
    btn.classList.toggle('waiting', waiting);
    btn.title = waiting ? `Daily bonus: ${whole(status!.amount)} waiting` : 'Daily bonus';
    btn.setAttribute('aria-label', btn.title);
  };

  let turn = 0;
  const refresh = async () => {
    try {
      status = await deps.api.status();
    } catch {
      return;
    }
    if (disposed) return;
    mark();
    render?.();
    // when the day turns over, tomorrow's is waiting: ask again then (the dot comes back)
    clearTimeout(turn);
    turn = window.setTimeout(() => void refresh(), Math.min(86_400_000, Math.max(60_000, status.resetAt - Date.now() + 3_000)));
  };

  function open(): void {
    if (sheet && !sheet.closed) return;
    sheet = openSheet(deps.root, { title: 'Daily Bonus', subtitle: 'Come back every day: seven in a row pays the most.', cls: 'daily-sheet', onClose: () => (render = null) });
    const body = sheet.body;
    const streak = el('div', 'daily-streak');
    const week = el('ol', 'daily-week');
    const action = el('div', 'daily-action');
    const note = el('p', 'daily-note', 'The day turns over at midnight in Las Vegas. Miss one and the streak starts again from day one.');
    const metHead = el('div', 'daily-met-head');
    const met = el('ul', 'daily-met');
    body.append(streak, week, action, note, metHead, met);
    render = () => {
      if (!status) {
        streak.replaceChildren(el('span', 'daily-loading', 'Checking your streak...'));
        return;
      }
      const s = status;
      // the days taken so far in this streak (a streak past seven keeps paying the seventh)
      const taken = s.claimed ? Math.min(7, s.streak) : Math.min(6, s.streak);
      const today = s.claimed ? -1 : s.next - 1;
      // a streak to keep going, or one to start
      const days = (n: number) => (n === 1 ? 'day in a row' : 'days in a row');
      streak.replaceChildren(
        ...(s.streak > 0
          ? [el('span', 'daily-streak-n', `${s.streak}`), el('span', 'daily-streak-label', days(s.streak)), ...(s.claimed ? [] : [el('span', 'daily-streak-hint', `Claim today to make it ${s.streak + 1}.`)])]
          : [el('span', 'daily-streak-n', 'Day 1'), el('span', 'daily-streak-label', 'Start a streak today')]),
      );
      week.replaceChildren(
        ...s.amounts.map((amount, i) => {
          const li = el('li', 'daily-day');
          if (i < taken) li.classList.add('taken');
          if (i === today) li.classList.add('today');
          if (s.claimed && i === s.next - 1 && i >= taken) li.classList.add('tomorrow');
          const label = i === today ? 'Today' : s.claimed && i === s.next - 1 && i >= taken ? 'Tomorrow' : `Day ${i + 1}`;
          li.append(el('span', 'daily-day-label', label), el('span', 'daily-day-amount', whole(amount)));
          if (i < taken) li.append(el('span', 'daily-day-check', 'Taken'));
          if (i === 6) li.classList.add('best');
          return li;
        }),
      );
      const left = Math.max(0, s.resetAt - Date.now());
      if (s.claimed) {
        action.replaceChildren(el('div', 'daily-done', `Taken for today. Tomorrow's is ${whole(s.amount)}, in ${untilText(left)}.`));
      } else {
        const claim = button(`Claim ${whole(s.amount)}`, () => void take(claim), { cls: 'primary daily-claim' });
        claim.dataset.autofocus = '';
        claim.disabled = busy;
        action.replaceChildren(claim, el('div', 'daily-left', `${untilText(left)} left today`));
      }
      const count = CELEBS.filter((c) => (s.met[c.id] ?? 0) > 0).length;
      metHead.replaceChildren(el('span', 'daily-met-title', 'Celebrities met'), el('span', 'daily-met-count', `${count} of ${CELEBS.length}`));
      met.replaceChildren(
        ...CELEBS.map((c) => {
          const n = s.met[c.id] ?? 0;
          const li = el('li', `daily-celeb${n > 0 ? ' met' : ''}`);
          li.append(el('span', 'daily-celeb-name', c.name), el('span', 'daily-celeb-known', n > 0 ? (n > 1 ? `Met ${n} times` : 'Met') : c.known));
          return li;
        }),
      );
    };
    render();
    void refresh();
  }

  async function take(b: HTMLButtonElement): Promise<void> {
    if (busy) return;
    busy = true;
    b.disabled = true;
    try {
      const r = await deps.api.claim();
      deps.money(r);
      status = r.status;
      if (!deps.sfx?.muted) deps.sfx?.play('chips-stack', { volume: 0.8 });
    } catch {
      // already taken in another tab, or the casino didn't answer: ask again where things stand
      await refresh();
    } finally {
      busy = false;
      mark();
      render?.();
    }
  }

  // Walking onto the floor with today's still waiting: the sheet, once a day per tab.
  void refresh().then(() => {
    if (disposed || !status || status.claimed) return;
    let shown: string | null = null;
    try {
      shown = sessionStorage.getItem(SHOWN_KEY);
    } catch {
      /* private mode */
    }
    if (shown === status.day) return;
    try {
      sessionStorage.setItem(SHOWN_KEY, status.day);
    } catch {
      /* private mode */
    }
    setTimeout(() => {
      if (!disposed && overlayCount() === 0) open();
    }, 900);
  });

  return {
    open,
    refresh,
    dispose() {
      disposed = true;
      clearTimeout(turn);
      sheet?.close();
      btn.remove();
    },
  };
}
