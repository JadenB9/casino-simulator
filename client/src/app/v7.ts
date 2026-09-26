// v7: the app's side of what came with the loop road: your cars to drive (world/drive/), the
// knocks and crashes out on the street, your apartment furnished from what you own (world/home/),
// the gun store and the home store (world/stores/), guns in hand (world/arms/), the list of who's
// online, and bailing someone out. boot.ts mounts this once the floor is built.

import * as THREE from 'three';
import type { Engine3D } from '../render/engine3d.ts';
import { signAtlas, signMesh } from '../world/city/kit.ts';
import type { FloorWorld } from '../world/index.ts';
import type { Sfx } from '../audio/sfx.ts';
import type { FloorLink } from '../net/presence.ts';
import type { Person } from '../world/characters.ts';
import type { Cars } from '../world/cars/index.ts';
import { Driving } from '../world/drive/index.ts';
import { button, modal, toast } from '../ui/kit.ts';
import { isTyping, overlayCount } from '../ui/keyboard.ts';
import { openOnline, type OnlineRow } from '../ui/hud/online.ts';
import { whereIs } from '../world/where.ts';
import { homeTier } from '../../../shared/src/estate.ts';
import { session } from './session.ts';
import * as api from '../net/api.ts';
import type { Law } from '../world/law/index.ts';
import type { Spot } from '../world/interact.ts';
import type { Look } from '../../../shared/src/look.ts';
import { Arms } from '../world/arms/index.ts';
import { GUNS } from '../../../shared/src/arms.ts';
import { APARTMENTS, SLOT_NAMES, type HomeSlot } from '../../../shared/src/estate.ts';
import { STORES, type StoreId } from '../../../shared/src/stores.ts';
import { openStore, type StoreRow } from '../ui/stores/store.ts';
import { SLOTS, TABLET } from '../world/home/plan.ts';
import { SLOT_ORDER, slotItems } from '../world/home/furnish.ts';

const owns = (id: string) => (session.profile?.owned ?? []).includes(id);

/** v7.1: the Residences desk in the casino's lobby (its front faces -z, into the lobby). */
const RESIDENCES = { x: 5.2, z: 14.25 };

/** Store clerks: the gun store's in a dark polo, the home store's in a blazer. */
const CLERKS: Record<StoreId, Look> = {
  guns: { v: 1, body: 'm', outfit: 'casual', skin: 3, hair: '#2a1d14', top: '#1d2024', bottom: '#3a3f35', shoes: '#15120e' },
  homes: { v: 1, body: 'f', outfit: 'smart', skin: 1, hair: '#6a4028', top: '#e9e2d6', bottom: '#2a2d34', shoes: '#15120e' },
};

export interface V7Deps {
  engine: Engine3D;
  world: FloorWorld;
  sfx: Sfx;
  ui: HTMLElement;
  cars: Cars;
  link: () => FloorLink | null;
  character: (id: number) => Person | undefined;
  /** Out on the floor with nothing open (no table, no panel). */
  free: () => boolean;
  law: Law;
  /** The valet's panel (the garage's sales desk opens it too). */
  openValet: () => void;
}

export class V7 {
  readonly driving: Driving;
  readonly arms: Arms;
  private online: { close(): void; closed: boolean } | null = null;
  private linkOff: (() => void) | null = null;
  private readonly clerks: Person[] = [];
  private homeAt = 0;

