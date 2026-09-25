// The Play block of the Settings sheet: the play reminder (a card every 30 or 60 minutes with the
// session's time and net, as real casinos' reality checks do) and a session loss limit that shows
// the same card when the session's net falls to it. Kept per browser like the other settings; the
// HUD shows the card (ui/hud/reminder.ts) and hears changes at once.

import { el } from '../kit.ts';
import { segmented } from './parts.ts';
import { DOLLAR, formatCompact, type Cents } from '../../../../shared/src/money.ts';

type Row = (label: string, control: HTMLElement, note?: HTMLElement) => HTMLElement;

export const REMIND_MINUTES = [0, 30, 60] as const;
export const LOSS_LIMITS: readonly Cents[] = [0, 1_000 * DOLLAR, 10_000 * DOLLAR, 100_000 * DOLLAR, 1_000_000 * DOLLAR];

export interface ReminderPrefs {
  /** Minutes between reminders; 0 is off. */
  every: number;
  /** The session loss that shows the card; 0 is off. */
  lossLimit: Cents;
}

const KEY = 'casino.reminder';
const LIMIT_KEY = 'casino.lossLimit';
const listeners = new Set<(p: ReminderPrefs) => void>();

function read(key: string, allowed: readonly number[], fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null && allowed.includes(Number(raw))) return Number(raw);
  } catch {
    /* storage blocked */
  }
  return fallback;
}

export function reminderPrefs(): ReminderPrefs {
  return { every: read(KEY, REMIND_MINUTES, 60), lossLimit: read(LIMIT_KEY, LOSS_LIMITS, 0) };
}

export function setReminderPrefs(next: Partial<ReminderPrefs>): void {
  try {
    if (next.every !== undefined) localStorage.setItem(KEY, String(next.every));
    if (next.lossLimit !== undefined) localStorage.setItem(LIMIT_KEY, String(next.lossLimit));
  } catch {
    /* not kept */
  }
  const p = { ...reminderPrefs(), ...next };
  for (const fn of listeners) fn(p);
}

/** Hear changes; returns the unsubscribe. */
export function onReminderPrefs(fn: (p: ReminderPrefs) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reminderSettings(row: Row): HTMLElement[] {
  const p = reminderPrefs();
  const every = segmented<string>(
    'Play reminder',
    REMIND_MINUTES.map((m) => ({ id: String(m), label: m === 0 ? 'Off' : `Every ${m} min` })),
    String(p.every),
    (v) => setReminderPrefs({ every: Number(v) }),
  );
  const limit = segmented<string>(
    'Session loss limit',
    LOSS_LIMITS.map((c) => ({ id: String(c), label: c === 0 ? 'Off' : formatCompact(c) })),
    String(p.lossLimit),
    (v) => setReminderPrefs({ lossLimit: Number(v) }),
  );
  return [
    el('h3', 'section-label', 'Play'),
    row('Play reminder', every.root, el('p', 'set-note', 'A card with how long you have played this session and how much you are up or down, with a way to take a break.')),
    row('Loss limit', limit.root, el('p', 'set-note', 'The same card when you are down this much this session. It only reminds: you can keep playing.')),
  ];
}
