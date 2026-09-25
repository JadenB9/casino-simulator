// The law, on the client: the floor's security and the pit boss walking their loops, punches
// (V throws one; everyone sees it land, nobody is hurt), the staff's words when they catch someone,
// and jail: the building across the street, its two tables, the bank at booking, the bail board
// and your own time inside in the HUD. The server decides everything (server/src/law.ts); this
// draws it and asks.
//
// Wiring (app/boot.ts): mount once the floor is built, useLink() with the floor socket, and ask
// tableChoice() before the lobby flow when someone sits down (the jail's tables skip it).

import * as THREE from 'three';
import type { Engine3D } from '../../render/engine3d.ts';
import type { FloorWorld, WorldStation } from '../index.ts';
import type { Sfx } from '../../audio/sfx.ts';
import type { FloorLink } from '../../net/presence.ts';
import { yawToByte } from '../../net/presence.ts';
import { serverNow } from '../../net/clock.ts';
import type { FloorServerMsg } from '../../../../shared/src/protocol.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { limitsLabel } from '../../../../shared/src/limits.ts';
import { isStaffId, parseDetour, type Detour, type StaffId } from '../../../../shared/src/law/patrol.ts';
import { ESCORT_TALK_MS, JAIL, JAIL_GAMES, PUNCH_GAP_MS, RELEASE_MS, STRIKE_WINDOW_MS, jailLimits, type JailState, type LawEvent } from '../../../../shared/src/law/rules.ts';
import { SPAWN } from '../layout.ts';
import { el, toast } from '../../ui/kit.ts';
import { isTyping, overlayCount } from '../../ui/keyboard.ts';
import { calm } from '../../app/comfort.ts';
import type { Person } from '../characters.ts';
import type { SpotProvider } from '../interact.ts';
import { Speech } from '../life/speech.ts';
import { LawStaff } from './staff.ts';
import { BANK_SPOT, buildJail, jailCeiling, type Jail } from './jail.ts';
import { LawSounds } from './sound.ts';
import './law.css';

export interface LawDeps {
  engine: Engine3D;
  world: FloorWorld;
  ui: HTMLElement;
  sfx: Sfx;
  /** Other players' characters by floor id (the app's RemotePlayers). */
  character: (id: number) => Person | undefined;
  /** Walking about on the floor with nothing open: a punch may be thrown. */
  canPunch: () => boolean;
  /** Stand up from whatever table you're at (the normal leave: bets settle, chips go home). */
  leaveTable: () => void;
  /** Open the bank (the cashier's window) over the floor. */
  openBank: () => void;
}

/** What the lobby flow is skipped for: the jail's tables are solo, at the jail's limits (the server sets them). */
export type LawChoice = { kind: 'solo' } | 'refuse';

const LINES: Record<'warn' | 'jail', Record<'punch' | 'win', string[]>> = {
  warn: {
    punch: ['Hands to yourself. Next time you go across the street.', "That's your warning. Keep your hands down.", 'Not in here. Do it again and you spend the night in county.'],
    win: ["You're having quite a night. I'll be watching this table.", 'Nice run. Easy does it from here.', "Lucky streak? Let's keep it lucky."],
  },
  jail: {
    punch: ["That's twice. You're coming with me.", 'I warned you. Across the street, let\'s go.'],
    win: ["The house has seen enough. Let's take a walk.", 'Twice now. Come with me.'],
  },
};
const FREE_LINE = "Bail's made. You're free to go.";

/** Metres of camera shake when you're hit (none with Reduce flashing & motion on). */
const SHAKE = 0.06;
const SHAKE_S = 0.32;
/** How long the screen stays dark across a move to or from jail. */
const FADE_MS = 650;

export class Law {
  readonly staff: LawStaff;
  readonly jail: Jail;
  private link: FloorLink | null = null;
  private linkOff: (() => void) | null = null;
  private readonly speech: Speech;
  private readonly sounds: LawSounds;
  private readonly offs: (() => void)[] = [];
  private state: JailState | null = null;
  private warnUntil = 0;
  private lastPunch = 0;
  private shake = 0;
  /** A move to or from jail is coming (the next `tp` fades). */
  private moving: 'in' | 'out' | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private darkTimer: ReturnType<typeof setTimeout> | null = null;
  private lightTimer: ReturnType<typeof setTimeout> | null = null;
  private heardJail = false;
  private readonly hud = el('div', 'law-hud');
  private readonly fade = el('div', 'law-fade');
  /** On a touch screen, a fist beside the action button (there's no V key). */
  private readonly fist = el('button', 'law-punch', 'Punch');
  private readonly ears = new THREE.Vector3();
  private readonly _watch = new THREE.Vector3();

