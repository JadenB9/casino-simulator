// The leaderboards: every board in a list down the left (money, play, today and this week), with
// your own place beside each name, and the chosen board on the right: the top ten with your row
// lit, and your place underneath when you're further down. A picker above switches to one game's
// boards. The server reads the boards at most once a minute; the sheet says how long ago, and
// asks again once they're older than that.

import './social.css';
import type { GameId } from '../../../../shared/src/engine.ts';
import { CATALOG } from '../../../../shared/src/games/catalog.ts';
import type { Leaderboard, LeaderboardId, LeaderboardResponse } from '../../../../shared/src/protocol.ts';
import { button, el } from '../kit.ts';
import type { Closable } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { problemText } from '../menu/parts.ts';
import { GAME_GROUPS, GROUPS, boardText, boardsOf, formatValue, ordinal, pickableGames, refreshedText, valueTone } from '../stats/boards.ts';

export { refreshedText };

export interface LeaderboardApi {
  leaderboard(game?: GameId | null): Promise<LeaderboardResponse>;
}

export interface LeaderboardDeps {
  root: HTMLElement;
  /** `import * as socialApi from '../ui/social/api.ts'`, or canned boards on the dev page. */
  api: LeaderboardApi;
  /** Open on this game's boards (a table's own), rather than where the sheet was left. */
  game?: GameId | null;
  onClose?(): void;
}

/** The boards the server keeps are read again after this long (server/src/leaderboard.ts). */
const SERVER_CACHE_MS = 60_000;
const DASH = '—';

/** Where the sheet was left: the scope, and the board looked at in each scope. */
let lastGame: GameId | null = null;
const lastBoard = new Map<GameId | null, LeaderboardId>();

/** The asker's place on a board: in the top ten, below it, or nowhere yet. */
export function placeOn(board: Leaderboard | undefined): number | null {
  if (!board) return null;
  const top = board.top.find((r) => r.you);
  if (top) return top.rank;
  return board.you?.rank ?? null;
}

function row(rank: number | null, name: string, value: string, tone: string, of: string | null, cls: string, you: boolean): HTMLTableRowElement {
  const tr = el('tr', cls);
  const who = el('td', 'lb-name', name);
  if (you) who.append(el('span', 'lb-you', 'You'));
  tr.append(el('td', 'lb-rank', rank === null ? DASH : String(rank)), who);
  if (of !== null) tr.append(el('td', 'lb-of', of));
  tr.append(el('td', `lb-value ${tone}`.trim(), value));
  return tr;
}

function renderBoard(id: LeaderboardId, game: GameId | null, board: Leaderboard): HTMLElement {
  const text = boardText(id, game);
  const wrap = el('div', 'lb-board');
  const head = el('div', 'lb-head');
  head.append(el('h3', 'lb-title', text.name), el('p', 'lb-note', text.note));
  wrap.append(head);
  if (board.top.length === 0 && !board.you) {
    wrap.append(el('p', 'quiet', text.empty));
    return wrap;
  }
  const rate = text.unit === 'rate';
  const table = el('table', `data lb-table${rate ? ' rate' : ''}`);
  const tr = el('tr');
  tr.append(el('th', 'lb-rank', '#'), el('th', 'lb-name', 'Player'));
  if (rate) tr.append(el('th', 'lb-of', 'Rounds'));
  tr.append(el('th', 'lb-value', text.column));
  const thead = el('thead');
  thead.append(tr);
  const body = el('tbody');
  const cells = (v: number, of?: number) => [formatValue(text.unit, v), valueTone(text.unit, v), rate ? (of ?? 0).toLocaleString('en-US') : null] as const;
  for (const r of board.top) {
    const cls = [r.rank <= 3 ? `podium p${r.rank}` : '', r.you ? 'you' : ''].filter(Boolean).join(' ');
    const [v, tone, of] = cells(r.value, r.of);
    body.append(row(r.rank, r.name, v, tone, of, cls, !!r.you));
  }
  const you = board.you;
  if (you) {
    // Your own place, set apart from the ten above it.
    if (board.top.length > 0) {
      const gap = el('tr', 'lb-gap');
      const cell = el('td', '', '');
      cell.colSpan = rate ? 4 : 3;
      gap.append(cell);
      body.append(gap);
    }
    const [v, tone, of] = you.rank === null ? [DASH, '', rate ? DASH : null] : cells(you.value, you.of);
    body.append(row(you.rank, you.name, v, tone, of, 'you', true));
  }
  table.append(thead, body);
  wrap.append(table);
  if (board.top.length === 0) wrap.append(el('p', 'quiet', text.empty));
  if (you && you.rank === null) wrap.append(el('p', 'quiet lb-foot', text.unplaced));
  return wrap;
}

