// Big Six's table. The wheel stands behind a layout of seven spots; you click a spot to put the
// selected chip on it, and the server draws the stop when betting closes. The dealer hauls the
// wheel round, the pegs rattle the leather clapper, and the wheel slows onto that stop, often
// leaning on the last peg and rocking back. Then the call ("Twenty dollars"), the winning spot
// lit, the losers swept, the winners paid beside their bets, and the chips pushed back.
//
// Multiplayer runs on the server's clock: a 20 second window, "No more bets" when it closes (or
// once everyone at the table is ready), and every player's chips in their own colour and place.

import * as THREE from 'three';
import './bigsix.css';
import type { GameClientModule, TableView, TableViewCtx, TableSnapshot, MembersMsg } from '../contract.ts';
import type { Pose } from '../../table/stage.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import type { Member } from '../../../../shared/src/protocol.ts';
import type { BigSixView, SeatSettle } from '../../../../shared/src/games/bigsix/protocol.ts';
import { BETTING_MS } from '../../../../shared/src/games/bigsix/engine.ts';
import { SPOTS, type SymbolId, spotOf, paysLabel, callFor, edgePercent } from '../../../../shared/src/games/bigsix/rules.ts';
import { BETTING_CHIPS, formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { ChipTray, el } from '../../ui/kit.ts';
import { tween, wait, ease } from '../../table/tween.ts';
import { CHIP_R, CHIP_H } from '../../table/chips.ts';
import { celebrate } from '../../table/celebrate.ts';
import { serverNow } from '../../net/clock.ts';
import { TOP_Y, TABLE_W, TABLE_D, TABLE_Z, WHEEL_Y, WHEEL_Z, FOOTPRINT, MODEL_FELT, WHEEL_GROUP, tableModel, layoutFelt } from './model.ts';
import { spotAt, spotRect, chipSpot, SPOT_Z0, FELT_D } from './layout.ts';
import { ROTOR_NAME, FLAP_NAME, BULBS_NAME, GLOW_NAME, FRAME_OUT, buildWheel } from './wheel.ts';
import { WheelSpin, chooseEnding, angleFor, flapAngle, stopAt, TAU, SECTOR, G_TOUCH } from './spin.ts';
import { LayoutChips, Pile, seatColor, CHIP_SCALE, type PileStyle } from './chips.ts';
import { ClapperSound } from './sound.ts';
import { History, Meters, Plaque, Tooltip, Clock, Players, type PlayerRow } from './hud.ts';

const FELT_Y = TOP_Y + 0.0007;
const CHIP_Y = TOP_Y + 0.0009;
/** Where the dealer works (losers go here, payouts come from here): the head of the layout, under the wheel. */
const DEALER = new THREE.Vector3(0, CHIP_Y, TABLE_Z - FELT_D / 2 + 0.04);
/** Tray chips above the most a spot takes are hidden. */
const TRAY_MAX: Cents = 50_000;
/** Ticks are handed to the audio clock this far ahead. */
const LOOKAHEAD_S = 0.12;

/** Betting: the layout and the whole wheel from behind the players. The spin: the wheel, then close on the clapper. */
const BET_POSE: Pose = { position: [0, 2.32, 2.25], target: [0, 1.47, -0.25] };
const WHEEL_POSE: Pose = { position: [0, WHEEL_Y + 0.12, 1.5], target: [0, WHEEL_Y + 0.1, WHEEL_Z] };
const CLAPPER_POSE: Pose = { position: [0, WHEEL_Y + 0.5, WHEEL_Z + 1.08], target: [0, WHEEL_Y + 0.56, WHEEL_Z] };

const SEATS: { position: [number, number, number]; yaw: number }[] = [
  ...[-0.9, -0.54, -0.18, 0.18, 0.54, 0.9].map((x) => ({ position: [x, 0, TABLE_Z + TABLE_D / 2 + 0.3] as [number, number, number], yaw: Math.PI })),
  { position: [-(TABLE_W / 2 + 0.3), 0, TABLE_Z], yaw: Math.PI / 2 },
  { position: [TABLE_W / 2 + 0.3, 0, TABLE_Z], yaw: -Math.PI / 2 },
];

export const bigsix: GameClientModule = {
  game: 'bigsix',
  footprint: FOOTPRINT,
  createModel: ({ quality }) => tableModel(quality),
  seats: () => SEATS,
  playPose: () => BET_POSE,
  async preload() {
    // the wheel face and the felt are painted once, so their faces must be loaded first
    await Promise.all(['600 48px Cinzel', '700 48px Cinzel', '600 48px "Barlow Condensed"'].map((f) => document.fonts.load(f))).catch(() => {});
  },
  mount: (ctx) => mountBigSix(ctx),
};

interface SpinEvent {
  type: 'spin';
  round: number;
  stop: number;
  symbol: SymbolId;
  startAt: number;
  restAt: number;
}

interface SettleEvent {
  type: 'settle';
  round: number;
  stop: number;
  symbol: SymbolId;
  seats: Record<number, SeatSettle>;
}

const BEST = SPOTS[0]!;
const WORST = SPOTS[SPOTS.length - 1]!;
/** The Tips line, from the same paytable the tests check: $1 lowest, the pictures highest. */
const TIP_TEXT = `${BEST.name} has the lowest house edge, ${edgePercent(BEST).toFixed(1)}%. The Star and Crown have the highest, ${edgePercent(WORST).toFixed(1)}%.`;

function mountBigSix(ctx: TableViewCtx): TableView {
  const stage = ctx.stage;
  const scene = stage.root;

  // The station's model already has the wheel and a low-resolution felt: turn its wheel and lay a
  // sharp felt over the model's for play.
  let ownWheel: THREE.Object3D | null = null;
  let wheel = stage.anchor.getObjectByName(WHEEL_GROUP);
  if (!wheel) {
    ownWheel = buildWheel(stage.engine.quality, WHEEL_Y);
    ownWheel.position.set(0, WHEEL_Y, WHEEL_Z);
    scene.add(ownWheel);
    wheel = ownWheel;
  }
  const rotor = wheel.getObjectByName(ROTOR_NAME)!;
  const flap = wheel.getObjectByName(FLAP_NAME)!;
  const bulbs = wheel.getObjectByName(BULBS_NAME) as THREE.InstancedMesh;
  const glow = wheel.getObjectByName(GLOW_NAME) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  const modelFelt = stage.anchor.getObjectByName(MODEL_FELT);
  if (modelFelt) modelFelt.visible = false;
  const felt = layoutFelt(1400);
  stage.addFelt(felt, FELT_Y);
  felt.mesh.position.z = TABLE_Z;

  // state
  let mode: 'solo' | 'multi' = 'solo';
  let mySeat: number | null = null;
  let view: BigSixView | null = null;
  let members: Member[] = [];
  let stack: Cents = 0;
  let pendingStack: Cents | null = null;
  let lastWin: Cents = 0;
  let animating = false;
  let disposed = false;
  let lastNet: Record<number, Cents> = {};

  const styleOf = (seat: number): PileStyle => (mode === 'multi' ? { kind: 'color', color: seatColor(seat) } : { kind: 'value' });
  const placeOf = (seat: number, key: SymbolId): THREE.Vector3 => {
    const [x, z] = chipSpot(key, mode === 'multi' ? seat : null);
    return new THREE.Vector3(x, CHIP_Y, TABLE_Z + z);
  };
  const chips = new LayoutChips(placeOf, styleOf);
  scene.add(chips.root);
  const loose = new THREE.Group(); // piles being swept, paid or pushed back
  scene.add(loose);

  // the wheel's motion: θ clockwise as the players see it; a planned spin drives it
  let theta = rotor.rotation.z !== 0 ? -rotor.rotation.z : Math.random() * TAU;
  let spin: WheelSpin | null = null;
  let s = 0;
  let driving = false;
  let ticks: number[] = [];
  let tickIdx = 0;
  let relIdx = 0;
  let stopHeard = true;
  const sound = new ClapperSound(ctx.sfx);

  /** Light the stop that came up (null: none), from the moment the wheel stops until the next spin opens. */
  function lightStop(stop: number | null): void {
    glow.visible = stop !== null;
    if (stop !== null) glow.rotation.z = -stop * SECTOR;
  }

  // the marquee: 'idle' blinks in pairs, 'spin' chases round with the wheel, 'win' flashes
  let bulbMode: 'idle' | 'spin' | 'win' = 'idle';
  let bulbSince = performance.now();
  const lit = new THREE.Color(1.9, 1.45, 0.78);
  const dim = new THREE.Color(0.3, 0.19, 0.09);
  const bulbColor = new THREE.Color();

  // highlights: the hovered spot, and the winning one
  const plane = new THREE.PlaneGeometry(1, 1);
  const hoverMat = new THREE.MeshBasicMaterial({ color: '#ffe0a0', transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
  const winMat = new THREE.MeshBasicMaterial({ color: '#fff0c0', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
  const spotMesh = (key: SymbolId, mat: THREE.Material) => {
    const r = spotRect(key);
    const m = new THREE.Mesh(plane, mat);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(r.w - 0.006, r.d - 0.006, 1);
    m.position.set(r.x, TOP_Y + 0.0013, TABLE_Z + r.z);
    return m;
  };
  const hoverGroup = new THREE.Group();
  const winGroup = new THREE.Group();
  scene.add(hoverGroup, winGroup);
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false });
  const ghost = new THREE.Mesh(new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 32), ghostMat);
  ghost.visible = false;
  ghost.scale.setScalar(CHIP_SCALE);
  scene.add(ghost);

  // The camera: betting happens over the layout; when bets close it glides to the wheel, closes in
  // on the clapper as it slows, then returns to exactly where it was for the sweep and the payouts.
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
  function glideTo(pose: Pose, ms: number): Promise<void> {
    camHome ??= stage.restPose(camera);
    const to = stage.worldPose(pose);
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
  const tip = new Tooltip();
  const clock = new Clock();
  const players = new Players();
  ctx.ui.append(history.root, meters.root, tip.root, players.root);
  const plaqueObj = stage.label(plaque.root, new THREE.Vector3(FRAME_OUT + 0.36, WHEEL_Y + 0.3, WHEEL_Z));
  const clockObj = stage.label(clock.root, new THREE.Vector3(TABLE_W / 2 - 0.2, TOP_Y + 0.12, TABLE_Z - TABLE_D / 2 + 0.1));
  const best = el('div', 'bs-best tip-pick', 'Lowest edge');
  best.hidden = true;
  const bestObj = stage.label(best, new THREE.Vector3(spotRect(BEST.key).x, TOP_Y + 0.01, TABLE_Z + SPOT_Z0 - 0.028));

  const tray = new ChipTray({
    undo: () => act({ type: 'undo' }),
    clear: () => act({ type: 'clear' }),
    rebet: () => act({ type: 'rebet', double: false }),
    double: () => act({ type: 'rebet', double: true }),
    primary: { label: 'Spin', key: 'Space', run: () => primary() },
  });
  ctx.ui.append(tray.root);
  const chipButtons = [...tray.root.querySelectorAll<HTMLButtonElement>('.chip-btn')];
  BETTING_CHIPS.forEach((spec, i) => {
    if (spec.value > TRAY_MAX && chipButtons[i]) chipButtons[i]!.hidden = true;
  });
  const [undoBtn, clearBtn, rebetBtn, doubleBtn] = [...tray.root.querySelectorAll<HTMLButtonElement>('.acts .btn')];
  const colorNote = el('span', 'bs-color-note');
  tray.root.append(colorNote);
  colorNote.hidden = true;

  // ------------------------------------------------------------------------------------------
  // What the player can do

  const myBets = (): Partial<Record<SymbolId, Cents>> => (mySeat !== null && view ? (view.bets[mySeat] ?? {}) : {});
  const myTotal = () => Object.values(myBets()).reduce((a, b) => a + (b ?? 0), 0);
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
    if (canBet() && view?.phase === 'betting' && myTotal() > 0) ctx.link.act({ type: 'spin' });
  }

  function place(key: SymbolId): void {
    if (!canBet()) return;
    ctx.link.act({ type: 'bet', bets: [{ spot: key, amount: tray.selected.value }] });
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
    refreshTips();
  }

  /** Tips: the line above the controls and the tag on the $1 spot, only while bets can go down. */
  let tipShown = false;
  function refreshTips(): void {
    const show = ctx.tips.on && canBet();
    if (show && !tipShown) ctx.kit.tip(TIP_TEXT);
    else if (!show && tipShown) ctx.kit.tip(null);
    best.hidden = !show;
    tipShown = show;
  }
  const offTips = ctx.tips.subscribe(() => refreshTips());

  // ------------------------------------------------------------------------------------------
  // Pointer: hover shows what a spot pays and its edge; a click puts the selected chip on it

  let hovered: SymbolId | null = null;
  const canvas = stage.engine.renderer.domElement;

  function spotUnder(e: PointerEvent): SymbolId | null {
    if (e.target !== canvas) return null;
    const hit = stage.pick(e);
    if (!hit) return null;
    return spotAt(hit.local.x, hit.local.z - TABLE_Z);
  }

  function tipLines(key: SymbolId): { text: string; cls?: string }[] {
    const spot = spotOf(key)!;
    const lines: { text: string; cls?: string }[] = [
      { text: `${spot.name} · pays ${paysLabel(spot)}`, cls: 'bs-tip-name' },
      { text: `${spot.stops} of 54 stops · house edge ${edgePercent(spot).toFixed(2)}%`, cls: 'bs-tip-odds' },
    ];
    if (key === 'star' || key === 'crown') lines.push({ text: `Pays only when the ${spot.name} stops`, cls: 'bs-tip-edge' });
    if (view) {
      for (const [seatStr, bets] of Object.entries(view.bets)) {
        const amount = bets[key];
        if (!amount) continue;
        const seat = Number(seatStr);
        if (seat === mySeat) lines.push({ text: `Your bet ${formatMoney(amount)}`, cls: 'bs-tip-mine' });
        else lines.push({ text: `${nameOf(seat)} ${formatMoney(amount)}`, cls: 'bs-tip-other' });
      }
    }
    return lines;
  }

  function showHover(key: SymbolId | null, e: PointerEvent): void {
    if (key !== hovered) {
      hovered = key;
      hoverGroup.clear();
      if (key) hoverGroup.add(spotMesh(key, hoverMat));
    }
    if (!key) {
      tip.hide();
      ghost.visible = false;
      return;
    }
    tip.show(tipLines(key), e.clientX, e.clientY);
    ghost.visible = canBet();
    const at = placeOf(mySeat ?? 0, key);
    const pile = mySeat !== null ? chips.pile(mySeat, key) : undefined;
    ghost.position.set(at.x, CHIP_Y + (pile?.height ?? 0) + (CHIP_H * CHIP_SCALE) / 2, at.z);
    ghostMat.color.set(mode === 'multi' && mySeat !== null ? seatColor(mySeat) : tray.selected.body);
  }

  const onMove = (e: PointerEvent) => showHover(spotUnder(e), e);
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const key = spotUnder(e);
    if (key) place(key);
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
      const dot = el('span', 'bs-player-chip');
      dot.style.backgroundColor = seatColor(mySeat);
      colorNote.append(dot, document.createTextNode('Your chips'));
      colorNote.hidden = false;
    }
  }

  function showWinning(key: SymbolId | null): THREE.Object3D | null {
    winGroup.clear();
    if (key === null) return null;
    const m = spotMesh(key, winMat);
    winGroup.add(m);
    return m;
  }

  function draw(v: BigSixView): void {
    view = v;
    chips.sync(v.bets);
    history.set(v.history);
    refreshControls();
    drawPlayers();
    meters.set({ stack, win: lastWin });
  }

  // ------------------------------------------------------------------------------------------
  // The wheel, every frame

  /** Put the wheel at rest on a stop, the flap hanging free just inside it (as every spin ends). */
  function restOn(stop: number): void {
    spin = null;
    theta = angleFor(stop, G_TOUCH + 0.08);
  }

  function turnWheel(): void {
    if (spin) theta = spin.angle(s);
    rotor.rotation.z = -theta;
    let since: number | null = null;
    if (spin) {
      while (relIdx < ticks.length && ticks[relIdx]! <= s) relIdx++;
      if (relIdx > 0) since = s - ticks[relIdx - 1]!;
    }
    flap.rotation.z = flapAngle(theta, since);
  }

  function clapperSounds(): void {
    if (!spin || !driving) return;
    const top = Math.max(1, spin.w0);
    while (tickIdx < ticks.length && ticks[tickIdx]! <= s + LOOKAHEAD_S) {
      const t = ticks[tickIdx]!;
      if (t >= s - 0.03) sound.tick(t - s, spin.speed(t) / top);
      tickIdx++;
    }
    if (!stopHeard && s >= spin.tStop) {
      stopHeard = true;
      sound.settle();
      lightStop(spin.plan.stop);
    }
  }

  function lightBulbs(): void {
    if (!bulbs?.instanceColor) return;
    const n = bulbs.count;
    const now = performance.now();
    for (let k = 0; k < n; k++) {
      let on: number;
      if (bulbMode === 'spin') {
        // a pair of lit runs chasing round with the wheel
        const phase = ((theta / TAU) * 2 - k / n) * 2;
        on = Math.max(0, Math.cos(Math.PI * (phase - Math.round(phase)))) ** 6;
      } else if (bulbMode === 'win') {
        const t = (now - bulbSince) / 1000;
        on = t > 2.2 ? 1 : Math.floor(t / 0.22) % 2 === 0 ? 1 : 0.05;
      } else {
        on = (k + Math.floor(now / 700)) % 2 === 0 ? 1 : 0.12;
      }
      bulbs.setColorAt(k, bulbColor.copy(dim).lerp(lit, on));
    }
    bulbs.instanceColor.needsUpdate = true;
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
    clock.set(left, BETTING_MS, left <= 5000 ? 'Last bets' : 'Place bets');
  }

  // ------------------------------------------------------------------------------------------
  // The spin and the settlement

  async function playSpin(e: SpinEvent, settle: SettleEvent | undefined, next: BigSixView): Promise<void> {
    animating = true;
    onLeave();
    refreshControls();
    plaque.hide();
    showWinning(null);
    lightStop(null);
    const duration = Math.max(4, (e.restAt - Math.max(serverNow(), e.startAt)) / 1000);
    spin = new WheelSpin({ theta0: theta, duration, stop: e.stop, ...chooseEnding(Math.random) });
    s = 0;
    ticks = spin.releases();
    tickIdx = 0;
    relIdx = 0;
    stopHeard = false;
    bulbMode = 'spin';
    sound.pull();
    ctx.kit.say('No more bets', 2800);
    void glideTo(WHEEL_POSE, 1100);
    const token = spin;
    void wait(Math.max(1.2, duration - 3.4) * 1000).then(() => {
      if (!disposed && animating && spin === token) void glideTo(CLAPPER_POSE, 2800);
    });
    driving = true;
    await tween(duration * 1000, (k) => (s = k * duration), ease.linear);
    driving = false;
    s = duration;
    if (disposed) return;
    await settleTable(e, settle, next);
    animating = false;
  }

  function lift(p: THREE.Object3D, to: THREE.Vector3, ms: number, fade = true): Promise<void> {
    const from = p.position.clone();
    return tween(ms, (k) => {
      p.position.lerpVectors(from, to, k);
      p.position.y = from.y + (to.y - from.y) * k + Math.sin(Math.PI * k) * 0.014;
      if (fade && k >= 1) p.removeFromParent();
    }, ease.inOut);
  }

  /** Where a seat's chips go back to: the rail in front of that player. */
  function seatSpot(seat: number): THREE.Vector3 {
    const front = TABLE_Z + TABLE_D / 2 - 0.1;
    if (mode === 'solo' || seat === mySeat) return new THREE.Vector3(0.1, CHIP_Y, front);
    const pos = SEATS[seat % SEATS.length]!.position;
    return new THREE.Vector3(Math.max(-1.0, Math.min(1.0, pos[0])), CHIP_Y, front);
  }

  async function settleTable(e: SpinEvent, settle: SettleEvent | undefined, next: BigSixView): Promise<void> {
    const sym = e.symbol;
    const spot = spotOf(sym)!;
    history.set(next.history);
    plaque.show(sym);
    bulbMode = 'win';
    bulbSince = performance.now();
    ctx.kit.say(callFor(sym), 3600);
    const seats = settle?.seats ?? {};
    const mine = mySeat !== null ? seats[mySeat] : undefined;
    lastNet = Object.fromEntries(Object.entries(seats).map(([k, v]) => [Number(k), v.returned - v.wagered]));
    const net = mine ? mine.returned - mine.wagered : 0;
    if (mine) {
      if (net > 0) plaque.setNet(`You won ${formatMoney(net)}`, 'win');
      else if (mine.returned > 0) plaque.setNet(`Paid ${formatMoney(mine.returned)} · net ${net === 0 ? 'even' : '−' + formatMoney(-net)}`, 'quiet');
      else plaque.setNet('No winning bets', 'quiet');
    }

    // a moment on the clapper, then back over the layout
    await wait(1300);
    if (disposed) return;
    await glideHome(900);
    if (disposed) return;
    const glow = showWinning(sym);
    ctx.sfx.play('chips-handle', { volume: 0.4 });
    await wait(300);
    if (disposed) return;

    // losers are collected first
    const winners: { seat: number; key: SymbolId; amount: Cents; returned: Cents }[] = [];
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
        sweeps.push(lift(pile, DEALER.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, 0)), 520 + Math.random() * 160));
      }
    }
    if (sweeps.length) ctx.sfx.play('chips-collide', { volume: 0.7 });
    await Promise.all(sweeps);
    if (disposed) return;

    // then the winners are paid: beside the bet alone at the table, on top of it at a shared one
    const payouts: { pile: Pile; seat: number; key: SymbolId }[] = [];
    const pays: Promise<void>[] = [];
    for (const w of winners) {
      const pile = new Pile(styleOf(w.seat)).set(w.returned - w.amount);
      pile.position.copy(DEALER);
      loose.add(pile);
      const bet = chips.pile(w.seat, w.key);
      const at = placeOf(w.seat, w.key);
      const to = mode === 'solo' ? at.clone().add(new THREE.Vector3(CHIP_R * CHIP_SCALE * 2.3, 0, 0)) : at.clone().setY(CHIP_Y + (bet?.height ?? 0));
      pays.push(lift(pile, to, 600, false));
      payouts.push({ pile, seat: w.seat, key: w.key });
      if (w.seat === mySeat) {
        const text = `+${formatMoney(w.returned - w.amount)} · ${paysLabel(spot)}`;
        ctx.kit.pill(stage, new THREE.Vector3(at.x, TOP_Y + 0.08, at.z), text, net > 0 ? 'win' : 'push', 3200);
      }
    }
    if (pays.length) ctx.sfx.play(net > 0 ? 'chips-stack' : 'chips-handle', { volume: 0.8 });
    await Promise.all(pays);
    if (disposed) return;
    if (mine && mine.returned > 0) lastWin = mine.returned;
    meters.set({ win: lastWin });
    // the table marks a $20 and the pictures, when this player's round came out ahead on them
    const hitMine = mine?.bets.find(([key, , back]) => key === sym && back > 0);
    if (mine && hitMine && mine.returned > mine.wagered && (sym === 'twenty' || sym === 'star' || sym === 'crown')) {
      const r = spotRect(sym);
      celebrate(
        { stage, ui: ctx.ui, sfx: ctx.sfx },
        {
          title: sym === 'twenty' ? 'Twenty dollars' : callFor(sym),
          sub: `Pays ${paysLabel(spot)} · ${formatMoney(hitMine[2] - hitMine[1], { sign: true })}`,
          tier: sym === 'twenty' ? 'big' : 'huge',
          at: new THREE.Vector3(r.x, TOP_Y, TABLE_Z + r.z),
          glow: glow ? [glow] : [],
        },
      );
    }
    await wait(winners.length ? 1600 : 700);
    if (disposed) return;

    // winning bets and their payouts go back to the players
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
    await Promise.all(pushes);
    loose.clear();
    if (pendingStack !== null) {
      stack = pendingStack;
      pendingStack = null;
    }
    meters.set({ stack, win: lastWin });
    bulbMode = 'idle';
    if (mode === 'solo') ctx.kit.say('Place your bets', 2400);
  }

  function clearResult(): void {
    plaque.hide();
    showWinning(null);
    lightStop(null);
  }

  // ------------------------------------------------------------------------------------------

  const tableView: TableView & { debug: unknown } = {
    onTable(snap: TableSnapshot) {
      mode = snap.meta.mode;
      mySeat = snap.you.seat;
      stack = snap.you.stack;
      members = snap.members;
      const v = snap.view as BigSixView;
      animating = false;
      driving = false;
      bulbMode = 'idle';
      void glideHome(0);
      loose.clear();
      chips.clear();
      clearResult();
      if (v.spin) restOn(v.spin.stop);
      if (v.phase === 'results' && v.spin) {
        showWinning(v.spin.symbol);
        plaque.show(v.spin.symbol);
        lightStop(v.spin.stop);
      }
      draw(v);
    },

    async onEvents(events: GameEvent[], v: unknown) {
      const next = v as BigSixView;
      for (const e of events) {
        if (disposed) return;
        switch (e.type) {
          case 'betting':
            clearResult();
            lastNet = {};
            if (mode === 'multi') ctx.kit.say('Place your bets', 2600);
            break;
          case 'bet': {
            if (!view) break;
            const bets = { ...view.bets, [e.seat as number]: e.bets as Partial<Record<SymbolId, Cents>> };
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
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= BETTING_CHIPS.length) {
        if (BETTING_CHIPS[n - 1]!.value > TRAY_MAX) return true;
        return tray.key(e);
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

    update() {
      turnWheel();
      clapperSounds();
      lightBulbs();
      updateClock();
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      if (winGroup.children.length) winMat.opacity = 0.2 + 0.12 * pulse;
      if (glow.visible) glow.material.opacity = 0.2 + 0.16 * pulse;
    },

    dispose() {
      if (camHome) {
        camera.position.copy(camHome.pos);
        camera.quaternion.copy(camHome.quat);
        camHome = null;
      }
      disposed = true;
      offTips();
      if (tipShown) ctx.kit.tip(null);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerleave', onLeave);
      for (const node of [history.root, meters.root, tip.root, players.root, tray.root]) node.remove();
      for (const o of [plaqueObj, clockObj, bestObj]) o.removeFromParent();
      plaque.root.remove();
      clock.root.remove();
      best.remove();
      for (const o of [chips.root, loose, hoverGroup, winGroup, ghost, felt.mesh]) o.removeFromParent();
      ownWheel?.removeFromParent();
      if (modelFelt) modelFelt.visible = true;
      if (!ownWheel) {
        // leave the floor's wheel where it stopped, its bulbs steady
        rotor.rotation.z = -theta;
        flap.rotation.z = flapAngle(theta, null);
        glow.visible = false;
        if (bulbs?.instanceColor) {
          for (let k = 0; k < bulbs.count; k++) bulbs.setColorAt(k, lit);
          bulbs.instanceColor.needsUpdate = true;
        }
      }
    },

    // for the headless checks: where a spot is on screen, and what the view is doing
    debug: {
      screenOf(key: SymbolId): { x: number; y: number } | null {
        const r = spotRect(key);
        const p = scene.localToWorld(new THREE.Vector3(r.x, TOP_Y, TABLE_Z + r.z)).project(stage.engine.camera);
        return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
      },
      state: () => ({
        mode,
        mySeat,
        phase: view?.phase,
        animating,
        bets: myBets(),
        history: view?.history ?? [],
        stack,
        s,
        theta,
        shows: stopAt(theta),
        spin: spin ? { stop: spin.plan.stop, tStop: spin.tStop, tRest: spin.tRest, revolutions: spin.revolutions, ticks: ticks.length } : null,
      }),
    },
  };
  return tableView;
}
