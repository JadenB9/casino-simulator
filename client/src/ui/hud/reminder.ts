// The play reminder: every 30 or 60 minutes of a session (Settings, ui/menu/reminder.ts), and once
// when the session's net falls to the loss limit, a small card under the HUD says how long you
// have played and how much you are up or down since you came in, the HUD's own session figures.
// It never blocks: the table plays on behind it. Take a break stands you up from a table (its
// chips cash out the usual way) and closes a table flow that's open; Keep playing just closes it.

import './hud.css';
import { button, el } from '../kit.ts';
import { formatMoney, formatCompact, type Cents } from '../../../../shared/src/money.ts';
import { formatDuration } from '../menu/parts.ts';
import { onReminderPrefs, reminderPrefs } from '../menu/reminder.ts';

export interface ReminderDeps {
  root: HTMLElement;
  /** When the session started (the HUD's clock). */
  startedAt: number;
  /** The session's net now, as the HUD shows it; null before the profile is in. */
  net(): Cents | null;
  /** Stand up from any table and close any table flow. */
  onBreak?(): void;
}

export interface Reminder {
  /** The net changed: show the card if it has reached the loss limit, and keep an open card current. */
  check(): void;
  close(): void;
}

export function mountReminder(deps: ReminderDeps): Reminder {
  let prefs = reminderPrefs();
  /** The next reminder counts from here: the session's start, then the last card. */
  let from = deps.startedAt;
  /** The loss limit the card has already been shown for this session (once per limit). */
  let limitShown: Cents = 0;
  /** Dev stack only: a shorter wait, so a check needn't take half an hour. */
  let devMs: number | null = null;
  let timer = 0;
  let card: HTMLElement | null = null;
  let limitHit = false;

  const schedule = () => {
    clearTimeout(timer);
    const ms = devMs ?? prefs.every * 60_000;
    if (!ms) return;
    timer = window.setTimeout(() => show(false), Math.max(0, from + ms - Date.now()));
  };

  const hide = () => {
    card?.remove();
    card = null;
  };

  const paint = () => {
    if (!card) return;
    const net = deps.net() ?? 0;
    const played = el('div', 'reminder-fig');
    played.append(el('span', 'label', 'Played'), el('span', 'reminder-value money', formatDuration(Date.now() - deps.startedAt)));
    const session = el('div', 'reminder-fig');
    session.append(el('span', 'label', net < 0 ? 'Down' : net > 0 ? 'Up' : 'Even'), el('span', `reminder-value money ${net > 0 ? 'win' : net < 0 ? 'lose' : ''}`.trim(), formatMoney(Math.abs(net))));
    const figs = el('div', 'reminder-figs');
    figs.append(played, session);
    const kids: HTMLElement[] = [el('div', 'reminder-title', limitHit ? 'Limit reached' : 'Play reminder')];
    if (limitHit) kids.push(el('p', 'reminder-note', `You set a session loss limit of ${formatCompact(limitShown)}.`));
    kids.push(figs, el('p', 'reminder-note', 'Since you came in this session.'));
    const acts = el('div', 'reminder-acts');
    acts.append(
      button('Take a break', () => {
        hide();
        deps.onBreak?.();
      }, { cls: 'primary' }),
      button('Keep playing', hide, { cls: 'ghost' }),
    );
    kids.push(acts);
    card.replaceChildren(...kids);
  };

  const show = (limit: boolean) => {
    if (!card) {
      card = el('div', 'reminder panel');
      card.setAttribute('role', 'status');
      card.setAttribute('aria-live', 'polite');
      deps.root.append(card);
      limitHit = false;
    }
    // a limit reached stays said until the card is closed
    limitHit ||= limit;
    paint();
    if (!limit) {
      from = Date.now();
      schedule();
    }
  };

  const check = () => {
    const net = deps.net();
    if (net !== null && prefs.lossLimit > 0 && net <= -prefs.lossLimit && limitShown !== prefs.lossLimit) {
      limitShown = prefs.lossLimit;
      show(true);
      return;
    }
    paint();
  };

  const off = onReminderPrefs((p) => {
    prefs = p;
    schedule();
    check();
  });
  schedule();
  if (import.meta.env.DEV) (globalThis as unknown as { __reminder: unknown }).__reminder = { every: (ms: number | null) => ((devMs = ms), schedule()), show };

  return {
    check,
    close() {
      off();
      clearTimeout(timer);
      hide();
    },
  };
}
