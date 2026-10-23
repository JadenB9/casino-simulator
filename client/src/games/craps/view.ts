// The craps table view: chips on the layout for every seat, the puck (and the point's box lit),
// the dice thrown down the table onto the faces the server rolled, the stickman's call and the
// roll's plaque, then losing bets collected and winners paid, the way the dealers work it. Clicks
// on the felt become bets; right-click takes a bet down; shift-click calls a bet on or off. Odds
// (O) goes behind every line and come bet at once, and the quick calls put down Across, Inside or
// the Hardways in one go.

import * as THREE from 'three';
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { TableView, TableViewCtx } from '../contract.ts';
import type { GameEvent, TableConfig } from '../../../../shared/src/engine.ts';
import type { CrapsView as View } from '../../../../shared/src/games/craps/protocol.ts';
import {
  type Bet, type BetKind, type PointNumber,
  betId, parseId, limitKey, oddsLimitKey, maxOdds, isWorking, canToggle,
  PLACE_PAYS, HARD_PAYS, PROPS,
} from '../../../../shared/src/games/craps/rules.ts';
import { stickCall } from '../../../../shared/src/games/craps/calls.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { Felt } from '../../table/felt.ts';
import { around, regionPoints } from '../../table/fit.ts';
import { ChipStack, slideStack, CHIP_H } from '../../table/chips.ts';
import { Die, throwDie } from '../../table/dice.ts';
import { tween, wait, ease } from '../../table/tween.ts';
import { ChipTray, button } from '../../ui/kit.ts';
import { crapsMax, crapsOddsMax, maxRefusal, type MaxBet } from '../../table/max.ts';
import { serverNow } from '../../net/clock.ts';
import { feltSpec, parseRegion, chipSpot, puckSpot, spotRect, DICE_REST, FELT_W, ROW } from './layout.ts';
import { BED_Y } from './model.ts';
import { seatEnd, slotOffset, railSpot, handSpot } from './seats.ts';
import { CrapsHud, RollPlaque } from './hud.ts';
import { SpotRing, PointMark } from './ring.ts';
import { QUICKS, quickBets, quickNumbers, type QuickId } from './quick.ts';
import { crapsAdvice, crapsMoment, edgeLine, spotEdge, type Decided } from './advice.ts';
import { celebrate } from '../../table/celebrate.ts';
import './craps.css';

const SURFACE = BED_Y + 0.0006;
const DIE = 0.019;
/** The dice are drawn a little larger than life so their faces read from the rail (as roulette's chips are). */
const DIE_SCALE = 1.3;

type Part = 'flat' | 'odds';

function discTexture(bg: string, fg: string, label: string, size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = fg;
  g.lineWidth = size * 0.04;
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = fg;
  g.font = `700 ${Math.round(size * (label.length > 2 ? 0.3 : 0.36))}px "Barlow Condensed", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, size / 2, size / 2 + size * 0.02);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A two-sided disc: the puck (OFF black / ON white) or a small ON/OFF lammer button. Discs of one size share their geometry and materials. */
const discs = new Map<string, { geo: THREE.BufferGeometry; mats: THREE.Material[] }>();
function disc(r: number, h: number): { mesh: THREE.Mesh } {
  const key = `${r}:${h}`;
  let d = discs.get(key);
  if (!d) {
    const size = r > 0.02 ? 256 : 96;
    const off = new THREE.MeshStandardMaterial({ map: discTexture('#111111', '#f4efe4', 'OFF', size), roughness: 0.4 });
    const on = new THREE.MeshStandardMaterial({ map: discTexture('#f4efe4', '#111111', 'ON', size), roughness: 0.4 });
    const side = new THREE.MeshStandardMaterial({ color: '#8c8579', roughness: 0.5 });
    d = { geo: new THREE.CylinderGeometry(r, r, h, 40), mats: [side, off, on] };
    discs.set(key, d);
  }
  return { mesh: new THREE.Mesh(d.geo, d.mats) };
}

const RATIO = (r: readonly [number, number]) => `${r[0]} to ${r[1]}`;

/** Name and payout of a spot, for the hover card. */
function describe(spot: string): [string, string] | null {
  const m = /^(box|dc|buy|big|hard)(\d+)$/.exec(spot);
  if (m) {
    const n = Number(m[2]) as PointNumber;
    if (m[1] === 'box') return [`Place ${n}`, `Pays ${RATIO(PLACE_PAYS[n])}; off on the come-out. A come bet here takes odds instead.`];
    if (m[1] === 'dc') return [`Don't come on ${n}`, 'Lay odds behind a don\'t come bet that travelled here.'];
    if (m[1] === 'buy') return [`Buy ${n}`, 'Pays 2 to 1, less 5% of the bet on a win; off on the come-out.'];
    if (m[1] === 'big') return [`Big ${n}`, 'Pays 1 to 1 when the ' + n + ' rolls before a 7.'];
    return [`Hard ${n}`, `Pays ${RATIO(HARD_PAYS[n as 4 | 6 | 8 | 10])}; loses to a 7 or an easy ${n}.`];
  }
  switch (spot) {
    case 'pass': return ['Pass Line', 'Pays 1 to 1. With a point on, a click here takes odds.'];
    case 'passodds': return ['Odds behind the line', 'True odds: 2 to 1 on 4/10, 3 to 2 on 5/9, 6 to 5 on 6/8. Up to 3-4-5x.'];
    case 'dontpass': return ["Don't Pass Bar", 'Pays 1 to 1; 12 on the come-out pushes. With a point on, a click lays odds.'];
    case 'come': return ['Come', 'Pays 1 to 1 on 7 or 11; travels to a point number.'];
    case 'dontcome': return ["Don't Come Bar", 'Pays 1 to 1 on 2 or 3; 12 pushes; travels to a point number.'];
    case 'field': return ['Field', 'One roll. 3, 4, 9, 10, 11 pay 1 to 1; 2 pays 2 to 1; 12 pays 3 to 1.'];
    case 'any7': return ['Any Seven', `One roll. Pays ${RATIO(PROPS.any7.pays)}.`];
    case 'anycraps': return ['Any Craps', `One roll: 2, 3 or 12. Pays ${RATIO(PROPS.anycraps.pays)}.`];
    case 'aces': return ['Aces', `One roll: 2. Pays ${RATIO(PROPS.aces.pays)}.`];
    case 'acedeuce': return ['Ace-Deuce', `One roll: 3. Pays ${RATIO(PROPS.acedeuce.pays)}.`];
    case 'yo': return ['Yo', `One roll: 11. Pays ${RATIO(PROPS.yo.pays)}.`];
    case 'boxcars': return ['Boxcars', `One roll: 12. Pays ${RATIO(PROPS.boxcars.pays)}.`];
    case 'horn': return ['Horn', 'One unit each on 2, 3, 11 and 12, each paid at its own odds. $4 steps.'];
    case 'ce': return ['C & E', 'Half on any craps, half on 11: 3 to 1 on craps, 7 to 1 on 11. $2 steps.'];
  }
  return null;
}

