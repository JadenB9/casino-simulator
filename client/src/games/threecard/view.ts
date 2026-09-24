// The Three Card Poker table view. Every hand plays out the way the server already settled it:
// cards come out of the shuffler three rounds around the table, your own three turn over, the
// Play bet goes down or the hand is mucked, the dealer turns all three cards at once, and each
// spot is swept or paid where it lies before the chips go back to the players.

import * as THREE from 'three';
import type { TableView, TableViewCtx } from '../contract.ts';
import type { Member } from '../../../../shared/src/protocol.ts';
import type { TableConfig, GameEvent } from '../../../../shared/src/engine.ts';
import type { Card } from '../../../../shared/src/cards.ts';
import { type Cents, BETTING_CHIPS, formatMoney } from '../../../../shared/src/money.ts';
import { BETTING_MS, DECISION_MS } from '../../../../shared/src/games/threecard/engine.ts';
import type { ThreeCardView, ThreeCardEvent, SeatView } from '../../../../shared/src/games/threecard/protocol.ts';
import {
  type Paytable,
  type Settlement,
  CATEGORY_NAMES,
  DEFAULT_PAYTABLE,
  anteBonusPays,
  category,
  handName,
  handRanks,
  pairPlusPays,
  paytableOf,
  qualifies,
  score,
} from '../../../../shared/src/games/threecard/rules.ts';
import { playAdvice } from '../../../../shared/src/games/threecard/advice.ts';
import { CardMesh, dealCard, flipCard } from '../../table/cards.ts';
import { ChipStack, slideStack } from '../../table/chips.ts';
import { celebrate } from '../../table/celebrate.ts';
import type { Felt } from '../../table/felt.ts';
import { ease, tween, wait } from '../../table/tween.ts';
import { dropGlow, handGlow, raiseBanner } from '../blackjack/celebration.ts';
import { handMoment } from './moments.ts';
import { ChipTray, button, el } from '../../ui/kit.ts';
import { maxRefusal, threeCardMax } from '../../table/max.ts';
import { serverNow } from '../../net/clock.ts';
import {
  TOP_Y,
  RACK,
  SHUFFLER,
  DISCARD,
  DEALER_CARD_SCALE,
  DEALER_LABEL,
  SEAT_COUNT,
  SPOT_RADIUS,
  type SpotKind,
  along,
  dealerSlot,
  handSlot,
  makeFelt,
  payoutPoint,
  positionOf,
  railPoint,
  seatAngle,
  spotPoint,
} from './layout.ts';
import { FLOOR_FELT } from './model.ts';
import './threecard.css';

const KINDS: SpotKind[] = ['pairPlus', 'ante', 'play'];
const SPOT_NAMES: Record<SpotKind, string> = { pairPlus: 'PAIR PLUS', ante: 'ANTE', play: 'PLAY' };
const RACK_POINT = new THREE.Vector3(RACK.x, TOP_Y + 0.012, RACK.z);

type Bets = { ante: Cents; pairPlus: Cents };
const NO_BETS: Bets = { ante: 0, pairPlus: 0 };

/** "a Flush", "a Pair of Kings", but "Ace high" and "Three Sevens". */
function withArticle(name: string): string {
  return / high$/.test(name) || name.startsWith('Three ') ? name : `a ${name}`;
}

function money(n: Cents): string {
  return formatMoney(n);
}

function signed(n: Cents): string {
  return n === 0 ? '$0' : formatMoney(n, { sign: true });
}

/** A point beside a spot, toward the player's left (right when `side` is 1), for pills. */
function besideSpot(seat: number, kind: SpotKind, offset: number): THREE.Vector3 {
  const a = seatAngle(seat);
  const p = spotPoint(seat, kind, TOP_Y + 0.02);
  return p.add(new THREE.Vector3(Math.cos(a) * offset, 0, -Math.sin(a) * offset));
}

function handLabelPoint(seat: number): THREE.Vector3 {
  const [x, z] = along(seatAngle(seat), 0.665);
  return new THREE.Vector3(x, TOP_Y + 0.01, z);
}

