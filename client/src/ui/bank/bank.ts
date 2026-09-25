// The bank at the cage: a private bank's app in the teller's window. Accounts down the left
// (checking, savings, term deposits, the Casino Index) with what's in each, then Transfer and
// Statement; the chosen one fills the right. Checking keeps the cashier's one rule: under $10,000
// in all, the bank tops you up to $50,000, as often as that happens, and not before. No
// countdowns, no offers, no "claim now": numbers, rates and what each thing does.

import './bank.css';
import type { Profile, ProfileBank } from '../../../../shared/src/protocol.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import {
  DEPOSIT_CAP, DEPOSIT_MAX_OPEN, DEPOSIT_MIN, EARLY_FEE_PPM, FUND_DAY_DRIFT, FUND_DAY_VOL, FUND_MIN, FUND_NAME, INTEREST_DEN, REFILL_BELOW, REFILL_TO, SAVINGS_TIERS,
  SEND, TERMS, accrue, depositInterest, earlyFee, formatPrice, formatUnits, nextPayday, notYet, refillFor, type BankState, type DepositView, type MarketResponse,
  type Received, type StatementLine, type TermId,
} from '../../../../shared/src/bank.ts';
import { el, modal } from '../kit.ts';
import type { AccountApi, Closable, SessionLike, SfxLike } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { formatDateTime, gameName, problemText, segmented, statTile } from '../menu/parts.ts';
import * as realBank from './api.ts';
import type { BankApi } from './api.ts';
import { PriceChart } from './chart.ts';
import { describe, lineAmount, parseDollars, percent, termLabel, until } from './words.ts';

export type BankPane = 'checking' | 'savings' | 'deposits' | 'fund' | 'send' | 'statement';

