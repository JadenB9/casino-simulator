// The Pai Gow Poker table view. Every hand plays out the way the server already settled it: seven
// cards to each player and seven to the dealer, your own turned over and set in the panel along
// the bottom, the others set face down into their boxes, the dealer's seven turned and set by the
// house way, then each hand turned over and compared, high against high and low against low, and
// paid (less the commission), pushed or swept where it lies.
//
// Hands sit at spots numbered like the seats. At a shared table you play your seat's; alone you
// can play up to three, and set them one at a time, first base first.

import * as THREE from 'three';
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { TableView, TableViewCtx } from '../contract.ts';
import type { Member } from '../../../../shared/src/protocol.ts';
import type { TableConfig, GameEvent } from '../../../../shared/src/engine.ts';
import { type BetLimits, type Cents, BETTING_CHIPS, formatMoney } from '../../../../shared/src/money.ts';
import { maxBet } from '../../../../shared/src/limits.ts';
import { BETTING_MS, MAX_SPOTS, SETTING_MS } from '../../../../shared/src/games/paigow/engine.ts';
import type { PaiGowEvent, PaiGowView, SeatView } from '../../../../shared/src/games/paigow/protocol.ts';
import {
  type FortunePays,
  type PgCard,
  type Setting,
  type Settlement,
  DEFAULT_FORTUNE,
  FORTUNE_NAMES,
  highName,
  highScore,
  lowName,
  lowScore,
} from '../../../../shared/src/games/paigow/rules.ts';
import { houseWayAdvice } from '../../../../shared/src/games/paigow/advice.ts';
import { dealCard, flipCard } from '../../table/cards.ts';
import { isChipKey } from '../../table/keys.ts';
import { ChipStack, slideStack } from '../../table/chips.ts';
import { celebrate } from '../../table/celebrate.ts';
import type { Felt } from '../../table/felt.ts';
import { ease, tween, wait } from '../../table/tween.ts';
import { ChipTray, button, el } from '../../ui/kit.ts';
import { serverNow } from '../../net/clock.ts';
import { handMoment } from './moments.ts';
import { HandSetter } from './setter.ts';
import { PgCardMesh } from './joker.ts';
import {
  TOP_Y,
  RACK,
  SHUFFLER,
  DISCARD,
  DEALER_CARD_SCALE,
  DEALER_LABEL,
  SEAT_COUNT,
  BET_RADIUS,
  FORTUNE_RADIUS,
  FORTUNE_R,
  BET_R,
  betPoint,
  boardPoints,
  cameraPose,
  dealerCard,
  fortunePayoutPoint,
  fortunePoint,
  handLabelPoint,
  makeFelt,
  onSeat,
  payoutPoint,
  positionOf,
  railPoint,
  seatCard,
  spotsPose,
} from './layout.ts';
import { FLOOR_FELT } from './model.ts';
import { SpotPicker } from '../multihand/picker.ts';
import { glideTo, setSpotsInPlay } from '../multihand/frame.ts';
import { oneAtATime } from '../multihand/turns.ts';
import './paigow.css';

const RACK_POINT = new THREE.Vector3(RACK.x, TOP_Y + 0.012, RACK.z);

type Bets = { bet: Cents; fortune: Cents };
const NO_BETS: Bets = { bet: 0, fortune: 0 };

function money(n: Cents): string {
  return formatMoney(n);
}

function signed(n: Cents): string {
  return n === 0 ? '$0' : formatMoney(n, { sign: true });
}

function placard(cfg: TableConfig): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 300;
  const g = c.getContext('2d')!;
  g.fillStyle = '#07160f';
  g.fillRect(0, 0, 512, 300);
  g.strokeStyle = '#d8b06a';
  g.lineWidth = 6;
  g.strokeRect(12, 12, 488, 276);
  g.fillStyle = '#f1d59a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 40px Cinzel, Georgia, serif';
  g.fillText('PAI GOW POKER', 256, 60);
  const bet = cfg.limits.bet ?? cfg.limits.default;
  const fortune = cfg.limits.fortune ?? cfg.limits.default;
  g.font = '600 62px "Barlow Condensed", sans-serif';
  g.fillText(`${money(bet.min)} – ${money(bet.max)}`, 256, 144);
  g.font = '600 32px "Barlow Condensed", sans-serif';
  g.fillStyle = '#e8e0cc';
  g.fillText('5% COMMISSION ON WINS', 256, 206);
  g.fillText(`FORTUNE ${money(fortune.min)} – ${money(fortune.max)}`, 256, 250);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.088), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
  sign.position.set(0.47, TOP_Y + 0.05, -0.475);
  sign.rotation.x = -0.28;
  sign.name = 'pg-placard';
  return sign;
}

/** Exact Fortune house edge of a pay table, from the counts over all 154,143,080 hands. */
function fortuneEdge(pay: FortunePays): number {
  const counts = [32, 72, 196, 1_128, 26_020, 184_644, 307_472, 4_188_528, 6_172_088, 7_672_500, 11_034_204];
  let ev = -124_556_196;
  counts.forEach((n, i) => (ev += pay[i]! * n));
  return -ev / 154_143_080;
}

