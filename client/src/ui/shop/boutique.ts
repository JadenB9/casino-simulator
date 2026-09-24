// The boutique: chains, grills, clothes, watches, shades and hats, paid for from your balance and
// yours for good. Your character stands in the showroom on the left wearing whatever is picked
// (a try-on: nothing changes until you buy or wear it), the camera in close on the piece; the
// case is on the right, one kind at a time, with the price, a buy that says what your balance
// will be after, and wear or take off for what you own. It holds the keyboard like the other
// sheets: Esc closes it, the arrows move down the case, Enter does the button, Q and E turn.

import './shop.css';
import type { Look } from '../../../../shared/src/look.ts';
import { DEFAULT_LOOK } from '../../../../shared/src/look.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import {
  ITEM_KINDS, KIND_LABELS, KIND_ONE, SHOP_ITEMS, shopItem, withItem,
  type BuyResponse, type ItemKind, type ShopItem, type ShopResponse,
} from '../../../../shared/src/items.ts';
import type { CharacterFactory } from '../../world/contract.ts';
import { el, button, modal, toast } from '../kit.ts';
import type { Closable, EngineLike, SessionLike, SfxLike } from '../menu/deps.ts';
import { icon } from '../menu/icons.ts';
import { keycap, problemText, segmented } from '../menu/parts.ts';
import { GLOBAL_KEYS, closeButton, focusFirst, holdKeyboard } from '../menu/sheet.ts';
import { mannequins } from '../editor/mannequin.ts';
import { Showroom, framingFor } from './showroom.ts';
import { applyMoney } from './bar.ts';
import { newOp } from './api.ts';

export interface ShopApi {
  shop(): Promise<ShopResponse>;
  buy(item: string, op: string): Promise<BuyResponse>;
  saveLook(look: Look): Promise<Look>;
}

export interface ShopDeps {
  root: HTMLElement;
  api: ShopApi;
  session: SessionLike;
  engine: EngineLike;
  /** The world's characters; without it a mannequin stands in (and wears nothing). */
  characters?: CharacterFactory;
  sfx?: Pick<SfxLike, 'play'>;
  /** Open at this item (a shopkeeper showing you a piece from the window). */
  item?: string;
  onClose?(): void;
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function openShop(deps: ShopDeps): Closable {
  const { session } = deps;
  const first = shopItem(deps.item) ?? SHOP_ITEMS[0]!;
  let kind: ItemKind = first.kind;
  let picked: ShopItem = first;
  /** What you own: item id to when you bought it (null until the server has said). */
  let owned: Map<string, number> | null = null;
  let busy = false;
  let note: { text: string; kind: '' | 'ok' | 'err' } | null = null;
  const look = (): Look => session.profile?.look ?? DEFAULT_LOOK;
  const balance = (): Cents => session.profile?.balance ?? 0;
  const wearing = (it: ShopItem) => look()[it.kind] === it.id;
  const isOwned = (it: ShopItem) => owned?.has(it.id) ?? wearing(it);

  // ---- the stage
  const root = el('div', 'boutique');
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
    b.addEventListener('click', () => room.turn(by));
    return b;
  };
  const hint = el('span', 'bq-turn-hint');
  hint.append(el('span', '', 'Drag to turn'), keycap('Q'), keycap('E'));
  turn.append(turnBtn('turn-left', 'Turn left (Q)', -Math.PI / 4), hint, turnBtn('turn-right', 'Turn right (E)', Math.PI / 4));
  stage.append(caption, turn);

