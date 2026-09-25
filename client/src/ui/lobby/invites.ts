// v6 invite6: invites on the client. The hub lives with the floor socket: it shows each invite
// as a card under the HUD ("Sam invited you to Blackjack · High limit · 2 seats left", Join and
// Dismiss, a clock running down), opens the picker from the party panel, and does the join: ask
// first if you have chips down somewhere, check with the floor that the invite still stands (it
// moves you beside the table), then a quick fade while you get up from wherever you are, and
// you sit down at the new table the way E would, straight into the lobby you were invited to.
// Declining is saying nothing. Do not disturb (Settings) turns them off.

import type { FloorClientMsg, FloorServerMsg, Invite, InviteServerMsg } from '../../../../shared/src/protocol.ts';
import type { GameId } from '../../../../shared/src/engine.ts';
import { serverNow } from '../../net/clock.ts';
import { playPoseWorld, type WorldStation } from '../../world/stations.ts';
import { el, modal, button, toast } from '../kit.ts';
import { isTyping } from '../keyboard.ts';
import type { TableChoice } from './flow.ts';
import { InvitePicker, type InviteTable } from './invite-picker.ts';
import { Inbox, RecentPlayers, clock, doNotDisturb, inviteDetail, inviteSentence, onDoNotDisturb, tableName, type Candidate } from './invite-model.ts';
import { cross, invite as inviteIcon, lock } from './icons.ts';
import './invites.css';

/** What the hub needs from the floor socket (FloorLink has it all). */
export interface InviteFloor {
  send(msg: FloorClientMsg): boolean;
  subscribe(fn: (msg: FloorServerMsg) => void): () => void;
  readonly players: ReadonlyMap<number, { info: { id: number; name: string; at: { station: string } | null }; last: { x: number; z: number } | null }>;
  readonly you: { id: number } | null;
}

/** What the hub needs from the app around it (boot.ts). */
export interface InviteApp {
  floor: InviteFloor;
  root: HTMLElement;
  stations: readonly WorldStation[];
  /** Pushes a point out of walls and tables (the world's collider). */
  collider: { resolve(p: { x: number; z: number }, r: number): void };
  /** Where you stand, metres. */
  where(): { x: number; z: number } | null;
  /** Out on the floor with the HUD up (not the main menu). */
  onFloor(): boolean;
  /** A sheet or dialog is open over everything (the shop, the bank). */
  covered(): boolean;
  /** The table you're at, if any; `seated` when you have chips on it. */
  atTable(): { tableId: string | null; seated: boolean; game: GameId } | null;
  /** Get up from wherever you are: leave the table (chips home), close a lobby panel, stand up. */
  standUp(): Promise<void>;
  /** Hold a walking player still (true) and let them go again (false). */
  hold(on: boolean): void;
  /** Stand at (x, z) facing `heading` and sit down at this station as if E were pressed. */
  sitAt(station: WorldStation, x: number, z: number, heading: number): void;
  sfx?: { play(name: string, opts?: { volume?: number }): void; readonly muted: boolean };
}

/** How long a join waits for the floor's answer. */
const TAKE_WAIT_MS = 6000;
const FADE_MS = 240;
/** A card whose join failed says why for this long, then goes. */
const FAILED_MS = 4500;
/** The walker's radius (player.ts): the spot beside a table is pushed clear of it. */
const WALKER_R = 0.3;

type Answer = Extract<InviteServerMsg, { t: 'invite.go' | 'invite.no' }>;

export class InviteHub {
  readonly recent = new RecentPlayers();
  private readonly inbox = new Inbox();
  private readonly box = el('div', 'inv-cards');
  private readonly fader = el('div', 'inv-fade');
  private picker: InvitePicker | null = null;
  /** Per table: when "Invite everyone" opens again (server time). */
  private readonly everyone = new Map<string, number>();
  /** The invite being joined, and whoever waits on the floor's answer. */
  private joining: { id: string; resolve: (a: Answer | null) => void } | null = null;
  /** Cards whose join failed: what went wrong. */
  private readonly failed = new Map<string, string>();
  /** The table to sit at when the world next sits us down at this station. */
  private claimFor: { stationId: string; choice: TableChoice; until: number } | null = null;
  private readonly offs: (() => void)[] = [];
  private timer = 0;
  private shown = '';