  constructor(private readonly d: V7Deps) {
    const { world, engine } = d;
    this.driving = new Driving({
      engine,
      world,
      mats: d.cars.mats,
      link: d.link,
      owned: () => session.profile?.owned ?? [],
      curb: () => {
        const c = d.cars.valet.mine();
        if (!c) return null;
        const a = d.cars.valet.arriving();
        return { car: c.car, slot: c.slot, ready: !a || a.handed };
      },
      ui: d.ui,
      sfx: d.sfx,
      free: () => d.free() && overlayCount() === 0,
    });
    this.driving.characterOf = (id) => d.character(id);
    const city = world.city;
    city.onCrash = (speed) => this.driving.hitByTraffic(speed);
    city.onHorn = (at) => this.driving.horn(at);
    city.onKnock = (k) => {
      this.driving.knocked(k.speed);
      toast(k.speed > 8 ? 'A car ran you down. Watch the road.' : 'A car knocked you over. Look both ways.');
    };
    // "Your Apartment" on the elevator's panel for owners
    city.homeTier = () => homeTier(session.profile?.owned ?? []);
    // guns: R draws, a left click fires
    this.arms = new Arms({
      engine: { scene: engine.scene, camera: engine.camera, canvas: engine.renderer.domElement, onFrame: (fn) => engine.onFrame(fn) },
      world,
      link: d.link,
      owned: () => session.profile?.owned ?? [],
      ui: d.ui,
      sfx: d.sfx,
      free: () => d.free() && !this.driving.driving,
      character: d.character,
      knockNpc: (id) => d.law.knockNpc(id),
    });
    d.law.refreshMoney = () => void this.refreshMoney();
    // the stores' clerks behind their counters
    for (const s of Object.values(STORES)) {
      const p = world.characterFactory.create(CLERKS[s.id], '', { staff: true }) as Person;
      p.root.position.set(s.clerk.x, 0, s.clerk.z);
      p.root.rotation.y = s.clerk.yaw;
      p.showTag(false);
      engine.scene.add(p.root);
      this.clerks.push(p);
      world.collider.post(s.clerk.x, s.clerk.z, 0.3, 1.9);
    }
    engine.onFrame((dt) => this.frame(dt));
    world.spots((p) => this.spots(p));
    this.residences();
    // v7.1: Space jumps, on foot on the floor
    addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat || isTyping(e) || overlayCount() > 0 || !d.free() || this.driving.driving || world.walker.down || !world.walker.isEnabled) return;
      const now = performance.now();
      if (now - this.jumpAt < 800) return;
      this.jumpAt = now;
      e.preventDefault();
      (world.player.character.gesture as ((g: string) => void) | undefined)?.('jump');
      d.link()?.send({ t: 'jump' });
    });
  }

  private jumpAt = 0;

  /** v7.1: the Residences desk in the casino's lobby, east of the doors, where apartments are sold. */
  private residences(): void {
    const { engine, world } = this.d;
    const D = RESIDENCES;
    const g = new THREE.Group();
    g.name = 'residences-desk';
    const stone = new THREE.MeshStandardMaterial({ color: '#1a1716', roughness: 0.3 });
    const brass = new THREE.MeshStandardMaterial({ color: '#c9a24b', metalness: 0.9, roughness: 0.35 });
    const box = (m: THREE.Material, w: number, h: number, d: number, y: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(D.x, y + h / 2, D.z);
      g.add(mesh);
    };
    box(stone, 1.8, 1.02, 0.62, 0.001);
    box(brass, 1.86, 0.04, 0.68, 1.021);
    const atlas = signAtlas([{ text: 'RESIDENCES', font: '600 88px Cinzel, Georgia, serif', color: '#f4dca6', glow: '#ffb35a' }]);
    g.add(signMesh(atlas, [{ row: 0, x: D.x, y: 0.6, z: D.z - 0.315, h: 0.22, ry: Math.PI }], 1.6));
    engine.scene.add(g);
    world.collider.box(D.x, D.z, 1.9, 0.72, 0, 1.06);
    engine.onFrame(() => (g.visible = world.zone === 'casino'));
  }

  /** The floor socket: the shots, what you own now, a refusal to say. */
  useLink(link: FloorLink | null): void {
    this.linkOff?.();
    this.linkOff = link?.subscribe((m) => {
      this.arms.hear(m);
      // v7.1: someone else jumped
      if (m.t === 'jump' && m.id !== this.d.link()?.you?.id) (this.d.character(m.id)?.gesture as ((e: string) => void) | undefined)?.('jump');
      if (m.t === 'err' && m.code === 'NOT_ELIGIBLE') {
        // (a car the floor refused: its reason is the one to see, not "wouldn't start")
        this.driving.refused();
        toast(m.msg, 'err');
      }
    }) ?? null;
  }

  private frame(dt: number): void {
    const shown = this.d.world.zone === 'ground';
    for (const c of this.clerks) {
      c.root.visible = shown;
      if (shown) c.update(dt);
    }
    // your apartment, furnished from what you own (a cheap check, twice a second)
    this.homeAt -= dt;
    if (this.homeAt > 0) return;
    this.homeAt = 0.5;
    // v7.1: whichever apartment you're in, as the floor described it (visitors see the owner's)
    const home = this.d.world.city.homeInterior();
    const apt = this.d.world.city.apt;
    if (!home || !apt) return;
    if (apt.id !== this.aptShown) {
      this.aptShown = apt.id;
      toast(apt.id === this.d.link()?.you?.id ? `Your apartment · floor ${apt.floor}` : `${apt.name}'s apartment · floor ${apt.floor}. Only ${apt.name} can change anything here.`);
    }
    home.set(apt.tier, new Set(apt.items), apt.picks as Partial<Record<HomeSlot, string>>);
  }

  private aptShown = 0;

  /** In your own apartment (the only one you can change). */
  private get mine(): boolean {
    const apt = this.d.world.city.apt;
    return !!apt && apt.id === this.d.link()?.you?.id;
  }

  private async refreshMoney(): Promise<void> {
    try {
      const p = await api.me();
      const now = session.profile;
      if (now) session.set({ ...now, balance: p.balance, inPlay: p.inPlay, rev: p.rev });
    } catch {
      /* the next refresh has it */
    }
  }

  // --- E: the stores' counters, the garage's desk, the jail's visits, your apartment ---------------

  private *spots(p: { x: number; z: number }): Generator<Spot> {
    if (!this.d.free() || this.driving.driving) return;
    const zone = this.d.world.zone;
    if (zone === 'casino') {
      const d = Math.hypot(p.x - RESIDENCES.x, p.z - (RESIDENCES.z - 0.8));
      if (d < 1.6) yield { key: 'residences', x: RESIDENCES.x, z: RESIDENCES.z - 0.8, d, label: 'Residences · buy or upgrade an apartment', any: true, use: () => this.openResidences() };
    }
    if (zone === 'ground') {
      for (const s of Object.values(STORES)) {
        const d = Math.hypot(p.x - s.counter.x, p.z - s.counter.z);
        if (d < 1.8) yield { key: `store:${s.id}`, x: s.counter.x, z: s.counter.z, d, label: s.id === 'guns' ? 'Ace Arms · buy a gun' : 'Maison Home · apartments and furniture', any: true, use: () => this.openStore(s.id) };
      }
      const desk = { x: 188.5, z: 12.2 };
      const dd = Math.hypot(p.x - desk.x, p.z - desk.z);
      if (dd < 2.2) yield { key: 'garage:desk', x: desk.x, z: desk.z, d: dd, label: 'Buy a car', any: true, use: () => this.d.openValet() };
      // the jail: from the visitors' hall into the day room, and back out
      if (!this.d.law.jailed) {
        const inHall = p.x > 167.4 && p.x < 172 && p.z > -30 && p.z < -20;
        const inDay = p.x > 172.3 && p.x < 174.5 && p.z > -24 && p.z < -20;
        if (inHall && p.x > 170.2) yield { key: 'jail:visit', x: 171.6, z: p.z, d: 0.4, label: 'Visit the day room (the inmates are inside)', any: true, use: () => this.d.world.player.teleport(173.3, Math.min(-20.6, Math.max(-23.4, p.z)), Math.PI / 2) };
        if (inDay) yield { key: 'jail:leave', x: 172.4, z: p.z, d: 0.4, label: 'Leave the day room', any: true, use: () => this.d.world.player.teleport(171, Math.min(-20.6, Math.max(-23.4, p.z)), -Math.PI / 2) };
        if (inHall) yield { key: 'jail:bail', x: 169, z: -21, d: Math.hypot(p.x - 169, p.z + 21), label: 'Bail someone out', any: true, use: () => this.openOnline() };
      }
    }
    if (zone === 'home' && this.mine) {
      const t = Math.hypot(p.x - TABLET.x, p.z - TABLET.z);
      if (t < 1.4) yield { key: 'home:tablet', x: TABLET.x, z: TABLET.z, d: t, label: 'Home · upgrades and furniture', any: true, use: () => this.openHome(null) };
      for (const slot of SLOT_ORDER) {
        const at = SLOTS[slot];
        if (!at.reach) continue;
        const d = Math.hypot(p.x - at.x, p.z - at.z);
        if (d > at.reach) continue;
        const piece = this.d.world.city.homeInterior()?.furnished?.pieces.get(slot);
        yield { key: `home:${slot}`, x: at.x, z: at.z, d: Math.max(0, d - at.reach * 0.5), label: piece ? `${SLOT_NAMES[slot]} · ${piece.name}` : `${SLOT_NAMES[slot]} · empty: furnish it`, any: true, use: () => this.openHome(slot) };
      }
    }
  }

  private openStore(id: StoreId): void {
    if (id === 'guns') {
      openStore({
        root: this.d.ui,
        title: 'Ace Arms',
        subtitle: 'R draws your gun, a left click fires. Security hears every shot in the casino',
        sfx: this.d.sfx,
        sections: () => [{ title: 'Guns', rows: GUNS.map((g) => ({ id: g.id, name: g.name, price: g.price, about: `${g.about} ${g.auto ? 'Automatic' : 'Semi-automatic'}, ${g.mag} rounds.`, owned: owns(g.id), use: { label: this.arms.drawn?.id === g.id ? 'Drawn' : 'Draw', done: this.arms.drawn?.id === g.id, run: () => this.arms.draw(g) } })) }],
      });
      return;
    }
    this.openHome(null, 'Maison Home', false, true);
  }

  /** The home catalogue: the apartment's steps, then every slot's pieces (or one slot's). */
  /** v7.1: the Residences desk: the apartment and its upgrades (sold only here). */
  private openResidences(): void {
    this.openHome(null, 'Residences', true);
  }

  private openHome(only: HomeSlot | null, title = 'Your home', residences = false, store = false): void {
    const owned = () => session.profile?.owned ?? [];
    const tier = () => homeTier(owned());
    openStore({
      root: this.d.ui,
      title: only ? SLOT_NAMES[only] : title,
      subtitle: residences ? 'Your own floor in the tower: anyone can visit, only you change it' : tier() ? `Your apartment: ${APARTMENTS[tier() - 1]!.name}` : 'Buy The Residence at the casino lobby’s Residences desk, then furnish it',
      sfx: this.d.sfx,
      bought: () => (this.homeAt = 0),
      sections: () => {
        const out: { title: string; rows: StoreRow[] }[] = [];
        if (!only && (residences || store))
          out.push({
            title: 'The apartment',
            rows: APARTMENTS.map((a) => ({ id: a.id, name: a.name, price: a.price, about: a.about, owned: owns(a.id), locked: a.tier > tier() + 1 ? `Needs ${APARTMENTS[a.tier - 2]!.name} first.` : null })),
          });
        for (const slot of residences ? [] : only ? [only] : SLOT_ORDER) {
          const here = this.d.world.city.homeInterior()?.furnished?.pieces.get(slot)?.id;
          out.push({
            title: SLOT_NAMES[slot],
            rows: slotItems(slot).map((h) => ({
              id: h.id,
              name: h.name,
              price: h.price,
              about: h.about,
              owned: owns(h.id),
              locked: tier() < 1 ? 'Needs an apartment: buy The Residence first.' : (h.tier ?? 1) > tier() ? `Needs ${APARTMENTS[(h.tier ?? 1) - 1]!.name}.` : null,
              use: { label: 'Put it here', done: here === h.id, run: () => this.pick(slot, h.id) },
            })),
          });
        }
        return out;
      },
    });
  }

  /** Put one of your pieces in its place: the floor keeps it, and everyone in your apartment sees it. */
  private pick(slot: HomeSlot, id: string): void {
    if (!this.d.link()?.send({ t: 'home.pick', slot, item: id })) toast('The floor is reconnecting. Try again in a moment.', 'err');
    this.homeAt = 0;
  }

  /** Driving now: no punches, rides or tables meanwhile. */
  get busy(): boolean {
    return this.driving.driving;
  }

  /** The HUD's online count: who's here, and where. */
  openOnline(): void {
    if (this.online && !this.online.closed) {
      this.online.close();
      return;
    }
    const world = this.d.world;
    const name = (id: string) => world.stations.find((s) => s.id === id)?.name ?? null;
    this.online = openOnline({
      root: this.d.ui,
      rows: () => {
        const link = this.d.link();
        const rows: OnlineRow[] = [];
        const you = link?.you;
        if (you) {
          const p = world.player.position;
          rows.push({ id: you.id, name: you.name, where: this.driving.driving ? 'Driving' : whereIs(world.plan, p.x, p.z, world.seated?.id ?? null, name), you: true });
        }
        for (const [id, p] of link?.players ?? []) {
          const at = p.last ?? { x: p.info.x, z: p.info.z };
          const jailed = !!p.info.jailed;
          rows.push({
            id,
            name: p.info.name,
            where: jailed ? 'In the county jail' : p.info.car ? 'Driving' : whereIs(world.plan, at.x / 100, at.z / 100, p.info.at?.station ?? null, name),
            ...(jailed && !you?.jailed ? { action: { label: 'Bail out', run: () => this.bail(id, p.info.name) } } : {}),
          });
        }
        return rows;
      },
    });
  }

  /** Pay the rest of someone's bail, after a yes (the floor charges it and lets them out). */
  bail(id: number, who: string): void {
    const m = modal(
      `Bail out ${who}?`,
      [`You pay what's left of ${who}'s bail from your balance, and they walk out of the county jail now.`],
      [
        button('Cancel', () => m.close(), { cls: 'ghost' }),
        button(
          'Pay their bail',
          () => {
            m.close();
            if (!this.d.link()?.send({ t: 'bail', id })) toast('The floor is reconnecting. Try again in a moment.', 'err');
          },
          { cls: 'primary' },
        ),
      ],
      () => m.close(),
    );
  }

  dispose(): void {
    this.online?.close();
    this.linkOff?.();
    this.arms.dispose();
    this.driving.dispose();
    for (const c of this.clerks) c.dispose();
  }
}
