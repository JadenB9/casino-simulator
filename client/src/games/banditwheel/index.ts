// The Bandit Wheel: Rust's big wheel. You sit at one of ten terminals round it, put chips on
// 1, 3, 5, 10 or 20, and the wheel spins on its own clock: a betting window, "No more bets", the
// wheel hauled round with the flapper clattering over the pegs until it stops, and every bet on
// that number paid. Nobody presses Spin (alone, "Spin now" skips the rest of the window).
//
// The server draws the slot when betting closes; the wheel is solved backward onto it, so the
// flapper always comes to rest where the server said. Then the call, the number lit on every
// terminal, losing chips dropped into the terminals' hoppers, winners paid beside their bets.

import * as THREE from 'three';
import './banditwheel.css';
import type { GameClientModule, TableView, TableViewCtx, TableSnapshot, MembersMsg } from '../contract.ts';
import type { Pose } from '../../table/stage.ts';
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import type { Member } from '../../../../shared/src/protocol.ts';
import type { BanditView, SeatSettle, Bets } from '../../../../shared/src/games/banditwheel/protocol.ts';
import { NUMBERS, SPOTS, SLOTS, type WheelNumber, spotOf, paysLabel, callFor, edgePercent } from '../../../../shared/src/games/banditwheel/rules.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { tween, ease } from '../../table/tween.ts';
import { celebrate } from '../../table/celebrate.ts';
import { serverNow } from '../../net/clock.ts';
import {
  FOOTPRINT, OVERVIEW_POSE, FLAPPER_POSE, TERMINALS, TERM_R, STOOL_R, TOP_Y, CUP_W,
  seatPositions, seatPose, wheelPose, terminalOfSeat, terminalYaw, cupPlace, onArc,
} from './layout.ts';
import { wheelModel, WHEEL_GROUP, ROTOR_NAME, GLOW_NAME, LAMPS_NAME, type Flapper, type Screens } from './model.ts';
import { WheelSpin, chooseEnding, angleFor, flapAngle, slotAt, TAU, SECTOR, G_TOUCH } from './spin.ts';
import { CupChips, Pile } from './chips.ts';
import { WheelSound } from './sound.ts';
import { Panel, History, Players, TerminalTag, type PlayerRow } from './hud.ts';
import { drawScreen, type ScreenState } from './art.ts';

const SEATS = seatPositions();
/** Clicks are handed to the audio clock this far ahead. */
const LOOKAHEAD_S = 0.12;
/** The payout's natural length, from the wheel at rest to the chips home. */
const PAYOUT_MS = 4600;

export const banditwheel: GameClientModule = {
  game: 'banditwheel',
  footprint: FOOTPRINT,
  createModel: ({ quality }) => wheelModel(quality),
  seats: () => SEATS,
  playPose: (_variant, seat) => (seat === null ? OVERVIEW_POSE : seatPose(seat)),
  async preload() {
    // the sign and the screens are painted with these faces, so they must be loaded first
    await Promise.all(['600 48px "Barlow Condensed"', '700 48px DSEG7'].map((f) => document.fonts.load(f))).catch(() => {});
  },
  mount: (ctx) => mountBanditWheel(ctx),
};

interface SpinEvent {
  type: 'spin';
  round: number;
  slot: number;
  number: WheelNumber;
  startAt: number;
  restAt: number;
}

interface SettleEvent {
  type: 'settle';
  round: number;
  slot: number;
  number: WheelNumber;
  seats: Record<number, SeatSettle>;
}

const BEST = SPOTS.filter((s) => edgePercent(s) === Math.min(...SPOTS.map(edgePercent)));
/** The Tips line, from the same paytable the tests check. */
const TIP_TEXT = `${BEST.map((s) => s.key).join(', ').replace(/, (\d+)$/, ' and $1')} each carry a ${edgePercent(BEST[0]!)}% house edge. 10 costs ${edgePercent(spotOf(10)!)}% and 20 costs ${edgePercent(spotOf(20)!)}%.`;

