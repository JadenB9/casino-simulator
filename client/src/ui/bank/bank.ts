// The cashier's window: what you have, where it is, and the bank's one rule. No countdowns, no
// offers, no "claim now": under $10,000 in all, the bank tops you up to $50,000, as often as
// that happens, and not before.

import './bank.css';
import type { Profile } from '../../../../shared/src/protocol.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { REFILL_BELOW, REFILL_TO, notYet, refillFor } from '../../../../shared/src/bank.ts';
import { el } from '../kit.ts';
import type { AccountApi, Closable, SessionLike, SfxLike } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { gameName, problemText, statTile } from '../menu/parts.ts';

export interface BankDeps {
  root: HTMLElement;
  api: Pick<AccountApi, 'me' | 'takeLoan'>;
  session: SessionLike;
  onClose?(): void;
  sfx?: Pick<SfxLike, 'play'>;
}

type Note = { text: string; kind: '' | 'ok' | 'err' };

/**
 * Chips on tables as far as this client knows: a table's live stack where the server reported
 * one, otherwise what went in. `sure` is false when any table is only known by what went in.
 */
function onTables(p: Profile): { chips: Cents; sure: boolean } {
  let chips = 0;
  let sure = true;
  for (const t of p.tables) {
    if (t.stack === undefined) sure = false;
    chips += t.stack ?? t.escrow;
  }
  return { chips, sure };
}

/** Where the player stands with the bank, from the numbers alone. The server has the last word. */
function standing(p: Profile): Note & { canAsk: boolean } {
  const { chips, sure } = onTables(p);
  const total = p.balance + chips;
  // Over the line on the balance alone: nothing on any table can change that.
  if (p.balance >= REFILL_BELOW) return { text: notYet(total, chips), kind: '', canAsk: false };
  if (!sure) {
    // The bank asks each table what those chips are worth now, so let the player ask.
    return { text: `${formatMoney(chips)} went onto tables. The bank counts those chips at what they are worth now when you ask.`, kind: '', canAsk: true };
  }
  const add = refillFor(total);
  if (add === 0) return { text: notYet(total, chips), kind: '', canAsk: false };
  return { text: `You have ${formatMoney(total)} in all. The bank will add ${formatMoney(add)}.`, kind: 'ok', canAsk: true };
}

const TAKE = `Top up to ${formatMoney(REFILL_TO)}`;

export function openBank(deps: BankDeps): Closable {
  let off = () => {};
  const sheet = openSheet(deps.root, {
    title: 'Cashier',
    cls: 'bank-sheet',
    onClose: () => {
      off();
      deps.onClose?.();
    },
  });

  const stats = el('div', 'stats bank-stats');
  const balance = statTile('Balance', '');
  const tables = statTile('Chips on tables', '');
  const loans = statTile('Loans taken', '');
  stats.append(balance.tile, tables.tile, loans.tile);

  // Two lines, like the sign over a cage window: the question, then the answer.
  const rule = el('p', 'bank-rule');
  rule.append(el('span', '', `Under ${formatMoney(REFILL_BELOW)} in all?`), document.createTextNode(' '), el('span', '', `The bank tops you up to ${formatMoney(REFILL_TO)}.`));
  const terms = el('p', 'quiet bank-terms', 'Your balance and every chip on every table count. Free, with nothing to repay, as often as you need it.');
  const where = el('div', 'bank-where');
  const status = el('p', 'bank-status');
  status.setAttribute('aria-live', 'polite');

  const take = el('button', 'btn primary bank-take', TAKE);
  take.type = 'button';
  const done = el('button', 'btn ghost', 'Close');
  done.type = 'button';
  done.addEventListener('click', () => sheet.close());
  const foot = el('div', 'sheet-foot');
  foot.append(take, done);
  sheet.body.append(stats, rule, terms, where, status, foot);

  let busy = false;
  let note: Note | null = null; // the outcome of the last request, shown until the next one

  const render = (p: Profile | null) => {
    if (!p) return;
    balance.value.textContent = formatMoney(p.balance);
    tables.value.textContent = formatMoney(onTables(p).chips);
    loans.value.textContent = String(p.loansTaken);
    where.replaceChildren();
    for (const t of p.tables) {
      const row = el('div', 'bank-table');
      row.append(el('span', '', gameName(t.game)), el('span', 'money', t.stack === undefined ? `${formatMoney(t.escrow)} bought in` : `${formatMoney(t.stack)} stack`));
      where.append(row);
    }
    const s = standing(p);
    const show = note ?? s;
    status.textContent = show.text;
    status.className = `bank-status ${show.kind}`.trim();
    take.disabled = busy || !s.canAsk;
    take.hidden = note?.kind === 'ok'; // just topped up: nothing more to ask for
  };

  const refresh = () =>
    deps.api
      .me()
      .then((p) => !sheet.closed && deps.session.set(p))
      .catch(() => {
        /* the cached numbers stay up; the next request reports its own problem */
      });

  take.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    note = null;
    take.textContent = 'Asking the bank';
    render(deps.session.profile);
    try {
      const r = await deps.api.takeLoan();
      note = { text: `Loan made: ${formatMoney(r.loan.amount)} is in your balance, which makes ${formatMoney(REFILL_TO)} in all.`, kind: 'ok' };
      deps.sfx?.play('chips-stack', { volume: 0.6 });
      busy = false;
      take.textContent = TAKE;
      deps.session.set(r.profile);
    } catch (err) {
      busy = false;
      take.textContent = TAKE;
      // The refusal says what the bank counted (or that chips were still moving); the fresh
      // profile brings the numbers on the tiles up to date.
      const code = (err as { body?: { error?: unknown } }).body?.error;
      note = { text: problemText(err), kind: code === 'BUSY' ? '' : 'err' };
      render(deps.session.profile);
      void refresh();
    }
  });

  off = deps.session.on(render);
  render(deps.session.profile);
  void refresh();

  return { root: sheet.root, close: () => sheet.close() };
}
