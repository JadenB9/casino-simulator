// The Hold'em table view. Everything is drawn from the server's view (`draw`), and each batch of
// events is played out first: blinds and bets slide in, cards come off the dealer's deck, bets
// are swept to the pot, hands flip in showdown order, pots slide to their winners with the
// dealer's call on one line. The table turns so your own seat is always nearest you.

import * as THREE from 'three';
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { TableView, TableViewCtx } from '../contract.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import type { Card } from '../../../../shared/src/cards.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import type { HoldemView, HoldemEvent, HoldemSeatView } from '../../../../shared/src/games/holdem/protocol.ts';
import { ACT_MS } from '../../../../shared/src/games/holdem/engine.ts';
import { cardText, cardInt, intCard, evaluate, bestFive, TRIPS, FULL_HOUSE, STRAIGHT_FLUSH } from '../../../../shared/src/games/holdem/eval.ts';
import { cryptoRng } from '../../../../shared/src/rng.ts';
import { CardMesh, dealCard, flipCard, CARD_W } from '../../table/cards.ts';
import { ChipStack, slideStack } from '../../table/chips.ts';
import { tween, wait, ease } from '../../table/tween.ts';
import { celebrate, type Tier } from '../../table/celebrate.ts';
import { el } from '../../ui/kit.ts';
import { serverNow } from '../../net/clock.ts';
import { session } from '../../app/session.ts';
import { ActionBar } from './actionbar.ts';
import { advise, bannerOf, estimateEquity, onBoard, positionOf } from './advice.ts';
import { holdemFelt, dealerButton, slotPoint, slotEdge, slotYaw, boardPoint, BOARD_SCALE, DEALER_POINT, TOP_Y } from './table.ts';
import { hideNearChairs } from './model.ts';
import './holdem.css';

const SVG = 'http://www.w3.org/2000/svg';
/** A batch this far behind the server is drawn without animating. */
const SKIP_MS = 2_500;
/** Your own two cards are drawn a little larger: they're in your hand, nearest the camera. */
const MY_CARD_SCALE = 1.35;
const RING_R = 21;
const RING_C = 2 * Math.PI * RING_R;
/** How far the five that win a showdown rise off the felt. */
const LIFT = 0.012;
const money = (c: Cents) => formatMoney(c);

const MOVE_LABEL: Record<string, string> = {
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
  bet: 'Bet',
  raise: 'Raise',
  allin: 'All-in',
  sb: 'Small blind',
  bb: 'Big blind',
};

interface SeatObj {
  /** The stack the plate shows, kept current while bets animate. */
  shown: Cents;
  plate: HTMLElement;
  label: CSS2DObject;
  avatar: HTMLElement;
  ring: SVGCircleElement;
  name: HTMLElement;
  tag: HTMLElement;
  stack: HTMLElement;
  status: HTMLElement;
  cards: CardMesh[];
  bet: ChipStack;
  betTag: HTMLElement;
  betLabel: CSS2DObject;
}

