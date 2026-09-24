// The baccarat table view. Bets go down on your seat's spots on the felt, or with P / B / T (and
// Shift for the pairs); the coup plays out to the result the server already decided: "No more bets",
// four cards face down from the shoe (Player, Banker, Player, Banker), the Player's two turned
// over and then the Banker's, the tableau's calls, third cards dealt face up and sideways, the
// call ("Banker wins, 7 over 5"), losing bets collected, then winners paid from the highest seat
// number down with the commission marked in that seat's box. The scoreboard is redrawn from the
// shoe's history in the view.

import * as THREE from 'three';
import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { TableView, TableViewCtx, TableSnapshot, SeatMsg, MembersMsg } from '../contract.ts';
import type { GameEvent, TableConfig } from '../../../../shared/src/engine.ts';
import type { Member } from '../../../../shared/src/protocol.ts';
import type { Card } from '../../../../shared/src/cards.ts';
import { type Cents, formatMoney } from '../../../../shared/src/money.ts';
import type { BaccaratEvent, BaccaratView, ShoeView } from '../../../../shared/src/games/baccarat/protocol.ts';
import {
  type Bets, type Coup, type Hand, type Spot, SPOTS, SPOT_NAMES, betTotal, handTotal, seatNumber,
} from '../../../../shared/src/games/baccarat/rules.ts';
import { engine, limitsFor } from '../../../../shared/src/games/baccarat/engine.ts';
import { bestBet, bettingTip } from '../../../../shared/src/games/baccarat/advice.ts';
import { celebrate } from '../../table/celebrate.ts';
import { coupMoment } from './moments.ts';
import { Felt } from '../../table/felt.ts';
import { CardMesh, CARD_H, dealCard, flipCard } from '../../table/cards.ts';
import { ChipStack, slideStack } from '../../table/chips.ts';
import { ease, tween, wait } from '../../table/tween.ts';
import { ChipTray, button, el } from '../../ui/kit.ts';
import { baccaratMax, chipOn, maxRefusal } from '../../table/max.ts';
import { serverNow } from '../../net/clock.ts';
import { feltSpec, kidneyGeometry } from './felt.ts';
import { setDiscardHeight } from './model.ts';
import { Scoreboard } from './scoreboard.ts';
import {
  BANDS, BURN_SPOT, CUT_SPOT, CZ, DISCARD_TOP, HAND_BOX, HAND_CARD_SCALE, NUMBER_R, PAIR_RADIUS, RACK_POINT, SHOE_MOUTH, TOP_Y,
  commissionBox, handSlot, parseRegion, polar, regionId, seatAngle, sectorPoints, spotCentre,
} from './layout.ts';
import './baccarat.css';

type ResultEvent = Extract<BaccaratEvent, { type: 'result' }>;

const HANDS = ['player', 'banker'] as const;
const KEYS: Record<Spot, string> = { player: 'P', banker: 'B', tie: 'T', playerPair: 'Shift P', bankerPair: 'Shift B' };
const PAYS_LONG: Record<Spot, string> = {
  player: 'pays 1 to 1',
  banker: 'pays 1 to 1 less 5% commission',
  tie: 'pays 8 to 1; Player and Banker bets push',
  playerPair: "pays 11 to 1 when the Player's first two cards are a pair",
  bankerPair: "pays 11 to 1 when the Banker's first two cards are a pair",
};

const SQUEEZE_KEY = 'casino.baccarat.squeeze';
const cap = (h: Hand) => (h === 'player' ? 'Player' : 'Banker');

