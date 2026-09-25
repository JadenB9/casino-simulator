// The profile: a player's stats sheet, laid out like a sportsbook's account page. Key figures
// across the top (net worth, lifetime net, wagered, rounds, win rate), the last fourteen days'
// net as a bar chart beside the record (won, lost, biggest win and loss, streak, achievements),
// every game played in one sortable table, then your best leaderboard places, where your chips
// are and the loans you've taken.
//
// It draws from the session at once (balance, chips on tables, lifetime stats) and fills in from
// GET /stats and the leaderboards; /me refreshes the money and asks tables holding old escrows
// for their live stacks.

import './profile.css';
import type { Profile, LeaderboardResponse, StatsResponse } from '../../../../shared/src/protocol.ts';
import { CATALOG } from '../../../../shared/src/games/catalog.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { favouriteGame, formatRate, winRateBp } from '../../../../shared/src/stats.ts';
import type { GameId } from '../../../../shared/src/engine.ts';
import { el } from '../kit.ts';
import type { AccountApi, Closable, SessionLike } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { formatDate, formatDateTime, gameName, problemText, statTile } from '../menu/parts.ts';
import * as socialApi from '../social/api.ts';
import { placeOn } from '../social/leaderboard.ts';
import { boardText, boardsOf, ordinal } from '../stats/boards.ts';
import { dayLabel, dayTick, fortnight, gameRows, unplayed, type GameSort } from '../stats/figures.ts';

export interface ProfileDeps {
  root: HTMLElement;
  api: Pick<AccountApi, 'me'>;
  session: SessionLike;
  /** v6 stats6: your record and the boards (the social API unless the dev page stands in). */
  stats?: () => Promise<StatsResponse>;
  boards?: () => Promise<LeaderboardResponse>;
  onClose?(): void;
}

const DASH = '—';
const SVG = 'http://www.w3.org/2000/svg';

function td(text: string, cls = ''): HTMLTableCellElement {
  return el('td', cls, text);
}

function signed(amount: number): { text: string; cls: string } {
  return { text: formatMoney(amount, { sign: true }), cls: amount > 0 ? 'win' : amount < 0 ? 'lose' : '' };
}

function table(head: string[], cls = ''): { table: HTMLTableElement; body: HTMLTableSectionElement; foot: HTMLTableSectionElement; heads: HTMLTableCellElement[] } {
  const t = el('table', `data ${cls}`.trim());
  const thead = el('thead');
  const tr = el('tr');
  const heads = head.map((h) => el('th', '', h));
  tr.append(...heads);
  thead.append(tr);
  const body = el('tbody');
  const foot = el('tfoot');
  t.append(thead, body, foot);
  return { table: t, body, foot, heads };
}

function section(label: string, count?: string): HTMLElement {
  const h = el('h3', 'section-label', label);
  if (count !== undefined) h.append(el('span', 'count', count));
  return h;
}

const money0 = (v: number) => (v > 0 ? formatMoney(v) : DASH);

// ---------------------------------------------------------------------------------------------
// The fortnight chart

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, cls = ''): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (cls) e.setAttribute('class', cls);
  return e;
}

