// The game proper. The floor loads behind the loading screen; then login (or the saved session),
// the main menu over a slow pass across the floor, and the floor itself: walking among the other
// players, the HUD, the cashier, and a table view at whichever station you sit down at.

import * as THREE from 'three';
import * as api from '../net/api.ts';
import { session } from './session.ts';
import { TableSession } from './table-session.ts';
import { Engine3D, savedQuality } from '../render/engine3d.ts';
import { updateTweens } from '../table/tween.ts';
import { loadCards } from '../table/cards.ts';
import { TableStage, type Pose } from '../table/stage.ts';
import { Sfx } from '../audio/sfx.ts';
import { createWorld, type FloorWorld, type WorldStation } from '../world/index.ts';
import { RemotePlayers, type SeatPose } from '../world/remote-players.ts';
import { FloorLink, byteToYaw } from '../net/presence.ts';
import { GAMES } from '../games/index.ts';
import { openTableFlow, PartyPanel, withParty, type TableChoice } from '../ui/lobby/index.ts';
import { mountHud, mountLogin, mountMenu, openBank, openEditor, openProfile, openSettings, overlayCount, type Hud, type MenuHandle } from '../ui/menu/index.ts';
import { button, modal, toast } from '../ui/kit.ts';
import { ENGINES } from '../../../shared/src/games/index.ts';
import { CLOSE } from '../../../shared/src/protocol.ts';
import type { Look } from '../../../shared/src/look.ts';

/** How long the world's fly-in to a table takes (world/interact.ts), plus a frame of slack. */
const FLY_IN_MS = 950;

export async function boot(): Promise<void> {
  const ui = document.getElementById('ui')!;
  const fill = document.getElementById('boot-fill');
  const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, savedQuality());
  engine.onFrame((dt) => updateTweens(dt));
  const sfx = new Sfx();
  let app: App | null = null;
  const [world] = await Promise.all([
    createWorld(engine, {
      ui,
      onProgress: (k) => {
        if (fill) fill.style.width = `${Math.round(k * 100)}%`;
      },
      onEscape: () => app?.escape(),
    }),
    loadCards(),
    sfx.load().catch((err) => console.warn('sounds failed to load', err)),
  ]);
  app = new App(engine, world, sfx, ui);
  // Handles for the console and the headless checks; nothing here can move money.
  (window as unknown as { casino: unknown }).casino = { engine, world, app, session };
  await app.start();
}

interface OpenTable {
  station: WorldStation;
  session: TableSession;
  stage: TableStage;
  enteredAt: number;
  seated: boolean;
}

class App {
  private link: FloorLink | null = null;
  private remotes: RemotePlayers | null = null;
  private hud: Hud | null = null;
  private menu: MenuHandle | null = null;
  private table: OpenTable | null = null;
  private passUsers = 0;
  private passOff: (() => void) | null = null;
  private lookKey = '';
  private stopped = false;

