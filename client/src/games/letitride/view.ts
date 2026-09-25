// The Let It Ride table view. Every hand plays out the way the server already settled it: three
// cards to each player and two face down in the middle, your own three turned over, each bet let
// ride or slid back to you, the community cards turned one at a time, and each circle paid or
// swept where it lies before the chips go home.
//
// Hands sit at spots numbered like the seats (the key everywhere below). At a shared table you
// play your seat's; alone you can play up to three, chosen in the Hands picker: each has its own
// bets, and you decide them one at a time, first base first, the circle up next ringed on the felt.

import * as THREE from 'three';
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { TableView, TableViewCtx } from '../contract.ts';
import type { Member } from '../../../../shared/src/protocol.ts';
import type { TableConfig, GameEvent } from '../../../../shared/src/engine.ts';
import type { Card } from '../../../../shared/src/cards.ts';
import { type BetLimits, type Cents, BETTING_CHIPS, formatMoney } from '../../../../shared/src/money.ts';
import { maxBet } from '../../../../shared/src/limits.ts';
import { unitMax } from './max.ts';
import { BETTING_MS, DECISION_MS, MAX_SPOTS } from '../../../../shared/src/games/letitride/engine.ts';
import type { LetItRideEvent, LetItRideView, SeatView } from '../../../../shared/src/games/letitride/protocol.ts';
import {
  type Paytable,
  type Settlement,
  BONUS_NAMES,
  CATEGORY_NAMES,
  DEFAULT_PAYTABLE,
  NOTHING,
  bonusLine,
  handName,
  handPays,
  partialName,
  paytableOf,
} from '../../../../shared/src/games/letitride/rules.ts';
import { rideAdvice } from '../../../../shared/src/games/letitride/advice.ts';
import { CardMesh, dealCard, flipCard } from '../../table/cards.ts';
import { isChipKey } from '../../table/keys.ts';
import { ChipStack, slideStack } from '../../table/chips.ts';
import { celebrate } from '../../table/celebrate.ts';
import type { Felt } from '../../table/felt.ts';
import { ease, tween, wait } from '../../table/tween.ts';
import { handMoment } from './moments.ts';
import { ChipTray, button, el } from '../../ui/kit.ts';
import { serverNow } from '../../net/clock.ts';
import { wave } from '../../app/comfort.ts';
import {
  TOP_Y,
  RACK,
  SHUFFLER,
  DISCARD,
  BOARD_CARD_SCALE,
  SEAT_COUNT,
  CIRCLE_RADIUS,
  BONUS_RADIUS,
  type Circle,
  boardPoints,
  boardSlot,
  bonusPayoutPoint,
  bonusPoint,
  cameraPose,
  circlePoint,
  handLabelPoint,
  handSlot,
  makeFelt,
  onSeat,
  payoutPoint,
  positionOf,
  railPoint,
  spotsPose,
  BET_R,
  BONUS_R,
} from './layout.ts';
import { FLOOR_FELT } from './model.ts';
import { SpotPicker } from '../multihand/picker.ts';
import { glideTo, setSpotsInPlay } from '../multihand/frame.ts';
import { oneAtATime } from '../multihand/turns.ts';
import './letitride.css';

const CIRCLES: Circle[] = [0, 1, 2];
/** The hover ring round all three of a hand's circles (a unit ring scaled). */
const CIRCLE_GAP_RING = 0.128;
const RACK_POINT = new THREE.Vector3(RACK.x, TOP_Y + 0.012, RACK.z);

type Bets = { unit: Cents; bonus: Cents };
const NO_BETS: Bets = { unit: 0, bonus: 0 };

function money(n: Cents): string {
  return formatMoney(n);
}

function signed(n: Cents): string {
  return n === 0 ? '$0' : formatMoney(n, { sign: true });
}

/** The limits sign on its little stand by the rack, painted from the table's config. */
function placard(cfg: TableConfig): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 300;
  const g = c.getContext('2d')!;
  g.fillStyle = '#16090b';
  g.fillRect(0, 0, 512, 300);
  g.strokeStyle = '#d8b06a';
  g.lineWidth = 6;
  g.strokeRect(12, 12, 488, 276);
  g.fillStyle = '#f1d59a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 42px Cinzel, Georgia, serif';
  g.fillText('LET IT RIDE', 256, 60);
  const bet = cfg.limits.bet ?? cfg.limits.default;
  const bonus = cfg.limits.bonus ?? cfg.limits.default;
  g.font = '600 62px "Barlow Condensed", sans-serif';
  g.fillText(`${money(bet.min)} – ${money(bet.max)}`, 256, 144);
  g.font = '600 32px "Barlow Condensed", sans-serif';
  g.fillStyle = '#e8e0cc';
  g.fillText('EACH OF THREE EQUAL BETS', 256, 206);
  g.fillText(`3 CARD BONUS ${money(bonus.min)} – ${money(bonus.max)}`, 256, 250);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.088), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
  sign.position.set(0.47, TOP_Y + 0.05, -0.475);
  sign.rotation.x = -0.28;
  sign.name = 'lr-placard';
  return sign;
}

