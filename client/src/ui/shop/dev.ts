// Dev page for everything you can spend money on, served by Vite in development only:
//   /casino/src/ui/shop/dev.html?screen=<wear|boutique|bar|effects|bank|valet|store|art>
// boutique, bar, effects, bank, valet, store: against the local worker, logged in as name=<n> (dev
// password), or fixture=1 for a canned high roller with no server at all (a disco already on in the
// Bar, where they stand; a bank with savings, deposits, a holding and a statement; a car in the
// garage). item=<id> opens the boutique at that piece; section=<wear|ride|emote|fx|statue|vault>;
// balance=<dollars> sets the high roller's balance. bank: pane=<checking|savings|deposits|fund|send|
// statement>, empty=1 for a bank never used. valet: car=<id>, curb=<id> (a car of yours waiting out
// front). store: store=guns|home. art: every picture the boutique and the valet draw, in a grid.
// wear: your character in the showroom wearing what the URL says, to look at the pieces up close:
// body=m|f, outfit=suit, chain=, grill=, clothes=, watch=, shades=, hat=, held=<bar item>,
// view=full|chest|face|head|wrist|hand, yaw=<radians> (holds the turn still).
// window.dev.wear(look, view, yaw) changes it from a script.
// quality=low draws the showroom without bloom (much quicker in a software renderer).

import '../menu/dev.css';
import * as THREE from 'three';
import { Engine3D, type Quality } from '../../render/engine3d.ts';
import { Characters } from '../../world/characters.ts';
import { Sfx } from '../../audio/sfx.ts';
import * as realApi from '../../net/api.ts';
import { session } from '../../app/session.ts';
import { DEFAULT_LOOK, type Look } from '../../../../shared/src/look.ts';
import { theName, EFFECTS, EMOTE_ITEMS, FX_GAP_MS, ORDER_LIFE_MS, ITEM_KINDS, SHOP_ITEMS, STATUE, effectItem, shopEmote, shopItem, type BuyResponse, type EffectResponse, type FxEvent, type OrderResponse, type Statue } from '../../../../shared/src/items.ts';
import { CARS, barItem, carItem } from '../../../../shared/src/items.ts';
import { GUNS, gunItem } from '../../../../shared/src/arms.ts';
import { APARTMENTS, HOME_ITEMS, SLOT_NAMES, apartmentItem, homeItem, type HomeSlot } from '../../../../shared/src/estate.ts';
import type { CarCall } from '../../../../shared/src/valet.ts';
import { CURB_MS } from '../../../../shared/src/valet.ts';
import { openBank, type BankPane } from '../bank/bank.ts';
import { fixtureBank } from '../bank/fixtures.ts';
import { openValet } from '../cars/valet.ts';
import { carPicture } from '../cars/art.ts';
import { CarMaterials } from '../../world/cars/materials.ts';
import { openStore } from '../stores/store.ts';
import { itemPicture } from './art.ts';
import { entries } from './catalog.ts';
import './dev.css';
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
const quality: Quality = q.get('quality') === 'low' ? 'low' : 'high';
const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, quality);
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

const characters = new Characters(quality, shadow());

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
    ['halden-roadster', { price: carItem('halden-roadster')!.price, at: Date.now() - 2 * DAY }],
    ['compact-9', { price: gunItem('compact-9')!.price, at: Date.now() - 6 * DAY }],
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
      const it = shopItem(item) ?? shopEmote(item) ?? carItem(item) ?? gunItem(item) ?? homeItem(item) ?? apartmentItem(item) ?? (item === STATUE.id ? STATUE : null)!;
      if (owned.has(item)) throw new ApiError(409, { error: 'NOT_ELIGIBLE', msg: `You already own ${theName(it.name)}.` });
      const m = money(it.price);
      owned.set(item, { price: it.price, at: Date.now() });
      const p = session.profile!;
      session.set({ ...p, owned: [...(p.owned ?? []), item] });
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
      return { order: { id: op, item, price: it.price, at, until: at + ORDER_LIFE_MS }, ...money(it.price) };
    },
  };
}