function loadSqueeze(): boolean {
  try {
    return localStorage.getItem(SQUEEZE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveSqueeze(on: boolean): void {
  try {
    localStorage.setItem(SQUEEZE_KEY, on ? '1' : '0');
  } catch {
    /* storage blocked */
  }
}

/** The dealer's call for a finished coup. */
function outcomeLine(winner: Coup['winner'], p: number, b: number): string {
  if (winner === 'tie') return `Tie hand, ${p}-${b}`;
  return winner === 'banker' ? `Banker wins, ${b} over ${p}` : `Player wins, ${p} over ${b}`;
}

function naturalLine(p: number, b: number): string {
  if (p >= 8 && b >= 8) return p === b ? `Natural ${p} each` : p > b ? `Natural ${p}, Player` : `Natural ${b}, Banker`;
  return p >= 8 ? `Natural ${p}, Player` : `Natural ${b}, Banker`;
}

export class BaccaratTable implements TableView {
  private readonly root: THREE.Group;
  private readonly felt: Felt;
  private readonly staticFelt: THREE.Object3D | undefined;
  private readonly board = new Scoreboard();
  private readonly tray: ChipTray;
  private readonly metersBox = el('div', 'bc-meters panel');
  private readonly meters = { stack: el('b', 'money'), bet: el('b', 'money'), last: el('b', 'money') };
  private readonly squeezeBtn: HTMLButtonElement;
  private readonly tip = el('div', 'bc-tip panel');

  private readonly stacks = new Map<string, ChipStack>();
  private pays: { seat: number; stack: ChipStack }[] = [];
  private cards: Record<Hand, CardMesh[]> = { player: [], banker: [] };
  private readonly faces = new Map<CardMesh, Card>();
  private readonly totals: Record<Hand, { el: HTMLElement; num: HTMLElement; obj: CSS2DObject }>;
  private readonly cut: THREE.Mesh;
  private readonly mine: THREE.Mesh;
  private readonly hilite = new Map<string, THREE.Mesh>();
  private hovered: THREE.Mesh | null = null;
  private readonly timer: { el: HTMLElement; ring: SVGCircleElement; num: HTMLElement; obj: CSS2DObject };
  private readonly seatTags = new Map<number, { el: HTMLElement; obj: CSS2DObject }>();
  private readonly labels: { obj: CSS2DObject; until: number }[] = [];

  private view: BaccaratView | null = null;
  private config: TableConfig = engine.config('', 'solo');
  private mode: 'solo' | 'multi' = 'solo';
  private mySeat: number | null = null;
  private stack: Cents = 0;
  private myBets: Bets = {};
  private lastBets: Bets | null = null;
  private lastNet: Cents | null = null;
  private ready = false;
  private squeeze = loadSqueeze();
  private members: Member[] = [];
  private disposed = false;
  /** Set once the session snaps an animation because messages piled up: the rest of the batch plays at once. */
  private rush = false;
  /** When the last batch finished; a batch that starts right after a rushed one was queued behind it. */
  private lastEnd = 0;
  private shoeNo = 0;
  /** "No more bets" has been called for the window in the view (it updates only after the coup plays out). */
  private closed = false;
  /** A coup is being dealt: from "No more bets" until its batch has played out. */
  private dealing = false;
  /** The Tips mark on your seat's best bet, and which spot it lights. */
  private tipMark: { mesh: THREE.Mesh; region: string } | null = null;
  private readonly offTips: () => void;

  constructor(private readonly ctx: TableViewCtx) {
    this.root = ctx.stage.root;

    // The interactive felt replaces the model's static one while we're seated.
    this.felt = new Felt(feltSpec());
    this.felt.mesh.geometry.dispose();
    this.felt.mesh.geometry = kidneyGeometry();
    ctx.stage.addFelt(this.felt, TOP_Y + 0.0004);
    this.staticFelt = ctx.stage.anchor.getObjectByName('bc-felt-static');
    if (this.staticFelt) this.staticFelt.visible = false;

    // the red plastic cut card, out beside the shoe once it has come up
    this.cut = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.0006, 0.092), new THREE.MeshStandardMaterial({ color: '#c3202c', roughness: 0.35 }));
    this.cut.position.copy(CUT_SPOT);
    this.cut.rotation.y = 0.35;
    this.cut.visible = false;
    this.root.add(this.cut);

    // a brass ring around your seat's number
    this.mine = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0022, 8, 48), new THREE.MeshStandardMaterial({ color: '#f1d59a', emissive: '#b58a3c', emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.6 }));
    this.mine.rotation.x = Math.PI / 2;
    this.mine.visible = false;
    this.root.add(this.mine);

    this.totals = {
      player: this.totalLabel('player'),
      banker: this.totalLabel('banker'),
    };
    this.timer = this.makeTimer();

    // DOM: scoreboard, meters, chip tray, hover tip
    this.tray = new ChipTray({
      undo: () => this.act({ type: 'undo' }),
      clear: () => this.act({ type: 'clear' }),
      rebet: () => this.rebet(),
      double: () => this.double(),
      max: { mode: 'pick' },
      primary: { label: 'Deal', run: () => this.primary() },
    });
    this.tray.root.classList.add('bc-tray');
    this.squeezeBtn = button('Squeeze', () => this.toggleSqueeze(), { cls: 'ghost bc-squeeze', key: 'S', title: 'Peel the second card of each hand slowly' });
    this.buildMeters();
    this.tip.hidden = true;
    this.tip.setAttribute('role', 'tooltip');
    ctx.ui.append(this.board.root, this.metersBox, this.tray.root, this.tip);

    addEventListener('pointerdown', this.onPointerDown);
    addEventListener('pointermove', this.onPointerMove);
    this.offTips = ctx.tips.subscribe(() => this.renderTip());
  }

  // -------------------------------------------------------------------------------------------
  // TableView

  onTable(snap: TableSnapshot): void {
    this.mode = snap.meta.mode;
    this.config = snap.meta.config;
    // the rack: chips up to the Player and Banker maximum, from what the smallest bet (a pair) needs
    this.tray.setChipMax(limitsFor(this.config, 'banker').max, limitsFor(this.config, 'playerPair').min);
    this.mySeat = snap.you.seat;
    this.stack = snap.you.stack;
    this.members = snap.members;
    this.draw(snap.view as BaccaratView);
    this.drawSeats();
  }

  async onEvents(events: GameEvent[], raw: unknown): Promise<void> {
    const next = raw as BaccaratView;
    const evs = events as unknown as BaccaratEvent[];
    const results = evs.filter((e): e is ResultEvent => e.type === 'result');
    const wasLastHand = this.view?.shoe.lastHand ?? false;
    const totals: Record<Hand, number> = { player: 0, banker: 0 };
    let settled = false;
    // Keep hurrying through a backlog: a batch that was waiting behind a rushed one starts at once.
    this.rush = this.rush && performance.now() - this.lastEnd < 30;
    for (const e of evs) {
      if (this.disposed) return;
      switch (e.type) {
        case 'betting':
          await this.sweep();
          this.closed = false;
          this.renderTip();
          this.ready = false;
          if (this.mode === 'multi') {
            this.ctx.link.ready(false);
            this.ctx.kit.say('Place your bets');
          }
          break;
        case 'bet':
          this.setBets(e.seat, e.bets);
          if (e.seat === this.mySeat) {
            this.myBets = { ...e.bets };
            this.ctx.sfx.play('chip-lay');
            this.drawMeters();
          } else {
            this.ctx.sfx.play('chip-lay', { volume: 0.5 });
          }
          break;
        case 'refund':
          this.stackFor(e.seat, e.spot).set(0);
          if (e.seat === this.mySeat) this.ctx.kit.toast(`Your ${SPOT_NAMES[e.spot]} bet was under the ${formatMoney(limitsFor(this.config, e.spot).min)} minimum and came back.`);
          break;
        case 'nomore':
          this.closed = true;
          this.dealing = true;
          this.renderTip();
          this.hideTip();
          this.ctx.kit.say(wasLastHand ? 'Last hand. No more bets' : 'No more bets', 1800);
          await this.pause(450);
          break;
        case 'shuffle':
          await this.shuffle(e.shoe);
          break;
        case 'burn':
          await this.burn(e.card, e.count);
          break;
        case 'cutcard':
          this.ctx.kit.say('Cut card', 1600);
          this.ctx.sfx.play('card-place');
          this.cut.visible = true;
          await this.play(420, (ms) => slide(this.cut, SHOE_MOUTH, CUT_SPOT, ms));
          break;
        case 'card':
          await this.deal(e.hand, e.card, e.faceUp);
          if (e.faceUp) {
            totals[e.hand] = handTotal(this.cards[e.hand].map((m) => this.faces.get(m)!));
            this.showTotal(e.hand, totals[e.hand]);
          }
          break;
        case 'reveal':
          totals[e.hand] = e.total;
          await this.reveal(e.hand);
          this.showTotal(e.hand, e.total);
          this.ctx.kit.say(e.hand === 'player' ? `Player ${e.total}` : `Player ${totals.player} · Banker ${e.total}`);
          await this.pause(500);
          break;
        case 'natural':
          this.ctx.kit.say(naturalLine(e.player, e.banker));
          await this.pause(700);
          break;
        case 'draw':
          this.ctx.kit.say(`${cap(e.hand)} draws`, 1400);
          await this.pause(300);
          break;
        case 'stand':
          this.ctx.kit.say(`${cap(e.hand)} stands`, 1400);
          await this.pause(500);
          break;
        case 'outcome':
          this.markWinner(e.winner);
          this.ctx.kit.say(outcomeLine(e.winner, e.player, e.banker), 3600);
          this.board.set(next.history, next.shoe);
          await this.pause(700);
          break;
        case 'result':
          if (!settled) {
            settled = true;
            await this.settle(results, next.coup);
          }
          break;
        case 'lasthand':
          await this.pause(400);
          this.ctx.kit.say('The cut card is out: one more coup, then a new shoe', 3200);
          break;
        case 'idle':
          break;
      }
    }
    this.dealing = false;
    this.draw(next);
    this.lastEnd = performance.now();
  }

  onSeat(msg: SeatMsg): void {
    this.stack = msg.stack;
    if (msg.seat !== null) this.mySeat = msg.seat;
    this.drawMeters();
    this.renderTip();
  }

  onMembers(msg: MembersMsg): void {
    this.members = msg.members;
    this.drawSeats();
  }

  onError(): void {
    this.ctx.sfx.play('ui-switch', { volume: 0.4 });
  }

  keydown(e: KeyboardEvent): boolean {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      this.act({ type: 'undo' });
      return true;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    if (this.tray.key(e)) return true;
    const k = e.key.toLowerCase();
    if (k === 'p') this.bet(e.shiftKey ? 'playerPair' : 'player');
    else if (k === 'b') this.bet(e.shiftKey ? 'bankerPair' : 'banker');
    else if (k === 't') this.bet('tie');
    else if (e.code === 'Space') this.primary();
    else if (e.key === 'Backspace') this.act({ type: 'undo' });
    else if (k === 'x') this.act({ type: 'clear' });
    else if (k === 'r' && e.shiftKey) this.double();
    else if (k === 'r') this.rebet();
    else if (k === 's') this.toggleSqueeze();
    else return false;
    return true;
  }

  update(): void {
    const v = this.view;
    const betting = this.mode === 'multi' && !this.closed && v?.phase === 'betting' && v.deadline !== null;
    this.timer.obj.visible = betting;
    if (betting) {
      const left = Math.max(0, v.deadline! - serverNow());
      const secs = Math.ceil(left / 1000);
      if (this.timer.num.textContent !== String(secs)) this.timer.num.textContent = String(secs);
      const full = 2 * Math.PI * 19;
      this.timer.ring.style.strokeDashoffset = String(full * (1 - Math.min(1, left / 15_000)));
      this.timer.el.classList.toggle('late', left < 4_000);
    }
    const now = performance.now();
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const l = this.labels[i]!;
      if (now >= l.until) {
        l.obj.element.remove();
        l.obj.removeFromParent();
        this.labels.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.offTips();
    this.ctx.kit.tip(null);
    this.tipMark?.mesh.removeFromParent();
    removeEventListener('pointerdown', this.onPointerDown);
    removeEventListener('pointermove', this.onPointerMove);
    this.board.dispose();
    this.metersBox.remove();
    this.tray.root.remove();
    this.tip.remove();
    if (this.staticFelt) this.staticFelt.visible = true;
    for (const m of [...this.cards.player, ...this.cards.banker]) m.removeFromParent();
    for (const s of this.stacks.values()) s.removeFromParent();
    for (const p of this.pays) p.stack.removeFromParent();
    for (const h of this.hilite.values()) h.removeFromParent();
    this.cut.removeFromParent();
    this.mine.removeFromParent();
    this.felt.mesh.removeFromParent();
    this.ctx.stage.engine.renderer.domElement.style.cursor = '';
  }

  // -------------------------------------------------------------------------------------------
  // Betting

  private act(a: Record<string, unknown>): void {
    this.ctx.link.act(a);
  }

  /** An animation's length, or none while the table is catching up with the server. */
  private ms(n: number): number {
    return this.rush ? 0 : n;
  }

  /**
   * Run an animation. When the session snaps animations (finishAll, because messages piled up)
   * one lands early; from then on the rest of this batch plays at once.
   */
  private async play(n: number, run: (ms: number) => Promise<unknown>): Promise<void> {
    const d = this.ms(n);
    const t0 = performance.now();
    await run(d);
    if (d > 0 && performance.now() - t0 < d * 0.5) this.rush = true;
  }

  private pause(n: number): Promise<void> {
    return this.play(n, (ms) => wait(ms));
  }

  private bet(spot: Spot): void {
    if (this.mySeat === null) return;
    // a chip that would leave the spot under its minimum puts the minimum down, as a dealer asks
    let amount = chipOn(this.tray.selected.value, this.myBets[spot] ?? 0, limitsFor(this.config, spot));
    // Max picked: the most this spot takes, or every chip here if that is less
    if (this.tray.maxPicked) {
      const m = baccaratMax(this.config, spot, this.myBets, this.stack);
      if ('none' in m) return this.ctx.kit.toast(maxRefusal(m, limitsFor(this.config, spot)));
      amount = m.amount;
    }
    this.act({ type: 'bet', [spot]: amount });
  }

  private rebet(): void {
    if (!this.lastBets || betTotal(this.myBets) > 0) return;
    this.act({ type: 'bet', ...this.lastBets });
  }

  /** Double what's down; with nothing down, the last coup's bets twice over. */
  private double(): void {
    const down = betTotal(this.myBets) > 0;
    const base = down ? this.myBets : this.lastBets;
    if (!base) return;
    const add: Bets = {};
    for (const spot of SPOTS) if (base[spot]) add[spot] = base[spot]! * (down ? 1 : 2);
    this.act({ type: 'bet', ...add });
  }

  private primary(): void {
    if (this.mode === 'solo') {
      this.act({ type: 'deal' });
      return;
    }
    if (this.view?.phase !== 'betting' || this.ready) return;
    this.ready = true;
    this.ctx.link.ready(true);
    this.drawMeters();
  }

  private toggleSqueeze(): void {
    this.squeeze = !this.squeeze;
    saveSqueeze(this.squeeze);
    this.squeezeBtn.setAttribute('aria-pressed', String(this.squeeze));
    this.ctx.sfx.play('ui-click', { volume: 0.5 });
  }

  private onCanvas(e: PointerEvent): boolean {
    return e.target === this.ctx.stage.engine.renderer.domElement;
  }

  /** Your own seat's spot under the pointer: you can only bet in front of your seat. */
  private spotAt(e: PointerEvent): { spot: Spot; region: string } | null {
    if (this.mySeat === null || !this.onCanvas(e)) return null;
    const hit = this.ctx.stage.pick(e);
    const r = parseRegion(hit?.region ?? null);
    if (!r || r.seatNo !== seatNumber(this.mySeat)) return null;
    return { spot: r.spot, region: hit!.region! };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const s = this.spotAt(e);
    if (s) this.bet(s.spot);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const s = this.spotAt(e);
    const mesh = s ? this.highlight(s.region, s.spot) : null;
    if (mesh !== this.hovered) {
      if (this.hovered) this.hovered.visible = false;
      if (mesh) mesh.visible = true;
      this.hovered = mesh;
      this.ctx.stage.engine.renderer.domElement.style.cursor = mesh ? 'pointer' : '';
    }
    if (!s) return this.hideTip();
    const lim = limitsFor(this.config, s.spot);
    const mine = this.myBets[s.spot];
    this.tip.replaceChildren(
      el('b', '', `${SPOT_NAMES[s.spot]} (${KEYS[s.spot]})`),
      el('span', '', PAYS_LONG[s.spot]),
      el('span', 'bc-tip-meta', `${formatMoney(lim.min)} to ${formatMoney(lim.max)}${mine ? ` · your bet ${formatMoney(mine)}` : ''}${this.maxNote(s.spot)}`),
    );
    this.tip.hidden = false;
    this.tip.style.left = `${Math.min(innerWidth - 260, e.clientX + 16)}px`;
    this.tip.style.top = `${Math.max(8, e.clientY - 70)}px`;
  };

  /** With Max picked, what a click on this spot would put down. */
  private maxNote(spot: Spot): string {
    if (!this.tray.maxPicked) return '';
    const m = baccaratMax(this.config, spot, this.myBets, this.stack);
    return 'amount' in m ? ` · Max adds ${formatMoney(m.amount)}` : '';
  }

  private hideTip(): void {
    this.tip.hidden = true;
  }

  private highlight(region: string, spot: Spot): THREE.Mesh {
    let m = this.hilite.get(region);
    if (m) return m;
    m = this.spotMesh(region, spot, '#f6dfa6', 0.13, TOP_Y + 0.0009);
    this.hilite.set(region, m);
    return m;
  }

  /** A flat mesh in the shape of a betting spot on the felt, hidden until shown. */
  private spotMesh(region: string, spot: Spot, color: string, opacity: number, y: number): THREE.Mesh {
    const r = parseRegion(region)!;
    const a = seatAngle(r.seatNo);
    let shape: THREE.Shape;
    if (spot === 'playerPair' || spot === 'bankerPair') {
      const [x, z] = spotCentre(r.seatNo, spot);
      shape = new THREE.Shape();
      shape.absarc(x, -z, PAIR_RADIUS, 0, Math.PI * 2, false);
    } else {
      const b = BANDS[spot];
      shape = new THREE.Shape(sectorPoints(b.r0, b.r1, a - b.half, a + b.half, 16).map(([x, z]) => new THREE.Vector2(x, -z)));
    }
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.visible = false;
    this.root.add(m);
    return m;
  }

  /** Whether you can put chips down now: the window is open (solo: whenever no coup is being dealt). */
  private canBet(): boolean {
    if (this.mySeat === null || this.dealing) return false;
    return this.mode === 'solo' || (this.view?.phase === 'betting' && !this.closed);
  }

  /**
   * Tips: while you can bet, which bet gives the house the least and which the most, with your
   * seat's lowest-edge spot lit in brass on the felt (the bets here are made on the felt, not with
   * buttons).
   */
  private renderTip(): void {
    const on = this.ctx.tips.on && this.canBet();
    this.ctx.kit.tip(on ? bettingTip() : null);
    const region = on ? regionId(seatNumber(this.mySeat!), bestBet()) : null;
    if (this.tipMark && this.tipMark.region !== region) {
      this.tipMark.mesh.visible = false;
      if (region) {
        this.tipMark.mesh.removeFromParent();
        this.tipMark = null;
      }
    }
    if (region && !this.tipMark) this.tipMark = { mesh: this.spotMesh(region, bestBet(), '#f1d59a', 0.22, TOP_Y + 0.0008), region };
    if (this.tipMark) this.tipMark.mesh.visible = !!region;
  }

  // -------------------------------------------------------------------------------------------
  // Chips

  private spotPos(seat: number, spot: Spot): THREE.Vector3 {
    const [x, z] = spotCentre(seatNumber(seat), spot);
    return new THREE.Vector3(x, TOP_Y + 0.0006, z);
  }

  /** Where a payout lands: touching the bet, on the seat's right. */
  private payPos(seat: number, spot: Spot): THREE.Vector3 {
    const [x, z] = spotCentre(seatNumber(seat), spot);
    const r = Math.hypot(x, z - CZ);
    const [px, pz] = polar(r, Math.atan2(z - CZ, x) - 0.044 / r);
    return new THREE.Vector3(px, TOP_Y + 0.0006, pz);
  }

  private stackFor(seat: number, spot: Spot): ChipStack {
    const key = `${seat}:${spot}`;
    let s = this.stacks.get(key);
    if (!s) {
      s = new ChipStack();
      s.position.copy(this.spotPos(seat, spot));
      this.root.add(s);
      this.stacks.set(key, s);
    }
    return s;
  }

  private setBets(seat: number, bets: Bets): void {
    for (const spot of SPOTS) {
      const s = this.stackFor(seat, spot);
      s.position.copy(this.spotPos(seat, spot));
      s.set(bets[spot] ?? 0);
    }
  }

  private addPay(seat: number, spot: Spot, amount: Cents, from?: THREE.Vector3): ChipStack {
    const s = new ChipStack();
    s.set(amount);
    s.position.copy(from ?? this.payPos(seat, spot));
    this.root.add(s);
    this.pays.push({ seat, stack: s });
    return s;
  }

  private clearChips(): void {
    for (const s of this.stacks.values()) s.set(0);
    for (const p of this.pays) p.stack.removeFromParent();
    this.pays = [];
  }

  // -------------------------------------------------------------------------------------------
  // Cards

  private makeCard(hand: Hand, i: number, card: Card | null): CardMesh {
    const m = new CardMesh(card);
    if (card) this.faces.set(m, card);
    const slot = handSlot(hand, i);
    m.position.copy(slot.pos);
    m.rotation.y = slot.sideways ? Math.PI / 2 : 0;
    m.scale.setScalar(HAND_CARD_SCALE);
    this.root.add(m);
    return m;
  }

  private scaleTo(m: CardMesh, to: number, ms: number): Promise<void> {
    const from = m.scale.x;
    if (ms <= 0) {
      m.scale.setScalar(to);
      return Promise.resolve();
    }
    return tween(ms, (k) => m.scale.setScalar(from + (to - from) * k), ease.out);
  }

  private async deal(hand: Hand, card: Card, faceUp: boolean): Promise<void> {
    const i = this.cards[hand].length;
    const slot = handSlot(hand, i);
    const m = new CardMesh(faceUp ? card : null);
    this.faces.set(m, card);
    this.root.add(m);
    this.cards[hand].push(m);
    this.ctx.sfx.play('card-deal');
    this.ctx.stage.gesture('deal');
    // a hand's cards grow to their larger size on the way out of the shoe
    await this.play(faceUp ? 400 : 300, (ms) => Promise.all([dealCard(m, SHOE_MOUTH, slot.pos, { faceUp, ms, yaw: slot.sideways ? Math.PI / 2 : 0 }), this.scaleTo(m, HAND_CARD_SCALE, ms)]));
  }

  private async reveal(hand: Hand): Promise<void> {
    const [a, b] = this.cards[hand];
    for (const m of [a, b]) {
      if (!m) continue;
      m.setCard(this.faces.get(m)!);
      this.ctx.sfx.play('card-flip');
      if (m === b && this.squeeze && !this.rush) await this.squeezeCard(m);
      else await this.play(400, (ms) => flipCard(m, true, ms));
    }
  }

  /** Peel the card up from its near edge slowly, hold, then turn it over. */
  private async squeezeCard(m: CardMesh): Promise<void> {
    const y0 = m.position.y;
    const lift = () => (m.position.y = y0 + Math.abs(Math.sin(m.rotation.x)) * ((CARD_H * m.scale.x) / 2));
    const peek = 0.5;
    await tween(1000, (k) => {
      m.rotation.x = Math.PI - peek * k;
      lift();
    }, ease.inOut);
    await wait(280);
    await tween(280, (k) => {
      m.rotation.x = (Math.PI - peek) * (1 - k);
      lift();
    }, ease.out);
    m.rotation.x = 0;
    m.position.y = y0;
  }

  private removeCards(): void {
    for (const m of [...this.cards.player, ...this.cards.banker]) {
      m.removeFromParent();
      this.faces.delete(m);
    }
    this.cards = { player: [], banker: [] };
  }

  /** Lay the coup out as the view has it (after a reconnect, or to settle after the animation). */
  private placeCoup(coup: Coup | null): void {
    if (!coup) {
      this.removeCards();
      for (const h of HANDS) this.totals[h].obj.visible = false;
      return;
    }
    for (const hand of HANDS) {
      const want = coup[hand];
      const have = this.cards[hand];
      const same = have.length === want.length && have.every((m, i) => this.faces.get(m) === want[i]);
      if (!same) {
        for (const m of have) {
          m.removeFromParent();
          this.faces.delete(m);
        }
        this.cards[hand] = want.map((c, i) => this.makeCard(hand, i, c));
      }
      this.cards[hand].forEach((m, i) => {
        const slot = handSlot(hand, i);
        m.setCard(this.faces.get(m)!);
        m.rotation.set(0, slot.sideways ? Math.PI / 2 : 0, 0);
        m.position.copy(slot.pos);
      });
      this.showTotal(hand, hand === 'player' ? coup.playerTotal : coup.bankerTotal);
    }
    this.markWinner(coup.winner);
  }

  private totalLabel(hand: Hand): { el: HTMLElement; num: HTMLElement; obj: CSS2DObject } {
    const box = el('div', `bc-total bc-total-${hand}`);
    const num = el('b', 'bc-total-num');
    box.append(el('span', '', hand === 'player' ? 'Player' : 'Banker'), num);
    // beside the hand's box, on the outside, clear of a sideways third card
    const at = HAND_BOX[hand];
    const side = hand === 'player' ? -1 : 1;
    const obj = this.ctx.stage.label(box, new THREE.Vector3(at.x + side * (HAND_BOX.w / 2 + 0.085), TOP_Y + 0.012, at.z + 0.02));
    obj.visible = false;
    return { el: box, num, obj };
  }

  private showTotal(hand: Hand, total: number): void {
    const t = this.totals[hand];
    t.num.textContent = String(total);
    t.el.classList.remove('win', 'tie', 'lose');
    t.obj.visible = true;
  }

  private markWinner(winner: Coup['winner']): void {
    for (const h of HANDS) {
      const cls = winner === 'tie' ? 'tie' : winner === h ? 'win' : 'lose';
      this.totals[h].el.classList.remove('win', 'tie', 'lose');
      this.totals[h].el.classList.add(cls);
      // a losing hand's cards dim
      for (const m of this.cards[h]) {
        const face = (m.material as THREE.MeshStandardMaterial[])[2]!;
        face.color.set(cls === 'lose' ? '#8c8680' : '#ffffff');
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // The shoe

  private discardCount(v: BaccaratView | null): number {
    if (!v) return 0;
    const onFelt = v.coup ? v.coup.player.length + v.coup.banker.length : 0;
    return v.shoe.used - onFelt;
  }

  private setDiscard(cards: number): void {
    setDiscardHeight(this.ctx.stage.anchor, cards);
  }

  /** The dealer clears the felt: cards to the discard, winnings back to their seats. */
  private async sweep(): Promise<void> {
    const all = [...this.cards.player, ...this.cards.banker];
    const jobs: Promise<void>[] = [];
    if (all.length) this.ctx.sfx.play('card-place');
    all.forEach((m, i) => {
      jobs.push(wait(this.ms(i * 45)).then(() => Promise.all([dealCard(m, m.position.clone(), DISCARD_TOP, { faceUp: false, ms: this.ms(380), yaw: 0 }), this.scaleTo(m, 1, this.ms(380))]).then(() => {})));
    });
    const chips: { seat: number; stack: ChipStack }[] = [...this.pays];
    for (const [key, stack] of this.stacks) chips.push({ seat: Number(key.split(':')[0]), stack });
    for (const { seat, stack } of chips) {
      if (stack.amount <= 0) continue;
      const [x, z] = polar(1.02, seatAngle(seatNumber(seat)));
      jobs.push(slideStack(stack, new THREE.Vector3(x, TOP_Y + 0.03, z), this.ms(340)).then(() => stack.set(0)));
    }
    await Promise.all(jobs);
    this.removeCards();
    for (const h of HANDS) this.totals[h].obj.visible = false;
    this.clearChips();
    for (const [key, stack] of this.stacks) {
      const [seat, spot] = key.split(':');
      stack.position.copy(this.spotPos(Number(seat), spot as Spot));
    }
    this.setDiscard(this.view ? this.view.shoe.used : 0);
  }

  private async shuffle(shoeNo: number): Promise<void> {
    this.ctx.kit.say('Shuffling a new shoe', 2400);
    this.ctx.sfx.play('card-shuffle');
    const pile = this.discardCount(this.view);
    this.cut.visible = false;
    await this.play(900, (ms) => tween(ms, (k) => this.setDiscard(Math.round(pile * (1 - k))), ease.inOut));
    this.shoeNo = shoeNo;
    const fresh: ShoeView = { no: shoeNo, coups: 0, left: 416, used: 0, lastHand: false, shuffleNext: false, burn: null };
    this.board.set([], fresh);
    await this.pause(250);
  }

  /** Turn up the first card, then burn that many face down into the discard. */
  private async burn(card: Card, count: number): Promise<void> {
    const shown = new CardMesh(card);
    this.root.add(shown);
    this.ctx.sfx.play('card-deal');
    await this.play(420, (ms) => dealCard(shown, SHOE_MOUTH, BURN_SPOT, { faceUp: true, ms }));
    this.ctx.kit.say(`Burn: ${count}`, 2200);
    await this.pause(650);
    for (let i = 0; i < count; i++) {
      const b = new CardMesh(null);
      this.root.add(b);
      void dealCard(b, SHOE_MOUTH, DISCARD_TOP, { faceUp: false, ms: this.ms(260) }).then(() => b.removeFromParent());
      this.setDiscard(i + 1);
      await this.pause(70);
    }
    await this.play(320, (ms) => dealCard(shown, BURN_SPOT, DISCARD_TOP, { faceUp: false, ms }));
    shown.removeFromParent();
    this.setDiscard(count + 1);
    const burned: ShoeView = { no: this.shoeNo, coups: 0, left: 416 - 1 - count, used: 1 + count, lastHand: false, shuffleNext: false, burn: { card, count } };
    this.board.set([], burned);
  }

  // -------------------------------------------------------------------------------------------
  // Settlement

  /**
   * Losing bets are collected first, all at once; then each seat is paid, highest seat number
   * first (the events arrive in that order), with the commission marked in its box.
   */
  private async settle(results: ResultEvent[], coup: Coup | null): Promise<void> {
    const losers: ChipStack[] = [];
    for (const r of results) {
      for (const spot of SPOTS) if (r.spots[spot]?.outcome === 'lose') losers.push(this.stackFor(r.seat, spot));
    }
    if (losers.length) {
      this.ctx.sfx.play('chips-collide');
      this.ctx.stage.gesture('sweep');
      await this.play(420, (ms) => Promise.all(losers.map((s) => slideStack(s, RACK_POINT, ms).then(() => s.set(0)))));
      for (const r of results) for (const spot of SPOTS) this.stackFor(r.seat, spot).position.copy(this.spotPos(r.seat, spot));
    }
    for (const r of results) {
      const paying: { pay: ChipStack; to: THREE.Vector3 }[] = [];
      for (const spot of SPOTS) {
        const sr = r.spots[spot];
        if (sr?.outcome !== 'win') continue;
        paying.push({ pay: this.addPay(r.seat, spot, sr.returned - sr.bet, RACK_POINT), to: this.payPos(r.seat, spot) });
      }
      if (paying.length) {
        // no celebration unless the seat got back more than it staked
        this.ctx.sfx.play(r.seat === this.mySeat && r.returned > r.wagered ? 'chips-stack' : 'chips-handle', { volume: r.seat === this.mySeat ? 1 : 0.5 });
        this.ctx.stage.gesture('pay');
        await this.play(440, (ms) => Promise.all(paying.map(({ pay, to }) => slideStack(pay, to, ms))));
      }
      if (r.commission > 0) this.commission(seatNumber(r.seat), r.commission);
      this.pills(r);
      if (r.seat === this.mySeat) {
        this.lastNet = r.returned - r.wagered;
        this.lastBets = Object.fromEntries(SPOTS.filter((s) => r.spots[s]).map((s) => [s, r.spots[s]!.bet])) as Bets;
        if (coup && !this.rush) this.celebrateCoup(r, coup);
      }
      if (paying.length) await this.pause(160);
    }
    this.drawMeters();
  }

  /** Your coup's moment, if it was one, with the light under the two cards that made it. */
  private celebrateCoup(r: ResultEvent, coup: Coup): void {
    const found = coupMoment(r, coup);
    if (!found) return;
    celebrate(this.ctx, { ...found.m, glow: found.hands.map((h) => this.cards[h].slice(0, 2)) });
  }

  private pinned(text: string, cls: string, at: THREE.Vector3, ms: number): void {
    const obj = this.ctx.stage.label(el('div', cls, text), at);
    this.labels.push({ obj, until: performance.now() + ms });
  }

  private commission(seatNo: number, amount: Cents): void {
    const [x, z] = commissionBox(seatNo);
    this.pinned(formatMoney(amount), 'bc-comm', new THREE.Vector3(x, TOP_Y + 0.01, z), 5_000);
  }

  /** Pills on the spots that paid or pushed: detailed for you, the amount for everyone else. */
  private pills(r: ResultEvent): void {
    const me = r.seat === this.mySeat;
    for (const spot of SPOTS) {
      const sr = r.spots[spot];
      if (!sr || sr.outcome === 'lose') continue;
      const at = this.spotPos(r.seat, spot).add(new THREE.Vector3(0, 0.07, 0));
      if (!me) {
        if (sr.outcome === 'win') this.pinned(formatMoney(sr.returned - sr.bet, { sign: true }), 'pill win bc-other', at, 3_200);
        continue;
      }
      if (sr.outcome === 'push') {
        this.ctx.kit.pill(this.ctx.stage, at, 'PUSH', 'push', 3_200);
        continue;
      }
      const win = formatMoney(sr.returned - sr.bet, { sign: true });
      const note = spot === 'banker' ? ` · 5% commission ${formatMoney(sr.commission)}` : spot === 'tie' ? ' · 8 to 1' : spot === 'player' ? '' : ' · 11 to 1';
      this.ctx.kit.pill(this.ctx.stage, at, `${win}${note}`, 'win', 3_600);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Drawing from the view

  private draw(v: BaccaratView): void {
    this.view = v;
    this.closed = v.phase !== 'betting';
    this.clearChips();
    if (v.phase === 'betting') {
      for (const [seat, bets] of Object.entries(v.bets)) this.setBets(Number(seat), bets);
    } else if (v.phase === 'results') {
      for (const [seat, r] of Object.entries(v.results)) {
        const s = Number(seat);
        for (const spot of SPOTS) {
          const sr = r.spots[spot];
          if (!sr || sr.outcome === 'lose') continue;
          const st = this.stackFor(s, spot);
          st.position.copy(this.spotPos(s, spot));
          st.set(sr.bet);
          if (sr.outcome === 'win') this.addPay(s, spot, sr.returned - sr.bet);
        }
      }
    }
    this.myBets = v.phase === 'betting' && this.mySeat !== null ? { ...(v.bets[this.mySeat] ?? {}) } : {};
    if (this.mySeat !== null && v.results[this.mySeat] && !this.lastBets) {
      const r = v.results[this.mySeat]!;
      this.lastBets = Object.fromEntries(SPOTS.filter((s) => r.spots[s]).map((s) => [s, r.spots[s]!.bet])) as Bets;
    }
    this.placeCoup(v.coup);
    this.setDiscard(this.discardCount(v));
    this.cut.visible = v.shoe.lastHand || v.shoe.shuffleNext;
    if (this.cut.visible) {
      this.cut.position.copy(CUT_SPOT);
      this.cut.rotation.set(0, 0.35, 0);
    }
    this.board.set(v.history, v.shoe);
    if (this.mySeat !== null) {
      const [x, z] = polar(NUMBER_R, seatAngle(seatNumber(this.mySeat)));
      this.mine.position.set(x, TOP_Y + 0.0015, z);
      this.mine.visible = true;
    }
    this.drawMeters();
    this.renderTip();
  }

  private buildMeters(): void {
    for (const [label, value] of [['Stack', this.meters.stack], ['On layout', this.meters.bet], ['Last coup', this.meters.last]] as const) {
      const m = el('div', 'bc-meter');
      m.append(el('span', 'label', label), value);
      this.metersBox.append(m);
    }
    this.squeezeBtn.setAttribute('aria-pressed', String(this.squeeze));
    this.metersBox.append(this.squeezeBtn);
  }

  private drawMeters(): void {
    const v = this.view;
    this.meters.stack.textContent = formatMoney(this.stack);
    this.meters.bet.textContent = formatMoney(betTotal(this.myBets));
    this.meters.last.textContent = this.lastNet === null ? '–' : formatMoney(this.lastNet, { sign: true });
    this.meters.last.className = `money ${this.lastNet === null ? '' : this.lastNet > 0 ? 'up' : this.lastNet < 0 ? 'down' : ''}`;
    const betting = v?.phase === 'betting';
    if (this.mode === 'solo') {
      this.tray.setPrimary('Deal', !!betting && betTotal(this.myBets) > 0);
    } else {
      this.tray.setPrimary(this.ready ? 'Waiting' : 'Ready', !!betting && !this.ready && this.mySeat !== null);
    }
  }

  private drawSeats(): void {
    if (this.mode !== 'multi') return;
    const seated = new Map<number, Member>();
    // your own seat is marked by the ring on the felt; its tag would sit under the chip tray
    for (const m of this.members) if (m.seat !== null && m.status !== 'watching' && m.seat !== this.mySeat) seated.set(m.seat, m);
    for (const [seat, tag] of this.seatTags) {
      if (!seated.has(seat)) {
        tag.el.remove();
        tag.obj.removeFromParent();
        this.seatTags.delete(seat);
      }
    }
    for (const [seat, m] of seated) {
      let tag = this.seatTags.get(seat);
      if (!tag) {
        const n = seatNumber(seat);
        const [x, z] = polar(1.03, seatAngle(n));
        const tagEl = el('div', 'bc-seat');
        tag = { el: tagEl, obj: this.ctx.stage.label(tagEl, new THREE.Vector3(x, TOP_Y + 0.08, z)) };
        this.seatTags.set(seat, tag);
      }
      tag.el.replaceChildren(el('b', '', String(seatNumber(seat))), document.createTextNode(m.name), ...(m.ready ? [el('span', 'bc-ready', 'Ready')] : []));
      tag.el.classList.toggle('me', seat === this.mySeat);
      tag.el.classList.toggle('away', !m.connected);
    }
  }

  private makeTimer(): { el: HTMLElement; ring: SVGCircleElement; num: HTMLElement; obj: CSS2DObject } {
    const NS = 'http://www.w3.org/2000/svg';
    const box = el('div', 'timer bc-timer');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 44 44');
    const track = document.createElementNS(NS, 'circle');
    const ring = document.createElementNS(NS, 'circle');
    for (const c of [track, ring]) {
      c.setAttribute('cx', '22');
      c.setAttribute('cy', '22');
      c.setAttribute('r', '19');
    }
    track.setAttribute('class', 'track');
    ring.setAttribute('class', 'left');
    ring.setAttribute('stroke-dasharray', String(2 * Math.PI * 19));
    svg.append(track, ring);
    const num = el('b', 'bc-timer-num');
    box.append(svg, num);
    const obj = this.ctx.stage.label(box, new THREE.Vector3(0, TOP_Y + 0.02, -0.26));
    obj.visible = false;
    return { el: box, ring, num, obj };
  }
}

/** Slide an object across the felt along a low arc (the cut card coming out of the shoe). */
async function slide(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, ms: number): Promise<void> {
  obj.position.copy(from);
  await tween(ms, (k) => {
    obj.position.lerpVectors(from, to, k);
    obj.position.y += Math.sin(Math.PI * k) * 0.02;
  }, ease.out);
}