  constructor(private readonly app: InviteApp) {
    this.box.setAttribute('aria-live', 'polite');
    this.box.setAttribute('role', 'region');
    this.box.setAttribute('aria-label', 'Invites');
    app.root.append(this.box, this.fader);
    this.offs.push(app.floor.subscribe((m) => this.onMsg(m)));
    this.offs.push(onDoNotDisturb((on) => this.sayDnd(on)));
    addEventListener('keydown', this.onKey, true);
    this.timer = window.setInterval(() => this.render(), 1000);
  }

  dispose(): void {
    clearInterval(this.timer);
    removeEventListener('keydown', this.onKey, true);
    for (const off of this.offs) off();
    this.picker?.close();
    this.joining?.resolve(null);
    this.box.remove();
    this.fader.remove();
  }

  /** The party panel's Invite button. */
  openPicker(table: InviteTable): void {
    if (this.picker) {
      if (this.picker.table.tableId === table.tableId) return;
      this.picker.close();
    }
    this.picker = new InvitePicker({
      root: this.app.root,
      table,
      players: () => this.candidates(),
      me: () => {
        const at = this.app.where();
        const id = this.app.floor.you?.id;
        return at && id !== undefined ? { id, ...at } : null;
      },
      recent: this.recent,
      stationName: (id) => this.app.stations.find((s) => s.id === id)?.name ?? null,
      send: (to) => {
        const t = this.picker?.table ?? table;
        return this.app.floor.send({ t: 'invite', table: t.tableId, ...(t.pin ? { pin: t.pin } : {}), to });
      },
      everyoneAgain: () => this.everyone.get(table.tableId) ?? 0,
      now: () => serverNow(),
      onClose: () => {
        this.picker = null;
      },
    });
  }

  /** The party at the picker's table changed (someone joined, the PIN changed). */
  tableChanged(table: InviteTable): void {
    if (this.picker?.table.tableId === table.tableId) this.picker.setTable(table);
  }

  /** Close the picker (leaving the table it was for). */
  closePicker(tableId?: string): void {
    if (this.picker && (!tableId || this.picker.table.tableId === tableId)) this.picker.close();
  }

  /** People you sat down with: the picker offers them first next time. */
  noteMet(people: { id: number; name: string }[]): void {
    const me = this.app.floor.you?.id;
    const others = people.filter((p) => p.id !== me);
    // only when someone new turns up, so a busy table doesn't write storage on every message
    const known = new Set(this.recent.items.slice(0, others.length).map((m) => m.id));
    if (others.some((p) => !known.has(p.id))) this.recent.note(others);
  }

  /**
   * Sitting down at a station (App.sitDown): the invite being joined, if it is for this station,
   * in place of the lobby panel. Once only.
   */
  claim(station: { id: string }): TableChoice | null {
    const c = this.claimFor;
    if (!c || c.stationId !== station.id || performance.now() > c.until) return null;
    this.claimFor = null;
    return c.choice;
  }

  /** Join an invite (its card's Join, or J for the newest). */
  async join(id: string): Promise<void> {
    if (this.joining) return;
    const inv = this.inbox.items.find((x) => x.id === id);
    if (!inv || !this.app.onFloor()) return;
    if (this.app.covered()) {
      toast('Close what is open first, then join.');
      return;
    }
    const at = this.app.atTable();
    if (at?.tableId === inv.tableId) {
      this.inbox.remove(id);
      this.render();
      return;
    }
    const station = this.stationFor(inv);
    if (!station) {
      this.fail(id, "That table isn't on this floor.");
      return;
    }
    if (at?.seated && !(await this.confirmLeave(inv, at.game))) return;
    // no walking off while the floor answers: it is about to move us, and a step sent meanwhile
    // would drag the floor's idea of where we are back toward where we were
    this.app.hold(true);
    const answer = await this.take(inv.id, this.spotBy(station));
    if (!answer || answer.t === 'invite.no') {
      this.app.hold(false);
      this.fail(id, answer?.msg ?? "Couldn't reach the casino. Try again.");
      return;
    }
    this.inbox.remove(id);
    this.failed.delete(id);
    this.picker?.close();
    this.claimFor = {
      stationId: station.id,
      choice: { kind: 'lobby', tableId: answer.tableId, ...(answer.pin ? { pin: answer.pin } : {}) },
      until: performance.now() + 20_000,
    };
    this.render();
    await this.fade(true);
    try {
      await this.app.standUp();
      const x = answer.x / 100;
      const z = answer.z / 100;
      const c = new Vec(station);
      this.app.sitAt(station, x, z, Math.atan2(c.x - x, c.z - z));
    } finally {
      await this.fade(false);
    }
  }

