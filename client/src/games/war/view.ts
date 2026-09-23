// The Casino War table view. Every round plays out the way the server already settled it: the
// dealer draws from the shoe, one card face up to each player from first base and one to the
// dealer; each spot is swept or paid where it lies, right to left; a tie pays its Tie bet and waits
// for War or Surrender; the dealer burns three into the discard holder and deals the war; and the
// chips go back to the players.

import * as THREE from 'three';
import type { TableView, TableViewCtx } from '../contract.ts';
import type { Member } from '../../../../shared/src/protocol.ts';
import type { TableConfig, GameEvent } from '../../../../shared/src/engine.ts';
import type { Card } from '../../../../shared/src/cards.ts';
import { type Cents, BETTING_CHIPS, formatMoney } from '../../../../shared/src/money.ts';
import { BETTING_MS, DECISION_MS } from '../../../../shared/src/games/war/engine.ts';
import type { WarView, WarEvent, SeatView } from '../../../../shared/src/games/war/protocol.ts';
import { DEFAULT_RULES, SHOE_CARDS, bestChoice, cardName, exactOdds, pluralName, type Settlement, type WarRules } from '../../../../shared/src/games/war/rules.ts';
import { CardMesh, dealCard } from '../../table/cards.ts';
import { ChipStack, slideStack } from '../../table/chips.ts';
import { celebrate } from '../../table/celebrate.ts';
import type { Felt } from '../../table/felt.ts';
import { wait } from '../../table/tween.ts';
import { ChipTray, button, el } from '../../ui/kit.ts';
import { serverNow } from '../../net/clock.ts';
import {
  TOP_Y,
  RACK,
  SHOE_MOUTH,
  DISCARD,
  SEAT_COUNT,
  SPOT_SIZE,
  type SpotKind,
  besideSpot,
  cardSlot,
  dealerSlot,
  handLabelPoint,
  makeFelt,
  payoutPoint,
  positionOf,
  railPoint,
  spotPoint,
} from './layout.ts';
import { FLOOR_FELT, discardStack } from './model.ts';
import './war.css';

const KINDS: SpotKind[] = ['tie', 'bet', 'war'];
const RACK_POINT = new THREE.Vector3(RACK.x, TOP_Y + 0.012, RACK.z);

type Bets = { bet: Cents; tie: Cents };
const NO_BETS: Bets = { bet: 0, tie: 0 };

function money(n: Cents): string {
  return formatMoney(n);
}

function signed(n: Cents): string {
  return n === 0 ? '$0' : formatMoney(n, { sign: true });
}

function pct(x: number): string {
  return `${(x * 100).toFixed(x < 0.1 ? 2 : 1)}%`;
}

const OUTCOME_WORDS: Record<Settlement['outcome'], string> = {
  win: 'Won',
  lose: 'Lost',
  surrender: 'Surrendered',
  'war-win': 'War won',
  'war-tie': 'War tied',
  'war-lose': 'War lost',
};

/** The objects that exist, for a celebration's glow. */
function present(...xs: (THREE.Object3D | null | undefined)[]): THREE.Object3D[] {
  return xs.filter((x): x is THREE.Object3D => !!x);
}

/** "an Ace", "an Eight", "a King". */
function aName(card: Card): string {
  const n = cardName(card);
  return /^[AE]/.test(n) ? `an ${n}` : `a ${n}`;
}