/** The bet a spot holds for this player (what right-click takes down, shift-click calls). */
function spotBet(spot: string, mine: Record<string, Bet>, point: PointNumber | null): { id: string; part?: 'odds' } | null {
  const m = /^(box|dc|buy|big|hard)(\d+)$/.exec(spot);
  if (m) {
    const n = m[2];
    if (m[1] === 'box') return mine[`come${n}`] ? { id: `come${n}`, part: 'odds' } : { id: `place${n}` };
    if (m[1] === 'dc') return mine[`dontcome${n}`] ? (mine[`dontcome${n}`]!.odds ? { id: `dontcome${n}`, part: 'odds' } : { id: `dontcome${n}` }) : { id: `lay${n}` };
    return { id: `${m[1]}${n}` };
  }
  if (spot === 'pass' || spot === 'passodds') return point !== null || spot === 'passodds' ? { id: 'pass', part: 'odds' } : { id: 'pass' };
  if (spot === 'dontpass') return mine.dontpass?.odds ? { id: 'dontpass', part: 'odds' } : { id: 'dontpass' };
  return { id: spot };
}

export class CrapsTable implements TableView {
  private readonly felt = new Felt(feltSpec());
  private readonly stacks = new Map<string, ChipStack>();
  private readonly lammers = new Map<string, THREE.Mesh>();
  private readonly puck = disc(0.038, 0.013);
  private readonly dice: [Die, Die] = [new Die(), new Die()];
  private readonly hud: CrapsHud;
  private readonly tray: ChipTray;
  private v: View | null = null;
  private cfg: TableConfig | null = null;
  /** My chips at the table, for Max. */
  private stack: Cents = 0;
  private solo = true;
  private mySeat: number | null = null;
  private names = new Map<number, string>();
  private puckPoint: number | null | undefined = undefined;
  private rolling = false;
  private readySent = false;
  /** Chips put down since the last roll, for Undo and Clear: each action's chips together, so Undo takes back a whole call. */
  private placed: { id: string; part: Part; amount: Cents }[][] = [];
  /** Bets lost on the last roll, for Rebet. */
  private lost: { kind: BetKind; number?: number; amount: Cents }[] = [];
  private floorFelt: THREE.Object3D | null = null;
  private hoverAt: { x: number; y: number } | null = null;
  /** Tips: the ring on the recommended spot, and the unsubscribe from the setting. */
  private readonly ring = new SpotRing(SURFACE + 0.0003);
  private readonly unTips: () => void;
  /** The point's number box, lit while the puck is ON. */
  private readonly pointMark = new PointMark(SURFACE + 0.0002);
  /** The roll's plaque, and when it goes. */
  private readonly plaque = new RollPlaque();
  private readonly plaqueObj: CSS2DObject;
  private plaqueUntil = 0;
  private readonly oddsBtn: HTMLButtonElement;
  /** A touch on the felt shows that spot's card for a moment (there is no hover on a touch screen). */
  private touchTip: { x: number; y: number; until: number } | null = null;

  constructor(private readonly ctx: TableViewCtx) {
    ctx.stage.addFelt(this.felt, SURFACE - 0.0004);
    // the floor model carries a low-resolution felt; this one replaces it while seated
    this.floorFelt = ctx.stage.anchor.getObjectByName('craps-floor-felt') ?? null;
    if (this.floorFelt) this.floorFelt.visible = false;
    this.puck.mesh.position.set(...this.at(puckSpot(null, 1), 0.006));
    ctx.stage.root.add(this.puck.mesh);
    this.dice.forEach((d, i) => {
      d.scale.setScalar(DIE_SCALE);
      d.position.set(-0.012 + i * 0.03, SURFACE + (DIE * DIE_SCALE) / 2, 0.47);
      ctx.stage.root.add(d);
    });
    this.hud = new CrapsHud(ctx.ui, { quick: (id) => this.quick(id), title: (id) => this.quickTitle(id) });
    this.tray = new ChipTray({
      undo: () => this.undo(),
      clear: () => this.clear(),
      rebet: () => this.rebet(),
      max: { mode: 'pick' },
      primary: { label: 'Roll', run: () => this.primary() },
    });
    // Odds sits with the tray's other actions, before Roll
    this.oddsBtn = button('Odds', () => this.allOdds(), { key: 'O', title: 'Odds behind every line and come bet with room for them: the chip you picked on each, or full odds with Max (O)' });
    const acts = this.tray.root.querySelector('.acts');
    if (acts) acts.append(this.oddsBtn);
    else this.tray.root.append(this.oddsBtn);
    ctx.ui.append(this.tray.root);
    ctx.stage.root.add(this.ring.root, this.pointMark.root);
    this.plaqueObj = ctx.stage.label(this.plaque.root, new THREE.Vector3(0.62, SURFACE + 0.02, ROW.top - 0.02));
    this.unTips = ctx.tips.subscribe(() => this.refreshAdvice());
    addEventListener('pointerdown', this.onPointerDown);
    addEventListener('pointermove', this.onPointerMove);
    addEventListener('contextmenu', this.onContextMenu);
  }