export function mountHoldem(ctx: TableViewCtx): TableView {
  const { stage, kit, sfx, link } = ctx;
  let v: HoldemView | null = null;
  /** The newest view from the server, ahead of `v` while a batch is still animating. */
  let latest: HoldemView | null = null;
  let n = 0;
  /** The seat drawn nearest the camera: yours, or seat 0 while you watch. */
  let base = 0;
  let mySeat: number | null = null;
  let status: 'watching' | 'buying_in' | 'seated' | 'cashing_out' = 'watching';
  let buyIn = { min: 0, max: 0 };
  let wasSeated = false;
  let felt: ReturnType<typeof holdemFelt> | null = null;
  const seats: SeatObj[] = [];
  let board: CardMesh[] = [];
  let pots: { stack: ChipStack; label: CSS2DObject }[] = [];
  const temps = new Set<THREE.Object3D>();
  /** What each seat put in this hand (from the events), so a win can be told from a partial return. */
  let put: Record<number, Cents> = {};
  let turnKey = '';
  let turnStart = 0;
  /**
   * Animation speed. Batches play in order, so a table that falls behind the server (a slow
   * frame rate, a burst of bot moves) plays the backlog faster, and skips it past a point.
   */
  let speed = 1;
  const T = (ms: number) => ms / speed;
  const pause = (ms: number) => wait(T(ms));
  const ringShown = new Map<number, string>();
  let clockShown = '';

  // Tips: the read on your hand, its chance against the players still in, and what the price
  // says, worked out once per decision and off the frame loop.
  const rng = cryptoRng();
  let tipKey = '';
  let tipTimer = 0;
  let equityMemo = { key: '', value: 0 };
  /** Bets and raises before the flop this hand, and who made them (tips deal those players stronger hands, as the bots do). */
  let pre = { raises: 0, raisers: new Set<number>(), level: 0, open: true };
  /** A batch is still playing out: tips wait for it, so a flop isn't read out before it lands. */
  let animating = false;
  // Celebrations: the best category already marked in which hand (a hand is marked each time it
  // improves), glows still lit, and what you collect in this batch.
  let marked = 0;
  let markedHand = 0;
  const glows: (() => void)[] = [];
  let myWins = { left: 0, won: 0 };

  const button = dealerButton();
  button.visible = false;
  stage.root.add(button);
  // the chairs between the camera and the rail stay out of the way while you play
  const chairsBack = hideNearChairs(stage.anchor);

  const potLabelEl = el('div', 'he-pot', '');
  const potLabel = stage.label(potLabelEl, new THREE.Vector3(0, TOP_Y + 0.01, 0.2));
  potLabelEl.hidden = true;

  const bar = new ActionBar(
    (a) => {
      link.act(a);
      bar.lock();
      clearTip();
      sfx.play('ui-click', { volume: 0.4 });
    },
    (on) => link.act({ type: 'sitout', on }),
  );
  ctx.ui.append(bar.root);

  // Hand history: this hand as it happens, and the last few.
  const hist = el('aside', 'he-history panel');
  const histHead = el('button', 'he-history-head');
  histHead.type = 'button';
  const histTitle = el('span', '', 'Hand history');
  histHead.append(histTitle, el('span', 'key', 'H'));
  const histBody = el('div', 'he-history-body');
  hist.append(histHead, histBody);
  histHead.addEventListener('click', () => hist.classList.toggle('he-open'));
  ctx.ui.append(hist);

  // Out of chips, or not seated yet.
  const seatPanel = el('div', 'he-seat panel');
  const seatTitle = el('div', 'he-seat-title');
  const seatNote = el('p', 'he-seat-note');
  const seatRow = el('div', 'row');
  const rebuy = el('button', 'btn primary', 'Buy in');
  rebuy.type = 'button';
  const leave = el('button', 'btn ghost', 'Leave');
  leave.type = 'button';
  seatRow.append(rebuy, leave);
  seatPanel.append(seatTitle, seatNote, seatRow);
  seatPanel.hidden = true;
  ctx.ui.append(seatPanel);
  rebuy.addEventListener('click', async () => {
    const amount = await kit.askBuyIn({ min: buyIn.min, max: buyIn.max, balance: session.profile?.balance ?? 0, verb: wasSeated ? 'Rebuy' : 'Buy in' });
    if (amount) link.buyIn(amount);
  });
  leave.addEventListener('click', () => {
    seatPanel.hidden = true;
    link.leave();
  });

  // ------------------------------------------------------------------------------------------
  // Layout

  const slot = (seat: number) => (seat - base + n) % n;
  const tangent = (k: number) => {
    const e = slotEdge(k, n);
    return new THREE.Vector3(e.nz, 0, -e.nx);
  };
  const plateAt = (k: number) => slotPoint(k, n, k === 0 ? -0.03 : -0.15, TOP_Y + 0.04);
  const betAt = (k: number) => slotPoint(k, n, k === 0 ? 0.36 : 0.32, TOP_Y);
  const railAt = (k: number) => slotPoint(k, n, 0.04, TOP_Y + 0.01);
  const potAt = (i: number, count: number) => new THREE.Vector3((i - (count - 1) / 2) * 0.14, TOP_Y, 0.12);

  function cardAt(k: number, i: number): { pos: THREE.Vector3; yaw: number; tilt: number } {
    if (k === 0) {
      const p = slotPoint(0, n, 0.2, TOP_Y + 0.035);
      p.x += (i - 0.5) * (CARD_W * MY_CARD_SCALE + 0.01);
      return { pos: p, yaw: 0, tilt: 0.55 };
    }
    const p = slotPoint(k, n, 0.15, TOP_Y + 0.0015 + i * 0.0006);
    p.add(tangent(k).multiplyScalar((i - 0.5) * (CARD_W * 0.62)));
    return { pos: p, yaw: slotYaw(k, n) + (i - 0.5) * 0.12, tilt: 0 };
  }

  function buttonAt(k: number): THREE.Vector3 {
    const p = slotPoint(k, n, 0.26, TOP_Y + 0.0035);
    return p.add(tangent(k).multiplyScalar(k === 0 ? 0.13 : 0.1));
  }

  function makeSeat(): SeatObj {
    const plate = el('div', 'he-plate');
    const avatar = el('div', 'he-avatar');
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'he-ring');
    svg.setAttribute('viewBox', '0 0 48 48');
    const track = document.createElementNS(SVG, 'circle');
    track.setAttribute('class', 'he-ring-track');
    const ring = document.createElementNS(SVG, 'circle');
    ring.setAttribute('class', 'he-ring-left');
    for (const c of [track, ring]) {
      c.setAttribute('cx', '24');
      c.setAttribute('cy', '24');
      c.setAttribute('r', String(RING_R));
    }
    ring.setAttribute('stroke-dasharray', String(RING_C));
    svg.append(track, ring);
    const initial = el('span', 'he-initial');
    avatar.append(svg, initial);
    const info = el('div', 'he-info');
    const nameRow = el('div', 'he-name-row');
    const name = el('span', 'he-name');
    const tag = el('span', 'he-tag', 'BOT');
    nameRow.append(name, tag);
    const stack = el('div', 'he-stack money');
    info.append(nameRow, stack);
    const status = el('div', 'he-status');
    plate.append(avatar, info, status);
    const label = stage.label(plate, new THREE.Vector3());
    const bet = new ChipStack();
    stage.root.add(bet);
    const betTag = el('div', 'he-bet money');
    const betLabel = stage.label(betTag, new THREE.Vector3());
    return { shown: 0, plate, label, avatar, ring, name, tag, stack, status, cards: [], bet, betTag, betLabel };
  }

  function ensureSeats(count: number): void {
    if (n === count && seats.length === count) return;
    n = count;
    while (seats.length < count) seats.push(makeSeat());
    if (!felt) {
      felt = holdemFelt(v?.blinds ?? { sb: 500, bb: 1000 }, count);
      stage.addFelt(felt, TOP_Y + 0.0004);
    }
  }

  function layout(): void {
    seats.forEach((o, seat) => {
      const k = slot(seat);
      o.label.position.copy(plateAt(k));
      o.bet.position.copy(betAt(k));
      const bl = betAt(k);
      o.betLabel.position.set(bl.x, bl.y + 0.035, bl.z);
      o.plate.classList.toggle('he-near', k === 0);
    });
  }

  // ------------------------------------------------------------------------------------------
  // Drawing the view

  function setStack(o: SeatObj, stack: Cents, allIn = false): void {
    o.shown = stack;
    o.stack.textContent = allIn && stack <= 0 ? 'All-in' : money(Math.max(0, stack));
  }

  function clearCards(o: SeatObj): void {
    for (const c of o.cards) c.removeFromParent();
    o.cards = [];
  }

  function placeCard(card: Card | null, k: number, i: number): CardMesh {
    const m = new CardMesh(card);
    const at = cardAt(k, i);
    m.position.copy(at.pos);
    if (k === 0) m.scale.setScalar(MY_CARD_SCALE);
    m.rotation.set(card ? at.tilt : Math.PI, card && k !== 0 ? 0 : at.yaw, 0, 'YXZ');
    if (card && k !== 0) m.position.y += 0.0008;
    stage.root.add(m);
    return m;
  }

  function statusText(sv: HoldemSeatView, view: HoldemView): string {
    if (view.phase === 'results' && sv.won > 0) return `Wins ${money(sv.won)}`;
    if (sv.hand && (view.phase === 'results' || view.phase === 'runout') && sv.cards.some((c) => c)) return sv.hand;
    if (sv.sittingOut) return 'Sitting out';
    if (sv.away) return 'Away';
    if (sv.waiting) return 'Waiting for the big blind';
    if (sv.allIn) return 'All-in';
    if (sv.folded) return 'Fold';
    if (sv.last) return MOVE_LABEL[sv.last] ?? '';
    return '';
  }

  function drawSeat(seat: number, view: HoldemView): void {
    const o = seats[seat]!;
    const sv = view.seats[seat] ?? null;
    const k = slot(seat);
    clearCards(o);
    o.plate.hidden = !sv;
    o.betTag.hidden = true;
    if (!sv) {
      o.bet.set(0);
      return;
    }
    o.name.textContent = sv.name;
    o.tag.hidden = !sv.bot;
    o.avatar.querySelector('.he-initial')!.textContent = sv.name.slice(0, 1).toUpperCase();
    setStack(o, sv.stack, sv.allIn);
    const st = statusText(sv, view);
    o.status.textContent = st;
    o.status.hidden = st === '';
    o.status.dataset.kind = sv.won > 0 && view.phase === 'results' ? 'win' : sv.allIn ? 'allin' : sv.folded ? 'fold' : sv.last ?? '';
    o.plate.classList.toggle('he-turn', view.turn?.seat === seat);
    o.plate.classList.toggle('he-folded', sv.folded && view.phase !== 'results');
    o.plate.classList.toggle('he-out', sv.sittingOut || sv.waiting || sv.away);
    o.plate.classList.toggle('he-me', seat === mySeat);
    o.plate.classList.toggle('he-winner', view.phase === 'results' && sv.won > 0);
    o.plate.classList.toggle('he-button', view.button === seat);
    if (sv.cards.length === 2 && !(sv.folded && view.phase !== 'results')) {
      o.cards = sv.cards.map((c, i) => placeCard(c, k, i));
    }
    o.bet.set(sv.bet);
    if (sv.bet > 0) {
      o.betTag.hidden = false;
      o.betTag.textContent = money(sv.bet);
    }
  }

  function dim(m: CardMesh, on: boolean): void {
    const mats = m.material as THREE.MeshStandardMaterial[];
    mats[2]!.color.setScalar(on ? 0.42 : 1);
  }

  /** One of the five that won a showdown: raised off the felt and warmed a little (once per card). */
  function lift(m: CardMesh, ms: number): Promise<void> | void {
    if (m.userData.lifted) return;
    m.userData.lifted = true;
    (m.material as THREE.MeshStandardMaterial[])[2]!.emissive.setRGB(0.13, 0.1, 0.04);
    const y0 = m.position.y;
    if (ms <= 0) {
      m.position.y = y0 + LIFT;
      return;
    }
    return tween(ms, (t) => (m.position.y = y0 + LIFT * t), ease.out);
  }

  function draw(view: HoldemView): void {
    v = view;
    latest = view;
    ensureSeats(view.maxSeats);
    const mine = view.you?.seat ?? null;
    if (mine !== null) mySeat = mine;
    base = mySeat ?? 0;
    layout();
    for (const t of temps) t.removeFromParent();
    temps.clear();
    for (let s = 0; s < n; s++) drawSeat(s, view);

    for (const c of board) c.removeFromParent();
    board = view.board.map((code, i) => {
      const m = new CardMesh(code);
      m.position.copy(boardPoint(i));
      m.scale.setScalar(BOARD_SCALE);
      m.rotation.set(0, 0, 0);
      stage.root.add(m);
      return m;
    });

    for (const p of pots) {
      p.stack.removeFromParent();
      p.label.removeFromParent();
      p.label.element.remove();
    }
    pots = view.pots.map((pot, i) => {
      const stack = new ChipStack();
      stack.set(pot.amount);
      stack.position.copy(potAt(i, view.pots.length));
      stage.root.add(stack);
      const tagEl = el('div', 'he-sidepot money', view.pots.length > 1 ? `${pot.label} ${money(pot.amount)}` : '');
      tagEl.hidden = view.pots.length < 2;
      const at = potAt(i, view.pots.length);
      const label = stage.label(tagEl, new THREE.Vector3(at.x, at.y + 0.03, at.z + 0.05));
      return { stack, label };
    });
    potLabelEl.hidden = view.total <= 0;
    potLabelEl.textContent = `Pot ${money(view.total)}`;
    // Beside the pot on its right, from its left edge: in front of the pot it sat on your own bet
    // (the bet in front of your seat is on the same line), and the side pots' tags are below them.
    const right = potAt(Math.max(0, view.pots.length - 1), Math.max(1, view.pots.length));
    potLabel.position.set(right.x + 0.06, TOP_Y + 0.012, right.z);
    potLabel.center.set(0, 0.5);

    if (view.button !== null && view.seats[view.button]) {
      button.visible = true;
      button.position.copy(buttonAt(slot(view.button)));
    } else button.visible = view.button !== null;

    // Showdown: the cards that play stay bright and lifted, the rest dim.
    const best = new Set<string>();
    if (view.phase === 'results') for (const sv of view.seats) if (sv && sv.won > 0 && sv.best) sv.best.forEach((c) => best.add(c));
    if (best.size) {
      for (const m of [...board, ...seats.flatMap((o) => o.cards)]) {
        if (!m.card) continue;
        dim(m, !best.has(m.card));
        if (best.has(m.card)) lift(m, 0);
      }
    }

    drawBar(view);
    drawHistory(view);
    drawSeatPanel();
  }

  function drawBar(view: HoldemView): void {
    const you = view.you;
    const legal = you?.legal ?? null;
    let note = '';
    if (!you) note = '';
    else if (you.sittingOut) note = 'You are sitting out. The table deals you in when you come back.';
    else if (you.waiting) note = 'Waiting for the big blind to reach you.';
    else if (legal) note = ctx.tips.on ? 'Tips are a guide, not a guarantee' : '';
    else if (view.phase === 'waiting') note = view.mode === 'multi' ? 'Waiting for players' : 'Next hand shortly';
    else if (view.turn) note = `${view.seats[view.turn.seat]?.name ?? 'Next player'} to act`;
    else if (view.phase === 'runout') note = 'All-in: running the board out';
    else if (view.phase === 'results') note = 'Next hand shortly';
    bar.root.hidden = !you;
    bar.set(legal, { total: view.total, note, sittingOut: !!you?.sittingOut });
    tipFor(view);
  }

  // ------------------------------------------------------------------------------------------
  // Tips

  /** Count the raises before the flop, and who made them, the way the engine builds a bot's situation. */
  function track(list: HoldemEvent[], bb: Cents): void {
    for (const e of list) {
      if (e.type === 'hand') pre = { raises: 0, raisers: new Set(), level: bb, open: true };
      else if (e.type === 'post') pre.level = Math.max(pre.level, e.amount);
      else if (e.type === 'board') pre.open = false;
      else if (e.type === 'act' && pre.open && e.total > pre.level) {
        pre.level = e.total;
        pre.raises++;
        pre.raisers.add(e.seat);
      }
    }
  }

  /** On your turn with Tips on: the read, the chance and the play, and a ring on that button. */
  function tipFor(view: HoldemView): void {
    const you = view.you;
    const legal = you?.legal ?? null;
    if (!ctx.tips.on || !you || !legal || you.cards.length !== 2) return clearTip();
    // While a batch plays out the line waits for it, so a flop isn't read out before it lands.
    if (animating) return;
    const live = view.seats.filter((sv): sv is HoldemSeatView => !!sv && sv.inHand && !sv.folded && sv.seat !== you.seat);
    const opponents = live.map((sv) => ({ strong: pre.raisers.has(sv.seat) }));
    // Joined mid-hand: the events that told who raised are gone, but a bet over the blind is one.
    const raises = Math.max(pre.raises, view.street === 'preflop' && view.bet > view.blinds.bb ? 1 : 0);
    const field = opponents.map((o) => (o.strong ? 's' : 'r')).join('');
    const key = [view.handId, view.board.join(''), field, legal.call, view.total, raises].join('|');
    if (key === tipKey) return;
    tipKey = key;
    clearTimeout(tipTimer);
    // A thousand deals or so take a millisecond or two: run them between frames, not inside one.
    tipTimer = window.setTimeout(() => {
      if (tipKey !== key || !ctx.tips.on) return;
      const eqKey = `${view.handId}|${you.cards.join('')}|${view.board.join('')}|${field}`;
      if (equityMemo.key !== eqKey) equityMemo = { key: eqKey, value: estimateEquity(you.cards, view.board, opponents, rng) };
      const dealt = view.seats.filter((sv): sv is HoldemSeatView => !!sv && sv.inHand).map((sv) => sv.seat);
      const advice = advise(
        {
          hole: you.cards,
          board: view.board,
          opponents: opponents.length,
          call: legal.call,
          total: view.total,
          behind: legal.behind,
          canRaise: !!(legal.bet ?? legal.raise),
          opening: !!legal.bet,
          position: view.button === null ? 'middle' : positionOf(you.seat, dealt, view.button, view.sbSeat, view.bbSeat),
          raises,
        },
        equityMemo.value,
      );
      kit.tip(advice.text);
      bar.pick(advice.pick);
    }, 0);
  }

  function clearTip(): void {
    clearTimeout(tipTimer);
    if (!tipKey) return;
    tipKey = '';
    kit.tip(null);
    bar.pick(null);
  }

  const offTips = ctx.tips.subscribe(() => {
    if (latest) drawBar(latest);
  });

  function drawHistory(view: HoldemView): void {
    histBody.replaceChildren();
    const section = (title: string, lines: string[]) => {
      const box = el('section', 'he-hand');
      box.append(el('h3', '', title));
      const list = el('ol', '');
      for (const line of lines) list.append(el('li', '', line));
      box.append(list);
      histBody.append(box);
    };
    const live = view.phase !== 'waiting' && view.phase !== 'results' && view.handId > 0;
    histTitle.textContent = view.handId ? `Hand #${view.handId}` : 'Hand history';
    if (live) section(`Hand #${view.handId} (in play)`, view.log);
    for (const h of view.history) section(`Hand #${h.id}${h.board.length ? ` · ${h.board.map(cardText).join(' ')}` : ''}`, h.lines);
  }

  function drawSeatPanel(): void {
    const busted = status === 'watching' && wasSeated;
    const show = status === 'watching' && buyIn.max > 0;
    seatPanel.hidden = !show;
    seatTitle.textContent = busted ? 'Out of chips' : 'Take a seat';
    seatNote.textContent = busted
      ? `Rebuy for ${money(buyIn.min)} to ${money(buyIn.max)}, or leave the table.`
      : `Bring ${money(buyIn.min)} to ${money(buyIn.max)} to the table (20 to 100 big blinds).`;
    rebuy.textContent = busted ? 'Rebuy' : 'Buy in';
  }

  // ------------------------------------------------------------------------------------------
  // Animations

  const nameOf = (seat: number, view: HoldemView) => view.seats[seat]?.name ?? v?.seats[seat]?.name ?? `Seat ${seat + 1}`;

  async function slideChips(amount: Cents, from: THREE.Vector3, to: THREE.Vector3, ms = 300): Promise<void> {
    if (amount <= 0) return;
    const s = new ChipStack();
    s.set(amount);
    s.position.copy(from);
    stage.root.add(s);
    temps.add(s);
    await slideStack(s, to, T(ms));
    s.removeFromParent();
    temps.delete(s);
  }

  async function muck(o: SeatObj): Promise<void> {
    const cards = o.cards;
    o.cards = [];
    await Promise.all(
      cards.map(async (m) => {
        const from = m.position.clone();
        const to = DEALER_POINT.clone();
        await tween(T(260), (t) => {
          m.position.lerpVectors(from, to, t);
          m.rotation.x = m.rotation.x > 1 ? Math.PI : m.rotation.x * (1 - t) + Math.PI * t;
        }, ease.inOut);
        m.removeFromParent();
      }),
    );
  }

  /** The dealer's call for a pot: "Alex wins $1,240 (main pot)", "Split pot: $620 each", "Side pot: $300 to Sam". */
  function winCall(e: Extract<HoldemEvent, { type: 'win' }>, next: HoldemView): string {
    const lead = e.winners[0]!;
    const hand = e.hand ? ` · ${e.hand}` : '';
    if (e.winners.length > 1) return `Split ${e.label}: ${money(lead.amount)} each${hand}`;
    if (e.pot > 0) return `${e.label[0]!.toUpperCase()}${e.label.slice(1)}: ${money(e.amount)} to ${nameOf(lead.seat, next)}${hand}`;
    return `${nameOf(lead.seat, next)} wins ${money(e.amount)} (${e.label})${hand}`;
  }

  /** The board as dealt so far (the batch may still be dealing streets `next` already has). */
  const boardSoFar = () => board.map((m) => m.card).filter((c): c is Card => c !== null);

  /** Your best five, as the card meshes on the table. */
  function meshesOf(five: readonly Card[]): CardMesh[] {
    const me = mySeat !== null ? seats[mySeat] : undefined;
    return [...board, ...(me?.cards ?? [])].filter((m) => m.card !== null && five.includes(m.card));
  }

  /**
   * A street just made you trips or better with your own cards (not a hand the board gives
   * everyone): name it over the table and light the five that make it. Marked again only when
   * it improves.
   */
  function markMade(next: HoldemView): void {
    const hole = next.you?.cards ?? [];
    const sv = mySeat !== null ? next.seats[mySeat] : null;
    const shown = boardSoFar();
    if (!sv || sv.folded || hole.length !== 2 || shown.length < 3) return;
    const h = hole.map(cardInt);
    const b = shown.map(cardInt);
    const v = evaluate([...h, ...b]);
    const cat = v >> 20;
    // Keyed to the hand, so a table joined or redrawn mid-hand starts its count fresh.
    if (markedHand !== next.handId) {
      markedHand = next.handId;
      marked = 0;
    }
    if (cat < TRIPS || cat <= marked || onBoard(h, b, v)) return;
    marked = cat;
    const tier: Tier = cat >= STRAIGHT_FLUSH ? 'huge' : cat >= FULL_HOUSE ? 'big' : 'nice';
    const { title, sub } = bannerOf(v);
    glows.push(celebrate({ stage, ui: ctx.ui, sfx }, { title, sub: sub ?? undefined, tier, glow: meshesOf(bestFive([...h, ...b]).map(intCard)) }));
  }

  /**
   * You took in more than you put in this hand: a banner sized by the hand you showed down and
   * the pot, your five lit, and for a big pot a shower of chips in front of you. A pot that only
   * gives your chips back is never celebrated.
   */
  function celebrateWin(e: Extract<HoldemEvent, { type: 'win' }>, next: HoldemView): void {
    if (mySeat === null) return;
    const won = myWins.won;
    if (won <= (put[mySeat] ?? 0)) return;
    const hole = next.you?.cards ?? [];
    const shown = boardSoFar();
    // The hand counts when it was shown down; a pot the others folded to counts by its size.
    const all = e.hand !== null && hole.length === 2 && shown.length === 5 ? [...hole, ...shown].map(cardInt) : null;
    const value = all ? evaluate(all) : null;
    const bb = next.blinds.bb;
    const byPot = won >= 60 * bb ? 3 : won >= 30 * bb ? 2 : won >= 15 * bb ? 1 : 0;
    let size = byPot >= 2 ? byPot : 0;
    if (value !== null) {
      const cat = value >> 20;
      size = Math.max(byPot, cat >= STRAIGHT_FLUSH ? 3 : cat >= FULL_HOUSE ? 2 : cat >= TRIPS ? 1 : 0);
    }
    if (size === 0) return;
    const tier = (['nice', 'big', 'huge'] as const)[size - 1]!;
    const banner = value === null ? null : bannerOf(value);
    glows.push(
      celebrate(
        { stage, ui: ctx.ui, sfx },
        {
          title: banner?.title ?? 'Big pot',
          sub: banner?.sub ? `${banner.sub} · ${money(won)}` : money(won),
          tier,
          at: betAt(slot(mySeat)),
          glow: all ? meshesOf(bestFive(all).map(intCard)) : [],
        },
      ),
    );
  }

  async function play(e: HoldemEvent, next: HoldemView): Promise<void> {
    switch (e.type) {
      case 'hand': {
        put = {};
        for (const stop of glows.splice(0)) stop();
        for (const o of seats) {
          clearCards(o);
          o.bet.set(0);
          o.betTag.hidden = true;
          o.plate.classList.remove('he-winner', 'he-turn');
          o.status.hidden = true;
        }
        for (const c of board) c.removeFromParent();
        board = [];
        for (const p of pots) p.stack.set(0);
        potLabelEl.hidden = true;
        ensureSeats(next.maxSeats);
        const to = buttonAt(slot(e.button));
        if (button.visible) {
          const from = button.position.clone();
          await tween(T(420), (t) => button.position.lerpVectors(from, to, t), ease.inOut);
        } else {
          button.position.copy(to);
          button.visible = true;
        }
        sfx.play('card-shuffle', { volume: 0.6 });
        break;
      }
      case 'post': {
        put[e.seat] = (put[e.seat] ?? 0) + e.amount;
        const k = slot(e.seat);
        const po = seats[e.seat];
        if (po) setStack(po, po.shown - e.amount, e.allIn);
        await slideChips(e.amount, railAt(k), betAt(k), 260);
        seats[e.seat]?.bet.set(e.amount);
        sfx.play('chip-lay', { volume: 0.7 });
        break;
      }
      case 'deal': {
        sfx.play('card-deal');
        stage.gesture('deal');
        let last: Promise<void> = Promise.resolve();
        for (let round = 0; round < 2; round++) {
          for (const seat of e.order) {
            const o = seats[seat];
            if (!o) continue;
            const k = slot(seat);
            const at = cardAt(k, round);
            const m = new CardMesh(null);
            m.rotation.set(Math.PI, 0, 0, 'YXZ');
            if (k === 0) m.scale.setScalar(MY_CARD_SCALE);
            stage.root.add(m);
            o.cards.push(m);
            last = dealCard(m, DEALER_POINT, at.pos, { faceUp: false, ms: T(240), yaw: at.yaw });
            if (round === 0 && seat === e.order[0]) sfx.play('card-deal', { volume: 0.5 });
            await pause(55);
          }
        }
        await last;
        const mineCards = next.you?.cards ?? [];
        const me = next.you ? seats[next.you.seat] : undefined;
        if (me && mineCards.length === 2 && me.cards.length === 2) {
          sfx.play('card-flip');
          await Promise.all(
            me.cards.map(async (m, i) => {
              m.setCard(mineCards[i]!);
              const at = cardAt(0, i);
              const from = m.position.clone();
              await tween(T(260), (t) => {
                m.position.lerpVectors(from, at.pos, t);
                m.rotation.x = Math.PI + (at.tilt - Math.PI) * t;
              }, ease.inOut);
            }),
          );
        }
        break;
      }
      case 'act': {
        const o = seats[e.seat];
        const k = slot(e.seat);
        if (o) {
          o.status.hidden = false;
          o.status.textContent = e.move === 'call' ? `Call ${money(e.added)}` : e.move === 'bet' || e.move === 'raise' ? `${MOVE_LABEL[e.move]} ${money(e.total)}` : MOVE_LABEL[e.move]!;
          o.status.dataset.kind = e.move;
          o.plate.classList.remove('he-turn');
        }
        if (e.added > 0) {
          put[e.seat] = (put[e.seat] ?? 0) + e.added;
          if (o) setStack(o, o.shown - e.added, e.move === 'allin');
          await slideChips(e.added, railAt(k), betAt(k), 280);
          o?.bet.set(e.total);
          if (o) {
            o.betTag.hidden = false;
            o.betTag.textContent = money(e.total);
          }
          sfx.play(e.move === 'allin' ? 'chips-stack' : 'chip-lay');
        } else if (e.move === 'check') sfx.play('chips-handle', { volume: 0.35 });
        if (e.move === 'fold' && o) {
          sfx.play('card-place', { volume: 0.6 });
          o.plate.classList.add('he-folded');
          await muck(o);
        }
        if (e.auto === 'timeout') kit.say(`${nameOf(e.seat, next)} ran out of time`, 2000);
        await pause(e.move === 'check' ? 180 : 120);
        break;
      }
      case 'collect': {
        const moving = seats
          .map((o, seat) => ({ o, seat }))
          .filter(({ o }) => o.bet.amount > 0);
        if (moving.length) {
          sfx.play('chips-collide', { volume: 0.7 });
          stage.gesture('sweep');
          await Promise.all(
            moving.map(async ({ o }) => {
              const amount = o.bet.amount;
              const from = o.bet.position.clone();
              o.bet.set(0);
              o.betTag.hidden = true;
              await slideChips(amount, from, potAt(0, 1), 320);
            }),
          );
        }
        const count = e.pots.length;
        for (const p of pots) {
          p.stack.removeFromParent();
          p.label.removeFromParent();
          p.label.element.remove();
        }
        pots = e.pots.map((amount, i) => {
          const stack = new ChipStack();
          stack.set(amount);
          stack.position.copy(potAt(i, count));
          stage.root.add(stack);
          const label = stage.label(el('div', 'he-sidepot money', ''), new THREE.Vector3());
          label.element.hidden = true;
          return { stack, label };
        });
        const total = e.pots.reduce((a, b) => a + b, 0);
        potLabelEl.hidden = total <= 0;
        potLabelEl.textContent = `Pot ${money(total)}`;
        break;
      }
      case 'uncalled': {
        put[e.seat] = (put[e.seat] ?? 0) - e.amount;
        const o = seats[e.seat];
        const k = slot(e.seat);
        if (o && o.bet.amount > 0) o.bet.set(Math.max(0, o.bet.amount - e.amount));
        if (o) setStack(o, o.shown + e.amount);
        kit.say(`Uncalled bet of ${money(e.amount)} returned to ${nameOf(e.seat, next)}`, 2400);
        await slideChips(e.amount, betAt(k), railAt(k), 300);
        break;
      }
      case 'board': {
        const start = board.length;
        const cards = e.cards.map((code, i) => {
          const m = new CardMesh(null);
          m.rotation.set(Math.PI, 0, 0);
          m.scale.setScalar(BOARD_SCALE);
          stage.root.add(m);
          board.push(m);
          return { m, code, i };
        });
        sfx.play('card-deal');
        stage.gesture('deal');
        await Promise.all(
          cards.map(async ({ m, i }) => {
            await pause(i * 110);
            await dealCard(m, DEALER_POINT, boardPoint(start + i), { faceUp: false, ms: T(260) });
          }),
        );
        for (const { m, code } of cards) m.setCard(code);
        sfx.play('card-flip');
        await Promise.all(cards.map(async ({ m, i }) => {
          await pause(i * 70);
          await flipCard(m, true, T(220));
        }));
        await pause(160);
        markMade(next);
        break;
      }
      case 'reveal': {
        const o = seats[e.seat];
        if (!o) break;
        const k = slot(e.seat);
        if (o.cards.length !== 2) {
          clearCards(o);
          o.cards = [placeCard(null, k, 0), placeCard(null, k, 1)];
        }
        sfx.play('card-flip');
        await Promise.all(
          o.cards.map(async (m, i) => {
            if (m.faceUp && m.card === e.cards[i]) return;
            m.setCard(e.cards[i]!);
            const yaw0 = m.rotation.y;
            const x0 = m.rotation.x;
            const x1 = k === 0 ? cardAt(0, i).tilt : 0;
            const y0 = m.position.y;
            await tween(T(300), (t) => {
              m.rotation.x = x0 + (x1 - x0) * t;
              m.rotation.y = yaw0 * (1 - t);
              m.position.y = y0 + Math.sin(Math.PI * t) * 0.03;
            }, ease.inOut);
            m.position.y = y0;
          }),
        );
        o.status.hidden = false;
        o.status.dataset.kind = 'show';
        const shown = e.cards.map(cardText).join(' ');
        o.status.textContent = e.hand ?? shown;
        kit.say(`${nameOf(e.seat, next)} shows ${e.hand ?? shown}`, 2600);
        await pause(480);
        break;
      }
      case 'muck': {
        const o = seats[e.seat];
        kit.say(`${nameOf(e.seat, next)} mucks`, 1800);
        if (o) await muck(o);
        break;
      }
      case 'win': {
        kit.say(winCall(e, next), 3200);
        // At a showdown the five that win rise off the felt, whoever holds them.
        if (e.best) {
          const five = new Set<Card>(e.best);
          const holders = e.winners.flatMap((w) => seats[w.seat]?.cards ?? []);
          for (const m of [...board, ...holders]) if (m.card && five.has(m.card)) void lift(m, T(300));
        }
        const from = pots[e.pot]?.stack.position.clone() ?? potAt(0, 1);
        if (pots[e.pot]) pots[e.pot]!.stack.set(0);
        const remaining = pots.reduce((a, p) => a + p.stack.amount, 0);
        potLabelEl.hidden = remaining <= 0;
        potLabelEl.textContent = `Pot ${money(remaining)}`;
        await Promise.all(e.winners.map((w) => slideChips(w.amount, from, railAt(slot(w.seat)), 460)));
        for (const w of e.winners) {
          const wo = seats[w.seat];
          if (wo) setStack(wo, wo.shown + w.amount);
        }
        let up = false;
        for (const w of e.winners) {
          const net = w.amount - (put[w.seat] ?? 0);
          const mine = w.seat === mySeat;
          if (mine && net > 0) up = true;
          const p = plateAt(slot(w.seat));
          kit.pill(stage, new THREE.Vector3(p.x, p.y + 0.06, p.z), mine && net <= 0 ? `Back ${money(w.amount)}` : `+${money(w.amount)}`, mine && net <= 0 ? 'push' : 'win', 2600);
        }
        sfx.play('chips-stack', { volume: up ? 1 : 0.6 });
        stage.gesture('pay');
        // Your last pot of the hand has landed: mark the win, if it is one.
        if (e.winners.some((w) => w.seat === mySeat) && --myWins.left === 0) celebrateWin(e, next);
        await pause(520);
        break;
      }
      case 'rebuy':
        kit.say(`${nameOf(e.seat, next)} rebuys for ${money(e.amount)}`, 2200);
        break;
      case 'sitout':
      case 'handEnd':
        break;
    }
  }

  // ------------------------------------------------------------------------------------------

  function tickTimers(): void {
    const view = latest;
    const t = view?.turn ?? null;
    let mineMs: number | null = null;
    let bank = false;
    const setRing = (s: number, o: SeatObj, offset: string, inBank: boolean) => {
      const key = `${offset}|${inBank}`;
      if (ringShown.get(s) === key) return;
      ringShown.set(s, key);
      o.ring.style.strokeDashoffset = offset;
      o.plate.classList.toggle('he-bank', inBank);
    };
    for (let s = 0; s < seats.length; s++) {
      const o = seats[s]!;
      if (!t || t.seat !== s || view?.phase !== 'playing') {
        setRing(s, o, String(RING_C), false);
        continue;
      }
      const now = serverNow();
      const key = `${t.seat}:${t.deadline}`;
      if (key !== turnKey) {
        turnKey = key;
        turnStart = Math.min(now, t.bankFrom !== null ? t.bankFrom - ACT_MS : now);
      }
      let frac: number;
      if (t.bankFrom !== null && now < t.bankFrom) frac = (t.bankFrom - now) / ACT_MS;
      else if (t.bankFrom !== null) {
        bank = true;
        frac = (t.deadline - now) / Math.max(1, t.deadline - t.bankFrom);
      } else frac = (t.deadline - now) / Math.max(1, t.deadline - turnStart);
      frac = Math.max(0, Math.min(1, frac));
      setRing(s, o, (RING_C * (1 - frac)).toFixed(1), bank);
      if (s === mySeat) mineMs = Math.max(0, (bank || t.bankFrom === null ? t.deadline : t.bankFrom) - now);
    }
    const clock = mineMs === null ? '' : `${Math.ceil(mineMs / 1000)}|${bank}`;
    if (clock !== clockShown) {
      clockShown = clock;
      bar.setClock(mineMs, bank);
    }
  }

  return {
    onTable(snap) {
      status = snap.you.status;
      buyIn = { min: snap.meta.config.buyIn.min, max: snap.meta.config.buyIn.max };
      if (snap.you.seat !== null) mySeat = snap.you.seat;
      if (status === 'seated') wasSeated = true;
      const view = snap.view as HoldemView;
      // A fresh picture of the table: the raises it no longer shows are forgotten (tips fall back on the bet to match).
      pre = { raises: 0, raisers: new Set(), level: view.blinds.bb, open: view.board.length === 0 };
      clearTip();
      draw(view);
    },
    async onEvents(events: GameEvent[], view) {
      const next = view as HoldemView;
      ensureSeats(next.maxSeats);
      if (next.you) mySeat = next.you.seat;
      if ((mySeat ?? 0) !== base) {
        base = mySeat ?? 0;
        layout();
      }
      const list = events as unknown as HoldemEvent[];
      track(list, next.blinds.bb);
      // What you collect in this batch, so a win is marked once, when its last pot lands.
      myWins = { left: 0, won: 0 };
      for (const e of list) {
        if (e.type !== 'win') continue;
        for (const w of e.winners) {
          if (w.seat !== mySeat) continue;
          myWins.left++;
          myWins.won += w.amount;
        }
      }
      // Whose turn it is changes now, not when the animation ends: the clock is already running.
      latest = next;
      animating = true;
      drawBar(next);
      const behind = serverNow() - next.at;
      if (behind > SKIP_MS) {
        // Too far behind to animate: settle on the view, keeping the last call for the pot.
        const win = [...list].reverse().find((e) => e.type === 'win');
        animating = false;
        draw(next);
        if (win && win.type === 'win') kit.say(winCall(win, next), 2600);
        return;
      }
      speed = behind > 1_200 ? 3 : behind > 450 ? 1.8 : 1;
      try {
        for (const e of list) await play(e, next);
      } finally {
        speed = 1;
        animating = false;
      }
      draw(next);
    },
    onSeat(msg) {
      const before = status;
      status = msg.status;
      if (msg.seat !== null) mySeat = msg.seat;
      if (status === 'seated') wasSeated = true;
      if (before !== status) drawSeatPanel();
    },
    onError() {
      // A refused move: show the choices again from the newest view.
      if (latest) drawBar(latest);
    },
    keydown(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (e.key === 'h' || e.key === 'H') {
        hist.classList.toggle('he-open');
        return true;
      }
      return bar.key(e);
    },
    update() {
      tickTimers();
    },
    dispose() {
      chairsBack();
      offTips();
      clearTip();
      for (const stop of glows.splice(0)) stop();
      for (const o of seats) {
        clearCards(o);
        o.bet.removeFromParent();
        o.label.removeFromParent();
        o.plate.remove();
        o.betLabel.removeFromParent();
        o.betTag.remove();
      }
      for (const c of board) c.removeFromParent();
      for (const p of pots) {
        p.stack.removeFromParent();
        p.label.removeFromParent();
        p.label.element.remove();
      }
      for (const t of temps) t.removeFromParent();
      potLabel.removeFromParent();
      potLabelEl.remove();
      button.removeFromParent();
      felt?.mesh.removeFromParent();
      bar.root.remove();
      hist.remove();
      seatPanel.remove();
    },
  };
}
