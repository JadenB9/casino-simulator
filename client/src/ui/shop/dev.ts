// Dev page for the boutique, the bar and the wearables, served by Vite in development only:
//   /casino/src/ui/shop/dev.html?screen=<wear|boutique|bar|effects>
// boutique, bar, effects: against the local worker, logged in as name=<n> (dev password), or
// fixture=1 for a canned high roller with no server at all (a disco already on in the Bar, where
// they stand). item=<id> opens the boutique at that piece; section=<wear|ride|emote|fx|statue|vault>;
// balance=<dollars> sets the high roller's balance.
// wear: your character in the showroom wearing what the URL says, to look at the pieces up close:
// body=m|f, outfit=suit, chain=, grill=, clothes=, watch=, shades=, hat=, held=<bar item>,
// view=full|chest|face|head|wrist|hand, yaw=<radians> (holds the turn still).
// window.dev.wear(look, view, yaw) changes it from a script.

import '../menu/dev.css';
import * as THREE from 'three';
import { Engine3D } from '../../render/engine3d.ts';
import { Characters } from '../../world/characters.ts';
import { Sfx } from '../../audio/sfx.ts';
import * as realApi from '../../net/api.ts';
import { session } from '../../app/session.ts';
import { DEFAULT_LOOK, type Look } from '../../../../shared/src/look.ts';
import { theName, EFFECTS, EMOTE_ITEMS, FX_GAP_MS, HOLD_MS, ITEM_KINDS, SHOP_ITEMS, STATUE, effectItem, shopEmote, shopItem, type BuyResponse, type EffectResponse, type FxEvent, type OrderResponse, type Statue } from '../../../../shared/src/items.ts';
import { barItem } from '../../../../shared/src/items.ts';
import type { Profile } from '../../../../shared/src/protocol.ts';
import { ApiError } from '../../net/api.ts';
import { el } from '../kit.ts';
import { mountHud } from '../menu/index.ts';
import { Showroom, type Framing } from './showroom.ts';
import { Bar, openBarMenu, openEffects, openShop, shopApi, shopButton, type FloorView, type ShopApi } from './index.ts';
import { serverNow } from '../../net/clock.ts';
import { waitFor, type Section } from './catalog.ts';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') ?? 'wear';
const fixture = q.get('fixture') === '1';
const ui = document.getElementById('ui')!;
const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, 'high');
const sfx = new Sfx();
void sfx.load().catch(() => {});

function shadow(): THREE.Material {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(0,0,0,0.6)');
  r.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
}

const characters = new Characters('high', shadow());

// --- a canned high roller, and a stand-in API that behaves like the real one ------------------------

const DAY = 86_400_000;

function highRoller(): Profile {
  const now = Date.now();
  return {
    id: 7,
    name: 'Ace_High',
    look: { v: 1, body: 'm', outfit: 'suit', skin: 3, hair: '#2b1d14', top: '#1f2430', bottom: '#1f2430', shoes: '#111111', chain: 'rope-chain' },
    createdAt: now - 41 * DAY,
    balance: 3_468_200_00,
    inPlay: 0,
    rev: 120,
    tables: [],
    loansTaken: 2,
    loans: [],
    stats: { total: { rounds: 4120, wagered: 912_000_00, net: 3_418_200_00, biggestWin: 1_200_000_00 }, games: {} },
  };
}

/** Where the fixture's high roller stands: the Bar, metres. */
const FIXTURE_AT = { x: 21, z: -6 };

/** A floor for the fixture: a disco someone else put on in the Bar, and whatever you buy after it. */
function fixtureFloor(): FloorView & { add(e: FxEvent): void } {
  const now = serverNow();
  let list: FxEvent[] = [{ fx: 'fx-disco', id: 99, name: 'Lucky_Lou', at: now - 20_000, until: now + 40_000, x: 2300, z: -900 }];
  const statues: Statue[] = [
    { name: 'Vegas_Vic', look: { v: 1, body: 'm', outfit: 'suit', skin: 2, hair: '#2b1d14', top: '#1f2430', bottom: '#1f2430', shoes: '#111111', hat: 'top-hat' }, at: Date.now() - 2 * DAY },
    { name: 'Queen_Bee', look: { v: 1, body: 'f', outfit: 'dress', skin: 1, hair: '#3a2415', top: '#5a1020', bottom: '#5a1020', shoes: '#111111' }, at: Date.now() - 9 * DAY },
  ];
  return {
    you: { id: 7 },
    statues,
    effects: (t = serverNow()) => (list = list.filter((e) => e.until > t)),
    add: (e) => list.push(e),
  };
}