  private at([x, z]: [number, number], lift = 0): [number, number, number] {
    return [x, SURFACE + lift, z];
  }

  /**
   * What stays in view at any window size (table/fit.ts): your end of the layout, the props in the
   * middle, and where the dice come to rest at your end.
   */
  private fitBoard(): void {
    // the roll's plaque stands over the far side of this player's end
    this.plaqueObj.position.x = 0.62 * this.myEnd;
    const end = this.myEnd === 1 ? 'R|' : 'L|';
    const y = SURFACE;
    this.ctx.stage.board(regionPoints(this.felt, (id) => id.startsWith(end) || id.startsWith('C|'), y), around([DICE_REST[0] * this.myEnd, y, DICE_REST[1]], 0.08));
  }

  private get myEnd(): 1 | -1 {
    return this.solo || this.mySeat === null ? 1 : seatEnd(this.mySeat);
  }

  private mine(): Record<string, Bet> {
    return (this.mySeat !== null && this.v?.bets[this.mySeat]) || {};
  }

  private spot(seat: number, id: string, part: Part): THREE.Vector3 {
    const end = this.solo ? 1 : seatEnd(seat);
    const [x, z] = chipSpot(id, part, end);
    const [ox, oz] = this.solo ? [0, 0] : slotOffset(seat, id);
    return new THREE.Vector3(x + ox, SURFACE, z + oz);
  }

  // -------------------------------------------------------------------------------------------
  // Drawing the table from a view

  private draw(v: View): void {
    this.v = v;
    const want = new Map<string, { pos: THREE.Vector3; amount: Cents }>();
    for (const [s, bets] of Object.entries(v.bets)) {
      const seat = Number(s);
      for (const [id, bet] of Object.entries(bets)) {
        want.set(`${seat}|${id}|flat`, { pos: this.spot(seat, id, 'flat'), amount: bet.amount });
        if (bet.odds) want.set(`${seat}|${id}|odds`, { pos: this.spot(seat, id, 'odds'), amount: bet.odds });
      }
    }
    for (const [key, stack] of this.stacks) {
      if (!want.has(key)) {
        stack.removeFromParent();
        this.stacks.delete(key);
      }
    }
    for (const [key, w] of want) {
      let stack = this.stacks.get(key);
      if (!stack) {
        stack = new ChipStack();
        this.stacks.set(key, stack);
        this.ctx.stage.root.add(stack);
      }
      if (stack.amount !== w.amount) stack.set(w.amount);
      stack.position.copy(w.pos);
      stack.visible = true;
    }
    this.drawLammers(v);
    this.placePuck(v.point, false);
    this.refreshControls();
  }

  /** ON/OFF buttons on this player's bets whose working state isn't the plain "on". */
  private drawLammers(v: View): void {
    const want = new Map<string, { pos: THREE.Vector3; on: boolean }>();
    if (this.mySeat !== null) {
      for (const [id, bet] of Object.entries(this.mine())) {
        if (!canToggle(id)) continue;
        const onNumber = /^(come|dontcome)\d+$/.test(id);
        if (onNumber && !bet.odds) continue;
        const working = isWorking(id, bet, v.point);
        const byDefault = isWorking(id, { amount: bet.amount }, v.point);
        if (working && byDefault) continue;
        const part: Part = onNumber ? 'odds' : 'flat';
        const amount = part === 'odds' ? bet.odds! : bet.amount;
        const pos = this.spot(this.mySeat, id, part);
        pos.y += Math.min(20, Math.ceil(amount / 100_000) + 3) * CHIP_H + 0.004;
        want.set(id, { pos, on: working });
      }
    }
    for (const [id, m] of this.lammers) {
      if (!want.has(id)) {
        m.removeFromParent();
        this.lammers.delete(id);
      }
    }
    for (const [id, w] of want) {
      let m = this.lammers.get(id);
      if (!m) {
        m = disc(0.012, 0.004).mesh;
        m.userData.betId = id;
        this.lammers.set(id, m);
        this.ctx.stage.root.add(m);
      }
      m.position.copy(w.pos).add(new THREE.Vector3(0.014, 0, -0.012));
      m.rotation.x = w.on ? Math.PI : 0;
    }
  }

  private placePuck(point: number | null, animate: boolean): Promise<void> {
    const to = new THREE.Vector3(...this.at(puckSpot(point, this.myEnd), 0.006));
    const flipTo = point === null ? 0 : Math.PI;
    const changed = this.puckPoint !== point;
    this.puckPoint = point;
    if (!animate || !changed) {
      this.puck.mesh.position.copy(to);
      this.puck.mesh.rotation.x = flipTo;
      return Promise.resolve();
    }
    const from = this.puck.mesh.position.clone();
    const r0 = this.puck.mesh.rotation.x;
    return tween(650, (k) => {
      this.puck.mesh.position.lerpVectors(from, to, k);
      this.puck.mesh.position.y = to.y + Math.sin(Math.PI * k) * 0.05;
      this.puck.mesh.rotation.x = r0 + (flipTo - r0) * k;
    }, ease.inOut);
  }

