// Bingo in the hall. Cards go on sale on the hall's clock (alone: when you're ready, and Call
// starts the game); "Eyes down"; then the caller draws a ball every couple of seconds: it tumbles
// up out of the dome, along the chute into the cradle, lights on the flashboard, and the caller
// calls it. Your cards daub themselves (or wait for you, with auto daub off), and every prize the
// server pays rings its pattern on the card. The server has decided everything; the view only
// shows each ball as it is told it.

import * as THREE from 'three';
import type { TableView, TableViewCtx, TableSnapshot, MembersMsg } from '../contract.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import type { Member } from '../../../../shared/src/protocol.ts';
import { formatMoney, type BetLimits, type Cents } from '../../../../shared/src/money.ts';
import { LETTERS, PATTERNS, PATTERN_NAMES, LAST_PRIZE, MAX_CALLS, PUBLISHED_RTP, callLine, columnOf, type Pattern } from '../../../../shared/src/games/bingo/rules.ts';
import { maxStake } from '../../../../shared/src/games/bingo/engine.ts';
import { MAX_CARDS, type BingoView, type CardView, type SeatResult } from '../../../../shared/src/games/bingo/protocol.ts';
import { el, button, maxButton } from '../../ui/kit.ts';
import { serverNow } from '../../net/clock.ts';
import { celebrate } from '../../table/celebrate.ts';
import { tween, ease } from '../../table/tween.ts';
import { CardEl } from './cards.ts';
import { COLUMN_COLOURS, paintBoard, paintBallFace, multText, nowPays, type BoardState } from './art.ts';
import { hallModel, chutePath, domeRest, HALL, DOME_COUNT, DOME_Y, BALL_R, type HallHandle } from './model.ts';
import { BLOWER, BOARD } from './layout.ts';
import { BingoVoice } from './voice.ts';
import { calm } from '../../app/comfort.ts';

const AUTO_KEY = 'casino.bingo.autodaub';
const RISE_MS = 650;

function stored(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function keep(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* private mode */
  }
}

function ballChip(n: number, big = false): HTMLElement {
  const c = el('div', `bg-ball c${columnOf(n)}${big ? ' big' : ''}`);
  c.append(el('span', 'l', LETTERS[columnOf(n)]!), el('span', 'n', String(n)));
  return c;
}

