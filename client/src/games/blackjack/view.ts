// The blackjack table you sit at. Everything on it is drawn from the server's view: `sync()`
// reconciles cards, chips and labels with it, keyed by seat/hand/card, so the table can always
// be redrawn from scratch after a reconnect. Events animate toward that same state first (cards
// from the shoe, the hole card turning over, chips sliding to and from the rack) and `sync()`
// then settles on it without a jump, because both use the positions in layout.ts.

import * as THREE from 'three';
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { TableView, TableViewCtx, TableSnapshot, SeatMsg, MembersMsg } from '../contract.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import type { Card } from '../../../../shared/src/cards.ts';
import { BETTING_CHIPS, formatMoney, type BetLimits, type Cents } from '../../../../shared/src/money.ts';
import type { BlackjackView, HandView, SpotView, BlackjackEvent } from '../../../../shared/src/games/blackjack/protocol.ts';
import { handTotal, cardValue, type Move, type Outcome } from '../../../../shared/src/games/blackjack/rules.ts';
import { BETTING_MS, INSURANCE_MS, TURN_MS } from '../../../../shared/src/games/blackjack/engine.ts';
import { advise, insuranceAdvice } from '../../../../shared/src/games/blackjack/advice.ts';
import { CardMesh, dealCard, flipCard } from '../../table/cards.ts';
import { ChipStack, slideStack } from '../../table/chips.ts';
import { celebrate } from '../../table/celebrate.ts';
import { roundMoment } from './moments.ts';
import { tween, wait, ease } from '../../table/tween.ts';
import { ChipTray, button, el } from '../../ui/kit.ts';
import { blackjackMax, maxRefusal } from '../../table/max.ts';
import { serverNow } from '../../net/clock.ts';
import { playFelt } from './felt.ts';
import { discardStack } from './model.ts';
import * as L from './layout.ts';
import './blackjack.css';

const SVG = 'http://www.w3.org/2000/svg';

const MOVE_KEYS: Record<Move, string> = { hit: 'H', stand: 'S', double: 'D', split: 'P', surrender: 'U' };
const MOVE_LABEL: Record<Move, string> = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender' };

function isNatural(h: HandView): boolean {
  return !h.split && h.cards.length === 2 && handTotal(h.cards).total === 21;
}

/** "7/17" while a soft hand can still go either way, "BJ" for a natural. */
function totalText(cards: readonly (Card | null)[], natural = false): string {
  const known = cards.filter((c): c is Card => c !== null);
  if (known.length === 0) return '';
  if (natural) return 'BJ';
  const t = handTotal(known);
  return t.soft && t.total < 21 ? `${t.total - 10}/${t.total}` : String(t.total);
}

function pillFor(outcome: Outcome, bet: Cents, payout: Cents): { text: string; kind: 'win' | 'lose' | 'push' } {
  const net = payout - bet;
  switch (outcome) {
    case 'blackjack':
      return { text: `BLACKJACK ${formatMoney(net, { sign: true })}`, kind: 'win' };
    case 'win':
      return { text: `WIN ${formatMoney(net, { sign: true })}`, kind: 'win' };
    case 'evenmoney':
      return { text: `EVEN MONEY ${formatMoney(net, { sign: true })}`, kind: 'win' };
    case 'push':
      return { text: 'PUSH', kind: 'push' };
    case 'surrender':
      return { text: `SURRENDER ${formatMoney(net)}`, kind: 'lose' };
    case 'bust':
      return { text: `BUST ${formatMoney(net)}`, kind: 'lose' };
    default:
      return { text: `LOSE ${formatMoney(net)}`, kind: 'lose' };
  }
}

/** Chips a hand shows on the layout: the bet (split into bet and double), plus winnings once paid. */
function handChipAmounts(h: HandView): { main: Cents; dbl: Cents; win: Cents } {
  const main = h.doubled ? h.bet / 2 : h.bet;
  const dbl = h.doubled ? h.bet / 2 : 0;
  switch (h.outcome) {
    case null:
    case 'push':
      return { main, dbl, win: 0 };
    case 'win':
    case 'blackjack':
    case 'evenmoney':
      return { main, dbl, win: h.payout - h.bet };
    default:
      return { main: 0, dbl: 0, win: 0 };
  }
}

function dealerBlackjack(v: BlackjackView): boolean {
  return v.dealer.length === 2 && v.dealer.every((c) => c !== null) && handTotal(v.dealer as Card[]).total === 21;
}

/**
 * The dealer's label: "Dealer shows 10" while the hole card is down, then "Dealer 17", "Dealer 4/14"
 * while a soft hand still has to draw (the dealer stands on every 17, soft ones too), or
 * "Dealer blackjack".
 */
function dealerLabel(cards: readonly (Card | null)[], natural: boolean): { word: string; value: string; cls: string } | null {
  const known = cards.filter((c): c is Card => c !== null);
  if (known.length === 0) return null;
  if (natural) return { word: 'Dealer', value: 'Blackjack', cls: ' bj' };
  if (known.length === 1) {
    const v = cardValue(known[0]!);
    return { word: 'Dealer shows', value: v === 1 ? 'A' : String(v), cls: '' };
  }
  const t = handTotal(known);
  const value = t.soft && t.total < 17 ? `${t.total - 10}/${t.total}` : String(t.total);
  return { word: 'Dealer', value, cls: t.total > 21 ? ' bust' : '' };
}

export class BlackjackTable implements TableView {
  private readonly root: THREE.Group;
  private readonly felt = playFelt();
  private readonly cards = new Map<string, CardMesh>();
  private readonly stacks = new Map<string, ChipStack>();
  private readonly labels = new Map<string, { obj: CSS2DObject; el: HTMLElement }>();
  private readonly discard = discardStack();
  private readonly marker: THREE.Mesh;
  private v: BlackjackView | null = null;
  /** The round as the animation has got through it (the view is where it ends up). */
  private spots: SpotView[] = [];
  private dealer: (Card | null)[] = [];
  private discards = 0;

