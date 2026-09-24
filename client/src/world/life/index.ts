// The floor's life: sitting anywhere, the cocktail waiters, the bartender, the bankers at the cage
// and the boutique's shopkeeper. createWorld builds one (world.life) from the building's life points
// (life-points.ts); the app hands it its side of things once you're logged in: the floor socket (for
// seats), the bar (for orders) and its menus.
//
//   sitting.ts     Sit / Stand up, the seat book the floor arbitrates
//   waiters.ts     rounds on the shared clock, orders taken and brought (routes.ts, rounds.ts, nav.ts, tray.ts)
//   bartender.ts   the counter's Order, every order made, handed across or passed to a waiter
//   bankers.ts     a banker at each teller window: greeting, the sheet beside them, reactions
//   shopkeeper.ts  the boutique's counter and its chores
//   crew.ts        the staff's characters (motions.ts, pose.ts) and speech.ts their words

import * as THREE from 'three';
import type { BarOrder } from '../../../../shared/src/items.ts';
import { serverNow } from '../../net/clock.ts';
import type { Characters } from '../characters.ts';
import { Collider } from '../collision.ts';
import { overhead } from '../collide.ts';
import type { Interact } from '../interact.ts';
import { roomAt, type FloorPlan } from '../layout.ts';
import type { LifePoints } from '../life-points.ts';
import type { Player } from '../player.ts';
import { walkGrid } from '../reach.ts';
import type { SeatPose } from '../remote-players.ts';
import { Bankers, type BankEvent } from './bankers.ts';
import { Bartender } from './bartender.ts';
import { Crew, type CrewRole } from './crew.ts';
import type { LifeApp, LifeCtx } from './ctx.ts';
import { NAV_CELL, NAV_RADIUS, NavGrid } from './nav.ts';
import { waiterRounds } from './routes.ts';
import { Seating, type SeatLink } from './sitting.ts';
import { Shopkeeper, type Boutique } from './shopkeeper.ts';
import { Speech } from './speech.ts';
import { Trays } from './tray.ts';
import { Waiters } from './waiters.ts';
import './life.css';

export type { LifeApp } from './ctx.ts';
export type { SeatLink } from './sitting.ts';
export type { BankEvent } from './bankers.ts';

/** How many waiters work the floor. */
const WAITERS = 4;

/** What the bar's orders need (ui/shop/bar.ts's Bar fits). */
export interface OrderDesk {
  deliverWith(fn: ((o: BarOrder) => void) | null): void;
}

export interface LifeDeps {
  root: THREE.Object3D;
  camera: THREE.Camera;
  characters: Characters;
  plan: FloorPlan;
  points: LifePoints;
  player: Player;
  interact: Interact;
  collider: Collider;
  /** The dealers and the rest of the staff standing on the floor (the waiters keep clear). */
  staff: { x: number; z: number }[];
}

export class FloorLife {
  readonly crew: Crew;
  readonly seating: Seating;
  readonly waiters: Waiters;
  readonly bartender: Bartender;
  readonly bankers: Bankers;
  shopkeeper: Shopkeeper | null = null;
  readonly grid: NavGrid;
  private readonly speech: Speech;
  private readonly trays = new Trays();
  private app: LifeApp | null = null;
  private desk: OrderDesk | null = null;
  private link: SeatLink | null = null;
  private readonly offs: (() => void)[] = [];
  private readonly ctx: LifeCtx;
  private readonly peopleNow: { x: number; z: number }[] = [];