async function ensureSession(): Promise<void> {
  if (fixture) {
    // balance=<dollars> for a richer (or poorer) high roller
    const dollars = Number(q.get('balance'));
    session.set({ ...highRoller(), owned: ['rope-chain', 'gold-top-six', 'skateboard', 'dab', 'trophy', 'halden-roadster', 'compact-9'], ...(dollars > 0 || q.get('balance') === '0' ? { balance: Math.round(dollars * 100) } : {}) });
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

/** Every picture the boutique and the valet draw, labelled, to judge the art at a glance. */
function gallery(): void {
  const box = el('div', 'art-gallery');
  const sections: [string, string[]][] = [
    ['Chains', entries('wear', 'chain').map((e) => e.id)],
    ['Grills', entries('wear', 'grill').map((e) => e.id)],
    ['Clothes', entries('wear', 'clothes').map((e) => e.id)],
    ['Watches, shades, hats', ['watch', 'shades', 'hat'].flatMap((k) => entries('wear', k as 'watch').map((e) => e.id))],
    ['Rides', entries('ride').map((e) => e.id)],
    ['Emotes', entries('emote').map((e) => e.id)],
    ['Effects and the statue', [...entries('fx').map((e) => e.id), 'statue']],
  ];
  for (const [title, ids] of sections) {
    box.append(el('h2', 'art-head', title));
    const grid = el('div', 'art-grid');
    for (const id of ids) {
      const cell = el('figure', 'art-cell');
      cell.append(itemPicture(id, 200, 100, 'art-pic'), el('figcaption', '', id));
      grid.append(cell);
    }
    box.append(grid);
  }
  box.append(el('h2', 'art-head', 'Cars'));
  const cars = el('div', 'art-grid');
  for (const c of CARS) {
    const cell = el('figure', 'art-cell');
    cell.append(carPicture(c.id, 200, 90, 'art-pic'), el('figcaption', '', c.id));
    cars.append(cell);
  }
  box.append(cars);
  ui.append(box);
}

/** A store's catalogue the way app/v7.ts opens it, against the stand-in purchase. */
function store(api: { buy(item: string, op: string): Promise<BuyResponse> }): void {
  const owns = (id: string) => !!session.profile?.owned?.includes(id);
  if (q.get('store') === 'home') {
    const slots: HomeSlot[] = ['sofa', 'tv', 'rug', 'art', 'lamp', 'plant'];
    openStore({
      root: ui,
      title: 'Maison Home',
      subtitle: 'Buy The Residence at the Residences desk in the hotel lobby (ground floor), then furnish it',
      api,
      sfx,
      sections: () => [
        { title: 'The apartment', rows: APARTMENTS.map((a) => ({ id: a.id, name: a.name, price: a.price, about: a.about, owned: owns(a.id), locked: a.tier > 1 && !owns(APARTMENTS[a.tier - 2]!.id) ? `Needs ${APARTMENTS[a.tier - 2]!.name} first.` : null })) },
        ...slots.map((slot) => ({
          title: SLOT_NAMES[slot],
          rows: HOME_ITEMS.filter((h) => h.slot === slot)
            .sort((a, b) => a.price - b.price)
            .map((h) => ({ id: h.id, name: h.name, price: h.price, about: h.about, owned: owns(h.id), locked: owns('apt-residence') ? null : 'Needs an apartment: buy The Residence first.', use: { label: 'Put it here', run: () => {} } })),
        })),
      ],
    });
    return;
  }
  let drawn: string | null = null;
  openStore({
    root: ui,
    title: 'Ace Arms',
    subtitle: 'V draws your gun and puts it away, a left click fires. Security hears every shot in the casino',
    api,
    sfx,
    bought: (id) => (drawn = id),
    sections: () => [{ title: 'Guns', rows: GUNS.map((g) => ({ id: g.id, name: g.name, price: g.price, about: `${g.about} ${g.auto ? 'Automatic' : 'Semi-automatic'}, ${g.mag} rounds.`, owned: owns(g.id), use: { label: drawn === g.id ? 'Drawn' : 'Draw', done: drawn === g.id, run: () => (drawn = g.id) } })) }],
  });
}

async function start(): Promise<void> {
  if (screen === 'art') {
    gallery();
    document.body.dataset.ready = '1';
    return;
  }
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
  else if (screen === 'bank') {
    const bank = fixture ? fixtureBank(session, { empty: q.get('empty') === '1' }) : undefined;
    const open = () => openBank({ root: ui, api: bank ?? realApi, session, sfx, bank, start: (q.get('pane') as BankPane | null) ?? undefined });
    open();
    (window as unknown as { openBank: () => void }).openBank = open;
  } else if (screen === 'valet') {
    const mats = new CarMaterials(quality, engine.scene.environment);
    const you = session.profile!;
    let curb: CarCall | null = q.get('curb') ? { id: you.id, name: you.name, car: q.get('curb')!, slot: 0, at: serverNow() - 20_000, until: serverNow() + CURB_MS - 20_000 } : null;
    const valet = async (car: string | null) => {
      await new Promise((r) => setTimeout(r, 350));
      if (fixture && !q.get('far')) {
        curb = car ? { id: you.id, name: you.name, car, slot: 0, at: serverNow(), until: serverNow() + CURB_MS } : null;
        return { call: curb };
      }
      throw new ApiError(409, { error: 'NOT_ELIGIBLE', msg: 'Call the valet from the valet stand out front.' });
    };
    const openIt = () =>
      openValet({
        root: ui,
        api: { shop: api.shop, buy: api.buy, valet, newOp: shopApi.newOp },
        session,
        engine,
        mats,
        sfx,
        car: q.get('car') ?? undefined,
        atCurb: () => (curb && curb.until > serverNow() ? curb : null),
      });
    openIt();
    (window as unknown as { openValet: () => void }).openValet = openIt;
  } else if (screen === 'store') {
    store(api);
  } else if (screen === 'effects') {
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