/** A limits sign on a little stand by the chip rack, painted from the table's config. */
function placard(cfg: TableConfig): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 300;
  const g = c.getContext('2d')!;
  g.fillStyle = '#101418';
  g.fillRect(0, 0, 512, 300);
  g.strokeStyle = '#d8b06a';
  g.lineWidth = 6;
  g.strokeRect(12, 12, 488, 276);
  g.fillStyle = '#f1d59a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '600 40px Cinzel, Georgia, serif';
  g.fillText('THREE CARD POKER', 256, 62);
  const ante = cfg.limits.ante ?? cfg.limits.default;
  const pp = cfg.limits.pairPlus ?? cfg.limits.default;
  g.font = '600 64px "Barlow Condensed", sans-serif';
  g.fillText(`${money(ante.min)} – ${money(ante.max)}`, 256, 148);
  g.font = '600 34px "Barlow Condensed", sans-serif';
  g.fillStyle = '#e8e0cc';
  g.fillText(`ANTE MINIMUM ${money(ante.min)}`, 256, 212);
  g.fillText(`PAIR PLUS ${money(pp.min)} – ${money(pp.max)}`, 256, 254);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.088), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
  sign.position.set(0.44, TOP_Y + 0.05, -0.43);
  sign.rotation.x = -0.28;
  sign.name = 'tc-placard';
  return sign;
}

/** Exact Pair Plus house edge of a pay table, from the 22,100 three-card hands. */
function pairPlusEdge(pay: Paytable): number {
  const counts = [16_440, 3_744, 1_096, 720, 52, 48];
  let ev = -counts[0]!;
  for (let cat = 1; cat <= 5; cat++) ev += pairPlusPays(cat as 1, pay) * counts[cat]!;
  return -ev / 22_100;
}

