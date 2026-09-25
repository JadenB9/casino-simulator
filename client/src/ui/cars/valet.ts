// The valet's panel, opened with E at the podium out front: every car there is, on the turntable
// on the left as you go down the list, and on the right the list with prices, what you own, a buy
// that says what your balance will be after, and for a car you own, the valet bringing it round.
// A car you buy goes to your garage across the street at once. It holds the keyboard like the
// other sheets: Esc closes it, the arrows move down the list, Enter does the button, Q and E turn.

import '../shop/shop.css';
import './cars.css';
import { CARS, carItem, type BuyResponse, type CarItem, type ShopResponse } from '../../../../shared/src/items.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import type { CarCall, CarCallResponse } from '../../../../shared/src/valet.ts';
import { el, button, modal, toast } from '../kit.ts';
import type { Closable, EngineLike, SessionLike, SfxLike } from '../menu/deps.ts';
import { icon } from '../menu/icons.ts';
import { keycap, problemText, segmented } from '../menu/parts.ts';
import { GLOBAL_KEYS, closeButton, focusFirst, holdKeyboard } from '../menu/sheet.ts';
import { applyMoney } from '../shop/bar.ts';
import { CarStudio } from '../../world/cars/studio.ts';
import type { CarMaterials } from '../../world/cars/materials.ts';

export interface ValetApi {
  shop(): Promise<ShopResponse>;
  buy(item: string, op: string): Promise<BuyResponse>;
  valet(car: string | null): Promise<CarCallResponse>;
  newOp(): string;
}

export interface ValetDeps {
  root: HTMLElement;
  api: ValetApi;
  session: SessionLike;
  engine: EngineLike;
  mats: CarMaterials;
  sfx?: Pick<SfxLike, 'play'>;
  /** Your car at the curb now, if one is. */
  atCurb(): CarCall | null;
  /** A call the server answered (the floor tells everyone too; this shows it at once). */
  onCall?(call: CarCall | null): void;
  /** Open at this car. */
  car?: string;
  onClose?(): void;
}