/** The scope picker: every game's own boards, or the casino's. A native select (keyboard, phones). */
function scopePicker(onPick: (g: GameId | null) => void): HTMLSelectElement {
  const sel = el('select', 'lb-scope');
  sel.setAttribute('aria-label', 'Boards for');
  const all = el('option', '', 'Whole casino');
  all.value = '';
  sel.append(all);
  const { tables, online } = pickableGames();
  for (const [label, games] of [['Tables and machines', tables], ['Online', online]] as const) {
    const group = el('optgroup');
    group.label = label;
    for (const g of games) {
      const o = el('option', '', CATALOG[g].name);
      o.value = g;
      group.append(o);
    }
    sel.append(group);
  }
  sel.addEventListener('change', () => onPick((sel.value || null) as GameId | null));
  return sel;
}

export function openLeaderboard(deps: LeaderboardDeps): Closable {
  let ticker = 0;
  let again = 0;
  if (deps.game !== undefined) lastGame = deps.game && !CATALOG[deps.game].dev ? deps.game : null;
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

  const bar = el('div', 'lb-bar');
  const picker = scopePicker((g) => {
    lastGame = g;
    build();
    paintPlaces();
    paintAge();
    void load();
  });
  const pickLabel = el('label', 'lb-scope-label', 'Boards for');
  pickLabel.append(picker);
  bar.append(pickLabel);

  // The list of boards: one tab stop, arrows move between them (and show each as they go).
  const nav = el('div', 'lb-nav');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-orientation', 'vertical');
  nav.setAttribute('aria-label', 'Leaderboards');
  const panel = el('div', 'lb-panel');
  panel.setAttribute('role', 'tabpanel');
  panel.id = `lb-panel-${Math.random().toString(36).slice(2, 8)}`;
  const cols = el('div', 'lb-cols');
  cols.append(nav, panel);
  sheet.body.append(bar, cols);

  const items = new Map<LeaderboardId, { btn: HTMLButtonElement; place: HTMLElement }>();
  const scopes = new Map<GameId | null, { data: LeaderboardResponse; readAt: number }>();
  let problem = '';

  const current = (): LeaderboardId => {
    const ids = boardsOf(lastGame);
    const b = lastBoard.get(lastGame);
    return b && ids.includes(b) ? b : ids[0]!;
  };

  /** The list for the current scope, grouped. */
  const build = () => {
    picker.value = lastGame ?? '';
    nav.replaceChildren();
    items.clear();
    for (const g of lastGame ? GAME_GROUPS : GROUPS) {
      nav.append(el('div', 'lb-group', g.label));
      for (const id of g.boards) {
        const btn = el('button', 'lb-item');
        btn.type = 'button';
        btn.id = `${panel.id}-${id}`;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-controls', panel.id);
        const place = el('span', 'lb-place', '');
        btn.append(el('span', 'lb-item-name', boardText(id, lastGame).name), place);
        btn.addEventListener('click', () => show(id));
        items.set(id, { btn, place });
        nav.append(btn);
      }
    }
    show(current());
  };

  nav.addEventListener('keydown', (e) => {
    const ids = [...items.keys()];
    const i = ids.indexOf(current());
    const n = ids.length;
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    const prev = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
    const to = next ? (i + 1) % n : prev ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    show(ids[to]!);
    items.get(ids[to]!)!.btn.focus();
  });

  const paintAge = () => {
    const s = scopes.get(lastGame);
    if (s) sheet.sub.textContent = refreshedText(s.data.age + (Date.now() - s.readAt));
  };

  /** Your place beside each board's name. */
  const paintPlaces = () => {
    const data = scopes.get(lastGame)?.data;
    for (const [id, { place }] of items) {
      const p = data ? placeOn(data.boards[id]) : null;
      place.textContent = data ? (p === null ? DASH : ordinal(p)) : '';
      place.classList.toggle('top', p !== null && p <= 10);
    }
  };

  const show = (id: LeaderboardId) => {
    lastBoard.set(lastGame, id);
    for (const [bid, { btn }] of items) {
      const on = bid === id;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', items.get(id)!.btn.id);
    const data = scopes.get(lastGame)?.data;
    const board = data?.boards[id];
    if (board) {
      panel.replaceChildren(renderBoard(id, lastGame, board));
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
    const game = lastGame;
    problem = '';
    if (!scopes.has(game)) {
      sheet.sub.textContent = 'Loading';
      show(current());
    }
    try {
      scopes.set(game, { data: await deps.api.leaderboard(game), readAt: Date.now() });
    } catch (err) {
      // With boards already showing, keep them and try again later; the age says how old they are.
      if (!scopes.has(game)) {
        problem = problemText(err);
        if (game === lastGame) sheet.sub.textContent = 'Not refreshed';
      }
    }
    // Picked another game while this one was loading: that load paints instead.
    if (sheet.closed || game !== lastGame) return;
    show(current());
    paintPlaces();
    paintAge();
    // Ask again once the server's copy has gone stale (it reads the database again then).
    const s = scopes.get(game);
    const wait = s ? Math.max(5_000, SERVER_CACHE_MS - s.data.age - (Date.now() - s.readAt) + 1_000) : 0;
    if (wait) again = window.setTimeout(() => void load(), wait);
  };

  build();
  ticker = window.setInterval(paintAge, 1_000);
  void load();
  return { root: sheet.root, close: () => sheet.close() };
}
