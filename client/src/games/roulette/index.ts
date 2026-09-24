// Roulette's table. The wheel stands at the head of a printed layout; you click boxes, lines and
// corners to put chips down (splits, streets, corners and the rest sit where a dealer would put
// them), and the server draws the pocket when betting closes. The ball then plays out to that
// pocket: launched against the wheel, slowing on the track, running down past the deflectors,
// clattering over the frets and settling. Then the call ("17 BLACK"), the marker on the number,
// the losers swept, the winners paid beside their bets, and the chips pushed back.
//
// Multiplayer runs on the server's clock: a 20 second window, the ball goes in with 3 seconds
// left ("Last bets"), "No more bets" when it closes, and every player's chips in their colour.

import * as THREE from 'three';
import './roulette.css';
import type { GameClientModule, TableView, TableViewCtx, TableSnapshot, MembersMsg } from '../contract.ts';
import type { Pose } from '../../table/stage.ts';
import { isChipKey } from '../../table/keys.ts';
import type { GameEvent, TableConfig } from '../../../../shared/src/engine.ts';
import type { Member } from '../../../../shared/src/protocol.ts';
import type { RouletteView, SeatSettle } from '../../../../shared/src/games/roulette/protocol.ts';
import { BETTING_MS, LAUNCH_LEAD_MS, LATE_SPIN_MS } from '../../../../shared/src/games/roulette/engine.ts';
import { asVariant, spotByKey, spotName, paysLabel, describePocket, pocketLabel, type Spot } from '../../../../shared/src/games/roulette/rules.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { ChipTray, el } from '../../ui/kit.ts';
import { chipOn, maxRefusal, rouletteMax, type MaxBet } from '../../table/max.ts';
import { tween, wait, ease } from '../../table/tween.ts';
import { CHIP_R, CHIP_H } from '../../table/chips.ts';
import { serverNow } from '../../net/clock.ts';
import { TOP_Y, TABLE_W, TABLE_D, WHEEL_X, WHEEL_Z, MODEL_FELT, tableModel, layoutFelt } from './model.ts';
import { spotAt, anchorOf, rectsFor, layoutOf, ZE, ZT, XZ, type Rect } from './layout.ts';
import { ROTOR_NAME, BALL_NAME, DEFLECTORS, pocketAngle, sectorOf, buildWheel } from './wheel.ts';
import { Flight, OpenTrack, Rotor, TAU, DIMS, LAUNCH_W, BOUNCE_S } from './spin.ts';
import { LayoutChips, Pile, seatColor, CHIP_SCALE, type PileStyle } from './chips.ts';
import { BallSound } from './sound.ts';
import { History, Meters, Plaque, Tip, Clock, Players, type PlayerRow } from './hud.ts';
import { rouletteAdvice, rouletteMoment } from './advice.ts';
import { celebrate } from '../../table/celebrate.ts';

const FELT_Y = TOP_Y + 0.0007;
const CHIP_Y = TOP_Y + 0.0009;
/** Where the dealer stands (losers go here, payouts come from here): beside the wheel, across from the players. */
const DEALER = new THREE.Vector3(XZ - 0.02, CHIP_Y, ZT - 0.075);
/** Tray chips above the table's outside maximum are hidden (until the table says what that is). */
const TRAY_MAX: Cents = 500_000;

/** Betting: the whole table from above the players' rail. The spin: close on the wheel. */
const BET_POSE: Pose = { position: [-0.1, 2.22, 0.9], target: [-0.1, TOP_Y, 0.0] };
const WHEEL_POSE: Pose = { position: [WHEEL_X + 0.1, TOP_Y + 0.8, 0.6], target: [WHEEL_X + 0.02, TOP_Y + 0.02, 0.0] };

const SEATS: { position: [number, number, number]; yaw: number }[] = [
  ...[-0.7, -0.375, -0.05, 0.275, 0.6, 0.925, 1.25].map((x) => ({ position: [x, 0, TABLE_D / 2 + 0.32] as [number, number, number], yaw: Math.PI })),
  { position: [TABLE_W / 2 + 0.32, 0, 0.12], yaw: -Math.PI / 2 },
];

export const roulette: GameClientModule = {
  game: 'roulette',
  footprint: { width: TABLE_W, depth: TABLE_D },
  createModel: ({ variant, quality }) => tableModel(asVariant(variant), quality),
  seats: () => SEATS,
  playPose: () => BET_POSE,
  async preload() {
    // the felt and the number ring are painted once, so their faces must be loaded first
    await Promise.all(['600 48px Cinzel', '700 48px Cinzel', '600 48px "Barlow Condensed"'].map((f) => document.fonts.load(f))).catch(() => {});
  },
  mount: (ctx) => mountRoulette(ctx),
};

