// The profile: money first (balance, chips on tables, net, rounds, loans), then every game's
// record, then where your chips are and the loans you've taken. It draws from the session at
// once and refreshes from /me, which also asks tables holding old escrows for their live stacks.

import './profile.css';
import type { GameStats, Profile } from '../../../../shared/src/protocol.ts';
import type { GameId } from '../../../../shared/src/engine.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { CATALOG, isGameId } from '../../../../shared/src/games/catalog.ts';
import { el } from '../kit.ts';
import type { AccountApi, Closable, SessionLike } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { formatDate, formatDateTime, gameName, problemText, statTile } from '../menu/parts.ts';

export interface ProfileDeps {
  root: HTMLElement;
  api: Pick<AccountApi, 'me'>;
  session: SessionLike;
  onClose?(): void;
}

const DASH = '—';

function td(text: string, cls = ''): HTMLTableCellElement {
  return el('td', cls, text);
}

function signed(amount: number): { text: string; cls: string } {
  return { text: formatMoney(amount, { sign: true }), cls: amount > 0 ? 'win' : amount < 0 ? 'lose' : '' };
}

function table(head: string[], cls = ''): { table: HTMLTableElement; body: HTMLTableSectionElement; foot: HTMLTableSectionElement } {
  const t = el('table', `data ${cls}`.trim());
  const thead = el('thead');
  const tr = el('tr');
  for (const h of head) tr.append(el('th', '', h));
  thead.append(tr);
  const body = el('tbody');
  const foot = el('tfoot');
  t.append(thead, body, foot);
  return { table: t, body, foot };
}

/** Games in catalog order: every game on the floor, plus any other game this player has a record in. */
function gameRows(p: Profile): [GameId, GameStats | undefined][] {
  const ids = (Object.keys(CATALOG) as GameId[]).filter((id) => !CATALOG[id].dev || p.stats.games[id]);
  for (const id of Object.keys(p.stats.games)) if (isGameId(id) && !ids.includes(id)) ids.push(id);
  return ids.map((id) => [id, p.stats.games[id]]);
}

function renderGames(p: Profile): HTMLElement {
  const { table: t, body, foot } = table(['Game', 'Rounds', 'Wagered', 'Net', 'Biggest win'], 'games');
  for (const [id, s] of gameRows(p)) {
    const tr = el('tr');
    if (!s || s.rounds === 0) {
      tr.className = 'none';
      tr.append(td(CATALOG[id].name), td(DASH), td(DASH), td(DASH), td(DASH));
    } else {
      const net = signed(s.net);
      tr.append(td(CATALOG[id].name), td(s.rounds.toLocaleString('en-US')), td(formatMoney(s.wagered)), td(net.text, net.cls), td(s.biggestWin > 0 ? formatMoney(s.biggestWin) : DASH));
    }
    body.append(tr);
  }
  const tot = p.stats.total;
  const net = signed(tot.net);
  const tr = el('tr');
  tr.append(td('All games'), td(tot.rounds.toLocaleString('en-US')), td(formatMoney(tot.wagered)), td(net.text, net.cls), td(tot.biggestWin > 0 ? formatMoney(tot.biggestWin) : DASH));
  foot.append(tr);
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

function section(label: string, count?: string): HTMLElement {
  const h = el('h3', 'section-label', label);
  if (count !== undefined) h.append(el('span', 'count', count));
  return h;
}

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

  const render = (p: Profile | null) => {
    sheet.body.replaceChildren();
    if (!p) {
      sheet.body.append(el('p', 'quiet', status && status !== 'Updating' ? status : 'Loading your profile.'));
      return;
    }
    title.textContent = p.name;
    sheet.sub.hidden = false;
    sheet.sub.textContent = `Member since ${formatDate(p.createdAt)}${status ? ` · ${status}` : ''}`;
    sheet.sub.classList.toggle('err', status !== '' && status !== 'Updating');

    const tot = p.stats.total;
    const summary = el('div', 'stats profile-stats');
    const net = signed(tot.net);
    const netTile = statTile('Net, all games', net.text);
    if (net.cls) netTile.value.classList.add(net.cls);
    summary.append(
      statTile('Balance', formatMoney(p.balance)).tile,
      statTile('Chips on tables', formatMoney(p.inPlay)).tile,
      netTile.tile,
      statTile('Rounds', tot.rounds.toLocaleString('en-US')).tile,
      statTile('Loans taken', String(p.loansTaken)).tile,
    );

    const cols = el('div', 'profile-cols');
    const left = el('div', 'profile-main');
    left.append(section('Games'), renderGames(p));
    const right = el('div', 'profile-side');
    right.append(section('Chips on tables', String(p.tables.length)), renderTables(p));
    right.append(section(`Loans taken: ${p.loansTaken}`), renderLoans(p));
    cols.append(left, right);
    sheet.body.append(summary, cols);
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

  return { root: sheet.root, close: () => sheet.close() };
}