/** Exact 3-Card Bonus house edge of a pay table, from the 22,100 three-card hands. */
function bonusEdge(pay: Paytable): number {
  const counts = [4, 44, 52, 720, 1_096, 3_744];
  let ev = -16_440;
  counts.forEach((n, i) => (ev += pay.bonus[i]! * n));
  return -ev / 22_100;
}

export function mountLetItRide(ctx: TableViewCtx): TableView {
  const root = new THREE.Group();
  ctx.stage.root.add(root);
  const canvas = ctx.stage.engine.renderer.domElement;
  const floorFelt = ctx.stage.anchor.getObjectByName(FLOOR_FELT) ?? null;

  let felt: Felt | null = null;
  let sign: THREE.Mesh | null = null;
  let cfg: TableConfig | null = null;
  let pay: Paytable = DEFAULT_PAYTABLE;
  let mode: 'solo' | 'multi' = 'solo';
  let me: number | null = null;
  let stack: Cents = 0;
  let view: LetItRideView | null = null;
  // the newest state from the server, which can be ahead of what is drawn while a hand animates
  let latest: LetItRideView | null = null;
  let members: Member[] = [];
  let spots: number[] = [];

  // my bets as I've asked for them, by spot, ahead of the server's answer, and the steps to undo
  let wanted: Record<number, Bets> = {};
  let history: Record<number, Bets>[] = [];
  let last: Record<number, Bets> | null = null;
  let lastNet: Cents | null = null;
  let roundNet: Cents = 0;
  let readyOn = false;
  let lastAction: 'bet' | 'other' = 'other';
  let resync = false;
  // hands whose decision is on its way, so a stale view can't bring their buttons back
  const sent = new Set<number>();
  let framed: number | null = null;
  let disposed = false;
  const inTurn = oneAtATime();

  const owns = (spot: number): boolean => me !== null && (mode === 'solo' || spot === me);
  const betsOf = (spot: number): Bets => wanted[spot] ?? NO_BETS;
  const total = (b: Record<number, Bets>): Cents => Object.values(b).reduce((a, x) => a + 3 * x.unit + x.bonus, 0);
  const lim = (kind: 'bet' | 'bonus'): BetLimits | null => (cfg ? (cfg.limits[kind] ?? cfg.limits.default) : null);

  // ---- table objects -----------------------------------------------------------------------

  const stacks = new Map<string, ChipStack>();
  /** A circle's chips (`c` 0-2) or the bonus's (`c` 'bonus'). */
  const stackAt = (seat: number, c: Circle | 'bonus'): ChipStack => {
    const key = `${c}:${seat}`;
    let s = stacks.get(key);
    if (!s) {
      s = new ChipStack();
      s.position.copy(c === 'bonus' ? bonusPoint(seat) : circlePoint(seat, c));
      root.add(s);
      stacks.set(key, s);
    }
    return s;
  };
  let payouts: { seat: number; stack: ChipStack }[] = [];
  const hands = new Map<number, CardMesh[]>();
  let boardCards: CardMesh[] = [];
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

  const newCard = (card: Card | null): CardMesh => {
    const m = new CardMesh(card);
    m.rotation.order = 'YXZ';
    root.add(m);
    return m;
  };
  const removeCards = (cards: CardMesh[]): void => {
    for (const c of cards) c.removeFromParent();
  };

  // ---- DOM: tray, decision bar, meters, clock, rules ---------------------------------------

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

  const rideBtn = button('Let it ride', () => decide('ride'), { cls: 'primary', key: 'L' });
  const pullBtn = button('Pull back', () => decide('pull'), { key: 'P' });
  const decideHint = el('div', 'lr-hint', '');
  const decideBar = el('div', 'lr-decide panel');
  decideBar.append(pullBtn, rideBtn, decideHint);
  decideBar.hidden = true;
  ctx.ui.append(decideBar);

  const meters = el('div', 'lr-meters panel');
  const meterStack = el('span', 'money');
  const meterBet = el('span', 'money');
  const meterLast = el('span', 'money');
  meters.append(el('span', 'label', 'Chips'), meterStack, el('span', 'label', 'Bet'), meterBet, el('span', 'label', 'Last hand'), meterLast);
  ctx.ui.append(meters);

  const SVG = 'http://www.w3.org/2000/svg';
  const clock = el('div', 'lr-clock');
  const ring = document.createElementNS(SVG, 'svg');
  ring.setAttribute('viewBox', '0 0 44 44');
  ring.classList.add('lr-ring');
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
  const clockText = el('span', 'lr-clock-text');
  clock.append(ring, clockText);
  clock.hidden = true;
  ctx.ui.append(clock);

  const rules = el('div', 'lr-rules panel');
  rules.hidden = true;
  const rulesBtn = button('Rules', () => (rules.hidden = !rules.hidden), { cls: 'ghost lr-rules-btn', key: 'I' });
  ctx.ui.append(rules, rulesBtn);

  const fillRules = (): void => {
    const p = (t: string) => el('p', '', t);
    const table = (title: string, rows: [string, string][]) => {
      const t = el('div', 'lr-paytable');
      t.append(el('div', 'label', title));
      for (const [name, pays] of rows) {
        const r = el('div', 'row');
        r.append(el('span', '', name), el('span', 'money', pays));
        t.append(r);
      }
      return t;
    };
    const standard = pay.hand.join() === DEFAULT_PAYTABLE.hand.join();
    rules.replaceChildren(
      el('h3', '', 'Let It Ride'),
      p('Put three equal bets down, 1, 2 and $. You get three cards and the dealer lays two face down in the middle; you play the five together. There is no dealer hand to beat.'),
      p('After seeing your three cards, let bet 1 ride or pull it back. The dealer turns the first community card: let bet 2 ride or pull it back. The $ bet always rides. The second card turns and every bet still riding is paid by the table, or lost below a pair of tens.'),
      table('Each riding bet pays', CATEGORY_NAMES.map((name, i) => [name, `${pay.hand[i]} to 1`] as [string, string]).slice(1).reverse()),
      table('3-Card Bonus, on your first three cards', BONUS_NAMES.map((name, i) => [name, `${pay.bonus[i]} to 1`] as [string, string])),
      p('Best play, bet 1: ride with a paying pair or three of a kind, three to a royal flush, three suited in a row (not 2-3-4 or A-2-3), three to a straight flush with one gap and a high card, or two gaps and two high cards. Bet 2: ride with a paying hand, four to a flush, four to an outside straight, or four high cards (ten or better) to an inside straight.'),
      p(`${standard ? 'Played that way the house keeps 3.51% of one bet a hand. ' : ''}3-Card Bonus: ${(bonusEdge(pay) * 100).toFixed(2)}%.`),
      el('p', 'lr-keys', '1-8 chips · A max, then click a circle or the bonus · Space deal · L let it ride · P pull back · R rebet · Shift R double · X clear · Backspace undo'),
    );
  };

  // ---- helpers over the current view -------------------------------------------------------

  const seatView = (seat: number | null): SeatView | undefined => (seat === null || !view ? undefined : view.seats[seat]);
  /** The decision up now for a hand: bet 1 in the first round, bet 2 in the second. */
  const upNow = (sv: SeatView | undefined, phase = view?.phase): string | null => (!sv ? null : phase === 'first' ? sv.first : phase === 'second' ? sv.second : null);
  /** My hand waiting on a decision, first base first. */
  const decidingSpot = (): number | null => {
    if (view?.phase !== 'first' && view?.phase !== 'second') return null;
    const waiting = spots.filter((s) => upNow(seatView(s)) === 'pending' && !sent.has(s));
    return waiting.sort((a, b) => positionOf(a) - positionOf(b))[0] ?? null;
  };
  const canBet = (): boolean => {
    if (me === null || !latest) return false;
    if (mode === 'multi') return latest.phase === 'betting';
    return latest.phase !== 'first' && latest.phase !== 'second';
  };

  /** What a hand still has riding on the layout (pulled circles came home). */
  const onLayout = (sv: SeatView): Cents => {
    const pulled = (sv.first === 'pull' ? 1 : 0) + (sv.second === 'pull' ? 1 : 0);
    return (3 - pulled) * sv.unit + sv.bonus;
  };

  const renderMeters = (): void => {
    let live = 0;
    for (const spot of spots) {
      const sv = seatView(spot);
      if (view && sv && (view.phase === 'first' || view.phase === 'second')) live += onLayout(sv);
    }
    meterStack.textContent = money(stack);
    meterBet.textContent = money(view?.phase === 'betting' ? total(wanted) : live);
    meterLast.textContent = lastNet === null ? '–' : signed(lastNet);
    meterLast.className = `money ${lastNet === null || lastNet === 0 ? '' : lastNet > 0 ? 'up' : 'down'}`;
  };

  const renderControls = (): void => {
    const up = decidingSpot();
    const sv = seatView(up);
    decideBar.hidden = up === null;
    tray.root.classList.toggle('lr-away', up !== null);
    if (up !== null && sv && view) {
      const bet = view.phase === 'first' ? 1 : 2;
      pullBtn.firstChild!.textContent = `Pull back bet ${bet}`;
      rideBtn.firstChild!.textContent = 'Let it ride';
      const mine = spots.filter((s) => seatView(s)?.cards.length).sort((a, b) => positionOf(a) - positionOf(b));
      const which = mine.length > 1 ? `Hand ${mine.indexOf(up) + 1} of ${mine.length} · ` : '';
      decideHint.textContent = `${which}${money(sv.unit)} on bet ${bet} · the $ always rides`;
    }
    picker.show(mode === 'solo' && canBet());
    picker.set(Math.max(1, spots.length));
    renderTip();
    if (mode === 'solo') tray.setPrimary('Deal', !!view && view.phase === 'betting' && total(wanted) > 0);
    else tray.setPrimary(readyOn ? 'Waiting' : 'Ready', !!view && view.phase === 'betting' && me !== null);
    renderRings();
    renderMeters();
  };

  /** The cards a hand decides on now: its three, and the first community card for bet 2. */
  const decisionCards = (spot: number | null): Card[] | null => {
    const sv = seatView(spot);
    if (!view || !sv || sv.cards.length !== 3 || sv.cards.some((c) => c === null)) return null;
    const three = sv.cards as Card[];
    if (view.phase === 'first') return three;
    if (view.phase === 'second' && view.board[0]) return [...three, view.board[0]];
    return null;
  };

  const renderTip = (): void => {
    const cards = ctx.tips.on ? decisionCards(decidingSpot()) : null;
    const a = cards ? rideAdvice(cards) : null;
    rideBtn.classList.toggle('tip-pick', a?.ride === true);
    pullBtn.classList.toggle('tip-pick', a?.ride === false);
    ctx.kit.tip(a ? a.text : null);
  };
  const offTips = ctx.tips.subscribe(() => renderTip());

  const celebrateHand = (spot: number, r: Settlement, five: Card[]): void => {
    const m = handMoment(r, five, pay);
    if (!m) return;
    inTurn(() => {
      if (disposed) return;
      celebrate(ctx, { ...m, at: handSlot(spot, 1).pos, glow: [hands.get(spot) ?? [], boardCards] });
    });
  };

  // ---- drawing the whole table from a view -------------------------------------------------

  const layCards = (seat: number, cards: (Card | null)[]): void => {
    let ms = hands.get(seat);
    if (!ms) {
      ms = cards.map(() => newCard(null));
      hands.set(seat, ms);
    }
    ms.forEach((m, i) => {
      const slot = handSlot(seat, i);
      const c = cards[i] ?? null;
      if (c && m.card !== c) m.setCard(c);
      m.position.copy(slot.pos);
      m.rotation.set(c ? 0 : Math.PI, slot.yaw, 0);
    });
  };

  const handCls = (seat: number): string => `lr-hand${owns(seat) ? ' mine' : ''}${owns(seat) && spots.length > 1 ? ' stack' : ''}`;

  /** A hand's label: what it makes so far with the cards turned, then what it paid. */
  const handLabel = (seat: number, sv: SeatView, board: (Card | null)[]): void => {
    const cards = sv.cards;
    if (cards.length !== 3 || cards.some((c) => c === null)) {
      dropLabel(`hand:${seat}`);
      return;
    }
    const known = [...(cards as Card[]), ...board.filter((c): c is Card => c !== null)];
    const parts: { text: string; cls?: string }[] = [{ text: known.length === 5 ? handName(known) : partialName(known) }];
    const r = sv.result;
    if (r) {
      const net = r.returned - r.wagered;
      parts.push({ text: net === 0 ? 'Even' : signed(net), cls: net > 0 ? 'net up' : net < 0 ? 'net down' : 'net' });
    }
    setLabel(`hand:${seat}`, handLabelPoint(seat), parts, handCls(seat), 'below');
  };

  const scaleTo = (m: CardMesh, to: number, ms: number): Promise<void> => {
    const from = m.scale.x;
    return tween(ms, (k) => m.scale.setScalar(from + (to - from) * k), ease.out);
  };

  const clearPayouts = (): void => {
    for (const p of payouts) p.stack.removeFromParent();
    payouts = [];
  };

  /** A circle's chips on the layout from a seat's view: nothing on a circle pulled back. */
  const circleAmount = (sv: SeatView, c: Circle): Cents => {
    if (c === 0 && sv.first === 'pull') return 0;
    if (c === 1 && sv.second === 'pull') return 0;
    return sv.unit;
  };

  const draw = (v: LetItRideView): void => {
    view = v;
    spots = v.mine ?? (me !== null ? [me] : []);
    if (resync) wanted = serverBets();
    for (const spot of [...sent]) if (upNow(v.seats[spot], v.phase) !== 'pending') sent.delete(spot);
    clearPayouts();
    const live = v.phase === 'betting' || v.phase === 'first' || v.phase === 'second';
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      const sv = v.seats[seat];
      const own = spots.includes(seat) && v.phase === 'betting';
      const b = betsOf(seat);
      for (const c of CIRCLES) {
        const amount = own ? b.unit : live && sv ? circleAmount(sv, c) : 0;
        const s = stackAt(seat, c);
        if (s.amount !== amount) s.set(amount);
      }
      const bonus = own ? b.bonus : live && sv ? sv.bonus : 0;
      const bs = stackAt(seat, 'bonus');
      if (bs.amount !== bonus) bs.set(bonus);
      const showCards = sv && sv.cards.length === 3 && v.phase !== 'betting';
      if (showCards) layCards(seat, sv.cards);
      else {
        removeCards(hands.get(seat) ?? []);
        hands.delete(seat);
      }
      if (sv && v.phase !== 'betting') handLabel(seat, sv, v.board);
      else dropLabel(`hand:${seat}`);
    }
    if (v.board.length === 2) {
      if (boardCards.length !== 2) {
        removeCards(boardCards);
        boardCards = v.board.map(() => newCard(null));
      }
      boardCards.forEach((m, i) => {
        const c = v.board[i] ?? null;
        if (c && m.card !== c) m.setCard(c);
        m.position.copy(boardSlot(i));
        m.rotation.set(c ? 0 : Math.PI, 0, 0);
        m.scale.setScalar(BOARD_CARD_SCALE);
      });
    } else {
      removeCards(boardCards);
      boardCards = [];
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
    setSpotsInPlay('letitride', n);
    // the hands I play and the middle of the table stay in view at any window size (every seat's while watching)
    ctx.stage.board(boardPoints(spots.length ? spots : Array.from({ length: SEAT_COUNT }, (_, i) => i)));
    if (framed !== null && framed !== n && !disposed) void glideTo(ctx.stage, n > 1 ? spotsPose(spots, ctx.stage.engine.camera.aspect) : cameraPose(me ?? 0));
    framed = n;
  };

  const serverBets = (): Record<number, Bets> => {
    const out: Record<number, Bets> = {};
    if (view?.phase !== 'betting') return out;
    for (const spot of spots) {
      const sv = seatView(spot);
      if (sv) out[spot] = { unit: sv.unit, bonus: sv.bonus };
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
      return a.unit !== b.unit || a.bonus !== b.bonus;
    });
    if (changed.length === 0) return;
    if (push) history.push(structuredClone(wanted));
    wanted = structuredClone(next);
    lastAction = 'bet';
    for (const spot of changed) {
      const b = betsOf(spot);
      for (const c of CIRCLES) stackAt(spot, c).set(b.unit);
      stackAt(spot, 'bonus').set(b.bonus);
      ctx.link.act({ type: 'bet', unit: b.unit, bonus: b.bonus, spot });
    }
    renderControls();
  };

  /** A chip on any of a hand's three circles goes on all three: they are always equal. */
  const addUnit = (spot: number): void => {
    if (!canBet()) return;
    const b = betsOf(spot);
    const l = lim('bet');
    let add = tray.selected.value;
    if (l && b.unit + add < l.min) add = Math.ceil((l.min - b.unit) / l.step) * l.step;
    if (tray.maxPicked && l) {
      const m = unitMax(l, b.unit, stack);
      if ('none' in m) return ctx.kit.toast(m.none === 'AT_MAX' ? `Each bet is already at the table maximum, ${money(l.max)}.` : `Three bets of ${money(l.min)} need ${money(3 * l.min)}.`);
      add = m.amount;
    }
    ctx.sfx.play('chip-lay');
    sendBets({ ...wanted, [spot]: { ...b, unit: b.unit + add } });
  };

  const addBonus = (spot: number): void => {
    if (!canBet()) return;
    const b = betsOf(spot);
    if (b.unit === 0) return ctx.kit.toast('The 3-Card Bonus goes with the three bets: bet those first.');
    const l = lim('bonus');
    let add = tray.selected.value;
    if (l && b.bonus + add < l.min) add = Math.ceil((l.min - b.bonus) / l.step) * l.step;
    if (tray.maxPicked && l) {
      const m = maxBet({ limits: l, current: b.bonus, stack });
      if ('none' in m) return ctx.kit.toast(m.none === 'AT_MAX' ? `The bonus is already at its maximum, ${money(l.max)}.` : `Not enough chips for the ${money(l.min)} minimum there.`);
      add = m.amount;
    }
    ctx.sfx.play('chip-lay');
    sendBets({ ...wanted, [spot]: { ...b, bonus: b.bonus + add } });
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
    for (const spot of spots) if (from[spot]) next[spot] = { unit: from[spot]!.unit * times, bonus: from[spot]!.bonus * times };
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
    if (mode === 'solo') {
      if (!canBet()) return;
      if (total(wanted) === 0) rebet(1);
      if (total(wanted) === 0) {
        ctx.kit.say('Place your bets first', 1800);
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

  const decide = (choice: 'ride' | 'pull'): void => {
    const spot = decidingSpot();
    if (spot === null || upNow(latest?.seats[spot], latest?.phase) !== 'pending') return;
    ctx.sfx.play('ui-click');
    sent.add(spot);
    decideBar.hidden = true;
    renderTip();
    renderRings();
    lastAction = 'other';
    ctx.link.act({ type: choice, spot });
  };

  // ---- pointer: bet on my circles, with a hover ring ------------------------------------------

  // a unit ring, scaled to one circle or round all three
  const hoverGeo = new THREE.RingGeometry(1.02, 1.18, 48);
  const ROUND_THREE = CIRCLE_GAP_RING;
  const hoverRing = new THREE.Mesh(hoverGeo, new THREE.MeshBasicMaterial({ color: '#f5dc9c', transparent: true, opacity: 0.75, depthWrite: false }));
  hoverRing.rotation.x = -Math.PI / 2;
  hoverRing.visible = false;
  root.add(hoverRing);
  const tip = el('div', 'lr-tip');
  const tipObj = ctx.stage.label(tip, new THREE.Vector3());
  tipObj.visible = false;

  const mySpotAt = (e: PointerEvent): { spot: number; kind: 'bet' | 'bonus'; circle: Circle | null } | null => {
    if (e.target !== canvas || me === null) return null;
    const id = ctx.stage.pick(e)?.region ?? '';
    for (const spot of spots) {
      const m = /^bet:(\d+):(\d)$/.exec(id);
      if (m && Number(m[1]) === spot) return { spot, kind: 'bet', circle: Number(m[2]) as Circle };
      if (id === `bonus:${spot}`) return { spot, kind: 'bonus', circle: null };
    }
    return null;
  };
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const at = mySpotAt(e);
    if (!at) return;
    if (at.kind === 'bet') addUnit(at.spot);
    else addBonus(at.spot);
  };
  const onMove = (e: PointerEvent): void => {
    const at = canBet() ? mySpotAt(e) : null;
    hoverRing.visible = at !== null;
    tipObj.visible = at !== null;
    canvas.style.cursor = at ? 'pointer' : '';
    if (!at) return;
    const b = betsOf(at.spot);
    if (at.kind === 'bet') {
      // all three circles light: a chip goes on each
      hoverRing.position.copy(circlePoint(at.spot, 1, TOP_Y + 0.0015));
      hoverRing.scale.set(ROUND_THREE, ROUND_THREE, 1);
      tipObj.position.copy(onSeat(at.spot, BET_R + 0.1, 0, TOP_Y + 0.02));
      const m = tray.maxPicked ? (() => { const l = lim('bet'); return l ? unitMax(l, b.unit, stack) : null; })() : null;
      const max = m && 'amount' in m ? ` · Max adds ${money(m.amount)} each` : '';
      tip.textContent = `1 · 2 · $ · three equal bets${b.unit ? ` of ${money(b.unit)}` : ''}${max}`;
    } else {
      hoverRing.position.copy(bonusPoint(at.spot, TOP_Y + 0.0015));
      hoverRing.scale.set(BONUS_RADIUS, BONUS_RADIUS, 1);
      tipObj.position.copy(onSeat(at.spot, BONUS_R, 0.13, TOP_Y + 0.02));
      tip.textContent = `3 CARD BONUS · pays up to ${pay.bonus[0]} to 1${b.bonus ? ` · ${money(b.bonus)}` : ''}`;
    }
  };
  addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);

  // ---- rings: faint ones round my $ circles while I bet on several, a lit one round the circle up

  const ringMat = new THREE.MeshBasicMaterial({ color: '#f5dc9c', transparent: true, opacity: 0.38, depthWrite: false });
  const litMat = new THREE.MeshBasicMaterial({ color: '#ffe7ad', transparent: true, opacity: 0.9, depthWrite: false });
  const ringGeo = new THREE.RingGeometry(CIRCLE_RADIUS * 1.16, CIRCLE_RADIUS * 1.3, 48);
  const litGeo = new THREE.RingGeometry(CIRCLE_RADIUS * 1.14, CIRCLE_RADIUS * 1.46, 48);
  const rings = new Map<string, THREE.Mesh>();
  const renderRings = (): void => {
    const want = new Map<string, { at: THREE.Vector3; lit: boolean }>();
    if (mode === 'solo' && spots.length > 1 && canBet()) {
      for (const spot of spots) want.set(`a:${spot}`, { at: circlePoint(spot, 2, TOP_Y + 0.0013), lit: false });
    }
    // the circle that the decision up now is about
    const up = decidingSpot();
    if (up !== null && view) want.set(`p:${up}`, { at: circlePoint(up, view.phase === 'first' ? 0 : 1, TOP_Y + 0.0013), lit: true });
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

  // ---- name tags for the other players -------------------------------------------------------

  const renderNames = (): void => {
    dropLabels('name:');
    if (mode !== 'multi') return;
    for (const m of members) {
      if (m.seat === null || m.status === 'watching') continue;
      const p = railPoint(m.seat).setY(TOP_Y + 0.07);
      setLabel(`name:${m.seat}`, p, [{ text: m.name }], `lr-name${m.seat === me ? ' mine' : ''}${m.connected ? '' : ' away'}`);
    }
  };

  // ---- animation pieces ------------------------------------------------------------------------

  const sweepCards = async (): Promise<void> => {
    const all = [...[...hands.values()].flat(), ...boardCards];
    hands.clear();
    boardCards = [];
    dropLabels('hand:');
    if (all.length === 0) return;
    ctx.sfx.play('card-place');
    for (const m of all) if (m.scale.x !== 1) void scaleTo(m, 1, 260);
    await Promise.all(all.map((m, i) => wait(i * 12).then(() => dealCard(m, m.position.clone(), DISCARD, { faceUp: false, ms: 260, yaw: 0 }))));
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

  const dealAround = async (seats: number[]): Promise<void> => {
    if (mode === 'multi') ctx.kit.say('No more bets', 1600);
    // first base first, three times around; then the two community cards
    const order = [...seats].sort((a, b) => positionOf(a) - positionOf(b));
    const jobs: Promise<void>[] = [];
    let n = 0;
    for (const seat of order) hands.set(seat, []);
    boardCards = [];
    const send = (m: CardMesh, to: THREE.Vector3, yaw: number, grow: boolean): void => {
      const delay = n++ * 75;
      ctx.sfx.play('card-deal', { delay: delay / 1000, volume: 0.8 });
      ctx.stage.gesture('deal');
      jobs.push(wait(delay).then(() => Promise.all([dealCard(m, SHUFFLER, to, { faceUp: false, ms: 260, yaw }), grow ? scaleTo(m, BOARD_CARD_SCALE, 260) : null]).then(() => {})));
    };
    for (let round = 0; round < 3; round++) {
      for (const seat of order) {
        const m = newCard(null);
        m.position.copy(SHUFFLER);
        hands.get(seat)!.push(m);
        const slot = handSlot(seat, round);
        send(m, slot.pos, slot.yaw, false);
      }
    }
    for (let i = 0; i < 2; i++) {
      const m = newCard(null);
      m.position.copy(SHUFFLER);
      boardCards.push(m);
      send(m, boardSlot(i), 0, true);
    }
    await Promise.all(jobs);
  };

  const turnOver = async (cards: CardMesh[], faces: Card[], stagger: number): Promise<void> => {
    ctx.sfx.play('card-flip');
    await Promise.all(
      cards.map((m, i) =>
        wait(i * stagger).then(() => {
          m.setCard(faces[i]!);
          return flipCard(m, true, 240);
        }),
      ),
    );
  };

  const showMine = async (spot: number, cards: Card[]): Promise<void> => {
    const ms = hands.get(spot);
    if (ms && ms.length === 3) await turnOver(ms, cards, 70);
    setLabel(`hand:${spot}`, handLabelPoint(spot), [{ text: partialName(cards) }], handCls(spot), 'below');
  };

  /** A pulled bet slides home to the player. */
  const pullBack = async (seat: number, c: Circle): Promise<void> => {
    const s = stackAt(seat, c);
    if (s.amount === 0) return;
    const amount = s.amount;
    const moving = new ChipStack();
    moving.set(amount);
    moving.position.copy(s.position);
    root.add(moving);
    s.set(0);
    ctx.sfx.play('chips-handle', { volume: 0.7 });
    await slideStack(moving, railPoint(seat), 380);
    moving.removeFromParent();
  };

  const sweep = async (seat: number, keys: (Circle | 'bonus')[]): Promise<void> => {
    const moving = keys.map((k) => stackAt(seat, k)).filter((s) => s.amount > 0);
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
    ctx.kit.pill(ctx.stage, at.clone().setY(TOP_Y + 0.02), text, kind, 3000);
  };

  /** Sweep what lost, pay what won, and pin the result to each of my circles. */
  const settleSeat = async (seat: number, r: Settlement, unit: Cents, bonus: Cents): Promise<void> => {
    const jobs: Promise<void>[] = [];
    const lost: (Circle | 'bonus')[] = [];
    const m = handPays(r.hand, pay);
    for (const c of CIRCLES) {
      if (r.pulled[c as 0 | 1] && c < 2) continue;
      const back = r.bets[c];
      if (back === 0) lost.push(c);
      else jobs.push(payOut(seat, payoutPoint(seat, c), back - unit));
    }
    if (owns(seat)) {
      const riding = CIRCLES.filter((c) => !(c < 2 && r.pulled[c as 0 | 1]));
      const at = onSeat(seat, BET_R + 0.09, 0);
      if (m > 0) pill(at, `${signed(unit * m * riding.length)} · ${m} TO 1`, 'win');
      else pill(at, formatMoney(-unit * riding.length), 'lose');
    }
    if (bonus > 0) {
      if (r.bonus === 0) lost.push('bonus');
      else {
        jobs.push(payOut(seat, bonusPayoutPoint(seat), r.bonus - bonus));
        if (owns(seat)) pill(onSeat(seat, BONUS_R, -0.1), `BONUS ${signed(r.bonus - bonus)}`, 'win');
      }
      if (r.bonus === 0 && owns(seat)) pill(onSeat(seat, BONUS_R, -0.1), `BONUS ${formatMoney(-bonus)}`, 'lose');
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
      for (const c of [...CIRCLES, 'bonus'] as const) {
        const s = stacks.get(`${c}:${seat}`);
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

  /** The dealer's calls for my hand once it has settled. */
  const callResult = async (r: Settlement, five: Card[], brisk: boolean): Promise<void> => {
    const name = handName(five);
    const riding = 3 - (r.pulled[0] ? 1 : 0) - (r.pulled[1] ? 1 : 0);
    const lines: string[] = [];
    if (r.hand === NOTHING) lines.push(`${name}: ${riding === 1 ? 'the $ bet loses' : `${riding} bets lose`}`);
    else lines.push(`${name}: ${handPays(r.hand, pay)} to 1 on ${riding === 1 ? 'the $ bet' : riding === 2 ? 'two bets' : 'all three bets'}`);
    if (r.bonus > 0) {
      const line = bonusLine(five.slice(0, 3));
      lines.push(`3-Card Bonus: ${BONUS_NAMES[line]}, ${pay.bonus[line]} to 1`);
    }
    for (const line of lines) {
      ctx.kit.say(line, 2600);
      await wait(brisk ? 800 : 1100);
    }
  };

  // ---- the event player ----------------------------------------------------------------------

  const play = async (events: LetItRideEvent[], next: LetItRideView): Promise<void> => {
    let settled = false;
    const board: (Card | null)[] = [...(view?.board ?? [])];
    for (const e of events) {
      switch (e.type) {
        case 'betting':
          await startRound();
          break;
        case 'bets':
          if (spots.includes(e.seat)) break;
          ctx.sfx.play('chip-lay', { volume: 0.4 });
          for (const c of CIRCLES) stackAt(e.seat, c).set(e.unit);
          stackAt(e.seat, 'bonus').set(e.bonus);
          break;
        case 'deal': {
          const dealtMine = e.seats.filter(owns);
          if (dealtMine.length) {
            last = Object.fromEntries(dealtMine.map((spot) => [spot, betsOf(spot)]));
            roundNet = 0;
          }
          await sweepCards();
          board.length = 0;
          board.push(null, null);
          await dealAround(e.seats);
          break;
        }
        case 'hand':
          if (owns(e.seat)) await showMine(e.seat, e.cards);
          break;
        case 'decide':
          sent.clear();
          if (spots.some((spot) => upNow(next.seats[spot], e.bet === 1 ? 'first' : 'second') === 'pending')) {
            view = { ...next, phase: e.bet === 1 ? 'first' : 'second', board: [...board] };
            renderControls();
            const several = spots.filter((spot) => next.seats[spot]).length > 1;
            ctx.kit.say(e.bet === 1 ? (several ? 'Bet 1: ride or pull back, hand by hand' : 'Let bet 1 ride, or pull it back?') : several ? 'Bet 2: ride or pull back, hand by hand' : 'Let bet 2 ride, or pull it back?', 4000);
          }
          break;
        case 'decision': {
          if (owns(e.seat)) decideBar.hidden = true;
          if (e.choice === 'pull') {
            await pullBack(e.seat, (e.bet - 1) as Circle);
            if (owns(e.seat)) pill(circlePoint(e.seat, (e.bet - 1) as Circle), `${e.bet} BACK`, 'push');
          } else if (owns(e.seat)) {
            ctx.sfx.play('chip-lay', { volume: 0.5 });
          }
          if (owns(e.seat) && e.auto) ctx.kit.say(`Time: bet ${e.bet} pulled back`, 2000);
          break;
        }
        case 'board': {
          board[e.index] = e.card;
          const m = boardCards[e.index];
          if (m) await turnOver([m], [e.card], 0);
          for (const spot of spots) {
            const sv = next.seats[spot];
            if (sv && sv.cards.every((c) => c !== null)) handLabel(spot, { ...sv, result: null }, board);
          }
          if (e.index === 0) await wait(500);
          break;
        }
        case 'show': {
          const ms = hands.get(e.seat);
          if (ms && ms.some((m) => !m.faceUp)) await turnOver(ms, e.cards, 50);
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
          await settleSeat(e.seat, e.result, sv.unit, sv.bonus);
          handLabel(e.seat, sv, next.board);
          const five = [...(sv.cards as Card[]), ...(next.board as Card[])];
          if (owns(e.seat) && five.every((c) => c !== null)) {
            celebrateHand(e.seat, e.result, five);
            await callResult(e.result, five, spots.length > 1);
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

  // ---- clock -------------------------------------------------------------------------------

  const tickClock = (): void => {
    const v = view;
    if (mode !== 'multi' || !v || v.deadline === null || v.phase === 'idle' || v.phase === 'results') {
      clock.hidden = true;
      return;
    }
    const whole = v.phase === 'betting' ? BETTING_MS : DECISION_MS;
    const leftMs = Math.max(0, v.deadline - serverNow());
    clock.hidden = false;
    clock.classList.toggle('low', leftMs < 5_000);
    left.setAttribute('stroke-dashoffset', (CIRC * (1 - leftMs / whole)).toFixed(2));
    clockText.textContent = String(Math.ceil(leftMs / 1000));
  };

  // ---- the TableView -------------------------------------------------------------------------

  return {
    onTable(snap) {
      cfg = snap.meta.config;
      mode = snap.meta.mode;
      members = snap.members;
      me = snap.you.status === 'watching' ? null : snap.you.seat;
      stack = snap.you.stack;
      const v = snap.view as LetItRideView;
      pay = v.paytable ?? paytableOf(cfg.options);
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
      tray.setChipMax(Math.max(bet.max, (cfg.limits.bonus ?? cfg.limits.default).max), (cfg.limits.bonus ?? cfg.limits.default).min);
      fillRules();
      renderNames();
      draw(v);
    },

    async onEvents(events: GameEvent[], raw) {
      const next = raw as LetItRideView;
      latest = next;
      await play(events as LetItRideEvent[], next);
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
      if (isChipKey(e.key)) {
        tray.key(e);
        return true;
      }
      if (e.code === 'Space') {
        primary();
        return true;
      }
      if (e.code === 'KeyL') {
        decide('ride');
        return true;
      }
      if (e.code === 'KeyP') {
        decide('pull');
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
      litMat.opacity = 0.62 + 0.3 * wave(performance.now() / 260);
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
      decideBar.remove();
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