  constructor(private readonly deps: LawDeps) {
    const { world, engine } = deps;
    this.speech = new Speech(engine.camera);
    this.sounds = new LawSounds(deps.sfx);
    this.staff = new LawStaff(world.characterFactory, (x, z) => this.canSee(x, z));
    this.staff.nav = world.life.grid;
    engine.scene.add(this.staff.group);
    this.jail = buildJail({ quality: world.quality, collider: world.collider });
    this.jail.group.visible = false;
    engine.scene.add(this.jail.group);
    // the jail's tables are stations like any other: E sits down, the table view opens
    world.stations.push(...this.jail.stations);
    this.jail.posts.forEach((p, i) => this.staff.addOfficer(p.id, p.x, p.z, p.yaw, [4, 6, 2, 5][i % 4]!));
    this.hud.hidden = true;
    this.fade.hidden = true;
    this.fist.type = 'button';
    this.fist.hidden = true;
    this.fist.setAttribute('aria-label', 'Throw a punch');
    this.fist.addEventListener('click', () => this.link?.you && deps.canPunch() && this.punch());
    deps.ui.append(this.hud, this.fade, this.fist);
    this.offs.push(world.spots(this.spots));
    // under the jail's roof the follow camera keeps below it (the city's ceilings)
    this.offs.push(world.city.addCeiling(jailCeiling));
    this.offs.push(engine.onFrame((dt) => this.update(dt)));
    addEventListener('keydown', this.onKey);
    this.showState();
  }

  /** The floor socket (null when it goes). */
  useLink(link: FloorLink | null): void {
    this.linkOff?.();
    this.linkOff = null;
    this.link = link;
    if (link) this.linkOff = link.subscribe((m) => this.onMessage(m));
  }

  /** At a jail table: straight to a solo table, or a polite no for anyone who isn't an inmate. */
  tableChoice(station: WorldStation): LawChoice | null {
    if (!JAIL_GAMES.some((g) => g.station === station.id)) return null;
    if (this.state) return { kind: 'solo' };
    toast("The jail's tables are for inmates.");
    return 'refuse';
  }

  /** You, in jail right now (as the floor last said). */
  get jailed(): JailState | null {
    return this.state;
  }

  // --- messages --------------------------------------------------------------------------------

  private onMessage(m: FloorServerMsg): void {
    const now = serverNow();
    switch (m.t) {
      case 'hello':
        // a reconnect: the floor says `jail` next if you're still inside; if it doesn't, you're out
        this.heardJail = false;
        if (this.helloTimer) clearTimeout(this.helloTimer);
        this.helloTimer = setTimeout(() => this.afterHello(), 1500);
        break;
      case 'detours':
        this.staff.setDetours(m.list.map(parseDetour).filter((d): d is Detour => d !== null));
        break;
      case 'detour': {
        const d = parseDetour(m.d);
        if (d) this.staff.addDetour(d, now);
        break;
      }
      case 'punch':
        this.onPunch(m.id, m.hit);
        break;
      case 'law':
        this.onLaw(m.ev, now);
        break;
      case 'jail':
        this.heardJail = true;
        this.onJail(m.jail);
        break;
      case 'tp':
        if (this.moving) this.arrived();
        break;
    }
  }

  private afterHello(): void {
    this.helloTimer = null;
    if (this.heardJail) return;
    if (this.state) this.onJail(null, true);
    // let out while away, with the page still standing where it was inside: back to the casino
    const p = this.deps.world.player.position;
    if (inside(p.x, p.z) && !this.deps.world.seated) this.deps.world.player.teleport(SPAWN.x, SPAWN.z, SPAWN.yaw);
  }

  private me(): number | null {
    return this.link?.you?.id ?? null;
  }

  private onPunch(id: number, hit: number | StaffId | null): void {
    const me = this.me();
    const ears = this.deps.engine.camera.getWorldPosition(this.ears);
    if (id !== me) {
      const ch = this.deps.character(id);
      if (ch) {
        ch.gesture('punch');
        this.sounds.whoosh(ch.root.position, ears);
      }
    }
    if (hit === null) return;
    // the fist lands a moment into the swing
    setTimeout(() => this.landed(hit), 200);
  }

  private landed(hit: number | StaffId): void {
    const ears = this.deps.engine.camera.getWorldPosition(this.ears);
    if (typeof hit === 'string') {
      if (!isStaffId(hit)) return;
      const m = this.staff.get(hit);
      if (!m) return;
      m.person.gesture('brush');
      this.sounds.thud(m.person.root.position, ears);
      return;
    }
    if (hit === this.me()) {
      const own = this.deps.world.player.character as Person;
      own.gesture('hit');
      this.sounds.thud(null, ears);
      if (!calm()) this.shake = SHAKE_S;
      return;
    }
    const ch = this.deps.character(hit);
    if (!ch) return;
    ch.gesture('hit');
    this.sounds.thud(ch.root.position, ears);
  }

