// A quiet line at the top of the floor saying whose effect is playing where you are, and what the
// room has queued next ("Disco Night · Sam · 0:42", "Next · Headline · Ana · in 1:10"). Effects
// are paid for, so the room should know who to thank; a busy room queues them, so it should know
// one is coming. `captionOf` decides the lines (pure, tested); FxCaption draws them.

import { effectItem, type FxEvent } from '../../../../shared/src/items.ts';
import type { FloorPlan } from '../layout.ts';
import { el } from '../../ui/kit.ts';
import { fxRoom } from './scope.ts';
import { reachOf } from './timing.ts';

export interface CaptionLine {
  key: string;
  /** The effect's name, who bought it, and seconds: left while playing, until it starts when next. */
  what: string;
  who: string;
  secs: number;
  next: boolean;
}

/** At most this many playing effects are named; the rest play unannounced. */
const SHOWN = 2;

/**
 * The lines for someone in room `here` at server time `now`: what's playing that they're part of
 * (their room's, the casino's, or one round a buyer in their room), newest first, then the soonest
 * one queued for them.
 */
export function captionOf(events: readonly FxEvent[], now: number, here: string, plan: FloorPlan): CaptionLine[] {
  const mine = events.filter((ev) => reachOf(ev.fx) === 'casino' || fxRoom(plan, ev)?.id === here);
  const playing = mine
    .filter((ev) => ev.at <= now && now < ev.until)
    .sort((a, b) => b.at - a.at)
    .slice(0, SHOWN)
    .map((ev) => line(ev, (ev.until - now) / 1000, false));
  const next = mine.filter((ev) => ev.at > now).sort((a, b) => a.at - b.at)[0];
  return next ? [...playing, line(next, (next.at - now) / 1000, true)] : playing;
}

function line(ev: FxEvent, secs: number, next: boolean): CaptionLine {
  return { key: `${ev.fx}:${ev.id}:${ev.at}`, what: effectItem(ev.fx)?.name ?? ev.fx, who: ev.name, secs: Math.max(0, secs), next };
}

/** Seconds as m:ss, rounded up (a countdown never shows 0:00 while something is left). */
export function clock(secs: number): string {
  const s = Math.max(0, Math.ceil(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class FxCaption {
  readonly root = el('div', 'fx-caption');
  private shown = '';

  constructor(parent: HTMLElement) {
    this.root.hidden = true;
    parent.append(this.root);
  }

  /** Redraw only when the text changes (once a second at most). */
  set(lines: readonly CaptionLine[], hide: boolean): void {
    const text = hide ? '' : lines.map((l) => `${l.next ? 'n' : 'p'}|${l.what}|${l.who}|${clock(l.secs)}`).join('\n');
    if (text === this.shown) return;
    this.shown = text;
    this.root.hidden = text === '';
    this.root.replaceChildren(
      ...(hide ? [] : lines).map((l) => {
        const row = el('div', l.next ? 'fx-line fx-next' : 'fx-line');
        if (l.next) row.append(el('span', 'fx-tag', 'Next'));
        row.append(el('span', 'fx-what', l.what), el('span', 'fx-who', l.who), el('span', 'fx-time', l.next ? `in ${clock(l.secs)}` : clock(l.secs)));
        return row;
      }),
    );
  }

  dispose(): void {
    this.root.remove();
  }
}