  dismiss(id: string): void {
    this.inbox.remove(id);
    this.failed.delete(id);
    this.render();
  }

  // --- the floor's messages -----------------------------------------------------------------

  private onMsg(m: FloorServerMsg): void {
    switch (m.t) {
      case 'hello':
        // the floor keeps do not disturb per account; after a reconnect say it again
        this.sayDnd(doNotDisturb());
        return;
      case 'invited':
        if (doNotDisturb()) return;
        this.inbox.add(m.invite);
        if (this.app.onFloor() && this.app.sfx && !this.app.sfx.muted) this.app.sfx.play('ui-switch', { volume: 0.6 });
        this.render();
        return;
      case 'invite.sent':
        if (m.again) this.everyone.set(m.table, m.again);
        if (this.picker?.table.tableId === m.table) this.picker.onAnswer(m);
        return;
      case 'invite.no':
        if (m.id !== undefined) {
          if (this.joining?.id === m.id) this.joining.resolve(m);
          return;
        }
        if (m.again && m.table) this.everyone.set(m.table, m.again);
        if (m.table && this.picker?.table.tableId === m.table) this.picker.onAnswer(m);
        else toast(m.msg, 'err');
        return;
      case 'invite.go':
        if (this.joining?.id === m.id) this.joining.resolve(m);
        return;
    }
  }

  private sayDnd(on: boolean): void {
    this.app.floor.send({ t: 'invite.dnd', on });
    if (on) {
      for (const inv of [...this.inbox.items]) this.inbox.remove(inv.id);
      this.render();
    }
  }

