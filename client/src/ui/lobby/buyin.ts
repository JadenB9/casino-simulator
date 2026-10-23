// The buy-in prompt: how much to bring to the table (or put in a machine, or add to your chips).
// The amount stands large in tabular figures, a slider runs along the table's range under it
// (stepped on a log scale when the range is wide, so the minimum and the most you can are both a
// short drag apart), quick amounts sit under that (the minimum, round amounts up the range, the
// most you can), and the field says what's wrong as you type instead of after. Enter buys in, Esc
// cancels, the arrow keys step the slider. It takes over the kit's plain prompt (ui/kit.ts
// askBuyIn hands its every call here once this module is loaded) with the same options and the
// same answer: cents, or null. Whole dollars, as before.

import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { REFILL_BELOW, REFILL_TO } from '../../../../shared/src/bank.ts';
import { button, el, modal, setBuyInPanel } from '../kit.ts';
import { NOTCHES, amountAt, buyInPicks, buyInProblem, notchOf } from './table-model.ts';
import './buyin.css';

export interface BuyInOpts {
  min: Cents;
  max: Cents;
  balance: Cents;
  suggested?: Cents;
  verb?: string;
  note?: string;
  title?: string;
}

const D = 100;

const touch = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

let seq = 0;

/** Ask how much to bring to the table. Resolves with cents, or null if cancelled. */
export function buyInPanel(opts: BuyInOpts, signal?: AbortSignal): Promise<Cents | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(null);
    const max = Math.min(opts.max, Math.floor(opts.balance / D) * D);
    const min = opts.min;
    let m: { close: () => void; root: HTMLElement };
    const done = (v: Cents | null) => {
      signal?.removeEventListener('abort', cancel);
      m.close();
      resolve(v);
    };
    // The table this was asked for has gone (left, closed): take the question away with it.
    const cancel = () => done(null);
    signal?.addEventListener('abort', cancel);
    const dismiss = () => done(null);
    // `note` says what the range means when it isn't the table's buy-in (a top-up's room)
    const note = el('p', 'buyin-note', `Balance ${formatMoney(opts.balance)}. ${opts.note ?? `This table takes ${formatMoney(opts.min)} to ${formatMoney(opts.max)}.`}`);
    if (max < min) {
      const loan = el('p', '', `Under ${formatMoney(REFILL_BELOW)} in all, chips on tables included? The cashier tops you up to ${formatMoney(REFILL_TO)}.`);
      m = modal('Not enough to sit down', [note, loan], [button('Close', dismiss)], dismiss);
      m.root.classList.add('buyin');
      return;
    }

    const picks = buyInPicks(min, max);
    const id = ++seq;
    // the amount: a field drawn as one big figure, a dollar sign before it
    const amount = el('label', 'buyin-amount');
    const input = el('input', 'buyin-input');
    input.type = 'number';
    input.min = String(min / D);
    input.max = String(max / D);
    input.step = '1';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Amount in dollars');
    input.setAttribute('aria-describedby', `buyin-why-${id}`);
    amount.append(el('span', 'buyin-sign', '$'), input);

    const slider = el('input', 'buyin-slider');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(NOTCHES);
    slider.step = '1';
    slider.setAttribute('aria-label', 'Amount');
    const ends = el('div', 'buyin-ends');
    ends.append(el('span', '', formatMoney(min)), el('span', '', formatMoney(max)));
    const fixed = max <= min;
    slider.hidden = ends.hidden = fixed;

    const quick = el('div', 'buyin-quick');
    // the last pick is everything you have when the table would take more
    const all = max < opts.max;
    const chips = picks.map((v) => {
      const b = button(all && v === max ? `All ${formatMoney(v)}` : formatMoney(v), () => set(v, 'pick'), { cls: 'ghost buyin-pick' });
      b.dataset.cents = String(v);
      return b;
    });
    quick.append(...chips);

    const why = el('p', 'buyin-why');
    why.id = `buyin-why-${id}`;
    why.setAttribute('aria-live', 'polite');

    const ok = button(opts.verb ?? 'Buy in', () => {
      const r = buyInProblem(input.value, min, max);
      if (r.problem) {
        paint();
        input.focus();
        return;
      }
      done(r.cents);
    }, { cls: 'primary' });

    /** Show `v` everywhere: the figure (unless it's being typed), the slider, the pick it is. */
    const set = (v: Cents, from: 'pick' | 'slider' | 'typed' | 'start') => {
      if (from !== 'typed') input.value = String(v / D);
      if (from !== 'slider') slider.value = String(notchOf(v, min, max));
      paint();
      if (from === 'pick' && !touch()) input.focus({ preventScroll: true });
    };
    const paint = () => {
      const r = buyInProblem(input.value, min, max);
      amount.classList.toggle('bad', r.problem !== null);
      input.toggleAttribute('aria-invalid', r.problem !== null);
      why.textContent = r.problem ?? '';
      why.hidden = r.problem === null;
      ok.disabled = r.problem !== null;
      slider.setAttribute('aria-valuetext', Number.isNaN(r.cents) ? '' : formatMoney(r.cents));
      // the slider's track lit up to the thumb (a custom property its CSS reads)
      slider.style.setProperty('--fill', `${(Number(slider.value) / NOTCHES) * 100}%`);
      for (const b of chips) b.setAttribute('aria-pressed', String(Number(b.dataset.cents) === r.cents));
    };
    input.addEventListener('input', () => {
      const r = buyInProblem(input.value, min, max);
      if (!Number.isNaN(r.cents)) slider.value = String(notchOf(Math.min(max, Math.max(min, r.cents)), min, max));
      paint();
    });
    slider.addEventListener('input', () => set(amountAt(Number(slider.value), min, max), 'slider'));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        ok.click();
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !fixed) {
        // a twentieth of the slider a press, not a dollar
        e.preventDefault();
        const n = Math.max(0, Math.min(NOTCHES, Number(slider.value) + (e.key === 'ArrowUp' ? 1 : -1) * (NOTCHES / 20)));
        set(amountAt(n, min, max), 'start');
      }
    });

    const start = Math.min(max, Math.max(min, opts.suggested ?? picks[1] ?? min));
    m = modal(opts.title ?? 'Buy in', [note, amount, slider, ends, quick, why], [ok, button('Cancel', dismiss, { cls: 'ghost' })], dismiss);
    m.root.classList.add('buyin');
    set(start, 'start');
    // A finger gets the slider and the picks, not a keyboard thrown up over them.
    if (touch()) {
      input.blur();
      ok.focus({ preventScroll: true });
    } else input.select();
  });
}

// The kit's prompt hands over to this one from now on.
setBuyInPanel(buyInPanel);