  constructor(
    private readonly engine: Engine3D,
    private readonly world: FloorWorld,
    private readonly sfx: Sfx,
    private readonly ui: HTMLElement,
  ) {
    engine.onFrame((dt) => {
      world.update(dt);
      this.link?.update(world.player.state());
      this.remotes?.update(dt);
    });
    world.onEnter((station) => void this.sitDown(station));
    world.onCashier(() => this.openCashier());
    session.on((p) => this.applyLook(p.look));
    // The table's own shortcuts. Capture phase, so a key the view uses (Esc closing its rules
    // panel, say) never also reaches the floor behind it.
    addEventListener(
      'keydown',
      (e) => {
        const view = this.table?.session.view;
        if (!view?.keydown || overlayCount() > 0) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (view.keydown(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );
  }

  async start(): Promise<void> {
    this.world.player.setEnabled(false);
    if (api.savedToken()) {
      try {
        session.set(await api.me());
        this.loggedIn();
        this.showMenu();
        return;
      } catch {
        api.forgetToken();
      }
    }
    this.showLogin();
  }

  // --- login and the menu --------------------------------------------------------------------

  private showLogin(): void {
    const login = mountLogin({
      root: this.ui,
      api,
      session,
      sfx: this.sfx,
      backdrop: () => this.pass(),
      onDone: () => {
        this.loggedIn();
        // Menu first, then close the login, so the backdrop pass keeps running between them.
        this.showMenu();
        login.close();
      },
    });
  }

  /** Once per login: your look on your character, and your place on the floor. */
  private loggedIn(): void {
    const p = session.profile!;
    this.applyLook(p.look);
    this.connectFloor();
  }

  private showMenu(): void {
    this.world.player.setEnabled(false);
    const menu = mountMenu({
      root: this.ui,
      session,
      sfx: this.sfx,
      backdrop: () => this.pass(),
      onEnter: () => {
        this.menu = null;
        menu.close();
        this.enterFloor();
      },
      onCharacter: () => {
        this.menu = null;
        menu.close();
        openEditor({
          root: this.ui,
          api,
          session,
          engine: this.engine,
          characters: this.world.characterFactory,
          sfx: this.sfx,
          onClose: (saved) => {
            if (saved) this.applyLook(saved);
            this.showMenu();
          },
        });
      },
      onProfile: () => openProfile({ root: this.ui, api, session, onClose: () => menu.focus() }),
      onSettings: () => openSettings({ root: this.ui, sfx: this.sfx, quality: this.engine.quality, onClose: () => menu.focus() }),
      onLogout: () => {
        this.menu = null;
        this.disconnectFloor();
        api.forgetToken();
        session.clear();
        this.showLogin();
        menu.close();
      },
    });
    menu.setOnline(this.link ? this.link.onlineCount : null);
    this.menu = menu;
  }

  /**
   * The slow pass across the floor behind login and the menu. Screens call it when they mount and
   * the returned stop when they close; counting users lets login hand over to the menu without a
   * cut.
   */
  private pass(): () => void {
    this.passUsers++;
    if (!this.passOff) {
      const plan = this.world.plan;
      const cx = (plan.pit.x0 + plan.pit.x1) / 2;
      const cz = (plan.pit.z0 + plan.pit.z1) / 2;
      const cam = this.engine.camera;
      const target = new THREE.Vector3(cx, 1.1, cz);
      let a = Math.PI * 0.35;
      this.passOff = this.engine.onFrame((dt) => {
        a += dt * 0.035;
        cam.position.set(cx + Math.sin(a) * 10.5, 4.6 + Math.sin(a * 0.7) * 0.5, cz + Math.cos(a) * 8.5);
        cam.lookAt(target);
      });
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (--this.passUsers === 0) {
        this.passOff?.();
        this.passOff = null;
      }
    };
  }

  private applyLook(look: Look): void {
    const key = JSON.stringify(look);
    if (key === this.lookKey) return;
    this.lookKey = key;
    this.world.player.character.setLook(look);
  }

  // --- the floor ------------------------------------------------------------------------------

  private connectFloor(): void {
    if (this.link) return;
    const link = new FloorLink();
    this.link = link;
    this.remotes = new RemotePlayers(link, this.engine.scene, {
      factory: this.world.characterFactory,
      seatOf: (station, slot) => this.seatOf(station, slot),
    });
    link.on('hello', (you, first) => {
      // A tab that takes over from another one carries on where that one stood.
      if (first && !this.table) this.world.player.teleport(you.x / 100, you.z / 100, byteToYaw(you.r));
    });
    link.on('online', (n) => {
      this.hud?.setOnline(n);
      this.menu?.setOnline(n);
    });
    link.on('state', (_s, code) => {
      if (code === CLOSE.REPLACED) this.openedElsewhere();
      else if (code === CLOSE.UNAUTHORIZED) this.sessionEnded();
      else if (code === CLOSE.VERSION) this.needsReload();
    });
  }

  private disconnectFloor(): void {
    this.remotes?.dispose();
    this.remotes = null;
    this.link?.close();
    this.link = null;
  }

  /**
   * Where someone sitting at a station is drawn: that game's seats, in the station's frame. At
   * your own table nobody is drawn: presence knows the table but not the chair, so a guessed chair
   * could be yours and stand in front of the camera, and the table view already shows everyone
   * at their real seats.
   */
  private seatOf(stationId: string, slot: number): SeatPose | null {
    if (this.table?.station.id === stationId) return null;
    const st = this.world.stations.find((s) => s.id === stationId);
    if (!st) return null;
    const seats = GAMES[st.game].seats(st.variant);
    const seat = seats[slot % Math.max(1, seats.length)];
    if (!seat) return null;
    st.anchor.updateWorldMatrix(true, false);
    const p = st.anchor.localToWorld(new THREE.Vector3(...seat.position));
    return { x: p.x, y: p.y, z: p.z, yaw: st.yaw + seat.yaw };
  }

  private enterFloor(): void {
    this.world.player.setEnabled(true);
    this.hud = mountHud({
      root: this.ui,
      session,
      sfx: this.sfx,
      onProfile: () => openProfile({ root: this.ui, api, session }),
      onMenu: () => void this.backToMenu(),
    });
    this.hud.setOnline(this.link ? this.link.onlineCount : null);
  }

  private async backToMenu(): Promise<void> {
    if (this.table) await this.leaveTable();
    this.hud?.close();
    this.hud = null;
    this.showMenu();
  }

  private openCashier(): void {
    this.world.player.setEnabled(false);
    openBank({ root: this.ui, api, session, sfx: this.sfx, onClose: () => this.world.player.setEnabled(true) });
  }

  // --- tables ---------------------------------------------------------------------------------

  private async sitDown(station: WorldStation): Promise<void> {
    const enteredAt = performance.now();
    const limits = ENGINES[station.game].config(station.variant, 'solo').limits.default;
    const choice = await openTableFlow({
      game: station.game,
      variant: station.variant,
      floor: this.link,
      limits: { min: limits.min, max: limits.max },
      root: this.ui,
    });
    if (!choice) {
      await this.world.exitTable();
      return;
    }
    this.openTable(station, choice, enteredAt);
  }

  private openTable(station: WorldStation, choice: TableChoice, enteredAt: number): void {
    const stage = new TableStage(this.engine, station.anchor);
    const me = session.profile!;
    // Declared before the panel so the panel's callbacks can reach the session once it exists.
    let table: TableSession | null = null;
    const party =
      choice.kind === 'lobby'
        ? new PartyPanel({
            me: me.id,
            game: station.game,
            send: (m) => table?.send(m),
            leave: () => void this.leaveTable(),
            sit: () => void table?.promptBuyIn(),
            root: this.ui,
          })
        : null;
    const module = party ? withParty(GAMES[station.game], party) : GAMES[station.game];
    table = new TableSession(
      { ...choice, game: station.game, variant: station.variant, station: station.id },
      module,
      stage,
      this.ui,
      this.sfx,
      (fn) => this.engine.onFrame(fn),
      (code) => this.tableClosed(code),
      {
        onLeave: () => void this.leaveTable(),
        onTable: (snap) => this.poseForSeat(snap.you.seat),
        onSeat: (m) => {
          const open = this.table;
          if (open) open.seated = m.status !== 'watching';
          this.hud?.setTableChips(m.status === 'watching' ? null : m.stack, m.escrow);
          if (m.seat !== null && m.status !== 'watching') this.poseForSeat(m.seat);
        },
      },
    );
    this.table = { station, session: table, stage, enteredAt, seated: false };
  }

  /**
   * Games whose seats look at different parts of the table (craps' two ends, baccarat's and Three
   * Card Poker's arcs) get the camera moved to your seat once the table says which it is.
   */
  private posed: string | null = null;
  private poseForSeat(seat: number | null): void {
    const open = this.table;
    if (!open || seat === null) return;
    const key = `${open.station.id}:${seat}`;
    if (this.posed === key) return;
    this.posed = key;
    const module = GAMES[open.station.game];
    const want = module.playPose(open.station.variant, seat);
    const first = module.playPose(open.station.variant, null);
    if (samePose(want, first)) return;
    const wait = Math.max(0, open.enteredAt + FLY_IN_MS - performance.now());
    setTimeout(() => {
      if (this.table !== open) return;
      this.flyCamera(open.stage.worldPose(want), 0.6);
    }, wait);
  }

  private flyCamera(to: { position: THREE.Vector3; target: THREE.Vector3 }, dur: number): void {
    const cam = this.engine.camera;
    const from = cam.position.clone();
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const fromT = from.clone().addScaledVector(dir, from.distanceTo(to.target));
    const look = new THREE.Vector3();
    let t = 0;
    const off = this.engine.onFrame((dt) => {
      t = Math.min(1, t + dt / dur);
      const k = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      cam.position.lerpVectors(from, to.position, k);
      look.lerpVectors(fromT, to.target, k);
      cam.lookAt(look);
      if (t >= 1) off();
    });
  }

  /** Esc at a table: leave, after a word if you have chips down. */
  escape(): void {
    const open = this.table;
    if (!open) {
      void this.world.exitTable();
      return;
    }
    if (!open.seated) {
      void this.leaveTable();
      return;
    }
    const m = modal(
      'Leave the table?',
      ['Your chips go back to your balance. Anything still in play is settled first: undealt bets come back, hands in progress are stood or folded.'],
      [
        button('Leave', () => {
          m.close();
          void this.leaveTable();
        }, { cls: 'primary' }),
        button('Stay', () => m.close(), { cls: 'ghost' }),
      ],
    );
  }

  private async leaveTable(): Promise<void> {
    const open = this.table;
    if (!open) return;
    this.table = null;
    this.posed = null;
    open.session.leave();
    this.hud?.setTableChips(null);
    // The view disposes itself when the socket closes (150 ms after the leave goes out).
    setTimeout(() => open.stage.dispose(), 250);
    await this.world.exitTable();
  }

  private tableClosed(code?: number): void {
    const open = this.table;
    if (!open) return;
    if (code === CLOSE.REPLACED) return this.openedElsewhere();
    if (code === CLOSE.UNAUTHORIZED) return this.sessionEnded();
    if (code === CLOSE.VERSION) return this.needsReload();
    this.table = null;
    this.posed = null;
    open.session.close();
    open.stage.dispose();
    this.hud?.setTableChips(null);
    toast(code === CLOSE.FORBIDDEN ? "You can't join that table." : code === CLOSE.NOT_FOUND ? 'That table has closed.' : 'Lost the table.', 'err');
    void this.world.exitTable();
  }

  // --- the few ways a session ends ------------------------------------------------------------

  private openedElsewhere(): void {
    this.halt('Opened in another tab', 'The casino is open in another tab or window with this name. Only one can play at a time.');
  }

  private sessionEnded(): void {
    api.forgetToken();
    this.halt('Log in again', 'Your session ended.');
  }

  private needsReload(): void {
    this.halt('The casino was updated', 'Reload to play the new version.');
  }

  private halt(title: string, text: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.table?.session.close();
    this.disconnectFloor();
    this.world.player.setEnabled(false);
    modal(title, [text], [button('Reload', () => location.reload(), { cls: 'primary' })]);
  }
}

function samePose(a: Pose, b: Pose): boolean {
  const d = (x: readonly number[], y: readonly number[]) => Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
  return d(a.position, b.position) < 0.01 && d(a.target, b.target) < 0.01;
}