function fixtureApi(floor: ReturnType<typeof fixtureFloor>): ShopApi & { order(item: string, op: string): Promise<OrderResponse> } {
  const owned = new Map<string, { price: number; at: number; feat?: string }>([
    ['rope-chain', { price: shopItem('rope-chain')!.price, at: Date.now() - 12 * DAY }],
    ['gold-top-six', { price: shopItem('gold-top-six')!.price, at: Date.now() - 3 * DAY }],
    ['skateboard', { price: shopItem('skateboard')!.price, at: Date.now() - 5 * DAY }],
    ['dab', { price: shopEmote('dab')!.price, at: Date.now() - 4 * DAY }],
    ['trophy', { price: 0, at: Date.now() - DAY, feat: 'won-1m' }],
  ]);
  const wait = () => new Promise((r) => setTimeout(r, 350));
  const money = (price: number) => {
    const p = session.profile!;
    if (p.balance < price) throw new ApiError(409, { error: 'INSUFFICIENT_FUNDS', msg: `Not enough: your balance is short.`, balance: p.balance, inPlay: p.inPlay });
    return { balance: p.balance - price, inPlay: p.inPlay, rev: p.rev + 1 };
  };
  return {
    async shop() {
      await wait();
      return {
        items: SHOP_ITEMS.filter((i) => !i.reward),
        owned: [...owned].map(([item, o]) => ({ item, price: o.price, at: o.at, ...(o.feat ? { feat: o.feat } : {}) })),
        balance: session.profile!.balance,
        emotes: EMOTE_ITEMS.filter((e) => shopEmote(e.id)),
        effects: EFFECTS,
        statue: STATUE,
        statues: floor.statues,
      };
    },
    async buy(item: string): Promise<BuyResponse> {
      await wait();
      const it = shopItem(item) ?? shopEmote(item) ?? (item === STATUE.id ? STATUE : null)!;
      if (owned.has(item)) throw new ApiError(409, { error: 'NOT_ELIGIBLE', msg: `You already own ${theName(it.name)}.` });
      const m = money(it.price);
      owned.set(item, { price: it.price, at: Date.now() });
      return { item, price: it.price, at: Date.now(), ...m };
    },
    async fx(item: string): Promise<EffectResponse> {
      await wait();
      const fx = effectItem(item)!;
      const now = serverNow();
      const w = waitFor(floor.effects(now), fx, 7, FIXTURE_AT.x, FIXTURE_AT.z, now);
      const at = w.behind ? w.behind.until + FX_GAP_MS : now;
      const ev: FxEvent = { fx: fx.id, id: 7, name: 'Ace_High', at, until: at + fx.secs * 1000, x: FIXTURE_AT.x * 100, z: FIXTURE_AT.z * 100 };
      const m = money(fx.price);
      floor.add(ev);
      return { fx: ev, ...m };
    },
    async saveLook(look: Look) {
      await wait();
      return look;
    },
    async order(item: string, op: string): Promise<OrderResponse> {
      await wait();
      const it = barItem(item)!;
      const at = Date.now();
      return { order: { id: op, item, price: it.price, at, until: at + HOLD_MS }, ...money(it.price) };
    },
  };
}

async function ensureSession(): Promise<void> {
  if (fixture) {
    // balance=<dollars> for a richer (or poorer) high roller
    const dollars = Number(q.get('balance'));
    session.set({ ...highRoller(), ...(dollars > 0 ? { balance: Math.round(dollars * 100) } : {}) });
    return;
  }
  session.set(await realApi.login(q.get('name') ?? `dev_${Math.random().toString(36).slice(2, 8)}`, realApi.DEV_PASSWORD));
}