export function mountPaiGow(ctx: TableViewCtx): TableView {
  const root = new THREE.Group();
  ctx.stage.root.add(root);
  const canvas = ctx.stage.engine.renderer.domElement;
  const floorFelt = ctx.stage.anchor.getObjectByName(FLOOR_FELT) ?? null;

  let felt: Felt | null = null;
  let sign: THREE.Mesh | null = null;
  let cfg: TableConfig | null = null;
  let pay: FortunePays = DEFAULT_FORTUNE;
  let mode: 'solo' | 'multi' = 'solo';
  let me: number | null = null;
  let stack: Cents = 0;
  let view: PaiGowView | null = null;
  let latest: PaiGowView | null = null;
  let members: Member[] = [];
  let spots: number[] = [];

  let wanted: Record<number, Bets> = {};
  let history: Record<number, Bets>[] = [];
  let last: Record<number, Bets> | null = null;
  let lastNet: Cents | null = null;
  let roundNet: Cents = 0;
  let readyOn = false;
  let lastAction: 'bet' | 'other' = 'other';
  let resync = false;
  // hands whose setting is on its way
  const sent = new Set<number>();
  let framed: number | null = null;
  let disposed = false;
  const inTurn = oneAtATime();

  const owns = (spot: number): boolean => me !== null && (mode === 'solo' || spot === me);
  const betsOf = (spot: number): Bets => wanted[spot] ?? NO_BETS;
  const total = (b: Record<number, Bets>): Cents => Object.values(b).reduce((a, x) => a + x.bet + x.fortune, 0);
  const lim = (kind: 'bet' | 'fortune'): BetLimits | null => (cfg ? (cfg.limits[kind] ?? cfg.limits.default) : null);

  // ---- table objects -----------------------------------------------------------------------

  const stacks = new Map<string, ChipStack>();
  const stackAt = (seat: number, kind: 'bet' | 'fortune'): ChipStack => {
    const key = `${kind}:${seat}`;
    let s = stacks.get(key);
    if (!s) {
      s = new ChipStack();
      s.position.copy(kind === 'bet' ? betPoint(seat) : fortunePoint(seat));
      root.add(s);
      stacks.set(key, s);
    }
    return s;
  };
  let payouts: { seat: number; stack: ChipStack }[] = [];
  /** Each seat's seven cards, in the order dealt. */
  const hands = new Map<number, PgCardMesh[]>();
  let dealerCards: PgCardMesh[] = [];
  const labels = new Map<string, { el: HTMLElement; obj: CSS2DObject }>();

  const setLabel = (key: string, at: THREE.Vector3, parts: { text: string; cls?: string }[], cls: string, hang?: 'below' | 'above'): void => {
    let l = labels.get(key);
    if (!l) {
      const e = el('div', cls);
      l = { el: e, obj: ctx.stage.label(e, at) };
      labels.set(key, l);
    }
    l.el.className = cls;
    l.el.replaceChildren(...parts.map((p) => el('span', p.cls ?? '', p.text)));
    l.obj.position.copy(at);
    l.obj.center.set(0.5, hang === 'below' ? 0 : hang === 'above' ? 1 : 0.5);
  };
  const dropLabel = (key: string): void => {
    const l = labels.get(key);
    if (!l) return;
    l.obj.removeFromParent();
    l.el.remove();
    labels.delete(key);
  };
  const dropLabels = (prefix: string): void => {
    for (const key of [...labels.keys()]) if (key.startsWith(prefix)) dropLabel(key);
  };

  const newCard = (card: PgCard | null): PgCardMesh => {
    const m = new PgCardMesh(card);
    m.rotation.order = 'YXZ';
    root.add(m);
    return m;
  };
  const removeCards = (cards: PgCardMesh[]): void => {
    for (const c of cards) c.removeFromParent();
  };

  // ---- DOM ---------------------------------------------------------------------------------

  const tray = new ChipTray({
    undo: () => undo(),
    clear: () => clear(),
    rebet: () => rebet(1),
    double: () => rebet(2),
    max: { mode: 'pick' },
    primary: { label: 'Deal', key: 'Space', run: () => primary() },
  });
  tray.select(BETTING_CHIPS[2]!);
  ctx.ui.append(tray.root);
  const picker = new SpotPicker(MAX_SPOTS, (n) => pickSpots(n));
  ctx.ui.append(picker.root);

  const setter = new HandSetter((low) => setHand(low));
  ctx.ui.append(setter.root);

  const meters = el('div', 'pg-meters panel');
  const meterStack = el('span', 'money');
  const meterBet = el('span', 'money');
  const meterLast = el('span', 'money');
  meters.append(el('span', 'label', 'Chips'), meterStack, el('span', 'label', 'Bet'), meterBet, el('span', 'label', 'Last hand'), meterLast);
  ctx.ui.append(meters);

  const SVG = 'http://www.w3.org/2000/svg';
  const clock = el('div', 'pg-clock');
  const ring = document.createElementNS(SVG, 'svg');
  ring.setAttribute('viewBox', '0 0 44 44');
  ring.classList.add('pg-ring');
  const track = document.createElementNS(SVG, 'circle');
  const left = document.createElementNS(SVG, 'circle');
  for (const c of [track, left]) {
    c.setAttribute('cx', '22');
    c.setAttribute('cy', '22');
    c.setAttribute('r', '19');
  }
  track.classList.add('track');
  left.classList.add('left');
  const CIRC = 2 * Math.PI * 19;
  left.setAttribute('stroke-dasharray', CIRC.toFixed(2));
  ring.append(track, left);
  const clockText = el('span', 'pg-clock-text');
  clock.append(ring, clockText);
  clock.hidden = true;
  ctx.ui.append(clock);

  const rules = el('div', 'pg-rules panel');
  rules.hidden = true;
  const rulesBtn = button('Rules', () => (rules.hidden = !rules.hidden), { cls: 'ghost pg-rules-btn', key: 'I' });
  ctx.ui.append(rules, rulesBtn);

  const fillRules = (): void => {
    const p = (t: string) => el('p', '', t);
    const t = el('div', 'pg-paytable');
    t.append(el('div', 'label', 'Fortune bonus, on the best hand in your seven'));
    FORTUNE_NAMES.forEach((name, i) => {
      const r = el('div', 'row');
      r.append(el('span', '', name), el('span', 'money', `${pay[i]} to 1`));
      t.append(r);
    });
    rules.replaceChildren(
      el('h3', '', 'Pai Gow Poker'),
      p('Seven cards each, from 52 and a joker. Set them into a five-card high hand and a two-card low hand; the high hand must be the better one. The dealer sets theirs by the house way.'),
      p('Win both hands and the bet pays even money, less a 5% commission. Win one and it pushes. Lose both, or tie (a copy) and lose the other, and the dealer takes it: copies go to the dealer.'),
      p('The joker plays as an ace, or as any card that finishes a straight, a flush or a straight flush. Five aces beat a royal flush, and A-2-3-4-5 is the second-highest straight. A two-card hand is a pair or two high cards.'),
      t,
      p('The house way (Trump Plaza): no pair, the top card behind and the next two in front; one pair behind, the next two in front; two pair split unless both are small with a king or better to play in front, or with an ace for higher pairs; aces split; a straight or flush behind with the best two left in front. House way (H) sets your cards that way.'),
      p(`Set by the house way, the bet gives the house 2.73% of the bet. Fortune: ${(fortuneEdge(pay) * 100).toFixed(2)}%.`),
      el('p', 'pg-keys', '1-8 chips · A max, then click the bet or the Fortune · Space deal, set · H house way · R rebet · Shift R double · X clear · Backspace undo'),
    );
  };

  // ---- helpers over the current view -------------------------------------------------------

  const seatView = (seat: number | null): SeatView | undefined => (seat === null || !view ? undefined : view.seats[seat]);
  /** My hand still to set, first base first. */
  const settingSpot = (): number | null => {
    if (view?.phase !== 'setting') return null;
    const open = spots.filter((s) => seatView(s) && !seatView(s)!.set && seatView(s)!.cards.length === 7 && !sent.has(s));
    return open.sort((a, b) => positionOf(a) - positionOf(b))[0] ?? null;
  };
  const canBet = (): boolean => {
    if (me === null || !latest) return false;
    if (mode === 'multi') return latest.phase === 'betting';
    return latest.phase !== 'setting';
  };

  const renderMeters = (): void => {
    let live = 0;
    for (const spot of spots) {
      const sv = seatView(spot);
      if (view && sv && view.phase === 'setting') live += sv.bet + sv.fortune;
    }
    meterStack.textContent = money(stack);
    meterBet.textContent = money(view?.phase === 'betting' ? total(wanted) : live);
    meterLast.textContent = lastNet === null ? '–' : signed(lastNet);
    meterLast.className = `money ${lastNet === null || lastNet === 0 ? '' : lastNet > 0 ? 'up' : 'down'}`;
  };

  const renderControls = (): void => {
    const up = settingSpot();
    const sv = seatView(up);
    if (up !== null && sv && sv.cards.every((c) => c !== null)) {
      const mine = spots.filter((s) => seatView(s)?.cards.length).sort((a, b) => positionOf(a) - positionOf(b));
      setter.show(sv.cards as PgCard[], mine.length > 1 ? `Set hand ${mine.indexOf(up) + 1} of ${mine.length}` : 'Set your hand');
    } else setter.hide();
    tray.root.classList.toggle('pg-away', setter.open);
    picker.show(mode === 'solo' && canBet());
    picker.set(Math.max(1, spots.length));
    renderTip();
    if (mode === 'solo') tray.setPrimary('Deal', !!view && view.phase === 'betting' && total(wanted) > 0);
    else tray.setPrimary(readyOn ? 'Waiting' : 'Ready', !!view && view.phase === 'betting' && me !== null);
    renderRings();
    renderMeters();
  };

  const renderTip = (): void => {
    const sv = seatView(settingSpot());
    const a = ctx.tips.on && setter.open && sv && sv.cards.every((c) => c !== null) ? houseWayAdvice(sv.cards as PgCard[]) : null;
    setter.houseBtn.classList.toggle('tip-pick', !!a);
    ctx.kit.tip(a ? a.text : null);
  };
  const offTips = ctx.tips.subscribe(() => renderTip());

  const celebrateHand = (spot: number, r: Settlement, setting: Setting): void => {
    const m = handMoment(r, setting, pay);
    if (!m) return;
    inTurn(() => {
      if (disposed) return;
      celebrate(ctx, { ...m, at: seatCard(spot, 'high', 2).pos, glow: [hands.get(spot) ?? []] });
    });
  };

  // ---- drawing the whole table from a view -------------------------------------------------

  /** Where each of a seat's seven cards lies: fanned as dealt, or split into its two boxes once set. */
  const cardSlots = (seat: number, cards: (PgCard | null)[], setting: Setting | null, set: boolean): { pos: THREE.Vector3; yaw: number }[] => {
    if (!set) return cards.map((_, i) => seatCard(seat, 'seven', i));
    // a hand set face down: the first five of its meshes behind, the last two in front; a hand we
    // can see: each card where the setting put it
    let hi = 0;
    let lo = 0;
    return cards.map((c, i) => {
      const low = setting && c ? setting.low.includes(c) : i >= 5;
      return low ? seatCard(seat, 'low', lo++) : seatCard(seat, 'high', hi++);
    });
  };

  const layCards = (seat: number, sv: SeatView): void => {
    let ms = hands.get(seat);
    if (!ms || ms.length !== 7) {
      removeCards(ms ?? []);
      ms = sv.cards.map(() => newCard(null));
      hands.set(seat, ms);
    }
    const slots = cardSlots(seat, sv.cards, sv.setting, sv.set);
    ms.forEach((m, i) => {
      const c = sv.cards[i] ?? null;
      if (c && m.face !== c) m.show(c);
      m.position.copy(slots[i]!.pos);
      m.rotation.set(c ? 0 : Math.PI, slots[i]!.yaw, 0);
    });
  };

  const handCls = (seat: number): string => `pg-hand${owns(seat) ? ' mine' : ''}${owns(seat) && spots.length > 1 ? ' stack' : ''}`;

  /** A hand's label once set: its two hands, then what it came to. */
  const handLabel = (seat: number, sv: SeatView): void => {
    const s = sv.setting;
    if (!s) {
      dropLabel(`hand:${seat}`);
      return;
    }
    const r = sv.result;
    // once compared, each hand in the colour of how it did against the dealer's
    const how = (won: boolean) => (r && r.outcome !== null ? (won ? ' won' : ' lost') : '');
    const parts: { text: string; cls?: string }[] = [
      { text: highName(highScore(s.high)), cls: `high${how(!!r?.highWins)}` },
      { text: lowName(lowScore(s.low)), cls: `low${how(!!r?.lowWins)}` },
    ];
    if (r) {
      const net = r.returned - r.wagered;
      parts.push({ text: r.outcome === 'push' && r.fortune === 0 ? 'Push' : signed(net), cls: net > 0 ? 'net up' : net < 0 ? 'net down' : 'net' });
    }
    setLabel(`hand:${seat}`, handLabelPoint(seat), parts, handCls(seat), 'below');
  };

  const dealerLabel = (s: Setting): void => {
    setLabel(
      'dealer',
      DEALER_LABEL.clone(),
      [
        { text: 'Dealer', cls: 'pg-dealer-word' },
        { text: highName(highScore(s.high)), cls: 'pg-dealer-hand' },
        { text: lowName(lowScore(s.low)), cls: 'pg-dealer-low' },
      ],
      'pg-hand pg-dealer',
      'below',
    );
  };

  const scaleTo = (m: PgCardMesh, to: number, ms: number): Promise<void> => {
    const from = m.scale.x;
    return tween(ms, (k) => m.scale.setScalar(from + (to - from) * k), ease.out);
  };

  const clearPayouts = (): void => {
    for (const p of payouts) p.stack.removeFromParent();
    payouts = [];
  };

  /** The dealer's seven: in a row until set, then in the dealer's boxes. */
  const layDealer = (cards: (PgCard | null)[], setting: Setting | null): void => {
    if (dealerCards.length !== 7) {
      removeCards(dealerCards);
      dealerCards = cards.map(() => newCard(null));
    }
    let hi = 0;
    let lo = 0;
    dealerCards.forEach((m, i) => {
      const c = cards[i] ?? null;
      if (c && m.face !== c) m.show(c);
      const at = setting && c ? (setting.low.includes(c) ? dealerCard('low', lo++) : dealerCard('high', hi++)) : dealerCard('seven', i);
      m.position.copy(at);
      m.rotation.set(c ? 0 : Math.PI, 0, 0);
      m.scale.setScalar(DEALER_CARD_SCALE);
    });
  };

  const draw = (v: PaiGowView): void => {
    view = v;
    spots = v.mine ?? (me !== null ? [me] : []);
    if (resync) wanted = serverBets();
    for (const spot of [...sent]) if (v.phase !== 'setting' || v.seats[spot]?.set) sent.delete(spot);
    clearPayouts();
    const live = v.phase === 'betting' || v.phase === 'setting';
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      const sv = v.seats[seat];
      const own = spots.includes(seat) && v.phase === 'betting';
      const b = betsOf(seat);
      for (const kind of ['bet', 'fortune'] as const) {
        const amount = own ? b[kind] : live && sv ? sv[kind] : 0;
        const s = stackAt(seat, kind);
        if (s.amount !== amount) s.set(amount);
      }
      if (sv && sv.cards.length === 7 && v.phase !== 'betting') layCards(seat, sv);
      else {
        removeCards(hands.get(seat) ?? []);
        hands.delete(seat);
      }
      if (sv && v.phase !== 'betting') handLabel(seat, sv);
      else dropLabel(`hand:${seat}`);
    }
    if (v.dealer.length === 7) {
      layDealer(v.dealer, v.dealerSetting);
      if (v.dealerSetting) dealerLabel(v.dealerSetting);
      else dropLabel('dealer');
    } else {
      removeCards(dealerCards);
      dealerCards = [];
      dropLabel('dealer');
    }
    if (!canBet()) {
      hoverRing.visible = false;
      tipObj.visible = false;
    }
    if (v.phase !== 'betting') {
      wanted = {};
      history = [];
    }
    frame();
    renderControls();
  };

  const frame = (): void => {
    const n = mode === 'solo' ? Math.max(1, spots.length) : 1;
    setSpotsInPlay('paigow', n);
    const fit = (ctx.stage as { board?: (...parts: THREE.Vector3[][]) => void }).board;
    fit?.call(ctx.stage, boardPoints(spots.length ? spots : Array.from({ length: SEAT_COUNT }, (_, i) => i)));
    if (framed !== null && framed !== n && !disposed) void glideTo(ctx.stage, n > 1 ? spotsPose(spots, ctx.stage.engine.camera.aspect) : cameraPose(me ?? 0));
    framed = n;
  };

  const serverBets = (): Record<number, Bets> => {
    const out: Record<number, Bets> = {};
    if (view?.phase !== 'betting') return out;
    for (const spot of spots) {
      const sv = seatView(spot);
      if (sv) out[spot] = { bet: sv.bet, fortune: sv.fortune };
    }
    return out;
  };

  // ---- the player's moves --------------------------------------------------------------------

  const sendBets = (next: Record<number, Bets>, push = true): void => {
    if (!canBet()) return;
    resync = false;
    const changed = spots.filter((s) => {
      const a = betsOf(s);
      const b = next[s] ?? NO_BETS;
      return a.bet !== b.bet || a.fortune !== b.fortune;
    });
    if (changed.length === 0) return;
    if (push) history.push(structuredClone(wanted));
    wanted = structuredClone(next);
    lastAction = 'bet';
    for (const spot of changed) {
      const b = betsOf(spot);
      stackAt(spot, 'bet').set(b.bet);
      stackAt(spot, 'fortune').set(b.fortune);
      ctx.link.act({ type: 'bet', bet: b.bet, fortune: b.fortune, spot });
    }
    renderControls();
  };

  const addChip = (spot: number, kind: 'bet' | 'fortune'): void => {
    if (!canBet()) return;
    const b = betsOf(spot);
    if (kind === 'fortune' && b.bet === 0) return ctx.kit.toast('The Fortune bonus goes with a bet on the hand: bet that first.');
    const l = lim(kind);
    let add = tray.selected.value;
    if (l && b[kind] + add < l.min) add = Math.ceil((l.min - b[kind]) / l.step) * l.step;
    if (tray.maxPicked && l) {
      const m = maxBet({ limits: l, current: b[kind], stack });
      if ('none' in m) return ctx.kit.toast(m.none === 'AT_MAX' ? `That bet is already at the table maximum, ${money(l.max)}.` : `Not enough chips for the ${money(l.min)} minimum there.`);
      add = m.amount;
    }
    ctx.sfx.play('chip-lay');
    sendBets({ ...wanted, [spot]: { ...b, [kind]: b[kind] + add } });
  };

  const undo = (): void => {
    const prev = history.pop();
    if (prev) sendBets(prev, false);
  };
  const clear = (): void => {
    if (total(wanted) > 0) sendBets({});
  };
  const rebet = (times: number): void => {
    const from = times > 1 && total(wanted) > 0 ? wanted : last;
    if (!from) return;
    const next: Record<number, Bets> = {};
    for (const spot of spots) if (from[spot]) next[spot] = { bet: from[spot]!.bet * times, fortune: from[spot]!.fortune * times };
    ctx.sfx.play('chips-handle');
    sendBets(next);
  };

  const pickSpots = (n: number): void => {
    if (mode !== 'solo' || !canBet()) return;
    for (const spot of Object.keys(wanted).map(Number)) if (spot >= n) delete wanted[spot];
    history = [];
    lastAction = 'other';
    ctx.sfx.play('ui-click');
    ctx.link.act({ type: 'spots', n });
  };

  const primary = (): void => {
    if (!latest || me === null) return;
    if (setter.open) {
      setter.submit();
      return;
    }
    if (mode === 'solo') {
      if (!canBet()) return;
      if (total(wanted) === 0) rebet(1);
      if (total(wanted) === 0) {
        ctx.kit.say('Place a bet first', 1800);
        return;
      }
      lastAction = 'other';
      ctx.link.act({ type: 'deal' });
      return;
    }
    if (latest.phase !== 'betting') return;
    readyOn = !readyOn;
    ctx.link.ready(readyOn);
    ctx.sfx.play('ui-click');
    renderControls();
  };

  /** Set the hand up now: these two (of the seven as dealt) in front. */
  const setHand = (low: [number, number]): void => {
    const spot = settingSpot();
    if (spot === null || latest?.phase !== 'setting' || latest.seats[spot]?.set) return;
    ctx.sfx.play('card-place');
    sent.add(spot);
    setter.hide();
    renderTip();
    lastAction = 'other';
    ctx.link.act({ type: 'set', low, spot });
    renderControls();
  };

  // ---- pointer: bet on my spots -------------------------------------------------------------

  const hoverGeo = new THREE.RingGeometry(1.02, 1.18, 48);
  const hoverRing = new THREE.Mesh(hoverGeo, new THREE.MeshBasicMaterial({ color: '#f5dc9c', transparent: true, opacity: 0.75, depthWrite: false }));
  hoverRing.rotation.x = -Math.PI / 2;
  hoverRing.visible = false;
  root.add(hoverRing);
  const tip = el('div', 'pg-tip');
  const tipObj = ctx.stage.label(tip, new THREE.Vector3());
  tipObj.visible = false;

  const mySpotAt = (e: PointerEvent): { spot: number; kind: 'bet' | 'fortune' } | null => {
    if (e.target !== canvas || me === null) return null;
    const id = ctx.stage.pick(e)?.region ?? '';
    for (const spot of spots) {
      if (id === `bet:${spot}`) return { spot, kind: 'bet' };
      if (id === `fortune:${spot}`) return { spot, kind: 'fortune' };
    }
    return null;
  };
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const at = mySpotAt(e);
    if (at) addChip(at.spot, at.kind);
  };
  const onMove = (e: PointerEvent): void => {
    const at = canBet() ? mySpotAt(e) : null;
    hoverRing.visible = at !== null;
    tipObj.visible = at !== null;
    canvas.style.cursor = at ? 'pointer' : '';
    if (!at) return;
    const r = at.kind === 'bet' ? BET_RADIUS : FORTUNE_RADIUS;
    hoverRing.position.copy(at.kind === 'bet' ? betPoint(at.spot, TOP_Y + 0.0015) : fortunePoint(at.spot, TOP_Y + 0.0015));
    hoverRing.scale.set(r, r, 1);
    tipObj.position.copy(onSeat(at.spot, at.kind === 'bet' ? BET_R : FORTUNE_R, 0.15, TOP_Y + 0.02));
    const amount = betsOf(at.spot)[at.kind];
    tip.textContent = at.kind === 'bet' ? `BET · wins pay 1 to 1 less 5%${amount ? ` · ${money(amount)}` : ''}` : `FORTUNE · pays up to ${pay[0]} to 1${amount ? ` · ${money(amount)}` : ''}`;
  };
  addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);

  // faint rings round my bet circles while I bet on several; a lit one round the hand being set
  const ringMat = new THREE.MeshBasicMaterial({ color: '#f5dc9c', transparent: true, opacity: 0.38, depthWrite: false });
  const litMat = new THREE.MeshBasicMaterial({ color: '#ffe7ad', transparent: true, opacity: 0.9, depthWrite: false });
  const ringGeo = new THREE.RingGeometry(BET_RADIUS * 1.16, BET_RADIUS * 1.3, 48);
  const litGeo = new THREE.RingGeometry(BET_RADIUS * 1.14, BET_RADIUS * 1.46, 48);
  const rings = new Map<string, THREE.Mesh>();
  const renderRings = (): void => {
    const want = new Map<string, { at: THREE.Vector3; lit: boolean }>();
    if (mode === 'solo' && spots.length > 1 && canBet()) for (const spot of spots) want.set(`a:${spot}`, { at: betPoint(spot, TOP_Y + 0.0013), lit: false });
    const up = spots.length > 1 ? settingSpot() : null;
    if (up !== null) want.set(`p:${up}`, { at: betPoint(up, TOP_Y + 0.0013), lit: true });
    for (const [key, w] of want) {
      let r = rings.get(key);
      if (!r) {
        r = new THREE.Mesh(w.lit ? litGeo : ringGeo, w.lit ? litMat : ringMat);
        r.rotation.x = -Math.PI / 2;
        root.add(r);
        rings.set(key, r);
      }
      r.position.copy(w.at);
    }
    for (const [key, r] of rings) {
      if (want.has(key)) continue;
      r.removeFromParent();
      rings.delete(key);
    }
  };

  const renderNames = (): void => {
    dropLabels('name:');
    if (mode !== 'multi') return;
    for (const m of members) {
      if (m.seat === null || m.status === 'watching') continue;
      const p = railPoint(m.seat).setY(TOP_Y + 0.07);
      setLabel(`name:${m.seat}`, p, [{ text: m.name }], `pg-name${m.seat === me ? ' mine' : ''}${m.connected ? '' : ' away'}`);
    }
  };

  // ---- animation pieces ------------------------------------------------------------------------

  const sweepCards = async (): Promise<void> => {
    const all = [...[...hands.values()].flat(), ...dealerCards];
    hands.clear();
    dealerCards = [];
    dropLabels('hand:');
    dropLabel('dealer');
    if (all.length === 0) return;
    ctx.sfx.play('card-place');
    for (const m of all) if (m.scale.x !== 1) void scaleTo(m, 1, 260);
    await Promise.all(all.map((m, i) => wait(i * 8).then(() => dealCard(m, m.position.clone(), DISCARD, { faceUp: false, ms: 260, yaw: 0 }))));
    removeCards(all);
  };

  const startRound = async (): Promise<void> => {
    clearPayouts();
    if (mode === 'multi') {
      if (readyOn) ctx.link.ready(false);
      readyOn = false;
      ctx.kit.say('Place your bets', 2400);
    }
    await sweepCards();
  };

  /** Seven times around, first base first, the dealer last each time. */
  const dealAround = async (seats: number[]): Promise<void> => {
    if (mode === 'multi') ctx.kit.say('No more bets', 1600);
    const order = [...seats].sort((a, b) => positionOf(a) - positionOf(b));
    const jobs: Promise<void>[] = [];
    let n = 0;
    for (const seat of order) hands.set(seat, []);
    dealerCards = [];
    const gap = Math.max(22, 60 - 6 * seats.length);
    for (let round = 0; round < 7; round++) {
      for (const target of [...order, -1]) {
        const m = newCard(null);
        m.position.copy(SHUFFLER);
        const delay = n++ * gap;
        if (target < 0) dealerCards.push(m);
        else hands.get(target)!.push(m);
        const slot = target < 0 ? { pos: dealerCard('seven', round), yaw: 0 } : seatCard(target, 'seven', round);
        if (round % 2 === 0) ctx.sfx.play('card-deal', { delay: delay / 1000, volume: 0.7 });
        if (round === 0) ctx.stage.gesture('deal');
        jobs.push(wait(delay).then(() => Promise.all([dealCard(m, SHUFFLER, slot.pos, { faceUp: false, ms: 240, yaw: slot.yaw }), target < 0 ? scaleTo(m, DEALER_CARD_SCALE, 240) : null]).then(() => {})));
      }
    }
    await Promise.all(jobs);
  };

  const turnOver = async (cards: PgCardMesh[], faces: PgCard[], stagger: number): Promise<void> => {
    ctx.sfx.play('card-flip');
    await Promise.all(
      cards.map((m, i) =>
        wait(i * stagger).then(() => {
          m.show(faces[i]!);
          return flipCard(m, true, 220);
        }),
      ),
    );
  };

  /** Slide a seat's seven into its two boxes: by the setting, or (face down) five and two. */
  const splitCards = async (seat: number, cards: (PgCard | null)[], setting: Setting | null): Promise<void> => {
    const ms = hands.get(seat);
    if (!ms || ms.length !== 7) return;
    const slots = cardSlots(seat, cards, setting, true);
    ctx.sfx.play('card-place', { volume: 0.6 });
    await Promise.all(
      ms.map((m, i) => {
        const from = m.position.clone();
        const to = slots[i]!.pos;
        return tween(260, (k) => m.position.lerpVectors(from, to, k), ease.out);
      }),
    );
  };

  const setDealer = async (cards: PgCard[], setting: Setting): Promise<void> => {
    if (dealerCards.length === 7) await turnOver(dealerCards, cards, 40);
    await wait(350);
    let hi = 0;
    let lo = 0;
    await Promise.all(
      dealerCards.map((m, i) => {
        const to = setting.low.includes(cards[i]!) ? dealerCard('low', lo++) : dealerCard('high', hi++);
        const from = m.position.clone();
        return tween(300, (k) => m.position.lerpVectors(from, to, k), ease.inOut);
      }),
    );
    dealerLabel(setting);
  };

  const sweep = async (seat: number, kinds: ('bet' | 'fortune')[]): Promise<void> => {
    const moving = kinds.map((k) => stackAt(seat, k)).filter((s) => s.amount > 0);
    if (moving.length === 0) return;
    ctx.sfx.play('chips-collide', { volume: 0.7 });
    ctx.stage.gesture('sweep');
    await Promise.all(moving.map((s) => slideStack(s, RACK_POINT, 380)));
    for (const s of moving) s.set(0);
  };

  const payOut = async (seat: number, to: THREE.Vector3, amount: Cents): Promise<void> => {
    const chips = new ChipStack();
    chips.set(amount);
    chips.position.copy(RACK_POINT);
    root.add(chips);
    payouts.push({ seat, stack: chips });
    await slideStack(chips, to, 420);
  };

  const pill = (at: THREE.Vector3, text: string, kind: 'win' | 'lose' | 'push'): void => {
    ctx.kit.pill(ctx.stage, at.clone().setY(TOP_Y + 0.02), text, kind, 3200);
  };

  const settleSeat = async (seat: number, r: Settlement, bets: Bets): Promise<void> => {
    const jobs: Promise<void>[] = [];
    const lost: ('bet' | 'fortune')[] = [];
    if (bets.bet > 0) {
      if (r.outcome === 'win') jobs.push(payOut(seat, payoutPoint(seat), r.bet - bets.bet));
      else if (r.outcome === 'lose') lost.push('bet');
    }
    if (bets.fortune > 0) {
      if (r.fortune > 0) jobs.push(payOut(seat, fortunePayoutPoint(seat), r.fortune - bets.fortune));
      else lost.push('fortune');
    }
    if (owns(seat)) {
      // the money where it lies (the hand's label says how each hand did)
      const at = onSeat(seat, BET_R + 0.08, 0);
      if (r.outcome === 'win') pill(at, `${signed(r.bet - bets.bet)} · 5% ${money(r.commission)}`, 'win');
      else if (r.outcome === 'push') pill(at, 'PUSH', 'push');
      else pill(at, formatMoney(-bets.bet), 'lose');
      if (bets.fortune > 0) pill(onSeat(seat, FORTUNE_R, -0.11), r.fortune > 0 ? `FORTUNE ${signed(r.fortune - bets.fortune)}` : `FORTUNE ${formatMoney(-bets.fortune)}`, r.fortune > 0 ? 'win' : 'lose');
    }
    if (jobs.length > 0) {
      ctx.sfx.play('chips-stack');
      ctx.stage.gesture('pay');
    }
    jobs.push(sweep(seat, lost));
    await Promise.all(jobs);
  };

  const collect = async (): Promise<void> => {
    const moving: { seat: number; stack: THREE.Object3D }[] = [];
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      for (const kind of ['bet', 'fortune'] as const) {
        const s = stacks.get(`${kind}:${seat}`);
        if (s && s.amount > 0) moving.push({ seat, stack: s });
      }
    }
    for (const p of payouts) moving.push(p);
    if (moving.length === 0) return;
    ctx.sfx.play('chips-handle', { volume: 0.8 });
    await Promise.all(moving.map((m) => slideStack(m.stack, railPoint(m.seat), 420)));
    for (const m of moving) if (m.stack instanceof ChipStack) m.stack.set(0);
    clearPayouts();
  };

  /** The dealer's call for my hand once it has settled. */
  const callResult = async (r: Settlement, mine: Setting, dealer: Setting, brisk: boolean): Promise<void> => {
    const copyHigh = highScore(mine.high) === highScore(dealer.high);
    const copyLow = lowScore(mine.low) === lowScore(dealer.low);
    const lines: string[] = [];
    if (r.outcome === 'win') lines.push('Both hands win: even money, less 5%');
    else if (r.outcome === 'push') lines.push(r.highWins ? `High hand wins, low hand ${copyLow ? 'copies' : 'loses'}: push` : `Low hand wins, high hand ${copyHigh ? 'copies' : 'loses'}: push`);
    else if (r.outcome === 'lose') lines.push(copyHigh || copyLow ? `Dealer wins, the copy ${copyHigh ? 'behind' : 'in front'} goes to the dealer` : 'Dealer wins both hands');
    if (r.fortune > 0) lines.push(`Fortune: ${FORTUNE_NAMES[r.fortuneLine]}, ${pay[r.fortuneLine]} to 1`);
    for (const line of lines) {
      ctx.kit.say(line, 2800);
      await wait(brisk ? 900 : 1300);
    }
  };

  // ---- the event player ----------------------------------------------------------------------

  const play = async (events: PaiGowEvent[], next: PaiGowView): Promise<void> => {
    let settled = false;
    let dealerSetting: Setting | null = null;
    for (const e of events) {
      switch (e.type) {
        case 'betting':
          await startRound();
          break;
        case 'bets':
          if (spots.includes(e.seat)) break;
          ctx.sfx.play('chip-lay', { volume: 0.4 });
          stackAt(e.seat, 'bet').set(e.bet);
          stackAt(e.seat, 'fortune').set(e.fortune);
          break;
        case 'deal': {
          const dealtMine = e.seats.filter(owns);
          if (dealtMine.length) {
            last = Object.fromEntries(dealtMine.map((spot) => [spot, betsOf(spot)]));
            roundNet = 0;
          }
          await sweepCards();
          await dealAround(e.seats);
          break;
        }
        case 'hand': {
          const ms = hands.get(e.seat);
          if (owns(e.seat) && ms && ms.length === 7) await turnOver(ms, e.cards, 40);
          break;
        }
        case 'setting':
          sent.clear();
          if (spots.some((spot) => next.seats[spot] && !next.seats[spot]!.set)) {
            view = next;
            renderControls();
            ctx.kit.say(spots.filter((s) => next.seats[s]).length > 1 ? 'Set each hand: five high, two low' : 'Set your hand: five high, two low', 3600);
          }
          break;
        case 'set': {
          const sv = next.seats[e.seat];
          await splitCards(e.seat, sv?.cards ?? [], owns(e.seat) ? (sv?.setting ?? null) : null);
          if (owns(e.seat) && sv) {
            handLabel(e.seat, { ...sv, result: null });
            if (e.auto) ctx.kit.say(mode === 'multi' ? 'Time: your hand is set by the house way' : 'Set by the house way', 2400);
          }
          break;
        }
        case 'reveal':
          dealerSetting = e.setting;
          await setDealer(e.dealer, e.setting);
          await wait(500);
          break;
        case 'show': {
          const ms = hands.get(e.seat);
          if (ms && ms.length === 7) {
            if (!owns(e.seat)) {
              // turn them over into the boxes the way they were set
              ms.forEach((m, i) => m.show(e.cards[i]!));
              await splitCards(e.seat, e.cards, e.setting);
              await Promise.all(ms.map((m, i) => wait(i * 25).then(() => flipCard(m, true, 200))));
            }
          }
          const sv = next.seats[e.seat];
          if (sv) handLabel(e.seat, { ...sv, result: null });
          break;
        }
        case 'result': {
          const sv = next.seats[e.seat];
          if (owns(e.seat)) {
            roundNet += e.result.returned - e.result.wagered;
            lastNet = roundNet;
          }
          if (!sv) break;
          settled = true;
          handLabel(e.seat, sv);
          await settleSeat(e.seat, e.result, { bet: sv.bet, fortune: sv.fortune });
          if (owns(e.seat) && sv.setting) {
            celebrateHand(e.seat, e.result, sv.setting);
            if (dealerSetting) await callResult(e.result, sv.setting, dealerSetting, spots.length > 1);
          }
          renderMeters();
          break;
        }
        case 'idle':
          await sweepCards();
          break;
      }
    }
    if (settled) {
      await wait(mode === 'solo' ? 700 : 400);
      await collect();
    }
  };

  const tickClock = (): void => {
    const v = view;
    if (mode !== 'multi' || !v || v.deadline === null || (v.phase !== 'betting' && v.phase !== 'setting')) {
      clock.hidden = true;
      return;
    }
    const whole = v.phase === 'betting' ? BETTING_MS : SETTING_MS;
    const leftMs = Math.max(0, v.deadline - serverNow());
    clock.hidden = false;
    clock.classList.toggle('low', leftMs < 5_000);
    left.setAttribute('stroke-dashoffset', (CIRC * (1 - leftMs / whole)).toFixed(2));
    clockText.textContent = String(Math.ceil(leftMs / 1000));
  };

  return {
    onTable(snap) {
      cfg = snap.meta.config;
      mode = snap.meta.mode;
      members = snap.members;
      me = snap.you.status === 'watching' ? null : snap.you.seat;
      stack = snap.you.stack;
      const v = snap.view as PaiGowView;
      pay = v.fortune ?? DEFAULT_FORTUNE;
      view = v;
      latest = v;
      spots = v.mine ?? (me !== null ? [me] : []);
      wanted = serverBets();
      if (!felt) {
        felt = makeFelt(pay, 1400);
        ctx.stage.addFelt(felt, TOP_Y + 0.0006);
        if (floorFelt) floorFelt.visible = false;
      }
      if (!sign) {
        sign = placard(cfg);
        root.add(sign);
      }
      const bet = cfg.limits.bet ?? cfg.limits.default;
      tray.setChipMax(bet.max, (cfg.limits.fortune ?? cfg.limits.default).min);
      fillRules();
      renderNames();
      draw(v);
    },

    async onEvents(events: GameEvent[], raw) {
      const next = raw as PaiGowView;
      latest = next;
      await play(events as PaiGowEvent[], next);
      draw(next);
    },

    onSeat(msg) {
      stack = msg.stack;
      me = msg.status === 'watching' || msg.seat === null ? null : msg.seat;
      renderControls();
    },

    onMembers(msg) {
      members = msg.members;
      renderNames();
    },

    onError() {
      if (lastAction === 'bet') {
        history.pop();
        resync = true;
        wanted = serverBets();
      } else {
        sent.clear();
      }
      if (view) draw(view);
    },

    keydown(e) {
      if (e.metaKey && e.key !== 'z') return false;
      if (e.repeat && !/^[1-8]$/.test(e.key)) return true;
      if (isChipKey(e.key) && !setter.open) {
        tray.key(e);
        return true;
      }
      if (e.code === 'Space') {
        primary();
        return true;
      }
      if (e.code === 'KeyH') {
        setter.houseWay();
        return true;
      }
      if (e.code === 'KeyX') {
        clear();
        return true;
      }
      if (e.code === 'KeyR') {
        rebet(e.shiftKey ? 2 : 1);
        return true;
      }
      if (e.code === 'KeyA' && !e.shiftKey && canBet()) {
        tray.pickMax();
        return true;
      }
      if (e.key === 'Backspace' || ((e.metaKey || e.ctrlKey) && e.key === 'z')) {
        undo();
        return true;
      }
      if (e.code === 'KeyI') {
        rules.hidden = !rules.hidden;
        return true;
      }
      return false;
    },

    update() {
      tickClock();
      litMat.opacity = 0.62 + 0.3 * Math.sin(performance.now() / 260);
    },

    dispose() {
      disposed = true;
      for (const x of [ringMat, litMat, ringGeo, litGeo, hoverGeo]) x.dispose();
      picker.root.remove();
      offTips();
      ctx.kit.tip(null);
      removeEventListener('pointerdown', onDown);
      removeEventListener('pointermove', onMove);
      canvas.style.cursor = '';
      for (const key of [...labels.keys()]) dropLabel(key);
      tipObj.removeFromParent();
      tip.remove();
      tray.root.remove();
      setter.root.remove();
      meters.remove();
      clock.remove();
      rules.remove();
      rulesBtn.remove();
      root.removeFromParent();
      if (felt) {
        felt.mesh.removeFromParent();
        felt.mesh.geometry.dispose();
        const mat = felt.mesh.material as THREE.MeshStandardMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
      if (floorFelt) floorFelt.visible = true;
    },
  };
}