  private refreshControls(): void {
    const v = this.v;
    const shooter = v && (this.solo || v.shooter === this.mySeat);
    const seated = this.mySeat !== null;
    const live = Object.keys(this.mine()).length > 0;
    if (!v || !seated) this.tray.setPrimary('Roll', false);
    else if (shooter) this.tray.setPrimary(v.rollRequested ? 'Rolling' : 'Roll', !this.rolling && !v.rollRequested && (this.solo ? live : v.point !== null || !!(this.mine().pass || this.mine().dontpass)));
    else this.tray.setPrimary('Ready', v.phase === 'open' && !v.pauseOver && !this.readySent);
    const leaving = !!v && this.mySeat !== null && v.leaving.includes(this.mySeat);
    if (v) {
      this.hud.update(v, {
        shooterName: v.shooter === null ? null : (this.names.get(v.shooter) ?? null),
        mine: v.shooter === this.mySeat,
        solo: this.solo,
        leaving,
      });
    }
    const canAdd = !!v && seated && !this.rolling && !leaving;
    this.oddsBtn.disabled = !canAdd || this.oddsTargets().length === 0;
    this.hud.setQuick(canAdd);
    this.pointMark.set(v?.point ?? null, this.myEnd);
    this.refreshAdvice();
  }

  /** Tips: the best bets (or the odds nudge) while bets can go down; nothing while the dice fly. */
  private refreshAdvice(): void {
    const v = this.v;
    const leaving = v !== null && this.mySeat !== null && v.leaving.includes(this.mySeat);
    if (!this.ctx.tips.on || !v || this.mySeat === null || this.rolling || leaving) {
      this.ctx.kit.tip(null);
      this.ring.set(null, this.myEnd);
      return;
    }
    const a = crapsAdvice(v.point, this.mine(), (lay, n) => this.limits(oddsLimitKey(lay, n)).step);
    this.ctx.kit.tip(a.text);
    this.ring.set(a.pick, this.myEnd);
  }

  // -------------------------------------------------------------------------------------------
  // Betting

  private limits(key: string) {
    const l = this.cfg?.limits;
    return (l && (l[key] ?? l.default)) || { min: 100, max: 500_000, step: 100 };
  }

  private bet(kind: BetKind, n?: number): void {
    const id = betId(kind, n);
    const l = this.limits(limitKey(kind, n));
    const chip = this.tray.selected.value;
    const cur = this.mine()[id]?.amount ?? 0;
    let amount = Math.max(l.step, Math.round(chip / l.step) * l.step);
    if (cur + amount < l.min) amount = Math.ceil((l.min - cur) / l.step) * l.step;
    const most = this.tray.maxPicked ? this.maxFlat(kind, n) : null;
    if (most && 'none' in most) return this.ctx.kit.toast(maxRefusal(most, l));
    if (most) amount = most.amount;
    this.ctx.link.act({ type: 'bet', bets: [n === undefined ? { kind, amount } : { kind, number: n, amount }] });
    this.ctx.sfx.play('chip-lay');
  }

  /**
   * Odds behind `on`: the chip picked, or full odds with Max, from `stack` (Odds on every bet
   * spends what is left after the ones before). `quiet` leaves the toasts and the chip sound to
   * the caller. Returns what went down.
   */
  private odds(on: string, quiet = false, stack = this.stack): Cents {
    const v = this.v;
    const flat = this.mine()[on];
    if (!v || !flat) return 0;
    const p = parseId(on);
    const n = (on === 'pass' || on === 'dontpass' ? v.point : p.n) as PointNumber | null;
    if (n === null) return 0;
    const lay = p.kind === 'dontpass' || p.kind === 'dontcome';
    const step = this.limits(oddsLimitKey(lay, n)).step;
    const room = maxOdds(p.kind as 'pass', flat.amount, n) - (flat.odds ?? 0);
    let amount = Math.min(Math.max(step, Math.round(this.tray.selected.value / step) * step), Math.floor(room / step) * step);
    const most = this.tray.maxPicked ? this.maxOdds(on, stack) : null;
    if (most && 'none' in most && most.none === 'SHORT') {
      if (!quiet) this.ctx.kit.toast(maxRefusal(most, this.limits(oddsLimitKey(lay, n))));
      return 0;
    }
    if (most && 'amount' in most) amount = most.amount;
    if (amount <= 0 || (most && 'none' in most)) {
      if (!quiet) this.ctx.kit.toast('Full odds are already behind that bet.');
      return 0;
    }
    if (amount > stack) {
      if (!quiet) this.ctx.kit.toast(`Odds of ${formatMoney(amount)} are more than your stack.`);
      return 0;
    }
    this.ctx.link.act({ type: 'odds', on, amount });
    if (!quiet) this.ctx.sfx.play('chip-lay');
    return amount;
  }

  /** This player's line and come bets that have a number and room for more odds. */
  private oddsTargets(): string[] {
    const v = this.v;
    if (!v) return [];
    const out: string[] = [];
    for (const [id, bet] of Object.entries(this.mine())) {
      const p = parseId(id);
      const line = id === 'pass' || id === 'dontpass';
      const n = line ? v.point : (p.kind === 'come' || p.kind === 'dontcome') && p.n !== undefined ? p.n : null;
      if (n === null) continue;
      const lay = p.kind === 'dontpass' || p.kind === 'dontcome';
      const step = this.limits(oddsLimitKey(lay, n)).step;
      const room = maxOdds(p.kind as 'pass', bet.amount, n) - (bet.odds ?? 0);
      if (Math.floor(room / step) * step > 0) out.push(id);
    }
    return out;
  }

  /** Odds (O): behind every line and come bet with room for more, the line first. */
  private allOdds(): void {
    const v = this.v;
    if (!v || this.mySeat === null || this.rolling) return;
    const targets = this.oddsTargets().sort((a, b) => Number(!/pass/.test(a)) - Number(!/pass/.test(b)));
    if (targets.length === 0) {
      const any = Object.keys(this.mine()).some((id) => id === 'pass' || id === 'dontpass' || /^(come|dontcome)\d+$/.test(id));
      this.ctx.kit.toast(!any || v.point === null ? 'Odds go behind a pass, don\'t pass, come or don\'t come bet once it has a number.' : 'Full odds are already behind your bets.');
      return;
    }
    let left = this.stack;
    let short = false;
    for (const on of targets) {
      const sent = this.odds(on, true, left);
      if (sent === 0) short = true;
      left -= sent;
    }
    if (left < this.stack) this.ctx.sfx.play('chip-lay');
    if (short && left === this.stack) this.ctx.kit.toast('Not enough chips for odds there.');
  }