type Tab = 'all' | 'mine';

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function openValet(deps: ValetDeps): Closable {
  const { session } = deps;
  let tab: Tab = 'all';
  let picked: CarItem = carItem(deps.car) ?? CARS[0]!;
  /** What you own, and since when; null until the server has said. */
  let owned: Map<string, number> | null = null;
  let busy = false;
  let note: { text: string; kind: '' | 'ok' | 'err' } | null = null;
  const balance = (): Cents => session.profile?.balance ?? 0;
  const isOwned = (c: CarItem) => owned?.has(c.id) || !!session.profile?.owned?.includes(c.id);
  const count = () => CARS.filter(isOwned).length;

  // ---- the stage
  const root = el('div', 'boutique valet');
  const stage = el('div', 'bq-stage');
  stage.setAttribute('aria-hidden', 'true');
  const caption = el('div', 'bq-caption');
  const capName = el('div', 'bq-cap-name');
  const capLine = el('div', 'bq-cap-line');
  caption.append(capName, capLine);
  const turn = el('div', 'bq-turn');
  const turnBtn = (name: 'turn-left' | 'turn-right', title: string, by: number) => {
    const b = el('button', 'bq-turn-btn');
    b.type = 'button';
    b.tabIndex = -1;
    b.title = title;
    b.append(icon(name));
    b.addEventListener('click', () => studio.turn(by));
    return b;
  };
  const hint = el('span', 'bq-turn-hint');
  hint.append(el('span', '', 'Drag to turn'), keycap('Q'), keycap('E'));
  turn.append(turnBtn('turn-left', 'Turn left (Q)', -Math.PI / 4), hint, turnBtn('turn-right', 'Turn right (E)', Math.PI / 4));
  stage.append(caption, turn);

  // ---- the list
  const panel = el('aside', 'bq-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'vl-title');
  const head = el('header', 'sheet-head');
  const titles = el('div', 'sheet-titles');
  const title = el('h2', 'sheet-title', 'Valet');
  title.id = 'vl-title';
  const sub = el('p', 'sheet-sub', 'Paid from your balance. Kept in your garage across the street.');
  titles.append(title, sub);
  head.append(titles, closeButton(() => close()));

  const money = el('div', 'bq-money');
  const balVal = el('span', 'bq-money-val money');
  const ownVal = el('span', 'bq-money-own');
  money.append(el('span', 'bq-money-label', 'Balance'), balVal, ownVal);

  const tabBox = el('div', 'bq-tabs');
  const tabs = segmented<Tab>('Show', [{ id: 'all', label: 'Every car' }, { id: 'mine', label: 'Your garage' }], tab, (t) => {
    tab = t;
    const list = listed();
    renderList();
    if (list.length && !list.includes(picked)) pick(list[0]!);
    else paint();
  }, 'bq-seg');
  tabBox.append(tabs.root);

  const list = el('div', 'bq-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Cars');

  const foot = el('footer', 'bq-foot');
  const selName = el('div', 'bq-sel-name');
  const selPrice = el('div', 'bq-sel-price money');
  const sel = el('div', 'bq-sel');
  sel.append(selName, selPrice);
  const status = el('p', 'bq-status');
  status.setAttribute('aria-live', 'polite');
  const buttons = el('div', 'vl-buttons');
  const primary = el('button', 'btn primary bq-primary', 'Buy');
  primary.type = 'button';
  const back = el('button', 'btn ghost vl-back', 'Send it back');
  back.type = 'button';
  buttons.append(primary, back);
  foot.append(sel, status, buttons);

  panel.append(head, money, tabBox, list, foot);
  root.append(stage, panel);
  deps.root.append(root);

  const studio = new CarStudio({
    scene: deps.engine.scene,
    camera: deps.engine.camera,
    onFrame: (fn) => deps.engine.onFrame(fn),
    mats: deps.mats,
    area: () => {
      const r = panel.getBoundingClientRect();
      const side = r.top < innerHeight * 0.25;
      const reserve = turn.getBoundingClientRect().height + caption.getBoundingClientRect().height + 40;
      return side ? { x0: 0, y0: 0, x1: Math.max(1, r.left), y1: innerHeight - reserve } : { x0: 0, y0: 0, x1: innerWidth, y1: Math.max(1, r.top - reserve) };
    },
  });
  const onResize = () => studio.reframe();
  addEventListener('resize', onResize);

  // ---- painting
  const rows = new Map<string, HTMLButtonElement>();
  const listed = () => (tab === 'mine' ? CARS.filter(isOwned) : [...CARS]);

  const renderList = () => {
    list.replaceChildren();
    rows.clear();
    const here = listed();
    if (here.length === 0) {
      list.append(el('p', 'bq-empty', 'Nothing in your garage yet. Every car here is kept there once it is yours.'));
      return;
    }
    for (const c of here) {
      const row = el('button', 'bq-item');
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.dataset.id = c.id;
      row.append(el('span', 'bq-name', c.name), el('span', 'bq-price money', formatMoney(c.price)), el('span', 'bq-about', c.about), el('span', 'bq-chip'));
      row.addEventListener('click', () => pick(c));
      row.addEventListener('dblclick', () => primary.click());
      list.append(row);
      rows.set(c.id, row);
    }
    paintRows();
  };

  const chipOf = (c: CarItem): string => {
    const out = deps.atCurb();
    if (out && out.car === c.id) return 'At the curb';
    return isOwned(c) ? 'Owned' : '';
  };

  const paintRows = () => {
    for (const [id, row] of rows) {
      const c = carItem(id)!;
      const on = id === picked.id;
      row.setAttribute('aria-selected', String(on));
      row.tabIndex = on ? 0 : -1;
      const chip = row.querySelector('.bq-chip')!;
      const state = chipOf(c);
      chip.textContent = state;
      chip.className = `bq-chip ${state === 'Owned' ? 'owned' : state ? 'wearing' : ''}`.trim();
      row.classList.toggle('short', !isOwned(c) && c.price > balance());
    }
  };

  const since = (c: CarItem) => dateFmt.format(owned?.get(c.id) ?? Date.now());

  const decide = (c: CarItem): { line: { text: string; kind: '' | 'ok' | 'err' }; label: string; enabled: boolean } => {
    if (owned === null) return { line: { text: 'Checking your garage.', kind: '' }, label: 'Buy', enabled: false };
    const out = deps.atCurb();
    if (isOwned(c)) {
      if (out?.car === c.id) return { line: { text: 'Waiting at the curb, keys with you. Send it back when you are done.', kind: '' }, label: 'At the curb', enabled: false };
      const swap = out ? ` Your ${carItem(out.car)?.name ?? 'car'} goes back when it comes.` : '';
      return { line: { text: `Yours since ${since(c)}, in your garage across the street.${swap}`, kind: '' }, label: 'Bring it round', enabled: true };
    }
    const short = c.price > balance();
    if (short) return { line: { text: `You're ${formatMoney(c.price - balance())} short. Chips on tables don't count here.`, kind: 'err' }, label: `Buy · ${formatMoney(c.price)}`, enabled: false };
    return { line: { text: `Balance after: ${formatMoney(balance() - c.price)}. It goes straight to your garage.`, kind: '' }, label: `Buy · ${formatMoney(c.price)}`, enabled: true };
  };

  const paint = () => {
    const c = picked;
    balVal.textContent = formatMoney(balance());
    const n = count();
    ownVal.textContent = owned ? (n ? `${n} of ${CARS.length} in your garage` : 'Your garage is empty') : '';
    capName.textContent = c.name;
    capLine.textContent = isOwned(c) ? `In your garage · ${formatMoney(c.price)}` : `Car · ${formatMoney(c.price)}`;
    selName.textContent = c.name;
    selPrice.textContent = formatMoney(c.price);
    const d = decide(c);
    if (!busy) primary.textContent = d.label;
    primary.disabled = busy || !d.enabled;
    const out = deps.atCurb();
    back.hidden = !out;
    back.disabled = busy;
    back.textContent = out ? `Send the ${carItem(out.car)?.name ?? 'car'} back` : 'Send it back';
    const line = note ?? d.line;
    status.textContent = line.text;
    status.className = `bq-status ${line.kind}`.trim();
    paintRows();
  };

  const pick = (c: CarItem, focus = false) => {
    picked = c;
    note = null;
    if (!rows.has(c.id)) renderList();
    studio.show(c.id);
    deps.sfx?.play('ui-switch', { volume: 0.18 });
    paint();
    const row = rows.get(c.id);
    row?.scrollIntoView({ block: 'nearest' });
    if (focus) row?.focus();
  };

  // ---- buying and calling
  const own = (id: string, at: number) => {
    (owned ??= new Map()).set(id, at);
    const p = session.profile;
    if (p && !p.owned?.includes(id)) session.set({ ...p, owned: [...(p.owned ?? []), id] });
  };

  const buy = (c: CarItem) => {
    const op = deps.api.newOp();
    const go = button('Buy', async () => {
      m.close();
      busy = true;
      note = { text: `Buying the ${c.name}.`, kind: '' };
      primary.textContent = 'Buying';
      paint();
      try {
        const r = await deps.api.buy(c.id, op);
        applyMoney(session, r, r.price);
        own(c.id, r.at);
        deps.sfx?.play('chips-stack', { volume: 0.5 });
        note = { text: `The ${c.name} is yours. It's in your garage across the street, and the valet can bring it round now.`, kind: 'ok' };
        toast(`Bought the ${c.name} for ${formatMoney(r.price)}.`);
      } catch (err) {
        const body = (err as { body?: { error?: string; balance?: number; inPlay?: number } }).body;
        if (body?.error === 'NOT_ELIGIBLE' && /already own/.test(problemText(err))) own(c.id, Date.now());
        const p = session.profile;
        if (p && body?.balance !== undefined && body.inPlay !== undefined) session.set({ ...p, balance: body.balance, inPlay: body.inPlay });
        note = { text: problemText(err), kind: 'err' };
      } finally {
        busy = false;
        paint();
      }
    }, { cls: 'primary' });
    const m = modal(
      `Buy the ${c.name}?`,
      [el('p', 'bq-confirm-price money', formatMoney(c.price)), `Balance after: ${formatMoney(balance() - c.price)}. It comes out of your balance; chips on tables stay where they are.`],
      [go, button('Cancel', () => m.close(), { cls: 'ghost' })],
      () => m.close(),
    );
    go.focus();
  };

  const call = async (car: string | null) => {
    busy = true;
    primary.textContent = car ? 'Calling the valet' : primary.textContent;
    paint();
    try {
      const r = await deps.api.valet(car);
      deps.onCall?.(r.call);
      deps.sfx?.play('ui-click', { volume: 0.4 });
      if (car && r.call) {
        toast(`The valet has gone for your ${carItem(car)?.name ?? 'car'}.`);
        // close so you can watch it come round
        close();
        return;
      }
      note = { text: 'The valet is taking it back to the garage.', kind: 'ok' };
    } catch (err) {
      note = { text: problemText(err), kind: 'err' };
    } finally {
      busy = false;
      if (!closed) paint();
    }
  };

  primary.addEventListener('click', () => {
    if (busy || primary.disabled) return;
    if (!isOwned(picked)) buy(picked);
    else void call(picked.id);
  });
  back.addEventListener('click', () => !busy && void call(null));

  // ---- keys
  root.addEventListener('keydown', (ev) => {
    if (GLOBAL_KEYS.has(ev.key)) return;
    ev.stopPropagation();
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const inTabs = (ev.target as HTMLElement).closest('[role="radiogroup"]');
    const here = listed();
    const at = here.findIndex((c) => c.id === picked.id);
    if (!inTabs && here.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) pick(here[(at + (ev.key === 'ArrowDown' ? 1 : -1) + here.length) % here.length]!, true);
    else if (ev.code === 'KeyQ') studio.turn(-0.3);
    else if (ev.code === 'KeyE') studio.turn(0.3);
    else if (ev.key === 'Enter' && (ev.target as HTMLElement).closest('.bq-list')) primary.click();
    else return;
    ev.preventDefault();
  });

  // ---- turning by drag
  let drag: { id: number; x: number } | null = null;
  stage.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement).closest('.bq-turn-btn')) return;
    drag = { id: ev.pointerId, x: ev.clientX };
    stage.setPointerCapture(ev.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    studio.turn((ev.clientX - drag.x) * 0.01);
    drag.x = ev.clientX;
  });
  const endDrag = (ev: PointerEvent) => {
    if (!drag || ev.pointerId !== drag.id) return;
    drag = null;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---- open and close
  let closed = false;
  // a car at the curb comes and goes while it's open
  const ticker = window.setInterval(() => !closed && !busy && paint(), 1000);
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(ticker);
    release();
    offSession();
    removeEventListener('resize', onResize);
    studio.dispose();
    root.classList.add('closing');
    setTimeout(() => root.remove(), 200);
    deps.onClose?.();
  };
  const release = holdKeyboard(root, () => close());
  const offSession = session.on(() => !closed && paint());

  renderList();
  pick(picked);
  deps.api
    .shop()
    .then((r) => {
      if (closed) return;
      owned = new Map(r.owned.filter((o) => carItem(o.item)).map((o) => [o.item, o.at]));
      // the profile learns them too (the garage shows what the profile owns)
      const p = session.profile;
      const missing = [...owned.keys()].filter((id) => !p?.owned?.includes(id));
      if (p && missing.length) session.set({ ...p, owned: [...(p.owned ?? []), ...missing] });
      renderList();
      paint();
    })
    .catch((err) => {
      if (closed) return;
      owned = new Map();
      note = { text: problemText(err), kind: 'err' };
      paint();
    });
  queueMicrotask(() => {
    const row = rows.get(picked.id);
    if (row) row.focus();
    else focusFirst(panel);
  });
  return { root, close };
}