interface SpinEvent {
  type: 'spin';
  round: number;
  pocket: number;
  launchAt: number;
  restAt: number;
}

interface SettleEvent {
  type: 'settle';
  round: number;
  pocket: number;
  seats: Record<number, SeatSettle>;
}

function mountRoulette(ctx: TableViewCtx): TableView {
  const variant = asVariant(ctx.variant);
  const stage = ctx.stage;
  const scene = stage.root;

  // The station's model already has the wheel and a low-resolution felt; use its wheel and lay
  // a sharp felt over the model's for play.
  let ownWheel: THREE.Object3D | null = null;
  let wheel = stage.anchor.getObjectByName('roulette-wheel');
  if (!wheel || wheel.userData.variant !== variant) {
    if (wheel) wheel.visible = false;
    ownWheel = buildWheel(variant, stage.engine.quality);
    ownWheel.position.set(WHEEL_X, TOP_Y, WHEEL_Z);
    scene.add(ownWheel);
    wheel = ownWheel;
  }
  const rotorObj = wheel.getObjectByName(ROTOR_NAME)!;
  const ball = wheel.getObjectByName(BALL_NAME) as THREE.Mesh;
  const modelFelt = stage.anchor.getObjectByName(MODEL_FELT);
  if (modelFelt) modelFelt.visible = false;
  const felt = layoutFelt(variant, 1400, stage.engine.quality);
  stage.addFelt(felt, FELT_Y);

  // state
  let mode: 'solo' | 'multi' = 'solo';
  let cfg: TableConfig | null = null;
  let mySeat: number | null = null;
  let view: RouletteView | null = null;
  let members: Member[] = [];
  let stack: Cents = 0;
  let pendingStack: Cents | null = null;
  let lastWin: Cents = 0;
  let animating = false;
  let disposed = false;
  let lastNet: Record<number, Cents> = {};

  const styleOf = (seat: number): PileStyle => (mode === 'multi' ? { kind: 'color', color: seatColor(seat) } : { kind: 'value' });
  const chips = new LayoutChips((key) => anchorOf(variant, key), styleOf, CHIP_Y);
  scene.add(chips.root);
  const loose = new THREE.Group(); // piles being swept, paid or pushed back
  scene.add(loose);

  // the wheel's motion
  const rotor = new Rotor();
  rotor.base = Math.random() * TAU;
  let s = 0;
  let driving = false;
  let flight: Flight | null = null;
  let open: { round: number; track: OpenTrack } | null = null;
  let restAngle: number | null = null;
  let launchedRound = -1;
  let landings: { t: number; h: number }[] = [];
  let landIdx = 0;
  let lastFret: number | null = null;
  const sound = new BallSound(ctx.sfx);
  const sector = sectorOf(variant);

  // highlights: the numbers a hovered bet covers, and the winning number
  const plane = new THREE.PlaneGeometry(1, 1);
  const hoverMat = new THREE.MeshBasicMaterial({ color: '#ffe0a0', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
  const winMat = new THREE.MeshBasicMaterial({ color: '#fff0c0', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
  const hoverGroup = new THREE.Group();
  const winGroup = new THREE.Group();
  scene.add(hoverGroup, winGroup);
  const rectMesh = (r: Rect, mat: THREE.Material) => {
    const m = new THREE.Mesh(plane, mat);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(r.w - 0.009, r.d - 0.009, 1);
    m.position.set(r.x, TOP_Y + 0.0013, r.z);
    return m;
  };
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false });
  const ghost = new THREE.Mesh(new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 32), ghostMat);
  ghost.visible = false;
  ghost.scale.setScalar(CHIP_SCALE);
  scene.add(ghost);

  // the marker ("dolly") that stands on the winning number
  const dolly = new THREE.Group();
  {
    const acrylic = new THREE.MeshStandardMaterial({ color: '#e8eef2', transparent: true, opacity: 0.62, roughness: 0.08, metalness: 0.05 });
    const brass = new THREE.MeshStandardMaterial({ color: '#d4ad5c', metalness: 1, roughness: 0.25 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0165, 0.044, 28), acrylic);
    body.position.y = 0.022;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0168, 0.0168, 0.005, 28), brass);
    band.position.y = 0.0025;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.0125, 0.008, 28), brass);
    crown.position.y = 0.048;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 16, 12), brass);
    knob.position.y = 0.056;
    dolly.add(body, band, crown, knob);
  }
  dolly.visible = false;
  dolly.scale.setScalar(CHIP_SCALE);
  scene.add(dolly);

  // The camera: betting happens over the layout; when bets close it glides in on the wheel for the
  // ball, then back to exactly where it was for the marker, the sweep and the payouts.
  const camera = stage.engine.camera;
  let camHome: { pos: THREE.Vector3; quat: THREE.Quaternion } | null = null;
  function glide(pos: THREE.Vector3, quat: THREE.Quaternion, ms: number): Promise<void> {
    const p0 = camera.position.clone();
    const q0 = camera.quaternion.clone();
    return tween(ms, (k) => {
      if (disposed) return;
      camera.position.lerpVectors(p0, pos, k);
      camera.quaternion.slerpQuaternions(q0, quat, k);
    }, ease.inOut);
  }
  function glideToWheel(ms: number): Promise<void> {
    camHome ??= stage.restPose(camera);
    const to = stage.worldPose(WHEEL_POSE);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(to.position, to.target, camera.up));
    return glide(to.position, q, ms);
  }
  function glideHome(ms: number): Promise<void> {
    const home = camHome;
    camHome = null;
    if (!home) return Promise.resolve();
    if (ms <= 0) {
      camera.position.copy(home.pos);
      camera.quaternion.copy(home.quat);
      return Promise.resolve();
    }
    return glide(home.pos, home.quat, ms);
  }

  // DOM
  const history = new History();
  const meters = new Meters();
  const plaque = new Plaque();
  const tip = new Tip();
  const clock = new Clock();
  const players = new Players();
  ctx.ui.append(history.root, meters.root, tip.root, players.root);
  const plaqueObj = stage.label(plaque.root, new THREE.Vector3(WHEEL_X + 0.05, TOP_Y + 0.2, WHEEL_Z - 0.47));
  const clockObj = stage.label(clock.root, new THREE.Vector3(WHEEL_X + 0.3, TOP_Y + 0.1, 0.36));

  const tray = new ChipTray({
    undo: () => act({ type: 'undo' }),
    clear: () => act({ type: 'clear' }),
    rebet: () => act({ type: 'rebet', double: false }),
    double: () => act({ type: 'rebet', double: true }),
    max: { mode: 'pick' },
    primary: { label: 'Spin', key: 'Space', run: () => primary() },
  });
  ctx.ui.append(tray.root);
  // chips over the outside maximum stay in the rack (the table's own limits arrive with it)
  tray.setChipMax(TRAY_MAX);
  const [undoBtn, clearBtn, rebetBtn, doubleBtn] = [...tray.root.querySelectorAll<HTMLButtonElement>('.acts .btn')];
  const colorNote = el('span', 'rl-color-note');
  tray.root.append(colorNote);
  colorNote.hidden = true;

  // ------------------------------------------------------------------------------------------
  // What the player can do

  const myBets = (): Record<string, Cents> => (mySeat !== null && view ? (view.bets[mySeat] ?? {}) : {});
  const myTotal = () => Object.values(myBets()).reduce((a, b) => a + b, 0);
  const amReady = () => mySeat !== null && !!view?.ready.includes(mySeat);
  const canBet = () => !animating && mySeat !== null && (mode === 'solo' || view?.phase === 'betting');

  function act(a: unknown): void {
    const t = (a as { type: string }).type;
    if (!canBet() && t !== 'ready') return;
    ctx.link.act(a);
  }

  function primary(): void {
    if (mode === 'multi') {
      if (view?.phase === 'betting' && !animating) ctx.link.act({ type: 'ready', on: !amReady() });
      return;
    }
    if (!canBet()) return;
    // nothing down: last spin's bets again, and go (as blackjack deals)
    if (myTotal() === 0) {
      if (mySeat === null || !view?.canRebet.includes(mySeat)) return ctx.kit.say('Place a bet first', 1800);
      ctx.link.act({ type: 'rebet', double: false });
    }
    ctx.link.act({ type: 'spin' });
  }

  /** With Max picked, what a click on this spot puts down: its maximum, or every chip here. */
  function maxOn(spot: Spot): MaxBet | null {
    return tray.maxPicked && cfg ? rouletteMax(cfg, spot, myBets(), stack) : null;
  }

  function place(spot: Spot): void {
    if (!canBet()) return;
    const lim = cfg ? (cfg.limits[spot.inside ? 'inside' : 'outside'] ?? cfg.limits.default) : null;
    // a chip short of the spot's minimum puts the minimum down
    let amount = lim ? chipOn(tray.selected.value, myBets()[spot.key] ?? 0, lim) : tray.selected.value;
    const m = maxOn(spot);
    if (m && 'none' in m) return ctx.kit.toast(maxRefusal(m, lim!));
    if (m) amount = m.amount;
    ctx.link.act({ type: 'bet', bets: [{ kind: spot.kind, ...(spot.inside ? { numbers: [...spot.numbers] } : {}), amount }] });
    ctx.sfx.play('chip-lay', { volume: 0.7 });
  }

  function refreshControls(): void {
    const betting = canBet();
    if (mode === 'multi') {
      tray.setPrimary(amReady() ? 'Waiting' : 'Ready', view?.phase === 'betting' && !animating && mySeat !== null);
    } else {
      tray.setPrimary('Spin', betting && view?.phase === 'betting' && myTotal() > 0);
    }
    const has = myTotal() > 0;
    if (undoBtn) undoBtn.disabled = !betting || !has;
    if (clearBtn) clearBtn.disabled = !betting || !has;
    const canRepeat = mySeat !== null && !!view?.canRebet.includes(mySeat);
    if (rebetBtn) rebetBtn.disabled = !betting || !canRepeat;
    if (doubleBtn) doubleBtn.disabled = !betting || (!has && !canRepeat);
    meters.set({ bet: animating ? undefined : myTotal() });
    refreshAdvice();
  }

  /** Tips: which bet to skip (and a warning once it's down), while bets can still go on. */
  function refreshAdvice(): void {
    if (!ctx.tips.on || !canBet()) ctx.kit.tip(null);
    else ctx.kit.tip(rouletteAdvice(variant, myBets()));
  }
  const unTips = ctx.tips.subscribe(() => refreshAdvice());

  // ------------------------------------------------------------------------------------------
  // Pointer: hover shows what a spot is and what it pays; a click puts the selected chip on it

  let hovered: Spot | null = null;
  const canvas = stage.engine.renderer.domElement;

  function spotUnder(e: PointerEvent): Spot | null {
    if (e.target !== canvas) return null;
    const hit = stage.pick(e);
    if (!hit) return null;
    return spotAt(variant, hit.local.x, hit.local.z);
  }

  function tipLines(spot: Spot): { text: string; cls?: string }[] {
    const lines: { text: string; cls?: string }[] = [{ text: `${spotName(spot)} · ${paysLabel(spot)}`, cls: 'rl-tip-name' }];
    if (spot.kind === 'topline') lines.push({ text: 'House edge 7.89%, against 5.26% on every other bet', cls: 'rl-tip-edge' });
    const most = canBet() ? maxOn(spot) : null;
    if (most) lines.push({ text: 'amount' in most ? `Max adds ${formatMoney(most.amount)}` : most.none === 'AT_MAX' ? 'At the maximum' : 'Not enough chips for its minimum', cls: 'rl-tip-mine' });
    if (view) {
      for (const [seatStr, bets] of Object.entries(view.bets)) {
        const amount = bets[spot.key];
        if (!amount) continue;
        const seat = Number(seatStr);
        if (seat === mySeat) lines.push({ text: `Your bet ${formatMoney(amount)}`, cls: 'rl-tip-mine' });
        else lines.push({ text: `${nameOf(seat)} ${formatMoney(amount)}`, cls: 'rl-tip-other' });
      }
    }
    return lines;
  }

  function showHover(spot: Spot | null, e: PointerEvent): void {
    if (spot?.key !== hovered?.key) {
      hovered = spot;
      hoverGroup.clear();
      if (spot) for (const r of rectsFor(variant, spot)) hoverGroup.add(rectMesh(r, hoverMat));
    }
    if (!spot) {
      tip.hide();
      ghost.visible = false;
      return;
    }
    tip.show(tipLines(spot), e.clientX, e.clientY);
    const a = anchorOf(variant, spot.key);
    ghost.visible = !!a && canBet();
    if (a) {
      ghost.position.set(a[0], CHIP_Y + chips.heightAt(spot.key) + (CHIP_H * CHIP_SCALE) / 2, a[1]);
      ghostMat.color.set(mode === 'multi' && mySeat !== null ? seatColor(mySeat) : tray.maxPicked ? '#e2bf7c' : tray.selected.body);
    }
  }

  const onMove = (e: PointerEvent) => showHover(spotUnder(e), e);
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const spot = spotUnder(e);
    if (spot) place(spot);
  };
  const onLeave = () => {
    hovered = null;
    hoverGroup.clear();
    tip.hide();
    ghost.visible = false;
  };
  addEventListener('pointermove', onMove);
  addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerleave', onLeave);

  // ------------------------------------------------------------------------------------------
  // Drawing the settled table

  function nameOf(seat: number): string {
    return members.find((m) => m.seat === seat && m.status !== 'watching')?.name ?? `Seat ${seat + 1}`;
  }

  function drawPlayers(): void {
    if (mode !== 'multi') {
      players.set([]);
      colorNote.hidden = true;
      return;
    }
    const rows: PlayerRow[] = members
      .filter((m) => m.seat !== null && m.status !== 'watching')
      .sort((a, b) => a.seat! - b.seat!)
      .map((m) => {
        const seat = m.seat!;
        const net = lastNet[seat];
        let status = '';
        let statusKind: PlayerRow['statusKind'];
        if (view?.phase === 'betting' && view.ready.includes(seat)) {
          status = 'Ready';
          statusKind = 'ready';
        } else if (view?.phase === 'results' && net !== undefined && !animating) {
          status = net > 0 ? `+${formatMoney(net)}` : net < 0 ? `−${formatMoney(-net)}` : 'even';
          statusKind = net > 0 ? 'win' : 'quiet';
        }
        return { seat, name: m.name, color: seatColor(seat), stack: seat === mySeat ? stack : m.stack, you: seat === mySeat, status, statusKind };
      });
    players.set(rows);
    if (mySeat !== null) {
      colorNote.replaceChildren();
      const dot = el('span', 'rl-player-chip');
      dot.style.backgroundColor = seatColor(mySeat);
      colorNote.append(dot, document.createTextNode('Your chips'));
      colorNote.hidden = false;
    }
  }

  function showWinning(pocket: number | null): void {
    winGroup.clear();
    if (pocket === null) return;
    const r = layoutOf(variant).cells.get(pocket);
    if (r) winGroup.add(rectMesh(r, winMat));
  }

  function draw(v: RouletteView): void {
    view = v;
    chips.sync(v.bets);
    history.set(v.history);
    refreshControls();
    drawPlayers();
    meters.set({ stack, win: lastWin });
  }

  // ------------------------------------------------------------------------------------------
  // The wheel and ball, every frame

  function launch(): void {
    rotor.kick(rotor.angle(s));
    s = 0;
    flight = null;
    restAngle = null;
    lastFret = null;
  }

  function placeBall(): void {
    rotorObj.rotation.y = rotor.angle(s);
    let st: { theta: number; r: number; y: number } | null = null;
    if (flight) st = flight.at(s);
    else if (open) st = open.track.at(s);
    else if (restAngle !== null) st = { theta: rotor.angle(s) + restAngle, r: DIMS.restR, y: DIMS.pocketY + DIMS.ballR };
    ball.visible = !!st;
    if (st) ball.position.set(st.r * Math.sin(st.theta), st.y, st.r * Math.cos(st.theta));
  }

  function ballSounds(): void {
    if (open && !flight) {
      const st = open.track.at(s);
      sound.setRoll(Math.abs(st.w / LAUNCH_W), Math.abs(st.w) / TAU, true);
      return;
    }
    if (!flight || s > flight.tRest + 0.2) return;
    const st = flight.at(s);
    if (st.phase === 'track' || st.phase === 'fall') sound.setRoll(Math.abs(st.w / LAUNCH_W), Math.abs(st.w) / TAU, st.phase === 'track');
    else sound.stopRoll();
    while (landIdx < landings.length && landings[landIdx]!.t <= s) {
      sound.click(Math.min(1, landings[landIdx]!.h / 0.017), 1);
      landIdx++;
    }
    if (st.phase === 'bounce' && st.r < DIMS.ringInR && st.rel !== null) {
      const k = Math.floor(st.rel / sector);
      if (lastFret !== null && k !== lastFret) sound.click(0.22, 1.35);
      lastFret = k;
    }
  }

  /** Multiplayer: the dealer puts the ball in with a few seconds of betting left. */
  function maybePrelaunch(): void {
    if (mode !== 'multi' || !view || view.phase !== 'betting' || view.launchAt === null || animating) return;
    if (launchedRound === view.round || serverNow() < view.launchAt) return;
    launch();
    open = { round: view.round, track: new OpenTrack(Math.PI + (Math.random() - 0.5) * 0.6, (LAUNCH_LEAD_MS + LATE_SPIN_MS) / 1000 - BOUNCE_S) };
    launchedRound = view.round;
    sound.startRoll();
    ctx.kit.say('Last bets', 2600);
  }

  function updateClock(): void {
    if (mode !== 'multi' || !view || view.phase !== 'betting' || view.deadline === null || animating) {
      clock.hide();
      return;
    }
    const left = view.deadline - serverNow();
    if (left <= 0) {
      clock.hide();
      return;
    }
    clock.set(left, BETTING_MS, left <= LAUNCH_LEAD_MS ? 'Last bets' : 'Place bets');
  }

  // ------------------------------------------------------------------------------------------
  // The spin and the settlement

  async function playSpin(e: SpinEvent, settle: SettleEvent | undefined, next: RouletteView): Promise<void> {
    animating = true;
    onLeave();
    refreshControls();
    plaque.hide();
    showWinning(null);
    let from: { t: number; theta: number; w: number };
    let tRest: number;
    if (open && open.round === e.round) {
      // the ball has been circling since "Last bets": take it over from where it is
      const st = open.track.at(s);
      from = { t: s, theta: st.theta, w: st.w };
      tRest = s + Math.max(4.2, (e.restAt - serverNow()) / 1000);
    } else {
      launch();
      from = { t: 0, theta: Math.PI + (Math.random() - 0.5) * 0.6, w: LAUNCH_W };
      tRest = Math.max(6, (e.restAt - e.launchAt) / 1000);
      sound.startRoll();
    }
    open = null;
    flight = new Flight({ pocketAngle: pocketAngle(variant, e.pocket), tRest, from, rotor, deflectors: DEFLECTORS, sector });
    landings = flight.landings();
    landIdx = 0;
    launchedRound = e.round;
    ctx.kit.say('No more bets', 3200);
    void glideToWheel(1100);
    const s0 = s;
    driving = true;
    await tween((tRest - s0) * 1000, (k) => (s = s0 + k * (tRest - s0)), ease.linear);
    driving = false;
    s = Math.max(s, tRest);
    sound.stopRoll();
    if (disposed) return;
    await settleTable(e.pocket, settle, next);
    animating = false;
  }

  function lift(p: THREE.Object3D, to: THREE.Vector3, ms: number, fade = true): Promise<void> {
    const from = p.position.clone();
    return tween(ms, (k) => {
      p.position.lerpVectors(from, to, k);
      p.position.y = from.y + (to.y - from.y) * k + Math.sin(Math.PI * k) * 0.012;
      if (fade && k >= 1) p.removeFromParent();
    }, ease.inOut);
  }

  function seatSpot(seat: number): THREE.Vector3 {
    if (mode === 'solo' || seat === mySeat) return new THREE.Vector3(0.25, CHIP_Y, ZE + 0.1);
    const pos = SEATS[seat % SEATS.length]!.position;
    return new THREE.Vector3(Math.max(-1.1, Math.min(1.2, pos[0])), CHIP_Y, ZE + 0.1);
  }

  async function settleTable(pocket: number, settle: SettleEvent | undefined, next: RouletteView): Promise<void> {
    const call = describePocket(pocket);
    history.set(next.history);
    showWinning(pocket);
    plaque.show(pocket);
    ctx.kit.say(call.call, 3600);
    const seats = settle?.seats ?? {};
    const mine = mySeat !== null ? seats[mySeat] : undefined;
    lastNet = Object.fromEntries(Object.entries(seats).map(([k, v]) => [Number(k), v.returned - v.wagered]));
    const net = mine ? mine.returned - mine.wagered : 0;
    if (mine) {
      if (net > 0) plaque.setNet(`You won ${formatMoney(net)}`, 'win');
      else if (mine.returned > 0) plaque.setNet(`Paid ${formatMoney(mine.returned)} · net ${net === 0 ? 'even' : '−' + formatMoney(-net)}`, 'quiet');
      else plaque.setNet('No winning bets', 'quiet');
    }

    // a moment on the ball in its pocket, then back over the layout
    await wait(1100);
    if (disposed) return;
    await glideHome(850);
    if (disposed) return;

    // the marker drops onto the number, on top of any chips there
    const cell = layoutOf(variant).cells.get(pocket)!;
    const markerAt = new THREE.Vector3(cell.x, CHIP_Y + chips.heightAt(`straight:${pocket}`), cell.z);
    dolly.position.set(markerAt.x, markerAt.y + 0.08, markerAt.z);
    dolly.visible = true;
    await tween(360, (k) => dolly.position.setY(markerAt.y + 0.08 * (1 - k)), ease.outBack);
    ctx.sfx.play('chips-handle', { volume: 0.4 });
    await wait(350);
    if (disposed) return;

    // losers are collected first
    const winners: { seat: number; key: string; amount: Cents; returned: Cents }[] = [];
    const sweeps: Promise<void>[] = [];
    for (const [seatStr, st] of Object.entries(seats)) {
      const seat = Number(seatStr);
      for (const [key, amount, returned] of st.bets) {
        if (returned > 0) {
          winners.push({ seat, key, amount, returned });
          continue;
        }
        const pile = chips.detach(seat, key);
        if (!pile) continue;
        loose.add(pile);
        sweeps.push(lift(pile, DEALER.clone(), 520 + Math.random() * 160));
      }
    }
    if (sweeps.length) {
      ctx.sfx.play('chips-collide', { volume: 0.7 });
      ctx.stage.gesture('sweep');
    }
    for (const key of new Set(winners.map((w) => w.key))) chips.restack(key);
    await Promise.all(sweeps);
    if (disposed) return;

    // then the winners are paid, the payout set down beside each bet
    const payouts: { pile: Pile; seat: number; key: string }[] = [];
    const pays: Promise<void>[] = [];
    const byKey = new Map<string, number>();
    for (const w of winners) {
      const spot = spotByKey(variant, w.key);
      const a = anchorOf(variant, w.key);
      if (!spot || !a) continue;
      const n = byKey.get(w.key) ?? 0;
      byKey.set(w.key, n + 1);
      const pile = new Pile(styleOf(w.seat)).set(w.returned - w.amount);
      pile.position.copy(DEALER);
      loose.add(pile);
      const to = new THREE.Vector3(a[0] + CHIP_R * CHIP_SCALE * 2.2, CHIP_Y, a[1] + n * CHIP_R * CHIP_SCALE * 2.1);
      pays.push(lift(pile, to, 560, false));
      payouts.push({ pile, seat: w.seat, key: w.key });
      if (w.seat === mySeat) {
        const text = `+${formatMoney(w.returned - w.amount)} · ${paysLabel(spot)}`;
        ctx.kit.pill(stage, new THREE.Vector3(to.x, TOP_Y + 0.07, to.z), text, net > 0 ? 'win' : 'push', 3000);
      }
    }
    if (pays.length) {
      ctx.sfx.play(net > 0 ? 'chips-stack' : 'chips-handle', { volume: 0.8 });
      ctx.stage.gesture('pay');
    }
    await Promise.all(pays);
    // a straight-up (or split or street) hit that beat the whole stake: light the number and the bet
    const moment = mine && mySeat !== null ? rouletteMoment(variant, mine) : null;
    const spot = moment && spotByKey(variant, moment.key);
    if (moment && spot) {
      // ring the numbers the bet covered, the winning one among them
      const spots = rectsFor(variant, spot).map((r) => ({ x: r.x, y: FELT_Y, z: r.z, w: r.w, d: r.d }));
      celebrate({ stage, ui: ctx.ui, sfx: ctx.sfx }, { title: moment.title, sub: moment.sub, tier: moment.tier, spots });
    }
    if (mine && mine.returned > 0) lastWin = mine.returned;
    if (disposed) return;
    await wait(winners.length ? 1500 : 700);
    if (disposed) return;

    // winning bets and their payouts go back to the players; the marker comes off
    const pushes: Promise<void>[] = [];
    for (const p of payouts) {
      const dest = seatSpot(p.seat);
      pushes.push(lift(p.pile, dest.clone(), 480));
      const bet = chips.detach(p.seat, p.key);
      if (bet) {
        loose.add(bet);
        pushes.push(lift(bet, dest.clone(), 480));
      }
    }
    pushes.push(
      tween(300, (k) => dolly.position.setY(markerAt.y + 0.1 * k), ease.inOut).then(() => {
        dolly.visible = false;
      }),
    );
    await Promise.all(pushes);
    loose.clear();
    if (pendingStack !== null) {
      stack = pendingStack;
      pendingStack = null;
    }
    meters.set({ stack, win: lastWin });
    if (mode === 'solo') ctx.kit.say('Place your bets', 2400);
  }

  function clearResult(): void {
    plaque.hide();
    showWinning(null);
    dolly.visible = false;
  }

  // ------------------------------------------------------------------------------------------

  const tableView: TableView & { debug: unknown } = {
    onTable(snap: TableSnapshot) {
      mode = snap.meta.mode;
      cfg = snap.meta.config;
      tray.setChipMax(cfg.limits.outside?.max ?? TRAY_MAX, cfg.limits.inside?.min ?? 0);
      mySeat = snap.you.seat;
      stack = snap.you.stack;
      members = snap.members;
      const v = snap.view as RouletteView;
      animating = false;
      driving = false;
      open = null;
      flight = null;
      void glideHome(0);
      sound.stopRoll();
      loose.clear();
      chips.clear();
      clearResult();
      restAngle = v.spin ? pocketAngle(variant, v.spin.pocket) : null;
      launchedRound = v.spin?.round ?? -1;
      if (v.phase === 'results' && v.spin) {
        showWinning(v.spin.pocket);
        plaque.show(v.spin.pocket);
      }
      draw(v);
    },

    async onEvents(events: GameEvent[], v: unknown) {
      const next = v as RouletteView;
      for (const e of events) {
        if (disposed) return;
        switch (e.type) {
          case 'betting':
            clearResult();
            lastNet = {};
            if (open && open.round !== e.round) {
              // a window that closed with no bets: the dealer takes the ball back out
              open = null;
              sound.stopRoll();
            }
            if (mode === 'multi') ctx.kit.say('Place your bets', 2600);
            break;
          case 'bet': {
            if (!view) break;
            const bets = { ...view.bets, [e.seat as number]: e.bets as Record<string, Cents> };
            view = { ...view, bets };
            const grown = chips.sync(bets);
            for (const pile of grown) {
              const y = pile.position.y;
              void tween(140, (k) => pile.position.setY(y + 0.03 * (1 - k)), ease.out);
            }
            if (e.seat !== mySeat && grown.length) ctx.sfx.play('chip-lay', { volume: 0.35 });
            refreshControls();
            break;
          }
          case 'ready':
            if (view) view = { ...view, ready: next.ready };
            refreshControls();
            drawPlayers();
            break;
          case 'spin':
            await playSpin(e as unknown as SpinEvent, events.find((x) => x.type === 'settle') as unknown as SettleEvent | undefined, next);
            break;
          case 'idle':
            clearResult();
            break;
        }
      }
      if (!disposed) draw(next);
    },

    onSeat(msg) {
      if (msg.seat !== null) mySeat = msg.seat;
      if (animating) pendingStack = msg.stack;
      else stack = msg.stack;
      meters.set({ stack: animating ? undefined : stack });
      drawPlayers();
      refreshControls();
    },

    onMembers(msg: MembersMsg) {
      members = msg.members;
      drawPlayers();
    },

    keydown(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        act({ type: 'undo' });
        return true;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (isChipKey(e.key)) return tray.key(e);
      // Max, while a bet can go down
      if ((e.key === 'a' || e.key === 'A') && !e.shiftKey && canBet()) {
        tray.pickMax();
        return true;
      }
      if (e.code === 'Space') {
        primary();
        return true;
      }
      if (e.key === 'Backspace') {
        act({ type: 'undo' });
        return true;
      }
      if (e.key === 'x' || e.key === 'X') {
        act({ type: 'clear' });
        return true;
      }
      if (e.key === 'r' || e.key === 'R') {
        act({ type: 'rebet', double: e.shiftKey });
        return true;
      }
      return false;
    },

    update(dt: number) {
      if (!driving) s += dt;
      maybePrelaunch();
      placeBall();
      ballSounds();
      updateClock();
      if (winGroup.children.length) winMat.opacity = 0.22 + 0.12 * (0.5 + 0.5 * Math.sin(performance.now() / 260));
    },

    dispose() {
      if (camHome) {
        camera.position.copy(camHome.pos);
        camera.quaternion.copy(camHome.quat);
        camHome = null;
      }
      disposed = true;
      unTips();
      ctx.kit.tip(null);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerleave', onLeave);
      sound.dispose();
      for (const node of [history.root, meters.root, tip.root, players.root, tray.root]) node.remove();
      plaqueObj.removeFromParent();
      clockObj.removeFromParent();
      plaque.root.remove();
      clock.root.remove();
      for (const o of [chips.root, loose, hoverGroup, winGroup, ghost, dolly, felt.mesh]) o.removeFromParent();
      ownWheel?.removeFromParent();
      if (modelFelt) modelFelt.visible = true;
      if (wheel && !ownWheel) {
        ball.visible = false;
        rotorObj.rotation.y = rotor.angle(s);
      }
    },

    // for the headless checks: where a spot is on screen, and what the view is doing
    debug: {
      screenOf(key: string): { x: number; y: number } | null {
        const a = anchorOf(variant, key);
        if (!a) return null;
        const p = scene.localToWorld(new THREE.Vector3(a[0], TOP_Y, a[1])).project(stage.engine.camera);
        return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
      },
      state: () => ({ mode, mySeat, phase: view?.phase, animating, bets: myBets(), history: view?.history ?? [], stack, s, flight: flight ? { tDrop: flight.tDrop, tEnter: flight.tEnter, tRest: flight.tRest, revolutions: flight.revolutions } : null }),
      pocket: pocketLabel,
    },
  };
  return tableView;
}
