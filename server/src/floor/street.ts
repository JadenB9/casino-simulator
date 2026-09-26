// v7: the floor's side of driving and guns. Getting into a car you own (the drive's own checks:
// on the ground floor, standing, not held by the law), getting out of it (it stays parked where
// you left it, for everyone to see, until you drive it again or it's taken off the road); drawing a
// gun you own and putting it away; and a shot, which the floor resolves: nobody fires faster than
// their gun can, from a seat, a table or a car; what it hits is found along the line it was fired
// (shared/src/arms.ts shotTarget) among the people and the staff where you are, and everyone
// hears it. Who's hurt? Nobody: a hit knocks someone down for a moment. The law hears the shots
// fired in the casino (law.ts `shot`), whoever they hit.

import type { FloorServerMsg } from '../../../shared/src/protocol.ts';
import { carItem } from '../../../shared/src/items.ts';
import { gunItem, shotTarget } from '../../../shared/src/arms.ts';
import { STAFF, type StaffId } from '../../../shared/src/law/patrol.ts';
import { INMATE_IDS, inmatePose } from '../../../shared/src/law/inmates.ts';
import { zoneOf } from '../../../shared/src/zones.ts';
import type { Presence, FloorAtt } from './presence.ts';

const TAU = Math.PI * 2;

export interface StreetDeps {
  presence: Presence;
  broadcast: (msg: FloorServerMsg) => void;
  send: (ws: WebSocket, msg: FloorServerMsg) => void;
  /** The law's say on a shot fired in the casino (a strike for whoever fired it). */
  shotFired: (accountId: number, name: string, now: number) => void;
  /** Whether the law holds this account (jail): no driving and no guns inside. */
  confined: (accountId: number) => boolean;
  /** Where the staff are, with their detours (law.ts). */
  staffPose: (id: StaffId, now: number) => { x: number; z: number };
  /** The valet's car at the curb for this account: getting into it takes it off the curb, getting into another sends it back (one car at a time). */
  takeFromCurb: (accountId: number, car: string) => void;
}

export class Street {
  private readonly lastShot = new Map<number, number>();

  constructor(private readonly d: StreetDeps) {}

  /** Into a car you own (null: out of the one you're in, left parked where you are). */
  drive(ws: WebSocket, car: string | null): void {
    const p = this.d.presence;
    const a = p.attOf(ws);
    if (!a) return;
    if (car === null) {
      if (!a.car) return;
      // v7.1: nothing is left on the street: the valet takes it back to the garage
      p.setCar(a.accountId, null, null);
      return;
    }
    const no = this.cantDrive(a, car);
    if (no) {
      this.d.send(ws, { t: 'err', code: 'NOT_ELIGIBLE', msg: no, about: 'drive' });
      return;
    }
    if (a.gun) p.setGun(a.accountId, null);
    this.d.takeFromCurb(a.accountId, car);
    // (getting into a car takes it off wherever it was parked)
    p.setCar(a.accountId, car, null);
  }

  private cantDrive(a: FloorAtt, car: string): string | null {
    if (!carItem(car)) return 'There is no such car.';
    if (!a.cars?.includes(car)) return "That isn't your car.";
    if (zoneOf(a.x, a.z) !== 'ground') return 'Cars are on the ground floor.';
    if (a.at || a.seat) return 'Stand up first.';
    if (a.confine || this.d.confined(a.accountId)) return 'Not while the law has you.';
    return null;
  }

  /** Draw a gun you own, or put it away (null). */
  draw(ws: WebSocket, gun: string | null): void {
    const p = this.d.presence;
    const a = p.attOf(ws);
    if (!a) return;
    if (gun === null) {
      if (a.gun) p.setGun(a.accountId, null);
      return;
    }
    if (!gunItem(gun) || !a.guns?.includes(gun) || a.car || a.at || a.seat || a.confine || this.d.confined(a.accountId)) return;
    if (a.gun !== gun) p.setGun(a.accountId, gun);
  }

  /** A shot from the drawn gun, fired along `r` (yaw byte). */
  shoot(ws: WebSocket, r: number, now: number): void {
    const p = this.d.presence;
    const a = p.attOf(ws);
    if (!a || !a.gun) return;
    const gun = gunItem(a.gun);
    if (!gun || a.car || a.at || a.seat || a.confine) return;
    // no faster than the gun fires (a little slack for the network's bunching)
    const gap = (1000 / gun.rate) * 0.7;
    if (now - (this.lastShot.get(a.accountId) ?? -Infinity) < gap) return;
    this.lastShot.set(a.accountId, now);
    const x = a.x / 100;
    const z = a.z / 100;
    const yaw = (r / 256) * TAU;
    const zone = zoneOf(a.x, a.z) ?? 'casino';
    const candidates: { id: number | string; x: number; z: number }[] = [];
    for (const o of p.standing()) {
      if (o.accountId === a.accountId || o.at || o.seat) continue;
      if ((zoneOf(o.x, o.z) ?? 'casino') !== zone) continue;
      // (v7.1: in the apartments only the people in the same one)
      if (zone === 'home' && o.apt !== (a.apt ?? null)) continue;
      candidates.push({ id: o.accountId, x: o.x / 100, z: o.z / 100 });
    }
    if (zone === 'casino') for (const s of STAFF) candidates.push({ id: s.id, ...this.d.staffPose(s.id, now) });
    if (zone === 'ground') for (const id of INMATE_IDS) candidates.push({ id, ...inmatePose(id, now) });
    const hit = shotTarget(x, z, yaw, gun.range, candidates);
    this.d.broadcast({ t: 'shot', id: a.accountId, r, hit: (hit?.id ?? null) as number | StaffId | null, d: Math.round((hit?.d ?? gun.range) * 10) / 10 });
    if (zone === 'casino') this.d.shotFired(a.accountId, a.name, now);
  }

  /** What an account owns now that the floor checks (after a purchase). */
  grant(accountId: number, kit: { guns?: string[]; cars?: string[]; home?: number }): void {
    this.d.presence.change(accountId, (a) => {
      if (kit.guns) a.guns = [...new Set([...(a.guns ?? []), ...kit.guns])];
      if (kit.cars) a.cars = [...new Set([...(a.cars ?? []), ...kit.cars])];
      if (kit.home !== undefined) a.home = Math.max(a.home ?? 0, kit.home);
    });
  }
}

