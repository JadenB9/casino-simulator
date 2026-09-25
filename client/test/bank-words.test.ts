import { describe as group, it, expect } from 'vitest';
import { describe, lineAmount, parseDollars, percent, until } from '../src/ui/bank/words.ts';
import { bankNotices, transferLine } from '../src/ui/bank/notices.ts';
import type { StatementLine } from '../../shared/src/bank.ts';
import type { FloorServerMsg } from '../../shared/src/protocol.ts';
import { STATUE, effectItem } from '../../shared/src/items.ts';

const line = (over: Partial<StatementLine>): StatementLine => ({ id: 'x', at: 0, src: 'bank', kind: 'save', cash: 0, banked: 0, balance: 0, ...over });

group('the bank in words', () => {
  it('reads dollars as typed, to the cent, and nothing else', () => {
    expect(parseDollars('1,250')).toBe(125_000);
    expect(parseDollars('$99.5')).toBe(9_950);
    expect(parseDollars(' 12.05 ')).toBe(1_205);
    expect(parseDollars('0.01')).toBe(1);
    expect(parseDollars('12.345')).toBeNull();
    expect(parseDollars('-5')).toBeNull();
    expect(parseDollars('1e5')).toBeNull();
    expect(parseDollars('')).toBeNull();
    expect(parseDollars('abc')).toBeNull();
  });

  it('says rates as percentages', () => {
    expect(percent(50, 10_000)).toBe('0.5%');
    expect(percent(150, 1_000_000)).toBe('0.015%');
    expect(percent(35_000, 1_000_000)).toBe('3.5%');
    expect(percent(0.02, 1)).toBe('2%');
  });

  it('names every kind of movement and its account', () => {
    expect(describe(line({ src: 'ledger', kind: 'grant', id: 'grant:12' }))).toEqual({ text: 'Opening balance', account: 'Checking' });
    expect(describe(line({ src: 'ledger', kind: 'grant', id: 'daily:12:2026-09-25' })).text).toBe('Daily bonus');
    expect(describe(line({ src: 'ledger', kind: 'loan', id: 'loan:12:x' })).text).toBe("Cashier's top-up");
    expect(describe(line({ src: 'ledger', kind: 'buyin', ref: 'solo:blackjack:-:12' }))).toEqual({ text: 'Bought in · Blackjack', account: 'Tables' });
    expect(describe(line({ src: 'item', kind: 'item', ref: 'statue' })).text).toBe(`Boutique · ${STATUE.name}`);
    expect(describe(line({ src: 'order', kind: 'fx', ref: 'fx-confetti' })).text).toBe(`Effect · ${effectItem('fx-confetti')!.name}`);
    expect(describe(line({ kind: 'interest', ref: '2026-09-25' })).text).toBe('Interest for Sep 25');
    expect(describe(line({ kind: 'unlock', gain: 4_000 })).text).toBe('Term deposit repaid, $40 interest');
    expect(describe(line({ kind: 'unlock', gain: -500 })).text).toBe('Term deposit broken early, $5 fee');
    expect(describe(line({ kind: 'buy', units: 1_500_000, ref: '123:1012345' })).text).toBe('Bought 1.5 units at $101.2345');
    expect(describe(line({ kind: 'send', peer: 'Ace' }))).toEqual({ text: 'Sent to Ace', account: 'Checking' });
    expect(describe(line({ kind: 'receive', peer: 'Ace' })).text).toBe('From Ace');
  });

  it('shows interest on savings and everything else as checking moves', () => {
    expect(lineAmount(line({ kind: 'interest', banked: 1234 }))).toBe(1234);
    expect(lineAmount(line({ kind: 'save', cash: -500, banked: 500 }))).toBe(-500);
  });

  it('counts down in plain units', () => {
    expect(until(0)).toBe('now');
    expect(until(45_000)).toBe('in 45 s');
    expect(until(20 * 60_000)).toBe('in 20 min');
    expect(until(3 * 3_600_000 + 20 * 60_000)).toBe('in 3 h 20 min');
    expect(until(5 * 86_400_000)).toBe('in 5 days');
  });
});

group('transfer notices', () => {
  it('tells a transfer as it lands, and once what came while you were away', async () => {
    const said: string[] = [];
    let onMsg: (m: FloorServerMsg) => void = () => {};
    let onHello: (you: unknown, first: boolean) => void = () => {};
    let refreshed = 0;
    const off = bankNotices({
      link: {
        subscribe: (fn) => ((onMsg = fn), () => {}),
        on: (_e, fn) => ((onHello = fn), () => {}),
      },
      inbox: async () => [
        { id: 'a', from: 'Ace', amount: 50_000, note: null, at: 1 },
        { id: 'b', from: 'Bo', amount: 25_050, note: 'ty', at: 2 },
      ],
      me: async () => ((refreshed++, {}) as never),
      setProfile: () => {},
      say: (t) => said.push(t),
    });
    onHello(null, true);
    onHello(null, true);
    await new Promise((r) => setTimeout(r, 0));
    expect(said).toEqual(['While you were away, 2 players sent you $750.50. The bank has the details.']);
    onMsg({ t: 'bank.in', id: 'c', from: 'Cy', amount: 1_000, note: 'for the cab', at: 3 });
    onMsg({ t: 'online', n: 3 });
    expect(said.at(-1)).toBe('Cy sent you $10: "for the cab"');
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshed).toBe(1);
    expect(transferLine('Di', 12_345, null)).toBe('Di sent you $123.45.');
    off();
  });
});