  private mode: 'solo' | 'multi' = 'solo';
  private limits: BetLimits = { min: 2500, max: 500_000, step: 100 };
  private seat: number | null = null;
  private seated = false;
  private stack: Cents = 0;
  private names = new Map<number, string>();
  private ready = false;
  private lastBet: Cents = 0;
  private lastNet: Cents | null = null;

  private readonly tray: ChipTray;
  private readonly actions = el('div', 'bj-actions panel');
  private readonly moveButtons = new Map<Move, HTMLButtonElement>();
  private readonly insure = el('div', 'bj-insure panel');
  private readonly insureLabel = el('span', 'bj-insure-q');
  private readonly insureYes: HTMLButtonElement;
  private readonly insureNo: HTMLButtonElement;
  private readonly meters = el('div', 'bj-meters panel');
  private readonly timer: SVGSVGElement;
  private readonly timerLeft: SVGCircleElement;
  private timerObj: CSS2DObject | null = null;
  private readonly onPointer: (e: PointerEvent) => void;
  private readonly offTips: () => void;
  /** A decision is on its way to the server: its tip stays down until the next view arrives. */
  private acted = false;

  constructor(private readonly ctx: TableViewCtx) {
    this.root = new THREE.Group();
    ctx.stage.root.add(this.root);
    ctx.stage.addFelt(this.felt, L.TOP_Y + 0.0012);
    this.root.add(this.discard.mesh);
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.058, 0.064, 48),
      new THREE.MeshBasicMaterial({ color: '#f1d59a', transparent: true, opacity: 0.85 }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.root.add(this.marker);

    this.tray = new ChipTray({
      undo: () => this.act({ type: 'undo' }),
      clear: () => this.act({ type: 'clear' }),
      rebet: () => this.rebet(1),
      double: () => this.rebet(2),
      max: { mode: 'bet', run: () => this.max() },
      primary: { label: 'Deal', run: () => this.primary() },
    });
    // Chips over the table maximum stay in the rack (the limits arrive with the table).
    this.tray.setChipMax(this.limits.max);
    this.tray.select(BETTING_CHIPS[2]!);
    this.tray.root.classList.add('bj-tray');

    for (const m of ['hit', 'stand', 'double', 'split', 'surrender'] as Move[]) {
      const b = button(MOVE_LABEL[m], () => this.decide({ type: m }), { key: MOVE_KEYS[m], cls: m === 'stand' ? 'primary' : '' });
      this.moveButtons.set(m, b);
      this.actions.append(b);
    }
    this.insureYes = button('Insure', () => this.decide({ type: 'insurance', take: true }), { key: 'Y' });
    this.insureNo = button('No insurance', () => this.decide({ type: 'insurance', take: false }), { key: 'N', cls: 'ghost' });
    this.insure.append(this.insureLabel, this.insureYes, this.insureNo);

    this.timer = document.createElementNS(SVG, 'svg');
    this.timer.setAttribute('class', 'timer');
    this.timer.setAttribute('viewBox', '0 0 44 44');
    const track = document.createElementNS(SVG, 'circle');
    this.timerLeft = document.createElementNS(SVG, 'circle');
    for (const [c, cls] of [[track, 'track'], [this.timerLeft, 'left']] as const) {
      c.setAttribute('class', cls);
      c.setAttribute('cx', '22');
      c.setAttribute('cy', '22');
      c.setAttribute('r', '18');
    }
    this.timerLeft.setAttribute('stroke-dasharray', String(2 * Math.PI * 18));
    this.timer.append(track, this.timerLeft);

    for (const node of [this.tray.root, this.actions, this.insure]) node.hidden = true;
    ctx.ui.append(this.tray.root, this.actions, this.insure, this.meters);

    this.onPointer = (e: PointerEvent) => {
      if (e.target !== ctx.stage.engine.renderer.domElement) return;
      const hit = ctx.stage.pick(e);
      if (hit?.region === `spot:${this.seat}` && this.canBet()) this.act({ type: 'bet', amount: this.tray.selected.value });
    };
    addEventListener('pointerdown', this.onPointer);
    this.offTips = ctx.tips.subscribe(() => this.renderTip());
  }

  // ------------------------------------------------------------------------------------------
  // Server messages

  onTable(snap: TableSnapshot): void {
    this.mode = snap.meta.mode;
    this.limits = snap.meta.config.limits.default ?? this.limits;
    this.tray.setChipMax(this.limits.max, this.limits.min);
    this.seat = snap.you.seat;
    this.seated = snap.you.status === 'seated';
    this.stack = snap.you.stack;
    this.members(snap.members);
    this.clearTable();
    this.sync(snap.view as BlackjackView);
  }

  onSeat(msg: SeatMsg): void {
    this.stack = msg.stack;
    this.seated = msg.status === 'seated';
    if (msg.seat !== null) this.seat = msg.seat;
    this.updateControls();
  }

  onMembers(msg: MembersMsg): void {
    this.members(msg.members);
    if (this.v) this.renderLabels(this.v);
    this.updateControls();
  }

  private members(list: MembersMsg['members']): void {
    this.names.clear();
    for (const m of list) {
      if (m.seat === null || m.status === 'watching') continue;
      this.names.set(m.seat, m.name);
      if (m.seat === this.seat) this.ready = m.ready;
    }
  }

  async onEvents(events: GameEvent[], view: unknown): Promise<void> {
    const next = view as BlackjackView;
    for (const e of events as BlackjackEvent[]) await this.animate(e, next);
    this.sync(next);
  }

