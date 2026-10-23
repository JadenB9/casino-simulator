// The boutique: what you wear (chains, grills, clothes, watches, shades, hats), rides, emotes,
// effects and your statue, paid for from your balance. Your character stands in the showroom on
// the left trying on whatever is picked (nothing changes until you buy or wear it): wearing the
// piece, riding the ride, acting out the emote, under the effect's lights, or cast in gold. The
// case is on the right: the sections, a search across all of them, filters (what you can afford,
// what you own, what you've saved) and the price either way; then the pieces as cards, each with
// its picture (art.ts), price and state; and under them the one that's picked, with what it is,
// a buy that says what your balance will be after, and wear or take off for what you own. What
// feats give is listed too, never sold, so you can see what there is to win. It holds the keyboard
// like the other sheets: Esc closes it (or clears the search first), the arrows move through the
// cards, Enter does the button, Q and E turn.

import './shop.css';
import type { Look } from '../../../../shared/src/look.ts';
import { DEFAULT_LOOK } from '../../../../shared/src/look.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import {
  FX_MAX_WAIT_MS, KIND_LABELS, KIND_ONE, theName, withItem,
  type BuyResponse, type EffectResponse, type FxEvent, type ItemKind, type ShopResponse, type Statue,
} from '../../../../shared/src/items.ts';
import type { EmoteId } from '../../../../shared/src/protocol.ts';
import { serverNow } from '../../net/clock.ts';
import type { CharacterFactory } from '../../world/contract.ts';
import { el, button, modal, toast } from '../kit.ts';
import { isTyping } from '../keyboard.ts';
import type { Closable, EngineLike, SessionLike, SfxLike } from '../menu/deps.ts';
import { icon } from '../menu/icons.ts';
import { keycap, problemText, segmented } from '../menu/parts.ts';
import { GLOBAL_KEYS, closeButton, focusFirst, holdKeyboard } from '../menu/sheet.ts';
import { mannequins } from '../editor/mannequin.ts';
import { Showroom, framingFor, type Mood, type Shower } from './showroom.ts';
import { applyMoney } from './bar.ts';
import { newOp } from './api.ts';
import { keyLabel } from '../keys.ts';
import { drawItem, itemPicture } from './art.ts';
import { shopIcon } from './icons.ts';
import { isSaved, savedIds, toggleSaved } from './saved.ts';
import {
  NEW_IDS, REACH_TEXT, SECTIONS, WEAR_KINDS, clockText, coverText, entries, entryOf, filterEntries, inVault, kindText, rewardFeat, roomName, searchEntries, secsText, sortEntries, waitFor,
  type Entry, type Filter, type Section,
} from './catalog.ts';

export interface ShopApi {
  shop(): Promise<ShopResponse>;
  buy(item: string, op: string): Promise<BuyResponse>;
  /** v6: play an effect where you stand (paid each time). */
  fx(item: string, op: string): Promise<EffectResponse>;
  saveLook(look: Look): Promise<Look>;
}

/** v6: what the boutique reads from the floor socket (net/presence.ts FloorLink). */
export interface FloorView {
  you: { id: number } | null;
  statues: Statue[];
  effects(now?: number): FxEvent[];
}

export interface ShopDeps {
  root: HTMLElement;
  api: ShopApi;
  session: SessionLike;
  engine: EngineLike;
  /** The world's characters; without it a mannequin stands in (and wears nothing). */
  characters?: CharacterFactory;
  sfx?: Pick<SfxLike, 'play'>;
  /** Open at this item, emote, effect or the statue (a shopkeeper showing you a piece). */
  item?: string;
  /** Or open at this section. */
  section?: Section;
  /** v6: the floor, to say when an effect would start; and where you stand on it (metres). */
  floor?: FloorView | null;
  where?(): { x: number; z: number } | null;
  onClose?(): void;
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** How each effect previews in the showroom. */
const FX_PREVIEW: Record<string, { mood: Mood; shower: Shower | null; cheer?: true }> = {
  'fx-confetti': { mood: 'none', shower: 'confetti', cheer: true },
  'fx-spotlight': { mood: 'spot', shower: null },
  'fx-round': { mood: 'gold', shower: null },
  'fx-rain': { mood: 'none', shower: 'bills', cheer: true },
  'fx-sparklers': { mood: 'spot', shower: 'sparks' },
  'fx-disco': { mood: 'disco', shower: null },
  'fx-marquee': { mood: 'spot', shower: null },
  'fx-goldenhour': { mood: 'gold', shower: 'coins', cheer: true },
  'fx-takeover': { mood: 'gold', shower: 'sparks', cheer: true },
};

/** The effects that put your name up in lights: the caption shows it that way. */
const NAME_IN_LIGHTS = new Set(['fx-marquee', 'fx-takeover']);

/** A ride is ridden, not worn. */
const wearWords = (e: Entry) => (e.kind === 'ride' ? { on: 'Ride it', off: 'Get off', ing: 'Riding', now: "You're riding it" } : { on: 'Wear', off: 'Take off', ing: 'Wearing', now: "You're wearing it" });

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'afford', label: 'Can buy' },
  { id: 'owned', label: 'Owned' },
  { id: 'saved', label: 'Saved' },
];

