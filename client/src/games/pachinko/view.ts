// Sakura Storm at play. A launch buys 25 balls; the server settles them all in the step that takes
// the bet and sends where each one went. This view fires them up the rail one after another at the
// dial's power, each on a recorded flight that ends in the pocket the server named (board.ts),
// pays the tulips and the start pocket into the tray as they drop in, spins the screen's reels for
// every start pocket ball (holding up to four spins, as real machines do), and when three of a
// kind come up, opens the attacker for the fever: ten rounds of fifteen balls, then the reels
// again on a kakuhen number, until the chain ends.
//
// The credit on the panel counts the balls home as they land, so it never tells a result before
// the machine does; the HUD's chips wait for settled().

import * as THREE from 'three';
import type { TableView, TableViewCtx, TableSnapshot } from '../contract.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import { formatMoney, type BetLimits, type Cents } from '../../../../shared/src/money.ts';
import { BATCH, POCKET_PAYS, JACKPOT_BALLS, ROUNDS, ROUND_BALLS, MAX_CHAIN, PUBLISHED_RTP, isKakuhen, ballValue } from '../../../../shared/src/games/pachinko/rules.ts';
import type { BallView, LaunchEvent, PachinkoView, MachineData } from '../../../../shared/src/games/pachinko/engine.ts';
import { el, button, maxButton } from '../../ui/kit.ts';
import { celebrate } from '../../table/celebrate.ts';
import { FlightPools, bucketOf, flightAt, flightSeconds, type Catch, type Flight, ATTACKER, OUT_V, BOARD_W, BOARD_H, HESO, TULIPS } from './board.ts';
import { paintScreen, paintData, paintLeds, LED_COUNT, type ScreenState, type LedPattern } from './art.ts';
import { machineModel, sharedLit, ballGeometry, ballMaterial, boardPoint, MACHINE, GLASS_Z, BOARD_Y, BALL_Z, type MachineHandle } from './model.ts';
import { PachinkoSound } from './sound.ts';
import { calm as reduceFlashing } from '../../app/comfort.ts';
import { isTyping } from '../../ui/keyboard.ts';

/** How often the launcher fires. */
const FIRE_MS = 300;
const POWER_KEY = 'casino.pachinko.power';
const MAX_BALLS = 64;
/** Reel timings, seconds from the spin's start. */
const STOP_L = 1.3;
const STOP_R = 1.8;
const STOP_M = 2.3;
const REACH_M = 5.4;
const SPIN_SPEED = 16;
const HIT_S = 2.6;
const ROUND_S = 0.95;
const KAKUHEN_S = 2.2;
const RESPIN_S = 2.4;
const END_S = 2.6;

const LINES = {
  idle: ['Aim for the START pocket under the screen', 'Odd numbers chain: 1, 3, 5, 7, 9', 'Three of a kind opens the attacker', 'Ten rounds of fifteen balls a jackpot'],
  spin: ['', '', 'Chance…', 'Here we go'],
  reach: ['REACH! Come on…', 'リーチ! One more…', 'Hot! 熱い!'],
  // what the screen says when a reach doesn't come in: the result, never a near miss to chase
  miss: ['No jackpot this spin', 'No jackpot', 'Spin over · no jackpot'],
};
const pickLine = (list: readonly string[]) => list[Math.floor(Math.random() * list.length)]!;

type Pocketed = 'out' | 'left' | 'right' | 'start';

interface Ball {
  flight: Flight;
  t0: number;
  shot: BallView | null;
  /** Balls this one pays when it lands (a fever ball's share of its round). */
  pays: number;
  landed: boolean;
  /** Last frame's velocity, for the nail ticks. */
  lastVu: number;
  lastVv: number;
  /** The batch a launched ball belongs to (fever balls belong to the fever). */
  batch?: Batch;
}

interface Batch {
  ev: LaunchEvent;
  next: number;
  /** Balls paid so far, of ev.balls. */
  paid: number;
  outstanding: number;
}

type ReelPlan = { shot: BallView; batch: Batch };

type Show =
  | { kind: 'idle' }
  | { kind: 'spin'; t0: number; plan: ReelPlan; reach: boolean; hit: boolean; stops: [number, number, number]; target: [number, number, number] }
  | { kind: 'hit'; t0: number; plan: ReelPlan; link: number; won: number }
  | { kind: 'fever'; t0: number; plan: ReelPlan; link: number; round: number; sent: number; won: number }
  | { kind: 'kakuhen'; t0: number; plan: ReelPlan; link: number; won: number }
  | { kind: 'respin'; t0: number; plan: ReelPlan; link: number; won: number; from: [number, number, number] }
  | { kind: 'end'; t0: number; plan: ReelPlan; won: number };