export function mountBingo(ctx: TableViewCtx): TableView {
  const stage = ctx.stage;
  let own: THREE.Object3D | null = null;
  let hall = stage.anchor.getObjectByName(HALL);
  if (!hall?.userData.bingo) {
    own = hallModel(stage.engine.quality);
    stage.root.add(own);
    hall = own;
  }
  const handle = hall.userData.bingo as HallHandle;
  // the flashboard is what must stay in view (table/fit.ts); the cards are controls over it
  stage.board(...[-1, 1].flatMap((sx) => [-1, 1].map((sy) => new THREE.Vector3((sx * BOARD.w) / 2, BOARD.y + (sy * BOARD.h) / 2, BOARD.z))));
  const voice = new BingoVoice(ctx.sfx);
  let disposed = false;

  // --- the flashboard, ours while we play
  const sharedBoard = handle.board.material;
  const boardCanvas = document.createElement('canvas');
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  boardTex.anisotropy = 4;
  const boardMat = new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false });
  handle.board.material = boardMat;
  const faceCanvas = document.createElement('canvas');
  const faceTex = new THREE.CanvasTexture(faceCanvas);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  const sharedFace = handle.cradleFace.material;
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true });
  handle.cradleFace.material = faceMat;
  const cradleMat = handle.cradle.material as THREE.MeshStandardMaterial;

  // a ball rising up the chute
  const riser = new THREE.Mesh(handle.domeBalls.geometry, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.25 }));
  riser.visible = false;
  stage.root.add(riser);
  const chute = chutePath();

  // --- state
  let mode: 'solo' | 'multi' = 'solo';
  let mySeat: number | null = null;
  let view: BingoView | null = null;
  let members: Member[] = [];
  let stack: Cents = 0;
  let limits: BetLimits | null = null;
  let price: Cents = 0;
  let count = 2;
  let auto = stored(AUTO_KEY, true);
  let called: number[] = [];
  let flashUntil = 0;
  const cards = new Map<number, CardEl>();
  let tipShown = false;
  let gen = 0;

  // --- DOM
  const calls = el('div', 'bg-calls panel');
  const callsHead = el('div', 'bg-calls-head');
  const current = el('div', 'bg-current');
  const count$ = el('div', 'bg-count');
  callsHead.append(current, count$);
  const recent = el('div', 'bg-recent');
  const paysNow = el('div', 'bg-paysnow');
  const autoBtn = button('', () => setAuto(!auto), { cls: 'bg-toggle', title: 'Auto daub: your cards mark themselves (D daubs everything called)' });
  const voiceBtn = button('', () => setVoice(!voice.on), { cls: 'bg-toggle', title: "The caller's voice" });
  const toggles = el('div', 'bg-toggles');
  toggles.append(autoBtn, voiceBtn);
  calls.append(callsHead, recent, paysNow, toggles);

  const hallList = el('div', 'bg-hall panel');

  const buy = el('div', 'bg-buy panel');
  const saleLine = el('div', 'bg-sale');
  const saleLabel = el('span', 'bg-sale-label');
  const saleClock = el('span', 'bg-sale-clock');
  saleLine.append(saleLabel, saleClock);
  const countSeg = el('div', 'bg-seg');
  const countBtns = Array.from({ length: MAX_CARDS }, (_, i) => {
    const b = button(String(i + 1), () => setCount(i + 1), { cls: 'bg-seg-btn', title: `${i + 1} card${i ? 's' : ''} (${i + 1})` });
    countSeg.append(b);
    return b;
  });
  const priceRow = el('div', 'bg-price');
  const less = button('−', () => stepPrice(-1), { cls: 'bg-step', title: 'Cheaper cards ([)' });
  const priceValue = el('div', 'bg-price-value money');
  const more = button('+', () => stepPrice(1), { cls: 'bg-step', title: 'Dearer cards (])' });
  const maxBtn = maxButton(() => buyMax(), 'Max: the cards at the table maximum each, or your chips shared between them if that is less (A)');
  priceRow.append(less, priceValue, more, maxBtn);
  const buyBtn = button('Buy', () => buyCards(), { cls: 'primary bg-buy-btn', key: 'Enter' });
  const rebuyBtn = button('Rebuy', () => act({ type: 'rebuy' }), { key: 'R', title: "Last game's cards again" });
  const returnBtn = button('Return', () => act({ type: 'return' }), { key: '⌫', title: 'Hand your cards back before eyes down' });
  const callBtn = button('Call', () => act({ type: 'call' }), { cls: 'primary', key: 'Space', title: 'Eyes down now' });
  const buyActs = el('div', 'bg-buy-acts');
  buyActs.append(buyBtn, rebuyBtn, returnBtn, callBtn);
  const total = el('div', 'bg-total');
  const group = (label: string, body: HTMLElement) => {
    const g = el('div', 'bg-group');
    g.append(el('div', 'label', label), body);
    return g;
  };
  buy.append(saleLine, group('Cards', countSeg), group('Each', priceRow), total, buyActs);

  const cardsRow = el('div', 'bg-cards');
  const results = el('div', 'bg-results panel');
  results.hidden = true;
  ctx.ui.append(calls, hallList, cardsRow, buy, results);

  // --- controls

  const myCards = () => [...cards.values()];
  const selling = () => view?.phase === 'buying';
  const mine = () => (mySeat !== null ? view?.players[mySeat] : undefined);

  function act(a: unknown): void {
    if (mySeat === null) return;
    ctx.link.act(a);
  }

  function setAuto(on: boolean): void {
    auto = on;
    keep(AUTO_KEY, on);
    const set = new Set(called);
    for (const c of myCards()) c.mark(set, auto);
    refresh();
  }

  function setVoice(on: boolean): void {
    voice.setOn(on);
    refresh();
  }

  function setCount(n: number): void {
    const room = MAX_CARDS - cards.size;
    count = Math.max(1, Math.min(room || MAX_CARDS, n));
    refresh();
  }

  function ladder(): Cents[] {
    if (!limits) return [];
    const out: Cents[] = [];
    for (let d = 100; d <= limits.max; d *= 10) for (const k of [1, 2, 5]) if (d * k >= limits.min && d * k <= limits.max) out.push(d * k);
    if (!out.includes(limits.min)) out.unshift(limits.min);
    if (!out.includes(limits.max)) out.push(limits.max);
    return out.sort((a, b) => a - b);
  }

  function stepPrice(dir: number): void {
    const l = ladder();
    const i = dir > 0 ? l.findIndex((x) => x > price) : l.length - 1 - [...l].reverse().findIndex((x) => x < price);
    if (i < 0 || i >= l.length) return;
    price = l[i]!;
    refresh();
  }

  function buyCards(): void {
    if (!selling() || !limits) return;
    const room = MAX_CARDS - cards.size;
    if (room <= 0) return;
    const n = Math.min(count, room);
    if (price * n > stack) {
      ctx.kit.toast(`${n} card${n > 1 ? 's' : ''} at ${formatMoney(price)} is more than your chips here.`, 'err');
      return;
    }
    act({ type: 'buy', count: n, stake: price });
    ctx.sfx.play('card-deal', { volume: 0.6 });
  }

  function buyMax(): void {
    if (!selling() || !limits) return;
    const room = MAX_CARDS - cards.size;
    if (room <= 0) return;
    const n = Math.min(count, room);
    const m = maxStake(limits, stack, n);
    if ('none' in m) {
      ctx.kit.toast(`Cards start at ${formatMoney(limits.min)}.`, 'err');
      return;
    }
    price = m.stake;
    act({ type: 'max', count: n });
    ctx.sfx.play('card-deal', { volume: 0.6 });
  }

  function onDaub(card: CardEl, n: number): void {
    if (!called.includes(n) || card.isDaubed(n)) return;
    card.daub(n);
    ctx.sfx.play('chip-lay', { volume: 0.35, rate: 1.4 });
  }

  function daubAll(): void {
    const set = new Set(called);
    for (const c of myCards()) for (const n of set) if (c.has(n) && !c.isDaubed(n)) c.daub(n);
  }

  // --- drawing

  function openPatterns(): Pattern[] {
    const n = called.length;
    return PATTERNS.filter((p) => (view?.phase === 'calling' || view?.phase === 'buying' ? n < LAST_PRIZE[p] : false));
  }

  function refresh(): void {
    const v = view;
    const sale = selling();
    const have = cards.size;
    const room = MAX_CARDS - have;
    buy.hidden = !sale || mySeat === null;
    countBtns.forEach((b, i) => {
      b.setAttribute('aria-pressed', String(i + 1 === Math.min(count, Math.max(1, room))));
      b.disabled = i + 1 > room;
    });
    priceValue.textContent = formatMoney(price);
    less.disabled = !limits || price <= limits.min;
    more.disabled = !limits || price >= limits.max;
    const n = Math.min(count, Math.max(room, 0));
    total.textContent = have ? `${have} card${have > 1 ? 's' : ''} · ${formatMoney(mine()?.staked ?? 0)} in play` : n ? `${n} × ${formatMoney(price)} = ${formatMoney(n * price)}` : '';
    buyBtn.disabled = !sale || room <= 0 || price * Math.max(1, n) > stack;
    maxBtn.disabled = !sale || room <= 0;
    rebuyBtn.disabled = !sale || have > 0 || mySeat === null || !v?.canRebuy.includes(mySeat);
    returnBtn.disabled = !sale || have === 0;
    callBtn.hidden = mode !== 'solo';
    callBtn.disabled = !sale || have === 0;
    autoBtn.textContent = auto ? 'Auto daub on' : 'Auto daub off';
    autoBtn.setAttribute('aria-pressed', String(auto));
    voiceBtn.textContent = voice.on ? 'Caller on' : 'Caller off';
    voiceBtn.setAttribute('aria-pressed', String(voice.on));
    drawCalls();
    drawHall();
    const set = new Set(called);
    const open = openPatterns();
    for (const c of myCards()) c.setNeed(set, open);
    tips();
  }

  function tips(): void {
    const on = ctx.tips.on && selling();
    if (on && !tipShown) ctx.kit.tip(`Every card returns ${Number(PUBLISHED_RTP).toFixed(2)}% of its price whatever you buy or however many are playing: prizes are fixed by pattern and ball.`);
    else if (!on && tipShown) ctx.kit.tip(null);
    tipShown = on;
  }
  const offTips = ctx.tips.subscribe(() => tips());

  function drawCalls(): void {
    const last = called.at(-1);
    current.replaceChildren(last !== undefined ? ballChip(last, true) : el('div', 'bg-ball empty big', ''));
    const phase = view?.phase ?? 'idle';
    count$.replaceChildren(
      el('div', 'bg-count-n', String(called.length)),
      el('div', 'label', phase === 'buying' ? 'Cards on sale' : phase === 'results' ? `Game over · ${called.length} balls` : phase === 'calling' ? `of ${MAX_CALLS} at most` : 'Waiting'),
    );
    recent.replaceChildren(...called.slice(-9, -1).reverse().map((n) => ballChip(n)));
    const call = phase === 'calling' ? called.length + 1 : 1;
    paysNow.replaceChildren(
      ...PATTERNS.map((p) => {
        const at = phase === 'results' ? null : nowPays(p, call);
        const r = el('div', `bg-pays-row${at ? '' : ' closed'}`);
        r.append(el('span', '', PATTERN_NAMES[p]), el('span', 'money', at ? `${multText(at.mult)} to ball ${at.upTo}` : 'closed'));
        return r;
      }),
    );
  }

  function drawHall(): void {
    hallList.hidden = mode !== 'multi';
    if (mode !== 'multi') return;
    const v = view;
    const rows = members
      .filter((m) => m.seat !== null && m.status !== 'watching')
      .map((m) => ({ m, p: v?.players[m.seat!], r: v?.results[m.seat!] }))
      .sort((a, b) => (a.p?.best ?? 99) - (b.p?.best ?? 99) || (b.p?.won ?? 0) - (a.p?.won ?? 0));
    const head = el('div', 'bg-hall-head');
    head.append(el('span', '', 'In the hall'), el('span', 'label', `${rows.length} playing · ${rows.reduce((n, x) => n + (x.p?.cards ?? 0), 0)} cards`));
    hallList.replaceChildren(
      head,
      ...rows.slice(0, 12).map(({ m, p, r }) => {
        const row = el('div', `bg-hall-row${m.seat === mySeat ? ' you' : ''}${m.connected ? '' : ' away'}`);
        const net = v?.phase === 'results' && r ? r.returned - r.wagered : null;
        const status = p ? (p.best === 1 && v?.phase === 'calling' ? '1 to go' : p.won > 0 ? `+${formatMoney(p.won)}` : `${p.cards} card${p.cards > 1 ? 's' : ''}`) : net !== null ? formatMoney(net, { sign: true }) : '';
        row.append(el('span', 'name', m.seat === mySeat ? 'You' : m.name), el('span', `st${p?.best === 1 && v?.phase === 'calling' ? ' hot' : ''}`, status));
        return row;
      }),
    );
  }

  let boardKey = '';
  function drawBoard(now: number): void {
    const v = view;
    const phase: BoardState['phase'] = !v || v.phase === 'idle' ? 'idle' : v.phase === 'buying' ? 'sale' : v.phase === 'results' ? 'over' : 'calling';
    const seconds = v?.phase === 'buying' && v.deadline !== null ? Math.max(0, Math.ceil((v.deadline - serverNow()) / 1000)) : undefined;
    // the newest number blinks as it lights (holds steady with flashing turned down)
    const flash = now < flashUntil && (calm() || Math.floor(now / 160) % 2 === 0);
    cardsRow.classList.toggle('calm', calm());
    const key = `${called.length}:${phase}:${seconds}:${flash}`;
    if (key === boardKey) return;
    boardKey = key;
    paintBoard(boardCanvas, { called, phase, seconds, flash });
    boardTex.needsUpdate = true;
    saleLabel.textContent = mode === 'solo' ? (cards.size ? 'Eyes down in' : 'Buy cards, then Call') : 'Eyes down in';
    saleClock.textContent = seconds !== undefined ? String(seconds) : '';
  }

  function showCradle(n: number | null): void {
    handle.cradle.visible = n !== null;
    if (n === null) return;
    cradleMat.color.set(COLUMN_COLOURS[columnOf(n)]!);
    paintBallFace(faceCanvas, n);
    faceTex.needsUpdate = true;
  }

  function setCards(list: CardView[]): void {
    for (const c of cards.values()) c.root.remove();
    cards.clear();
    for (const card of list) addCard(card);
  }

  function addCard(card: CardView): void {
    if (cards.has(card.id)) return;
    const c = new CardEl(structuredClone(card), onDaub);
    cards.set(card.id, c);
    cardsRow.append(c.root);
    c.mark(new Set(called), auto);
    cardsRow.dataset.n = String(cards.size);
  }

  function showResults(seats: Record<number, SeatResult>): void {
    const mineR = mySeat !== null ? seats[mySeat] : undefined;
    if (!mineR) {
      results.hidden = true;
      return;
    }
    const net = mineR.returned - mineR.wagered;
    results.replaceChildren(
      el('div', 'label', `Game over · ${called.length} balls`),
      el('div', `bg-results-net ${net > 0 ? 'win' : 'quiet'}`, mineR.returned > 0 ? `Paid ${formatMoney(mineR.returned)}` : 'No prizes this time'),
      el('div', 'bg-results-sub', `${formatMoney(mineR.wagered)} in cards · ${net >= 0 ? '+' : '−'}${formatMoney(Math.abs(net))}`),
    );
    results.hidden = false;
  }

  // --- the blower

  const m4 = new THREE.Matrix4();
  const v3 = new THREE.Vector3();
  function tumble(now: number): void {
    const running = view?.phase === 'calling';
    const t = now / 1000;
    for (let i = 0; i < DOME_COUNT; i++) {
      const rest = domeRest(i);
      if (running) {
        // the air lifts them: each ball on its own loop inside the dome
        const a = t * (2.2 + (i % 7) * 0.31) + i;
        const b = t * (1.7 + (i % 5) * 0.27) + i * 1.3;
        const rr = (BLOWER.r - BALL_R * 1.3) * (0.35 + 0.6 * Math.abs(Math.sin(a * 0.7)));
        v3.set(BLOWER.x + Math.cos(a) * rr * Math.cos(b), DOME_Y + Math.sin(b) * rr * 0.9, BLOWER.z + Math.sin(a) * rr * Math.cos(b));
      } else {
        v3.copy(rest);
      }
      handle.domeBalls.setMatrixAt(i, m4.makeTranslation(v3));
    }
    handle.domeBalls.instanceMatrix.needsUpdate = true;
  }

  /** A ball out of the dome, up the chute and into the cradle. */
  async function rise(n: number): Promise<void> {
    const g = gen;
    (riser.material as THREE.MeshStandardMaterial).color.set(COLUMN_COLOURS[columnOf(n)]!);
    riser.visible = true;
    riser.scale.setScalar(1.4);
    // the caller, when the hall has one, reaches for the ball
    stage.gesture('deal');
    ctx.sfx.play('dice-shake', { volume: 0.25, rate: 1.6 });
    await tween(RISE_MS, (k) => riser.position.copy(chute.getPoint(k)), ease.inOut);
    riser.visible = false;
    if (disposed || g !== gen) return;
    showCradle(n);
  }

  // --- events

  function applyBall(n: number): void {
    called = [...called, n];
    flashUntil = performance.now() + 1400;
    const set = new Set(called);
    for (const c of myCards()) {
      if (!c.has(n)) continue;
      if (auto) c.daub(n);
      else c.mark(set, false);
    }
    const line = callLine(n);
    ctx.kit.say(line, 2200);
    voice.say(line);
    if (myCards().some((c) => c.has(n))) ctx.sfx.play('chip-lay', { volume: 0.4, rate: 1.3 });
    refresh();
  }

  function applyWin(e: { seat: number; card: number; pattern: Pattern; call: number; mult: number; paid: Cents }): void {
    if (e.seat !== mySeat) {
      const who = members.find((m) => m.seat === e.seat)?.name ?? 'Someone';
      if (e.mult >= 2_000) ctx.kit.toast(`${who}: ${PATTERN_NAMES[e.pattern]} on ball ${e.call}, ${multText(e.mult)}`);
      return;
    }
    const card = cards.get(e.card);
    if (!card) return;
    card.win(e.pattern, e.call, e.mult, e.paid, new Set(called));
    const shout = e.pattern === 'blackout' ? 'Bingo! Blackout' : e.pattern === 'corners' ? 'Four corners' : 'Line';
    voice.say(e.pattern === 'blackout' ? 'Bingo! Blackout!' : `${shout}!`);
    // a return at or under the card's price is paid quietly: only a real win gets the moment
    if (e.mult > 100) {
      celebrate(
        { stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx },
        { title: shout, sub: `Ball ${e.call} · ${multText(e.mult)} · ${formatMoney(e.paid)}`, tier: e.mult >= 100_000 ? 'huge' : e.mult >= 1_000 ? 'big' : 'nice' },
      );
    } else {
      ctx.sfx.play('chips-stack', { volume: 0.5 });
    }
  }

  function snapshot(v: BingoView): void {
    view = v;
    called = [...v.called];
    setCards(v.mine ?? []);
    showCradle(called.at(-1) ?? null);
    results.hidden = true;
    if (v.phase === 'results') showResults(v.results);
    refresh();
  }

  if (!price) price = 100;
  refresh();

  const tableView: TableView & { debug: unknown } = {
    onTable(snap: TableSnapshot) {
      gen++;
      mode = snap.meta.mode;
      mySeat = snap.you.seat;
      stack = snap.you.stack;
      members = snap.members;
      limits = snap.meta.config.limits.default;
      price = Math.max(limits.min, Math.min(limits.max, price || limits.min));
      snapshot(snap.view as BingoView);
    },

    async onEvents(events: GameEvent[], v: unknown) {
      const next = v as BingoView;
      const g = gen;
      for (const e of events) {
        if (disposed || g !== gen) return;
        switch (e.type) {
          case 'buying':
            if (view?.phase !== 'buying') {
              called = [];
              setCards([]);
              results.hidden = true;
              showCradle(null);
              ctx.kit.say(mode === 'solo' ? 'Cards on sale. Buy up to four, then Call' : 'Cards on sale for the next game', 2600);
            }
            view = { ...next, called: [] };
            break;
          case 'cards':
            if (e.seat === mySeat) for (const c of e.cards as CardView[]) addCard(c);
            break;
          case 'returned':
            if (e.seat === mySeat) setCards([]);
            break;
          case 'eyesdown':
            view = { ...(view ?? next), phase: 'calling' };
            ctx.kit.say('Eyes down', 2000);
            voice.say('Eyes down');
            ctx.sfx.play('card-shuffle', { volume: 0.4 });
            break;
          case 'ball':
            await rise(e.ball as number);
            if (disposed || g !== gen) return;
            applyBall(e.ball as number);
            break;
          case 'win':
            applyWin(e as unknown as Parameters<typeof applyWin>[0]);
            break;
          case 'end':
            view = { ...next };
            showResults(e.seats as Record<number, SeatResult>);
            ctx.kit.say(`That's the game: ${e.calls} balls`, 3000);
            break;
        }
        refresh();
      }
      if (disposed || g !== gen) return;
      // settle on the server's view, keeping the balls we have shown
      view = next;
      if (next.called.length >= called.length) called = [...next.called];
      if (next.mine) for (const c of next.mine) addCard(c);
      refresh();
    },

    onSeat(msg) {
      if (msg.seat !== null) mySeat = msg.seat;
      stack = msg.stack;
      refresh();
    },

    onMembers(msg: MembersMsg) {
      members = msg.members;
      refresh();
    },

    keydown(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (selling()) {
        const n = Number(e.key);
        if (n >= 1 && n <= MAX_CARDS) {
          setCount(n);
          return true;
        }
        if (e.key === 'Enter') {
          buyCards();
          return true;
        }
        if (e.code === 'Space' && mode === 'solo') {
          act({ type: 'call' });
          return true;
        }
        if (e.key === '[' || e.key === ']') {
          stepPrice(e.key === ']' ? 1 : -1);
          return true;
        }
        if ((e.key === 'a' || e.key === 'A') && !e.shiftKey) {
          buyMax();
          return true;
        }
        if (e.key === 'r' || e.key === 'R') {
          act({ type: 'rebuy' });
          return true;
        }
        if (e.key === 'Backspace') {
          act({ type: 'return' });
          return true;
        }
      }
      if (e.key === 'd' || e.key === 'D') {
        daubAll();
        return true;
      }
      return false;
    },

    update() {
      if (disposed) return;
      const now = performance.now();
      tumble(now);
      drawBoard(now);
    },

    dispose() {
      disposed = true;
      gen++;
      offTips();
      if (tipShown) ctx.kit.tip(null);
      voice.dispose();
      for (const n of [calls, hallList, cardsRow, buy, results]) n.remove();
      riser.removeFromParent();
      (riser.material as THREE.Material).dispose();
      handle.board.material = sharedBoard;
      handle.cradleFace.material = sharedFace;
      handle.cradle.visible = false;
      boardMat.dispose();
      boardTex.dispose();
      faceMat.dispose();
      faceTex.dispose();
      for (let i = 0; i < DOME_COUNT; i++) handle.domeBalls.setMatrixAt(i, m4.makeTranslation(domeRest(i)));
      handle.domeBalls.instanceMatrix.needsUpdate = true;
      own?.removeFromParent();
    },

    debug: {
      state: () => ({
        mode,
        mySeat,
        phase: view?.phase,
        round: view?.round,
        called: [...called],
        stack,
        cards: myCards().map((c) => ({ id: c.card.id, nums: c.card.nums, stake: c.card.stake, won: c.card.won })),
        left: view?.phase === 'buying' && view.deadline !== null ? view.deadline - serverNow() : null,
      }),
    },
  };
  return tableView;
}