export function mountWar(ctx: TableViewCtx): TableView {
  const root = new THREE.Group();
  ctx.stage.root.add(root);
  const canvas = ctx.stage.engine.renderer.domElement;
  const floorFelt = ctx.stage.anchor.getObjectByName(FLOOR_FELT) ?? null;

  let felt: Felt | null = null;
  let cfg: TableConfig | null = null;
  let rules: WarRules = DEFAULT_RULES;
  let mode: 'solo' | 'multi' = 'solo';
  let me: number | null = null;
  let stack: Cents = 0;
  let view: WarView | null = null;
  // the newest state from the server, which can be ahead of what is drawn while a round animates
  let latest: WarView | null = null;
  let members: Member[] = [];

  // my bets as I've asked for them, ahead of the server's answer, and the steps to undo
  let mine: Bets = { ...NO_BETS };
  let history: Bets[] = [];
  let last: Bets | null = null;
  let lastNet: Cents | null = null;
  let readyOn = false;
  let lastAction: 'bet' | 'other' = 'other';
  // set once my War or Surrender is on its way, so a stale view can't bring the buttons back
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
  // each seat's card and war card, and the dealer's
  const seatCards = new Map<number, { card: CardMesh | null; war: CardMesh | null }>();
  let dealerCard: CardMesh | null = null;
  let dealerWar: CardMesh | null = null;
  const discard = discardStack();
  root.add(discard.mesh);
  let discardCount = 0;
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
  const setDiscard = (n: number): void => {
    discardCount = Math.max(0, n);
    discard.set(discardCount);
  };

  // ---- DOM: tray, decision bar, meters, clock, rules ---------------------------------------

  const tray = new ChipTray({
    undo: () => undo(),
    clear: () => clear(),
    rebet: () => rebet(1),
    double: () => rebet(2),
    primary: { label: 'Deal', key: 'Space', run: () => primary() },
  });
  tray.select(BETTING_CHIPS[2]!);
  ctx.ui.append(tray.root);

  const warBtn = button('Go to war', () => decide('war'), { cls: 'primary', key: 'W' });
  const surrenderBtn = button('Surrender', () => decide('surrender'), { key: 'S' });
  const decideHint = el('div', 'wr-hint', 'Surrender gives back half the bet');
  const decideBar = el('div', 'wr-decide panel');
  decideBar.append(surrenderBtn, warBtn, decideHint);
  decideBar.hidden = true;
  ctx.ui.append(decideBar);

  const meters = el('div', 'wr-meters panel');
  const meterStack = el('span', 'money');
  const meterBet = el('span', 'money');
  const meterLast = el('span', 'money');
  meters.append(el('span', 'label', 'Chips'), meterStack, el('span', 'label', 'Bet'), meterBet, el('span', 'label', 'Last hand'), meterLast);
  ctx.ui.append(meters);

  const SVG = 'http://www.w3.org/2000/svg';
  const clock = el('div', 'wr-clock');
  const ring = document.createElementNS(SVG, 'svg');
  ring.setAttribute('viewBox', '0 0 44 44');
  ring.classList.add('wr-ring');
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
  const clockText = el('span', 'wr-clock-text');
  clock.append(ring, clockText);
  clock.hidden = true;
  ctx.ui.append(clock);

  const rulesPanel = el('div', 'wr-rules panel');
  rulesPanel.hidden = true;
  const rulesBtn = button('Rules', () => (rulesPanel.hidden = !rulesPanel.hidden), { cls: 'ghost wr-rules-btn', key: 'I' });
  ctx.ui.append(rulesPanel, rulesBtn);

  const fillRules = (): void => {
    const o = exactOdds(rules);
    const noBonus = exactOdds({ ...rules, warTiePays: 1 });
    const p = (t: string) => el('p', '', t);
    const table = (title: string, rows: [string, string][]) => {
      const t = el('div', 'wr-paytable');
      t.append(el('div', 'label', title));
      for (const [name, pays] of rows) {
        const r = el('div', 'row');
        r.append(el('span', '', name), el('span', 'money', pays));
        t.append(r);
      }
      return t;
    };
    rulesPanel.replaceChildren(
      el('h3', '', 'Casino War'),
      p('Six decks, aces high, suits don’t count. Bet, and the dealer gives you one card face up and takes one. The higher card wins even money; a lower one loses.'),
      p(`On a tie, surrender half the bet, or go to war: raise by the amount of the bet, the dealer burns three cards and deals one more card each.`),
      table('Going to war', [
        ['Your war card is higher', 'raise 1 to 1, bet pushes'],
        ['The war cards tie', `raise ${rules.warTiePays} to 1, bet pushes`],
        ['The dealer’s is higher', 'bet and raise lose'],
      ]),
      table('Tie bet, on the first two cards', [['Your card ties the dealer’s', `${rules.tiePays} to 1`]]),
      p(
        `House edge: always going to war ${pct(-o.goToWar)} of the bet (${pct(-noBonus.goToWar)} at tables without the bonus on a tie in the war), always surrendering ${pct(-o.surrender)}, the Tie bet ${pct(-o.tieBet)}.`,
      ),
      el('p', 'wr-keys', '1-7 chips · B bet · T tie · Space deal · W war · S surrender · R rebet · Shift R double · X clear · Backspace undo'),
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
    return Math.max((cfg.limits.bet ?? cfg.limits.default).max, (cfg.limits.tie ?? cfg.limits.default).max);
  };
  const myTiePending = (): boolean => {
    const sv = seatView(me);
    return view?.phase === 'deciding' && sv?.decision === 'pending' && !decided;
  };

  /** Advice while the player has Tips on: the war call on a tie, the Tie bet's cost while betting. */
  const renderTip = (): void => {
    warBtn.classList.remove('tip-pick');
    surrenderBtn.classList.remove('tip-pick');
    if (!ctx.tips.on || me === null || !view) {
      ctx.kit.tip(null);
      return;
    }
    const o = exactOdds(rules);
    if (myTiePending()) {
      ctx.kit.tip(`Always go to war; surrendering costs more (50% of the bet, a war ${pct(-o.warAfterTie)} on average)`);
      (bestChoice(rules) === 'war' ? warBtn : surrenderBtn).classList.add('tip-pick');
      return;
    }
    if (canBet() && (view.phase === 'betting' || mode === 'solo')) {
      ctx.kit.tip(`The tie bet has a high edge: ${pct(-o.tieBet)}, against ${pct(-o.goToWar)} on the bet`);
      return;
    }
    ctx.kit.tip(null);
  };
  const unsubscribeTips = ctx.tips.subscribe(() => renderTip());

  const renderMeters = (): void => {
    const sv = seatView(me);
    const live = view && sv && !sv.result && (view.phase === 'betting' || view.phase === 'deciding') ? sv.bet + (view.phase === 'betting' ? sv.tie : 0) + sv.raise : 0;
    meterStack.textContent = money(stack);
    meterBet.textContent = money(view?.phase === 'betting' ? mine.bet + mine.tie : live);
    meterLast.textContent = lastNet === null ? '–' : signed(lastNet);
    meterLast.className = `money ${lastNet === null || lastNet === 0 ? '' : lastNet > 0 ? 'up' : 'down'}`;
  };

  const renderControls = (): void => {
    const sv = seatView(me);
    const deciding = myTiePending();
    decideBar.hidden = !deciding;
    tray.root.classList.toggle('wr-away', deciding);
    if (deciding && sv) warBtn.firstChild!.textContent = `Go to war ${money(sv.bet)}`;
    if (mode === 'solo') {
      tray.setPrimary('Deal', !!view && view.phase === 'betting' && mine.bet > 0);
    } else {
      tray.setPrimary(readyOn ? 'Waiting' : 'Ready', !!view && view.phase === 'betting' && me !== null);
    }
    renderMeters();
    renderTip();
  };

  // ---- drawing the whole table from a view (on join, and after each batch of events) ---------

  const placeCard = (m: CardMesh, card: Card | null, at: { pos: THREE.Vector3; yaw: number }): void => {
    if (card && m.card !== card) m.setCard(card);
    m.position.copy(at.pos);
    m.rotation.set(card ? 0 : Math.PI, at.yaw, 0);
  };

  const layCard = (seat: number, war: boolean, card: Card | null): void => {
    let pair = seatCards.get(seat);
    if (!pair) {
      pair = { card: null, war: null };
      seatCards.set(seat, pair);
    }
    const key = war ? 'war' : 'card';
    if (!card) {
      pair[key]?.removeFromParent();
      pair[key] = null;
      return;
    }
    pair[key] ??= newCard(card);
    placeCard(pair[key], card, cardSlot(seat, war));
  };

  const handLabel = (seat: number, sv: SeatView): void => {
    const cls = `wr-hand${seat === me ? ' mine' : ''}`;
    if (!sv.card) {
      dropLabel(`hand:${seat}`);
      return;
    }
    const parts: { text: string; cls?: string }[] = [{ text: sv.warCard ? `${cardName(sv.card)} · war ${cardName(sv.warCard)}` : cardName(sv.card) }];
    const r = sv.result;
    if (r) {
      // the round's net, Tie bet included: a lost war can still come out even
      const net = r.returned - r.wagered;
      parts.push({ text: OUTCOME_WORDS[r.outcome], cls: 'muted' });
      parts.push({ text: net === 0 ? 'Even' : signed(net), cls: net > 0 ? 'net up' : net < 0 ? 'net down' : 'net' });
    } else if (sv.decision === 'pending') {
      parts.push({ text: 'Tie', cls: 'muted' });
    } else if (sv.decision === 'war') {
      parts.push({ text: 'At war', cls: 'muted' });
    }
    setLabel(`hand:${seat}`, handLabelPoint(seat), parts, cls);
  };

  const dealerLabel = (card: Card, war: Card | null): void => {
    const parts: { text: string; cls?: string }[] = [{ text: `Dealer: ${cardName(card)}` }];
    if (war) parts.push({ text: `war ${cardName(war)}`, cls: 'muted' });
    setLabel('dealer', new THREE.Vector3(0, TOP_Y + 0.01, dealerSlot(false).z - 0.09), parts, 'wr-hand dealer');
  };

  const clearPayouts = (): void => {
    for (const p of payouts) p.stack.removeFromParent();
    payouts = [];
  };

  const cardsInView = (v: WarView): number => {
    let n = (v.dealer ? 1 : 0) + (v.dealerWar ? 1 : 0);
    for (const sv of Object.values(v.seats)) n += (sv.card ? 1 : 0) + (sv.warCard ? 1 : 0);
    return n;
  };

  const draw = (v: WarView): void => {
    view = v;
    clearPayouts();
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      const sv = v.seats[seat];
      const live = !!sv && !sv.result && (v.phase === 'betting' || v.phase === 'deciding');
      for (const kind of KINDS) {
        const s = spotStack(seat, kind);
        s.position.copy(spotPoint(seat, kind));
        const own = seat === me && v.phase === 'betting';
        let amount = 0;
        if (own) amount = kind === 'bet' ? mine.bet : kind === 'tie' ? mine.tie : 0;
        else if (live && sv) amount = kind === 'bet' ? sv.bet : kind === 'war' ? sv.raise : v.phase === 'betting' ? sv.tie : 0;
        if (s.amount !== amount) s.set(amount);
      }
      const dealt = !!sv && v.phase !== 'betting';
      layCard(seat, false, dealt ? sv.card : null);
      layCard(seat, true, dealt ? sv.warCard : null);
      if (dealt && sv) handLabel(seat, sv);
      else dropLabel(`hand:${seat}`);
    }
    const showDealer = v.phase !== 'betting' && v.dealer;
    if (showDealer) {
      dealerCard ??= newCard(v.dealer);
      placeCard(dealerCard, v.dealer, { pos: dealerSlot(false), yaw: 0 });
      if (v.dealerWar) {
        dealerWar ??= newCard(v.dealerWar);
        placeCard(dealerWar, v.dealerWar, { pos: dealerSlot(true), yaw: 0 });
      } else {
        dealerWar?.removeFromParent();
        dealerWar = null;
      }
      dealerLabel(v.dealer!, v.dealerWar);
    } else {
      dealerCard?.removeFromParent();
      dealerWar?.removeFromParent();
      dealerCard = null;
      dealerWar = null;
      dropLabel('dealer');
    }
    // the discard holder holds everything dealt that isn't still on the table
    setDiscard(SHOE_CARDS - v.shoe.left - (v.phase === 'betting' || v.phase === 'idle' ? 0 : cardsInView(v)));
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
    return view?.phase === 'betting' && sv ? { bet: sv.bet, tie: sv.tie } : { ...NO_BETS };
  };

  // ---- the player's moves --------------------------------------------------------------------

  const sendBets = (next: Bets, push = true): void => {
    if (!canBet() || (next.bet === mine.bet && next.tie === mine.tie)) return;
    if (push) history.push({ ...mine });
    mine = next;
    if (me !== null) {
      spotStack(me, 'bet').set(next.bet);
      spotStack(me, 'tie').set(next.tie);
    }
    lastAction = 'bet';
    ctx.link.act({ type: 'bet', bet: next.bet, tie: next.tie });
    renderControls();
  };

  const addChip = (kind: 'bet' | 'tie'): void => {
    if (!canBet()) return;
    ctx.sfx.play('chip-lay');
    sendBets({ ...mine, [kind]: mine[kind] + tray.selected.value });
  };

  const undo = (): void => {
    const prev = history.pop();
    if (prev) sendBets(prev, false);
  };
  const clear = (): void => {
    if (mine.bet + mine.tie > 0) sendBets({ ...NO_BETS });
  };
  const rebet = (times: number): void => {
    const from = times > 1 && mine.bet + mine.tie > 0 ? mine : last;
    if (!from) return;
    ctx.sfx.play('chips-handle');
    sendBets({ bet: from.bet * times, tie: from.tie * times });
  };

  const primary = (): void => {
    if (!latest || me === null) return;
    if (mode === 'solo') {
      if (latest.phase === 'betting' && mine.bet > 0) {
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

  const decide = (choice: 'war' | 'surrender'): void => {
    const sv = me === null ? undefined : latest?.seats[me];
    if (decided || latest?.phase !== 'deciding' || sv?.decision !== 'pending') return;
    ctx.sfx.play('ui-click');
    decided = true;
    decideBar.hidden = true;
    tray.root.classList.remove('wr-away');
    lastAction = 'other';
    ctx.link.act({ type: choice });
    renderTip();
  };

  // ---- pointer: bet on my spots, with a hover ring --------------------------------------------

  const hoverRing = new THREE.Mesh(
    new THREE.RingGeometry(1.02, 1.18, 48),
    new THREE.MeshBasicMaterial({ color: '#f5dc9c', transparent: true, opacity: 0.75, depthWrite: false }),
  );
  hoverRing.rotation.x = -Math.PI / 2;
  hoverRing.visible = false;
  root.add(hoverRing);
  const tip = el('div', 'wr-tip');
  const tipObj = ctx.stage.label(tip, new THREE.Vector3());
  tipObj.visible = false;

  const mySpotAt = (e: PointerEvent): 'bet' | 'tie' | null => {
    if (e.target !== canvas || me === null) return null;
    const id = ctx.stage.pick(e)?.region;
    if (id === `bet:${me}`) return 'bet';
    if (id === `tie:${me}`) return 'tie';
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
    hoverRing.position.copy(spotPoint(me, kind, TOP_Y + 0.0015));
    hoverRing.scale.setScalar(SPOT_SIZE[kind]);
    tipObj.position.copy(besideSpot(me, kind, -0.16));
    const amount = kind === 'bet' ? mine.bet : mine.tie;
    const pays = kind === 'bet' ? 'pays 1 to 1' : `pays ${rules.tiePays} to 1 on a tie`;
    tip.textContent = `${kind === 'bet' ? 'BET' : 'TIE'} · ${pays}${amount ? ` · ${money(amount)}` : ''}`;
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
      setLabel(`name:${m.seat}`, p, [{ text: m.name }], `wr-name${m.seat === me ? ' mine' : ''}${m.connected ? '' : ' away'}`);
    }
  };

  // ---- animation pieces ------------------------------------------------------------------------

  const discardTop = (): THREE.Vector3 => new THREE.Vector3(DISCARD.x, DISCARD.y + 0.004 + discardCount * 0.00032, DISCARD.z);

  /** Every card on the table goes face down into the discard holder. */
  const sweepCards = async (): Promise<void> => {
    const all: CardMesh[] = [];
    for (const pair of seatCards.values()) for (const m of [pair.card, pair.war]) if (m) all.push(m);
    for (const m of [dealerCard, dealerWar]) if (m) all.push(m);
    seatCards.clear();
    dealerCard = null;
    dealerWar = null;
    dropLabels('hand:');
    dropLabel('dealer');
    if (all.length === 0) return;
    ctx.sfx.play('card-place');
    const to = discardTop();
    await Promise.all(all.map((m, i) => wait(i * 14).then(() => dealCard(m, m.position.clone(), to, { faceUp: false, ms: 280, yaw: 0 }))));
    for (const m of all) m.removeFromParent();
    setDiscard(discardCount + all.length);
  };

  /** Burn `n` cards from the shoe into the discard holder, face down and unseen. */
  const burn = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      const m = newCard(null);
      ctx.sfx.play('card-deal', { volume: 0.6 });
      await dealCard(m, SHOE_MOUTH, discardTop(), { faceUp: false, ms: 240, yaw: 0 });
      m.removeFromParent();
      setDiscard(discardCount + 1);
    }
  };

  const shuffleShoe = async (): Promise<void> => {
    ctx.kit.say('Shuffling a new shoe', 2200);
    ctx.sfx.play('card-shuffle');
    setDiscard(0);
    await wait(900);
    await burn(1);
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

  /** Cards out of the shoe face up, one per seat in `order` and then the dealer's, 90 ms apart. */
  const dealOut = async (seats: number[], cards: Card[], dealer: Card, war: boolean): Promise<void> => {
    const jobs: Promise<void>[] = [];
    const byPos = seats.map((seat, i) => ({ seat, card: cards[i]! })).sort((a, b) => positionOf(a.seat) - positionOf(b.seat));
    let n = 0;
    for (const { seat, card } of byPos) {
      const m = newCard(card);
      m.position.copy(SHOE_MOUTH);
      let pair = seatCards.get(seat);
      if (!pair) {
        pair = { card: null, war: null };
        seatCards.set(seat, pair);
      }
      if (war) pair.war = m;
      else pair.card = m;
      const slot = cardSlot(seat, war);
      const delay = n++ * 90;
      ctx.sfx.play('card-deal', { delay: delay / 1000, volume: 0.8 });
      jobs.push(wait(delay).then(() => dealCard(m, SHOE_MOUTH, slot.pos, { faceUp: true, ms: 300, yaw: slot.yaw })));
    }
    const d = newCard(dealer);
    d.position.copy(SHOE_MOUTH);
    if (war) dealerWar = d;
    else dealerCard = d;
    const delay = n * 90 + 120;
    ctx.sfx.play('card-deal', { delay: delay / 1000, volume: 0.8 });
    jobs.push(wait(delay).then(() => dealCard(d, SHOE_MOUTH, dealerSlot(war), { faceUp: true, ms: 300, yaw: 0 })));
    await Promise.all(jobs);
  };

  const placeRaise = async (seat: number, amount: Cents): Promise<void> => {
    const chips = new ChipStack();
    chips.set(amount);
    chips.position.copy(railPoint(seat));
    root.add(chips);
    ctx.sfx.play('chip-lay');
    await slideStack(chips, spotPoint(seat, 'war'), 360);
    chips.removeFromParent();
    spotStack(seat, 'war').set(amount);
  };

  const sweep = async (seat: number, kinds: SpotKind[]): Promise<void> => {
    const moving = kinds.map((k) => spotStack(seat, k)).filter((s) => s.amount > 0);
    if (moving.length === 0) return;
    ctx.sfx.play('chips-collide', { volume: 0.7 });
    await Promise.all(moving.map((s) => slideStack(s, RACK_POINT, 380)));
    // emptied where they stopped; draw() puts every stack back on its spot after the batch
    for (const s of moving) s.set(0);
  };

  const payOut = async (seat: number, kind: SpotKind, amount: Cents): Promise<ChipStack> => {
    const chips = new ChipStack();
    chips.set(amount);
    chips.position.copy(RACK_POINT);
    root.add(chips);
    payouts.push({ seat, stack: chips });
    await slideStack(chips, payoutPoint(seat, kind), 420);
    return chips;
  };

  /** Half the bet goes to the rack; the other half stays to go back with the player's chips. */
  const takeHalf = async (seat: number, bet: Cents): Promise<void> => {
    const half = new ChipStack();
    half.set(bet / 2);
    half.position.copy(spotPoint(seat, 'bet'));
    root.add(half);
    spotStack(seat, 'bet').set(bet / 2);
    ctx.sfx.play('chips-collide', { volume: 0.6 });
    await slideStack(half, RACK_POINT, 380);
    half.removeFromParent();
  };

  const pill = (seat: number, kind: SpotKind, text: string, kindOf: 'win' | 'lose' | 'push'): void => {
    ctx.kit.pill(ctx.stage, besideSpot(seat, kind, -(SPOT_SIZE[kind] + 0.07)), text, kindOf, 3200);
  };

  /** The Tie bet on a tie: paid where it lies (or nothing, without one). */
  const settleTie = async (seat: number, tiePaid: Cents | null, stake: Cents): Promise<void> => {
    if (!tiePaid) return;
    ctx.sfx.play('chips-stack');
    const paid = await payOut(seat, 'tie', tiePaid - stake);
    if (seat !== me) return;
    pill(seat, 'tie', `${signed(tiePaid - stake)} · ${rules.tiePays} TO 1`, 'win');
    // the light goes under the chips: a halo laid over a flat card washes its face out
    celebrate(
      { stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx },
      {
        title: `Tie pays ${rules.tiePays} to 1`,
        sub: `${signed(tiePaid - stake)} on the Tie bet`,
        tier: 'big',
        glow: present(spotStack(seat, 'tie'), paid),
      },
    );
  };

  /** Sweep what lost, pay what won, and pin the result to each of my spots. */
  const settleSeat = async (seat: number, r: Settlement, bets: SeatView): Promise<void> => {
    const jobs: Promise<unknown>[] = [];
    const lost: SpotKind[] = [];
    const mineSeat = seat === me;
    let warPaid: ChipStack | null = null;
    // the Tie bet was settled at the deal when the cards tied; otherwise it lost here
    if (bets.tie > 0 && r.outcome !== 'surrender' && !r.outcome.startsWith('war')) {
      lost.push('tie');
      if (mineSeat) pill(seat, 'tie', formatMoney(-bets.tie), 'lose');
    }
    switch (r.outcome) {
      case 'win':
        jobs.push(payOut(seat, 'bet', bets.bet));
        if (mineSeat) pill(seat, 'bet', signed(bets.bet), 'win');
        break;
      case 'lose':
        lost.push('bet');
        if (mineSeat) pill(seat, 'bet', formatMoney(-bets.bet), 'lose');
        break;
      case 'surrender':
        jobs.push(takeHalf(seat, bets.bet));
        if (mineSeat) pill(seat, 'bet', `SURRENDER ${formatMoney(-bets.bet / 2)}`, 'lose');
        break;
      case 'war-win':
      case 'war-tie': {
        const win = r.war - bets.raise;
        jobs.push(payOut(seat, 'war', win).then((s) => (warPaid = s)));
        if (mineSeat) {
          pill(seat, 'bet', 'PUSH', 'push');
          pill(seat, 'war', r.outcome === 'war-tie' ? `${signed(win)} · ${rules.warTiePays} TO 1` : signed(win), 'win');
        }
        break;
      }
      case 'war-lose':
        lost.push('bet', 'war');
        if (mineSeat) {
          pill(seat, 'bet', formatMoney(-bets.bet), 'lose');
          pill(seat, 'war', formatMoney(-bets.raise), 'lose');
        }
        break;
    }
    if (jobs.length > 0) ctx.sfx.play('chips-stack');
    jobs.push(sweep(seat, lost));
    await Promise.all(jobs);
    if (mineSeat && (r.outcome === 'war-win' || r.outcome === 'war-tie')) {
      const win = r.war - bets.raise;
      celebrate(
        { stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx },
        {
          title: r.outcome === 'war-win' ? 'War won' : 'Tie in the war',
          sub: `The raise pays ${r.outcome === 'war-win' ? 1 : rules.warTiePays} to 1 · ${signed(win)}`,
          tier: 'nice',
          glow: present(spotStack(seat, 'war'), warPaid),
        },
      );
    }
  };

  /** Chips that are no longer in play go back to their players: everything of a settled seat, and paid Tie bets. */
  const collect = async (next: WarView): Promise<void> => {
    const moving: { seat: number; stack: THREE.Object3D }[] = [];
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      const sv = next.seats[seat];
      const done = !sv || !!sv.result;
      for (const kind of KINDS) {
        if (!done && kind !== 'tie') continue;
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

  /** The dealer's call for my hand once it has settled. */
  const callResult = (r: Settlement, sv: SeatView, next: WarView): void => {
    const p = sv.card!;
    const d = next.dealer!;
    switch (r.outcome) {
      case 'win':
        ctx.kit.say(`Your ${cardName(p)} beats the dealer's ${cardName(d)}`, 2600);
        break;
      case 'lose':
        ctx.kit.say(`Dealer's ${cardName(d)} beats your ${cardName(p)}`, 2600);
        break;
      case 'surrender':
        ctx.kit.say(`Surrendered: ${money(sv.bet / 2)} back`, 2400);
        break;
      case 'war-win':
        ctx.kit.say(`Your ${cardName(sv.warCard!)} beats ${aName(next.dealerWar!)}: the raise pays 1 to 1, the bet pushes`, 3000);
        break;
      case 'war-tie':
        ctx.kit.say(`${pluralName(sv.warCard!)} again: the raise pays ${rules.warTiePays} to 1, the bet pushes`, 3000);
        break;
      case 'war-lose':
        ctx.kit.say(`Dealer's ${cardName(next.dealerWar!)} beats your ${cardName(sv.warCard!)}: the bet and the raise lose`, 3000);
        break;
    }
  };

  // ---- the event player ----------------------------------------------------------------------

  /** Dealer order for settling: from the dealer's right (third base) around to first base. */
  const rightToLeft = (a: WarEvent, b: WarEvent): number => {
    const seatOf = (e: WarEvent) => ('seat' in e ? e.seat : 0);
    return positionOf(seatOf(b)) - positionOf(seatOf(a));
  };

  const play = async (events: WarEvent[], next: WarView): Promise<void> => {
    let settled = false;
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      switch (e.type) {
        case 'betting':
          await startRound();
          break;
        case 'bets':
          // my own bets are already on the felt as I asked for them; this is the echo
          if (e.seat === me) break;
          ctx.sfx.play('chip-lay', { volume: 0.4 });
          spotStack(e.seat, 'bet').set(e.bet);
          spotStack(e.seat, 'tie').set(e.tie);
          break;
        case 'shuffle':
          await sweepCards();
          await shuffleShoe();
          break;
        case 'deal':
          if (me !== null && e.seats.includes(me)) last = { ...mine };
          if (mode === 'multi') ctx.kit.say('No more bets', 1400);
          await sweepCards();
          await dealOut(e.seats, e.cards, e.dealer, false);
          dealerLabel(e.dealer, null);
          if (me === null || !e.seats.includes(me)) ctx.kit.say(`Dealer shows ${aName(e.dealer)}`, 2200);
          await wait(250);
          break;
        case 'cut':
          ctx.kit.say('The cover card is out: last round before the shuffle', 2600);
          break;
        case 'decide':
          decided = false;
          if (me !== null && next.seats[me]?.decision === 'pending') {
            view = next;
            renderControls();
          }
          break;
        case 'decision':
          if (e.seat === me) {
            decideBar.hidden = true;
            if (e.auto) ctx.kit.say(e.choice === 'war' ? 'Time: going to war for you' : 'Time: surrendered for you', 2400);
            else if (e.choice === 'war') ctx.kit.say('Going to war', 1600);
          }
          if (e.choice === 'war') await placeRaise(e.seat, e.raise);
          break;
        case 'war':
          ctx.kit.say('Burning three', 1400);
          await burn(3);
          await dealOut(e.seats, e.cards, e.dealer, true);
          dealerLabel(next.dealer ?? e.dealer, e.dealer);
          await wait(300);
          break;
        case 'result':
        case 'tie': {
          // settle this run of results the way the dealer does, right to left
          let j = i;
          while (j + 1 < events.length && (events[j + 1]!.type === 'result' || events[j + 1]!.type === 'tie')) j++;
          const run = events.slice(i, j + 1).sort(rightToLeft);
          i = j;
          for (const x of run) {
            if (x.type !== 'result' && x.type !== 'tie') continue;
            const sv = next.seats[x.seat];
            if (!sv) continue;
            settled = true;
            if (x.type === 'tie') {
              if (x.seat === me && sv.card) ctx.kit.say(`Tie, ${pluralName(sv.card)}: go to war or surrender`, 4000);
              await settleTie(x.seat, x.tiePaid, sv.tie);
              handLabel(x.seat, { ...sv, result: null });
              continue;
            }
            if (x.seat === me) lastNet = x.result.returned - x.result.wagered;
            await settleSeat(x.seat, x.result, sv);
            handLabel(x.seat, sv);
            if (x.seat === me) callResult(x.result, sv, next);
            renderMeters();
            await wait(mode === 'solo' ? 250 : 180);
          }
          break;
        }
        case 'idle':
          await sweepCards();
          break;
      }
    }
    if (settled) {
      await wait(mode === 'solo' ? 800 : 500);
      await collect(next);
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
      const v = snap.view as WarView;
      rules = v.rules ?? DEFAULT_RULES;
      view = v;
      latest = v;
      mine = serverBets();
      if (!felt) {
        felt = makeFelt(rules, 1400);
        ctx.stage.addFelt(felt, TOP_Y + 0.0006);
        if (floorFelt) floorFelt.visible = false;
      }
      // hide chips the table can't take
      const max = limitMax();
      tray.root.querySelectorAll<HTMLButtonElement>('.chip-btn').forEach((b, i) => (b.hidden = (BETTING_CHIPS[i]?.value ?? 0) > max));
      fillRules();
      renderNames();
      draw(v);
    },

    async onEvents(events: GameEvent[], raw) {
      const next = raw as WarView;
      latest = next;
      await play(events as WarEvent[], next);
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
      switch (e.code) {
        case 'Space':
          primary();
          return true;
        case 'KeyW':
          decide('war');
          return true;
        case 'KeyS':
          decide('surrender');
          return true;
        case 'KeyB':
          addChip('bet');
          return true;
        case 'KeyT':
          addChip('tie');
          return true;
        case 'KeyX':
          clear();
          return true;
        case 'KeyR':
          rebet(e.shiftKey ? 2 : 1);
          return true;
        case 'KeyI':
          rulesPanel.hidden = !rulesPanel.hidden;
          return true;
      }
      if (e.key === 'Backspace' || ((e.metaKey || e.ctrlKey) && e.key === 'z')) {
        undo();
        return true;
      }
      return false;
    },

    update() {
      tickClock();
    },

    dispose() {
      unsubscribeTips();
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
      rulesPanel.remove();
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
