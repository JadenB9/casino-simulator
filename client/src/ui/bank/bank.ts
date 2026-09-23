// The cashier's window: what you have, where it is, and the bank's one rule. No countdowns, no
// offers, no "claim now": the loan is there when you have nothing left, and not before.

import './bank.css';
import type { Profile } from '../../../../shared/src/protocol.ts';
import { LOAN_AMOUNT, formatMoney } from '../../../../shared/src/money.ts';
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

/** Where the player stands with the bank, from the numbers alone. */
function standing(p: Profile): Note & { canAsk: boolean } {
  if (p.balance > 0) {
    return { text: `You have ${formatMoney(p.balance)} in your balance, so there is nothing to lend yet.`, kind: '', canAsk: false };
  }
  if (p.inPlay > 0) {
    // The bank asks those tables to settle first, so a stack that is really gone still qualifies.
    return { text: `${formatMoney(p.inPlay)} is still on tables. The bank lends once those chips are cashed out or lost.`, kind: '', canAsk: true };
  }
  return { text: `You have nothing left. The bank will lend you ${formatMoney(LOAN_AMOUNT)}.`, kind: 'ok', canAsk: true };
}

export function openBank(deps: BankDeps): Closable {
  let off = () => {};
  const sheet = openSheet(deps.root, {
    title: 'Cashier',
    subtitle: `Loans taken: ${deps.session.profile?.loansTaken ?? 0}`,
    cls: 'bank-sheet',
    onClose: () => {
      off();
      deps.onClose?.();
    },
  });

  const stats = el('div', 'stats bank-stats');
  const balance = statTile('Balance', '');
  const onTables = statTile('Chips on tables', '');
  const loans = statTile('Loans taken', '');
  stats.append(balance.tile, onTables.tile, loans.tile);

  const rule = el('p', 'bank-rule', `The bank lends ${formatMoney(LOAN_AMOUNT)} when you have nothing left, tables included.`);
  const terms = el('p', 'quiet bank-terms', 'Free, with nothing to repay. It is the only way to get more chips.');
  const where = el('div', 'bank-where');
  const status = el('p', 'bank-status');
  status.setAttribute('aria-live', 'polite');

  const take = el('button', 'btn primary bank-take', `Take ${formatMoney(LOAN_AMOUNT)} loan`);
  take.type = 'button';
  const done = el('button', 'btn ghost', 'Close');
  done.type = 'button';
  done.addEventListener('click', () => sheet.close());
  const foot = el('div', 'sheet-foot');
  foot.append(take, done);
  sheet.body.append(stats, rule, terms, where, status, foot);

  let busy = false;
  let note: Note | null = null; // the outcome of the last request, shown until the numbers change

  const render = (p: Profile | null) => {
    if (!p) return;
    balance.value.textContent = formatMoney(p.balance);
    onTables.value.textContent = formatMoney(p.inPlay);
    loans.value.textContent = String(p.loansTaken);
    sheet.sub.textContent = `Loans taken: ${p.loansTaken}`;
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
    take.hidden = p.balance > 0 && note?.kind === 'ok'; // just paid out: nothing more to ask for
  };

  take.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    note = null;
    take.textContent = 'Asking the bank';
    render(deps.session.profile);
    try {
      const r = await deps.api.takeLoan();
      note = { text: `Loan made: ${formatMoney(r.loan.amount)} is in your balance.`, kind: 'ok' };
      deps.sfx?.play('chips-stack', { volume: 0.6 });
      busy = false;
      take.textContent = `Take ${formatMoney(LOAN_AMOUNT)} loan`;
      deps.session.set(r.profile);
    } catch (err) {
      busy = false;
      take.textContent = `Take ${formatMoney(LOAN_AMOUNT)} loan`;
      const body = (err as { status?: number; body?: { error?: string; balance?: number; inPlay?: number } }).body;
      if (body?.error === 'NOT_ELIGIBLE') {
        const reason =
          (body.inPlay ?? 0) > 0
            ? `Not yet: ${formatMoney(body.inPlay!)} is still in chips on tables.`
            : (body.balance ?? 0) > 0
              ? `Not yet: you still have ${formatMoney(body.balance!)}.`
              : problemText(err);
        note = { text: reason, kind: 'err' };
        // The refusal carries the server's numbers; show them rather than what we thought.
        const p = deps.session.profile;
        if (p && body.balance !== undefined && body.inPlay !== undefined) deps.session.set({ ...p, balance: body.balance, inPlay: body.inPlay });
        else render(p);
      } else {
        note = { text: problemText(err), kind: 'err' };
        render(deps.session.profile);
      }
    }
  });

  off = deps.session.on(render);
  render(deps.session.profile);
  deps.api
    .me()
    .then((p) => !sheet.closed && deps.session.set(p))
    .catch(() => {
      /* the cached numbers stay up; a loan request reports its own problem */
    });

  return { root: sheet.root, close: () => sheet.close() };
}
