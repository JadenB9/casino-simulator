// The Sic Bo table view. You click boxes on the printed layout to put chips down; when betting
// closes ("No more bets") the camera comes in on the glass dome, the bed shakes, and the three
// dice settle on the faces the server rolled. Then the dealer calls them ("Four, four, six.
// Fourteen, big."), every winning box on the layout lights up, the losers are swept, the winners
// paid beside their bets, and the chips pushed back (58 Pa. Code §625a.5).
//
// Multiplayer runs on the server's clock: a 20 second window that closes early once everyone
// connected has pressed Ready, and every player's chips in their own colour.

import * as THREE from 'three';
import './sicbo.css';
import type { TableView, TableViewCtx, TableSnapshot, MembersMsg } from '../contract.ts';
import type { Pose } from '../../table/stage.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import type { Member } from '../../../../shared/src/protocol.ts';
import type { SicBoView, SicBoAction, SeatSettle, RollInfo } from '../../../../shared/src/games/sicbo/protocol.ts';
import { BETTING_MS } from '../../../../shared/src/games/sicbo/engine.ts';
import { spots, spotByKey, spotName, paysLabel, spotRule, houseEdge, winPays, callRoll, facePlural, type Dice } from '../../../../shared/src/games/sicbo/rules.ts';
import { BETTING_CHIPS, formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { ChipTray, el } from '../../ui/kit.ts';
import { tween, wait, ease } from '../../table/tween.ts';
import { CHIP_R, CHIP_H } from '../../table/chips.ts';
import { celebrate, type Tier } from '../../table/celebrate.ts';
import { serverNow } from '../../net/clock.ts';
import { TOP_Y, TABLE_D, TABLE_W, SHAKER_Z, MODEL_FELT, layoutFelt } from './model.ts';
import { areaOf, anchorOf, spotAt, ZE, type Rect } from './layout.ts';
import { Shaker, SHAKER_NAME, buildShaker } from './shaker.ts';
import { LayoutChips, Pile, seatColor, CHIP_SCALE, type PileStyle } from './chips.ts';
import { History, Meters, Board, Tip, Clock, Players, type PlayerRow } from './hud.ts';

const FELT_Y = TOP_Y + 0.0007;
const CHIP_Y = TOP_Y + 0.0009;
/** Where the dealer collects losers and cuts payouts from: beside the shaker. */
const DEALER = new THREE.Vector3(0.3, CHIP_Y, -0.3);
/** Tray chips above the largest bet the table takes ($5,000 on Small or Big) are hidden. */
const TRAY_MAX: Cents = 500_000;
/** The dice settle over this long at the end of the shake. */
const SETTLE_MS = 1_300;

/** Betting: the whole layout from above the players' rail. The shake: close on the dome. */
export const BET_POSE: Pose = { position: [0, 1.95, 1.18], target: [0, TOP_Y, 0.08] };
const DOME_POSE: Pose = { position: [0, TOP_Y + 0.29, SHAKER_Z + 0.33], target: [0, TOP_Y + 0.07, SHAKER_Z] };

export const SEATS: { position: [number, number, number]; yaw: number }[] = [
  ...[-0.975, -0.65, -0.325, 0, 0.325, 0.65, 0.975].map((x) => ({ position: [x, 0, TABLE_D / 2 + 0.32] as [number, number, number], yaw: Math.PI })),
  { position: [TABLE_W / 2 + 0.32, 0, 0.18], yaw: -Math.PI / 2 },
];

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const EVEN_MONEY = ['small', 'big', 'odd', 'even'];

/** One line of advice for the chips this player has down (tips on). */
export function advice(bets: Record<string, Cents>): string {
  let worst: { key: string; edge: number } | null = null;
  for (const key of Object.keys(bets)) {
    const spot = spotByKey(key);
    if (!spot) continue;
    const edge = houseEdge(spot);
    if (!worst || edge > worst.edge) worst = { key, edge };
  }
  if (worst && !EVEN_MONEY.includes(worst.key)) return `House edge on ${spotName(spotByKey(worst.key)!)}: ${pct(worst.edge)}. On Small or Big: 2.78%.`;
  return 'Best bets: Small, Big, Odd, Even at 2.78%. Totals and triples cost 9.7% to 19%.';
}

export function mountSicBo(ctx: TableViewCtx): TableView {
  const stage = ctx.stage;
  const scene = stage.root;

  // The station's model already has the shaker and a low-resolution felt: drive its shaker, and lay
  // a sharp felt over the model's for play.
  let ownShaker: THREE.Object3D | null = null;
  let shakerObj = stage.anchor.getObjectByName(SHAKER_NAME);
  if (!shakerObj) {
    ownShaker = buildShaker(stage.engine.quality);
    ownShaker.position.set(0, TOP_Y, SHAKER_Z);
    scene.add(ownShaker);
    shakerObj = ownShaker;
  }
  const shaker = new Shaker(shakerObj, ctx.sfx);
  const modelFelt = stage.anchor.getObjectByName(MODEL_FELT);
  if (modelFelt) modelFelt.visible = false;
  const felt = layoutFelt(1400);
  stage.addFelt(felt, FELT_Y);

  // state
  let mode: 'solo' | 'multi' = 'solo';
  let mySeat: number | null = null;
  let view: SicBoView | null = null;
  let members: Member[] = [];
  let stack: Cents = 0;
  let pendingStack: Cents | null = null;
  let lastWin: Cents = 0;
  let animating = false;
  let disposed = false;
  let lastNet: Record<number, Cents> = {};

  const styleOf = (seat: number): PileStyle => (mode === 'multi' ? { kind: 'color', color: seatColor(seat) } : { kind: 'value' });
  const chips = new LayoutChips(anchorOf, styleOf, CHIP_Y);
  scene.add(chips.root);
  const loose = new THREE.Group(); // piles being swept, paid or pushed back
  scene.add(loose);

  // light over the layout: the box under the pointer, the winning boxes, the tips' best bets
  const plane = new THREE.PlaneGeometry(1, 1);
  const glowMat = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  const hoverMat = glowMat('#ffe0a0', 0.2);
  const litMat = glowMat('#ffe9b8', 0.3);
  const bestMat = glowMat('#ffd98a', 0.6);
  const hoverGroup = new THREE.Group();
  const litGroup = new THREE.Group();
  const bestGroup = new THREE.Group();
  scene.add(hoverGroup, litGroup, bestGroup);
  const rectMesh = (r: Rect, mat: THREE.Material, inset = 0.007) => {
    const m = new THREE.Mesh(plane, mat);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(r.w - inset, r.d - inset, 1);
    m.position.set(r.x, TOP_Y + 0.0013, r.z);
    return m;
  };
  // the tips' best bets get a lit border, which leaves the printing under it as it is
  for (const key of EVEN_MONEY) {
    const r = areaOf(key)!.rect;
    const t = 0.006;
    for (const [x, z, w, d] of [[r.x, r.z - r.d / 2 + t, r.w, t], [r.x, r.z + r.d / 2 - t, r.w, t], [r.x - r.w / 2 + t, r.z, t, r.d], [r.x + r.w / 2 - t, r.z, t, r.d]] as const) {
      bestGroup.add(rectMesh({ x, z, w: w + 0.004, d: d + 0.004 }, bestMat, 0.004));
    }
  }
  bestGroup.visible = false;
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false });
  const ghost = new THREE.Mesh(new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 32), ghostMat);
  ghost.visible = false;
  ghost.scale.setScalar(CHIP_SCALE);
  scene.add(ghost);

  // The camera: betting happens over the layout; at "No more bets" it comes in on the dome, then
  // goes back to exactly where it was for the lights, the sweep and the payouts.
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
  function glideToDome(ms: number): Promise<void> {
    camHome ??= { pos: camera.position.clone(), quat: camera.quaternion.clone() };
    const to = stage.worldPose(DOME_POSE);
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
  const board = new Board();
  const tip = new Tip();
  const clock = new Clock();
  const players = new Players();
  ctx.ui.append(history.root, meters.root, tip.root, players.root);
  // the result board stands over the game's name, left of the dome, clear of the dealer's line and the banners
  const boardObj = stage.label(board.root, new THREE.Vector3(-0.66, TOP_Y + 0.1, SHAKER_Z + 0.03));
  const clockObj = stage.label(clock.root, new THREE.Vector3(-0.34, TOP_Y + 0.12, SHAKER_Z + 0.03));

  const tray = new ChipTray({
    undo: () => act({ type: 'undo' }),
    clear: () => act({ type: 'clear' }),
    rebet: () => act({ type: 'rebet', double: false }),
    double: () => act({ type: 'rebet', double: true }),
    primary: { label: 'Shake', key: 'Space', run: () => primary() },
  });
  ctx.ui.append(tray.root);
  const chipButtons = [...tray.root.querySelectorAll<HTMLButtonElement>('.chip-btn')];
  BETTING_CHIPS.forEach((spec, i) => {
    if (spec.value > TRAY_MAX && chipButtons[i]) chipButtons[i]!.hidden = true;
  });
  const [undoBtn, clearBtn, rebetBtn, doubleBtn] = [...tray.root.querySelectorAll<HTMLButtonElement>('.acts .btn')];
  const colorNote = el('span', 'sb-color-note');
  colorNote.hidden = true;
  tray.root.append(colorNote);

  // ------------------------------------------------------------------------------------------
  // What the player can do

  const myBets = (): Record<string, Cents> => (mySeat !== null && view ? (view.bets[mySeat] ?? {}) : {});
  const myTotal = () => Object.values(myBets()).reduce((a, b) => a + b, 0);
  const amReady = () => mySeat !== null && !!view?.ready.includes(mySeat);
  const canBet = () => !animating && mySeat !== null && (mode === 'solo' || view?.phase === 'betting');

  function act(a: SicBoAction): void {
    if (!canBet() && a.type !== 'ready') return;
    ctx.link.act(a);
  }

  function primary(): void {
    if (mode === 'multi') {
      if (view?.phase === 'betting' && !animating && mySeat !== null) ctx.link.act({ type: 'ready', on: !amReady() });
      return;
    }
    if (canBet() && view?.phase === 'betting' && myTotal() > 0) ctx.link.act({ type: 'roll' });
  }

  function place(key: string): void {
    if (!canBet()) return;
    ctx.link.act({ type: 'bet', bets: [{ spot: key, amount: tray.selected.value }] });
    ctx.sfx.play('chip-lay', { volume: 0.7 });
  }

  function refreshControls(): void {
    const betting = canBet();
    if (mode === 'multi') tray.setPrimary(amReady() ? 'Waiting' : 'Ready', view?.phase === 'betting' && !animating && mySeat !== null);
    else tray.setPrimary('Shake', betting && view?.phase === 'betting' && myTotal() > 0);
    const has = myTotal() > 0;
    if (undoBtn) undoBtn.disabled = !betting || !has;
    if (clearBtn) clearBtn.disabled = !betting || !has;
    const canRepeat = mySeat !== null && !!view?.canRebet.includes(mySeat);
    if (rebetBtn) rebetBtn.disabled = !betting || !canRepeat;
    if (doubleBtn) doubleBtn.disabled = !betting || (!has && !canRepeat);
    meters.set({ bet: animating ? undefined : myTotal() });
    refreshTips();
  }

  /** Tips on: a line of advice while bets can go down, and the lowest-edge boxes lit softly. */
  function refreshTips(): void {
    const on = ctx.tips.on && canBet() && view !== null && view.phase !== 'idle';
    bestGroup.visible = on;
    ctx.kit.tip(on ? advice(myBets()) : null);
  }
  const offTips = ctx.tips.subscribe(() => refreshTips());

  // ------------------------------------------------------------------------------------------
  // Pointer: hover shows what a box is, what it pays and its edge; a click puts the chip on it

  let hovered: string | null = null;
  const canvas = stage.engine.renderer.domElement;

  function spotUnder(e: PointerEvent): string | null {
    if (e.target !== canvas) return null;
    const hit = stage.pick(e);
    return hit ? spotAt(hit.local.x, hit.local.z) : null;
  }

  function tipLines(key: string): { text: string; cls?: string }[] {
    const spot = spotByKey(key)!;
    const lines: { text: string; cls?: string }[] = [
      { text: `${spotName(spot)} · ${paysLabel(spot)}`, cls: 'sb-tip-name' },
      { text: spotRule(spot), cls: 'sb-tip-rule' },
      { text: `House edge ${pct(houseEdge(spot))}`, cls: 'sb-tip-edge' },
    ];
    for (const [seatStr, bets] of Object.entries(view?.bets ?? {})) {
      const amount = bets[key];
      if (!amount) continue;
      const seat = Number(seatStr);
      lines.push(seat === mySeat ? { text: `Your bet ${formatMoney(amount)}`, cls: 'sb-tip-mine' } : { text: `${nameOf(seat)} ${formatMoney(amount)}`, cls: 'sb-tip-other' });
    }
    return lines;
  }

  function showHover(key: string | null, e: PointerEvent): void {
    if (key !== hovered) {
      hovered = key;
      hoverGroup.clear();
      if (key) hoverGroup.add(rectMesh(areaOf(key)!.rect, hoverMat));
    }
    if (!key) {
      tip.hide();
      ghost.visible = false;
      return;
    }
    tip.show(tipLines(key), e.clientX, e.clientY);
    const a = anchorOf(key)!;
    ghost.visible = canBet();
    ghost.position.set(a[0], CHIP_Y + chips.heightAt(key) + (CHIP_H * CHIP_SCALE) / 2, a[1]);
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
      const dot = el('span', 'sb-player-chip');
      dot.style.backgroundColor = seatColor(mySeat);
      colorNote.replaceChildren(dot, document.createTextNode('Your chips'));
      colorNote.hidden = false;
    }
  }

  /** Light every box the roll wins, as the table's lights do once the dealer enters the dice. */
  function showLit(dice: readonly number[] | null): void {
    litGroup.clear();
    if (!dice) return;
    for (const spot of spots().values()) if (winPays(spot, dice) !== null) litGroup.add(rectMesh(areaOf(spot.key)!.rect, litMat, 0.005));
  }

  function draw(v: SicBoView): void {
    view = v;
    chips.sync(v.bets);
    history.set(v.history);
    refreshControls();
    drawPlayers();
    meters.set({ stack, win: lastWin });
  }

  function updateClock(): void {
    if (mode !== 'multi' || !view || view.phase !== 'betting' || view.deadline === null || animating) {
      clock.hide();
      return;
    }
    const left = view.deadline - serverNow();
    if (left <= 0) clock.hide();
    else clock.set(left, BETTING_MS, left <= 5000 ? 'Last bets' : 'Place bets');
  }

  function clearResult(): void {
    board.hide();
    showLit(null);
  }

  // ------------------------------------------------------------------------------------------
  // The shake and the settlement

  async function playRoll(roll: RollInfo, settle: { seats: Record<number, SeatSettle> } | undefined, next: SicBoView): Promise<void> {
    animating = true;
    onLeave();
    clearResult();
    refreshControls();
    ctx.kit.say('No more bets', 2600);
    const left = Math.max(2_200, roll.restAt - serverNow());
    void glideToDome(900);
    await shaker.roll(roll.dice, roll.round, left - SETTLE_MS, SETTLE_MS);
    if (disposed) return;
    await settleTable(roll.dice, settle?.seats ?? {}, next);
    animating = false;
  }

  function lift(p: THREE.Object3D, to: THREE.Vector3, ms: number, remove = true): Promise<void> {
    const from = p.position.clone();
    return tween(ms, (k) => {
      p.position.lerpVectors(from, to, k);
      p.position.y = from.y + (to.y - from.y) * k + Math.sin(Math.PI * k) * 0.012;
      if (remove && k >= 1) p.removeFromParent();
    }, ease.inOut);
  }

  function seatSpot(seat: number): THREE.Vector3 {
    if (mode === 'solo' || seat === mySeat) return new THREE.Vector3(0.25, CHIP_Y, ZE + 0.08);
    const x = SEATS[seat % SEATS.length]!.position[0];
    return new THREE.Vector3(Math.max(-1.05, Math.min(1.05, x)), CHIP_Y, ZE + 0.08);
  }

  /** The best moment in this player's round, if it paid more than was staked. */
  function moment(mine: SeatSettle | undefined, dice: Dice): { tier: Tier; key: string; title: string; won: Cents } | null {
    if (!mine || mine.returned <= mine.wagered) return null;
    let best: { tier: Tier; key: string; title: string; won: Cents; rank: number } | null = null;
    for (const [key, amount, returned] of mine.bets) {
      if (returned <= amount) continue;
      const spot = spotByKey(key)!;
      let pick: { tier: Tier; title: string; rank: number } | null = null;
      if (spot.kind === 'triple') pick = { tier: 'huge', title: `Triple ${facePlural(dice[0])}`, rank: 3 };
      else if (spot.kind === 'total' && spot.pays >= 50) pick = { tier: 'big', title: `Total ${spot.numbers[0]}`, rank: 2 };
      else if (spot.pays >= 30) pick = { tier: 'nice', title: spot.kind === 'anytriple' ? 'Any triple' : `Total ${spot.numbers[0]}`, rank: 1 };
      if (pick && (!best || pick.rank > best.rank)) best = { ...pick, key, won: returned - amount };
    }
    return best;
  }

  async function settleTable(dice: Dice, seats: Record<number, SeatSettle>, next: SicBoView): Promise<void> {
    history.set(next.history);
    ctx.kit.say(callRoll(dice), 3800);
    const mine = mySeat !== null ? seats[mySeat] : undefined;
    lastNet = Object.fromEntries(Object.entries(seats).map(([k, v]) => [Number(k), v.returned - v.wagered]));
    const net = mine ? mine.returned - mine.wagered : 0;

    // a moment on the dice, then back over the layout, where the winning boxes light up
    await wait(1_100);
    if (disposed) return;
    board.show(dice);
    if (mine) {
      if (net > 0) board.setNet(`You won ${formatMoney(net)}`, 'win');
      else if (mine.returned > 0) board.setNet(`Paid ${formatMoney(mine.returned)} · net ${net === 0 ? 'even' : '−' + formatMoney(-net)}`, 'quiet');
      else board.setNet('No winning bets', 'quiet');
    }
    await glideHome(850);
    if (disposed) return;
    showLit(dice);
    ctx.sfx.play('ui-switch', { volume: 0.35 });
    await wait(450);
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
    if (sweeps.length) ctx.sfx.play('chips-collide', { volume: 0.7 });
    for (const key of new Set(winners.map((w) => w.key))) chips.restack(key);
    await Promise.all(sweeps);
    if (disposed) return;

    // then the winners are paid, the payout set down beside each bet
    const payouts: { pile: Pile; seat: number; key: string }[] = [];
    const pays: Promise<void>[] = [];
    const byKey = new Map<string, number>();
    for (const w of winners) {
      const a = anchorOf(w.key)!;
      const n = byKey.get(w.key) ?? 0;
      byKey.set(w.key, n + 1);
      const pile = new Pile(styleOf(w.seat)).set(w.returned - w.amount);
      pile.position.copy(DEALER);
      loose.add(pile);
      const to = new THREE.Vector3(a[0] + CHIP_R * CHIP_SCALE * 2.2, CHIP_Y, a[1] - n * CHIP_R * CHIP_SCALE * 2.1);
      pays.push(lift(pile, to, 560, false));
      payouts.push({ pile, seat: w.seat, key: w.key });
      if (w.seat === mySeat) {
        const k = (w.returned - w.amount) / w.amount;
        ctx.kit.pill(stage, new THREE.Vector3(to.x, TOP_Y + 0.06, to.z), `+${formatMoney(w.returned - w.amount)} · ${k} to 1`, net > 0 ? 'win' : 'push', 3200);
      }
    }
    if (pays.length) ctx.sfx.play(net > 0 ? 'chips-stack' : 'chips-handle', { volume: 0.8 });
    await Promise.all(pays);
    if (mine && mine.returned > 0) lastWin = mine.returned;
    if (disposed) return;

    const m = moment(mine, dice);
    if (m) {
      const a = anchorOf(m.key)!;
      const spot = spotByKey(m.key)!;
      celebrate({ stage, ui: ctx.ui, sfx: ctx.sfx }, {
        title: m.title,
        sub: `Pays ${paysLabel(spot)} · ${formatMoney(m.won, { sign: true })}`,
        tier: m.tier,
        at: new THREE.Vector3(a[0], CHIP_Y, a[1]),
        glow: chips.pilesAt(m.key),
      });
    }
    await wait(winners.length ? (m ? 2_200 : 1_500) : 700);
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
    if (pushes.length) ctx.sfx.play('chips-handle', { volume: 0.6 });
    await Promise.all(pushes);
    loose.clear();
    if (pendingStack !== null) {
      stack = pendingStack;
      pendingStack = null;
    }
    meters.set({ stack, win: lastWin });
    if (mode === 'solo') ctx.kit.say('Place your bets', 2400);
  }

  // ------------------------------------------------------------------------------------------

  const tableView: TableView & { debug: unknown } = {
    onTable(snap: TableSnapshot) {
      mode = snap.meta.mode;
      mySeat = snap.you.status === 'watching' ? null : snap.you.seat;
      stack = snap.you.stack;
      members = snap.members;
      const v = snap.view as SicBoView;
      animating = false;
      void glideHome(0);
      loose.clear();
      chips.clear();
      clearResult();
      if (v.roll) shaker.show(v.roll.dice, v.roll.round);
      if (v.phase === 'results' && v.roll) {
        board.show(v.roll.dice);
        showLit(v.roll.dice);
      }
      draw(v);
    },

    async onEvents(events: GameEvent[], v: unknown) {
      const next = v as SicBoView;
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
          case 'roll':
            await playRoll(e as unknown as RollInfo, events.find((x) => x.type === 'settle') as unknown as { seats: Record<number, SeatSettle> } | undefined, next);
            break;
          case 'idle':
            clearResult();
            break;
        }
      }
      if (!disposed) draw(next);
    },

    onSeat(msg) {
      mySeat = msg.status === 'watching' ? null : msg.seat;
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
      updateClock();
      const t = performance.now();
      if (litGroup.children.length) litMat.opacity = 0.24 + 0.1 * (0.5 + 0.5 * Math.sin(t / 260));
      if (bestGroup.visible) bestMat.opacity = 0.45 + 0.3 * (0.5 + 0.5 * Math.sin(t / 420));
    },

    dispose() {
      if (camHome) {
        camera.position.copy(camHome.pos);
        camera.quaternion.copy(camHome.quat);
        camHome = null;
      }
      disposed = true;
      offTips();
      ctx.kit.tip(null);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerleave', onLeave);
      for (const node of [history.root, meters.root, tip.root, players.root, tray.root]) node.remove();
      boardObj.removeFromParent();
      clockObj.removeFromParent();
      board.root.remove();
      clock.root.remove();
      for (const o of [chips.root, loose, hoverGroup, litGroup, bestGroup, ghost, felt.mesh]) o.removeFromParent();
      ownShaker?.removeFromParent();
      if (modelFelt) modelFelt.visible = true;
    },

    // for the headless checks: where a spot is on screen, and what the view is doing
    debug: {
      screenOf(key: string): { x: number; y: number } | null {
        const a = anchorOf(key);
        if (!a) return null;
        const p = scene.localToWorld(new THREE.Vector3(a[0], TOP_Y, a[1])).project(stage.engine.camera);
        return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
      },
      state: () => ({ mode, mySeat, phase: view?.phase, round: view?.round, animating, rolling: shaker.rolling, shake: shaker.progress, bets: myBets(), history: view?.history ?? [], stack, lit: litGroup.children.length }),
    },
  };
  return tableView;
}
