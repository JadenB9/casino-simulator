// Money from other players, told where you are: a line when a transfer lands while you're on the
// floor (the floor's `bank.in`), and once per visit a line for any that came while you were away.
// The bank's Checking and Send money screens list them in full and mark them seen.

import { formatMoney } from '../../../../shared/src/money.ts';
import type { FloorServerMsg, Profile } from '../../../../shared/src/protocol.ts';
import type { Received } from '../../../../shared/src/bank.ts';

export interface NoticeDeps {
  link: { subscribe(fn: (msg: FloorServerMsg) => void): () => void; on(e: 'hello', fn: (you: unknown, first: boolean) => void): () => void };
  /** The inbox (transfers received since the bank was last opened). */
  inbox: () => Promise<Received[]>;
  /** A fresh profile, for the new balance. */
  me: () => Promise<Profile>;
  setProfile: (p: Profile) => void;
  say: (text: string) => void;
  sfx?: { play(name: string, opts?: { volume?: number }): void };
}

export function transferLine(from: string, amount: number, note: string | null): string {
  return `${from} sent you ${formatMoney(amount)}${note ? `: "${note}"` : '.'}`;
}

/** The notices, for as long as this floor link lasts; returns what stops them. */
export function bankNotices(deps: NoticeDeps): () => void {
  let told = false;
  const offMsg = deps.link.subscribe((m) => {
    if (m.t !== 'bank.in') return;
    deps.say(transferLine(m.from, m.amount, m.note));
    deps.sfx?.play('chips-stack', { volume: 0.5 });
    void deps.me().then(deps.setProfile, () => {});
  });
  const offHello = deps.link.on('hello', (_you, first) => {
    if (!first || told) return;
    told = true;
    void deps
      .inbox()
      .then((list) => {
        if (list.length === 0) return;
        const total = list.reduce((s, r) => s + r.amount, 0);
        deps.say(list.length === 1 ? `While you were away, ${transferLine(list[0]!.from, list[0]!.amount, list[0]!.note)}` : `While you were away, ${list.length} players sent you ${formatMoney(total)}. The bank has the details.`);
      })
      .catch(() => {});
  });
  return () => {
    offMsg();
    offHello();
  };
}