export interface BankDeps {
  root: HTMLElement;
  api: Pick<AccountApi, 'me' | 'takeLoan'>;
  session: SessionLike;
  onClose?(): void;
  sfx?: Pick<SfxLike, 'play'>;
  /** v6 bank6: the bank's calls (the real ones unless a dev page brings stand-ins). */
  bank?: BankApi;
  /** Which account opens first. */
  start?: BankPane;
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

/** Savings, deposits and the fund, from the bank's own figures when we have them. */
function inBank(p: Profile, s: BankState | null): Cents {
  if (s) return s.savings.balance + s.deposits.filter((d) => d.closedAt === undefined).reduce((t, d) => t + d.principal, 0) + s.fund.value;
  return p.bank ? p.bank.savings + p.bank.deposits + p.bank.fundValue : 0;
}

/** Where the player stands with the cashier, from the numbers alone. The server has the last word. */
function standing(p: Profile, s: BankState | null): Note & { canAsk: boolean } {
  const { chips, sure } = onTables(p);
  const banked = inBank(p, s);
  const total = p.balance + chips + banked;
  // Over the line without the tables: nothing on any table can change that.
  if (p.balance + banked >= REFILL_BELOW) return { text: notYet(total, chips, banked), kind: '', canAsk: false };
  if (!sure) {
    // The bank asks each table what those chips are worth now, so let the player ask.
    return { text: `${formatMoney(chips)} went onto tables. The bank counts those chips at what they are worth now when you ask.`, kind: '', canAsk: true };
  }
  const add = refillFor(total);
  if (add === 0) return { text: notYet(total, chips, banked), kind: '', canAsk: false };
  return { text: `You have ${formatMoney(total)} in all. The bank will add ${formatMoney(add)}.`, kind: 'ok', canAsk: true };
}

const TAKE = `Top up to ${formatMoney(REFILL_TO)}`;
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const shortFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Interest earned since midnight and not paid yet, in dollars to four places (it ticks). */
function accruedText(s: BankState, now: number): string {
  const st = accrue(s.savings, Math.max(now, s.savings.since)).state;
  const cents = st.accrued + st.frac / INTEREST_DEN;
  return `$${(cents / 100).toFixed(4)}`;
}

/** The bank's figures on the profile, so the HUD and the profile agree with the bank at once. */
function profileBank(s: BankState): ProfileBank {
  const deposits = s.deposits.filter((d) => d.closedAt === undefined).reduce((t, d) => t + d.principal, 0);
  return { savings: s.savings.balance, deposits, fundCost: s.fund.cost, fundValue: s.fund.value, gain: s.gain, worth: s.worth };
}

interface Field {
  root: HTMLElement;
  input: HTMLInputElement;
  value(): Cents | null;
  set(c: Cents): void;
}

function amountField(label: string, id: string): Field {
  const root = el('label', 'bank-field');
  root.htmlFor = id;
  const input = el('input', 'bank-input money');
  input.id = id;
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.placeholder = '0.00';
  const box = el('span', 'bank-input-box');
  box.append(el('span', 'bank-dollar', '$'), input);
  root.append(el('span', 'field-label', label), box);
  return {
    root,
    input,
    value: () => parseDollars(input.value),
    set(c) {
      input.value = (c / 100).toFixed(2);
      input.dispatchEvent(new Event('input'));
    },
  };
}

function textField(label: string, id: string, max: number, placeholder = ''): { root: HTMLElement; input: HTMLInputElement } {
  const root = el('label', 'bank-field');
  root.htmlFor = id;
  const input = el('input', 'bank-input');
  input.id = id;
  input.type = 'text';
  input.maxLength = max;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = placeholder;
  const box = el('span', 'bank-input-box');
  box.append(input);
  root.append(el('span', 'field-label', label), box);
  return { root, input };
}

function btn(label: string, cls = ''): HTMLButtonElement {
  const b = el('button', `btn ${cls}`.trim(), label);
  b.type = 'button';
  return b;
}

/** "Checking  $1,200.00" under a field; clicking fills the field with it. */
function fill(label: string, field: Field, amount: () => Cents): { b: HTMLButtonElement; paint(): void } {
  const b = el('button', 'bank-fill');
  b.type = 'button';
  b.addEventListener('click', () => field.set(amount()));
  const paint = () => b.replaceChildren(el('span', '', label), el('span', 'money', formatMoney(amount())));
  paint();
  return { b, paint };
}

function status(): { root: HTMLElement; show(n: Note | null): void } {
  const root = el('p', 'bank-status');
  root.setAttribute('aria-live', 'polite');
  root.hidden = true;
  return {
    root,
    show(n) {
      root.hidden = !n;
      root.textContent = n?.text ?? '';
      root.className = `bank-status ${n?.kind ?? ''}`.trim();
    },
  };
}

interface Pane {
  root: HTMLElement;
  paint(s: BankState): void;
  tick?(now: number): void;
  shown?(): void;
  destroy?(): void;
}

export function openBank(deps: BankDeps): Closable {
  const bank = deps.bank ?? realBank;
  let off = () => {};
  let timer = 0;
  let state: BankState | null = null;
  /** Server time less ours, so the ticking figures match the server's clock. */
  let skew = 0;
  const panes = new Map<BankPane, Pane>();
  const sheet = openSheet(deps.root, {
    title: 'Bank',
    subtitle: ' ',
    cls: 'bank-sheet',
    onClose: () => {
      off();
      clearInterval(timer);
      for (const p of panes.values()) p.destroy?.();
      deps.onClose?.();
    },
  });

  // --- the rail: accounts with what's in them, then the two services -------------------------
  const rail = el('nav', 'bank-rail');
  rail.setAttribute('aria-label', 'Accounts');
  const railItems = new Map<BankPane, { b: HTMLButtonElement; amount: HTMLElement }>();
  const railItem = (id: BankPane, label: string, withAmount: boolean) => {
    const b = el('button', 'bank-rail-item');
    b.type = 'button';
    const amount = el('span', 'bank-rail-amount money');
    b.append(el('span', 'bank-rail-label', label));
    if (withAmount) b.append(amount);
    b.addEventListener('click', () => show(id));
    railItems.set(id, { b, amount });
    return b;
  };
  rail.append(
    el('div', 'bank-rail-head', 'Accounts'),
    railItem('checking', 'Checking', true),
    railItem('savings', 'Savings', true),
    railItem('deposits', 'Term deposits', true),
    railItem('fund', FUND_NAME, true),
    el('div', 'bank-rail-head', 'Services'),
    railItem('send', 'Send money', false),
    railItem('statement', 'Statement', false),
  );
  const main = el('div', 'bank-main');
  const wrap = el('div', 'bank-wrap');
  wrap.append(rail, main);
  // until the bank answers (a class of its own: the panes' lines are .bank-status)
  const loading = el('p', 'bank-loading quiet', 'Opening your accounts.');
  sheet.body.append(wrap);

  const now = () => Date.now() + skew;

  const setState = (s: BankState) => {
    state = s;
    skew = s.now - Date.now();
    loading.remove();
    const p = deps.session.profile;
    if (p && (p.balance !== s.balance || p.rev !== s.rev || p.bank?.worth !== s.worth || p.bank?.gain !== s.gain)) {
      deps.session.set({ ...p, balance: s.balance, inPlay: s.inPlay, rev: Math.max(p.rev, s.rev), bank: profileBank(s) });
    }
    sheet.sub.textContent = `Net worth ${formatMoney(s.worth)}`;
    const open = s.deposits.filter((d) => d.closedAt === undefined).reduce((t, d) => t + d.principal, 0);
    railItems.get('checking')!.amount.textContent = formatMoney(s.balance);
    railItems.get('savings')!.amount.textContent = formatMoney(s.savings.balance);
    railItems.get('deposits')!.amount.textContent = formatMoney(open);
    railItems.get('fund')!.amount.textContent = formatMoney(s.fund.value);
    const inbox = railItems.get('send')!.b;
    inbox.classList.toggle('has-news', s.inbox.length > 0);
    for (const pane of panes.values()) pane.paint(s);
  };

  const refresh = () =>
    bank
      .bank()
      .then((s) => !sheet.closed && setState(s))
      .catch((err) => {
        if (state) return;
        loading.textContent = problemText(err);
        loading.classList.add('err');
      });

  /** Run a bank operation from a button: the button waits, the pane's line says how it went. */
  const act = async (button: HTMLButtonElement, line: ReturnType<typeof status>, run: () => Promise<BankState>, done: (s: BankState) => string) => {
    if (button.disabled) return;
    const label = button.textContent;
    button.disabled = true;
    line.show(null);
    try {
      const s = await run();
      setState(s);
      line.show({ text: done(s), kind: 'ok' });
      deps.sfx?.play('chips-stack', { volume: 0.5 });
    } catch (err) {
      line.show({ text: problemText(err), kind: 'err' });
      void refresh();
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  };

  // --- checking ------------------------------------------------------------------------------
  const checking = (): Pane => {
    const root = el('section', 'bank-pane');
    const stats = el('div', 'stats bank-stats');
    const bal = statTile('Balance', '');
    const tables = statTile('Chips on tables', '');
    const loans = statTile('Loans taken', '');
    stats.append(bal.tile, tables.tile, loans.tile);
    const inbox = el('div', 'bank-inbox');
    // Two lines, like the sign over a cage window: the question, then the answer.
    const rule = el('p', 'bank-rule');
    rule.append(el('span', '', `Under ${formatMoney(REFILL_BELOW)} in all?`), document.createTextNode(' '), el('span', '', `The bank tops you up to ${formatMoney(REFILL_TO)}.`));
    const terms = el(
      'p',
      'quiet bank-terms',
      'Your balance, every chip on every table and everything in the bank count, and so does money you sent other players in the last three days. Free, with nothing to repay, as often as you need it.',
    );
    const where = el('div', 'bank-where');
    const line = el('p', 'bank-status');
    line.setAttribute('aria-live', 'polite');
    const take = btn(TAKE, 'primary bank-take');
    const foot = el('div', 'sheet-foot');
    foot.append(take);
    root.append(stats, inbox, rule, terms, where, line, foot);

    let busy = false;
    let note: Note | null = null;
    const render = (p: Profile | null) => {
      if (!p) return;
      bal.value.textContent = formatMoney(p.balance);
      tables.value.textContent = formatMoney(onTables(p).chips);
      loans.value.textContent = String(p.loansTaken);
      where.replaceChildren();
      for (const t of p.tables) {
        const row = el('div', 'bank-table');
        row.append(el('span', '', gameName(t.game)), el('span', 'money', t.stack === undefined ? `${formatMoney(t.escrow)} bought in` : `${formatMoney(t.stack)} stack`));
        where.append(row);
      }
      const s = standing(p, state);
      const shown = note ?? s;
      line.textContent = shown.text;
      line.className = `bank-status ${shown.kind}`.trim();
      take.disabled = busy || !s.canAsk;
      take.hidden = note?.kind === 'ok';
    };
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
        void refresh();
      } catch (err) {
        busy = false;
        take.textContent = TAKE;
        // The refusal says what the bank counted (or that chips were still moving).
        const code = (err as { body?: { error?: unknown } }).body?.error;
        note = { text: problemText(err), kind: code === 'BUSY' ? '' : 'err' };
        render(deps.session.profile);
        void deps.api.me().then((p) => !sheet.closed && deps.session.set(p)).catch(() => {});
      }
    });
    off = deps.session.on(render);
    render(deps.session.profile);
    void deps.api.me().then((p) => !sheet.closed && deps.session.set(p)).catch(() => {});
    return {
      root,
      paint(s) {
        paintInbox(inbox, s.inbox);
        render(deps.session.profile);
      },
    };
  };

  /** Money other players sent since you last looked; looking counts as seen. */
  const paintInbox = (box: HTMLElement, list: Received[]) => {
    box.replaceChildren();
    if (list.length === 0) return;
    box.append(el('div', 'bank-sub', 'Received'));
    for (const r of list) {
      const row = el('div', 'bank-inbox-row');
      const who = el('span', 'bank-inbox-who', `From ${r.from}`);
      if (r.note) who.append(el('span', 'bank-note', r.note));
      row.append(who, el('span', 'money win', formatMoney(r.amount, { sign: true })), el('span', 'quiet bank-when', shortFmt.format(r.at)));
      box.append(row);
    }
    const newest = Math.max(...list.map((r) => r.at));
    void bank.seen(newest).catch(() => {});
  };

  // --- savings -------------------------------------------------------------------------------
  const savingsPane = (): Pane => {
    const root = el('section', 'bank-pane');
    const big = el('div', 'bank-big money');
    const earning = el('p', 'bank-earning');
    const earningNow = el('span', 'money bank-ticking');
    const tiers = el('div', 'bank-tiers');
    let from = 0;
    for (const t of SAVINGS_TIERS) {
      const row = el('div', 'bank-tier');
      row.append(el('span', '', from === 0 ? `First ${formatMoney(t.upTo)}` : `${formatMoney(from)} to ${formatMoney(t.upTo)}`), el('span', 'money', `${percent(t.bp, 10_000)} a day`));
      tiers.append(row);
      from = t.upTo;
    }
    const above = el('div', 'bank-tier');
    above.append(el('span', '', `Above ${formatMoney(from)}`), el('span', 'money', 'nothing'));
    tiers.append(above);
    const field = amountField('Amount', 'bank-sav-amt');
    const fills = el('div', 'bank-fills');
    const fromChecking = fill('Checking', field, () => state?.balance ?? 0);
    const fromSavings = fill('Savings', field, () => state?.savings.balance ?? 0);
    fills.append(fromChecking.b, fromSavings.b);
    const line = status();
    const put = btn('Deposit', 'primary');
    const takeOut = btn('Withdraw');
    const row = el('div', 'bank-actions');
    row.append(put, takeOut);
    const earned = el('p', 'quiet bank-terms');
    root.append(
      el('div', 'bank-sub', 'Savings balance'),
      big,
      earning,
      field.root,
      fills,
      row,
      line.root,
      el('div', 'bank-sub', 'Rates'),
      tiers,
      el('p', 'quiet bank-terms', 'Simple interest by the millisecond on what the account holds, paid in at midnight UTC each day. Paid interest earns from then on. Moving money in and out earns only for the time it stays.'),
      earned,
    );
    const run = (dir: 'in' | 'out', b: HTMLButtonElement) => {
      const amount = field.value();
      if (!amount) return line.show({ text: 'Type an amount in dollars.', kind: 'err' });
      void act(b, line, () => bank.savings(dir, amount), () => `${formatMoney(amount)} ${dir === 'in' ? 'moved to savings' : 'moved to checking'}.`).then(() => {
        field.input.value = '';
      });
    };
    put.addEventListener('click', () => run('in', put));
    takeOut.addEventListener('click', () => run('out', takeOut));
    return {
      root,
      paint(s) {
        big.textContent = formatMoney(s.savings.balance);
        fromChecking.paint();
        fromSavings.paint();
        earned.textContent = `Interest paid in all: ${formatMoney(s.savings.earned)}.`;
        this.tick!(now());
      },
      tick(t) {
        if (!state) return;
        earning.replaceChildren(el('span', '', 'Earned since midnight '), earningNow, el('span', 'quiet', ` · paid at ${timeFmt.format(nextPayday(t))}`));
        earningNow.textContent = accruedText(state, t);
      },
    };
  };

  // --- term deposits -------------------------------------------------------------------------
  const depositsPane = (): Pane => {
    const root = el('section', 'bank-pane');
    let term: TermId = '24h';
    const seg = segmented(
      'Term',
      TERMS.map((t) => ({ id: t.id, label: `${t.label} · ${percent(t.ppm, 1_000_000)}` })),
      term,
      (v) => {
        term = v;
        preview();
      },
      'bank-seg',
    );
    const field = amountField('Amount', 'bank-dep-amt');
    const fills = el('div', 'bank-fills');
    const fromChecking = fill('Checking', field, () => state?.balance ?? 0);
    fills.append(fromChecking.b);
    const pre = el('p', 'bank-preview');
    const line = status();
    const open = btn('Open deposit', 'primary');
    const row = el('div', 'bank-actions');
    row.append(open);
    const list = el('div', 'bank-deposits');
    root.append(
      el('div', 'bank-sub', 'Open a deposit'),
      seg.root,
      field.root,
      fills,
      pre,
      row,
      line.root,
      el('p', 'quiet bank-terms', `The rate is fixed when you open it and paid with the principal when the term ends. Breaking a deposit early pays the principal less ${percent(EARLY_FEE_PPM, 1_000_000)} and no interest. Up to ${DEPOSIT_MAX_OPEN} open, ${formatMoney(DEPOSIT_CAP)} in all, ${formatMoney(DEPOSIT_MIN)} at least.`),
      el('div', 'bank-sub', 'Your deposits'),
      list,
    );
    const preview = () => {
      const amount = field.value();
      const t = TERMS.find((x) => x.id === term)!;
      if (!amount) {
        pre.textContent = `${t.label}: ${percent(t.ppm, 1_000_000)} for the term.`;
        return;
      }
      pre.textContent = `Pays ${formatMoney(amount + depositInterest(amount, t))} (${formatMoney(depositInterest(amount, t))} interest) on ${shortFmt.format(now() + t.ms)}.`;
    };
    field.input.addEventListener('input', preview);
    preview();
    open.addEventListener('click', () => {
      const amount = field.value();
      if (!amount) return line.show({ text: 'Type an amount in dollars.', kind: 'err' });
      void act(open, line, () => bank.deposit(term, amount), () => `Deposit opened: ${formatMoney(amount)} for ${termLabel(term)}.`).then(() => {
        field.input.value = '';
        preview();
      });
    });
    const rows = new Map<string, { bar: HTMLElement; left: HTMLElement; action: HTMLButtonElement; d: DepositView }>();
    const close = (d: DepositView, b: HTMLButtonElement) => {
      const matured = now() >= d.maturesAt;
      const go = () => void act(b, line, () => bank.closeDeposit(d.id), (s) => (matured ? `Repaid ${formatMoney(d.principal + d.interest)}.` : `Broken early: ${formatMoney(d.principal - earlyFee(d.principal))} back.`) + ` Checking: ${formatMoney(s.balance)}.`);
      if (matured) return go();
      const yes = btn('Break it', 'primary');
      const no = btn('Keep it', 'ghost');
      const m = modal(
        'Break this deposit early?',
        [`You get ${formatMoney(d.principal - earlyFee(d.principal))} back now: the ${formatMoney(d.principal)} less a ${formatMoney(earlyFee(d.principal))} fee, and none of the ${formatMoney(d.interest)} interest. It matures ${until(d.maturesAt - now())}.`],
        [no, yes],
        () => m.close(),
      );
      m.root.parentElement?.classList.add('bank-over');
      no.addEventListener('click', () => m.close());
      yes.addEventListener('click', () => {
        m.close();
        go();
      });
    };
    return {
      root,
      paint(s) {
        fromChecking.paint();
        list.replaceChildren();
        rows.clear();
        if (s.deposits.length === 0) list.append(el('p', 'quiet', 'None yet.'));
        for (const d of s.deposits) {
          const row = el('div', `bank-deposit ${d.closedAt !== undefined ? 'closed' : ''}`.trim());
          const head = el('div', 'bank-deposit-head');
          head.append(el('span', 'bank-deposit-term', termLabel(d.term)), el('span', 'money', formatMoney(d.principal)), el('span', 'money win', `+${formatMoney(d.interest)}`));
          const bar = el('div', 'bank-bar');
          const fillBar = el('i');
          bar.append(fillBar);
          const left = el('span', 'quiet bank-when');
          const action = btn('', 'bank-small');
          const foot = el('div', 'bank-deposit-foot');
          foot.append(left, action);
          row.append(head, bar, foot);
          if (d.closedAt !== undefined) {
            action.hidden = true;
            bar.hidden = true;
            left.textContent = `Closed ${shortFmt.format(d.closedAt)}: ${formatMoney(d.paid ?? 0)} paid back.`;
          } else {
            action.addEventListener('click', () => close(d, action));
            rows.set(d.id, { bar: fillBar, left, action, d });
          }
          list.append(row);
        }
        this.tick!(now());
      },
      tick(t) {
        for (const { bar, left, action, d } of rows.values()) {
          const done = Math.min(1, (t - d.openedAt) / (d.maturesAt - d.openedAt));
          bar.style.width = `${(done * 100).toFixed(2)}%`;
          const matured = t >= d.maturesAt;
          left.textContent = matured ? `Matured ${shortFmt.format(d.maturesAt)}` : `Matures ${until(d.maturesAt - t)}, ${shortFmt.format(d.maturesAt)}`;
          const label = matured ? 'Collect' : 'Break early';
          if (action.textContent !== label && !action.disabled) action.textContent = label;
          action.classList.toggle('primary', matured);
        }
      },
    };
  };

  // --- the Casino Index ----------------------------------------------------------------------
  const fundPane = (): Pane => {
    const root = el('section', 'bank-pane');
    const price = el('div', 'bank-big money');
    const change = el('span', 'bank-change money');
    const head = el('div', 'bank-price');
    head.append(price, change);
    let range: '1d' | '7d' | '30d' = '1d';
    const chart = new PriceChart();
    let asked = 0;
    const loadChart = () => {
      const n = ++asked;
      bank
        .market(range)
        .then((m: MarketResponse) => n === asked && chart.set(m.points))
        .catch(() => {});
    };
    const seg = segmented(
      'Range',
      [
        { id: '1d', label: '1 day' },
        { id: '7d', label: '7 days' },
        { id: '30d', label: '30 days' },
      ] as const,
      range,
      (v) => {
        range = v;
        loadChart();
      },
      'bank-seg bank-range',
    );
    const stats = el('div', 'stats bank-stats');
    const units = statTile('Units', '');
    const value = statTile('Value', '');
    const cost = statTile('Cost', '');
    const gain = statTile('Gain', '');
    stats.append(units.tile, value.tile, cost.tile, gain.tile);
    const field = amountField('Amount', 'bank-fund-amt');
    const fills = el('div', 'bank-fills');
    const fromChecking = fill('Checking', field, () => state?.balance ?? 0);
    const holding = fill('Holding', field, () => state?.fund.value ?? 0);
    fills.append(fromChecking.b, holding.b);
    const line = status();
    const buyB = btn('Buy', 'primary');
    const sellB = btn('Sell');
    const sellAll = btn('Sell all', 'ghost');
    const row = el('div', 'bank-actions');
    row.append(buyB, sellB, sellAll);
    root.append(
      head,
      seg.root,
      chart.root,
      stats,
      field.root,
      fills,
      row,
      line.root,
      el(
        'p',
        'quiet bank-terms',
        `One price for everyone, a new one every five minutes. Over time it drifts up about ${percent(FUND_DAY_DRIFT, 1)} a day, but it swings about ${percent(FUND_DAY_VOL, 1)} a day either way: it can lose, and nobody knows the next price before it happens. Bought and sold at the price now, no fees, rounded down to the cent.`,
      ),
    );
    buyB.addEventListener('click', () => {
      const amount = field.value();
      if (!amount || amount < FUND_MIN) return line.show({ text: `Buys start at ${formatMoney(FUND_MIN)}.`, kind: 'err' });
      void act(buyB, line, () => bank.buy(amount), (s) => `Bought ${formatMoney(amount)} at ${formatPrice(s.fund.price)}.`).then(() => (field.input.value = ''));
    });
    sellB.addEventListener('click', () => {
      const amount = field.value();
      if (!amount) return line.show({ text: 'Type an amount in dollars.', kind: 'err' });
      void act(sellB, line, () => bank.sell(amount), (s) => `Sold at ${formatPrice(s.fund.price)}. Checking: ${formatMoney(s.balance)}.`).then(() => (field.input.value = ''));
    });
    sellAll.addEventListener('click', () => void act(sellAll, line, () => bank.sell('all'), (s) => `Sold everything at ${formatPrice(s.fund.price)}. Checking: ${formatMoney(s.balance)}.`));
    let lastStep = -1;
    return {
      root,
      paint(s) {
        price.textContent = formatPrice(s.fund.price);
        const d = s.fund.price - s.fund.dayAgo;
        change.textContent = `${d >= 0 ? '+' : '−'}${formatPrice(Math.abs(d))} (${d >= 0 ? '+' : '−'}${Math.abs((d / s.fund.dayAgo) * 100).toFixed(2)}%) today`;
        change.className = `bank-change money ${d > 0 ? 'win' : d < 0 ? 'lose' : ''}`.trim();
        units.value.textContent = formatUnits(s.fund.units);
        value.value.textContent = formatMoney(s.fund.value);
        cost.value.textContent = formatMoney(s.fund.cost);
        const g = s.fund.value - s.fund.cost;
        gain.value.textContent = formatMoney(g, { sign: true });
        gain.value.className = `stat-value money ${g > 0 ? 'win' : g < 0 ? 'lose' : ''}`.trim();
        fromChecking.paint();
        holding.paint();
        if (s.fund.step !== lastStep) {
          lastStep = s.fund.step;
          loadChart();
        }
      },
      destroy: () => chart.destroy(),
    };
  };

  // --- send money ----------------------------------------------------------------------------
  const sendPane = (): Pane => {
    const root = el('section', 'bank-pane');
    const inbox = el('div', 'bank-inbox');
    const to = textField('To', 'bank-send-to', 16, 'Player name');
    const field = amountField('Amount', 'bank-send-amt');
    const note = textField('Note', 'bank-send-note', SEND.noteMax, 'Optional');
    const can = el('p', 'bank-preview');
    const line = status();
    const go = btn('Send', 'primary');
    const row = el('div', 'bank-actions');
    row.append(go);
    const rules = el('ul', 'bank-rules');
    for (const r of [
      `Up to ${formatMoney(SEND.dayCap)} in any 24 hours, and ${formatMoney(SEND.pairCap)} to any one player.`,
      'Money from the house (your opening balance, top-ups, bonuses, tips and rewards) stays with you for three days; money from other players, for a day.',
      'New accounts can send after their first day. Nothing leaves from jail.',
      `Anything from ${formatMoney(SEND.confirmAt)} up asks you to confirm.`,
    ]) {
      rules.append(el('li', '', r));
    }
    root.append(inbox, el('div', 'bank-sub', 'Send money'), to.root, field.root, note.root, can, row, line.root, el('div', 'bank-sub', 'Limits'), rules);
    const send = (confirm: boolean) => {
      const amount = field.value();
      const name = to.input.value.trim();
      if (!name) return line.show({ text: 'Who to? Type their player name.', kind: 'err' });
      if (!amount) return line.show({ text: 'Type an amount in dollars.', kind: 'err' });
      void act(go, line, () => bank.send(name, amount, note.input.value, confirm), () => `Sent ${formatMoney(amount)} to ${name}.`).then(() => {
        if (!line.root.classList.contains('err')) {
          field.input.value = '';
          note.input.value = '';
        }
      });
    };
    go.addEventListener('click', () => {
      const amount = field.value();
      if (!amount || amount < SEND.confirmAt) return send(false);
      const yes = btn(`Send ${formatMoney(amount)}`, 'primary');
      const no = btn('Cancel', 'ghost');
      const who = to.input.value.trim();
      const m = modal('Confirm the transfer', [`${formatMoney(amount)} to ${who}${note.input.value.trim() ? `, "${note.input.value.trim()}"` : ''}. Transfers can't be taken back.`], [no, yes], () => m.close());
      m.root.parentElement?.classList.add('bank-over');
      no.addEventListener('click', () => m.close());
      yes.addEventListener('click', () => {
        m.close();
        send(true);
      });
    });
    return {
      root,
      paint(s) {
        paintInbox(inbox, s.inbox);
        const r = s.send;
        if (r.jailed) can.textContent = "You can't send money from jail.";
        else if (r.newUntil) can.textContent = `New accounts can send after their first day: ${until(r.newUntil - s.now)}.`;
        else {
          const parts = [`You can send up to ${formatMoney(r.sendable)} now.`];
          if (r.held > 0) parts.push(`${formatMoney(Math.min(r.held, s.balance))} of your balance came from the house or other players lately and stays with you for now.`);
          if (r.sentToday > 0) parts.push(`Sent in the last 24 hours: ${formatMoney(r.sentToday)}.`);
          can.textContent = parts.join(' ');
        }
        go.disabled = r.sendable <= 0;
      },
    };
  };

  // --- statement -----------------------------------------------------------------------------
  const statementPane = (): Pane => {
    const root = el('section', 'bank-pane');
    const table = el('div', 'bank-statement');
    const head = el('div', 'bank-line bank-line-head');
    for (const h of ['Date', 'Description', 'Account', 'Amount', 'Balance']) head.append(el('span', '', h));
    const body = el('div', 'bank-lines');
    table.append(head, body);
    const more = btn('Load more', 'ghost');
    more.hidden = true;
    const line = status();
    root.append(table, line.root, more);
    let next: string | null = null;
    const add = (lines: StatementLine[]) => {
      for (const l of lines) {
        const d = describe(l);
        const amount = lineAmount(l);
        const row = el('div', 'bank-line');
        const text = el('span', 'bank-line-text', d.text);
        if (l.note) text.append(el('span', 'bank-note', l.note));
        row.append(
          el('span', 'bank-line-date', formatDateTime(l.at)),
          text,
          el('span', 'bank-line-acct', d.account),
          el('span', `money bank-line-amt ${amount > 0 ? 'win' : ''}`.trim(), amount === 0 ? '' : formatMoney(amount, { sign: true })),
          el('span', 'money bank-line-bal', l.cash === 0 ? '' : formatMoney(l.balance)),
        );
        body.append(row);
      }
    };
    const load = () => {
      more.disabled = true;
      bank
        .statement(next)
        .then((r) => {
          add(r.lines);
          next = r.next;
          more.hidden = !next;
          more.disabled = false;
          if (body.childElementCount === 0) body.append(el('p', 'quiet', 'Nothing yet.'));
        })
        .catch((err) => {
          more.disabled = false;
          line.show({ text: problemText(err), kind: 'err' });
        });
    };
    more.addEventListener('click', load);
    return {
      root,
      paint() {},
      shown() {
        // from the top each time it's opened, so it includes what just happened
        body.replaceChildren();
        next = null;
        load();
      },
    };
  };

  const makers: Record<BankPane, () => Pane> = {
    checking,
    savings: savingsPane,
    deposits: depositsPane,
    fund: fundPane,
    send: sendPane,
    statement: statementPane,
  };
  let current: BankPane | null = null;
  const show = (id: BankPane) => {
    current = id;
    for (const [k, { b }] of railItems) {
      b.setAttribute('aria-current', String(k === id));
      b.classList.toggle('on', k === id);
    }
    let pane = panes.get(id);
    if (!pane) {
      pane = makers[id]();
      panes.set(id, pane);
      if (state) pane.paint(state);
    }
    main.replaceChildren(pane.root);
    if (!state) main.prepend(loading);
    pane.shown?.();
  };

  show(deps.start ?? 'checking');
  void refresh();
  // the savings interest and the deposits' clocks tick; the fund's price moves every five minutes
  let beats = 0;
  timer = window.setInterval(() => {
    if (sheet.closed) return;
    beats++;
    const pane = current ? panes.get(current) : null;
    pane?.tick?.(now());
    if (beats % 60 === 0) void refresh();
  }, 1000);

  return { root: sheet.root, close: () => sheet.close() };
}