function lookFromQuery(): Look {
  const look: Look = { ...DEFAULT_LOOK, body: q.get('body') === 'f' ? 'f' : 'm' };
  look.outfit = q.get('outfit') ?? (look.body === 'f' ? 'smart' : 'suit');
  if (look.body === 'f') {
    look.hair = '#3a2415';
    look.top = '#1d2233';
    look.bottom = '#1d2233';
  }
  for (const k of ITEM_KINDS) {
    const v = q.get(k);
    if (v) look[k] = v;
  }
  const held = q.get('held');
  if (held) look.held = { item: held, order: 'dev-order-0001', until: Date.now() + 3_600_000 };
  return look;
}

/** A plain room behind the sheets: your character standing on the showroom's plinth. */
function backdrop(): Showroom {
  return new Showroom({ engine, characters, look: session.profile?.look ?? DEFAULT_LOOK, name: '', area: () => ({ x0: 0, y0: 0, x1: innerWidth * 0.5, y1: innerHeight }) });
}

async function start(): Promise<void> {
  if (screen === 'wear') {
    const look = lookFromQuery();
    await characters.load(look).catch(() => {});
    const room = new Showroom({ engine, characters, look, name: '', area: () => ({ x0: 0, y0: 0, x1: innerWidth, y1: innerHeight }) });
    room.show((q.get('view') as Framing) ?? 'full');
    if (q.has('yaw')) room.still(Number(q.get('yaw')));
    (window as unknown as { dev: unknown }).dev = {
      engine,
      room,
      characters,
      wear(next: Look, view: Framing, yaw: number | null = null) {
        room.setLook(next);
        room.show(view);
        room.still(yaw);
      },
    };
    document.body.dataset.ready = '1';
    return;
  }

  await ensureSession();
  const floor = fixture ? fixtureFloor() : null;
  const api = floor ? fixtureApi(floor) : { shop: shopApi.shop, buy: shopApi.buy, fx: shopApi.fx, order: shopApi.order, saveLook: realApi.saveLook };
  const where = () => (floor ? FIXTURE_AT : null);
  await characters.load(session.profile!.look).catch(() => {});
  const bar = new Bar({ session, api, seated: () => false, onSit: () => () => {}, delay: Number(q.get('delay') ?? 2500) });
  const hud = mountHud({ root: ui, session, sfx, onMenu: () => {} });
  const right = hud.root.querySelector('.hud-right')!;
  const firstBtn = right.querySelector('.hud-btn');
  let boutique: { close(): void } | null = null;
  const shop = (item?: string, section?: Section) =>
    (boutique = openShop({ root: ui, api, session, engine, characters, sfx, item, section, floor, where, onClose: () => (boutique = null) }));
  const menu = () => openBarMenu({ root: ui, bar, session, sfx });
  const effects = () => openEffects({ root: ui, api, session, floor, where, sfx, openBoutique: () => shop('fx-confetti') });
  right.insertBefore(shopButton('boutique', 'Boutique', () => shop()), firstBtn);
  right.insertBefore(shopButton('effects', 'Effects', effects), firstBtn);
  right.insertBefore(shopButton('bar', 'Bar', menu), firstBtn);
  let room: Showroom | null = null;
  if (screen === 'boutique') shop(q.get('item') ?? undefined, (q.get('section') as Section | null) ?? undefined);
  else if (screen === 'effects') {
    room = backdrop();
    room.show('full');
    effects();
  } else {
    room = backdrop();
    room.show('full');
    const r = room;
    session.on((p) => r.setLook(p.look));
    menu();
  }
  (window as unknown as { dev: unknown }).dev = { engine, session, bar, characters, shop, menu, effects, floor, get boutique() { return boutique; }, room };
  document.body.dataset.ready = '1';
}

start().catch((err) => {
  console.error(err);
  ui.append(el('p', 'dev-error', String(err?.message ?? err)));
});