  private onLaw(ev: LawEvent, now: number): void {
    const mine = ev.id === this.me();
    if (ev.k === 'warn' || ev.k === 'jail') {
      // the word, over whoever came, once he's there
      if (ev.staff && ev.why) {
        const lines = LINES[ev.k][ev.why];
        const line = lines[Math.floor(Math.random() * lines.length)]!;
        const d = this.staff.detourFor(ev.staff, ev.id, now);
        const wait = d ? Math.max(0, d.at + d.go - now) : 0;
        setTimeout(() => {
          const m = this.staff.get(ev.staff!);
          if (m) this.speech.say(m.person.root, line, ev.staff === 'boss' ? 'Pit boss' : 'Security', 2.05);
        }, wait);
      }
    }
    if (!mine) return;
    if (ev.k === 'warn') {
      this.warnUntil = ev.until ?? now + STRIKE_WINDOW_MS;
      const who = ev.staff === 'boss' ? 'The pit boss' : 'Security';
      const what = ev.why === 'win' ? 'has noticed how much you are winning' : 'saw that';
      toast(`Warning. ${who} ${what}. Get caught again in the next five minutes and you go to jail.`, 'err', 7000);
      this.showState();
    } else if (ev.k === 'jail') {
      this.warnUntil = 0;
      toast('Caught again. You are going to jail across the street.', 'err', 6000);
      // the floor moves you once the guard has walked over and had his word
      const d = ev.staff ? this.staff.detourFor(ev.staff, ev.id, now) : null;
      this.leaveForJail('in', (d ? d.at + d.go : now) + ESCORT_TALK_MS - now);
    }
  }

  private onJail(jail: JailState | null, quiet = false): void {
    const was = this.state;
    this.state = jail;
    this.jail.board.show(jail);
    for (const s of this.jail.stations) {
      const l = jail ? jailLimits(s.game, jail.bail) : null;
      s.limits = l ? limitsLabel(s.game, l) : 'Inmates only';
    }
    if (jail && !was) {
      // locked up (or back inside after a reconnect: the move comes at once)
      this.leaveForJail('in', 0);
    } else if (!jail && was && !quiet) {
      toast(`Bail made. You walk out with everything you won.`, 'info', 6000);
      this.sounds.buzzer();
      const officer = this.staff.get('officer-booking');
      if (officer) this.speech.say(officer.person.root, FREE_LINE, 'Officer', 2.05);
      this.leaveForJail('out', RELEASE_MS);
    }
    this.showState();
  }

  /**
   * Off any table, and dark just before the floor moves you across the street (or back), `inMs`
   * from now: the world (city/) makes the move when `tp` comes, and the dark hides the jump.
   */
  private leaveForJail(dir: 'in' | 'out', inMs: number): void {
    if (this.deps.world.seated) this.deps.leaveTable();
    if (this.moving === dir) return;
    this.moving = dir;
    if (this.darkTimer) clearTimeout(this.darkTimer);
    this.darkTimer = setTimeout(() => this.darken(), Math.max(0, inMs - FADE_MS));
  }

  private darken(): void {
    this.darkTimer = null;
    this.fade.hidden = false;
    this.fade.classList.remove('out');
    // never left dark: light again if the move doesn't come
    if (this.lightTimer) clearTimeout(this.lightTimer);
    this.lightTimer = setTimeout(() => this.lighten(), 8000);
  }

  private lighten(): void {
    if (this.lightTimer) clearTimeout(this.lightTimer);
    this.lightTimer = null;
    this.fade.classList.add('out');
    setTimeout(() => {
      if (this.fade.classList.contains('out')) this.fade.hidden = true;
    }, FADE_MS);
  }

  /** The floor moved us (the world has already gone there): light again once it has settled. */
  private arrived(): void {
    this.moving = null;
    if (this.darkTimer) {
      // the move came before the dark did (a reconnect): a short dip instead
      clearTimeout(this.darkTimer);
      this.darkTimer = null;
      this.darken();
    }
    setTimeout(() => this.lighten(), FADE_MS);
  }

  // --- punching ------------------------------------------------------------------------------

