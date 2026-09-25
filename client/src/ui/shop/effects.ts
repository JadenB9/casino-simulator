// Effects from anywhere on the floor: the HUD's sparkle button opens this short list down the right
// of the screen, over the floor rather than in front of it, so what you buy goes off in view.
// Buying is two presses on the same button (or the row's number key twice): the first says what
// it costs and when it would start, the second pays. Each row says what's on in its slot: your own
// effects play one at a time, a room effect one per room, a casino effect one for everyone.

import './shop.css';
import { EFFECTS, FX_MAX_WAIT_MS, type EffectItem, type EffectResponse } from '../../../../shared/src/items.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { serverNow } from '../../net/clock.ts';
import { el, toast } from '../kit.ts';
import type { Closable, SessionLike, SfxLike } from '../menu/deps.ts';
import { openSheet } from '../menu/sheet.ts';
import { keycap, problemText } from '../menu/parts.ts';
import { applyMoney } from './bar.ts';
import { newOp } from './api.ts';
import type { FloorView } from './boutique.ts';
import { REACH_TEXT, clockText, entryOf, roomName, secsText, waitFor } from './catalog.ts';

export interface EffectsDeps {
  root: HTMLElement;
  api: { fx(item: string, op: string): Promise<EffectResponse> };
  session: SessionLike;
  floor: FloorView | null;
  /** Where you stand (metres); null off the floor. */
  where(): { x: number; z: number } | null;
  sfx?: Pick<SfxLike, 'play'>;
  /** The boutique, opened at the effects (for the longer look). */
  openBoutique?(): void;
  onClose?(): void;
}

const ARM_MS = 4000;