  constructor(private readonly deps: LifeDeps) {
    // the waiters' walkable floor: the plan's own, a waiter's width from everything, the staff too
    this.grid = NavGrid.fromWalk(walkGrid(deps.plan, { radius: NAV_RADIUS, cell: NAV_CELL, extra: deps.staff.map((s) => ({ kind: 'round' as const, x: s.x, z: s.z, r: 0.28 })) }));
    const rounds = waiterRounds(deps.points, deps.plan, this.grid, WAITERS);
    const roles: CrewRole[] = [...rounds.map(() => 'waiter' as const), 'bartender', ...deps.points.bank.windows.slice(0, 3).map(() => 'banker' as const), 'shopkeeper'];
    this.crew = new Crew(deps.characters, deps.collider, roles);
    deps.root.add(this.crew.group);
    this.speech = new Speech(deps.camera);
    this.ctx = {
      crew: this.crew,
      speech: this.speech,
      grid: this.grid,
      points: deps.points,
      player: deps.player,
      camera: deps.camera,
      now: () => serverNow() / 1000,
      app: () => this.app,
      people: () => this.peopleNow,
    };
    this.waiters = new Waiters(this.ctx, rounds, this.trays, this.crew.group);
    this.bartender = new Bartender(this.ctx, this.waiters);
    this.bankers = new Bankers(this.ctx, () => deps.interact.useCashier());
    if (deps.points.boutique) this.useBoutique(deps.points.boutique);
    // the seated camera also keeps out of the palms' fronds and the lamps over the tables
    const over = new Collider();
    overhead(deps.plan, over);
    this.seating = new Seating(deps.points.seats, deps.player, deps.player.character, deps.collider, () => this.playing(), over);
    // the tellers take the cage's customers: its own prompt steps aside
    if (this.bankers.tellers.length) deps.interact.cashierPrompt = false;
    this.offs.push(
      deps.interact.spots((p) => this.seating.spots(p)),
      deps.interact.spots((p) => (this.seating.seated ? [] : [...this.waiters.spots(p), ...this.bartender.spots(p), ...this.bankers.spots(p), ...(this.shopkeeper?.spots(p) ?? [])])),
    );
  }

  /** The staff's models (behind the loading screen). */
  load(): Promise<void> {
    return this.crew.load();
  }

  /** The boutique's counter, cases and mannequins, when the building has them (or a stand-in for checks). */
  useBoutique(b: Boutique | null): void {
    if (!b || this.shopkeeper) return;
    this.shopkeeper = new Shopkeeper(this.ctx, b);
  }

  /** The app's side: menus, your name, the hand-over, whether you're at a table (null when you leave the floor). */
  useApp(app: LifeApp | null): void {
    this.app = app;
  }

  /** The floor socket, for seats (null: sitting stays on this screen). */
  useLink(link: SeatLink | null): void {
    this.link = link;
    this.seating.useLink(link);
  }

  /** The bar's orders: every one paid for is made and brought by the staff from now on. */
  useBar(desk: OrderDesk | null): void {
    this.desk?.deliverWith(null);
    this.desk = desk;
    desk?.deliverWith((o) => this.bartender.take(o));
  }

  /** Something happened in the bank's sheet: the banker at your window answers it. */
  bank(e: BankEvent): void {
    this.bankers.react(e);
  }

  /** The bank's sheet closed. */
  leftBank(): void {
    this.bankers.left();
  }

  /** Where another player is drawn sitting on a floor seat (RemotePlayers' seatFor). */
  seatFor(id: number): SeatPose | null {
    return this.seating.seatPoseOf(id);
  }

  /** Before the walker moves: sitting holds the player on the seat. */
  early(dt: number): void {
    this.seating.update(dt);
  }

  /**
   * After the walker has moved and the camera is placed. `rooms` and `sees` are the doorway
   * culling's (visibility.ts): staff in a room the camera can't see into aren't drawn.
   */
  update(dt: number, rooms: ReadonlySet<string> | null = null, sees: ((room: string, box: THREE.Box3) => boolean) | null = null): void {
    this.gatherPeople();
    this.waiters.update(dt);
    this.bartender.update(dt);
    this.bankers.update(dt);
    this.shopkeeper?.update(dt);
    this.crew.update(dt, this.deps.camera, rooms, sees, this.roomOf);
    this.waiters.place();
    this.speech.update(dt);
  }

  /** At the very end of the frame: a camera the bankers hold at their window. */
  late(dt: number): void {
    this.bankers.late(dt);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.useBar(null);
    this.seating.dispose();
    this.waiters.dispose();
    this.speech.dispose();
    this.crew.dispose();
    this.trays.dispose();
  }

  private readonly roomOf = (x: number, z: number): string | null => roomAt(this.deps.plan, x, z)?.id ?? null;

  /** Stations someone is playing at (a desk chair there isn't free to sit on). */
  private playing(): ReadonlySet<string> {
    const out = new Set<string>();
    for (const p of this.link?.players.values() ?? []) if (p.info.at) out.add(p.info.at.station);
    return out;
  }

  private gatherPeople(): void {
    this.peopleNow.length = 0;
    for (const p of this.deps.characters.people()) {
      const r = p.root;
      let shown = r.parent !== null;
      for (let o: THREE.Object3D | null = r; o && shown; o = o.parent) shown = o.visible;
      if (shown) this.peopleNow.push({ x: r.position.x, z: r.position.z });
    }
  }
}