function mountBanditWheel(ctx: TableViewCtx): TableView {
  const stage = ctx.stage;
  const scene = stage.root;

  // The station's model is already on the floor; a bare room gets its own.
  let own: THREE.Object3D | null = null;
  let model = stage.anchor.getObjectByName(WHEEL_GROUP);
  if (!model) {
    own = wheelModel(stage.engine.quality);
    scene.add(own);
    model = own;
  }
  const rotor = model.getObjectByName(ROTOR_NAME)!;
  const glow = model.getObjectByName(GLOW_NAME) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  const flapper = model.userData.flapper as Flapper;
  const screens = model.userData.screens as Screens;
  const bulbs = model.getObjectByName(LAMPS_NAME) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined;
  const bulbLit = bulbs?.material.color.clone() ?? new THREE.Color(2.2, 1.55, 0.8);

  // state
  let mode: 'solo' | 'multi' = 'solo';
  let mySeat: number | null = null;
  let view: BanditView | null = null;
  let members: Member[] = [];
  let stack: Cents = 0;
  let pendingStack: Cents | null = null;
  let limitMax: Cents = 0;
  let animating = false;
  let disposed = false;
  /** Bumped by every full snapshot: a spin or payout started before it stops where it is. */
  let gen = 0;
  let lastNet: Record<number, Cents> = {};
  let shownNumber: WheelNumber | null = null;
  /** The spin being watched came from a snapshot (outside the event queue); a new window ends it. */
  let resumed = false;

  // The payout and the camera run on the wall clock, like the wheel: a table's rounds follow the
  // server's clock, so at a low frame rate they play choppier but never later. A snapshot or
  // leaving the table snaps whatever is running to its end.
  type Anim = { t0: number; ms: number; apply: (k: number) => void; done: () => void; ease: (t: number) => number };
  const anims = new Set<Anim>();
  function play(ms: number, apply: (k: number) => void, e: (t: number) => number = ease.inOut): Promise<void> {
    return new Promise((done) => {
      if (ms <= 0) {
        apply(1);
        done();
        return;
      }
      anims.add({ t0: performance.now(), ms, apply, done, ease: e });
    });
  }
  const pause = (ms: number) => play(ms, () => {});
  function stepAnims(): void {
    const now = performance.now();
    for (const a of anims) {
      const k = Math.min(1, (now - a.t0) / a.ms);
      a.apply(a.ease(k));
      if (k >= 1) {
        anims.delete(a);
        a.done();
      }
    }
  }
  function finishAnims(): void {
    for (const a of anims) {
      a.apply(1);
      a.done();
    }
    anims.clear();
  }

  const placeOf = (seat: number, key: WheelNumber): THREE.Vector3 => new THREE.Vector3(...cupPlace(terminalOfSeat(seat), NUMBERS.indexOf(key)));
  const chips = new CupChips(placeOf);
  scene.add(chips.root);
  const loose = new THREE.Group(); // piles on their way into a hopper or back to a player
  scene.add(loose);

  // the number that came up, lit on every terminal's plate
  const squareGeo = new THREE.PlaneGeometry(CUP_W, CUP_W).rotateX(-Math.PI / 2);
  const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.1, 0.65), transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
  const winGroup = new THREE.Group();
  scene.add(winGroup);
  function lightSquares(n: WheelNumber | null): void {
    winGroup.clear();
    if (n === null) return;
    const k = NUMBERS.indexOf(n);
    for (let t = 0; t < TERMINALS; t++) {
      const [x, y, z] = cupPlace(t, k);
      const m = new THREE.Mesh(squareGeo, winMat);
      m.position.set(x, y + 0.0006, z);
      m.rotation.y = terminalYaw(t);
      winGroup.add(m);
    }
  }

  /** Light the slot that came up (null: none), from the moment the wheel stops until the next round. */
  function lightSlot(slot: number | null): void {
    glow.visible = slot !== null;
    if (slot !== null) glow.rotation.z = -slot * SECTOR;
  }

  // ------------------------------------------------------------------------------------------
  // The camera: at your terminal while betting; to the wheel when it's pulled, close on the
  // flapper as it slows, then back to exactly where it was for the payout. The flow only says
  // where the camera should be; every frame it eases there, so a step that comes late or twice
  // can't leave it anywhere else. At the seat it is the world's again: nothing here touches it.

  type CamMode = 'seat' | 'wheel' | 'flapper';
  const camera = stage.engine.camera;
  let camMode: CamMode = 'seat';
  /** Where the camera was when it left the seat; null while it is there. */
  let camHome: { pos: THREE.Vector3; quat: THREE.Quaternion } | null = null;
  let camClock = performance.now();
  const camQuat = new THREE.Quaternion();
  const camLook = new THREE.Matrix4();

  function aimCamera(mode: CamMode): void {
    if (mode !== 'seat' && camHome === null) camHome = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
    camMode = mode;
  }

  /** Straight back to the seat (a snapshot, leaving the table). */
  function snapHome(): void {
    if (camHome) {
      camera.position.copy(camHome.pos);
      camera.quaternion.copy(camHome.quat);
    }
    camHome = null;
    camMode = 'seat';
  }

  function moveCamera(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - camClock) / 1000);
    camClock = now;
    if (camHome === null) return;
    let pos: THREE.Vector3;
    let quat: THREE.Quaternion;
    if (camMode === 'seat') {
      pos = camHome.pos;
      quat = camHome.quat;
    } else {
      const to = stage.worldPose(camMode === 'wheel' ? wheelPose(mySeat) : FLAPPER_POSE);
      pos = to.position;
      quat = camQuat.setFromRotationMatrix(camLook.lookAt(to.position, to.target, camera.up));
    }
    const k = 1 - Math.exp(-dt / 0.3);
    camera.position.lerp(pos, k);
    camera.quaternion.slerp(quat, k);
    if (camMode === 'seat' && camera.position.distanceTo(pos) < 0.003 && camera.quaternion.angleTo(quat) < 0.003) snapHome();
  }

  // ------------------------------------------------------------------------------------------
  // DOM

  const panel = new Panel({
    pick: (n) => place(n),
    undo: () => act({ type: 'undo' }),
    clear: () => act({ type: 'clear' }),
    rebet: () => act({ type: 'rebet', double: false }),
    double: () => act({ type: 'rebet', double: true }),
    spin: () => spinNow(),
  });
  const history = new History();
  const players = new Players();
  ctx.ui.append(history.root, players.root, panel.root);
  panel.setHints(
    Object.fromEntries(
      SPOTS.map((s) => [s.key, `${s.key} pays ${paysLabel(s)} · ${s.slots} of ${SLOTS} slots · house edge ${edgePercent(s)}%`]),
    ),
  );

  const tags = new Map<number, { tag: TerminalTag; obj: CSS2DObject }>();
  function tagFor(seat: number): TerminalTag {
    let t = tags.get(seat);
    if (!t) {
      const tag = new TerminalTag();
      const [x, z] = onArc(terminalOfSeat(seat), TERM_R - 0.05);
      t = { tag, obj: stage.label(tag.root, new THREE.Vector3(x, TOP_Y + 0.3, z)) };
      tags.set(seat, t);
    }
    return t.tag;
  }

  // ------------------------------------------------------------------------------------------
  // What the player can do

  const myBets = (): Bets => (mySeat !== null && view ? (view.bets[mySeat] ?? {}) : {});
  const myTotal = () => Object.values(myBets()).reduce((a, b) => a + (b ?? 0), 0);
  const canBet = () => !animating && mySeat !== null && view?.phase === 'betting';

  function act(a: unknown): void {
    if (!canBet()) return;
    ctx.link.act(a);
  }

  function place(n: WheelNumber): void {
    if (!canBet()) return;
    if (panel.pick.kind === 'max') ctx.link.act({ type: 'max', spot: n });
    else ctx.link.act({ type: 'bet', bets: [{ spot: n, amount: panel.pick.spec.value }] });
    ctx.sfx.play('chip-lay', { volume: 0.7 });
  }

  function spinNow(): void {
    if (mode === 'solo' && canBet() && myTotal() > 0) ctx.link.act({ type: 'spin' });
  }

  function refresh(): void {
    const betting = canBet();
    panel.setOpen(betting);
    const all = new Map<WheelNumber, Cents>();
    for (const bets of Object.values(view?.bets ?? {})) for (const n of NUMBERS) all.set(n, (all.get(n) ?? 0) + (bets[n] ?? 0));
    const mine = myBets();
    for (const n of NUMBERS) panel.setSlot(n, mine[n] ?? 0, all.get(n) ?? 0);
    const has = myTotal() > 0;
    panel.undoBtn.disabled = !betting || !has;
    panel.clearBtn.disabled = !betting || !has;
    const canRepeat = mySeat !== null && !!view?.canRebet.includes(mySeat);
    panel.rebetBtn.disabled = !betting || !canRepeat;
    panel.doubleBtn.disabled = !betting || (!has && !canRepeat);
    panel.spinBtn.hidden = mode !== 'solo';
    panel.spinBtn.disabled = !betting || !has;
    panel.setMeters(animating ? undefined : stack, animating ? undefined : myTotal());
    panel.setSeat(mySeat === null ? '' : mode === 'solo' ? 'Alone at the wheel' : `Terminal ${terminalOfSeat(mySeat) + 1} of ${TERMINALS}`);
    refreshTips();
  }

  /** Tips: the line above the controls and a mark on 1, 3 and 5, only while bets can go down. */
  let tipShown = false;
  function refreshTips(): void {
    const show = ctx.tips.on && canBet();
    if (show && !tipShown) ctx.kit.tip(TIP_TEXT);
    else if (!show && tipShown) ctx.kit.tip(null);
    panel.setTipPicks(show);
    tipShown = show;
  }
  const offTips = ctx.tips.subscribe(() => refreshTips());

  // ------------------------------------------------------------------------------------------
  // Clicking the squares on your own terminal works too

  const canvas = stage.engine.renderer.domElement;
  const plates = model.getObjectByName('bw-plates');
  function squareUnder(e: PointerEvent): WheelNumber | null {
    if (e.target !== canvas || mySeat === null || !plates) return null;
    const hit = stage.pickObjects(e, [plates]);
    if (!hit) return null;
    const local = scene.worldToLocal(hit.point.clone());
    const t = terminalOfSeat(mySeat);
    for (let k = 0; k < NUMBERS.length; k++) {
      const [x, , z] = cupPlace(t, k);
      if (Math.hypot(local.x - x, local.z - z) < CUP_W * 0.62) return NUMBERS[k]!;
    }
    return null;
  }
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const n = squareUnder(e);
    if (n !== null) place(n);
  };
  const onMove = (e: PointerEvent) => {
    const n = canBet() ? squareUnder(e) : null;
    canvas.style.cursor = n === null ? '' : 'pointer';
  };
  addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);

  // ------------------------------------------------------------------------------------------
  // Drawing the settled table

  function nameOf(seat: number): string {
    return members.find((m) => m.seat === seat && m.status !== 'watching')?.name ?? `Seat ${seat + 1}`;
  }

  function drawPlayers(): void {
    const seated = members.filter((m) => m.seat !== null && m.status !== 'watching').sort((a, b) => terminalOfSeat(a.seat!) - terminalOfSeat(b.seat!));
    if (mode !== 'multi') {
      players.set([]);
    } else {
      const rows: PlayerRow[] = seated.map((m) => ({
        seat: m.seat!,
        name: m.name,
        stack: m.seat === mySeat ? stack : m.stack,
        you: m.seat === mySeat,
        away: !m.connected,
        bets: view?.bets[m.seat!] ?? {},
        net: !animating && lastNet[m.seat!] !== undefined ? lastNet[m.seat!]! : null,
      }));
      players.set(rows);
    }
    // tags over the terminals of everyone at a shared wheel
    const want = new Set(mode === 'multi' ? seated.map((m) => m.seat!) : []);
    for (const [seat, t] of tags) {
      t.obj.visible = want.has(seat);
    }
    for (const m of seated) {
      if (!want.has(m.seat!)) continue;
      const seat = m.seat!;
      const down = Object.values(view?.bets[seat] ?? {}).reduce((a, b) => a + (b ?? 0), 0);
      const net = lastNet[seat];
      const tag = tagFor(seat);
      tags.get(seat)!.obj.visible = true;
      if (!animating && net !== undefined && view?.phase === 'results') {
        tag.set(seat === mySeat ? 'You' : m.name, net > 0 ? `+${formatMoney(net)}` : net < 0 ? `−${formatMoney(-net)}` : 'even', net > 0 ? 'win' : 'quiet', seat === mySeat);
      } else {
        tag.set(seat === mySeat ? 'You' : m.name, down > 0 ? `${formatMoney(down)} down` : '', down > 0 ? 'down' : '', seat === mySeat);
      }
    }
  }

  function draw(v: BanditView): void {
    view = v;
    chips.sync(v.bets);
    history.set(v.history);
    refresh();
    drawPlayers();
  }

  function clearResult(): void {
    lightSlot(null);
    lightSquares(null);
    panel.setWinner(null);
    shownNumber = null;
  }

  // ------------------------------------------------------------------------------------------
  // The wheel, every frame

  let theta = rotor.rotation.z !== 0 ? -rotor.rotation.z : angleFor(Math.floor(Math.random() * SLOTS), G_TOUCH + 0.2);
  let spin: WheelSpin | null = null;
  let s = 0;
  let driving = false;
  let ticks: number[] = [];
  let tickIdx = 0;
  let relIdx = 0;
  let stopHeard = true;
  let spinClock = 0;
  let spinDone: (() => void) | null = null;
  const sound = new WheelSound(ctx.sfx);

  /** Put the wheel at rest on a slot, the flapper hanging free just inside it (as every spin ends). */
  function restOn(slot: number): void {
    spin = null;
    theta = angleFor(slot, G_TOUCH + 0.12);
  }

  function turnWheel(): void {
    if (spin && driving) {
      s = Math.min(spin.tRest, (performance.now() - spinClock) / 1000);
      if (s >= spin.tRest) spinDone?.();
    }
    if (spin) theta = spin.angle(s);
    rotor.rotation.z = -theta;
    let since: number | null = null;
    if (spin) {
      while (relIdx < ticks.length && ticks[relIdx]! <= s) relIdx++;
      if (relIdx > 0) since = s - ticks[relIdx - 1]!;
    }
    flapper.bend(flapAngle(theta, since));
  }

  function clicks(): void {
    if (!spin || !driving) return;
    const top = Math.max(1, spin.w0);
    while (tickIdx < ticks.length && ticks[tickIdx]! <= s + LOOKAHEAD_S) {
      const t = ticks[tickIdx]!;
      if (t >= s - 0.03) sound.click(t - s, spin.speed(t) / top);
      tickIdx++;
    }
    if (!stopHeard && s >= spin.tStop) {
      stopHeard = true;
      sound.stop();
      lightSlot(spin.plan.slot);
    }
  }

  // The time box on the panel and the screens on every terminal
  let screenKey = '';
  function setScreens(st: ScreenState): void {
    const key = JSON.stringify(st);
    if (key === screenKey) return;
    screenKey = key;
    drawScreen(screens.canvas, st);
    screens.texture.needsUpdate = true;
  }

  function updateTime(): void {
    const v = view;
    if (!v || v.phase === 'idle') {
      panel.setTime('Waiting for players', 'The wheel starts when someone sits down', '–', 0, false);
      setScreens({ kind: 'idle' });
      return;
    }
    if (v.phase === 'betting' && !animating && v.deadline !== null) {
      const left = Math.max(0, v.deadline - serverNow());
      const secs = Math.ceil(left / 1000);
      const note = mode === 'solo' && myTotal() > 0 ? 'Spin now, or wait for the clock' : left <= 5000 ? 'Last bets' : 'Place your chips';
      panel.setTime('Time until next spin', note, String(secs), left / v.window, left <= 5000);
      setScreens({ kind: 'bets', seconds: secs });
      return;
    }
    if (animating && spin && s < spin.tStop) {
      panel.setTime('No more bets', 'The wheel is turning', '–', 0, false);
      setScreens({ kind: 'spin' });
      return;
    }
    const n = shownNumber ?? (v.spin ? v.spin.number : null);
    const next = v.phase === 'results' && v.deadline !== null ? Math.max(0, Math.ceil((v.deadline - serverNow()) / 1000)) : null;
    panel.setTime(n !== null ? callFor(n) : 'No more bets', next !== null ? `Next round in ${next}s` : 'Paying out', n !== null ? String(n) : '–', 0, false);
    if (n !== null) setScreens({ kind: 'result', n });
  }

  // the lamps flash for a big number
  let flashUntil = 0;
  function lamps(): void {
    if (!bulbs) return;
    const now = performance.now();
    const on = now > flashUntil || Math.floor(now / 140) % 2 === 0;
    bulbs.material.color.copy(bulbLit).multiplyScalar(on ? 1 : 0.18);
  }

  // ------------------------------------------------------------------------------------------
  // The spin and the payout

  async function playSpin(e: SpinEvent, settle: SettleEvent | undefined, next: BanditView, quick = false): Promise<void> {
    const g = gen;
    animating = true;
    clearResult();
    refresh();
    drawPlayers();
    const duration = Math.max(1.2, (e.restAt - Math.max(serverNow(), e.startAt)) / 1000);
    spin = new WheelSpin({ theta0: theta, duration, slot: e.slot, ...chooseEnding(Math.random) });
    s = 0;
    ticks = spin.releases();
    tickIdx = 0;
    relIdx = 0;
    stopHeard = false;
    if (duration > 3) sound.pull();
    ctx.kit.say('No more bets', 2400);
    aimCamera('wheel');
    const token = spin;
    void pause(Math.max(0.8, duration - 2.5) * 1000).then(() => {
      if (!disposed && g === gen && spin === token && driving) aimCamera('flapper');
    });
    // The wheel keeps the wall clock (it is the same wheel for everyone at the table), so a slow
    // frame rate never leaves it behind the server; the tween is there so a session catching up
    // (finishAll) can still snap the spin to its end.
    driving = true;
    spinClock = performance.now();
    await Promise.race([new Promise<void>((res) => (spinDone = res)), tween(duration * 1000, () => {}, ease.linear)]);
    spinDone = null;
    driving = false;
    if (disposed || g !== gen) return;
    s = duration;
    if (quick) {
      // watched from a snapshot: the chips already went home, so just the result
      showResult(e, settle, next);
      animating = false;
      await pause(900);
      if (!disposed && g === gen) aimCamera('seat');
      return;
    }
    await payOut(e, settle, next, g);
    if (g === gen) animating = false;
  }

  function lift(p: THREE.Object3D, to: THREE.Vector3, ms: number, arc = 0.02): Promise<void> {
    const from = p.position.clone();
    return play(ms, (k) => {
      p.position.lerpVectors(from, to, k);
      p.position.y = from.y + (to.y - from.y) * k + Math.sin(Math.PI * k) * arc;
    });
  }

  /** Chips going down into a terminal's hopper: they sink into the plate and are gone. */
  function sink(p: THREE.Object3D, ms: number): Promise<void> {
    const y = p.position.y;
    return play(ms, (k) => {
      p.position.y = y - 0.02 * k;
      p.scale.setScalar(Math.max(0.001, 1 - k));
      if (k >= 1) p.removeFromParent();
    });
  }

  /** Where a terminal's winnings come up from: out of the hood behind its screen. */
  function hood(seat: number): THREE.Vector3 {
    const [x, z] = onArc(terminalOfSeat(seat), TERM_R - 0.08);
    return new THREE.Vector3(x, TOP_Y + 0.12, z);
  }

  /** Where a player's chips go home to: the edge of the terminal in front of their stool. */
  function home(seat: number): THREE.Vector3 {
    const [x, z] = onArc(terminalOfSeat(seat), TERM_R + 0.2);
    return new THREE.Vector3(x, TOP_Y - 0.01, z);
  }

  /** The number that came up: on the wheel, every terminal, the panel and the call. Returns this player's net. */
  function showResult(e: SpinEvent, settle: SettleEvent | undefined, next: BanditView): number {
    const n = e.number;
    const spot = spotOf(n)!;
    shownNumber = n;
    history.set(next.history);
    lightSlot(e.slot);
    lightSquares(n);
    panel.setWinner(n);
    ctx.kit.say(`${callFor(n)}. Pays ${paysLabel(spot)}`, 3200);
    const seats = settle?.seats ?? {};
    const mine = mySeat !== null ? seats[mySeat] : undefined;
    lastNet = Object.fromEntries(Object.entries(seats).map(([k, v]) => [Number(k), v.returned - v.wagered]));
    const net = mine ? mine.returned - mine.wagered : 0;
    if (mine) {
      if (net > 0) panel.setWin(`+${formatMoney(net)}`, `${callFor(n)} paid ${paysLabel(spot)} on ${formatMoney(mine.bets.find(([k]) => k === n)?.[1] ?? 0)}`, 'win');
      else if (mine.returned > 0) panel.setWin(net === 0 ? 'Even' : `−${formatMoney(-net)}`, `${callFor(n)} paid ${formatMoney(mine.returned)}, less than you had down`, 'quiet');
      else panel.setWin(`−${formatMoney(mine.wagered)}`, `${callFor(n)} came up. No winning bets`, 'quiet');
    }
    if (n >= 10) flashUntil = performance.now() + 2200;
    drawPlayers();
    return net;
  }

  /**
   * The payout, after the wheel stops: losing chips down the hoppers, winners paid beside their
   * bets, then everything home. It is paced to finish before the server opens the next window,
   * so a slow machine plays it faster rather than eating into the next round's betting.
   */
  async function payOut(e: SpinEvent, settle: SettleEvent | undefined, next: BanditView, g: number): Promise<void> {
    const n = e.number;
    const spot = spotOf(n)!;
    const net = showResult(e, settle, next);
    const seats = settle?.seats ?? {};
    const mine = mySeat !== null ? seats[mySeat] : undefined;
    const big = n >= 10;
    const budget = next.deadline !== null ? next.deadline - serverNow() - 400 : PAYOUT_MS;
    const k = Math.max(0.25, Math.min(1, budget / PAYOUT_MS));
    const ms = (x: number) => x * k;

    // a moment on the flapper, then back to the terminal
    await pause(ms(1100));
    if (disposed || g !== gen) return;
    aimCamera('seat');
    await pause(ms(700));
    if (disposed || g !== gen) return;

    // losing chips go down the hoppers
    const winners: { seat: number; key: WheelNumber; amount: Cents; returned: Cents }[] = [];
    const drops: Promise<void>[] = [];
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
        drops.push(sink(pile, ms(380 + Math.random() * 140)));
      }
    }
    if (drops.length) sound.drop();
    await Promise.all(drops);
    if (disposed || g !== gen) return;

    // winners are paid beside their bets, out of the terminal
    const pays: Promise<void>[] = [];
    const paid: { seat: number; key: WheelNumber; pile: Pile }[] = [];
    for (const w of winners) {
      const pile = new Pile().set(w.returned - w.amount);
      pile.position.copy(hood(w.seat));
      loose.add(pile);
      const bet = chips.pile(w.seat, w.key);
      const at = placeOf(w.seat, w.key);
      pays.push(lift(pile, at.clone().setY(at.y + (bet?.height ?? 0)), ms(560), 0.05));
      paid.push({ seat: w.seat, key: w.key, pile });
      if (w.seat === mySeat) ctx.kit.pill(stage, at.clone().setY(TOP_Y + 0.1), `+${formatMoney(w.returned - w.amount)} · ${paysLabel(spot)}`, 'win', 2800);
    }
    if (pays.length) ctx.sfx.play(winners.some((w) => w.seat === mySeat) ? 'chips-stack' : 'chips-handle', { volume: 0.7 });
    await Promise.all(pays);
    if (disposed || g !== gen) return;

    // a 10 or a 20 that paid this player more than they had down gets its moment
    const hit = mine?.bets.find(([key, , back]) => key === n && back > 0);
    if (mine && hit && net > 0 && big && mySeat !== null) {
      celebrate(
        { stage, ui: ctx.ui, sfx: ctx.sfx },
        {
          title: n === 20 ? 'Twenty' : 'Ten',
          sub: `Pays ${paysLabel(spot)} · ${formatMoney(hit[2] - hit[1], { sign: true })}`,
          tier: n === 20 ? 'huge' : 'big',
          at: placeOf(mySeat, n),
          glow: [...winGroup.children.filter((_, t) => t === terminalOfSeat(mySeat!))],
        },
      );
    }
    await pause(ms(winners.length ? 1200 : 400));
    if (disposed || g !== gen) return;

    // winning bets and their payouts go home to the players
    const homes: Promise<void>[] = [];
    for (const p of paid) {
      const dest = home(p.seat);
      homes.push(lift(p.pile, dest, ms(460)).then(() => void p.pile.removeFromParent()));
      const bet = chips.detach(p.seat, p.key);
      if (bet) {
        loose.add(bet);
        homes.push(lift(bet, dest, ms(460)).then(() => void bet.removeFromParent()));
      }
    }
    await Promise.all(homes);
    loose.clear();
    if (pendingStack !== null) {
      stack = pendingStack;
      pendingStack = null;
    }
  }

  /** A snapshot taken mid-spin (a reconnect, or walking up to the wheel): watch the rest of it. */
  function resumeSpin(v: BanditView): void {
    const sp = v.spin!;
    const e: SpinEvent = { type: 'spin', round: sp.round, slot: sp.slot, number: sp.number, startAt: sp.startAt, restAt: sp.restAt };
    const settle: SettleEvent = { type: 'settle', round: sp.round, slot: sp.slot, number: sp.number, seats: v.settled };
    resumed = true;
    const g = gen;
    void playSpin(e, settle, v, true).then(() => {
      if (g === gen) resumed = false;
      if (!disposed && g === gen && view === v) draw(v);
    });
  }

  // ------------------------------------------------------------------------------------------

  const tableView: TableView & { debug: unknown } = {
    onTable(snap: TableSnapshot) {
      gen++;
      finishAnims();
      mode = snap.meta.mode;
      mySeat = snap.you.seat;
      stack = snap.you.stack;
      pendingStack = null;
      members = snap.members;
      limitMax = snap.meta.config.limits.default?.max ?? limitMax;
      panel.setLimits(limitMax);
      const v = snap.view as BanditView;
      animating = false;
      driving = false;
      snapHome();
      loose.clear();
      chips.clear();
      clearResult();
      lastNet = {};
      view = v;
      if (v.phase === 'results' && v.spin && serverNow() < v.spin.restAt - 400) {
        draw(v);
        resumeSpin(v);
        return;
      }
      if (v.spin) restOn(v.spin.slot);
      if (v.phase === 'results' && v.spin) {
        shownNumber = v.spin.number;
        lightSlot(v.spin.slot);
        lightSquares(v.spin.number);
        panel.setWinner(v.spin.number);
        lastNet = Object.fromEntries(Object.entries(v.settled).map(([k, st]) => [Number(k), st.returned - st.wagered]));
      }
      draw(v);
    },

    async onEvents(events: GameEvent[], v: unknown) {
      const next = v as BanditView;
      let g = gen;
      for (const e of events) {
        if (disposed || g !== gen) return;
        switch (e.type) {
          case 'betting':
            if (resumed) {
              // still finishing a spin seen from a snapshot: stop it where it is and bet
              g = ++gen;
              resumed = false;
              animating = false;
              driving = false;
              if (spin) restOn(spin.plan.slot);
              aimCamera('seat');
            }
            clearResult();
            lastNet = {};
            ctx.kit.say(mode === 'solo' ? 'Place your chips' : 'Place your chips. The wheel spins when the clock runs out', 2600);
            if (view) view = { ...view, phase: 'betting', deadline: next.deadline, round: next.round, bets: {}, settled: {} };
            refresh();
            break;
          case 'bet': {
            if (!view) break;
            const bets = { ...view.bets, [e.seat as number]: e.bets as Bets };
            view = { ...view, bets };
            const grown = chips.sync(bets);
            for (const pile of grown) {
              const y = pile.position.y;
              void play(140, (k) => pile.position.setY(y + 0.03 * (1 - k)), ease.out);
            }
            if (e.seat !== mySeat && grown.length) ctx.sfx.play('chip-lay', { volume: 0.3 });
            refresh();
            drawPlayers();
            break;
          }
          case 'spin':
            await playSpin(e as unknown as SpinEvent, events.find((x) => x.type === 'settle') as unknown as SettleEvent | undefined, next);
            break;
          case 'idle':
            clearResult();
            break;
        }
      }
      if (!disposed && g === gen) draw(next);
    },

    onSeat(msg) {
      if (msg.seat !== null) mySeat = msg.seat;
      if (animating) pendingStack = msg.stack;
      else stack = msg.stack;
      refresh();
      drawPlayers();
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
      if (panel.key(e)) return true;
      if (e.code === 'Space') {
        spinNow();
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
      stepAnims();
      turnWheel();
      moveCamera();
      clicks();
      updateTime();
      lamps();
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 240);
      if (glow.visible) glow.material.opacity = 0.18 + 0.2 * pulse;
      if (winGroup.children.length) winMat.opacity = 0.25 + 0.3 * pulse;
    },

    dispose() {
      snapHome();
      disposed = true;
      finishAnims();
      offTips();
      if (tipShown) ctx.kit.tip(null);
      removeEventListener('pointerdown', onDown);
      removeEventListener('pointermove', onMove);
      canvas.style.cursor = '';
      for (const node of [history.root, players.root, panel.root]) node.remove();
      for (const { obj, tag } of tags.values()) {
        obj.removeFromParent();
        tag.root.remove();
      }
      for (const o of [chips.root, loose, winGroup]) o.removeFromParent();
      squareGeo.dispose();
      winMat.dispose();
      own?.removeFromParent();
      if (!own) {
        // leave the floor's wheel where it stopped, the flapper hanging, the screens asleep
        rotor.rotation.z = -theta;
        flapper.bend(flapAngle(theta, null));
        glow.visible = false;
        drawScreen(screens.canvas, { kind: 'idle' });
        screens.texture.needsUpdate = true;
        if (bulbs) bulbs.material.color.copy(bulbLit);
      }
    },

    // for the headless checks: what the view is doing
    debug: {
      state: () => ({
        mode,
        mySeat,
        phase: view?.phase,
        round: view?.round,
        /** ms left in the betting window (null outside one) */
        left: view?.phase === 'betting' && view.deadline !== null ? view.deadline - serverNow() : null,
        animating,
        camera: camera.position.toArray().map((x) => +x.toFixed(2)),
        camHome: camHome !== null,
        gen,
        resumed,
        bets: myBets(),
        history: view?.history ?? [],
        stack,
        s,
        theta,
        shows: slotAt(theta),
        spin: spin ? { slot: spin.plan.slot, tStop: spin.tStop, tRest: spin.tRest, revolutions: spin.revolutions, ticks: ticks.length } : null,
      }),
      stoolOf: (seat: number) => onArc(terminalOfSeat(seat), STOOL_R),
    },
  };
  return tableView;
}