export function openEffects(deps: EffectsDeps): Closable {
  const { session } = deps;
  let armed: { id: string; until: number } | null = null;
  let busy: string | null = null;
  /** One op per effect until it's answered, so a retry after a dropped answer can't pay twice. */
  const ops = new Map<string, string>();
  const sheet = openSheet(deps.root, {
    title: 'Effects',
    subtitle: 'Paid each time. It plays where you stand, for everyone to see.',
    cls: 'fx-sheet',
    onClose: () => {
      clearInterval(clock);
      offSession();
      deps.onClose?.();
    },
  });

  const balance = el('div', 'bar-balance');
  const balVal = el('span', 'money');
  balance.append(el('span', 'bar-balance-label', 'Balance'), balVal);

  const listBox = el('div', 'fx-list');
  const rows = new Map<string, { row: HTMLElement; when: HTMLElement; btn: HTMLButtonElement }>();
  EFFECTS.forEach((fx, i) => {
    const row = el('div', 'fx-row');
    const text = el('div', 'fx-text');
    const name = el('span', 'fx-name');
    name.append(keycap(String(i + 1)), el('span', '', fx.name));
    const when = el('span', 'fx-when');
    text.append(name, el('span', 'fx-meta', `${secsText(fx.secs)} · ${REACH_TEXT[fx.reach]}`), when);
    const btn = el('button', 'btn fx-play');
    btn.type = 'button';
    btn.addEventListener('click', () => void press(fx));
    row.append(text, el('span', 'fx-price money', formatMoney(fx.price)), btn);
    listBox.append(row);
    rows.set(fx.id, { row, when, btn });
  });

  const note = el('p', 'bar-note');
  note.setAttribute('aria-live', 'polite');
  const foot = el('div', 'sheet-foot fx-foot');
  if (deps.openBoutique) {
    const more = el('button', 'btn ghost', 'See them in the boutique');
    more.type = 'button';
    more.addEventListener('click', () => {
      sheet.close();
      deps.openBoutique?.();
    });
    foot.append(more);
  }
  sheet.body.append(balance, listBox, note, foot);

  const me = () => deps.floor?.you?.id ?? session.profile?.id ?? 0;

  const paint = () => {
    const bal = session.profile?.balance ?? 0;
    balVal.textContent = formatMoney(bal);
    const now = serverNow();
    const at = deps.where();
    const list = deps.floor?.effects(now) ?? [];
    if (armed && armed.until < Date.now()) armed = null;
    for (const fx of EFFECTS) {
      const r = rows.get(fx.id)!;
      const wait = at ? waitFor(list, fx, me(), at.x, at.z, now) : null;
      const mine = list.filter((e) => e.fx === fx.id && e.id === me());
      const booked = wait !== null && wait.at - now > FX_MAX_WAIT_MS;
      let when = '';
      if (mine.some((e) => e.at <= now)) when = `Yours is on, ${clockText(Math.max(...mine.map((e) => e.until)) - now)} left`;
      else if (mine.length) when = `Yours starts in ${clockText(Math.min(...mine.map((e) => e.at)) - now)}`;
      else if (booked) when = 'Booked up for now';
      else if (wait?.behind && wait.at > now) {
        const b = wait.behind;
        const what = entryOf(b.fx)?.name ?? 'an effect';
        when = `Starts in ${clockText(wait.at - now)}, after ${b.id === me() ? `your ${what}` : fx.reach === 'room' ? `${what} in ${roomName(wait.room)}` : `${b.name}'s ${what}`}`;
      } else if (fx.reach === 'room' && wait) when = `Everyone in ${roomName(wait.room)}`;
      r.when.textContent = when;
      r.row.classList.toggle('on', mine.length > 0);
      const isArmed = armed?.id === fx.id;
      r.row.classList.toggle('armed', isArmed);
      r.btn.classList.toggle('primary', isArmed);
      r.btn.textContent = busy === fx.id ? 'Paying' : isArmed ? 'Confirm' : 'Play';
      r.btn.disabled = busy !== null || bal < fx.price || booked || !at;
      r.btn.setAttribute('aria-label', `${isArmed ? 'Confirm' : 'Play'} ${fx.name}, ${formatMoney(fx.price)}`);
    }
    if (!at && !note.textContent) {
      note.textContent = 'Effects play where you stand: step away from the table first.';
      note.className = 'bar-note';
    }
  };

  const press = async (fx: EffectItem) => {
    if (busy) return;
    if (armed?.id !== fx.id || armed.until < Date.now()) {
      armed = { id: fx.id, until: Date.now() + ARM_MS };
      const wait = deps.where() ? waitFor(deps.floor?.effects() ?? [], fx, me(), deps.where()!.x, deps.where()!.z, serverNow()) : null;
      const later = wait && wait.at - serverNow() > 1500 ? ` It starts in ${clockText(wait.at - serverNow())}.` : '';
      note.textContent = `Press again to pay ${formatMoney(fx.price)} for ${fx.name}.${later}`;
      note.className = 'bar-note';
      deps.sfx?.play('ui-click', { volume: 0.3 });
      paint();
      return;
    }
    armed = null;
    busy = fx.id;
    paint();
    const op = ops.get(fx.id) ?? newOp();
    ops.set(fx.id, op);
    try {
      const r = await deps.api.fx(fx.id, op);
      ops.delete(fx.id);
      applyMoney(session, r, fx.price);
      deps.sfx?.play('chips-stack', { volume: 0.45 });
      const wait = r.fx.at - serverNow();
      note.textContent = wait > 1500 ? `Paid. ${fx.name} starts in ${clockText(wait)}.` : `${fx.name}: it's going off.`;
      note.className = 'bar-note ok';
      toast(`${fx.name}, ${formatMoney(fx.price)}.`);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status && status < 500) ops.delete(fx.id);
      const body = (err as { body?: { balance?: number; inPlay?: number } }).body;
      const p = session.profile;
      if (p && body?.balance !== undefined && body.inPlay !== undefined) session.set({ ...p, balance: body.balance, inPlay: body.inPlay });
      note.textContent = problemText(err);
      note.className = 'bar-note err';
    } finally {
      busy = null;
      paint();
    }
  };

  // number keys: the row's effect (twice to buy)
  sheet.panel.addEventListener('keydown', (e) => {
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1 || n > EFFECTS.length || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    void press(EFFECTS[n - 1]!);
  });

  const offSession = session.on(paint);
  const clock = window.setInterval(paint, 1000);
  paint();
  return { root: sheet.root, close: () => sheet.close() };
}