  /** What a quick call would put down with the chip picked now, for its button's title. */
  private quickTitle(id: QuickId): string {
    const q = QUICKS.find((x) => x.id === id)!;
    const v = this.v;
    if (!v || !this.cfg) return q.what;
    const r = quickBets(id, this.cfg, this.tray.selected.value, v.point, this.mine(), this.stack);
    if ('refusal' in r) return `${q.what}. ${r.refusal}`;
    const each = r.bets.map((b) => `${formatMoney(b.amount)} on ${id === 'hardways' ? 'hard ' : ''}${b.number}`).join(', ');
    return `${q.what}: ${each} (${formatMoney(r.total)})`;
  }

  /** Across, Inside or the Hardways, sized from the chip picked, in one batch. */
  private quick(id: QuickId): void {
    const v = this.v;
    if (!v || !this.cfg || this.mySeat === null || this.rolling) return;
    if (quickNumbers(id, v.point).length === 0) return;
    const r = quickBets(id, this.cfg, this.tray.selected.value, v.point, this.mine(), this.stack);
    if ('refusal' in r) return this.ctx.kit.toast(r.refusal);
    this.ctx.link.act({ type: 'bet', bets: r.bets });
    this.ctx.sfx.play('chip-lay');
  }

  /** What a click on this spot does for this player: a flat bet, odds behind one of theirs, or nothing (and why). */
  private route(spot: string): { flat: BetKind; n?: number } | { odds: string } | { none: string } | null {
    const v = this.v;
    if (!v || this.mySeat === null) return null;
    const mine = this.mine();
    const m = /^(box|dc|buy|big|hard)(\d+)$/.exec(spot);
    if (m) {
      const n = Number(m[2]);
      if (m[1] === 'box') return mine[`come${n}`] ? { odds: `come${n}` } : { flat: 'place', n };
      if (m[1] === 'dc') {
        if (mine[`dontcome${n}`]) return { odds: `dontcome${n}` };
        if (v.lay) return { flat: 'lay', n };
        return { none: "Don't come bets travel here from the Don't Come Bar." };
      }
      return { flat: m[1] as BetKind, n };
    }
    if (spot === 'passodds') return { odds: 'pass' };
    if ((spot === 'pass' || spot === 'dontpass') && v.point !== null && mine[spot]) return { odds: spot };
    return { flat: spot as BetKind };
  }

  private place(spot: string): void {
    const r = this.route(spot);
    if (!r) return;
    if ('none' in r) return this.ctx.kit.toast(r.none);
    if ('odds' in r) {
      this.odds(r.odds);
      return;
    }
    this.bet(r.flat, r.n);
  }

  /** What Max puts on a flat bet: its maximum or your chips (a lay's commission included). */
  private maxFlat(kind: BetKind, n?: number): MaxBet | null {
    return this.cfg ? crapsMax(this.cfg, kind, n, this.mine()[betId(kind, n)], this.stack) : null;
  }

  /** What Max puts behind a bet: full odds (3-4-5x, 6x laid) or your chips. */
  private maxOdds(on: string, stack = this.stack): MaxBet | null {
    const v = this.v;
    const flat = this.mine()[on];
    const p = parseId(on);
    const n = (on === 'pass' || on === 'dontpass' ? v?.point : p.n) as PointNumber | null | undefined;
    if (!this.cfg || !flat || n == null) return null;
    return crapsOddsMax(this.cfg, p.kind as 'pass' | 'dontpass' | 'come' | 'dontcome', flat, n, stack);
  }

  private takeDown(spot: string): void {
    const v = this.v;
    if (!v) return;
    const b = spotBet(spot, this.mine(), v.point);
    if (!b || !this.mine()[b.id]) return;
    this.ctx.link.act(b.part ? { type: 'down', id: b.id, part: b.part } : { type: 'down', id: b.id });
  }

  private toggle(spot: string): void {
    const v = this.v;
    if (!v) return;
    const b = spotBet(spot, this.mine(), v.point);
    const bet = b && this.mine()[b.id];
    if (!b || !bet || !canToggle(b.id)) return;
    this.ctx.link.act({ type: 'working', id: b.id, on: !isWorking(b.id, bet, v.point) });
    this.ctx.sfx.play('ui-click');
  }

  private undo(): void {
    const last = this.placed.pop();
    if (!last) return;
    // the newest chips first, as a dealer hands them back
    for (const p of [...last].reverse()) this.ctx.link.act(p.part === 'odds' ? { type: 'down', id: p.id, part: 'odds', amount: p.amount } : { type: 'down', id: p.id, amount: p.amount });
  }

  private clear(): void {
    while (this.placed.length) this.undo();
  }

  private rebet(): void {
    const v = this.v;
    if (!v || this.lost.length === 0) return;
    const ok = this.lost.filter((b) => (b.kind === 'pass' || b.kind === 'dontpass' ? v.point === null : b.kind === 'come' || b.kind === 'dontcome' ? v.point !== null : true));
    if (ok.length === 0) return;
    this.ctx.link.act({ type: 'bet', bets: ok });
    this.ctx.sfx.play('chip-lay');
  }

  private primary(): void {
    const v = this.v;
    if (!v || this.mySeat === null) return;
    if (this.solo || v.shooter === this.mySeat) {
      if (this.rolling) return;
      this.ctx.link.act({ type: 'roll' });
      this.ctx.sfx.play('dice-shake', { volume: 0.7 });
    } else if (!this.readySent) {
      this.readySent = true;
      this.ctx.link.ready(true);
      this.refreshControls();
    }
  }

