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
import { seatWorld } from '../world/stations.ts';
import { RemotePlayers, type SeatPose } from '../world/remote-players.ts';
import { FloorLink, byteToYaw } from '../net/presence.ts';
import { GAMES } from '../games/index.ts';
import { openTableFlow, PartyPanel, withParty, type TableChoice } from '../ui/lobby/index.ts';
import { mountHud, mountLogin, mountMenu, openBank, openEditor, openProfile, openSettings, overlayCount, type Hud, type MenuHandle } from '../ui/menu/index.ts';
import { isTyping } from '../ui/keyboard.ts';
import { mountEmotes, openLeaderboard, socialApi, socialButton, type EmoteWheel } from '../ui/social/index.ts';
import { button, modal, toast } from '../ui/kit.ts';
import { ENGINES } from '../../../shared/src/games/index.ts';
import { CLOSE, type Profile } from '../../../shared/src/protocol.ts';

export async function boot(): Promise<void> {
  const ui = document.getElementById('ui')!;
  const fill = document.getElementById('boot-fill');
  const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, savedQuality());
  engine.onFrame((dt) => updateTweens(dt));
  const sfx = new Sfx();
  // A saved login is checked while the floor loads, not after it.
  const saved = api.savedToken() ? api.me().catch(() => null) : Promise.resolve(null);
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
  await app.start(saved);
}

interface OpenTable {
  station: WorldStation;
  session: TableSession;
  /** The lobby's party panel; it goes with the view, or with the table if no view ever came. */
  party: PartyPanel | null;
  /** Bought in (not just watching). */
  seated: boolean;
  /** The seat the camera was last moved to. */
  posed: number | null;
}

class App {
  private link: FloorLink | null = null;
  private remotes: RemotePlayers | null = null;
  private hud: Hud | null = null;
  private emotes: EmoteWheel | null = null;
  private menu: MenuHandle | null = null;
  private table: OpenTable | null = null;
  private passUsers = 0;
  private passOff: (() => void) | null = null;
  private lookKey = '';
  private stopped = false;
  /** Where each station's n-th seated player is drawn; stations never move. */
  private readonly seatCache = new Map<string, SeatPose | null>();

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
    // Every way a profile arrives (login, the saved session, the editor's save) goes through
    // session.set, so this one listener keeps your character dressed.
    session.on((p) => {
      const key = JSON.stringify(p.look);
      if (key === this.lookKey) return;
      this.lookKey = key;
      world.player.character.setLook(p.look);
    });
    // The table's own shortcuts. Capture phase, so a key the view uses (Esc closing its rules
    // panel, say) never also reaches the floor behind it.
    addEventListener(
      'keydown',
      (e) => {
        const view = this.table?.session.view;
        if (!view?.keydown || overlayCount() > 0 || isTyping(e)) return;
        if (view.keydown(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );
  }

  async start(saved: Promise<Profile | null>): Promise<void> {
    this.world.player.setEnabled(false);
    const profile = await saved;
    if (profile) {
      session.set(profile);
      this.connectFloor();
      this.showMenu();
      return;
    }
    api.forgetToken();
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
        this.connectFloor();
        // Menu first, then close the login, so the backdrop pass keeps running between them.
        this.showMenu();
        login.close();
      },
    });
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
        openEditor({ root: this.ui, api, session, engine: this.engine, characters: this.world.characterFactory, sfx: this.sfx, onClose: () => this.showMenu() });
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
    menu.setOnline(this.link?.onlineCount ?? null);
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

  // --- the floor ------------------------------------------------------------------------------

  private connectFloor(): void {
    if (this.link) return;
    const link = new FloorLink();
    this.link = link;
    this.remotes = new RemotePlayers(link, this.engine.scene, {
      factory: this.world.characterFactory,
      seatOf: (station, slot) => this.seatOf(station, slot),
    });
    // Gestures show over whoever made them, you included (the server echoes yours back).
    this.world.useRemotes(this.remotes);
    link.on('emote', (id, e) => void this.world.showEmote(id === link.you?.id ? 'me' : id, e));
    link.on('hello', (you, first) => {
      // A tab that takes over from another one carries on where that one stood.
      if (first && !this.table) this.world.player.teleport(you.x / 100, you.z / 100, byteToYaw(you.r));
    });
    link.on('online', (n) => {
      this.hud?.setOnline(n);
      this.menu?.setOnline(n);
    });
    link.on('state', (_s, code) => void this.endsSession(code));
  }

  private disconnectFloor(): void {
    this.world.useRemotes(null);
    this.remotes?.dispose();
    this.remotes = null;
    this.link?.close();
    this.link = null;
  }

  /**
   * Where someone sitting at a station is drawn. At the table you're at (from pressing E) nobody
   * is: presence knows the table but not the chair, so a guessed chair could be yours and stand
   * in front of the camera, and the table view already shows everyone at their real seats.
   */
  private seatOf(stationId: string, slot: number): SeatPose | null {
    if (this.world.seated?.id === stationId) return null;
    const key = `${stationId}:${slot}`;
    let pose = this.seatCache.get(key);
    if (pose === undefined) {
      const st = this.world.stations.find((s) => s.id === stationId);
      pose = st ? seatWorld(st, slot) : null;
      this.seatCache.set(key, pose);
    }
    return pose;
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
    this.hud.setOnline(this.link?.onlineCount ?? null);
    // Emotes (G) and the leaderboards, in the HUD's right-hand bar ahead of the tips bulb.
    this.emotes = mountEmotes({ root: this.ui, send: (e) => void this.link?.emote(e) });
    const bar = this.hud.root.querySelector('.hud-right')!;
    const first = bar.querySelector('.hud-btn');
    bar.insertBefore(socialButton('emotes', 'Emotes (G)', () => this.emotes?.toggle()), first);
    bar.insertBefore(socialButton('leaderboard', 'Leaderboards', () => openLeaderboard({ root: this.ui, api: socialApi })), first);
  }