  onError(): void {
    // A refused decision is still the player's to make.
    this.acted = false;
    this.updateControls();
  }

  // ------------------------------------------------------------------------------------------
  // Input

  private act(a: unknown): void {
    this.ctx.link.act(a);
  }

  /** A move or an insurance answer: once it's sent, its tip has served. */
  private decide(a: { type: string; take?: boolean }): void {
    this.acted = true;
    this.renderTip();
    this.act(a);
  }

  private canBet(): boolean {
    const v = this.v;
    if (!v || !this.seated || this.seat === null) return false;
    return v.phase === 'betting' || (this.mode === 'solo' && (v.phase === 'results' || v.phase === 'idle'));
  }

  private myBet(): Cents {
    const v = this.v;
    return v && v.phase === 'betting' && this.seat !== null ? (v.bets[this.seat] ?? 0) : 0;
  }

  /** Max: the most the bet takes, or every chip here if that is less. */
  private max(): void {
    if (!this.canBet()) return;
    const m = blackjackMax(this.limits, this.myBet(), this.stack);
    if ('none' in m) this.ctx.kit.toast(maxRefusal(m, this.limits));
    else this.act({ type: 'bet', amount: m.amount });
  }

  private rebet(times: 1 | 2): void {
    if (!this.canBet()) return;
    const current = this.myBet();
    if (times === 2 && current > 0) this.act({ type: 'bet', amount: current });
    else if (current === 0 && this.lastBet > 0) this.act({ type: 'bet', amount: this.lastBet * times });
  }

  private primary(): void {
    if (!this.canBet()) return;
    if (this.mode === 'multi') {
      this.ready = !this.ready;
      this.ctx.link.ready(this.ready);
      this.updateControls();
      return;
    }
    if (this.myBet() === 0 && this.lastBet > 0) this.act({ type: 'bet', amount: this.lastBet });
    this.act({ type: 'deal' });
  }