  /** Remember chips this player just put down (for Undo), by comparing a bet event with what was there. */
  private track(e: GameEvent, before: Record<string, Bet>, into: { id: string; part: Part; amount: Cents }[]): void {
    if (e.seat !== this.mySeat || e.back !== undefined) return;
    const id = String(e.id);
    const now = e.bet as Bet | null;
    const old = before[id];
    if (!now) return;
    const dFlat = now.amount - (old?.amount ?? 0);
    const dOdds = (now.odds ?? 0) - (old?.odds ?? 0);
    if (dFlat > 0) into.push({ id, part: 'flat', amount: dFlat });
    if (dOdds > 0) into.push({ id, part: 'odds', amount: dOdds });
    before[id] = now;
  }

  // -------------------------------------------------------------------------------------------
  // The roll

  private async throwDice(shooter: number | null, faces: [number, number]): Promise<void> {
    const end = this.myEnd;
    const hand = handSpot(shooter);
    const wallX = end * (FELT_W / 2 - 0.05);
    const [rx, rz] = DICE_REST;
    const jitter = (s: number) => (Math.sin(s * 12.9898 + faces[0] * 78.233 + faces[1] * 37.719) * 43758.5453) % 1;
    this.ctx.sfx.play('dice-throw');
    await Promise.all(this.dice.map(async (die, i) => {
      const hit = new THREE.Vector3(wallX, SURFACE + (DIE * DIE_SCALE) / 2, -0.12 + i * 0.1 + jitter(i) * 0.08);
      // throwDie sets a die down half a life-size die above `rest`: lift it by what the scale adds
      const rest = new THREE.Vector3(end * (rx + i * 0.06 + jitter(i + 2) * 0.05), SURFACE + (DIE * (DIE_SCALE - 1)) / 2, rz + (i - 0.5) * 0.08 + jitter(i + 4) * 0.04);
      const from = hand.clone().add(new THREE.Vector3(0, 0, i * 0.02));
      const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.31 + i * 0.1, 0.17, 0.23 - i * 0.07));
      await tween(620 + i * 40, (k) => {
        die.position.lerpVectors(from, hit, k);
        die.position.y = from.y + (hit.y - from.y) * k + Math.sin(Math.PI * k) * 0.16;
        die.quaternion.multiply(spin);
      }, ease.linear);
      this.ctx.sfx.play('dice-throw', { volume: 0.35, rate: 1.3 });
      await throwDie(die, hit, rest, faces[i]!, 1250 + i * 90, i ? -1 : 1);
    }));
  }

  private async playRoll(roll: GameEvent, events: GameEvent[], next: View): Promise<void> {
    const v = this.v;
    this.rolling = true;
    this.plaque.hide();
    this.plaqueUntil = 0;
    this.refreshControls();
    const faces = roll.dice as [number, number];
    const before = (roll.point ?? null) as PointNumber | null;
    const results = events.filter((e) => e.type === 'result');
    const moves = events.filter((e) => e.type === 'move');
    await this.throwDice((roll.shooter ?? null) as number | null, faces);
    this.ctx.kit.say(stickCall(before, faces[0], faces[1]), 3200);
    this.plaque.show(faces[0], faces[1], before, next.point);
    this.plaqueUntil = performance.now() + 5200;

    // Work out this player's result before the chips move.
    let net = 0;
    let decided = false;
    const lost: typeof this.lost = [];
    for (const r of results) {
      if (r.seat !== this.mySeat) continue;
      const bet = v?.bets[r.seat as number]?.[String(r.id)];
      if (!bet) continue;
      decided = true;
      const staked = bet.amount + (r.odds === 'win' || r.odds === 'lose' ? (bet.odds ?? 0) : 0);
      net += r.flat === 'lose' ? -staked : r.flat === 'push' ? 0 : Number(r.win);
      if (r.flat === 'lose') {
        const p = parseId(String(r.id));
        const kind: BetKind = p.kind === 'come' && p.n !== undefined ? 'come' : p.kind === 'dontcome' && p.n !== undefined ? 'dontcome' : p.kind;
        if (kind !== 'lay') lost.push(p.n !== undefined && kind !== 'come' && kind !== 'dontcome' ? { kind, number: p.n, amount: bet.amount } : { kind, amount: bet.amount });
      }
    }
    if (decided) {
      this.lost = lost;
      this.hud.showNet(net);
      this.plaque.setNet(net > 0 ? `You won ${formatMoney(net)}` : net < 0 ? `${formatMoney(net)} this roll` : 'Even this roll', net > 0 ? 'win' : net < 0 ? 'lose' : 'quiet');
    }

    // Collect the losers first...
    const collect: Promise<void>[] = [];
    const bank = (seat: number) => new THREE.Vector3((this.solo ? 1 : seatEnd(seat)) * 0.7, SURFACE, -0.62);
    for (const r of results) {
      const seat = r.seat as number;
      const id = String(r.id);
      const parts: Part[] = [];
      if (r.flat === 'lose') parts.push('flat');
      if (r.odds === 'lose') parts.push('odds');
      for (const part of parts) {
        const s = this.stacks.get(`${seat}|${id}|${part}`);
        if (s) collect.push(slideStack(s, bank(seat), 420).then(() => void (s.visible = false)));
      }
      if (seat === this.mySeat && r.flat === 'lose') this.ctx.kit.pill(this.ctx.stage, this.spot(seat, id, 'flat').setY(SURFACE + 0.03), 'LOSE', 'lose', 1800);
    }
    if (collect.length) {
      this.ctx.sfx.play('chips-collide', { volume: 0.6 });
      this.ctx.stage.gesture('sweep');
      await Promise.all(collect);
      await wait(120);
    }

    // ...then pay the winners beside their bets, and push winnings (and bets that come down) to the rail.
    const payouts: ChipStack[] = [];
    const pay: Promise<void>[] = [];
    for (const r of results) {
      const win = Number(r.win);
      const seat = r.seat as number;
      const id = String(r.id);
      if (win <= 0) continue;
      const at = this.spot(seat, id, 'flat').add(new THREE.Vector3(0.042, 0, 0.004));
      const p = new ChipStack();
      p.set(win);
      p.position.copy(bank(seat));
      this.ctx.stage.root.add(p);
      payouts.push(p);
      pay.push(slideStack(p, at, 480));
      if (seat === this.mySeat) this.ctx.kit.pill(this.ctx.stage, at.clone().setY(SURFACE + 0.035), `WIN ${formatMoney(win, { sign: true })}`, 'win', 2400);
    }
    for (const r of results) {
      if (r.seat === this.mySeat && r.flat === 'push') this.ctx.kit.pill(this.ctx.stage, this.spot(r.seat as number, String(r.id), 'flat').setY(SURFACE + 0.03), 'PUSH', 'push', 1800);
    }
    if (pay.length) {
      this.ctx.sfx.play('chips-stack');
      this.ctx.stage.gesture('pay');
      await Promise.all(pay);
      const moment = decided && this.celebrateRoll(results, faces[0] + faces[1], net);
      await wait(moment ? 1100 : 260);
      const home: Promise<void>[] = [];
      for (const r of results) {
        if (!(Number(r.win) > 0) && r.odds !== 'returned' && r.flat !== 'push') continue;
        const seat = r.seat as number;
        const id = String(r.id);
        const stays = !!next.bets[seat]?.[id];
        const parts: Part[] = stays ? [] : ['flat'];
        if (r.odds === 'win' || r.odds === 'returned') parts.push('odds');
        for (const part of parts) {
          const s = this.stacks.get(`${seat}|${id}|${part}`);
          if (s) home.push(slideStack(s, railSpot(seat), 460).then(() => void (s.visible = false)));
        }
      }
      for (const [i, p] of payouts.entries()) {
        const r = results.filter((x) => Number(x.win) > 0)[i]!;
        home.push(slideStack(p, railSpot(r.seat as number), 460).then(() => void p.removeFromParent()));
      }
      this.ctx.sfx.play('chips-handle', { volume: 0.7, delay: 0.2 });
      await Promise.all(home);
    }

    // Come bets travel to their numbers.
    const travel: Promise<void>[] = [];
    for (const mv of moves) {
      const seat = mv.seat as number;
      const s = this.stacks.get(`${seat}|${String(mv.from)}|flat`);
      if (!s) continue;
      this.stacks.delete(`${seat}|${String(mv.from)}|flat`);
      this.stacks.set(`${seat}|${String(mv.id)}|flat`, s);
      travel.push(slideStack(s, this.spot(seat, String(mv.id), 'flat'), 520));
    }
    const puck = next.point !== before ? this.placePuck(next.point, true) : Promise.resolve();
    await Promise.all([...travel, puck]);
    this.rolling = false;
  }

  /**
   * A point made with odds, a hardway or a high prop: the banner, and the printed spot the bet
   * won on lit up. Only when the roll as a whole gave the player more than it took.
   */
  private celebrateRoll(results: GameEvent[], total: number, net: number): boolean {
    const seat = this.mySeat;
    if (seat === null) return false;
    const decided: Decided[] = [];
    for (const r of results) {
      const bet = r.seat === seat ? this.v?.bets[seat]?.[String(r.id)] : undefined;
      if (bet) decided.push({ id: String(r.id), flat: String(r.flat), win: Number(r.win), bet, ...(r.odds ? { odds: String(r.odds) } : {}) });
    }
    const m = crapsMoment(decided, total, net);
    if (!m) return false;
    // ring the printed box the bet won on (or the chips' spot, for a bet with no box of its own)
    const r = spotRect(m.id, this.solo ? 1 : seatEnd(seat));
    const at = this.spot(seat, m.id, 'flat');
    const spot = r ? { x: (r[0] + r[2]) / 2, z: (r[1] + r[3]) / 2, w: r[2] - r[0], d: r[3] - r[1] } : { x: at.x, z: at.z, w: 0.06, d: 0.06, round: true };
    celebrate({ stage: this.ctx.stage, ui: this.ctx.ui, sfx: this.ctx.sfx }, { title: m.title, sub: m.sub, tier: m.tier, spots: [{ ...spot, y: SURFACE - 0.0004 }] });
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Input

  private onPointerDown = (e: PointerEvent): void => {
    if (!(e.target instanceof HTMLCanvasElement) || !this.v) return;
    const lammer = this.ctx.stage.pickObjects(e, [...this.lammers.values()]);
    if (lammer && e.button === 0) {
      const id = String(lammer.object.userData.betId ?? '');
      const bet = this.mine()[id];
      if (bet) this.ctx.link.act({ type: 'working', id, on: !isWorking(id, bet, this.v.point) });
      return;
    }
    const hit = this.ctx.stage.pick(e);
    if (!hit?.region) return;
    const { spot } = parseRegion(hit.region);
    // a touch has no hover: the spot's card shows for a moment, over the finger
    if (e.pointerType === 'touch' || e.pointerType === 'pen') this.touchTip = { x: e.clientX, y: e.clientY, until: performance.now() + 2400 };
    if (e.button === 2) this.takeDown(spot);
    else if (e.button === 0 && e.shiftKey) this.toggle(spot);
    else if (e.button === 0) this.place(spot);
  };

  private onContextMenu = (e: MouseEvent): void => {
    if (e.target instanceof HTMLCanvasElement) e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    this.hoverAt = e.target instanceof HTMLCanvasElement ? { x: e.clientX, y: e.clientY } : null;
  };

  private updateTip(): void {
    let at = this.hoverAt;
    this.hoverAt = null;
    const touch = this.touchTip;
    if (touch) {
      // read again every frame while it shows, so the chips that just went down are in it
      if (performance.now() > touch.until) {
        this.touchTip = null;
        this.hud.showTip(null, 0, 0);
        return;
      }
      at = { x: touch.x, y: touch.y };
    }
    if (at === null) return;
    const hit = this.ctx.stage.pick({ clientX: at.x, clientY: at.y });
    const spot = hit?.region ? parseRegion(hit.region).spot : null;
    const d = spot ? describe(spot) : null;
    if (!spot || !d || !this.v) {
      this.hud.showTip(null, 0, 0);
      return;
    }
    const lines = [d[0], d[1]];
    if (this.tray.maxPicked) {
      const r = this.route(spot);
      const most = r && 'flat' in r ? this.maxFlat(r.flat, r.n) : r && 'odds' in r ? this.maxOdds(r.odds) : null;
      if (most) lines.push('amount' in most ? `Max ${r && 'odds' in r ? 'odds ' : ''}adds ${formatMoney(most.amount)}` : most.none === 'AT_MAX' ? 'At the maximum' : 'Not enough chips for its minimum');
    }
    // every spot says what it costs, Tips or not
    const edge = spotEdge(spot, this.mine(), this.v.point, !!this.v.lay);
    const b = spotBet(spot, this.mine(), this.v.point);
    const bet = b && this.mine()[b.id];
    if (b && bet) {
      const amount = b.part === 'odds' ? (bet.odds ?? 0) : bet.amount;
      const off = canToggle(b.id) && !isWorking(b.id, bet, this.v.point);
      if (amount > 0) lines.push(`Your ${b.part === 'odds' ? 'odds' : 'bet'}: ${formatMoney(amount)}${off ? ' (off)' : ''}`);
      if (!touch) lines.push(canToggle(b.id) ? 'Right-click takes it down. Shift-click calls it on or off.' : 'Right-click takes it down.');
    }
    this.hud.showTip(lines, at.x, at.y, edge ? edgeLine(edge) : null, !!touch);
  }

  // -------------------------------------------------------------------------------------------
  // TableView

  onTable(snap: Parameters<TableView['onTable']>[0]): void {
    this.cfg = snap.meta.config;
    this.stack = snap.you.stack;
    // the rack: chips up to anything this table takes (its laid odds are the most), from what its
    // smallest bet needs
    const lims = Object.values(this.cfg.limits);
    this.tray.setChipMax(Math.max(...lims.map((l) => l.max)), Math.min(...lims.map((l) => l.min)));
    this.solo = snap.meta.mode === 'solo';
    this.mySeat = snap.you.status === 'watching' ? null : snap.you.seat;
    this.fitBoard();
    this.names = new Map(snap.members.filter((m) => m.seat !== null).map((m) => [m.seat!, m.name]));
    this.placed = [];
    this.draw(snap.view as View);
  }

  async onEvents(events: GameEvent[], view: unknown): Promise<void> {
    const next = view as View;
    const before: Record<string, Bet> = { ...this.mine() };
    const roll = events.find((e) => e.type === 'roll');
    // the chips of one action (a quick call, a rebet) come in one message: one Undo takes them all
    const put: { id: string; part: Part; amount: Cents }[] = [];
    for (const e of events) {
      if (e.type === 'bet') this.track(e, before, put);
      if (e.type === 'open' && this.readySent) {
        this.readySent = false;
        this.ctx.link.ready(false);
      }
    }
    if (put.length) this.placed.push(put);
    if (roll) {
      this.placed = [];
      await this.playRoll(roll, events, next);
      const shooter = events.find((e) => e.type === 'shooter');
      if (shooter && shooter.why !== 'nobet') {
        await wait(900);
        this.ctx.kit.say(shooter.why === 'sevenout' ? 'Dice are out. New shooter coming out' : 'New shooter coming out', 2600);
      }
    } else {
      const shooter = events.find((e) => e.type === 'shooter');
      if (shooter) this.ctx.kit.say(shooter.why === 'nobet' ? 'Line bets before the dice go out. Next shooter' : 'New shooter coming out', 2600);
    }
    this.draw(next);
  }

  onSeat(msg: Parameters<TableView['onSeat']>[0]): void {
    this.mySeat = msg.status === 'watching' ? null : msg.seat;
    this.fitBoard();
    this.stack = msg.stack;
    this.refreshControls();
  }

  onMembers(msg: Parameters<NonNullable<TableView['onMembers']>>[0]): void {
    this.names = new Map(msg.members.filter((m) => m.seat !== null).map((m) => [m.seat!, m.name]));
    this.refreshControls();
  }

  keydown(e: KeyboardEvent): boolean {
    if (this.tray.key(e)) return true;
    if (e.code === 'Space') {
      this.primary();
      return true;
    }
    if (e.key === 'x' || e.key === 'X') {
      this.clear();
      return true;
    }
    if (e.key === 'r' || e.key === 'R') {
      this.rebet();
      return true;
    }
    if (e.key === 'Backspace' || ((e.metaKey || e.ctrlKey) && e.key === 'z')) {
      this.undo();
      return true;
    }
    if ((e.key === 'o' || e.key === 'O') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.allOdds();
      return true;
    }
    return false;
  }

  update(dt: number): void {
    this.updateTip();
    this.ring.update(dt);
    this.pointMark.update(dt);
    if (this.plaqueUntil && performance.now() > this.plaqueUntil) {
      this.plaqueUntil = 0;
      this.plaque.hide();
    }
    this.hud.tick(this.v, serverNow(), this.v?.shooter === this.mySeat);
  }

  dispose(): void {
    removeEventListener('pointerdown', this.onPointerDown);
    removeEventListener('pointermove', this.onPointerMove);
    removeEventListener('contextmenu', this.onContextMenu);
    for (const s of this.stacks.values()) s.removeFromParent();
    for (const m of this.lammers.values()) m.removeFromParent();
    this.stacks.clear();
    this.lammers.clear();
    this.felt.mesh.removeFromParent();
    this.puck.mesh.removeFromParent();
    for (const d of this.dice) d.removeFromParent();
    if (this.floorFelt) this.floorFelt.visible = true;
    this.unTips();
    this.ctx.kit.tip(null);
    this.ring.dispose();
    this.pointMark.dispose();
    this.plaqueObj.removeFromParent();
    this.plaque.root.remove();
    this.hud.dispose();
    this.tray.root.remove();
  }
}