/** Fourteen bars around a zero line, today's outlined; each says its day and net on hover. */
function renderChart(days: StatsResponse['days']): HTMLElement {
  const f = fortnight(days);
  const wrap = el('div', 'pf-chart');
  const W = 560;
  const H = 196;
  const top = 8;
  const bottom = 30;
  const mid = top + (H - top - bottom) / 2;
  const half = (H - top - bottom) / 2;
  const slot = W / days.length;
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Net per day, last ${days.length} days` }, 'pf-svg');
  for (const frac of [-1, -0.5, 0.5, 1]) chart.append(svg('line', { x1: 0, x2: W, y1: mid - frac * half, y2: mid - frac * half }, 'pf-grid'));
  days.forEach((d, i) => {
    const h = (Math.abs(d.net) / f.scale) * half;
    const x = i * slot + slot * 0.18;
    const w = slot * 0.64;
    const today = i === days.length - 1;
    const bar = svg('rect', { x, y: d.net >= 0 ? mid - h : mid, width: w, height: Math.max(d.net === 0 ? 0 : 1.5, h), rx: 1.5 }, `pf-bar ${d.net > 0 ? 'up' : d.net < 0 ? 'down' : 'flat'}${today ? ' today' : ''}`);
    const tip = svg('title', {});
    tip.textContent = `${dayLabel(d.day)}: ${d.net === 0 ? 'no play or even' : formatMoney(d.net, { sign: true })}`;
    bar.append(tip);
    chart.append(bar);
    const [wd, date] = dayTick(d.day);
    const cx = i * slot + slot / 2;
    const t1 = svg('text', { x: cx, y: H - 16, 'text-anchor': 'middle' }, `pf-tick${today ? ' today' : ''}`);
    t1.textContent = wd;
    const t2 = svg('text', { x: cx, y: H - 3, 'text-anchor': 'middle' }, `pf-tick date${today ? ' today' : ''}`);
    t2.textContent = date;
    chart.append(t1, t2);
  });
  chart.append(svg('line', { x1: 0, x2: W, y1: mid, y2: mid }, 'pf-zero'));

  const head = el('div', 'pf-chart-head');
  const total = signed(f.total);
  const sum = el('span', `pf-chart-total ${total.cls}`.trim(), f.total === 0 ? '$0' : total.text);
  const facts = el('span', 'pf-chart-facts');
  const bits: string[] = [`${f.up} days up, ${f.down} down`];
  if (f.best) bits.push(`best ${formatMoney(f.best.net, { sign: true })} ${dayLabel(f.best.day).slice(0, -4)}`);
  if (f.worst) bits.push(`worst ${formatMoney(f.worst.net)} ${dayLabel(f.worst.day).slice(0, -4)}`);
  facts.textContent = bits.join(' · ');
  head.append(sum, facts);
  wrap.append(head, chart);
  return wrap;
}

// ---------------------------------------------------------------------------------------------
// The record, the games, the places

function recordList(s: StatsResponse): HTMLElement {
  const dl = el('dl', 'pf-record');
  const add = (label: string, value: string, cls = '') => {
    const row = el('div', 'pf-rec');
    row.append(el('dt', '', label), el('dd', cls, value));
    dl.append(row);
  };
  const t = s.total;
  add('Won, winning rounds', money0(t.won), t.won > 0 ? 'win' : '');
  add('Lost, losing rounds', t.lost > 0 ? formatMoney(-t.lost) : DASH, t.lost > 0 ? 'lose' : '');
  add('Biggest win', money0(t.biggestWin));
  add('Biggest loss', t.biggestLoss > 0 ? formatMoney(-t.biggestLoss) : DASH);
  add('Rounds won', t.counted > 0 ? `${t.wins.toLocaleString('en-US')} of ${t.counted.toLocaleString('en-US')}` : DASH);
  add('Longest streak', s.streak > 0 ? `${s.streak} in a row` : DASH);
  add('Achievements', String(s.feats));
  add('Celebrities met', String(s.celebs));
  add('Collection', money0(s.collection));
  return dl;
}

const SORTS: [GameSort, string][] = [
  ['game', 'Game'],
  ['rounds', 'Rounds'],
  ['rate', 'Win %'],
  ['wagered', 'Wagered'],
  ['net', 'Net'],
  ['won', 'Won'],
  ['lost', 'Lost'],
  ['best', 'Best'],
  ['worst', 'Worst'],
];

/** The sort the games table was left in, across openings. */
let gameSort: { by: GameSort; desc: boolean } = { by: 'rounds', desc: true };

function renderGames(s: StatsResponse): HTMLElement {
  const wrap = el('div', 'pf-games-wrap');
  const paint = () => {
    const { table: t, body, foot, heads } = table(SORTS.map(([, label]) => label), 'pf-games');
    heads.forEach((th, i) => {
      const [by] = SORTS[i]!;
      const b = el('button', 'pf-sort', th.textContent ?? '');
      b.type = 'button';
      th.textContent = '';
      th.append(b);
      if (gameSort.by === by) {
        th.setAttribute('aria-sort', gameSort.desc ? 'descending' : 'ascending');
        b.classList.add(gameSort.desc ? 'desc' : 'asc');
      }
      b.addEventListener('click', () => {
        gameSort = gameSort.by === by ? { by, desc: !gameSort.desc } : { by, desc: by !== 'game' };
        paint();
        wrap.querySelector<HTMLButtonElement>(`th:nth-child(${i + 1}) .pf-sort`)?.focus();
      });
    });
    const rows = gameRows(s, gameSort.by, gameSort.desc);
    for (const r of rows) {
      const l = r.line;
      const net = signed(l.net);
      const counted = l.counted > 0;
      const tr = el('tr');
      tr.append(
        td(CATALOG[r.game].name),
        td(l.rounds.toLocaleString('en-US')),
        td(r.rate === null ? DASH : formatRate(r.rate)),
        td(formatMoney(l.wagered)),
        td(net.text, net.cls),
        td(counted ? money0(l.won) : DASH),
        td(counted && l.lost > 0 ? formatMoney(-l.lost) : DASH),
        td(money0(l.biggestWin)),
        td(counted && l.biggestLoss > 0 ? formatMoney(-l.biggestLoss) : DASH),
      );
      body.append(tr);
    }
    const tot = s.total;
    const net = signed(tot.net);
    const tr = el('tr');
    tr.append(
      td('All games'),
      td(tot.rounds.toLocaleString('en-US')),
      td(tot.counted > 0 ? formatRate(winRateBp(tot.wins, tot.counted)) : DASH),
      td(formatMoney(tot.wagered)),
      td(net.text, net.cls),
      td(money0(tot.won)),
      td(tot.lost > 0 ? formatMoney(-tot.lost) : DASH),
      td(money0(tot.biggestWin)),
      td(tot.biggestLoss > 0 ? formatMoney(-tot.biggestLoss) : DASH),
    );
    foot.append(tr);
    if (rows.length === 0) {
      wrap.replaceChildren(el('p', 'quiet', 'No rounds played yet. Every game you play shows up here.'));
      return;
    }
    const scroll = el('div', 'pf-scroll');
    scroll.append(t);
    wrap.replaceChildren(scroll);
    const left = unplayed(s);
    wrap.append(
      el(
        'p',
        'pf-foot',
        `${left > 0 ? `${left} of the floor's games not played yet. ` : ''}Rounds, wagered, net and best cover every round you have played; win %, won, lost and worst count rounds since round-by-round records began.`,
      ),
    );
  };
  paint();
  return wrap;
}

/** Your five best places, casino-wide. */
function renderPlaces(boards: LeaderboardResponse | null, problem: string): HTMLElement {
  if (!boards) return el('p', 'quiet', problem || 'Reading the boards.');
  const places = boardsOf(null)
    .map((id) => ({ id, rank: placeOn(boards.boards[id]) }))
    .filter((p): p is { id: typeof p.id; rank: number } => p.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5);
  if (places.length === 0) return el('p', 'quiet', 'On no board yet.');
  const { table: t, body } = table(['Board', 'Place'], 'pf-places');
  for (const p of places) {
    const tr = el('tr', p.rank <= 10 ? 'top' : '');
    tr.append(td(boardText(p.id).name), td(ordinal(p.rank)));
    body.append(tr);
  }
  return t;
}

function renderTables(p: Profile): HTMLElement {
  if (p.tables.length === 0) return el('p', 'quiet', 'None. Everything you have is in your balance.');
  const { table: t, body } = table(['Table', 'Bought in', 'Stack now'], 'chips');
  for (const row of p.tables) {
    const tr = el('tr');
    const name = td(gameName(row.game));
    name.append(el('span', 'where', row.tableId.startsWith('solo:') ? 'Solo' : 'Lobby'));
    const stack = td(row.stack === undefined ? DASH : formatMoney(row.stack));
    if (row.stack === undefined) stack.title = 'The table reports its live stack after a couple of minutes.';
    tr.append(name, td(formatMoney(row.escrow)), stack);
    body.append(tr);
  }
  return t;
}

function renderLoans(p: Profile): HTMLElement {
  if (p.loans.length === 0) return el('p', 'quiet', 'No loans taken.');
  const wrap = el('div');
  const { table: t, body } = table(['Date', 'Amount'], 'loans');
  for (const l of p.loans) {
    const tr = el('tr');
    tr.append(td(formatDateTime(l.at)), td(formatMoney(l.amount)));
    body.append(tr);
  }
  wrap.append(t);
  if (p.loansTaken > p.loans.length) wrap.append(el('p', 'quiet', `Showing the latest ${p.loans.length}.`));
  return wrap;
}

// ---------------------------------------------------------------------------------------------

export function openProfile(deps: ProfileDeps): Closable {
  let off = () => {};
  const sheet = openSheet(deps.root, {
    title: deps.session.profile?.name ?? 'Profile',
    cls: 'profile-sheet',
    onClose: () => {
      off();
      deps.onClose?.();
    },
  });
  const title = sheet.panel.querySelector('.sheet-title')!;
  title.classList.add('name');
  let status = '';
  let stats: StatsResponse | null = null;
  let statsProblem = '';
  let boards: LeaderboardResponse | null = null;
  let boardsProblem = '';

  const render = (p: Profile | null) => {
    const scroll = sheet.body.scrollTop;
    sheet.body.replaceChildren();
    if (!p) {
      sheet.body.append(el('p', 'quiet', status && status !== 'Updating' ? status : 'Loading your profile.'));
      return;
    }
    title.textContent = p.name;
    sheet.sub.hidden = false;
    // The record, once it's here, is the fresher copy of the lifetime figures the session holds.
    const games = stats?.games ?? p.stats.games;
    const fav = favouriteGame(
      Object.fromEntries(Object.entries(games).map(([g, s]) => [g, s?.rounds ?? 0])),
      Object.keys(CATALOG) as GameId[],
    );
    sheet.sub.textContent = [`Member since ${formatDate(p.createdAt)}`, fav ? `Plays mostly ${CATALOG[fav].name}` : '', status].filter(Boolean).join(' · ');
    sheet.sub.classList.toggle('err', status !== '' && status !== 'Updating');

    // Key figures: the money from the session (live), the rest from the record.
    const tot = stats?.total ?? p.stats.total;
    const strip = el('div', 'stats pf-strip');
    const net = signed(tot.net);
    const netTile = statTile('Lifetime net', net.text);
    if (net.cls) netTile.value.classList.add(net.cls);
    const rate = stats && stats.total.counted > 0 ? formatRate(winRateBp(stats.total.wins, stats.total.counted)) : DASH;
    strip.append(
      statTile('Net worth', formatMoney(stats?.worth.total ?? p.balance + p.inPlay), 'lead').tile,
      statTile('Balance', formatMoney(p.balance)).tile,
      statTile('On tables', formatMoney(p.inPlay)).tile,
      netTile.tile,
      statTile('Wagered', formatMoney(tot.wagered)).tile,
      statTile('Rounds', tot.rounds.toLocaleString('en-US')).tile,
      statTile('Win rate', rate).tile,
    );
    sheet.body.append(strip);

    const upper = el('div', 'pf-upper');
    const chartCol = el('div', 'pf-col');
    const recCol = el('div', 'pf-col');
    chartCol.append(section('Last 14 days'));
    recCol.append(section('Record'));
    if (stats) {
      chartCol.append(renderChart(stats.days));
      recCol.append(recordList(stats));
    } else {
      const wait = el('p', `quiet${statsProblem ? ' pf-problem' : ''}`, statsProblem || 'Reading your record.');
      chartCol.append(wait);
      recCol.append(el('p', 'quiet', statsProblem ? DASH : ''));
    }
    upper.append(chartCol, recCol);
    sheet.body.append(upper);

    sheet.body.append(section('By game', stats ? String(gameRows(stats).length) : undefined));
    if (stats) sheet.body.append(renderGames(stats));
    else sheet.body.append(el('p', 'quiet', statsProblem ? DASH : 'Reading your record.'));

    const lower = el('div', 'pf-lower');
    const places = el('div', 'pf-col');
    places.append(section('Best places'), renderPlaces(boards, boardsProblem));
    const chips = el('div', 'pf-col');
    chips.append(section('Chips on tables', String(p.tables.length)), renderTables(p));
    const loans = el('div', 'pf-col');
    loans.append(section(`Loans taken: ${p.loansTaken}`), renderLoans(p));
    lower.append(places, chips, loans);
    sheet.body.append(lower);
    sheet.body.scrollTop = scroll;
  };

  off = deps.session.on((p) => render(p));
  status = 'Updating';
  render(deps.session.profile);
  deps.api
    .me()
    .then((p) => {
      status = '';
      if (sheet.closed) return;
      deps.session.set(p); // re-renders through the listener above
    })
    .catch((err) => {
      status = problemText(err);
      if (!sheet.closed) render(deps.session.profile);
    });
  (deps.stats ?? socialApi.stats)()
    .then((s) => (stats = s))
    .catch((err) => (statsProblem = problemText(err)))
    .finally(() => !sheet.closed && render(deps.session.profile));
  (deps.boards ?? (() => socialApi.leaderboard()))()
    .then((b) => (boards = b))
    .catch((err) => (boardsProblem = problemText(err)))
    .finally(() => !sheet.closed && render(deps.session.profile));

  return { root: sheet.root, close: () => sheet.close() };
}