  keydown(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const v = this.v;
    const k = e.key.toLowerCase();
    if (!this.insure.hidden) {
      if (k === 'y') return this.insureYes.click(), true;
      if (k === 'n') return this.insureNo.click(), true;
    }
    if (!this.actions.hidden && v) {
      const move = (Object.keys(MOVE_KEYS) as Move[]).find((m) => MOVE_KEYS[m].toLowerCase() === k);
      if (move) {
        if (!this.moveButtons.get(move)!.disabled) this.decide({ type: move });
        return true;
      }
    }
    if (this.canBet()) {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= BETTING_CHIPS.length) {
        this.tray.key(e);
        return true;
      }
      if (e.key === 'Backspace') return this.act({ type: 'undo' }), true;
      if (k === 'a' && !e.shiftKey) return this.max(), true;
      if (k === 'x') return this.act({ type: 'clear' }), true;
      if (k === 'r') return this.rebet(e.shiftKey ? 2 : 1), true;
      if (e.code === 'Space') return this.primary(), true;
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------
  // Drawing the table from a view

  private sync(v: BlackjackView): void {
    this.v = v;
    this.acted = false;
    this.spots = structuredClone(v.spots);
    this.dealer = [...v.dealer];
    if (this.seat !== null && v.last[this.seat]) this.lastBet = v.last[this.seat]!;

    const keepCards = new Set<string>();
    v.dealer.forEach((card, i) => {
      const key = `d:${i}`;
      keepCards.add(key);
      const at = L.dealerCard(i);
      this.placeCard(key, card, at.pos, at.yaw);
    });
    for (const sp of v.spots) {
      sp.hands.forEach((h, hi) =>
        h.cards.forEach((card, ci) => {
          const key = `c:${sp.seat}:${hi}:${ci}`;
          keepCards.add(key);
          const at = L.handCard(sp.seat, hi, sp.hands.length, ci, h.doubled && ci === 2);
          this.placeCard(key, card, at.pos, at.yaw);
          this.dim(this.cards.get(key)!, h.outcome === 'lose' || h.outcome === 'bust' || h.outcome === 'surrender');
        }),
      );
    }
    for (const [key, mesh] of this.cards) {
      if (!keepCards.has(key)) {
        mesh.removeFromParent();
        this.cards.delete(key);
      }
    }

    const want = new Map<string, { amount: Cents; pos: THREE.Vector3 }>();
    if (v.phase === 'betting' || v.phase === 'idle') {
      for (const [seat, amount] of Object.entries(v.bets)) want.set(`b:${seat}`, { amount, pos: L.spotAt(Number(seat)) });
    } else {
      const dealerBj = dealerBlackjack(v);
      for (const sp of v.spots) {
        const n = sp.hands.length;
        sp.hands.forEach((h, hi) => {
          const c = handChipAmounts(h);
          if (c.main) want.set(`h:${sp.seat}:${hi}`, { amount: c.main, pos: L.handChips(sp.seat, hi, n) });
          if (c.dbl) want.set(`x:${sp.seat}:${hi}`, { amount: c.dbl, pos: L.doubleChips(sp.seat, hi, n) });
          if (c.win) want.set(`w:${sp.seat}:${hi}`, { amount: c.win, pos: L.winChips(sp.seat, hi, n) });
        });
        if (sp.insured > 0 && (v.phase === 'insurance' || dealerBj)) {
          want.set(`i:${sp.seat}`, { amount: sp.insured, pos: L.insuranceChips(sp.seat) });
          if (v.phase !== 'insurance') want.set(`iw:${sp.seat}`, { amount: 2 * sp.insured, pos: this.insuranceWinPos(sp.seat) });
        }
      }
    }
    for (const [key, w] of want) this.placeStack(key, w.amount, w.pos);
    for (const [key, s] of this.stacks) {
      if (!want.has(key)) {
        s.removeFromParent();
        this.stacks.delete(key);
      }
    }

    this.discards = v.shoe.discards;
    this.discard.set(this.discards);
    this.renderLabels(v);
    this.updateControls();
  }

  private placeCard(key: string, card: Card | null, pos: THREE.Vector3, yaw: number): CardMesh {
    let m = this.cards.get(key);
    if (!m) {
      m = new CardMesh(card);
      m.rotation.order = 'YXZ';
      this.root.add(m);
      this.cards.set(key, m);
    } else if (card && m.card !== card) m.setCard(card);
    m.position.copy(pos);
    m.rotation.set(card ? 0 : Math.PI, yaw, 0);
    m.scale.setScalar(key.startsWith('d:') ? L.DEALER_CARD_SCALE : 1);
    return m;
  }

  private placeStack(key: string, amount: Cents, pos: THREE.Vector3): ChipStack {
    let s = this.stacks.get(key);
    if (!s) {
      s = new ChipStack();
      this.root.add(s);
      this.stacks.set(key, s);
    }
    if (s.amount !== amount) s.set(amount);
    s.position.copy(pos);
    return s;
  }

  private dim(m: CardMesh, on: boolean): void {
    const mats = m.material as THREE.MeshStandardMaterial[];
    for (const i of [2, 3]) mats[i]!.color.setScalar(on ? 0.55 : 1);
  }

  private insuranceWinPos(seat: number): THREE.Vector3 {
    return L.insuranceChips(seat).addScaledVector(L.spotFrame(seat).right, -0.043);
  }

  private label(key: string, cls: string, text: string, at: THREE.Vector3): HTMLElement {
    let l = this.labels.get(key);
    if (!l) {
      const node = el('div', cls, text);
      l = { el: node, obj: this.ctx.stage.label(node, at) };
      this.labels.set(key, l);
    } else {
      if (l.el.className !== cls) l.el.className = cls;
      if (l.el.textContent !== text) l.el.textContent = text;
      l.obj.position.copy(at);
    }
    return l.el;
  }

  /** The dealer's total beside the up card ("Dealer shows 10", "Dealer 17"), redrawn as cards come. */
  private dealerTotal(cards: readonly (Card | null)[], natural: boolean): boolean {
    const d = dealerLabel(cards, natural);
    if (!d) {
      this.dropLabel('dealer');
      return false;
    }
    const at = this.label('dealer', 'bj-dealer-at', '', L.DEALER_TOTAL.clone());
    const box = el('div', `bj-dealer${d.cls}`);
    box.append(el('span', 'bj-dealer-word', d.word), el('b', 'bj-dealer-value', d.value));
    at.replaceChildren(box);
    return true;
  }

  private dropLabel(key: string): void {
    const l = this.labels.get(key);
    if (!l) return;
    l.obj.removeFromParent();
    l.el.remove();
    this.labels.delete(key);
  }

  private dropLabels(prefix: string): void {
    for (const key of [...this.labels.keys()]) if (key.startsWith(prefix)) this.dropLabel(key);
  }

  /** Totals, the dealer's total, names, the active hand and result pills, all from one view. */
  private renderLabels(v: BlackjackView): void {
    const keep = new Set<string>();
    const put = (key: string, cls: string, text: string, at: THREE.Vector3) => {
      keep.add(key);
      this.label(key, cls, text, at);
    };
    if (this.dealerTotal(v.dealer, dealerBlackjack(v))) keep.add('dealer');
    for (const sp of v.spots) {
      const { out } = L.spotFrame(sp.seat);
      sp.hands.forEach((h, hi) => {
        const anchor = L.handAnchor(sp.seat, hi, sp.hands.length);
        const active = v.turn?.seat === sp.seat && v.turn.hand === hi;
        const natural = isNatural(h);
        const text = totalText(h.cards, natural);
        const t = handTotal(h.cards).total;
        const cls = `bj-total${natural ? ' bj' : t > 21 ? ' bust' : ''}${active ? ' active' : ''}${h.outcome && !natural ? ' settled' : ''}`;
        if (text) put(`t:${sp.seat}:${hi}`, cls, text, anchor.clone().addScaledVector(out, 0.07));
        if (h.outcome) {
          const p = pillFor(h.outcome, h.bet, h.payout);
          put(`p:${sp.seat}:${hi}`, `pill ${p.kind}`, p.text, anchor.clone().setY(L.TOP_Y + 0.03));
        }
      });
      if (sp.hands.length > 1 && v.turn?.seat === sp.seat) {
        const at = L.handAnchor(sp.seat, v.turn.hand, sp.hands.length).addScaledVector(out, -0.072);
        put(`n:${sp.seat}`, 'bj-hand-no', `HAND ${v.turn.hand + 1} OF ${sp.hands.length}`, at);
      }
      if (sp.insured > 0 && v.phase !== 'insurance') {
        const paid = dealerBlackjack(v);
        put(`ip:${sp.seat}`, `pill ${paid ? 'win' : 'lose'}`, `INSURANCE ${paid ? formatMoney(2 * sp.insured, { sign: true }) : formatMoney(-sp.insured)}`, L.insuranceChips(sp.seat).setY(L.TOP_Y + 0.035));
      }
    }
    if (this.mode === 'multi') {
      for (const [seat, name] of this.names) {
        const at = L.spotAt(seat).addScaledVector(L.spotFrame(seat).out, 0.088);
        put(`name:${seat}`, `bj-name${seat === this.seat ? ' me' : ''}`, seat === this.seat ? `${name} (you)` : name, at);
      }
    }
    if (v.shoe.lastHand) put('lasthand', 'bj-note', 'LAST HAND', L.SHOE_MOUTH.clone().setY(L.TOP_Y + 0.13));
    for (const key of [...this.labels.keys()]) if (!keep.has(key)) this.dropLabel(key);

    // The ring under whichever hand is being played.
    const turn = v.phase === 'play' ? v.turn : null;
    const sp = turn ? v.spots.find((s) => s.seat === turn.seat) : undefined;
    this.marker.visible = !!(turn && sp);
    if (turn && sp) this.marker.position.copy(L.handAnchor(turn.seat, turn.hand, sp.hands.length)).setY(L.TOP_Y + 0.0015);
  }

  private updateControls(): void {
    const v = this.v;
    const me = this.seat;
    const betting = this.canBet();
    this.tray.root.hidden = !betting;
    if (betting) {
      const bet = this.myBet();
      // Ready works without a bet too: sitting a round out still lets the others' hand go.
      if (this.mode === 'multi') this.tray.setPrimary(this.ready ? 'Ready ✓' : 'Ready', true);
      else if (bet === 0 && this.lastBet > 0) this.tray.setPrimary(`Deal ${formatMoney(this.lastBet)}`, this.lastBet <= this.stack);
      else this.tray.setPrimary('Deal', bet >= this.limits.min);
    }

    const turn = v && v.phase === 'play' && v.turn && v.turn.seat === me ? v.turn : null;
    this.actions.hidden = !turn;
    if (turn && v) {
      const spot = v.spots.find((s) => s.seat === me)!;
      const hand = spot.hands[turn.hand]!;
      for (const [m, b] of this.moveButtons) {
        const cost = m === 'double' ? hand.bet : m === 'split' ? spot.base : 0;
        b.disabled = !v.moves.includes(m) || cost > this.stack;
        b.hidden = (m === 'split' || m === 'surrender') && !v.moves.includes(m);
      }
    }

    const spot = v && me !== null ? v.spots.find((s) => s.seat === me) : undefined;
    const offered = v?.phase === 'insurance' && spot?.insurance === 'offered';
    this.insure.hidden = !offered;
    if (offered && spot) {
      const even = isNatural(spot.hands[0]!);
      this.insureLabel.textContent = even ? 'Even money?' : 'Insurance?';
      this.insureYes.firstChild!.textContent = even ? `Even money ${formatMoney(spot.base, { sign: true })}` : `Insure ${formatMoney(spot.base / 2)}`;
      this.insureNo.firstChild!.textContent = even ? 'No' : 'No insurance';
      this.insureYes.disabled = !even && spot.base / 2 > this.stack;
    }

    this.renderMeters();
    this.placeTimer();
    this.renderTip();
  }

  /**
   * Tips: the basic-strategy move for the hand you're playing, rung on its button, or no to
   * insurance and even money. Only while it's your decision; the buttons' own enabled state says
   * which moves the table will take (the rules, and the chips to pay for a double or a split).
   */
  private renderTip(): void {
    const v = this.v;
    let text: string | null = null;
    let pick: HTMLButtonElement | null = null;
    if (this.ctx.tips.on && v && !this.acted) {
      const spot = this.seat !== null ? v.spots.find((s) => s.seat === this.seat) : undefined;
      const up = v.dealer[0];
      if (!this.insure.hidden && spot) {
        text = insuranceAdvice(isNatural(spot.hands[0]!));
        pick = this.insureNo;
      } else if (!this.actions.hidden && spot && v.turn && up) {
        const open = (m: Move) => !this.moveButtons.get(m)!.disabled;
        const a = advise(spot.hands[v.turn.hand]!.cards, up, { double: open('double'), split: open('split'), surrender: open('surrender') });
        text = a.text;
        pick = this.moveButtons.get(a.move)!;
      }
    }
    for (const b of [...this.moveButtons.values(), this.insureYes, this.insureNo]) b.classList.toggle('tip-pick', b === pick);
    this.ctx.kit.tip(text);
  }

  private renderMeters(): void {
    const v = this.v;
    const spot = v && this.seat !== null ? v.spots.find((s) => s.seat === this.seat) : undefined;
    const onTable = v?.phase === 'betting' ? this.myBet() : spot && v?.phase !== 'results' ? spot.wagered : 0;
    const cells: [string, string, string][] = [
      ['Chips', formatMoney(this.stack), ''],
      ['Bet', formatMoney(onTable), ''],
    ];
    if (this.lastNet !== null) cells.push(['Last hand', formatMoney(this.lastNet, { sign: true }), this.lastNet > 0 ? 'up' : this.lastNet < 0 ? 'down' : '']);
    this.meters.replaceChildren(
      ...cells.map(([k, val, cls]) => {
        const cell = el('div', 'bj-meter');
        cell.append(el('span', 'label', k), el('span', `money ${cls}`.trim(), val));
        return cell;
      }),
    );
  }

  private timerSpan(): number {
    const p = this.v?.phase;
    return p === 'betting' ? BETTING_MS : p === 'insurance' ? INSURANCE_MS : TURN_MS;
  }

  private placeTimer(): void {
    const v = this.v;
    const show = this.mode === 'multi' && v?.deadline && (v.phase === 'betting' || v.phase === 'insurance' || v.phase === 'play');
    let seat: number | null = null;
    if (show && v) seat = v.phase === 'play' ? (v.turn?.seat ?? null) : this.seat;
    if (seat === null) {
      this.timerObj?.removeFromParent();
      this.timerObj = null;
      this.timer.remove();
      return;
    }
    const at = L.spotAt(seat).addScaledVector(L.spotFrame(seat).right, -0.09).setY(L.TOP_Y + 0.01);
    if (!this.timerObj) this.timerObj = this.ctx.stage.label(this.timer as unknown as HTMLElement, at);
    else this.timerObj.position.copy(at);
  }

  update(): void {
    const v = this.v;
    if (this.timerObj && v?.deadline) {
      const left = Math.max(0, v.deadline - serverNow());
      const c = 2 * Math.PI * 18;
      this.timerLeft.setAttribute('stroke-dashoffset', String(c * (1 - left / this.timerSpan())));
    }
  }

  // ------------------------------------------------------------------------------------------
  // Animations: each event plays out toward the view that came with it

  private say(text: string, ms?: number): void {
    this.ctx.kit.say(text, ms);
  }

  private spotOf(seat: number, next: BlackjackView): SpotView {
    let sp = this.spots.find((s) => s.seat === seat);
    if (!sp) {
      const base = next.spots.find((s) => s.seat === seat)?.base ?? this.v?.bets[seat] ?? 0;
      sp = { seat, base, hands: [{ cards: [], bet: base, doubled: false, split: false, splitAce: false, done: false, outcome: null, payout: 0 }], insurance: 'none', insured: 0, wagered: base, returned: 0 };
      this.spots.push(sp);
      // The bet in the circle becomes the first hand's bet.
      const b = this.stacks.get(`b:${seat}`);
      if (b) {
        this.stacks.delete(`b:${seat}`);
        this.stacks.set(`h:${seat}:0`, b);
      }
    }
    return sp;
  }

  private async fly(key: string, card: Card | null, to: { pos: THREE.Vector3; yaw: number }, ms = 300): Promise<CardMesh> {
    const m = new CardMesh(null);
    m.rotation.order = 'YXZ';
    m.rotation.y = L.SHOE.yaw;
    this.root.add(m);
    this.cards.set(key, m);
    this.ctx.sfx.play('card-deal');
    // The dealer's own cards grow to their larger size on the way out of the shoe.
    const grow = key.startsWith('d:') ? this.scaleTo(m, L.DEALER_CARD_SCALE, ms) : null;
    await dealCard(m, L.SHOE_MOUTH.clone(), to.pos, { faceUp: false, ms, yaw: to.yaw });
    await grow;
    if (card) {
      m.setCard(card);
      await flipCard(m, true, 180);
    }
    return m;
  }

  private async slideAway(key: string, to: THREE.Vector3, ms = 380): Promise<void> {
    const s = this.stacks.get(key);
    if (!s) return;
    this.stacks.delete(key);
    await slideStack(s, to, ms);
    s.removeFromParent();
  }

  private async slideIn(key: string, amount: Cents, from: THREE.Vector3, to: THREE.Vector3, ms = 380): Promise<void> {
    const s = this.placeStack(key, amount, from);
    await slideStack(s, to, ms);
  }

  private scaleTo(m: CardMesh, to: number, ms: number): Promise<void> {
    const from = m.scale.x;
    return tween(ms, (k) => m.scale.setScalar(from + (to - from) * k), ease.out);
  }

  private moveCardTo(m: CardMesh, pos: THREE.Vector3, yaw: number, ms: number): Promise<void> {
    const from = m.position.clone();
    const y0 = m.rotation.y;
    return tween(ms, (k) => {
      m.position.lerpVectors(from, pos, k);
      m.rotation.y = y0 + (yaw - y0) * k;
    }, ease.inOut);
  }

  private rekey(prefix: string, seat: number, from: number, to: number): void {
    for (const map of [this.cards, this.stacks] as Map<string, THREE.Object3D>[]) {
      for (const key of [...map.keys()]) {
        const [p, s, h, rest] = key.split(':');
        if (p !== prefix || Number(s) !== seat || Number(h) !== from) continue;
        const obj = map.get(key)!;
        map.delete(key);
        map.set([p, s, String(to), ...(rest !== undefined ? [rest] : [])].join(':'), obj);
      }
    }
  }

  /** Cards to the discard holder, chips back to their players, labels off: the table is clear. */
  private async collect(): Promise<void> {
    const moves: Promise<void>[] = [];
    let n = 0;
    for (const m of this.cards.values()) {
      n++;
      const to = L.DISCARD.clone().setY(L.DISCARD.y + 0.02 + this.discards * 0.00032);
      if (m.scale.x !== 1) void this.scaleTo(m, 1, 360);
      moves.push(dealCard(m, m.position.clone(), to, { faceUp: false, ms: 360, yaw: 0 }).then(() => void m.removeFromParent()));
    }
    for (const [key, s] of this.stacks) {
      const seat = Number(key.split(':')[1]);
      moves.push(slideStack(s, L.playerRail(seat), 380).then(() => void s.removeFromParent()));
    }
    this.cards.clear();
    this.stacks.clear();
    this.dropLabels('');
    this.marker.visible = false;
    await Promise.all(moves);
    this.discards += n;
    this.discard.set(this.discards);
  }

  private clearTable(): void {
    for (const m of this.cards.values()) m.removeFromParent();
    for (const s of this.stacks.values()) s.removeFromParent();
    this.cards.clear();
    this.stacks.clear();
    this.dropLabels('');
    this.spots = [];
    this.dealer = [];
  }

  private async animate(e: BlackjackEvent, next: BlackjackView): Promise<void> {
    const me = this.seat;
    switch (e.type) {
      case 'betting':
        if (this.cards.size || this.stacks.size) await this.collect();
        this.spots = [];
        this.dealer = [];
        this.say('Place your bets', 2200);
        if (this.mode === 'multi' && this.ready) {
          this.ready = false;
          this.ctx.link.ready(false);
        }
        break;
      case 'idle':
        await this.collect();
        break;
      case 'bet': {
        const key = `b:${e.seat}`;
        const before = this.stacks.get(key)?.amount ?? 0;
        if (e.total > 0) {
          const s = this.placeStack(key, e.total, L.spotAt(e.seat));
          if (e.total > before) {
            this.ctx.sfx.play('chip-lay');
            const y = s.position.y;
            await tween(140, (k) => (s.position.y = y + 0.02 * (1 - k)), ease.out);
          }
        } else if (before > 0) {
          await this.slideAway(key, L.playerRail(e.seat), 300);
          if (e.reason === 'min' && e.seat === me) this.ctx.kit.toast(`The table minimum is ${formatMoney(this.limits.min)}: your bet came back.`);
        }
        break;
      }
      case 'shuffle':
        this.say(e.discards ? 'Out of cards: shuffling the discards' : 'Shuffling', 2200);
        this.ctx.sfx.play('card-shuffle');
        await tween(500, (k) => this.discard.set(Math.round(this.discards * (1 - k))));
        this.discards = 0;
        await wait(700);
        break;
      case 'burn': {
        const m = new CardMesh(null);
        m.rotation.order = 'YXZ';
        this.root.add(m);
        this.ctx.sfx.play('card-deal');
        await dealCard(m, L.SHOE_MOUTH.clone(), L.DISCARD.clone().setY(L.DISCARD.y + 0.02), { faceUp: false, ms: 360, yaw: 0 });
        m.removeFromParent();
        this.discards++;
        this.discard.set(this.discards);
        break;
      }
      case 'cut':
        this.say('Last hand before the shuffle', 2600);
        break;
      case 'card': {
        const sp = this.spotOf(e.seat, next);
        const h = sp.hands[e.hand]!;
        h.cards.push(e.card);
        const ci = h.cards.length - 1;
        await this.fly(`c:${e.seat}:${e.hand}:${ci}`, e.card, L.handCard(e.seat, e.hand, sp.hands.length, ci, h.doubled && ci === 2));
        this.renderLiveTotals();
        break;
      }
      case 'dealer-card': {
        const i = this.dealer.length;
        if (i >= 2) await wait(420);
        this.dealer.push(e.card);
        await this.fly(`d:${i}`, e.card, L.dealerCard(i));
        if (i >= 2) this.say(`Dealer has ${dealerLabel(this.dealer, false)!.value}`, 2000);
        this.renderLiveTotals();
        break;
      }
      case 'insurance': {
        const mine = me !== null ? this.spots.find((s) => s.seat === me) : undefined;
        this.say(mine && isNatural(mine.hands[0]!) ? 'Even money?' : 'Insurance?', 3000);
        break;
      }
      case 'insured': {
        const sp = this.spots.find((s) => s.seat === e.seat);
        if (sp && e.take && e.amount > 0) {
          sp.insured = e.amount;
          this.ctx.sfx.play('chip-lay');
          await this.slideIn(`i:${e.seat}`, e.amount, L.playerRail(e.seat), L.insuranceChips(e.seat), 320);
        }
        break;
      }
      case 'peek': {
        this.say('Dealer checks for blackjack', 1800);
        const hole = this.cards.get('d:1');
        if (hole) {
          const y0 = hole.position.y;
          await tween(260, (k) => {
            hole.rotation.x = Math.PI - 0.38 * k;
            hole.position.y = y0 + 0.01 * k;
          }, ease.out);
          await wait(250);
          await tween(220, (k) => {
            hole.rotation.x = Math.PI - 0.38 * (1 - k);
            hole.position.y = y0 + 0.01 * (1 - k);
          }, ease.inOut);
        }
        if (!e.blackjack) this.say('No blackjack', 1400);
        await wait(e.blackjack ? 200 : 450);
        break;
      }
      case 'hole': {
        this.dealer[1] = e.card;
        const m = this.cards.get('d:1');
        if (m) {
          m.setCard(e.card);
          this.ctx.sfx.play('card-flip');
          await flipCard(m, true, 260);
        }
        const bj = this.dealer.length === 2 && handTotal(this.dealer as Card[]).total === 21;
        this.say(bj ? 'Dealer blackjack' : `Dealer has ${dealerLabel(this.dealer, false)!.value}`, 2200);
        this.renderLiveTotals();
        await wait(300);
        break;
      }
      case 'turn':
        this.liveTurn(e.seat, e.hand);
        if (e.seat === me) this.ctx.sfx.play('chip-lay', { volume: 0.25, rate: 1.6 });
        break;
      case 'stand':
        if (e.auto && e.seat === me) this.ctx.kit.toast('Time ran out: you stand.');
        break;
      case 'double': {
        const sp = this.spotOf(e.seat, next);
        const h = sp.hands[e.hand]!;
        h.doubled = true;
        h.bet = e.bet;
        this.ctx.sfx.play('chip-lay');
        await this.slideIn(`x:${e.seat}:${e.hand}`, e.bet / 2, L.playerRail(e.seat), L.doubleChips(e.seat, e.hand, sp.hands.length), 320);
        break;
      }
      case 'split': {
        const sp = this.spotOf(e.seat, next);
        const h = sp.hands[e.hand]!;
        const moved = h.cards.pop()!;
        h.split = true;
        sp.hands.splice(e.hand + 1, 0, { cards: [moved], bet: e.bet, doubled: false, split: true, splitAce: cardValue(moved) === 1, done: false, outcome: null, payout: 0 });
        for (let hi = sp.hands.length - 1; hi > e.hand + 1; hi--) {
          for (const p of ['c', 'h', 'x', 'w']) this.rekey(p, e.seat, hi - 1, hi);
        }
        const card = this.cards.get(`c:${e.seat}:${e.hand}:1`);
        if (card) {
          this.cards.delete(`c:${e.seat}:${e.hand}:1`);
          this.cards.set(`c:${e.seat}:${e.hand + 1}:0`, card);
        }
        const n = sp.hands.length;
        const moves: Promise<void>[] = [];
        sp.hands.forEach((hh, hi) => {
          hh.cards.forEach((_, ci) => {
            const m = this.cards.get(`c:${e.seat}:${hi}:${ci}`);
            const at = L.handCard(e.seat, hi, n, ci, hh.doubled && ci === 2);
            if (m) moves.push(this.moveCardTo(m, at.pos, at.yaw, 260));
          });
          for (const [p, pos] of [['h', L.handChips(e.seat, hi, n)], ['x', L.doubleChips(e.seat, hi, n)]] as const) {
            const s = this.stacks.get(`${p}:${e.seat}:${hi}`);
            if (s) moves.push(slideStack(s, pos, 260));
          }
        });
        this.ctx.sfx.play('chip-lay');
        moves.push(this.slideIn(`h:${e.seat}:${e.hand + 1}`, e.bet, L.playerRail(e.seat), L.handChips(e.seat, e.hand + 1, n), 300));
        await Promise.all(moves);
        this.liveTurn(e.seat, e.hand);
        break;
      }
      case 'result':
        await this.settle(e, next);
        break;
      case 'insurance-result': {
        const sp = this.spots.find((s) => s.seat === e.seat);
        if (e.payout > 0) {
          this.ctx.sfx.play('chips-stack');
          await this.slideIn(`iw:${e.seat}`, e.payout - e.bet, L.RACK, this.insuranceWinPos(e.seat));
        } else await this.slideAway(`i:${e.seat}`, L.RACK);
        if (sp) sp.insured = e.bet;
        break;
      }
      case 'dealer':
        this.marker.visible = false;
        this.say(e.bust ? `Dealer busts with ${e.total}` : e.drew ? `Dealer stands on ${e.total}` : `Dealer has ${e.total}`, 2400);
        await wait(e.drew ? 500 : 250);
        break;
      case 'done': {
        const mine = me !== null ? next.spots.find((s) => s.seat === me) : undefined;
        if (mine) {
          this.lastNet = mine.returned - mine.wagered;
          this.celebrateRound(mine);
        }
        break;
      }
    }
  }

  /** Settle one hand the way a dealer does: take the losers, pay the winners beside their bets. */
  private async settle(e: Extract<BlackjackEvent, { type: 'result' }>, next: BlackjackView): Promise<void> {
    const sp = this.spotOf(e.seat, next);
    const h = sp.hands[e.hand];
    if (!h) return;
    h.outcome = e.outcome;
    h.payout = e.payout;
    const n = sp.hands.length;
    const keys = [`h:${e.seat}:${e.hand}`, `x:${e.seat}:${e.hand}`];
    if (e.outcome === 'lose' || e.outcome === 'bust' || e.outcome === 'surrender') {
      await Promise.all(keys.map((k) => this.slideAway(k, L.RACK)));
      h.cards.forEach((_, ci) => {
        const m = this.cards.get(`c:${e.seat}:${e.hand}:${ci}`);
        if (m) this.dim(m, true);
      });
    } else if (e.payout > e.bet) {
      this.ctx.sfx.play('chips-stack');
      await this.slideIn(`w:${e.seat}:${e.hand}`, e.payout - e.bet, L.RACK, L.winChips(e.seat, e.hand, n));
    }
    const p = pillFor(e.outcome, e.bet, e.payout);
    const anchor = L.handAnchor(e.seat, e.hand, n);
    this.label(`p:${e.seat}:${e.hand}`, `pill ${p.kind}`, p.text, anchor.setY(L.TOP_Y + 0.03));
    this.renderLiveTotals();
    await wait(e.outcome === 'bust' ? 350 : 260);
  }

  /** Totals and the turn marker while the animation is mid-round (from the local copy of the round). */
  private renderLiveTotals(): void {
    const natural = this.dealer.length === 2 && this.dealer.every((c) => c !== null) && handTotal(this.dealer as Card[]).total === 21;
    this.dealerTotal(this.dealer, natural);
    for (const sp of this.spots) {
      const { out } = L.spotFrame(sp.seat);
      sp.hands.forEach((h, hi) => {
        const text = totalText(h.cards, isNatural(h));
        if (!text) return;
        const t = handTotal(h.cards).total;
        const cls = `bj-total${isNatural(h) ? ' bj' : t > 21 ? ' bust' : ''}`;
        this.label(`t:${sp.seat}:${hi}`, cls, text, L.handAnchor(sp.seat, hi, sp.hands.length).addScaledVector(out, 0.07));
      });
    }
  }

  /**
   * Your round's moment, if it had one, with light under the hands that made it: one light under
   * them all, since split hands lie side by side and two would overlap into a bright seam.
   */
  private celebrateRound(sp: SpotView): void {
    const found = roundMoment(sp);
    if (!found) return;
    const cards = found.hands.flatMap((hi) => sp.hands[hi]!.cards.map((_, ci) => this.cards.get(`c:${sp.seat}:${hi}:${ci}`)).filter((m): m is CardMesh => !!m));
    celebrate(this.ctx, { ...found.m, glow: [cards] });
  }

  private liveTurn(seat: number, hand: number): void {
    const sp = this.spots.find((s) => s.seat === seat);
    if (!sp) return;
    this.marker.visible = true;
    this.marker.position.copy(L.handAnchor(seat, hand, sp.hands.length)).setY(L.TOP_Y + 0.0015);
  }

  dispose(): void {
    removeEventListener('pointerdown', this.onPointer);
    this.offTips();
    this.ctx.kit.tip(null);
    this.tray.root.remove();
    this.actions.remove();
    this.insure.remove();
    this.meters.remove();
    this.timerObj?.removeFromParent();
    this.timer.remove();
    this.dropLabels('');
    this.root.removeFromParent();
    this.felt.mesh.removeFromParent();
  }
}
