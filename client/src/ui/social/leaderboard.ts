// The leaderboards: richest, biggest single win and most rounds, each the top ten with your own
// row lit, and your place underneath when you're further down. The server reads the boards at
// most once a minute; the sheet says how long ago, and asks again once they're older than that.

import './social.css';
import { LEADERBOARDS, type Leaderboard, type LeaderboardId, type LeaderboardResponse } from '../../../../shared/src/protocol.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { button, el } from '../kit.ts';
import type { Closable } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { problemText } from '../menu/parts.ts';

export interface LeaderboardApi {
  leaderboard(): Promise<LeaderboardResponse>;
}

export interface LeaderboardDeps {
  root: HTMLElement;
  /** `import * as socialApi from '../ui/social/api.ts'`, or canned boards on the dev page. */
  api: LeaderboardApi;
  onClose?(): void;
}

interface BoardText {
  tab: string;
  column: string;
  note: string;
  empty: string;
  /** What an unplaced player is told under the board. */
  unplaced: string;
  format(v: number): string;
}

const BOARDS: Record<LeaderboardId, BoardText> = {
  richest: {
    tab: 'Richest',
    column: 'Worth',
    note: 'Balance plus chips taken to tables.',
    empty: 'Nobody has any money yet.',
    unplaced: 'With nothing in your balance or on a table, you are not on this board.',
    format: (v) => formatMoney(v),
  },
  biggestWin: {
    tab: 'Biggest win',
    column: 'Win',
    note: 'Biggest profit on a single round, any game.',
    empty: 'No wins yet.',
    unplaced: 'Win a round to get on this board.',
    format: (v) => formatMoney(v),
  },
  rounds: {
    tab: 'Most rounds',
    column: 'Rounds',
    note: 'Rounds played, every game counted.',
    empty: 'No rounds played yet.',
    unplaced: 'Play a round to get on this board.',
    format: (v) => v.toLocaleString('en-US'),
  },
};

/** The boards the server keeps are read again after this long (server/src/leaderboard.ts). */
const SERVER_CACHE_MS = 60_000;
const DASH = '—';

/** The tab last looked at, so the sheet reopens where it was left. */
let lastTab: LeaderboardId = 'richest';

export function refreshedText(ageMs: number): string {
  const s = Math.max(0, Math.floor(ageMs / 1000));
  if (s < 1) return 'Refreshed just now';
  if (s < 60) return `Refreshed ${s} s ago`;
  return `Refreshed ${Math.floor(s / 60)} min ago`;
}

function row(rank: number | null, name: string, value: string, cls: string, you: boolean): HTMLTableRowElement {
  const tr = el('tr', cls);
  const who = el('td', 'lb-name', name);
  if (you) who.append(el('span', 'lb-you', 'You'));
  tr.append(el('td', 'lb-rank', rank === null ? DASH : String(rank)), who, el('td', 'lb-value', value));
  return tr;
}

function renderBoard(id: LeaderboardId, board: Leaderboard): HTMLElement {
  const text = BOARDS[id];
  const wrap = el('div', 'lb-board');
  if (board.top.length === 0 && !board.you) {
    wrap.append(el('p', 'quiet', text.empty));
    return wrap;
  }
  const table = el('table', 'data lb-table');
  const head = el('tr');
  head.append(el('th', 'lb-rank', '#'), el('th', 'lb-name', 'Player'), el('th', 'lb-value', text.column));
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  for (const r of board.top) {
    const cls = [r.rank <= 3 ? `podium p${r.rank}` : '', r.you ? 'you' : ''].filter(Boolean).join(' ');
    body.append(row(r.rank, r.name, text.format(r.value), cls, !!r.you));
  }
  const you = board.you;
  if (you) {
    // Your own place, set apart from the ten above it.
    if (board.top.length > 0) {
      const gap = el('tr', 'lb-gap');
      const cell = el('td', '', '');
      cell.colSpan = 3;
      gap.append(cell);
      body.append(gap);
    }
    body.append(row(you.rank, you.name, you.rank === null ? DASH : text.format(you.value), 'you', true));
  }
  table.append(thead, body);
  wrap.append(table);
  if (board.top.length === 0) wrap.append(el('p', 'quiet', text.empty));
  if (you && you.rank === null) wrap.append(el('p', 'quiet lb-foot', text.unplaced));
  wrap.append(el('p', 'lb-note', text.note));
  return wrap;
}

export function openLeaderboard(deps: LeaderboardDeps): Closable {
  let ticker = 0;
  let again = 0;
  const sheet = openSheet(deps.root, {
    title: 'Leaderboards',
    subtitle: 'Loading',
    cls: 'lb-sheet',
    onClose: () => {
      clearInterval(ticker);
      clearTimeout(again);
      deps.onClose?.();
    },
  });

  // Tabs: one tab stop, arrows move between the boards (and show each as they go).
  const tabs = el('div', 'seg lb-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Leaderboards');
  const panel = el('div', 'lb-panel');
  panel.setAttribute('role', 'tabpanel');
  panel.id = `lb-panel-${Math.random().toString(36).slice(2, 8)}`;
  const buttons = new Map<LeaderboardId, HTMLButtonElement>();
  for (const id of LEADERBOARDS) {
    const b = el('button', 'seg-btn', BOARDS[id].tab);
    b.type = 'button';
    b.id = `${panel.id}-${id}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', panel.id);
    b.addEventListener('click', () => show(id));
    buttons.set(id, b);
    tabs.append(b);
  }
  tabs.addEventListener('keydown', (e) => {
    const i = LEADERBOARDS.indexOf(lastTab);
    const n = LEADERBOARDS.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    show(LEADERBOARDS[to]!);
    buttons.get(lastTab)!.focus();
  });
  sheet.body.append(tabs, panel);

  let data: LeaderboardResponse | null = null;
  let readAt = 0;
  let problem = '';

  const paintAge = () => {
    if (!data) return;
    sheet.sub.textContent = refreshedText(data.age + (Date.now() - readAt));
  };

  const show = (id: LeaderboardId) => {
    lastTab = id;
    for (const [bid, b] of buttons) {
      const on = bid === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', buttons.get(id)!.id);
    if (data) {
      panel.replaceChildren(renderBoard(id, data.boards[id]));
      return;
    }
    if (problem) {
      const retry = button('Try again', () => void load(), { cls: 'ghost' });
      panel.replaceChildren(el('p', 'quiet lb-problem', problem), retry);
      return;
    }
    panel.replaceChildren(el('p', 'quiet', 'Reading the boards.'));
  };

  const load = async () => {
    clearTimeout(again);
    problem = '';
    if (!data) show(lastTab);
    try {
      data = await deps.api.leaderboard();
      readAt = Date.now();
    } catch (err) {
      // With boards already showing, keep them and try again later; the age says how old they are.
      if (!data) {
        problem = problemText(err);
        sheet.sub.textContent = 'Not refreshed';
      }
    }
    if (sheet.closed) return;
    show(lastTab);
    paintAge();
    // Ask again once the server's copy has gone stale (it reads the database again then).
    const wait = data ? Math.max(5_000, SERVER_CACHE_MS - data.age - (Date.now() - readAt) + 1_000) : 0;
    if (wait) again = window.setTimeout(() => void load(), wait);
  };

  show(lastTab);
  ticker = window.setInterval(paintAge, 1_000);
  void load();
  return { root: sheet.root, close: () => sheet.close() };
}