  private async backToMenu(): Promise<void> {
    if (!this.hud) return;
    if (this.table) await this.leaveTable();
    this.emotes?.dispose();
    this.emotes = null;
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
    const choice = await openTableFlow({
      game: station.game,
      variant: station.variant,
      floor: this.link,
      limits: ENGINES[station.game].config(station.variant, 'solo').limits.default,
      root: this.ui,
    });
    if (!choice) {
      await this.world.exitTable();
      return;
    }
    this.openTable(station, choice);
  }

  private openTable(station: WorldStation, choice: TableChoice): void {
    const me = session.profile!;
    // Declared before the panel so the panel's callbacks can reach the session once it exists.
    let table: TableSession | null = null;
    // Messages from a table already left (its socket lingers a moment) change nothing here.
    const current = () => table !== null && this.table?.session === table;
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
      new TableStage(this.engine, station.anchor),
      this.ui,
      this.sfx,
      (fn) => this.engine.onFrame(fn),
      (code) => this.tableClosed(table!, code),
      {
        onLeave: () => current() && void this.leaveTable(),
        onTable: (snap) => {
          if (!current()) return;
          // A reconnect sends only the snapshot: it says whether you're seated and with what.
          const seated = snap.you.status !== 'watching';
          this.table!.seated = seated;
          this.hud?.setTableChips(seated ? snap.you.stack : null);
          this.poseForSeat(snap.you.seat);
        },
        onSeat: (m) => {
          if (!current()) return;
          const seated = m.status !== 'watching';
          this.table!.seated = seated;
          this.hud?.setTableChips(seated ? m.stack : null, m.escrow);
          if (seated) this.poseForSeat(m.seat);
        },
      },
    );
    this.table = { station, session: table, party, seated: false, posed: null };
  }

  /**
   * Games whose seats look at different parts of the table (craps' two ends, baccarat's and Three
   * Card Poker's arcs) move the camera to your seat once the table says which it is.
   */
  private poseForSeat(seat: number | null): void {
    const open = this.table;
    if (!open || seat === null || open.posed === seat) return;
    open.posed = seat;
    const { game, variant } = open.station;
    if (!samePose(GAMES[game].playPose(variant, seat), GAMES[game].playPose(variant, null))) this.world.aim(seat);
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
    const stay = button('Stay', () => m.close(), { cls: 'ghost' });
    const m = modal(
      'Leave the table?',
      ['Your chips go back to your balance. Anything still in play is settled first: undealt bets come back, hands in progress are stood or folded.'],
      [
        button('Leave', () => {
          m.close();
          void this.leaveTable();
        }, { cls: 'primary' }),
        stay,
      ],
      () => m.close(),
    );
    // Space deals or rolls at every table; a reflex press here must not stand you up.
    stay.focus();
  }

  private async leaveTable(): Promise<void> {
    const open = this.table;
    if (!open) return;
    this.table = null;
    // The session closes itself (and its stage) once the leave has gone out.
    open.session.leave();
    open.party?.dispose();
    this.hud?.setTableChips(null);
    void this.refreshProfile();
    await this.world.exitTable();
  }

  /**
   * The cash-out's balance message can land after the table's socket has closed (it waits on D1,
   * and on any bets still in play), so ask for the profile until the chips have come home.
   */
  private async refreshProfile(): Promise<void> {
    for (const wait of [800, 2500, 6000, 15_000]) {
      await new Promise((r) => setTimeout(r, wait));
      try {
        const p = await api.me();
        session.set(p);
        if (p.inPlay === 0) return;
      } catch {
        return;
      }
    }
  }

  private tableClosed(closed: TableSession, code?: number): void {
    const open = this.table;
    if (!open || open.session !== closed) return;
    if (this.endsSession(code)) return;
    this.table = null;
    open.session.close();
    open.party?.dispose();
    this.hud?.setTableChips(null);
    toast(code === CLOSE.FORBIDDEN ? "You can't join that table." : code === CLOSE.NOT_FOUND ? 'That table has closed.' : 'Lost the table.', 'err');
    void this.world.exitTable();
  }

  // --- the ways a whole session ends ------------------------------------------------------------

  /**
   * A close that ends the session rather than one table: this name opened in another tab, or the
   * login ran out. (A new version of the game reloads the page from the socket itself.) True if
   * it was one.
   */
  private endsSession(code?: number): boolean {
    if (code === CLOSE.REPLACED) {
      this.halt('Opened in another tab', 'The casino is open in another tab or window with this name. Only one can play at a time.');
    } else if (code === CLOSE.UNAUTHORIZED) {
      api.forgetToken();
      this.halt('Log in again', 'Your session ended.');
    } else {
      return false;
    }
    return true;
  }

  private halt(title: string, text: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.table?.session.close();
    this.emotes?.dispose();
    this.emotes = null;
    this.disconnectFloor();
    this.world.player.setEnabled(false);
    modal(title, [text], [button('Reload', () => location.reload(), { cls: 'primary' })]);
  }
}

function samePose(a: Pose, b: Pose): boolean {
  const d = (x: readonly number[], y: readonly number[]) => Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
  return d(a.position, b.position) < 0.01 && d(a.target, b.target) < 0.01;
}