/** The filter and the order, kept for the visit: the boutique opens again the way you left it. */
const view: { filter: Filter; down: boolean } = { filter: 'all', down: false };

/** A card's moving parts, so a repaint touches only what changed. */
interface Card {
  row: HTMLButtonElement;
  chip: HTMLElement;
  fill: HTMLElement | null;
  cover: HTMLElement | null;
  heart: HTMLElement;
  state: string;
}

export function openShop(deps: ShopDeps): Closable {
  const { session } = deps;
  const first = entryOf(deps.item) ?? entries(deps.section ?? 'wear')[0]!;
  let section: Section = first.section;
  let kind: ItemKind = first.kind && first.kind !== 'ride' ? first.kind : 'chain';
  let picked: Entry = first;
  let query = '';
  /** What you own: id to when (and the feat, for a reward); null until the server has said. */
  let owned: Map<string, { at: number; feat?: string }> | null = null;
  let statues: Statue[] = deps.floor?.statues ?? [];
  let busy = false;
  let note: { text: string; kind: '' | 'ok' | 'err' } | null = null;
  /** The effect whose Play was pressed once; a second press within ARM_MS buys it. */
  let armed: { id: string; until: number } | null = null;
  const ARM_MS = 4000;
  const look = (): Look => session.profile?.look ?? DEFAULT_LOOK;
  const balance = (): Cents => session.profile?.balance ?? 0;
  const me = () => deps.floor?.you?.id ?? session.profile?.id ?? 0;
  const wearing = (e: Entry) => !!e.kind && look()[e.kind] === e.id;
  const isOwned = (e: Entry) => owned?.has(e.id) || !!session.profile?.owned?.includes(e.id) || wearing(e);

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
  const head = el('header', 'sheet-head bq-head');
  const titles = el('div', 'sheet-titles');
  const title = el('h2', 'sheet-title', 'Boutique');
  title.id = 'bq-title';
  const sub = el('p', 'sheet-sub');
  titles.append(title, sub);
  const money = el('div', 'bq-money');
  const balVal = el('span', 'bq-money-val money');
  const ownVal = el('span', 'bq-money-own');
  money.append(el('span', 'bq-money-label', 'Balance'), balVal, ownVal);
  head.append(titles, money, closeButton(() => close()));

  const tabBox = el('div', 'bq-tabs');
  const tabs = segmented<Section>('Section', SECTIONS, section, (s) => {
    clearSearch(false);
    const list = s === 'wear' ? entries('wear', kind) : entries(s);
    pick(list.find((e) => wearing(e)) ?? list[0]!);
  }, 'bq-seg');
  const kinds = segmented<ItemKind>('Kind', WEAR_KINDS.map((k) => ({ id: k, label: KIND_LABELS[k] })), kind, (k) => {
    clearSearch(false);
    const list = entries('wear', k);
    pick(list.find((e) => wearing(e)) ?? list[0]!);
  }, 'bq-sub');
  tabBox.append(tabs.root, kinds.root);
  // a tab pressed during a search leaves the search for that tab, even the one already lit
  for (const seg of [tabs.root, kinds.root]) {
    seg.addEventListener('click', () => {
      if (!query) return;
      clearSearch(false);
      renderList();
      paint();
    });
  }

  // search, filters, the order
  const tools = el('div', 'bq-tools');
  const search = el('label', 'bq-search');
  const searchIn = el('input', 'bq-search-input');
  searchIn.type = 'text';
  searchIn.inputMode = 'search';
  searchIn.enterKeyHint = 'search';
  searchIn.placeholder = 'Search';
  searchIn.autocomplete = 'off';
  searchIn.spellcheck = false;
  searchIn.maxLength = 40;
  searchIn.setAttribute('aria-label', 'Search every section');
  const clearBtn = el('button', 'bq-search-clear');
  clearBtn.type = 'button';
  clearBtn.setAttribute('aria-label', 'Clear the search');
  clearBtn.append(icon('close'));
  clearBtn.hidden = true;
  search.append(shopIcon('search'), searchIn, clearBtn);
  const filters = segmented<Filter>('Show', FILTERS, view.filter, (f) => {
    view.filter = f;
    renderList();
    paint();
  }, 'bq-filter');
  const sortBtn = el('button', 'bq-sort');
  sortBtn.type = 'button';
  const paintSort = () => {
    sortBtn.replaceChildren(el('span', 'bq-sort-word', 'Price '), view.down ? '↓' : '↑');
    sortBtn.setAttribute('aria-label', view.down ? 'Sorted by price, highest first. Sort lowest first' : 'Sorted by price, lowest first. Sort highest first');
  };
  paintSort();
  sortBtn.addEventListener('click', () => {
    view.down = !view.down;
    paintSort();
    renderList();
    paint();
  });
  tools.append(search, filters.root, sortBtn);

  const list = el('div', 'bq-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Pieces');

  // the piece that's picked
  const foot = el('footer', 'bq-foot');
  const selName = el('div', 'bq-sel-name');
  const selPrice = el('div', 'bq-sel-price money');
  const sel = el('div', 'bq-sel');
  sel.append(selName, selPrice);
  const selMeta = el('div', 'bq-sel-meta');
  const selAbout = el('p', 'bq-sel-about');
  const status = el('p', 'bq-status');
  status.setAttribute('aria-live', 'polite');
  const saveBtn = el('button', 'btn ghost bq-save');
  saveBtn.type = 'button';
  saveBtn.append(shopIcon('heart'));
  const primary = el('button', 'btn primary bq-primary', 'Buy');
  primary.type = 'button';
  const buttons = el('div', 'bq-buttons');
  buttons.append(saveBtn, primary);
  foot.append(sel, selMeta, selAbout, status, buttons);

  panel.append(head, tabBox, tools, list, foot);
  root.append(stage, panel);
  deps.root.append(root);

  // ---- the showroom: your character trying on what's picked
  const room = new Showroom({
    engine: deps.engine,
    characters: deps.characters ?? mannequins,
    look: previewLook(first),
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

  /** The look the showroom shows for an entry: the piece on, a glass for a round, no drink on a statue. */
  function previewLook(e: Entry): Look {
    const l = look();
    if (e.kind) return withItem(l, e.kind, e.id);
    if (e.id === 'fx-round') return { ...l, held: { item: 'champagne', order: 'showroom-preview', until: Date.now() + 3_600_000 } };
    if (e.section === 'statue') {
      const { held: _held, ...rest } = l;
      return rest;
    }
    return l;
  }

  // ---- the effect you'd be buying: when it would start
  const fxWait = (e: Entry) => {
    if (!e.fx || !deps.floor) return null;
    const at = deps.where?.();
    if (!at) return null;
    return waitFor(deps.floor.effects(), e.fx, me(), at.x, at.z, serverNow());
  };

  // ---- the cards
  /** Cards are kept for as long as the boutique is open: each piece's picture is drawn once. */
  const cards = new Map<string, Card>();
  const statueBox = el('div', 'bq-statues');
  /** What the grid shows: a section (and kind), or every section's matches for the search; filtered and in order. */
  const listed = (): Entry[] => {
    const base = query ? searchEntries(query) : section === 'wear' ? entries('wear', kind) : entries(section);
    return sortEntries(filterEntries(base, view.filter, { owned: isOwned, balance: balance(), saved: savedIds() }), view.down);
  };

  const cardFor = (e: Entry): Card => {
    let c = cards.get(e.id);
    if (c) return c;
    const vault = inVault(e);
    const row = el('button', `bq-item${e.reward ? ' reward' : ''}${vault ? ' vault' : ''}`);
    row.type = 'button';
    row.setAttribute('role', 'option');
    row.dataset.id = e.id;
    const pic = el('span', 'bq-pic');
    pic.append(itemPicture(e.id, vault ? 240 : 200, vault ? 120 : 100));
    const heart = el('span', 'bq-heart');
    heart.append(shopIcon('heart'));
    pic.append(heart);
    const text = el('span', 'bq-text');
    const kindLine = el('span', 'bq-kind', kindText(e));
    const line = el('span', 'bq-line');
    const chip = el('span', 'bq-chip');
    line.append(el('span', 'bq-price money', e.reward ? 'Reward' : formatMoney(e.price)), chip);
    text.append(kindLine, el('span', 'bq-name', e.name), line);
    if (e.fx) text.append(el('span', 'bq-meta', `${secsText(e.fx.secs)} · ${REACH_TEXT[e.fx.reach]}`));
    let cover: HTMLElement | null = null;
    let fill: HTMLElement | null = null;
    if (!e.reward) {
      // how much of it your balance covers, as a hairline along the card's foot
      cover = el('span', 'bq-cover');
      fill = el('span', 'bq-cover-fill');
      cover.append(fill);
      if (vault) text.append(cover);
      else row.append(cover);
    }
    row.append(pic, text);
    row.addEventListener('click', () => pick(e));
    row.addEventListener('dblclick', () => primary.click());
    c = { row, chip, fill, cover, heart, state: '\0' };
    cards.set(e.id, c);
    return c;
  };

  /** The ids on show, so a repaint can tell when a filter's set has changed under it (a purchase, a balance). */
  let shownIds = '';
  /** Draw the grid; `fresh` (a new section, search or filter) brings it in from the top. */
  const renderList = (fresh = true) => {
    const here = listed();
    shownIds = here.map((e) => e.id).join();
    list.classList.toggle('mixed', !!query);
    const out: HTMLElement[] = [];
    if (section === 'vault' && !query) {
      const band = el('div', 'bq-vault-head');
      band.append(el('span', 'bq-vault-title', 'The Private Collection'), el('span', 'bq-vault-sub', 'A billion dollars and up. Each piece stands in its own case.'));
      out.push(band);
    }
    if (query) out.push(el('div', 'bq-group', here.length ? `${here.length} ${here.length === 1 ? 'piece' : 'pieces'} for "${query}"` : ''));
    let group = '';
    here.forEach((e, i) => {
      // headings: the private collection, then what's won and never sold
      if (!query && section !== 'vault') {
        const g = e.reward ? 'Won, never sold' : inVault(e) ? 'Private Collection' : '';
        if (g && g !== group) out.push(el('div', `bq-group${g === 'Private Collection' ? ' vault' : ''}`, g));
        group = g;
      }
      const c = cardFor(e);
      // a short stagger as the cards come in (CSS holds it still under calm)
      c.row.style.setProperty('--i', String(Math.min(i, 10)));
      if (fresh) c.row.classList.remove('bq-in');
      out.push(c.row);
    });
    if (here.length === 0) out.push(emptyNote());
    if (section === 'statue' && !query) out.push(statueBox);
    list.replaceChildren(...out);
    if (fresh) {
      // restart the entrance: a reflow per render, never per frame
      void list.offsetWidth;
      for (const e of here) cards.get(e.id)!.row.classList.add('bq-in');
      list.scrollTop = 0;
    }
    paintRows();
  };

  /** Nothing to show: say why, and offer the way back. */
  const emptyNote = (): HTMLElement => {
    const box = el('div', 'bq-empty-box');
    const why =
      query ? `Nothing matches "${query}".`
      : view.filter === 'owned' ? (section === 'fx' ? 'Effects are bought each time they play, so none are kept.' : 'You own none of these yet.')
      : view.filter === 'saved' ? 'Nothing saved here. Press the heart on a piece to keep it on your list.'
      : view.filter === 'afford' ? `Nothing here is within your balance of ${formatMoney(balance())}.`
      : 'Nothing here.';
    box.append(el('p', 'bq-empty', why));
    const reset = button(query ? 'Clear the search' : 'Show everything', () => {
      if (query) clearSearch(true);
      else filters.set((view.filter = 'all'));
      renderList();
      paint();
    }, { cls: 'ghost' });
    box.append(reset);
    return box;
  };

  const paintStatues = () => {
    statueBox.replaceChildren(el('div', 'bq-group', 'In the lobby now'));
    if (statues.length === 0) {
      statueBox.append(el('p', 'bq-empty', 'The three plinths by the directory are empty. The first statue goes on the middle one.'));
      return;
    }
    const mine = session.profile?.name;
    statues.forEach((s, i) => {
      const line = el('div', `bq-statue${s.name === mine ? ' mine' : ''}`);
      line.append(el('span', 'bq-statue-n', String(i + 1)), el('span', 'bq-statue-name', s.name), el('span', 'bq-statue-at', dateFmt.format(s.at)));
      statueBox.append(line);
    });
  };

  /**
   * What the chip on a card says: what you're doing with it, that it's yours, or that it's new. New
   * only marks a new piece among old ones; a section that's all new says so with its tab's dot.
   */
  const chipOf = (e: Entry, mixed: boolean): string => {
    if (e.fx) {
      const mine = deps.floor?.effects().filter((f) => f.fx === e.id && f.id === me()) ?? [];
      const now = serverNow();
      if (mine.some((f) => f.at <= now)) return 'Playing';
      return mine.length ? 'Queued' : '';
    }
    if (wearing(e)) return wearWords(e).ing;
    if (isOwned(e)) return e.reward ? 'Earned' : 'Owned';
    return !e.reward && mixed && NEW_IDS.has(e.id) ? 'New' : '';
  };

  const paintRows = () => {
    const here = listed();
    const mixed = here.some((e) => !e.reward && !NEW_IDS.has(e.id));
    const bal = balance();
    for (const e of here) {
      const c = cards.get(e.id);
      if (!c) continue;
      const on = e.id === picked.id;
      c.row.setAttribute('aria-selected', String(on));
      c.row.tabIndex = on ? 0 : -1;
      const state = chipOf(e, mixed);
      if (state !== c.state) {
        c.state = state;
        c.chip.textContent = state;
        c.chip.className = `bq-chip ${state.toLowerCase()}`.trim();
      }
      c.row.setAttribute('aria-label', `${e.name}, ${e.reward ? 'won, never sold' : formatMoney(e.price)}${state ? `, ${state.toLowerCase()}` : ''}`);
      const short = !e.reward && !isOwned(e) && e.price > bal;
      c.row.classList.toggle('short', short);
      if (c.cover && c.fill) {
        c.cover.hidden = !short;
        if (short) c.fill.style.transform = `scaleX(${Math.max(0.004, Math.min(1, bal / e.price)).toFixed(4)})`;
      }
      c.heart.hidden = !isSaved(e.id);
    }
    // a dot on the sections (and kinds) with something new you don't have yet
    const fresh = (es: Entry[]) => es.some((e) => NEW_IDS.has(e.id) && !isOwned(e) && !e.fx);
    for (const b of tabs.root.querySelectorAll<HTMLElement>('.seg-btn')) {
      const s = b.dataset.id as Section;
      b.classList.toggle('has-new', s === 'fx' ? false : s === 'wear' ? WEAR_KINDS.some((k) => fresh(entries('wear', k))) : fresh(entries(s)));
      b.classList.toggle('vault-tab', s === 'vault');
    }
    for (const b of kinds.root.querySelectorAll<HTMLElement>('.seg-btn')) b.classList.toggle('has-new', fresh(entries('wear', b.dataset.id as ItemKind)));
  };

  const capLineOf = (e: Entry): string => {
    if (inVault(e)) return `Private Collection · ${e.fx ? 'Effect' : KIND_ONE[e.kind!]} · ${formatMoney(e.price)}`;
    if (e.fx) return `Effect · ${secsText(e.fx.secs)} · ${REACH_TEXT[e.fx.reach]}`;
    const what = e.section === 'emote' ? 'Emote' : e.section === 'statue' ? 'In the lobby' : KIND_ONE[e.kind!];
    return `${what} · ${e.reward ? 'Won, never sold' : formatMoney(e.price)}`;
  };

  /** The detail's small line over the jeweller's: what it is, and what's special about it. */
  const metaOf = (e: Entry): string => {
    const parts = [kindText(e)];
    if (e.fx) parts.push(secsText(e.fx.secs), REACH_TEXT[e.fx.reach]);
    if (inVault(e)) parts.push('Private Collection');
    else if (e.reward) parts.push('Won, never sold');
    else if (NEW_IDS.has(e.id) && !isOwned(e)) parts.push('New this season');
    return parts.join(' · ');
  };

  const since = (e: Entry) => dateFmt.format(owned?.get(e.id)?.at ?? Date.now());

  /** The status line and the button, for what's picked. */
  const decide = (e: Entry): { line: { text: string; kind: '' | 'ok' | 'err' }; label: string; enabled: boolean } => {
    const short = e.price > balance();
    const buy = { label: `Buy · ${formatMoney(e.price)}`, enabled: !short && owned !== null };
    const cover = inVault(e) ? ` Your balance covers ${coverText(balance() / e.price)} of it.` : " Chips on tables don't count here.";
    const money = short
      ? { text: `You're ${formatMoney(e.price - balance())} short.${cover}`, kind: 'err' as const }
      : { text: `Balance after: ${formatMoney(balance() - e.price)}.`, kind: '' as const };
    if (owned === null && !e.fx) return { line: { text: 'Checking what you own.', kind: '' }, label: 'Buy', enabled: false };
    if (e.fx) {
      const wait = fxWait(e);
      const label = armed?.id === e.id ? `Confirm · ${formatMoney(e.price)}` : `Play it · ${formatMoney(e.price)}`;
      if (short) return { line: money, label, enabled: false };
      const now = serverNow();
      if (wait && wait.at - now > FX_MAX_WAIT_MS) return { line: { text: `Booked for the next ${Math.ceil((wait.at - now) / 60_000)} min. Try again later.`, kind: 'err' }, label, enabled: false };
      const who = e.fx.reach === 'you' ? 'Everyone near you sees it.' : e.fx.reach === 'room' ? `Everyone in ${wait ? roomName(wait.room) : 'the room'} sees it.` : 'Every room in the casino sees it.';
      let when = 'Starts as soon as you pay.';
      if (wait?.behind && wait.at > now) {
        const b = wait.behind;
        const what = entryOf(b.fx)?.name ?? 'an effect';
        const whose = b.id === me() ? `your ${what}` : e.fx.reach === 'room' ? `${what} in ${roomName(wait.room)}` : `${b.name}'s ${what}`;
        when = `Starts in ${clockText(wait.at - now)}, after ${whose}.`;
      }
      if (armed?.id === e.id) return { line: { text: `Press again to pay ${formatMoney(e.price)}; your balance will be ${formatMoney(balance() - e.price)}. ${when}`, kind: '' }, label, enabled: true };
      return { line: { text: `${when} ${who}`, kind: '' }, label, enabled: true };
    }
    if (e.section === 'statue') {
      if (!isOwned(e)) return { line: money, ...buy };
      const up = statues.some((s) => s.name === session.profile?.name);
      return { line: { text: up ? `Yours stands in the lobby, cast ${since(e)}.` : `Yours was cast ${since(e)}. The lobby shows the three newest.`, kind: '' }, label: 'Yours', enabled: false };
    }
    if (e.reward && !isOwned(e)) {
      const feat = rewardFeat(e.id);
      return { line: { text: feat ? `Not sold. ${feat.name}: ${feat.about}` : 'Not sold: won at the tables.', kind: '' }, label: 'Won, never sold', enabled: false };
    }
    if (e.section === 'emote') {
      if (!isOwned(e)) return { line: money, ...buy };
      const got = owned?.get(e.id);
      return { line: { text: `On your emote wheel (${keyLabel('emotes')}). ${got?.feat ? 'Earned' : 'Yours since'} ${since(e)}.`, kind: '' }, label: 'Show me again', enabled: true };
    }
    // worn pieces and rides
    const words = wearWords(e);
    if (wearing(e)) return { line: { text: `${words.now}. ${owned?.get(e.id)?.feat ? 'Earned' : 'Bought'} ${since(e)}.`, kind: '' }, label: words.off, enabled: true };
    if (isOwned(e)) return { line: { text: `Yours since ${since(e)}.`, kind: '' }, label: words.on, enabled: true };
    return { line: money, ...buy };
  };

  const paint = () => {
    const e = picked;
    // a filter's set can change under it (a purchase, a change of balance): the grid follows
    if (list.childElementCount && listed().map((x) => x.id).join() !== shownIds) renderList(false);
    balVal.textContent = formatMoney(balance());
    const n = owned ? owned.size : 0;
    const s = savedIds().size;
    ownVal.textContent = owned ? [n ? `${n} owned` : 'Nothing owned yet', s ? `${s} saved` : ''].filter(Boolean).join(' · ') : '';
    sub.textContent =
      query ? 'Every section, by name, what it is or what it is made of.'
      : section === 'fx' ? 'Paid each time. It plays where you stand, for everyone to see.'
      : section === 'vault' ? 'The private collection: a billion dollars and up.'
      : 'Paid from your balance. Yours to keep.';
    kinds.root.hidden = section !== 'wear' || !!query;
    tabBox.classList.toggle('searching', !!query);
    capName.textContent = NAME_IN_LIGHTS.has(e.id) ? (session.profile?.name ?? e.name) : e.name;
    capName.classList.toggle('led', NAME_IN_LIGHTS.has(e.id));
    capLine.textContent = capLineOf(e);
    selName.textContent = e.name;
    selPrice.textContent = e.reward ? 'Reward' : formatMoney(e.price);
    selMeta.textContent = metaOf(e);
    selAbout.textContent = e.about;
    foot.classList.toggle('vault', inVault(e));
    const d = decide(e);
    primary.textContent = busy ? primary.textContent : d.label;
    primary.disabled = busy || !d.enabled;
    primary.classList.toggle('armed', armed?.id === e.id);
    const saved = isSaved(e.id);
    saveBtn.setAttribute('aria-pressed', String(saved));
    saveBtn.setAttribute('aria-label', saved ? `Saved: take ${theName(e.name)} off your list` : `Save ${theName(e.name)} to your list`);
    saveBtn.title = saved ? 'Saved (on this device)' : 'Save for later (on this device)';
    const line = note ?? d.line;
    status.textContent = line.text;
    status.className = `bq-status ${line.kind}`.trim();
    if (section === 'statue') paintStatues();
    paintRows();
  };

  let replay = 0;
  const preview = (e: Entry) => {
    clearInterval(replay);
    room.setLook(previewLook(e));
    room.gilded(e.section === 'statue');
    room.vitrine(inVault(e) && !!e.kind);
    const fx = e.fx ? FX_PREVIEW[e.id] : undefined;
    room.preview(fx?.mood ?? 'none', fx?.shower ?? null);
    room.show(e.kind ? framingFor(e.kind) : 'full');
    room.still(e.section === 'emote' ? -0.2 : null);
    // an emote plays over and over while it's picked; an effect's buyer cheers once
    const act: EmoteId | null = e.section === 'emote' ? (e.id as EmoteId) : fx?.cheer ? 'cheer' : null;
    if (act && room.gesture(act) && e.section === 'emote') replay = window.setInterval(() => room.gesture(act), 4200);
  };

  const pick = (e: Entry, focus = false) => {
    // the tabs follow the piece to its section; a search keeps its results on show meanwhile, so
    // clearing it lands you where the piece lives
    const sectionChanged = e.section !== section;
    const kindChanged = e.section === 'wear' && e.kind !== kind;
    section = e.section;
    if (kindChanged) kind = e.kind!;
    tabs.set(section);
    kinds.set(kind);
    picked = e;
    note = null;
    if (armed?.id !== e.id) armed = null;
    if ((!query && (sectionChanged || kindChanged)) || list.childElementCount === 0) renderList();
    preview(e);
    deps.sfx?.play('ui-switch', { volume: 0.18 });
    paint();
    const row = cards.get(e.id)?.row;
    if (row?.isConnected) {
      row.scrollIntoView({ block: 'nearest' });
      if (focus) row.focus();
    }
  };

  // ---- the search
  const runSearch = () => {
    const q = searchIn.value.trim().slice(0, 40);
    clearBtn.hidden = searchIn.value === '';
    if (q === query) return;
    query = q;
    renderList();
    paint();
  };
  searchIn.addEventListener('input', runSearch);
  /** Back to the sections (`render`: show the section's cards again now). */
  const clearSearch = (render: boolean) => {
    if (!query && searchIn.value === '') return;
    searchIn.value = '';
    clearBtn.hidden = true;
    query = '';
    if (render) {
      renderList();
      paint();
    }
  };
  clearBtn.addEventListener('click', () => {
    clearSearch(true);
    searchIn.focus();
  });

  saveBtn.addEventListener('click', () => {
    const on = toggleSaved(picked.id);
    deps.sfx?.play('ui-click', { volume: 0.25 });
    // under the Saved filter, a piece taken off leaves the grid
    if (view.filter === 'saved') renderList();
    paint();
    toast(on ? `${theName(picked.name, true)} is on your list.` : `${theName(picked.name, true)} is off your list.`);
  });

  // ---- buying and wearing
  const own = (id: string, at: number) => {
    (owned ??= new Map()).set(id, { at });
    const p = session.profile;
    if (p && !p.owned?.includes(id)) session.set({ ...p, owned: [...(p.owned ?? []), id] });
  };

  const wear = async (e: Entry, on: boolean): Promise<void> => {
    const p = session.profile;
    if (!p || !e.kind) return;
    const stored = await deps.api.saveLook(withItem(p.look, e.kind, on ? e.id : null));
    const now = session.profile;
    if (now) session.set({ ...now, look: stored });
    room.setLook(withItem(stored, e.kind, e.id));
  };

  /** What happens once it's yours, for the confirm. */
  const afterwards = (e: Entry): string => {
    if (e.kind === 'ride') return `You ride out on it, and ${keyLabel('ride')} gets you on and off.`;
    if (e.kind) return 'You walk out wearing it.';
    if (e.section === 'emote') return `It goes on your emote wheel (${keyLabel('emotes')}).`;
    return 'Your statue goes up in the lobby, by the directory.';
  };

  const buy = (e: Entry) => {
    const now = balance();
    const after = now - e.price;
    // one purchase, one op id: a retried request after a dropped answer is still this purchase
    const op = newOp();
    const go = button(inVault(e) ? `Buy for ${formatMoney(e.price)}` : 'Buy', async () => {
      m.close();
      busy = true;
      note = { text: `Buying ${theName(e.name)}.`, kind: '' };
      primary.textContent = 'Buying';
      paint();
      try {
        const r = await deps.api.buy(e.id, op);
        applyMoney(session, r, r.price);
        own(e.id, r.at);
        deps.sfx?.play('chips-stack', { volume: 0.5 });
        if (e.kind) {
          // walk out wearing it (riding it), the way a shop hands it over
          await wear(e, true).catch(() => {});
          note = { text: `${theName(e.name, true)} is yours. ${wearWords(e).now}.`, kind: 'ok' };
        } else if (e.section === 'emote') {
          room.gesture(e.id as EmoteId);
          note = { text: `${theName(e.name, true)} is on your emote wheel. Press ${keyLabel('emotes')} on the floor.`, kind: 'ok' };
        } else {
          const p = session.profile;
          if (p && !statues.some((s) => s.name === p.name)) statues = [{ name: p.name, look: previewLook(e), at: r.at }, ...statues].slice(0, 3);
          note = { text: 'Your statue is going up in the lobby, by the directory.', kind: 'ok' };
        }
        toast(`Bought ${theName(e.name)} for ${formatMoney(r.price)}.`);
      } catch (err) {
        const body = (err as { body?: { error?: string; balance?: number; inPlay?: number } }).body;
        if (body?.error === 'NOT_ELIGIBLE' && /already own/.test(problemText(err))) own(e.id, Date.now());
        const p = session.profile;
        if (p && body?.balance !== undefined && body.inPlay !== undefined) session.set({ ...p, balance: body.balance, inPlay: body.inPlay });
        note = { text: problemText(err), kind: 'err' };
      } finally {
        busy = false;
        paint();
      }
    }, { cls: 'primary' });
    // the confirm: the piece, the price, and the balance before and after
    const pic = el('canvas', 'bq-confirm-art');
    pic.setAttribute('aria-hidden', 'true');
    drawItem(pic, e.id, 260, 130);
    const rows = el('div', 'bq-confirm-rows');
    const row = (label: string, value: string, cls = '') => {
      const r = el('div', `bq-confirm-row ${cls}`.trim());
      r.append(el('span', '', label), el('span', 'money', value));
      return r;
    };
    rows.append(row('Your balance', formatMoney(now)), row(theName(e.name, true), `−${formatMoney(e.price)}`), row('Balance after: ', formatMoney(after), 'after'));
    const body: HTMLElement[] = [pic, el('p', 'bq-confirm-price money', formatMoney(e.price)), rows];
    if (inVault(e)) body.unshift(el('p', 'bq-confirm-tag', 'From the Private Collection'));
    const m = modal(
      `Buy ${theName(e.name)}?`,
      [...body, el('p', 'bq-confirm-note', `It comes out of your balance; chips on tables stay where they are. ${afterwards(e)}`)],
      [go, button('Cancel', () => m.close(), { cls: 'ghost' })],
      () => m.close(),
    );
    m.root.classList.add('bq-confirm');
    m.root.classList.toggle('vault', inVault(e));
    go.focus();
  };

  /** An effect: the first press arms it, the second (within a few seconds) pays and plays it. */
  let fxOp: { id: string; op: string } | null = null;
  let disarm = 0;
  const playFx = async (e: Entry) => {
    const now = Date.now();
    if (!armed || armed.id !== e.id || armed.until < now) {
      armed = { id: e.id, until: now + ARM_MS };
      clearTimeout(disarm);
      disarm = window.setTimeout(() => {
        armed = null;
        paint();
      }, ARM_MS);
      deps.sfx?.play('ui-click', { volume: 0.3 });
      paint();
      return;
    }
    armed = null;
    clearTimeout(disarm);
    // a retry of a dropped answer is the same purchase; a new press after an answer is a new one
    fxOp = fxOp?.id === e.id ? fxOp : { id: e.id, op: newOp() };
    busy = true;
    primary.textContent = 'Paying';
    paint();
    try {
      const r = await deps.api.fx(e.id, fxOp.op);
      fxOp = null;
      applyMoney(session, r, e.price);
      deps.sfx?.play('chips-stack', { volume: 0.45 });
      const wait = r.fx.at - serverNow();
      note = wait > 1500
        ? { text: `Paid. ${e.name} starts in ${clockText(wait)}.`, kind: 'ok' }
        : { text: `${e.name} is going off where you stand. Close the boutique to watch it.`, kind: 'ok' };
      toast(`${e.name}, ${formatMoney(e.price)}.`);
    } catch (err) {
      const body = (err as { status?: number; body?: { balance?: number; inPlay?: number } }).body;
      // a refusal is final for this op; a dropped answer or a server error keeps it, so pressing
      // again is a retry of the same purchase and can't pay twice
      const st = (err as { status?: number }).status;
      if (st && st < 500) fxOp = null;
      const p = session.profile;
      if (p && body?.balance !== undefined && body.inPlay !== undefined) session.set({ ...p, balance: body.balance, inPlay: body.inPlay });
      note = { text: problemText(err), kind: 'err' };
    } finally {
      busy = false;
      paint();
    }
  };

  primary.addEventListener('click', async () => {
    if (busy || primary.disabled) return;
    const e = picked;
    if (e.fx) return playFx(e);
    if (!isOwned(e)) return buy(e);
    if (e.section === 'emote') {
      room.gesture(e.id as EmoteId);
      return;
    }
    if (!e.kind) return;
    busy = true;
    const on = !wearing(e);
    primary.textContent = on ? (e.kind === 'ride' ? 'Getting on' : 'Putting it on') : e.kind === 'ride' ? 'Getting off' : 'Taking it off';
    paint();
    try {
      await wear(e, on);
      deps.sfx?.play('ui-click', { volume: 0.4 });
      note = null;
    } catch (err) {
      note = { text: problemText(err), kind: 'err' };
    } finally {
      busy = false;
      paint();
    }
  });

  // ---- keys: the arrows through the cards, Enter for the button, Q/E turn (never while typing)
  /** How many cards a row of the grid holds now (read on a key press, not per frame). */
  const columns = (rows: HTMLElement[]): number => {
    const top = rows[0]?.offsetTop;
    const n = rows.findIndex((r) => r.offsetTop !== top);
    return n < 0 ? rows.length : n;
  };
  root.addEventListener('keydown', (ev) => {
    if (GLOBAL_KEYS.has(ev.key)) return;
    ev.stopPropagation();
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (isTyping(ev)) {
      // from the search, Down goes into the results
      if (ev.key === 'ArrowDown' || ev.key === 'Enter') {
        const firstCard = listed()[0];
        if (firstCard) {
          ev.preventDefault();
          pick(firstCard, true);
        }
      }
      return;
    }
    const inTabs = (ev.target as HTMLElement).closest('[role="radiogroup"]');
    const here = listed();
    const at = here.findIndex((i) => i.id === picked.id);
    const step = (by: number) => {
      if (!here.length) return;
      const next = at < 0 ? 0 : Math.max(0, Math.min(here.length - 1, at + by));
      pick(here[next]!, true);
    };
    const inList = (ev.target as HTMLElement).closest('.bq-list');
    if (!inTabs && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      const cols = inList ? columns(here.map((e) => cards.get(e.id)!.row)) : 1;
      step(ev.key === 'ArrowDown' ? cols : -cols);
    } else if (inList && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) step(ev.key === 'ArrowRight' ? 1 : -1);
    else if (inList && (ev.key === 'Home' || ev.key === 'End')) step(ev.key === 'Home' ? -here.length : here.length);
    else if (ev.code === 'KeyQ') room.turn(-0.3);
    else if (ev.code === 'KeyE') room.turn(0.3);
    else if (ev.key === 'Enter' && inList) primary.click();
    else if (ev.key === '/' && !ev.shiftKey) searchIn.focus();
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
    room.turn((ev.clientX - drag.x) * 0.012);
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
  // effects start and end while it's open: the chips and the start times follow
  const ticker = window.setInterval(() => !closed && !busy && section === 'fx' && !query && paint(), 1000);
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(replay);
    clearInterval(ticker);
    clearTimeout(disarm);
    release();
    offSession();
    removeEventListener('resize', onResize);
    room.dispose();
    root.classList.add('closing');
    setTimeout(() => root.remove(), 200);
    deps.onClose?.();
  };
  // Esc: out of a search first, then out of the boutique
  const release = holdKeyboard(root, () => (query || searchIn.value ? clearSearch(true) : close()));
  const offSession = session.on(() => !closed && paint());

  filters.set(view.filter);
  pick(first);
  deps.api
    .shop()
    .then((r) => {
      if (closed) return;
      owned = new Map(r.owned.map((o) => [o.item, { at: o.at, ...(o.feat ? { feat: o.feat } : {}) }]));
      statues = deps.floor?.statues.length ? deps.floor.statues : r.statues;
      if (view.filter !== 'all') renderList();
      paint();
    })
    .catch((err) => {
      if (closed) return;
      owned = new Map();
      note = { text: problemText(err), kind: 'err' };
      paint();
    });
  queueMicrotask(() => {
    const row = cards.get(picked.id)?.row;
    if (row?.isConnected) row.focus();
    else focusFirst(panel);
  });
  return { root, close };
}
