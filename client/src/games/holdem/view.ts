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
import { CardMesh, dealCard, flipCard, CARD_W } from '../../table/cards.ts';
import { ChipStack, slideStack } from '../../table/chips.ts';
import { tween, wait, ease } from '../../table/tween.ts';
import { el } from '../../ui/kit.ts';
import { serverNow } from '../../net/clock.ts';
import { session } from '../../app/session.ts';
import { ActionBar } from './actionbar.ts';
import { holdemFelt, dealerButton, slotPoint, slotEdge, slotYaw, boardPoint, DEALER_POINT, TOP_Y } from './table.ts';
import './holdem.css';

const SVG = 'http://www.w3.org/2000/svg';
const RING_R = 21;
const RING_C = 2 * Math.PI * RING_R;
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

  const button = dealerButton();
  button.visible = false;
  stage.root.add(button);

  const potLabelEl = el('div', 'he-pot', '');
  const potLabel = stage.label(potLabelEl, new THREE.Vector3(0, TOP_Y + 0.01, 0.2));
  potLabelEl.hidden = true;

  const bar = new ActionBar(
    (a) => {
      link.act(a);
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
    // The app shell owns leaving a table (the back chip); tell it the player asked to.
    dispatchEvent(new CustomEvent('casino:leave-table'));
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
      const p = slotPoint(0, n, 0.2, TOP_Y + 0.03);
      p.x += (i - 0.5) * (CARD_W + 0.008);
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
    return { plate, label, avatar, ring, name, tag, stack, status, cards: [], bet, betTag, betLabel };
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

  function clearCards(o: SeatObj): void {
    for (const c of o.cards) c.removeFromParent();
    o.cards = [];
  }

  function placeCard(card: Card | null, k: number, i: number): CardMesh {
    const m = new CardMesh(card);
    const at = cardAt(k, i);
    m.position.copy(at.pos);
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
    o.stack.textContent = sv.allIn && sv.stack === 0 ? 'All-in' : money(sv.stack);
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

  function draw(view: HoldemView): void {
    v = view;
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
    potLabel.position.set(0, TOP_Y + 0.012, -0.1);

    if (view.button !== null && view.seats[view.button]) {
      button.visible = true;
      button.position.copy(buttonAt(slot(view.button)));
    } else button.visible = view.button !== null;

    // Showdown: the cards that play stay bright, the rest dim.
    const best = new Set<string>();
    if (view.phase === 'results') for (const sv of view.seats) if (sv && sv.won > 0 && sv.best) sv.best.forEach((c) => best.add(c));
    if (best.size) {
      for (const m of board) dim(m, !best.has(m.card!));
      for (const o of seats) for (const m of o.cards) if (m.card) dim(m, !best.has(m.card));
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
    else if (legal) note = '';
    else if (view.phase === 'waiting') note = view.mode === 'multi' ? 'Waiting for players' : 'Next hand shortly';
    else if (view.turn) note = `${view.seats[view.turn.seat]?.name ?? 'Next player'} to act`;
    else if (view.phase === 'runout') note = 'All-in: running the board out';
    else if (view.phase === 'results') note = 'Next hand shortly';
    bar.root.hidden = !you;
    bar.set(legal, { total: view.total, note, sittingOut: !!you?.sittingOut });
  }

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
    for (const h of view.history) section(`Hand #${h.id}${h.board.length ? ` · ${h.board.join(' ')}` : ''}`, h.lines);
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
    await slideStack(s, to, ms);
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
        await tween(260, (t) => {
          m.position.lerpVectors(from, to, t);
          m.rotation.x = m.rotation.x > 1 ? Math.PI : m.rotation.x * (1 - t) + Math.PI * t;
        }, ease.inOut);
        m.removeFromParent();
      }),
    );
  }

  async function play(e: HoldemEvent, next: HoldemView): Promise<void> {
    switch (e.type) {
      case 'hand': {
        put = {};
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
          await tween(420, (t) => button.position.lerpVectors(from, to, t), ease.inOut);
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
        await slideChips(e.amount, railAt(k), betAt(k), 260);
        seats[e.seat]?.bet.set(e.amount);
        sfx.play('chip-lay', { volume: 0.7 });
        break;
      }
      case 'deal': {
        sfx.play('card-deal');
        let last: Promise<void> = Promise.resolve();
        for (let round = 0; round < 2; round++) {
          for (const seat of e.order) {
            const o = seats[seat];
            if (!o) continue;
            const k = slot(seat);
            const at = cardAt(k, round);
            const m = new CardMesh(null);
            m.rotation.set(Math.PI, 0, 0, 'YXZ');
            stage.root.add(m);
            o.cards.push(m);
            last = dealCard(m, DEALER_POINT, at.pos, { faceUp: false, ms: 240, yaw: at.yaw });
            if (round === 0 && seat === e.order[0]) sfx.play('card-deal', { volume: 0.5 });
            await wait(70);
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
              await tween(260, (t) => {
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
          o.status.textContent = e.move === 'call' ? `Call ${money(e.added)}` : e.move === 'bet' || e.move === 'raise' ? `${MOVE_LABEL[e.move]} ${money(e.to)}` : MOVE_LABEL[e.move]!;
          o.status.dataset.kind = e.move;
          o.plate.classList.remove('he-turn');
        }
        if (e.added > 0) {
          put[e.seat] = (put[e.seat] ?? 0) + e.added;
          await slideChips(e.added, railAt(k), betAt(k), 280);
          o?.bet.set(e.to);
          if (o) {
            o.betTag.hidden = false;
            o.betTag.textContent = money(e.to);
          }
          sfx.play(e.move === 'allin' ? 'chips-stack' : 'chip-lay');
        } else if (e.move === 'check') sfx.play('chips-handle', { volume: 0.35 });
        if (e.move === 'fold' && o) {
          sfx.play('card-place', { volume: 0.6 });
          o.plate.classList.add('he-folded');
          await muck(o);
        }
        if (e.auto === 'timeout') kit.say(`${nameOf(e.seat, next)} ran out of time`, 2000);
        await wait(e.move === 'check' ? 180 : 120);
        break;
      }
      case 'collect': {
        const moving = seats
          .map((o, seat) => ({ o, seat }))
          .filter(({ o }) => o.bet.amount > 0);
        if (moving.length) {
          sfx.play('chips-collide', { volume: 0.7 });
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
        kit.say(`Uncalled bet of ${money(e.amount)} returned to ${nameOf(e.seat, next)}`, 2400);
        await slideChips(e.amount, betAt(k), railAt(k), 300);
        break;
      }
      case 'board': {
        const start = board.length;
        const cards = e.cards.map((code, i) => {
          const m = new CardMesh(null);
          m.rotation.set(Math.PI, 0, 0);
          stage.root.add(m);
          board.push(m);
          return { m, code, i };
        });
        sfx.play('card-deal');
        await Promise.all(
          cards.map(async ({ m, i }) => {
            await wait(i * 110);
            await dealCard(m, DEALER_POINT, boardPoint(start + i), { faceUp: false, ms: 260 });
          }),
        );
        for (const { m, code } of cards) m.setCard(code);
        sfx.play('card-flip');
        await Promise.all(cards.map(async ({ m, i }) => {
          await wait(i * 70);
          await flipCard(m, true, 220);
        }));
        await wait(160);
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
            await tween(300, (t) => {
              m.rotation.x = x0 + (x1 - x0) * t;
              m.rotation.y = yaw0 * (1 - t);
              m.position.y = y0 + Math.sin(Math.PI * t) * 0.03;
            }, ease.inOut);
            m.position.y = y0;
          }),
        );
        o.status.hidden = false;
        o.status.dataset.kind = 'show';
        o.status.textContent = e.hand ?? 'Shows';
        kit.say(`${nameOf(e.seat, next)} shows ${e.hand ?? e.cards.join(' ')}`, 2600);
        await wait(480);
        break;
      }
      case 'muck': {
        const o = seats[e.seat];
        kit.say(`${nameOf(e.seat, next)} mucks`, 1800);
        if (o) await muck(o);
        break;
      }
      case 'win': {
        const each = e.winners.length > 1;
        const lead = e.winners[0]!;
        const text = each
          ? `Split ${e.label}: ${money(lead.amount)} each${e.hand ? ` · ${e.hand}` : ''}`
          : e.pot > 0
            ? `${e.label[0]!.toUpperCase()}${e.label.slice(1)}: ${money(e.amount)} to ${nameOf(lead.seat, next)}${e.hand ? ` · ${e.hand}` : ''}`
            : `${nameOf(lead.seat, next)} wins ${money(e.amount)} (${e.label})${e.hand ? ` · ${e.hand}` : ''}`;
        kit.say(text, 3200);
        const from = pots[e.pot]?.stack.position.clone() ?? potAt(0, 1);
        if (pots[e.pot]) pots[e.pot]!.stack.set(0);
        const remaining = pots.reduce((a, p) => a + p.stack.amount, 0);
        potLabelEl.hidden = remaining <= 0;
        potLabelEl.textContent = `Pot ${money(remaining)}`;
        await Promise.all(e.winners.map((w) => slideChips(w.amount, from, railAt(slot(w.seat)), 460)));
        let celebrate = false;
        for (const w of e.winners) {
          const net = w.amount - (put[w.seat] ?? 0);
          const mine = w.seat === mySeat;
          if (mine && net > 0) celebrate = true;
          const p = plateAt(slot(w.seat));
          kit.pill(stage, new THREE.Vector3(p.x, p.y + 0.06, p.z), mine && net <= 0 ? `Back ${money(w.amount)}` : `+${money(w.amount)}`, mine && net <= 0 ? 'push' : 'win', 2600);
        }
        sfx.play('chips-stack', { volume: celebrate ? 1 : 0.6 });
        await wait(520);
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
    const view = v;
    const t = view?.turn ?? null;
    let mineMs: number | null = null;
    let bank = false;
    for (let s = 0; s < seats.length; s++) {
      const o = seats[s]!;
      if (!t || t.seat !== s || view?.phase !== 'playing') {
        o.ring.style.strokeDashoffset = String(RING_C);
        o.plate.classList.remove('he-bank');
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
      o.ring.style.strokeDashoffset = String(RING_C * (1 - frac));
      o.plate.classList.toggle('he-bank', bank);
      if (s === mySeat) mineMs = Math.max(0, (bank || t.bankFrom === null ? t.deadline : t.bankFrom) - now);
    }
    bar.setClock(mineMs, bank);
  }

  return {
    onTable(snap) {
      status = snap.you.status;
      buyIn = { min: snap.meta.config.buyIn.min, max: snap.meta.config.buyIn.max };
      if (snap.you.seat !== null) mySeat = snap.you.seat;
      if (status === 'seated') wasSeated = true;
      draw(snap.view as HoldemView);
    },
    async onEvents(events: GameEvent[], view) {
      const next = view as HoldemView;
      ensureSeats(next.maxSeats);
      if (next.you) mySeat = next.you.seat;
      if ((mySeat ?? 0) !== base) {
        base = mySeat ?? 0;
        layout();
      }
      for (const e of events as unknown as HoldemEvent[]) await play(e, next);
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
      if (v) drawBar(v);
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