export function mountThreeCard(ctx: TableViewCtx): TableView {
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
  let view: ThreeCardView | null = null;
  // the newest state from the server, which can be ahead of what is drawn while a hand animates
  let latest: ThreeCardView | null = null;
  let members: Member[] = [];

  // my bets as I've asked for them, ahead of the server's answer, and the steps to undo
  let mine: Bets = { ...NO_BETS };
  let history: Bets[] = [];
  let last: Bets | null = null;
  let lastNet: Cents | null = null;
  let readyOn = false;
  let lastAction: 'bet' | 'other' = 'other';
  // set once my Play or Fold is on its way, so a stale view can't bring the buttons back
  let decided = false;

  // ---- table objects -----------------------------------------------------------------------

  const stacks = new Map<string, ChipStack>();
  const spotStack = (seat: number, kind: SpotKind): ChipStack => {
    const key = `${kind}:${seat}`;
    let s = stacks.get(key);
    if (!s) {
      s = new ChipStack();
      s.position.copy(spotPoint(seat, kind));
      root.add(s);
      stacks.set(key, s);
    }
    return s;
  };
  let payouts: { seat: number; stack: ChipStack }[] = [];
  const hands = new Map<number, CardMesh[]>();
  let dealerCards: CardMesh[] = [];
  const labels = new Map<string, { el: HTMLElement; obj: THREE.Object3D }>();

  const setLabel = (key: string, at: THREE.Vector3, parts: { text: string; cls?: string }[], cls: string): void => {
    let l = labels.get(key);
    if (!l) {
      const e = el('div', cls);
      l = { el: e, obj: ctx.stage.label(e, at) };
      labels.set(key, l);
    }
    l.el.className = cls;
    l.el.replaceChildren(...parts.map((p) => el('span', p.cls ?? '', p.text)));
    l.obj.position.copy(at);
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
    // flip about the card's own width, then turn it to face its player
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

  const playBtn = button('Play', () => decide('play'), { cls: 'primary', key: 'P' });
  const foldBtn = button('Fold', () => decide('fold'), { key: 'F' });
  const decideHint = el('div', 'tc-hint', 'Play Q-6-4 or better');
  const decideBar = el('div', 'tc-decide panel');
  decideBar.append(foldBtn, playBtn, decideHint);
  decideBar.hidden = true;
  ctx.ui.append(decideBar);

  const meters = el('div', 'tc-meters panel');
  const meterStack = el('span', 'money');
  const meterBet = el('span', 'money');
  const meterLast = el('span', 'money');
  meters.append(el('span', 'label', 'Chips'), meterStack, el('span', 'label', 'Bet'), meterBet, el('span', 'label', 'Last hand'), meterLast);
  ctx.ui.append(meters);

  const SVG = 'http://www.w3.org/2000/svg';
  const clock = el('div', 'tc-clock');
  const ring = document.createElementNS(SVG, 'svg');
  ring.setAttribute('viewBox', '0 0 44 44');
  ring.classList.add('tc-ring');
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
  const clockText = el('span', 'tc-clock-text');
  clock.append(ring, clockText);
  clock.hidden = true;
  ctx.ui.append(clock);

  const rules = el('div', 'tc-rules panel');
  rules.hidden = true;
  const rulesBtn = button('Rules', () => (rules.hidden = !rules.hidden), { cls: 'ghost tc-rules-btn', key: 'I' });
  ctx.ui.append(rules, rulesBtn);

  const fillRules = (): void => {
    const edge = pairPlusEdge(pay);
    const bonus145 = pay.anteBonus.join('-') === '5-4-1';
    const p = (t: string) => el('p', '', t);
    const table = (title: string, rows: [string, number][]) => {
      const t = el('div', 'tc-paytable');
      t.append(el('div', 'label', title));
      for (const [name, pays] of rows) {
        const r = el('div', 'row');
        r.append(el('span', '', name), el('span', 'money', `${pays} to 1`));
        t.append(r);
      }
      return t;
    };
    const cat = (i: number) => CATEGORY_NAMES[5 - i]!;
    rules.replaceChildren(
      el('h3', '', 'Three Card Poker'),
      p('Bet the Ante, Pair Plus, or both. After seeing your three cards, Play (a second bet equal to the Ante) or Fold. Folding loses the Ante and the Pair Plus.'),
      p('The dealer plays with queen high or better. If not, the Ante pays 1 to 1 and the Play pushes. If so, the higher hand wins both bets 1 to 1 and a tie pushes.'),
      table('Ante Bonus, paid on played hands whatever the dealer holds', pay.anteBonus.map((x, i) => [cat(i), x])),
      table('Pair Plus, paid on your own hand', pay.pairPlus.map((x, i) => [cat(i), x])),
      p('Hands, best first: straight flush, three of a kind, straight, flush, pair, high card. A-K-Q is the top straight and A-2-3 the lowest.'),
      p(`Best play: Play with Q-6-4 or better, fold the rest.${bonus145 ? ' That gives the house 3.37% of the Ante.' : ''} Pair Plus: ${(edge * 100).toFixed(2)}%.`),
      el('p', 'tc-keys', '1-8 chips · M max, then click the Ante or Pair Plus · Space deal · P play · F fold · R rebet · Shift R double · X clear · Backspace undo'),
    );
  };

  // ---- helpers over the current view -------------------------------------------------------

  const seatView = (seat: number | null): SeatView | undefined => (seat === null || !view ? undefined : view.seats[seat]);
  const canBet = (): boolean => {
    if (me === null || !latest) return false;
    if (mode === 'multi') return latest.phase === 'betting';
    return latest.phase !== 'deciding';
  };
  const limitMax = (): Cents => {
    if (!cfg) return Infinity;
    return Math.max((cfg.limits.ante ?? cfg.limits.default).max, (cfg.limits.pairPlus ?? cfg.limits.default).max);
  };

  const renderMeters = (): void => {
    const sv = seatView(me);
    const onLayout = view && sv && (view.phase === 'betting' || view.phase === 'deciding') && sv.decision !== 'fold' ? sv.ante + sv.pairPlus + sv.play : 0;
    meterStack.textContent = money(stack);
    meterBet.textContent = money(view?.phase === 'betting' ? mine.ante + mine.pairPlus : onLayout);
    meterLast.textContent = lastNet === null ? '–' : signed(lastNet);
    meterLast.className = `money ${lastNet === null || lastNet === 0 ? '' : lastNet > 0 ? 'up' : 'down'}`;
  };

  const renderControls = (): void => {
    const sv = seatView(me);
    const deciding = view?.phase === 'deciding' && sv?.decision === 'pending' && !decided;
    decideBar.hidden = !deciding;
    tray.root.classList.toggle('tc-away', deciding);
    if (deciding && sv) playBtn.firstChild!.textContent = `Play ${money(sv.ante)}`;
    renderTip();
    if (mode === 'solo') {
      tray.setPrimary('Deal', !!view && view.phase === 'betting' && mine.ante + mine.pairPlus > 0);
    } else {
      tray.setPrimary(readyOn ? 'Waiting' : 'Ready', !!view && view.phase === 'betting' && me !== null);
    }
    renderMeters();
  };

  /** Tips: Play or Fold by Q-6-4 for my three cards, while that decision is mine to make. */
  const renderTip = (): void => {
    const sv = seatView(me);
    const cards = ctx.tips.on && !decided && view?.phase === 'deciding' && sv?.decision === 'pending' && sv.cards.length === 3 && sv.cards.every((c) => c !== null) ? (sv.cards as Card[]) : null;
    const a = cards ? playAdvice(cards) : null;
    playBtn.classList.toggle('tip-pick', a?.play === true);
    foldBtn.classList.toggle('tip-pick', a?.play === false);
    ctx.kit.tip(a ? a.text : null);
  };
  const offTips = ctx.tips.subscribe(() => renderTip());
  const lowerBanner = raiseBanner(ctx.ui);

  /** My hand's moment, if it was one, with the light under my cards. */
  const celebrateHand = (r: Settlement, cards: Card[]): void => {
    const m = me === null ? null : handMoment(r, cards, pay);
    if (!m || me === null) return;
    const stand = handGlow(hands.get(me) ?? [], TOP_Y + 0.0009);
    celebrate(ctx, { ...m, at: handSlot(me, 1).pos, glow: stand ? [stand] : [] });
    dropGlow(stand);
  };

  // ---- drawing the whole table from a view (on join, and after each batch of events) ---------

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

  const handLabel = (seat: number, sv: SeatView): void => {
    const cls = `tc-hand${seat === me ? ' mine' : ''}`;
    if (sv.decision === 'fold') {
      setLabel(`hand:${seat}`, handLabelPoint(seat), [{ text: 'Folded', cls: 'muted' }], cls);
      return;
    }
    const cards = sv.cards;
    if (cards.length !== 3 || cards.some((c) => c === null)) {
      dropLabel(`hand:${seat}`);
      return;
    }
    const parts: { text: string; cls?: string }[] = [{ text: handName(score(cards as Card[])) }];
    const r = sv.result;
    if (r) {
      const net = r.returned - r.wagered;
      parts.push({ text: net === 0 ? 'Push' : signed(net), cls: net > 0 ? 'net up' : net < 0 ? 'net down' : 'net' });
    }
    setLabel(`hand:${seat}`, handLabelPoint(seat), parts, cls);
  };

  /** "Dealer · Jack high · does not qualify", in front of the dealer's cards. */
  const dealerLabel = (cards: Card[]): void => {
    const s = score(cards);
    const parts: { text: string; cls?: string }[] = [{ text: 'Dealer', cls: 'tc-dealer-word' }, { text: handName(s), cls: 'tc-dealer-hand' }];
    if (!qualifies(s)) parts.push({ text: 'does not qualify', cls: 'muted' });
    setLabel('dealer', DEALER_LABEL.clone(), parts, 'tc-hand tc-dealer');
  };

  const scaleTo = (m: CardMesh, to: number, ms: number): Promise<void> => {
    const from = m.scale.x;
    return tween(ms, (k) => m.scale.setScalar(from + (to - from) * k), ease.out);
  };

  const clearPayouts = (): void => {
    for (const p of payouts) p.stack.removeFromParent();
    payouts = [];
  };

  const draw = (v: ThreeCardView): void => {
    view = v;
    clearPayouts();
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      const sv = v.seats[seat];
      const live = sv && (v.phase === 'betting' || (v.phase === 'deciding' && sv.decision !== 'fold'));
      for (const kind of KINDS) {
        const s = spotStack(seat, kind);
        s.position.copy(spotPoint(seat, kind));
        const own = seat === me && v.phase === 'betting';
        const amount = own ? (kind === 'ante' ? mine.ante : kind === 'pairPlus' ? mine.pairPlus : 0) : live ? (kind === 'ante' ? sv.ante : kind === 'pairPlus' ? sv.pairPlus : sv.play) : 0;
        if (s.amount !== amount) s.set(amount);
      }
      const showCards = sv && sv.cards.length === 3 && sv.decision !== 'fold' && v.phase !== 'betting';
      if (showCards) layCards(seat, sv.cards);
      else {
        removeCards(hands.get(seat) ?? []);
        hands.delete(seat);
      }
      if (sv && v.phase !== 'betting') handLabel(seat, sv);
      else dropLabel(`hand:${seat}`);
    }
    if (v.dealer.length === 3) {
      if (dealerCards.length !== 3) {
        removeCards(dealerCards);
        dealerCards = v.dealer.map(() => newCard(null));
      }
      dealerCards.forEach((m, i) => {
        const c = v.dealer[i] ?? null;
        if (c && m.card !== c) m.setCard(c);
        m.position.copy(dealerSlot(i));
        m.rotation.set(c ? 0 : Math.PI, 0, 0);
        m.scale.setScalar(DEALER_CARD_SCALE);
      });
      if (v.dealer.every((c) => c !== null)) dealerLabel(v.dealer as Card[]);
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
      // the round is over (or cards are out): the next bet starts from nothing
      mine = { ...NO_BETS };
      history = [];
    }
    renderControls();
  };

  /** What the table itself holds for me right now. */
  const serverBets = (): Bets => {
    const sv = seatView(me);
    return view?.phase === 'betting' && sv ? { ante: sv.ante, pairPlus: sv.pairPlus } : { ...NO_BETS };
  };

  // ---- the player's moves --------------------------------------------------------------------

  const sendBets = (next: Bets, push = true): void => {
    if (!canBet() || (next.ante === mine.ante && next.pairPlus === mine.pairPlus)) return;
    if (push) history.push({ ...mine });
    mine = next;
    if (me !== null) {
      spotStack(me, 'ante').set(next.ante);
      spotStack(me, 'pairPlus').set(next.pairPlus);
    }
    lastAction = 'bet';
    ctx.link.act({ type: 'bet', ante: next.ante, pairPlus: next.pairPlus });
    renderControls();
  };

  const addChip = (kind: 'ante' | 'pairPlus'): void => {
    if (!canBet()) return;
    // Max picked: the most this spot takes (the Ante keeping its Play back)
    let add = tray.selected.value;
    if (tray.maxPicked && cfg) {
      const m = threeCardMax(cfg, kind, mine, stack);
      if ('none' in m) return ctx.kit.toast(maxRefusal(m, cfg.limits[kind] ?? cfg.limits.default));
      add = m.amount;
    }
    ctx.sfx.play('chip-lay');
    sendBets({ ...mine, [kind]: mine[kind] + add });
  };

  const undo = (): void => {
    const prev = history.pop();
    if (prev) sendBets(prev, false);
  };
  const clear = (): void => {
    if (mine.ante + mine.pairPlus > 0) sendBets({ ...NO_BETS });
  };
  const rebet = (times: number): void => {
    const from = times > 1 && mine.ante + mine.pairPlus > 0 ? mine : last;
    if (!from) return;
    ctx.sfx.play('chips-handle');
    sendBets({ ante: from.ante * times, pairPlus: from.pairPlus * times });
  };

  const primary = (): void => {
    if (!latest || me === null) return;
    if (mode === 'solo') {
      if (latest.phase === 'betting' && mine.ante + mine.pairPlus > 0) {
        lastAction = 'other';
        ctx.link.act({ type: 'deal' });
      }
      return;
    }
    if (latest.phase !== 'betting') return;
    readyOn = !readyOn;
    ctx.link.ready(readyOn);
    ctx.sfx.play('ui-click');
    renderControls();
  };

  const decide = (choice: 'play' | 'fold'): void => {
    const sv = me === null ? undefined : latest?.seats[me];
    if (decided || latest?.phase !== 'deciding' || sv?.decision !== 'pending') return;
    ctx.sfx.play('ui-click');
    decided = true;
    decideBar.hidden = true;
    renderTip();
    tray.root.classList.remove('tc-away');
    lastAction = 'other';
    ctx.link.act({ type: choice });
  };

  // ---- pointer: bet on my spots, with a hover ring --------------------------------------------

  const hoverRing = new THREE.Mesh(
    new THREE.RingGeometry(SPOT_RADIUS * 1.02, SPOT_RADIUS * 1.18, 48),
    new THREE.MeshBasicMaterial({ color: '#f5dc9c', transparent: true, opacity: 0.75, depthWrite: false }),
  );
  hoverRing.rotation.x = -Math.PI / 2;
  hoverRing.visible = false;
  root.add(hoverRing);
  const tip = el('div', 'tc-tip');
  const tipObj = ctx.stage.label(tip, new THREE.Vector3());
  tipObj.visible = false;

  const mySpotAt = (e: PointerEvent): 'ante' | 'pairPlus' | null => {
    if (e.target !== canvas || me === null) return null;
    const hit = ctx.stage.pick(e);
    const id = hit?.region;
    if (id === `ante:${me}`) return 'ante';
    if (id === `pairPlus:${me}`) return 'pairPlus';
    return null;
  };
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const kind = mySpotAt(e);
    if (kind) addChip(kind);
  };
  const onMove = (e: PointerEvent): void => {
    const kind = canBet() ? mySpotAt(e) : null;
    hoverRing.visible = kind !== null;
    tipObj.visible = kind !== null;
    canvas.style.cursor = kind ? 'pointer' : '';
    if (!kind || me === null) return;
    const p = spotPoint(me, kind, TOP_Y + 0.0015);
    hoverRing.position.copy(p);
    tipObj.position.copy(besideSpot(me, kind, 0.16));
    const amount = kind === 'ante' ? mine.ante : mine.pairPlus;
    const pays = kind === 'ante' ? 'pays 1 to 1' : `pays up to ${pay.pairPlus[0]} to 1`;
    const most = tray.maxPicked && cfg ? threeCardMax(cfg, kind, mine, stack) : null;
    const max = most && 'amount' in most ? ` · Max adds ${money(most.amount)}` : '';
    tip.textContent = `${SPOT_NAMES[kind]} · ${pays}${amount ? ` · ${money(amount)}` : ''}${max}`;
  };
  addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);

  // ---- name tags for the other players -------------------------------------------------------

  const renderNames = (): void => {
    dropLabels('name:');
    if (mode !== 'multi') return;
    for (const m of members) {
      if (m.seat === null || m.status === 'watching') continue;
      const p = railPoint(m.seat).setY(TOP_Y + 0.07);
      setLabel(`name:${m.seat}`, p, [{ text: m.name }], `tc-name${m.seat === me ? ' mine' : ''}${m.connected ? '' : ' away'}`);
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
    await Promise.all(all.map((m, i) => wait(i * 12).then(() => dealCard(m, m.position.clone(), DISCARD, { faceUp: false, ms: 260, yaw: 0 }))));
    removeCards(all);
  };

  const startRound = async (): Promise<void> => {
    clearPayouts();
    if (mode === 'multi') {
      // the host keeps the ready flag between rounds; start every window not ready
      if (readyOn) ctx.link.ready(false);
      readyOn = false;
      ctx.kit.say('Place your bets', 2400);
    }
    await sweepCards();
  };

  const dealAround = async (seats: number[]): Promise<void> => {
    if (mode === 'multi') ctx.kit.say('No more bets', 1600);
    // first base first, three times around, the dealer last each time
    const order = [...seats].sort((a, b) => positionOf(a) - positionOf(b));
    const jobs: Promise<void>[] = [];
    let n = 0;
    for (const seat of order) hands.set(seat, []);
    dealerCards = [];
    for (let round = 0; round < 3; round++) {
      for (const target of [...order, -1]) {
        const m = newCard(null);
        m.position.copy(SHUFFLER);
        const delay = n++ * 75;
        if (target < 0) dealerCards.push(m);
        else hands.get(target)!.push(m);
        const to = target < 0 ? dealerSlot(round) : handSlot(target, round).pos;
        const yaw = target < 0 ? 0 : handSlot(target, round).yaw;
        ctx.sfx.play('card-deal', { delay: delay / 1000, volume: 0.8 });
        // the dealer's own cards grow to their larger size on the way out
        jobs.push(wait(delay).then(() => Promise.all([dealCard(m, SHUFFLER, to, { faceUp: false, ms: 260, yaw }), target < 0 ? scaleTo(m, DEALER_CARD_SCALE, 260) : null]).then(() => {})));
      }
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

  const showMine = async (cards: Card[]): Promise<void> => {
    if (me === null) return;
    const ms = hands.get(me);
    if (ms && ms.length === 3) await turnOver(ms, cards, 70);
    setLabel(`hand:${me}`, handLabelPoint(me), [{ text: handName(score(cards)) }], 'tc-hand mine');
  };

  const placePlay = async (seat: number, amount: Cents): Promise<void> => {
    const chips = new ChipStack();
    chips.set(amount);
    chips.position.copy(railPoint(seat));
    root.add(chips);
    ctx.sfx.play('chip-lay');
    await slideStack(chips, spotPoint(seat, 'play'), 360);
    chips.removeFromParent();
    spotStack(seat, 'play').set(amount);
  };

  const sweep = async (seat: number, kinds: SpotKind[]): Promise<void> => {
    const moving = kinds.map((k) => spotStack(seat, k)).filter((s) => s.amount > 0);
    if (moving.length === 0) return;
    ctx.sfx.play('chips-collide', { volume: 0.7 });
    await Promise.all(moving.map((s) => slideStack(s, RACK_POINT, 380)));
    for (const s of moving) s.set(0);
  };

  const muck = async (seat: number): Promise<void> => {
    const cards = hands.get(seat) ?? [];
    hands.delete(seat);
    dropLabel(`hand:${seat}`);
    ctx.sfx.play('card-place');
    await Promise.all([...cards.map((m) => dealCard(m, m.position.clone(), DISCARD, { faceUp: false, ms: 300, yaw: 0 })), sweep(seat, ['ante', 'pairPlus'])]);
    removeCards(cards);
  };

  const payOut = async (seat: number, kind: SpotKind, amount: Cents, side: number): Promise<void> => {
    const chips = new ChipStack();
    chips.set(amount);
    chips.position.copy(RACK_POINT);
    root.add(chips);
    payouts.push({ seat, stack: chips });
    const to = side > 0 ? payoutPoint(seat, kind) : besideSpot(seat, kind, -SPOT_RADIUS * 1.25).setY(TOP_Y);
    await slideStack(chips, to, 420);
  };

  const pill = (seat: number, kind: SpotKind, text: string, kindOf: 'win' | 'lose' | 'push', offset = -0.11): void => {
    ctx.kit.pill(ctx.stage, besideSpot(seat, kind, offset), text, kindOf, 3000);
  };

  /** Sweep what lost, pay what won, and pin the result to each of my spots. */
  const settleSeat = async (seat: number, r: Settlement, bets: Bets & { play: Cents }): Promise<void> => {
    const jobs: Promise<void>[] = [];
    const lost: SpotKind[] = [];
    const spots: [SpotKind, Cents, Cents][] = [
      ['pairPlus', bets.pairPlus, r.pairPlus],
      ['ante', bets.ante, r.ante],
      ['play', bets.play, r.play],
    ];
    for (const [kind, staked, back] of spots) {
      if (staked === 0) continue;
      if (back === 0) lost.push(kind);
      else if (back > staked) jobs.push(payOut(seat, kind, back - staked, 1));
      if (seat !== me) continue;
      if (back === 0) pill(seat, kind, formatMoney(-staked), 'lose');
      else if (back === staked) pill(seat, kind, 'PUSH', 'push');
      else {
        const odds = kind === 'pairPlus' ? ` · ${(back - staked) / staked} TO 1` : '';
        pill(seat, kind, `${signed(back - staked)}${odds}`, 'win');
      }
    }
    if (r.bonus > 0) {
      jobs.push(payOut(seat, 'ante', r.bonus, -1));
      if (seat === me) pill(seat, 'ante', `BONUS ${signed(r.bonus)}`, 'win', 0.13);
    }
    if (jobs.length > 0) ctx.sfx.play('chips-stack');
    jobs.push(sweep(seat, lost));
    await Promise.all(jobs);
  };

  /** Everything still on the layout goes back to its player. */
  const collect = async (): Promise<void> => {
    const moving: { seat: number; stack: THREE.Object3D }[] = [];
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      for (const kind of KINDS) {
        const s = stacks.get(`${kind}:${seat}`);
        if (s && s.amount > 0) moving.push({ seat, stack: s });
      }
    }
    for (const p of payouts) moving.push(p);
    if (moving.length === 0) return;
    ctx.sfx.play('chips-handle', { volume: 0.8 });
    await Promise.all(moving.map((m) => slideStack(m.stack, railPoint(m.seat), 420)));
    for (const m of moving) {
      if (m.stack instanceof ChipStack) m.stack.set(0);
    }
    clearPayouts();
  };

  /** The dealer's calls for my hand once it has settled. */
  const callResult = async (r: Settlement, mineCards: Card[], dealer: Card[]): Promise<void> => {
    const ps = score(mineCards);
    const ds = score(dealer);
    const pn = handName(ps);
    const dn = handName(ds);
    const cat = category(ps);
    const lines: string[] = [];
    if (r.outcome === 'win') lines.push(pn === dn ? `${handRanks(ps)} beats ${handRanks(ds)}: Ante and Play win` : `${pn} beats ${dn}: Ante and Play win`);
    else if (r.outcome === 'lose') lines.push(pn === dn ? `Dealer wins, ${handRanks(ds)} over ${handRanks(ps)}` : `Dealer wins with ${withArticle(dn)}`);
    else if (r.outcome === 'push') lines.push(`Tie, ${handRanks(ps)} each: Ante and Play push`);
    const extras: string[] = [];
    if (r.bonus > 0) extras.push(`Ante Bonus ${anteBonusPays(cat, pay)} to 1`);
    if (r.pairPlus > 0) extras.push(`Pair Plus ${pairPlusPays(cat, pay)} to 1`);
    if (extras.length) lines.push(`${pn}: ${extras.join(', ')}`);
    else if (r.outcome === null && r.pairPlus === 0) lines.push(`${pn}: Pair Plus loses`);
    for (const line of lines) {
      ctx.kit.say(line, 2600);
      await wait(1100);
    }
  };

  // ---- the event player ----------------------------------------------------------------------

  const play = async (events: ThreeCardEvent[], next: ThreeCardView): Promise<void> => {
    let settled = false;
    let dealer: Card[] | null = null;
    let anyPlayed = false;
    for (const e of events) {
      switch (e.type) {
        case 'betting':
          await startRound();
          break;
        case 'bets':
          // my own bets are already on the felt as I asked for them; this is the echo
          if (e.seat === me) break;
          ctx.sfx.play('chip-lay', { volume: 0.4 });
          spotStack(e.seat, 'ante').set(e.ante);
          spotStack(e.seat, 'pairPlus').set(e.pairPlus);
          break;
        case 'deal':
          if (me !== null && e.seats.includes(me)) last = { ...mine };
          await sweepCards();
          await dealAround(e.seats);
          break;
        case 'hand':
          if (e.seat === me) await showMine(e.cards);
          break;
        case 'decide':
          decided = false;
          if (me !== null && next.seats[me]?.decision === 'pending') {
            view = next;
            renderControls();
            ctx.kit.say('Play or fold?', 4000);
          }
          break;
        case 'decision':
          if (e.seat === me) decideBar.hidden = true;
          if (e.choice === 'play') {
            anyPlayed = true;
            await placePlay(e.seat, e.play);
          } else {
            await muck(e.seat);
            if (e.seat === me) {
              const sv = next.seats[e.seat];
              ctx.kit.say(sv && sv.pairPlus > 0 ? 'Folded: Ante and Pair Plus lost' : 'Folded: Ante lost', 2400);
            }
          }
          break;
        case 'reveal': {
          dealer = e.dealer;
          if (dealerCards.length === 3) await turnOver(dealerCards, e.dealer, 0);
          dealerLabel(e.dealer);
          const played = anyPlayed || Object.values(next.seats).some((s) => s.decision === 'play');
          if (played) {
            ctx.kit.say(e.qualifies ? 'Dealer qualifies: Queen high or better' : 'Dealer does not qualify: Ante pays 1 to 1, Play pushes', 2600);
            await wait(1200);
          } else {
            ctx.kit.say(`Dealer has ${handName(score(e.dealer))}`, 2200);
            await wait(700);
          }
          break;
        }
        case 'show':
          if (e.seat !== me) {
            const ms = hands.get(e.seat);
            if (ms && ms.length === 3) await turnOver(ms, e.cards, 50);
          } else if (me !== null) {
            const ms = hands.get(me);
            if (ms && ms.some((m) => !m.faceUp)) await turnOver(ms, e.cards, 50);
          }
          setLabel(`hand:${e.seat}`, handLabelPoint(e.seat), [{ text: handName(score(e.cards)) }], `tc-hand${e.seat === me ? ' mine' : ''}`);
          break;
        case 'result': {
          const sv = next.seats[e.seat];
          if (e.seat === me) lastNet = e.result.returned - e.result.wagered;
          if (e.result.outcome === 'fold' || !sv) break;
          settled = true;
          await settleSeat(e.seat, e.result, { ante: sv.ante, pairPlus: sv.pairPlus, play: sv.play });
          handLabel(e.seat, sv);
          if (e.seat === me && sv.cards.every((c) => c !== null)) celebrateHand(e.result, sv.cards as Card[]);
          if (e.seat === me && dealer && sv.cards.every((c) => c !== null)) await callResult(e.result, sv.cards as Card[], dealer);
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
    if (mode !== 'multi' || !v || v.deadline === null || (v.phase !== 'betting' && v.phase !== 'deciding')) {
      clock.hidden = true;
      return;
    }
    const total = v.phase === 'betting' ? BETTING_MS : DECISION_MS;
    const leftMs = Math.max(0, v.deadline - serverNow());
    clock.hidden = false;
    clock.classList.toggle('low', leftMs < 5_000);
    left.setAttribute('stroke-dashoffset', (CIRC * (1 - leftMs / total)).toFixed(2));
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
      const v = snap.view as ThreeCardView;
      pay = v.paytable ?? paytableOf(cfg.options);
      view = v;
      latest = v;
      mine = serverBets();
      if (!felt) {
        felt = makeFelt(pay, 1400);
        ctx.stage.addFelt(felt, TOP_Y + 0.0006);
        if (floorFelt) floorFelt.visible = false;
      }
      if (!sign) {
        sign = placard(cfg);
        root.add(sign);
      }
      // hide chips the table can't take
      const max = limitMax();
      tray.root.querySelectorAll<HTMLButtonElement>('.chip-btn').forEach((b, i) => (b.hidden = (BETTING_CHIPS[i]?.value ?? 0) > max));
      fillRules();
      renderNames();
      draw(v);
    },

    async onEvents(events: GameEvent[], raw) {
      const next = raw as ThreeCardView;
      latest = next;
      await play(events as ThreeCardEvent[], next);
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
      // a refused move: go back to what the table really holds
      if (lastAction === 'bet') {
        history.pop();
        mine = serverBets();
      } else {
        decided = false;
      }
      if (view) draw(view);
    },

    keydown(e) {
      if (e.metaKey && e.key !== 'z') return false;
      if (e.repeat && !/^[1-8]$/.test(e.key)) return true;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= BETTING_CHIPS.length) {
        if ((BETTING_CHIPS[n - 1]?.value ?? 0) <= limitMax()) tray.key(e);
        return true;
      }
      if (e.code === 'Space') {
        primary();
        return true;
      }
      if (e.code === 'KeyP') {
        decide('play');
        return true;
      }
      if (e.code === 'KeyF') {
        decide('fold');
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
      // Max while a bet can go down; otherwise M is the casino's mute
      if (e.code === 'KeyM' && !e.shiftKey && canBet()) {
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
    },

    dispose() {
      offTips();
      lowerBanner();
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
