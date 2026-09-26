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
import { HIGH_TIER, seatWorld } from '../world/stations.ts';
import { RemotePlayers, type SeatPose } from '../world/remote-players.ts';
import { FloorLink, byteToYaw } from '../net/presence.ts';
import { GAMES } from '../games/index.ts';
import { openTableFlow, PartyPanel, withParty, type TableChoice } from '../ui/lobby/index.ts';
import { closeTableFlows, InviteHub } from '../ui/lobby/index.ts'; // v6 invite6
import { ensureOwnLook, isNewPlayer, mountHud, mountLogin, mountMenu, openBank, openEditor, openOnboarding, openProfile, openSettings, overlayCount, type Hud, type MenuHandle } from '../ui/menu/index.ts';
import { isTyping } from '../ui/keyboard.ts';
import { mountEmotes, openLeaderboard, socialApi, socialButton, type EmoteWheel } from '../ui/social/index.ts';
import { createChat, type Chat } from '../ui/chat/index.ts';
import { mountFloorLife, type FloorLife } from '../ui/feed/index.ts';
import { Bar, openBarMenu, openShop, shopApi, shopButton } from '../ui/shop/index.ts';
import { openEffects } from '../ui/shop/index.ts'; // v6 shop6: effects from anywhere on the floor
import { button, modal, toast } from '../ui/kit.ts';
import { showAway, showIdleWarning, type AwayHandle, type WarningHandle } from '../ui/away/away.ts';
import { IdleWatch } from './idle.ts';
import { RideSound, rideKey } from '../world/rides.ts';
import { mountFeats, type FeatsUi } from '../ui/feats/index.ts'; // v6 feats6
import { ENGINES } from '../../../shared/src/games/index.ts';
import { mountDaily, dailyApi, type DailyHandle } from '../ui/daily/index.ts'; // v6 celebs6
// v6 bank6: the bank's calls and its transfer notices
import * as bankApi from '../ui/bank/api.ts';
import { bankNotices } from '../ui/bank/notices.ts';
import { CLOSE, type Profile } from '../../../shared/src/protocol.ts';
// v6 dine6: drinking and eating what the bar brings
import { Diner } from '../world/consumables/diner.ts';
import { mountLaw, type Law } from '../world/law/index.ts'; // v6 law6
import type { Person } from '../world/characters.ts'; // v6 law6
// v6 cars6: the valet lot, the curb and the garage (world/cars/), the valet's panel (ui/cars/)
import { Cars } from '../world/cars/index.ts';
import { openValet } from '../ui/cars/valet.ts';
import * as carsApi from '../ui/cars/api.ts';
import { serverNow } from '../net/clock.ts';
import { carItem } from '../../../shared/src/items.ts';
import { keyLabel } from '../ui/keys.ts';
import { installCheck } from '../ui/check/check.ts'; // v6 bot6: the Quick check
import { V7 } from './v7.ts'; // v7