  private onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'KeyV' || e.repeat || isTyping(e) || overlayCount() > 0) return;
    if (!this.link?.you || !this.deps.canPunch()) return;
    e.preventDefault();
    this.punch();
  };

  /** Throw a punch the way you face (the V key, or a touch button). */
  punch(): void {
    const now = performance.now();
    if (now - this.lastPunch < PUNCH_GAP_MS) return;
    this.lastPunch = now;
    const own = this.deps.world.player.character as Person;
    own.gesture('punch');
    this.sounds.whoosh(null, this.ears);
    this.link?.send({ t: 'punch', r: yawToByte(this.deps.world.player.state().yaw) });
  }

  // --- each frame ------------------------------------------------------------------------------

  private canSee(x: number, z: number): boolean {
    const cam = this.deps.engine.camera.position;
    if (inLot(x, z)) return this.jail.group.visible && Math.hypot(x - cam.x, z - cam.z) < 45;
    return this.deps.world.zone === 'casino' && this.deps.world.canSee(x, z);
  }

  private update(dt: number): void {
    const now = serverNow();
    this.jail.group.visible = this.deps.world.zone === 'ground';
    const p = this.deps.world.player.position;
    this.staff.update(dt, now, this._watch.set(p.x, 1.6, p.z));
    this.speech.update(dt);
    // calm turned on mid-shake stops it there
    if (this.shake > 0 && calm()) this.shake = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const k = (this.shake / SHAKE_S) * SHAKE;
      const cam = this.deps.engine.camera;
      cam.position.x += (Math.random() - 0.5) * k;
      cam.position.y += (Math.random() - 0.5) * k;
    }
    if (this.warnUntil && Date.now() % 1000 < 40) this.showState();
    // inside, the walls keep you in; if anything ever put you past them, back you go
    if (this.state && !this.moving && !this.deps.world.seated && this.jail.group.visible && !inside(p.x, p.z)) {
      const r = JAIL.inner;
      this.deps.world.player.teleport(Math.min(r.x1 - 0.5, Math.max(r.x0 + 0.5, p.x)), Math.min(r.z1 - 0.5, Math.max(r.z0 + 0.5, p.z)), this.deps.world.player.state().yaw);
    }
    const fist = document.documentElement.classList.contains('touch-ui') && !!this.link?.you && this.deps.canPunch();
    if (this.fist.hidden === fist) this.fist.hidden = !fist;
  }

  private spots: SpotProvider = (p) => {
    if (!this.state || !this.jail.group.visible) return [];
    const d = Math.hypot(p.x - BANK_SPOT.x, p.z - BANK_SPOT.z);
    if (d > 2) return [];
    return [{ key: 'jail-bank', x: BANK_SPOT.x, z: BANK_SPOT.z, d, label: 'Bank · the top-up for the broke', use: () => this.deps.openBank() }];
  };

  /** The HUD: your bail and how far along it you are, or the warning you're on. */
  private showState(): void {
    const now = serverNow();
    // the cards under the HUD's right end (celebrities, happy hour) stack there: ours goes on top
    const stack = document.querySelector('.celeb-stack');
    if (stack && this.hud.parentElement !== stack) stack.prepend(this.hud);
    this.hud.replaceChildren();
    const jail = this.state;
    if (jail) {
      const k = Math.min(1, jail.won / jail.bail);
      const bar = el('div', 'law-bar');
      const fill = el('div', 'law-fill');
      fill.style.width = `${Math.round(k * 100)}%`;
      bar.append(fill);
      this.hud.append(el('div', 'law-title', 'County jail'), el('div', 'law-line', `Win ${formatMoney(jail.bail)} at the jail's tables to make bail`), bar, el('div', 'law-sub', `${formatMoney(jail.won)} won · ${formatMoney(Math.max(0, jail.bail - jail.won))} to go`));
      this.hud.className = 'law-hud panel jailed';
      this.hud.hidden = false;
      return;
    }
    const left = this.warnUntil - now;
    if (left > 0) {
      const mm = Math.floor(left / 60_000);
      const ss = Math.floor((left % 60_000) / 1000);
      this.hud.append(el('div', 'law-title', 'On warning'), el('div', 'law-sub', `${mm}:${String(ss).padStart(2, '0')} left`));
      this.hud.className = 'law-hud panel warned';
      this.hud.hidden = false;
      return;
    }
    this.warnUntil = 0;
    this.hud.hidden = true;
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey);
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.useLink(null);
    for (const off of this.offs) off();
    const ws = this.deps.world.stations;
    for (const s of this.jail.stations) ws.splice(ws.indexOf(s), 1);
    this.speech.dispose();
    this.staff.dispose();
    this.jail.dispose();
    this.hud.remove();
    this.fade.remove();
    this.fist.remove();
  }
}

export function mountLaw(deps: LawDeps): Law {
  return new Law(deps);
}

/** Inside the jail proper (metres). */
function inside(x: number, z: number): boolean {
  const r = JAIL.inner;
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

/** Anywhere on the jail's lot (metres). */
function inLot(x: number, z: number): boolean {
  return x >= 166 && x <= 196 && z >= -45 && z <= -5;
}