  private take(id: string, spot: { x: number; z: number; heading: number }): Promise<Answer | null> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => done(null), TAKE_WAIT_MS);
      const done = (a: Answer | null) => {
        clearTimeout(timer);
        this.joining = null;
        this.render();
        resolve(a);
      };
      this.joining = { id, resolve: done };
      this.render();
      const r = ((Math.round((spot.heading / (Math.PI * 2)) * 256) % 256) + 256) % 256;
      if (!this.app.floor.send({ t: 'invite.take', id, x: Math.round(spot.x * 100), z: Math.round(spot.z * 100), r })) done(null);
    });
  }

  private fail(id: string, msg: string): void {
    this.failed.set(id, msg);
    this.render();
    window.setTimeout(() => {
      if (this.failed.get(id) === msg) this.dismiss(id);
    }, FAILED_MS);
  }

  private confirmLeave(inv: Invite, game: GameId): Promise<boolean> {
    return new Promise((resolve) => {
      const stay = button('Stay', () => {
        m.close();
        resolve(false);
      }, { cls: 'ghost' });
      const m = modal(
        `Join ${inv.from.name} at ${tableName(inv.game, inv.variant)}?`,
        [`You'll leave ${tableName(game, '')} first. Your chips go back to your balance; anything still in play is settled first: undealt bets come back, hands in progress are stood or folded.`],
        [
          button('Leave and join', () => {
            m.close();
            resolve(true);
          }, { cls: 'primary' }),
          stay,
        ],
        () => {
          m.close();
          resolve(false);
        },
      );
      // Space deals at every table; a reflex press here must not stand you up
      stay.focus();
    });
  }

  private fade(on: boolean): Promise<void> {
    this.fader.classList.toggle('on', on);
    return new Promise((r) => setTimeout(r, FADE_MS));
  }

  // --- where to go ------------------------------------------------------------------------------

  /** The inviter's station, or failing that the nearest table of the same game (and kind). */
  private stationFor(inv: Invite): WorldStation | null {
    const exact = this.app.stations.find((s) => s.id === inv.station && s.game === inv.game);
    if (exact) return exact;
    const me = this.app.where() ?? { x: 0, z: 0 };
    const near = (list: readonly WorldStation[]) =>
      [...list].sort((a, b) => dist(new Vec(a), me) - dist(new Vec(b), me))[0] ?? null;
    return near(this.app.stations.filter((s) => s.game === inv.game && s.variant === inv.variant)) ?? near(this.app.stations.filter((s) => s.game === inv.game));
  }

  /** A spot to stand beside a station, on the side you play from, facing it. */
  private spotBy(s: WorldStation): { x: number; z: number; heading: number } {
    const c = new Vec(s);
    const pose = playPoseWorld(s, null);
    let dx = pose.position.x - c.x;
    let dz = pose.position.z - c.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) {
      dx = Math.sin(s.yaw);
      dz = Math.cos(s.yaw);
    } else {
      dx /= len;
      dz /= len;
    }
    const reach = Math.max(s.footprint.width, s.footprint.depth) / 2 + 0.55;
    const p = { x: c.x + dx * reach, z: c.z + dz * reach };
    this.app.collider.resolve(p, WALKER_R);
    return { ...p, heading: Math.atan2(c.x - p.x, c.z - p.z) };
  }

  private candidates(): Candidate[] {
    return [...this.app.floor.players.values()].map((p) => ({
      id: p.info.id,
      name: p.info.name,
      x: p.last?.x ?? null,
      z: p.last?.z ?? null,
      station: p.info.at?.station ?? null,
    }));
  }

  // --- the cards --------------------------------------------------------------------------------

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'j' && e.key !== 'J') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e) || this.picker) return;
    const newest = this.inbox.items[0];
    if (!newest || !this.app.onFloor() || this.box.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    void this.join(newest.id);
  };

  private render(): void {
    const now = serverNow();
    if (this.inbox.expire(now)) for (const id of [...this.failed.keys()]) if (!this.inbox.items.some((x) => x.id === id)) this.failed.delete(id);
    const here = this.app.atTable()?.tableId;
    if (here) this.inbox.dropTable(here);
    const items = this.inbox.items;
    const visible = items.length > 0 && this.app.onFloor();
    this.box.hidden = !visible;
    if (!visible) {
      if (this.shown) this.box.replaceChildren();
      this.shown = '';
      return;
    }
    // the cards are rebuilt only when something on them changes (the clock ticks in place)
    const key = items.map((x) => `${x.id}:${this.failed.get(x.id) ?? ''}:${this.joining?.id === x.id}`).join('|');
    if (key !== this.shown) {
      this.shown = key;
      this.box.replaceChildren(...items.map((inv, i) => this.card(inv, i === 0)));
    }
    for (const c of this.box.querySelectorAll<HTMLElement>('.inv-card')) {
      const inv = items.find((x) => x.id === c.dataset.invite);
      if (!inv) continue;
      const left = inv.until - now;
      c.querySelector('.inv-clock')!.textContent = clock(left);
      (c.querySelector('.inv-bar-fill') as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, left / (inv.until - inv.at)))})`;
    }
  }

  private card(inv: Invite, newest: boolean): HTMLElement {
    const c = el('article', 'inv-card panel');
    c.dataset.invite = inv.id;
    c.setAttribute('aria-label', inviteSentence(inv));
    const top = el('div', 'inv-card-top');
    const tag = el('span', 'inv-card-tag');
    tag.append(inviteIcon(), el('span', '', inv.all ? 'Open invite' : 'Invite'));
    const dismiss = el('button', 'inv-close');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.append(cross());
    dismiss.addEventListener('click', () => this.dismiss(inv.id));
    top.append(tag, el('span', 'inv-clock'), dismiss);

    const line = el('p', 'inv-card-line');
    line.append(el('span', 'inv-from', inv.from.name), document.createTextNode(inv.all ? ' invited everyone to ' : ' invited you to '), el('span', 'inv-game', tableName(inv.game, inv.variant)));
    const detail = el('p', 'inv-card-detail');
    if (inv.private) detail.append(lock());
    detail.append(el('span', '', inviteDetail(inv)));

    const actions = el('div', 'inv-card-actions');
    const failed = this.failed.get(inv.id);
    const busy = this.joining?.id === inv.id;
    const join = el('button', 'btn primary');
    join.type = 'button';
    join.disabled = busy || this.joining !== null;
    if (newest && !busy) join.append(el('span', 'key', 'J'));
    join.append(el('span', '', busy ? 'Joining…' : 'Join'));
    join.addEventListener('click', () => void this.join(inv.id));
    const later = el('button', 'btn ghost', 'Dismiss');
    later.type = 'button';
    later.addEventListener('click', () => this.dismiss(inv.id));
    actions.append(join, later);

    const bar = el('div', 'inv-bar');
    bar.append(el('span', 'inv-bar-fill'));
    c.append(top, line, detail);
    if (failed) {
      const err = el('p', 'inv-card-error', failed);
      err.setAttribute('role', 'alert');
      c.append(err);
    } else c.append(actions);
    c.append(bar);
    return c;
  }
}

/** A station's centre on the floor. */
class Vec {
  readonly x: number;
  readonly z: number;
  constructor(s: WorldStation) {
    s.anchor.updateWorldMatrix(true, false);
    const e = s.anchor.matrixWorld.elements;
    this.x = e[12]!;
    this.z = e[14]!;
  }
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