export async function boot(): Promise<void> {
  const ui = document.getElementById('ui')!;
  const fill = document.getElementById('boot-fill');
  // the floor's bloom multisamples the scene itself on High (see Engine3D)
  const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, savedQuality(), { antialias: false });
  engine.onFrame((dt) => updateTweens(dt));
  const sfx = new Sfx();
  // A saved login is checked while the floor loads, not after it.
  const saved = api.savedToken() ? api.me().catch(() => null) : Promise.resolve(null);
  let app: App | null = null;
  // nothing is drawn behind the loading screen (see Engine3D.paused)
  engine.paused = true;
  const world = await createWorld(engine, {
    ui,
    sfx,
    onProgress: (k) => {
      if (fill) fill.style.width = `${Math.round(k * 100)}%`;
    },
    onEscape: () => app?.escape(),
  });
  engine.paused = false;
  // The cards' faces and the sounds aren't needed to show the floor: they load behind the login
  // (a quarter of a megabyte each), and sitting down at a table waits for the cards.
  loadCards().catch((err) => console.warn('cards failed to load', err));
  sfx.load().catch((err) => console.warn('sounds failed to load', err));
  app = new App(engine, world, sfx, ui);
  // Handles for the console and the headless checks; nothing here can move money.
  (window as unknown as { casino: unknown }).casino = { engine, world, app, session };
  await app.start(saved);
  // the first frames put the floor on the GPU (the first is long): behind the loading screen, not
  // on the login screen where they would hold up typing
  for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
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
  private chat: Chat | null = null;
  /** The bar's orders, from paying to your hand (ui/shop/bar.ts); world.holdItem lands here. */
  private bar: Bar | null = null;
  /** Big wins on the floor: the marquee, the toast, the day's meter and the room's sound. */
  private readonly life: FloorLife;
  /** v6 cars6: the cars on the ground floor. */
  readonly cars: Cars;
  private lifeOff: (() => void) | null = null;
  private menu: MenuHandle | null = null;
  private table: OpenTable | null = null;
  private passUsers = 0;
  private passOff: (() => void) | null = null;
  private lookKey = '';
  private stopped = false;
  /** The latest profile refresh after leaving a table (refreshProfile); older ones stop. */
  private refreshRun = 0;
  /** netsec: idle. The page's own idle clock (app/idle.ts), running while the floor is connected. */
  private readonly idle: IdleWatch;
  private idleWarning: WarningHandle | null = null;
  /** The away screen, while it's up. */
  private away: AwayHandle | null = null;
  /** Coming back from away: the floor keeps you where you stand rather than where it last saw you. */
  private comingBack = false;
  /** Walking when we went away (or at a table, which puts us back on the floor): walking again after. */
  private awayWalking = false;
  /** v6 bank6: money from other players, told on the floor, while the floor is connected. */
  private bankOff: (() => void) | null = null;
  /** v6 invite6: invites to lobby tables (ui/lobby/invites.ts), while the floor is connected. */
  private invites: InviteHub | null = null;
  /** v6 celebs6: the daily bonus's HUD button and sheet, while the HUD is up. */
  private daily: DailyHandle | null = null;
  /** Where each station's n-th seated player is drawn; stations never move. */
  private readonly seatCache = new Map<string, SeatPose | null>();
  /** v6 dine6: you, drinking and eating what the bar brings (world/consumables/). */
  readonly diner: Diner;
  /** v6 law6: security, the pit boss, punches and the jail (world/law/). */
  private readonly law: Law;
  /** v7: driving, apartments, stores, guns, the online list (app/v7.ts). */
  private v7: V7 | null = null;
  /** v6 feats6: the achievements (HUD cup, J, the sheet, the card when you earn one). */
  private feats: FeatsUi | null = null;

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
    this.life = mountFloorLife({ engine, world, sfx, ui });
    // v6 law6:
    this.law = mountLaw({
      engine,
      world,
      ui,
      sfx,
      character: (id) => this.remotes?.character(id) as Person | undefined,
      canPunch: () => this.hud !== null && this.table === null && world.seated === null && !this.v7?.busy,
      leaveTable: () => void this.leaveTable(),
      openBank: () => this.openCashier(),
    });
    // v6 cars6: the valet lot, the curb and your garage; E at the podium opens the valet
    this.cars = new Cars({
      engine,
      world,
      now: serverNow,
      me: () => this.link?.you?.id ?? null,
      onValet: () => this.openValet(),
      onKeys: (c) => toast(`Your ${carItem(c.car)?.name ?? 'car'} is at the curb. The valet hands you the keys.`),
      free: () => this.hud !== null && this.table === null && this.world.seated === null && overlayCount() === 0,
    });
    void this.cars.load();
    engine.onFrame((dt) => this.cars.update(dt));
    // v7: driving, the street's knocks, the online list, apartments, stores and guns
    this.v7 = new V7({
      engine,
      world,
      sfx,
      ui,
      cars: this.cars,
      link: () => this.link,
      character: (id) => this.remotes?.character(id) as Person | undefined,
      free: () => this.hud !== null && this.table === null && this.world.seated === null && !this.away,
      law: this.law,
      openValet: () => this.openValet(),
    });
    session.on((p) => this.cars.setOwned(p.owned, p.name));
    // v6 looks6: B steps off your ride and back on (a look save, so everyone sees it)
    const rideFree = () => overlayCount() === 0 && this.hud !== null && this.table === null && this.world.seated === null && !this.v7?.busy && !this.away;
    rideKey({
      profile: () => session.profile,
      // v7.2: on (or off) at once, on your own screen; the server's answer follows, and a failed
      // save puts the look back as it was
      save: async (look) => {
        const at = session.profile;
        const was = at?.look;
        if (at) session.set({ ...at, look });
        try {
          const stored = await api.saveLook(look);
          const now = session.profile;
          if (now) session.set({ ...now, look: stored });
          return stored;
        } catch (err) {
          const now = session.profile;
          if (now && was && now.look === look) session.set({ ...now, look: was });
          throw err;
        }
      },
      allowed: (e) => !isTyping(e) && rideFree(),
      say: (text) => toast(text),
      ui,
      free: rideFree,
    });
    const rideSound = new RideSound(sfx);
    engine.onFrame((dt) => rideSound.update(dt, world.player.character, this.hud !== null && this.table === null && this.world.seated === null && !this.away));
    this.idle = new IdleWatch({
      showWarning: (at) => {
        this.idleWarning?.close();
        this.idleWarning = showIdleWarning({ root: this.ui, at, atTable: this.table !== null });
        if (!this.sfx.muted) this.sfx.play('ui-switch', { volume: 0.7 });
      },
      hideWarning: () => {
        this.idleWarning?.close();
        this.idleWarning = null;
      },
      idle: () => void this.goAway(),
      // Straight to the sockets: a table session's own send() would toast while it reconnects.
      here: () => (this.link?.send({ t: 'here' }) ?? true) && (this.table?.session.socket.send({ t: 'here' }) ?? true),
    });
    // v6 dine6: sips and bites (Q), what they do for you, the empty taken away
    this.diner = new Diner({
      ui,
      camera: engine.camera,
      character: world.player.character,
      look: () => session.profile?.look ?? null,
      drop: () => void this.bar?.drop(),
      onFloor: () => this.hud !== null && this.table === null && this.world.seated === null,
      waiters: world.life.waiters,
      sound: sfx,
    });
    engine.onFrame((dt) => this.diner.update(dt));
  }

  async start(saved: Promise<Profile | null>): Promise<void> {
    this.world.player.setEnabled(false);
    const profile = await saved;
    if (profile) {
      session.set(profile);
      this.connectFloor();
      // a new player who reloads half way through picking a look carries on picking it
      if (isNewPlayer(profile)) this.onboard();
      else this.showMenu();
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
      onDone: (profile) => {
        this.connectFloor();
        // A new player picks their look first and goes straight onto the floor; everyone else
        // gets the menu (first, then close the login, so the backdrop pass keeps running).
        if (isNewPlayer(profile)) this.onboard();
        else this.showMenu();
        login.close();
      },
    });
  }

  /** A new player's first stop: "Pick your look", step by step, then onto the floor. */
  private onboard(): void {
    this.world.player.setEnabled(false);
    openOnboarding({ root: this.ui, api, session, engine: this.engine, characters: this.world.characterFactory, sfx: this.sfx, onDone: () => this.enterFloor() });
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
    // The idle clock runs while the floor is connected (started first: see app/idle.ts).
    this.idle.start();
    const link = new FloorLink();
    this.link = link;
    this.remotes = new RemotePlayers(link, this.engine.scene, {
      factory: this.world.characterFactory,
      seatOf: (station, slot) => this.seatOf(station, slot),
      // a stool, a sofa: sitting anywhere (world/life/)
      seatFor: (id) => this.world.life.seatFor(id),
      // nobody in a room you can't see into, or behind you, is drawn or animated; in a crowd the
      // nearest are, and everyone's shadow is one draw
      inView: (x, z, id) => this.world.canSee(x, z, id),
      eye: () => this.engine.camera.position,
      shadow: { geometry: this.world.characterFactory.blobGeometry, material: this.world.characterFactory.blob },
    });
    // Gestures show over whoever made them, you included (the server echoes yours back).
    this.world.useRemotes(this.remotes);
    // Chat, made with the socket so the floor's backlog is caught behind the menu; shown on the
    // floor. A floor line floats over whoever said it, you included.
    this.chat = createChat({
      root: this.ui,
      floor: link,
      character: (id) => (id === link.you?.id ? this.world.player.character : this.remotes?.character(id)),
      onFrame: (fn) => this.engine.onFrame(fn),
      camera: this.engine.camera,
    });
    // Big wins are announced to people out on the floor, never to the winner at their table.
    this.lifeOff = this.life.connect(link, { onFloor: () => this.hud !== null && this.table === null && this.world.seated === null });
    link.on('emote', (id, e) => void this.world.showEmote(id === link.you?.id ? 'me' : id, e));
    link.subscribe((m) => this.cars.hear(m)); // v6 cars6: cars called round to the valet's curb
    // v6 cars6: the cars you own, for your garage (the profile lists them once it carries owned)
    void shopApi.shop().then((r) => {
      const p = session.profile;
      const cars = r.owned.map((o) => o.item).filter((id) => carItem(id) && !p?.owned?.includes(id));
      if (p && cars.length) session.set({ ...p, owned: [...(p.owned ?? []), ...cars] });
    }, () => {});
    // v6 emotes6: an emote bought or earned while you're on the floor is yours at once: in the
    // profile (the wheel reads it there next time) and unlocked on a wheel that's up now
    link.on('owned', (emotes) => {
      const p = session.profile;
      if (p) session.set({ ...p, owned: [...new Set([...(p.owned ?? []), ...emotes])] });
      this.emotes?.grant(emotes);
    });
    // v6 fx6: the shop's effects and the lobby's statues, for everyone on the floor (world/fx/)
    this.world.useFx({ self: () => link.you?.id ?? null, marquee: this.life.marquee, tally: this.life.tally });
    link.on('fx', (ev) => this.world.playFx(ev));
    link.on('fxs', (list) => this.world.syncFx(list));
    link.on('statues', (list) => void this.world.setStatues(list));
    link.on('hello', (you, first) => {
      // A tab that takes over from another one carries on where that one stood. Coming back from
      // away, the floor forgot us; the first position we send puts us back where we stand.
      if (first && !this.table && !this.comingBack) this.world.player.teleport(you.x / 100, you.z / 100, byteToYaw(you.r));
      this.comingBack = false;
    });
    link.on('online', (n) => {
      this.hud?.setOnline(n);
      this.menu?.setOnline(n);
    });
    link.on('state', (_s, code) => void this.endsSession(code));
    // v6 feats6: a feat of yours the floor heard of before any table said (earned as you left)
    link.subscribe((m) => m.t === 'feat' && this.feats?.floorFeat(m));
    // Kept through away and back, with whatever is paid for and on its way.
    this.bar ??= new Bar({
      session,
      api: { order: shopApi.order, saveLook: api.saveLook },
      seated: () => this.table !== null || this.world.seated !== null,
      onSit: (fn) => this.world.onEnter(() => fn()),
    });
    this.world.useBar(this.bar);
    // The floor's life: seats arbitrated on this socket, orders made by the bartender and brought
    // by the waiters, and the staff's greetings by name.
    this.world.life.useLink(link);
    this.world.useFloor(link); // v6 city6: the elevator and the server's moves
    this.world.city.leaveTable = () => void this.leaveTable(); // v6 city6: a move while at a table
    this.law.useLink(link); // v6 law6
    this.v7?.useLink(link); // v7
    this.world.life.useBar(this.bar);
    this.invites = this.inviteHub(link); // v6 invite6
    this.world.life.useApp({
      name: () => session.profile?.name ?? null,
      openBarMenu: () => this.openBarMenu(),
      openShop: (item) => this.openShop(item),
      holdItem: (id) => this.world.holdItem(id),
      atTable: () => this.table !== null || this.world.seated !== null,
    });
    // v6 celebs6: a celebrity's tip and a gift box land in the balance; their notices show while you walk the floor
    this.world.life.celebs.useApp({ money: (m) => session.balance(m.balance, m.inPlay, m.rev), sfx: this.sfx, onFloor: () => this.hud !== null && this.table === null && this.world.seated === null && overlayCount() === 0, snapper: this.engine });
    // v6 bank6: money from other players, told on the floor (ui/bank/notices.ts)
    this.bankOff = bankNotices({ link, inbox: () => bankApi.bank().then((s) => s.inbox), me: api.me, setProfile: (p) => session.set(p), say: (t) => toast(t, 'info', 6000), sfx: this.sfx });
  }

  /**
   * Off the floor. Going away keeps the bar (`keepBar`): drinks paid for are still owed, and a
   * bar menu left open behind the away screen still orders from it after Come back.
   */
  private disconnectFloor(keepBar = false): void {
    this.idle.stop();
    this.world.life.celebs.useApp(null); // v6 celebs6
    this.bankOff?.(); // v6 bank6
    this.bankOff = null;
    this.world.life.useApp(null);
    this.world.life.useBar(null);
    this.world.life.useLink(null);
    this.world.useFloor(null); // v6 city6
    this.law.useLink(null); // v6 law6
    this.v7?.useLink(null); // v7
    this.world.useBar(null);
    if (!keepBar) {
      this.bar?.dispose();
      this.bar = null;
    }
    this.lifeOff?.();
    this.lifeOff = null;
    this.invites?.dispose(); // v6 invite6
    this.invites = null;
    this.chat?.dispose();
    this.chat = null;
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
    // Nobody walks in as the default suit: an account still in it gets a look of its own (saved).
    ensureOwnLook({ api, session });
    // Back in control on the floor, the world takes the mouse (this runs inside the Enter Casino
    // click, the gesture the browser wants for Pointer Lock).
    this.world.player.setEnabled(true);
    this.hud = mountHud({
      root: this.ui,
      session,
      sfx: this.sfx,
      onProfile: () => openProfile({ root: this.ui, api, session }),
      onMenu: () => void this.backToMenu(),
      onBreak: () => void this.takeBreak(), // v6.1 casino61: the play reminder
      onOnline: () => this.v7?.openOnline(), // v7
    });
    this.hud.setOnline(this.link?.onlineCount ?? null);
    // Emotes (G) and the leaderboards, in the HUD's right-hand bar ahead of the tips bulb.
    // v6 emotes6: the wheel shows what you own; a locked one opens the boutique at it
    this.emotes = mountEmotes({ root: this.ui, send: (e) => void this.link?.emote(e), owned: () => session.profile?.owned, shop: (e) => this.openShop(e) });
    const bar = this.hud.root.querySelector('.hud-right')!;
    const first = bar.querySelector('.hud-btn');
    bar.insertBefore(socialButton('emotes', `Emotes (${keyLabel('emotes')})`, () => this.emotes?.toggle()), first);
    // v6 stats6: at a table, the leaderboards open on its game's boards
    const boards = () => openLeaderboard({ root: this.ui, api: socialApi, ...(this.table ? { game: this.table.station.game } : {}) });
    bar.insertBefore(socialButton('leaderboard', 'Leaderboards', boards), first);
    bar.insertBefore(shopButton('boutique', 'Boutique', () => this.openShop()), first);
    bar.insertBefore(shopButton('effects', 'Effects', () => this.openEffects()), first); // v6 shop6
    bar.insertBefore(shopButton('bar', 'Bar', () => this.openBarMenu()), first);
    // v6 celebs6: the daily bonus (its button, and its sheet on arrival while today's is waiting)
    this.daily = mountDaily({ root: this.ui, bar, before: first, api: dailyApi, money: (m) => session.balance(m.balance, m.inPlay, m.rev), sfx: this.sfx });
    // v6 feats6: the achievements, their cup in the bar and your title under your name
    this.feats?.dispose();
    this.feats = mountFeats({ root: this.ui, session, sfx: this.sfx, game: () => this.table?.station.game ?? null });
    bar.insertBefore(this.feats.button, first);
    this.feats.useHud(this.hud.root);
    installCheck(); // v6 bot6: the Quick check, when a table or the API says one is waiting
    this.chat?.setVisible(true);
  }

  /** v6.1 casino61: the play reminder's Take a break: up from any table (chips cash out as ever). */
  private async takeBreak(): Promise<void> {
    if (this.table) await this.leaveTable();
    else if (closeTableFlows() || this.world.seated) await this.world.exitTable();
  }

  private async backToMenu(): Promise<void> {
    if (!this.hud) return;
    if (this.table) await this.leaveTable();
    this.emotes?.dispose();
    this.emotes = null;
    this.daily?.dispose(); // v6 celebs6
    this.daily = null;
    this.feats?.dispose(); // v6 feats6
    this.feats = null;
    this.chat?.setVisible(false);
    this.hud?.close();
    this.hud = null;
    this.showMenu();
  }

  /**
   * The boutique, from the HUD for now (a storefront and shopkeeper on the floor later); `item`
   * opens it at that piece. On the floor only: it borrows the camera a table would be using.
   */
  openShop(item?: string): void {
    if (!this.hud) return;
    if (this.table || this.world.seated) {
      toast('Stand up from the table to go to the boutique.');
      return;
    }
    this.world.player.setEnabled(false);
    openShop({
      root: this.ui,
      api: { shop: shopApi.shop, buy: shopApi.buy, fx: shopApi.fx, saveLook: api.saveLook },
      session,
      engine: this.engine,
      characters: this.world.characterFactory,
      sfx: this.sfx,
      item,
      // v6 shop6: what's playing on the floor and where you stand, for the effects
      floor: this.link,
      where: () => this.whereOnFloor(),
      onClose: () => this.world.player.setEnabled(true),
    });
  }

  /** v6 cars6: the valet's panel (E at the podium out front): buy cars, have one brought round. */
  openValet(car?: string): void {
    if (!this.hud) return;
    if (this.table || this.world.seated) return;
    this.world.player.setEnabled(false);
    openValet({
      root: this.ui,
      api: { shop: shopApi.shop, buy: shopApi.buy, valet: carsApi.valet, newOp: shopApi.newOp },
      session,
      engine: this.engine,
      mats: this.cars.mats,
      sfx: this.sfx,
      car,
      atCurb: () => this.cars.valet.mine(),
      onCall: (c) => c && this.cars.valet.hear(c),
      onClose: () => this.world.player.setEnabled(true),
    });
  }

  // v6 shop6: effects bought from the HUD, anywhere on the floor (ui/shop/effects.ts)
  openEffects(): void {
    if (!this.hud) return;
    const walking = this.table === null && this.world.seated === null;
    if (walking) this.world.player.setEnabled(false);
    openEffects({
      root: this.ui,
      api: { fx: shopApi.fx },
      session,
      floor: this.link,
      where: () => this.whereOnFloor(),
      sfx: this.sfx,
      openBoutique: walking ? () => this.openShop('fx-confetti') : undefined,
      onClose: () => walking && this.world.player.setEnabled(true),
    });
  }

  /** v6 shop6: where you stand (metres) while the floor socket is up; effects play there. */
  private whereOnFloor(): { x: number; z: number } | null {
    if (!this.link?.you) return null;
    const p = this.world.player.position;
    return { x: p.x, z: p.z };
  }

  /** The bar's menu, from the HUD for now (a waiter's, later). */
  openBarMenu(): void {
    if (!this.bar) return;
    const walking = this.table === null && this.world.seated === null;
    if (walking) this.world.player.setEnabled(false);
    openBarMenu({ root: this.ui, bar: this.bar, session, sfx: this.sfx, onClose: () => walking && this.world.player.setEnabled(true) });
  }

  private openCashier(): void {
    this.world.player.setEnabled(false);
    // the banker at the window answers what the bank does: a top-up counted out, a refusal
    const life = this.world.life;
    const takeLoan = () =>
      api.takeLoan().then(
        (r) => {
          life.bank({ kind: 'loan', amount: r.loan.amount });
          return r;
        },
        (err: unknown) => {
          life.bank({ kind: 'refused' });
          throw err;
        },
      );
    openBank({
      root: this.ui,
      api: { me: api.me, takeLoan },
      session,
      sfx: this.sfx,
      onClose: () => {
        this.world.player.setEnabled(true);
        life.leftBank();
      },
    });
  }

  // --- tables ---------------------------------------------------------------------------------

  private async sitDown(station: WorldStation): Promise<void> {
    // v6 law6: the jail's tables go straight to a solo table, and only for inmates
    const jailed = this.law.tableChoice(station);
    if (jailed === 'refuse') {
      await this.world.exitTable();
      return;
    }
    // v6 invite6: an invite being joined sits straight down at its table
    const choice = jailed ?? this.invites?.claim(station) ?? await openTableFlow({
      game: station.game,
      variant: station.variant,
      floor: this.link,
      root: this.ui,
      // the high limit salon's tables open at high limits
      prefer: station.tier === 'high' ? HIGH_TIER : undefined,
      // v7.2: the High Limit Salon's tables take custom limits to $1 trillion (the server checks you're there)
      salon: station.id.startsWith('vip-'),
    });
    if (!choice) {
      await this.world.exitTable();
      return;
    }
    // loaded behind the login long before anyone gets here; a failure still opens the table
    await loadCards().catch(() => {});
    this.openTable(station, choice);
  }

  private openTable(station: WorldStation, choice: TableChoice): void {
    const me = session.profile!;
    // Declared before the panel so the panel's callbacks can reach the session once it exists.
    let table: TableSession | null = null;
    // Messages from a table already left (its socket lingers a moment) change nothing here.
    const current = () => table !== null && this.table?.session === table;
    /** The newest seat message's chips, waiting for the table to show the round behind them. */
    let chips: { stack: number | null; escrow: number } | null = null;
    const party =
      choice.kind === 'lobby'
        ? new PartyPanel({
            me: me.id,
            game: station.game,
            send: (m) => table?.send(m),
            leave: () => void this.leaveTable(),
            sit: () => void table?.promptBuyIn(),
            root: this.ui,
            invites: this.invites, // v6 invite6
          })
        : null;
    const module = party ? withParty(GAMES[station.game], party) : GAMES[station.game];
    const stage = new TableStage(this.engine, station.anchor);
    stage.setRest(GAMES[station.game].playPose(station.variant, null));
    // the table's dealer moves as the view deals, sweeps and pays (machines have none)
    stage.dealer = (g) => void this.world.dealerGesture(station.id, g);
    table = new TableSession(
      { ...choice, game: station.game, variant: station.variant, station: station.id },
      module,
      stage,
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
          chips = null;
          this.hud?.setTableChips(seated ? snap.you.stack : null);
          this.poseForSeat(snap.you.seat);
        },
        onSeat: (m) => {
          if (!current()) return;
          const seated = m.status !== 'watching';
          this.table!.seated = seated;
          // The stack a round leaves arrives as the round starts to play out (a wheel still
          // turning, cards still to come): the HUD shows it once the table has.
          chips = { stack: seated ? m.stack : null, escrow: m.escrow };
          table!.afterShown(() => {
            if (!current() || !chips) return;
            this.hud?.setTableChips(chips.stack, chips.escrow);
            chips = null;
          });
          if (seated) this.poseForSeat(m.seat);
        },
        onChat: (m) => current() && this.chat?.tableMessage(m),
        // v6 feats6: earned here; shown once the round behind it has played out
        onFeat: (m) => this.feats?.tableFeat(m, current() ? (fn) => table!.afterShown(fn) : undefined),
      },
    );
    this.table = { station, session: table, party, seated: false, posed: null };
    // A lobby table has a chat room of its own (members only); a solo table doesn't.
    const socket = table.socket;
    this.chat?.setTable(choice.kind === 'lobby' ? { say: (text) => socket.send({ t: 'say', text }) } : null);
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
    const pose = GAMES[game].playPose(variant, seat);
    open.session.stage.setRest(pose);
    if (!samePose(pose, GAMES[game].playPose(variant, null))) this.world.aim(seat);
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
    this.chat?.setTable(null);
    this.hud?.setTableChips(null);
    void this.refreshProfile();
    await this.world.exitTable();
  }

  /**
   * The cash-out's balance message can land after the table's socket has closed (it waits on D1,
   * and on any bets still in play), so ask for the profile until the chips have come home.
   */
  private async refreshProfile(): Promise<void> {
    // A dropped seat keeps its chips through the two-minute grace period, so keep asking that long;
    // a newer call takes over from an older one.
    const run = ++this.refreshRun;
    for (const wait of [800, 2500, 6000, 15_000, 30_000, 30_000, 30_000, 30_000, 30_000]) {
      await new Promise((r) => setTimeout(r, wait));
      if (run !== this.refreshRun || this.stopped) return;
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
    this.chat?.setTable(null);
    this.hud?.setTableChips(null);
    void this.refreshProfile();
    toast(code === CLOSE.FORBIDDEN ? "You can't join that table." : code === CLOSE.NOT_FOUND ? 'That table has closed.' : 'Lost the table.', 'err');
    void this.world.exitTable();
  }

  // --- v6 invite6: invites ----------------------------------------------------------------------

  /** The invite hub over this floor link: what it needs to know and do on the floor. */
  private inviteHub(link: FloorLink): InviteHub {
    return new InviteHub({
      floor: link,
      root: this.ui,
      stations: this.world.stations,
      collider: this.world.collider,
      where: () => (link.you ? { x: this.world.player.position.x, z: this.world.player.position.z } : null),
      onFloor: () => this.hud !== null && !this.away && !this.stopped,
      covered: () => overlayCount() > 0,
      atTable: () => {
        const open = this.table;
        if (open) return { tableId: open.session.target.kind === 'lobby' ? (open.session.target.tableId ?? null) : null, seated: open.seated, game: open.station.game };
        const at = this.world.seated;
        return at ? { tableId: null, seated: false, game: at.game } : null;
      },
      standUp: async () => {
        if (this.table) await this.leaveTable();
        else if (closeTableFlows() || this.world.seated) await this.world.exitTable();
        this.world.life.seating.stand({ walk: true });
      },
      hold: (on) => {
        if (!this.table && !this.world.seated) this.world.player.setEnabled(!on);
      },
      sitAt: (station, x, z, heading) => {
        this.world.player.teleport(x, z, heading);
        this.world.enter(station);
      },
      sfx: this.sfx,
    });
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
    } else if (code === CLOSE.IDLE) {
      // The floor or the table let us go first (a page that slept through its own clock).
      void this.goAway();
    } else {
      return false;
    }
    return true;
  }

  private halt(title: string, text: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.away?.close();
    this.away = null;
    this.table?.session.close();
    this.emotes?.dispose();
    this.emotes = null;
    this.feats?.dispose(); // v6 feats6
    this.feats = null;
    this.disconnectFloor();
    this.world.player.setEnabled(false);
    modal(title, [text], [button('Reload', () => location.reload(), { cls: 'primary' })]);
  }

  // --- away (netsec: idle) ---------------------------------------------------------------------

  /**
   * Away too long (app/idle.ts, or the floor or a table said so first): stand up from any table
   * the normal way (bets in play settle, then the chips go home), leave the floor, and wait on the
   * away screen. Nothing reconnects until Come back.
   */
  private async goAway(): Promise<void> {
    if (this.away || this.stopped) return;
    const atTable = this.table !== null;
    // Walking about (nothing open over the floor), or at a table: standing up puts us on the floor.
    this.awayWalking = atTable || (this.hud !== null && this.world.seated === null && overlayCount() === 0);
    this.away = showAway({ root: this.ui, atTable, onBack: () => this.comeBack() });
    this.disconnectFloor(true);
    this.world.player.setEnabled(false);
    if (atTable) {
      await this.leaveTable();
      // Standing up gave the controls back once the camera was behind the player again.
      if (this.away) this.world.player.setEnabled(false);
    }
  }

  /** Come back: the floor again, standing where we were. Runs inside the click, so the floor may take the mouse. */
  private comeBack(): void {
    this.away = null;
    if (this.stopped) return;
    this.comingBack = true;
    this.connectFloor();
    this.chat?.setVisible(this.hud !== null);
    if (this.awayWalking && this.hud) this.world.player.setEnabled(true);
  }
}

function samePose(a: Pose, b: Pose): boolean {
  const d = (x: readonly number[], y: readonly number[]) => Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
  return d(a.position, b.position) < 0.01 && d(a.target, b.target) < 0.01;
}