function findMachine(ctx: TableViewCtx): { root: THREE.Object3D; owned: boolean } {
  const found = ctx.stage.anchor.getObjectByName(MACHINE);
  if (found?.userData.pachinko) return { root: found, owned: false };
  const root = machineModel(ctx.stage.engine.quality);
  ctx.stage.root.add(root);
  return { root, owned: true };
}

function storedPower(): number {
  try {
    const raw = localStorage.getItem(POWER_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : 35;
  } catch {
    return 35;
  }
}

/** Reel position at time t for a reel that stops on `target` at `ts` (digits scroll at `speed`). */
function reelPos(t: number, ts: number, target: number, speed: number): number {
  const x = ts - t;
  if (x <= 0) {
    // a small settle after the stop
    const k = -x;
    return target + (k < 0.2 ? 0.12 * Math.sin(k * 30) * (1 - k / 0.2) : 0);
  }
  const brake = 0.35;
  const f = x < brake ? (speed * x * x) / (2 * brake) : speed * (x - brake / 2);
  return target - f;
}

export function mountPachinko(ctx: TableViewCtx): TableView {
  const { root, owned } = findMachine(ctx);
  const handle = root.userData.pachinko as MachineHandle;
  // the board behind the glass is what must stay in view (table/fit.ts)
  ctx.stage.board(...[0, BOARD_H].flatMap((v) => [-BOARD_W / 2, BOARD_W / 2].map((u) => boardPoint(u, v, GLASS_Z))));
  const sound = new PachinkoSound(ctx.sfx);
  const pools = new FlightPools((Date.now() & 0xffff) + 1);
  let disposed = false;

  // --- the machine's lit parts, our own while we play
  const lit = sharedLit();
  const lcdCanvas = document.createElement('canvas');
  const lcdTex = new THREE.CanvasTexture(lcdCanvas);
  lcdTex.colorSpace = THREE.SRGBColorSpace;
  const lcdMat = new THREE.MeshBasicMaterial({ map: lcdTex, toneMapped: false });
  handle.lcd.material = lcdMat;
  const dataCanvas = document.createElement('canvas');
  const dataTex = new THREE.CanvasTexture(dataCanvas);
  dataTex.colorSpace = THREE.SRGBColorSpace;
  const dataMat = new THREE.MeshBasicMaterial({ map: dataTex, toneMapped: false });
  handle.data.material = dataMat;
  const ledData = new Uint8Array(LED_COUNT * 4);
  const ledTex = new THREE.DataTexture(ledData, LED_COUNT, 1);
  ledTex.colorSpace = THREE.SRGBColorSpace;
  ledTex.wrapS = THREE.RepeatWrapping;
  const ledMat = new THREE.MeshBasicMaterial({ map: ledTex, toneMapped: false });
  ledMat.color.setScalar(1.8);
  handle.leds.material = ledMat;

  // --- the balls in flight
  const balls = new THREE.InstancedMesh(ballGeometry(), ballMaterial(), MAX_BALLS);
  balls.count = 0;
  balls.frustumCulled = false;
  ctx.stage.root.add(balls);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const pt = { u: 0, v: 0 };
  const prevPt = { u: 0, v: 0 };

  // --- state
  let stack: Cents = 0;
  let limits: BetLimits | null = null;
  let bet: Cents = 0;
  let power = storedPower();
  let waiting = false;
  let sentAt = 0;
  let data: MachineData = { spins: 0, jackpots: 0, best: 0, chains: [] };
  const batches: Batch[] = [];
  const flying: Ball[] = [];
  const holds: ReelPlan[] = [];
  let show: Show = { kind: 'idle' };
  let nextFire = 0;
  let line = pickLine(LINES.idle);
  let lineAt = performance.now();
  let reels: [number, number, number] = [7, 3, 7];
  let tipShown = false;
  let calm: (() => void)[] = [];
  /** Every ball fired: the pocket the server sent it to and where its flight ends (for the checks). */
  const fired: [string, string][] = [];

  // --- DOM
  const deck = el('div', 'pa-deck panel');
  const betGroup = el('div', 'pa-group');
  const betLabel = el('div', 'label', `Batch · ${BATCH} balls`);
  const betRow = el('div', 'pa-bet');
  const less = button('−', () => stepBet(-1), { cls: 'pa-step', title: 'Smaller batch ([)' });
  const betValue = el('div', 'pa-bet-value money');
  const more = button('+', () => stepBet(1), { cls: 'pa-step', title: 'Bigger batch (])' });
  const maxBtn = maxButton(() => setMax(), 'Max: the table maximum, or all your chips here if that is less (A)');
  betRow.append(less, betValue, more, maxBtn);
  const perBall = el('div', 'pa-note');
  betGroup.append(betLabel, betRow, perBall);

  const powerGroup = el('div', 'pa-group pa-power');
  const powerLabel = el('div', 'label', 'Power');
  const dial = el('input', 'pa-dial');
  dial.type = 'range';
  dial.min = '0';
  dial.max = '100';
  dial.step = '1';
  dial.title = 'The handle: how hard the balls are shot (← →). It changes where they fly, not what they win.';
  dial.setAttribute('aria-label', 'Power');
  const powerValue = el('div', 'pa-power-value');
  dial.addEventListener('input', () => setPower(Number(dial.value)));
  powerGroup.append(powerLabel, dial, powerValue);

  // Launch: a tap fires a batch; held (Space, a finger or the mouse on it) it keeps firing, the next
  // batch as soon as the last has left the rail, the way a real machine's handle is held
  const launchBtn = button('Launch', () => {}, { cls: 'primary pa-launch', key: 'Space', title: `Fire a batch of ${BATCH} balls (Space); hold to keep firing` });
  // a long press on a phone is a hold, not the page's menu
  launchBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  launchBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || launchBtn.disabled) return;
    e.preventDefault();
    holdPointer = e.pointerId;
    hold(true);
  });
  // Enter on the focused button: one batch (a pointer's press was its pointerdown)
  launchBtn.addEventListener('click', (e) => {
    if (e.detail === 0) launch();
  });

  const meters = el('div', 'pa-meters');
  const trayMeter = meter('Tray');
  const wonMeter = meter('Won');
  const creditMeter = meter('Credit');
  meters.append(trayMeter.root, wonMeter.root, creditMeter.root);
  // on a narrow screen the pay card isn't beside the machine: this shows it over the deck
  const paysBtn = button('Pays', () => togglePays(), { cls: 'ghost pa-pays-btn', key: 'I', title: 'The pay card and the data lamp (I)' });
  paysBtn.setAttribute('aria-expanded', 'false');
  deck.append(betGroup, el('div', 'sep'), powerGroup, el('div', 'sep'), launchBtn, el('div', 'sep'), meters, paysBtn);

  const side = el('div', 'pa-side panel');
  const sideTitle = el('div', 'pa-side-title', 'Sakura Storm');
  const pays = el('div', 'pa-pays');
  const row = (a: string, b: string) => {
    const r = el('div', 'pa-pay');
    r.append(el('span', '', a), el('span', 'money', b));
    return r;
  };
  pays.append(
    row('Start pocket', `${POCKET_PAYS.start} balls + spin`),
    row('Tulip', `${POCKET_PAYS.left} balls`),
    row('Jackpot', `${ROUNDS} × ${ROUND_BALLS} = ${JACKPOT_BALLS}`),
    row('Kakuhen', 'odd numbers chain'),
    row('Chain limit', `${MAX_CHAIN} jackpots`),
    row('Return', `${Number(PUBLISHED_RTP).toFixed(2)}%`),
  );
  const dataRows = el('div', 'pa-data');
  side.append(sideTitle, pays, dataRows);
  side.setAttribute('role', 'region');
  side.setAttribute('aria-label', 'Sakura Storm pays and data');
  ctx.ui.append(deck, side);

  /** Narrow screens: the pay card over the deck, from Pays (I); a tap elsewhere or Esc puts it away. */
  let outside: ((e: PointerEvent) => void) | null = null;
  function togglePays(): void {
    if (side.classList.contains('open')) {
      closePays();
      return;
    }
    const d = deck.getBoundingClientRect();
    side.style.bottom = `${Math.round(innerHeight - d.top + 10)}px`;
    side.classList.add('open');
    paysBtn.setAttribute('aria-expanded', 'true');
    outside = (e) => {
      const t = e.target as Node;
      if (!side.contains(t) && !paysBtn.contains(t)) closePays();
    };
    addEventListener('pointerdown', outside, true);
  }
  function closePays(): void {
    side.classList.remove('open');
    side.style.bottom = '';
    paysBtn.setAttribute('aria-expanded', 'false');
    if (outside) removeEventListener('pointerdown', outside, true);
    outside = null;
  }
  /** Whether the pay card is beside the machine (a wide screen) rather than behind Pays. */
  const besideMachine = () => getComputedStyle(paysBtn).display === 'none';

  function meter(label: string): { root: HTMLElement; set(v: string): void } {
    const r = el('div', 'pa-meter');
    const v = el('div', 'pa-meter-value money');
    r.append(el('div', 'label', label), v);
    return { root: r, set: (x: string) => void (v.textContent = x) };
  }

  // --- money and controls

  /** Balls still to be counted home, over every batch in play. */
  const unpaid = () => batches.reduce((n, b) => n + (b.ev.balls - b.paid) * ballValue(b.ev.bet), 0);
  const firing = () => batches.some((b) => b.next < b.ev.shots.length);
  const inFever = () => show.kind === 'hit' || show.kind === 'fever' || show.kind === 'kakuhen' || show.kind === 'respin';
  const busy = () => batches.length > 0 || flying.length > 0 || holds.length > 0 || show.kind !== 'idle';

  function clampBet(x: Cents): Cents {
    if (!limits) return x;
    const step = Math.max(limits.step, 100);
    let v = Math.max(limits.min, Math.min(limits.max, x));
    v -= v % step;
    return Math.max(limits.min, v);
  }

  /** The batch ladder the − and + step through: 1, 2, 5 in each decade, inside the limits. */
  function ladder(): Cents[] {
    if (!limits) return [];
    const out: Cents[] = [];
    for (let d = 100; d <= limits.max; d *= 10) for (const k of [1, 2, 5]) if (d * k >= limits.min && d * k <= limits.max) out.push(d * k);
    if (!out.includes(limits.min)) out.unshift(limits.min);
    if (!out.includes(limits.max)) out.push(limits.max);
    return out.sort((a, b) => a - b);
  }

  function stepBet(dir: number): void {
    const l = ladder();
    if (!l.length) return;
    const i = dir > 0 ? l.findIndex((x) => x > bet) : l.length - 1 - [...l].reverse().findIndex((x) => x < bet);
    if (i < 0 || i >= l.length) return;
    bet = l[i]!;
    sync();
    sound.reelTick();
  }

  function setMax(): void {
    if (!limits) return;
    bet = clampBet(Math.min(limits.max, stack));
    sync();
  }

  function setPower(p: number): void {
    power = Math.max(0, Math.min(100, Math.round(p)));
    try {
      localStorage.setItem(POWER_KEY, String(power));
    } catch {
      /* private mode */
    }
    sync();
  }

  /** Space or a pointer on Launch is down: fire now, and again each time the last batch is out. */
  let held = false;
  let holdPointer: number | null = null;
  function hold(on: boolean): void {
    if (on === held) return;
    held = on;
    launchBtn.classList.toggle('held', on);
    if (on) launch();
    sync();
  }
  /** Holding: the next batch goes once the last has left the rail (and any fever has played). */
  function keepFiring(): void {
    if (!held || !limits || waiting || firing() || inFever()) return;
    if (bet > stack) {
      // out of chips for this batch: say so once and let go
      hold(false);
      ctx.kit.say('Not enough chips here for another batch');
      return;
    }
    launch();
  }
  const lift = (e: PointerEvent) => {
    if (e.pointerId !== holdPointer) return;
    holdPointer = null;
    hold(false);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') hold(false);
  };
  const letGo = () => {
    holdPointer = null;
    hold(false);
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') letGo();
  };
  addEventListener('pointerup', lift, true);
  addEventListener('pointercancel', lift, true);
  addEventListener('keyup', onKeyUp, true);
  addEventListener('blur', letGo);
  document.addEventListener('visibilitychange', onHidden);

  function launch(): void {
    if (!limits || waiting || firing() || inFever()) return;
    if (bet > stack) {
      ctx.kit.toast('Not enough chips here for that batch.', 'err');
      return;
    }
    waiting = true;
    sentAt = performance.now();
    ctx.link.act({ type: 'launch', bet, power });
    sync();
  }

  let dataKey = '';
  function sync(): void {
    const credit = stack - unpaid();
    betValue.textContent = formatMoney(bet);
    perBall.textContent = `${formatMoney(ballValue(bet))} a ball`;
    dial.value = String(power);
    powerValue.textContent = String(power);
    const tray = batches.reduce((n, b) => n + b.ev.shots.length - b.next, 0);
    trayMeter.set(String(tray));
    const cur = batches.at(-1);
    wonMeter.set(cur ? String(cur.paid) : '0');
    creditMeter.set(formatMoney(credit));
    // held down, the button stays live between batches so letting go is always heard
    launchBtn.disabled = !held && (!limits || waiting || firing() || inFever() || bet > stack);
    less.disabled = !limits || bet <= limits.min;
    more.disabled = !limits || bet >= limits.max;
    maxBtn.disabled = !limits;
    handle.knob.rotation.z = -(power / 100) * 2.6;
    // the data lamp and its rows only when what they show changes (sync runs for every ball)
    const fever = inFever();
    const key = `${data.jackpots}|${data.spins}|${data.best}|${data.chains.join(',')}|${fever}`;
    if (key !== dataKey) {
      dataKey = key;
      dataRows.replaceChildren(
        row('大当り Jackpots', String(data.jackpots)),
        row('回転 Spins since', String(data.spins)),
        row('最高 Best chain', data.best ? `${data.best}` : '–'),
        row('Last chains', data.chains.length ? data.chains.join(' · ') : '–'),
      );
      paintData(dataCanvas, { jackpots: data.jackpots, spins: data.spins, best: data.best, fever });
      dataTex.needsUpdate = true;
    }
    tips();
  }

  function tips(): void {
    const on = ctx.tips.on;
    if (on && !tipShown) ctx.kit.tip(`Every batch returns ${Number(PUBLISHED_RTP).toFixed(2)}% at any power: the handle changes where the balls fly, not what they win.`);
    else if (!on && tipShown) ctx.kit.tip(null);
    tipShown = on;
  }
  const offTips = ctx.tips.subscribe(() => tips());

  // --- balls

  function fire(b: Batch, now: number): void {
    const shot = b.ev.shots[b.next++]!;
    const end: Catch = shot.pocket;
    const flight = pools.take(b.ev.power, end);
    fired.push([shot.pocket, flight.end]);
    if (fired.length > 200) fired.shift();
    flying.push({ flight, t0: now, shot, pays: POCKET_PAYS[shot.pocket as Pocketed], landed: false, lastVu: 0, lastVv: 0, batch: b });
    sound.launch();
    b.outstanding++;
  }

  function feverBall(now: number, share: number): void {
    const flight = pools.take(95, 'attacker');
    flying.push({ flight, t0: now, shot: null, pays: share, landed: false, lastVu: 0, lastVv: 0 });
    sound.launch();
  }

  // --- "+3" over a pocket as a ball pays into it: every pay seen where it happened
  const POCKET_AT: Record<'left' | 'right' | 'start', { u: number; v: number }> = { left: TULIPS[0], right: TULIPS[1], start: HESO };
  const tags: { obj: THREE.Object3D; el: HTMLElement; until: number }[] = [];
  function payTag(pocket: 'left' | 'right' | 'start', balls: number, now: number): void {
    // a handful at once at most; the oldest goes first
    if (tags.length >= 6) dropTag(0);
    const p = POCKET_AT[pocket];
    const e = el('div', `pa-paytag${pocket === 'start' ? ' start' : ''}`, `+${balls}`);
    e.setAttribute('aria-hidden', 'true');
    tags.push({ obj: ctx.stage.label(e, boardPoint(p.u, p.v + 0.012, GLASS_Z + 0.004)), el: e, until: now + 900 });
  }
  function dropTag(i: number): void {
    const t = tags.splice(i, 1)[0];
    if (!t) return;
    t.obj.removeFromParent();
    t.el.remove();
  }
  function stepTags(now: number): void {
    for (let i = tags.length - 1; i >= 0; i--) if (now >= tags[i]!.until) dropTag(i);
  }

  function landed(ball: Ball): void {
    ball.landed = true;
    const b = ball.batch;
    if (ball.shot && b) {
      b.outstanding--;
      if (ball.pays > 0) {
        b.paid += ball.pays;
        sound.payout(ball.pays);
        const pocket = ball.shot.pocket;
        if (pocket === 'left' || pocket === 'right' || pocket === 'start') payTag(pocket, ball.pays, performance.now());
      }
      if (ball.shot.pocket === 'start') {
        sound.start();
        holds.push({ shot: ball.shot, batch: b });
      } else if (ball.shot.pocket !== 'out') {
        sound.tulip();
      }
    } else if (ball.pays > 0 && show.kind === 'fever') {
      show.won += ball.pays;
      show.plan.batch.paid += ball.pays;
      sound.payout(2);
    }
    sync();
  }

  function stepBalls(now: number): void {
    let n = 0;
    for (let i = flying.length - 1; i >= 0; i--) {
      const ball = flying[i]!;
      const t = (now - ball.t0) / 1000;
      const dur = flightSeconds(ball.flight);
      if (t >= dur && !ball.landed) landed(ball);
      // a moment to sink into the pocket or drop through the out hole, then gone
      const after = t - dur;
      if (after > 0.18) {
        flying.splice(i, 1);
        continue;
      }
      flightAt(ball.flight, t, pt);
      let s = 1;
      if (after > 0) {
        s = Math.max(0.05, 1 - after / 0.18);
        if (ball.flight.end === 'out') pt.v = Math.min(pt.v, OUT_V) - after * 0.2;
      } else {
        // a tick off the nails when a ball changes direction sharply
        flightAt(ball.flight, Math.max(0, t - 1 / 60), prevPt);
        const vu = (pt.u - prevPt.u) * 60;
        const vv = (pt.v - prevPt.v) * 60;
        const dv = Math.hypot(vu - ball.lastVu, vv - ball.lastVv);
        if (dv > 0.35 && t > 0.1) sound.tick(Math.min(1, dv / 1.2));
        ball.lastVu = vu;
        ball.lastVv = vv;
      }
      // (boardPoint() without the new vector: this runs for every ball every frame)
      pos.set(pt.u, BOARD_Y + pt.v, BALL_Z);
      scl.setScalar(s);
      if (n < MAX_BALLS) balls.setMatrixAt(n++, m4.compose(pos, q, scl));
    }
    balls.count = n;
    balls.instanceMatrix.needsUpdate = true;
  }

  // --- the screen

  function startSpin(plan: ReelPlan, now: number): void {
    const target = plan.shot.reels ?? [0, 0, 1];
    const reach = target[0] === target[2];
    const hit = !!plan.shot.chain?.length;
    const stops: [number, number, number] = [STOP_L, reach ? REACH_M : STOP_M, STOP_R];
    show = { kind: 'spin', t0: now, plan, reach, hit, stops, target: [...target] as [number, number, number] };
    line = pickLine(LINES.spin);
  }

  function stepShow(now: number): void {
    const s = show;
    if (s.kind === 'idle') {
      if (holds.length) startSpin(holds.shift()!, now);
      else if (now - lineAt > 6000) {
        line = pickLine(LINES.idle);
        lineAt = now;
      }
      return;
    }
    const t = (now - s.t0) / 1000;
    if (s.kind === 'spin') {
      let ticked = false;
      for (let i = 0; i < 3; i++) {
        const before = Math.floor(reels[i]!);
        const speed = s.reach && i === 1 && t > STOP_R ? Math.max(3, SPIN_SPEED - (t - STOP_R) * 5) : SPIN_SPEED;
        reels[i] = reelPos(t, s.stops[i]!, s.target[i]!, s.reach && i === 1 ? speed : SPIN_SPEED);
        if (Math.floor(reels[i]!) !== before) ticked = true;
      }
      if (ticked) sound.reelTick();
      for (let i = 0; i < 3; i++) {
        const ts = s.stops[i]!;
        if (t >= ts && t - (now - lastFrame) / 1000 < ts) sound.reelStop();
      }
      if (s.reach && t >= STOP_R && t - (now - lastFrame) / 1000 < STOP_R) {
        sound.reach();
        line = pickLine(LINES.reach);
      }
      const done = Math.max(...s.stops) + 0.45;
      if (t >= done) {
        if (s.hit) {
          show = { kind: 'hit', t0: now, plan: s.plan, link: 0, won: 0 };
          sound.fanfare();
          ctx.kit.say(`Jackpot. ${s.target[0]}-${s.target[0]}-${s.target[0]}`, 2800);
          line = 'JACKPOT! 大当り!';
          sync();
        } else {
          if (s.reach) line = pickLine(LINES.miss);
          show = { kind: 'idle' };
        }
      }
      return;
    }
    const chain = s.plan.shot.chain ?? [];
    if (s.kind === 'hit') {
      if (t >= HIT_S) {
        show = { kind: 'fever', t0: now, plan: s.plan, link: s.link, round: 1, sent: 0, won: s.won };
        sound.feverOn();
        line = 'Fever! Aim right, into the attacker';
      }
      return;
    }
    if (s.kind === 'fever') {
      // five balls a round into the open attacker, three balls paid for each
      const perRound = 5;
      const due = Math.min(ROUNDS * perRound, Math.floor(t / (ROUND_S / perRound)) + 1);
      while (s.sent < due) {
        feverBall(now, ROUND_BALLS / perRound);
        s.sent++;
      }
      s.round = Math.min(ROUNDS, Math.floor(s.sent / perRound) + (s.sent % perRound ? 1 : 0));
      const allHome = s.sent >= ROUNDS * perRound && !flying.some((b) => b.shot === null && !b.landed);
      if (allHome) {
        const more = s.link + 1 < chain.length;
        if (more) {
          show = { kind: 'kakuhen', t0: now, plan: s.plan, link: s.link, won: s.won };
          sound.kakuhen();
          line = `Kakuhen on ${chain[s.link]}! The reels go again`;
          ctx.kit.say(`Kakuhen. ${chain[s.link]} is odd: the reels go again`, 2600);
        } else {
          show = { kind: 'end', t0: now, plan: s.plan, won: s.won };
          sound.feverOff();
          const last = chain[s.link]!;
          line = isKakuhen(last) && chain.length >= MAX_CHAIN ? `Chain of ${MAX_CHAIN}: the limit` : `Fever over · +${s.won} balls`;
          feverOver(s.plan, s.won, chain.length);
        }
        sync();
      }
      return;
    }
    if (s.kind === 'kakuhen') {
      if (t >= KAKUHEN_S) show = { kind: 'respin', t0: now, plan: s.plan, link: s.link + 1, won: s.won, from: [...reels] as [number, number, number] };
      return;
    }
    if (s.kind === 'respin') {
      const d = chain[s.link]!;
      for (let i = 0; i < 3; i++) reels[i] = reelPos(t, 0.9 + i * 0.5, d, SPIN_SPEED);
      if (t >= RESPIN_S) {
        show = { kind: 'hit', t0: now, plan: s.plan, link: s.link, won: s.won };
        sound.fanfare();
        line = `${s.link + 1}連! JACKPOT again`;
      }
      return;
    }
    if (s.kind === 'end') {
      if (t >= END_S) {
        show = { kind: 'idle' };
        sync();
      }
    }
  }
  let lastFrame = performance.now();

  function feverOver(plan: ReelPlan, won: number, links: number): void {
    const b = plan.batch.ev;
    const money = won * ballValue(b.bet);
    ctx.kit.say(`Fever over: ${links} jackpot${links > 1 ? 's' : ''}, ${won} balls, ${formatMoney(money)}`, 3400);
    if (money > b.bet) {
      const x = money / b.bet;
      celebrate(
        { stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx },
        { title: links > 1 ? `${links}連 Fever` : 'Jackpot', sub: `${won} balls · ${formatMoney(money)}`, tier: x >= 30 ? 'huge' : x >= 10 ? 'big' : 'nice', at: boardPoint(ATTACKER.u, ATTACKER.v + 0.05, 0.3) },
      );
    }
  }

  function screenState(now: number): ScreenState {
    const s = show;
    const base: ScreenState = { t: now, calm: reduceFlashing(), mode: 'idle', reels: [...reels] as [number, number, number], stopped: [true, true, true], holds: Math.min(4, holds.length), line };
    if (s.kind === 'spin') {
      const st = (now - s.t0) / 1000;
      return { ...base, mode: s.reach && st >= STOP_R ? 'reach' : 'spin', stopped: [st >= s.stops[0], st >= s.stops[1], st >= s.stops[2]], heat: Math.min(1, Math.max(0, (st - STOP_R) / (REACH_M - STOP_R))) };
    }
    if (s.kind === 'hit') return { ...base, mode: 'hit', reels: [(s.plan.shot.chain ?? [7])[s.link]!, 0, 0] };
    if (s.kind === 'fever') return { ...base, mode: 'fever', round: s.round, won: s.won, chain: s.link + 1 };
    if (s.kind === 'kakuhen') return { ...base, mode: 'kakuhen', chain: s.link + 1, won: s.won };
    if (s.kind === 'respin') return { ...base, mode: 'spin', stopped: [false, false, false].map((_, i) => (now - s.t0) / 1000 >= 0.9 + i * 0.5) as [boolean, boolean, boolean] };
    if (s.kind === 'end') return { ...base, mode: 'end', won: s.won, chain: (s.plan.shot.chain ?? []).length };
    return base;
  }

  function ledPattern(): LedPattern {
    switch (show.kind) {
      case 'spin':
        return show.reach && (performance.now() - show.t0) / 1000 >= STOP_R ? 'reach' : 'spin';
      case 'hit':
      case 'respin':
        return 'hit';
      case 'fever':
      case 'kakuhen':
      case 'end':
        return 'fever';
      default:
        return flying.length ? 'spin' : 'idle';
    }
  }

  let paintedAt = 0;
  function paint(now: number): void {
    const active = show.kind !== 'idle' || flying.length > 0 || holds.length > 0;
    if (now - paintedAt < (active ? 33 : 120)) return;
    paintedAt = now;
    paintScreen(lcdCanvas, screenState(now));
    lcdTex.needsUpdate = true;
    paintLeds(ledData, ledPattern(), now, reduceFlashing());
    ledTex.needsUpdate = true;
  }

  /** The attacker's lid swings open for a fever, eased by the frame's time (not the screen's repaint rate). */
  function swingLid(dt: number): void {
    const to = show.kind === 'fever' ? 1.05 : 0;
    const x = handle.lid.rotation.x;
    if (Math.abs(to - x) < 1e-4) return;
    handle.lid.rotation.x = to + (x - to) * Math.exp(-dt / 0.07);
  }

  // --- the frame loop's work

  function stepFiring(now: number): void {
    if (inFever()) return;
    const b = batches.find((x) => x.next < x.ev.shots.length);
    if (!b) return;
    if (now < nextFire) return;
    fire(b, now);
    nextFire = now + FIRE_MS;
    sync();
  }

  function retire(): void {
    // a batch is done when every shot has flown, landed, and its reels and fevers have played
    for (let i = batches.length - 1; i >= 0; i--) {
      const b = batches[i]!;
      const spinning = holds.some((h) => h.batch === b) || ('plan' in show && show.plan.batch === b);
      if (b.next >= b.ev.shots.length && b.outstanding === 0 && !spinning) {
        // anything the animation didn't count (it counts everything; this is a guard) lands now
        b.paid = b.ev.balls;
        // the data lamp catches up once the batch has played (it counts the spins it just showed)
        data = b.ev.data;
        batches.splice(i, 1);
        sync();
      }
    }
    if (!busy()) for (const r of calm.splice(0)) r();
  }

  /** Snap everything to its end (a snapshot, or leaving). */
  function finishAll(): void {
    for (const b of batches) {
      b.paid = b.ev.balls;
      data = b.ev.data;
    }
    batches.length = 0;
    flying.length = 0;
    holds.length = 0;
    show = { kind: 'idle' };
    sound.feverOff();
    balls.count = 0;
    handle.lid.rotation.x = 0;
    for (const r of calm.splice(0)) r();
  }

  sync();

  const view: TableView & { debug: unknown } = {
    onTable(snap: TableSnapshot) {
      finishAll();
      stack = snap.you.stack;
      const lim = snap.meta.config.limits.default;
      limits = lim;
      if (!bet) bet = lim.min;
      bet = clampBet(bet);
      const v = snap.view as PachinkoView;
      data = v.data;
      waiting = false;
      sync();
    },

    onEvents(events: GameEvent[]) {
      for (const e of events) {
        if (e.type !== 'launch') continue;
        const ev = e as unknown as LaunchEvent;
        waiting = false;
        stack = ev.stack;
        batches.push({ ev, next: 0, paid: 0, outstanding: 0 });
        nextFire = Math.max(nextFire, performance.now());
      }
      sync();
    },

    onSeat(msg) {
      stack = msg.stack;
      sync();
    },

    onError() {
      waiting = false;
      // a launch refused (the table closing, too fast): a hold lets go rather than asking again
      letGo();
      sync();
    },

    keydown(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (e.code === 'Space') {
        // held, it keeps firing (keepFiring); the key's repeats are the same hold
        if (!e.repeat) hold(true);
        return true;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        setPower(power + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 5));
        return true;
      }
      if (e.key === '[' || e.key === ']') {
        stepBet(e.key === ']' ? 1 : -1);
        return true;
      }
      if ((e.key === 'a' || e.key === 'A') && !e.shiftKey) {
        setMax();
        return true;
      }
      if ((e.key === 'i' || e.key === 'I') && !besideMachine() && !isTyping(e)) {
        togglePays();
        return true;
      }
      if (e.key === 'Escape' && side.classList.contains('open')) {
        closePays();
        return true;
      }
      return false;
    },

    update(dt) {
      if (disposed) return;
      const now = performance.now();
      swingLid(dt);
      if (waiting && now - sentAt > 5000) {
        waiting = false;
        sync();
      }
      // keep flights ready for the dial's power (and the fever lane) in a slice of each frame
      pools.fill(bucketOf(power), busy() ? 1.5 : 3);
      pools.fill(bucketOf(95), 1, true);
      keepFiring();
      stepFiring(now);
      stepBalls(now);
      stepTags(now);
      stepShow(now);
      retire();
      paint(now);
      lastFrame = now;
    },

    settled() {
      return busy() ? new Promise<void>((r) => calm.push(r)) : Promise.resolve();
    },

    dispose() {
      disposed = true;
      letGo();
      removeEventListener('pointerup', lift, true);
      removeEventListener('pointercancel', lift, true);
      removeEventListener('keyup', onKeyUp, true);
      removeEventListener('blur', letGo);
      document.removeEventListener('visibilitychange', onHidden);
      finishAll();
      offTips();
      if (tipShown) ctx.kit.tip(null);
      sound.dispose();
      closePays();
      while (tags.length) dropTag(0);
      deck.remove();
      side.remove();
      balls.removeFromParent();
      handle.lcd.material = lit.lcd;
      handle.data.material = lit.data;
      handle.leds.material = lit.leds;
      handle.lid.rotation.x = 0;
      for (const x of [lcdMat, dataMat, ledMat]) x.dispose();
      for (const x of [lcdTex, dataTex, ledTex]) x.dispose();
      if (owned) root.removeFromParent();
    },

    // for the headless checks
    debug: {
      state: () => ({
        stack,
        bet,
        power,
        waiting,
        held,
        batches: batches.map((b) => ({ next: b.next, of: b.ev.shots.length, paid: b.paid, balls: b.ev.balls, outstanding: b.outstanding })),
        flying: flying.length,
        holds: holds.length,
        show: show.kind,
        reels: [...reels],
        credit: stack - unpaid(),
        simulated: pools.simulated,
        ends: flying.map((b) => b.flight.end),
        fired: fired.slice(),
      }),
      pools: () => Object.fromEntries((['start', 'left', 'right', 'out', 'attacker'] as Catch[]).map((c) => [c, pools.ready(bucketOf(c === 'attacker' ? 95 : power), c)])),
    },
  };
  return view;
}