  // ---- the case
  const panel = el('aside', 'bq-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'bq-title');
  const head = el('header', 'sheet-head');
  const titles = el('div', 'sheet-titles');
  const title = el('h2', 'sheet-title', 'Boutique');
  title.id = 'bq-title';
  titles.append(title, el('p', 'sheet-sub', 'Paid from your balance. Yours to keep.'));
  head.append(titles, closeButton(() => close()));

  const money = el('div', 'bq-money');
  const balVal = el('span', 'bq-money-val money');
  const ownVal = el('span', 'bq-money-own');
  money.append(el('span', 'bq-money-label', 'Balance'), balVal, ownVal);

  const tabBox = el('div', 'bq-tabs');
  const tabs = segmented<ItemKind>(
    'Kind',
    ITEM_KINDS.map((k) => ({ id: k, label: KIND_LABELS[k] })),
    kind,
    (k) => {
      const inKind = SHOP_ITEMS.filter((i) => i.kind === k);
      pick(inKind.find((i) => wearing(i)) ?? inKind[0]!);
    },
    'bq-seg',
  );
  tabBox.append(tabs.root);

  const list = el('div', 'bq-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Items');

  const foot = el('footer', 'bq-foot');
  const selName = el('div', 'bq-sel-name');
  const selPrice = el('div', 'bq-sel-price money');
  const sel = el('div', 'bq-sel');
  sel.append(selName, selPrice);
  const status = el('p', 'bq-status');
  status.setAttribute('aria-live', 'polite');
  const primary = el('button', 'btn primary bq-primary', 'Buy');
  primary.type = 'button';
  foot.append(sel, status, primary);

  panel.append(head, money, tabBox, list, foot);
  root.append(stage, panel);
  deps.root.append(root);

  // ---- the showroom: your character wearing the piece picked
  const room = new Showroom({
    engine: deps.engine,
    characters: deps.characters ?? mannequins,
    look: withItem(look(), picked.kind, picked.id),
    name: session.profile?.name ?? '',
    area: () => {
      const r = panel.getBoundingClientRect();
      const side = r.top < innerHeight * 0.25;
      const reserve = turn.getBoundingClientRect().height + caption.getBoundingClientRect().height + 40;
      return side ? { x0: 0, y0: 0, x1: Math.max(1, r.left), y1: innerHeight - reserve } : { x0: 0, y0: 0, x1: innerWidth, y1: Math.max(1, r.top - reserve) };
    },
  });
  const onResize = () => room.reframe();
  addEventListener('resize', onResize);

  // ---- painting
  const rows = new Map<string, HTMLButtonElement>();
  const renderList = () => {
    list.replaceChildren();
    rows.clear();
    for (const it of SHOP_ITEMS.filter((i) => i.kind === kind)) {
      const row = el('button', 'bq-item');
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.dataset.id = it.id;
      const chip = el('span', 'bq-chip');
      row.append(el('span', 'bq-name', it.name), el('span', 'bq-price money', formatMoney(it.price)), el('span', 'bq-about', it.about), chip);
      row.addEventListener('click', () => pick(it));
      row.addEventListener('dblclick', () => primary.click());
      list.append(row);
      rows.set(it.id, row);
    }
    paintRows();
  };

  const paintRows = () => {
    for (const [id, row] of rows) {
      const it = shopItem(id)!;
      const on = id === picked.id;
      row.setAttribute('aria-selected', String(on));
      row.tabIndex = on ? 0 : -1;
      const chip = row.querySelector('.bq-chip')!;
      const state = wearing(it) ? 'Wearing' : isOwned(it) ? 'Owned' : '';
      chip.textContent = state;
      chip.className = `bq-chip ${state.toLowerCase()}`.trim();
      row.classList.toggle('short', !isOwned(it) && it.price > balance());
    }
  };

  const paint = () => {
    const it = picked;
    balVal.textContent = formatMoney(balance());
    ownVal.textContent = owned ? `${owned.size} ${owned.size === 1 ? 'piece' : 'pieces'} owned` : '';
    capName.textContent = it.name;
    capLine.textContent = `${KIND_ONE[it.kind]} · ${formatMoney(it.price)}`;
    selName.textContent = it.name;
    selPrice.textContent = formatMoney(it.price);
    const mine = isOwned(it);
    const on = wearing(it);
    if (busy) {
      primary.disabled = true;
    } else if (mine) {
      primary.disabled = false;
      primary.textContent = on ? 'Take off' : 'Wear';
    } else {
      primary.textContent = `Buy · ${formatMoney(it.price)}`;
      primary.disabled = it.price > balance() || owned === null;
    }
    let line: { text: string; kind: '' | 'ok' | 'err' };
    if (note) line = note;
    else if (owned === null) line = { text: 'Checking what you own.', kind: '' };
    else if (on) line = { text: `You're wearing it. Bought ${dateFmt.format(owned.get(it.id) ?? Date.now())}.`, kind: '' };
    else if (mine) line = { text: `Yours since ${dateFmt.format(owned.get(it.id) ?? Date.now())}.`, kind: '' };
    else if (it.price > balance()) line = { text: `You're ${formatMoney(it.price - balance())} short. Chips on tables don't count here.`, kind: 'err' };
    else line = { text: `Balance after: ${formatMoney(balance() - it.price)}.`, kind: '' };
    status.textContent = line.text;
    status.className = `bq-status ${line.kind}`.trim();
    paintRows();
  };

  const pick = (it: ShopItem, focus = false) => {
    if (it.kind !== kind) {
      kind = it.kind;
      tabs.set(kind);
      renderList();
    }
    picked = it;
    note = null;
    room.setLook(withItem(look(), it.kind, it.id));
    room.show(framingFor(it.kind));
    deps.sfx?.play('ui-switch', { volume: 0.18 });
    paint();
    const row = rows.get(it.id);
    row?.scrollIntoView({ block: 'nearest' });
    if (focus) row?.focus();
  };

  // ---- buying and wearing
  const wear = async (it: ShopItem, on: boolean): Promise<void> => {
    const p = session.profile;
    if (!p) return;
    const stored = await deps.api.saveLook(withItem(p.look, it.kind, on ? it.id : null));
    const now = session.profile;
    if (now) session.set({ ...now, look: stored });
    room.setLook(withItem(stored, it.kind, it.id));
  };

  const buy = (it: ShopItem) => {
    const after = balance() - it.price;
    // one purchase, one op id: a retried request after a dropped answer is still this purchase
    const op = newOp();
    const go = button('Buy', async () => {
      m.close();
      busy = true;
      note = { text: `Buying the ${it.name}.`, kind: '' };
      primary.textContent = 'Buying';
      paint();
      try {
        const r = await deps.api.buy(it.id, op);
        applyMoney(session, r);
        (owned ??= new Map()).set(it.id, r.at);
        deps.sfx?.play('chips-stack', { volume: 0.5 });
        // walk out wearing it, the way a shop hands it over
        await wear(it, true).catch(() => {});
        note = { text: `The ${it.name} is yours. You're wearing it.`, kind: 'ok' };
        toast(`Bought the ${it.name} for ${formatMoney(r.price)}.`);
      } catch (err) {
        const body = (err as { body?: { error?: string; balance?: number; inPlay?: number } }).body;
        if (body?.error === 'NOT_ELIGIBLE') (owned ??= new Map()).set(it.id, Date.now());
        const p = session.profile;
        if (p && body?.balance !== undefined && body.inPlay !== undefined) session.set({ ...p, balance: body.balance, inPlay: body.inPlay });
        note = { text: problemText(err), kind: 'err' };
      } finally {
        busy = false;
        paint();
      }
    }, { cls: 'primary' });
    const m = modal(
      `Buy the ${it.name}?`,
      [
        el('p', 'bq-confirm-price money', formatMoney(it.price)),
        `Balance after: ${formatMoney(after)}. It comes out of your balance; chips on tables stay where they are.`,
      ],
      [go, button('Cancel', () => m.close(), { cls: 'ghost' })],
      () => m.close(),
    );
    go.focus();
  };

  primary.addEventListener('click', async () => {
    if (busy || primary.disabled) return;
    const it = picked;
    if (!isOwned(it)) {
      buy(it);
      return;
    }
    busy = true;
    const on = !wearing(it);
    primary.textContent = on ? 'Putting it on' : 'Taking it off';
    paint();
    try {
      await wear(it, on);
      deps.sfx?.play('ui-click', { volume: 0.4 });
      note = null;
    } catch (err) {
      note = { text: problemText(err), kind: 'err' };
    } finally {
      busy = false;
      paint();
    }
  });

  // ---- keys: the arrows down the case, Enter for the button, Q/E turn
  root.addEventListener('keydown', (e) => {
    if (GLOBAL_KEYS.has(e.key)) return;
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const inTabs = (e.target as HTMLElement).closest('[role="radiogroup"]');
    const inKind = SHOP_ITEMS.filter((i) => i.kind === kind);
    const at = inKind.findIndex((i) => i.id === picked.id);
    if (!inTabs && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      pick(inKind[(at + (e.key === 'ArrowDown' ? 1 : -1) + inKind.length) % inKind.length]!, true);
    } else if (e.code === 'KeyQ') room.turn(-0.3);
    else if (e.code === 'KeyE') room.turn(0.3);
    else if (e.key === 'Enter' && (e.target as HTMLElement).closest('.bq-list')) primary.click();
    else return;
    e.preventDefault();
  });

  // ---- turning by drag
  let drag: { id: number; x: number } | null = null;
  stage.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.bq-turn-btn')) return;
    drag = { id: e.pointerId, x: e.clientX };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    room.turn((e.clientX - drag.x) * 0.012);
    drag.x = e.clientX;
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---- open and close
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    release();
    offSession();
    removeEventListener('resize', onResize);
    room.dispose();
    root.classList.add('closing');
    setTimeout(() => root.remove(), 200);
    deps.onClose?.();
  };
  const release = holdKeyboard(root, () => close());
  const offSession = session.on(() => !closed && paint());

  renderList();
  pick(first);
  deps.api
    .shop()
    .then((r) => {
      if (closed) return;
      owned = new Map(r.owned.map((o) => [o.item, o.at]));
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
