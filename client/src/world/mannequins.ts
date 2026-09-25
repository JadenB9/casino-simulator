// The boutique's mannequins: the floor's own characters dressed in the shop's pieces, posed once
// and left standing on their plinths. One in bare gloss (no special clothes) shows the jewellery
// on a black form; the others wear the clothes with their chains, grills, watches and hats, their
// faces and hands pale as a form's; one given a ride stands on it. Each is a character like any
// other (a draw call for the body, one or two for what it wears), hidden with the boutique when
// nobody can see it.

import * as THREE from 'three';
import type { Look } from '../../../shared/src/look.ts';
import { ITEM_KINDS, type ItemKind } from '../../../shared/src/items.ts';
import type { Characters, Person } from './characters.ts';
import type { FloorPlan } from './layout.ts';

/** The plinth's top (furniture.ts). */
const PLINTH = 0.12;
/** A mannequin's face and hands: the palest skin, hair to match (a form has none). */
const FORM_SKIN = 0;
const FORM_HAIR = '#efe0cc';

export class Mannequins {
  readonly group = new THREE.Group();
  private readonly people: { p: Person; room: string; bare: boolean }[] = [];
  private readonly gloss = new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.22, metalness: 0.15 });

  constructor(
    private readonly characters: Characters,
    plan: FloorPlan,
  ) {
    this.group.name = 'mannequins';
    for (const f of plan.furniture) {
      if (f.kind !== 'mannequin' || !f.wears) continue;
      const w = f.wears;
      const look: Look = {
        v: 1,
        body: w.body,
        outfit: w.outfit,
        skin: FORM_SKIN,
        hair: FORM_HAIR,
        top: '#1c1c20',
        bottom: '#1c1c20',
        shoes: '#0c0c0e',
      };
      // whatever of each kind the layout puts on it: a ride too (the form stands on it, posed)
      const pieces = w as Partial<Record<ItemKind, string>>;
      for (const kind of ITEM_KINDS) if (pieces[kind]) look[kind] = pieces[kind];
      const p = characters.create(look, '', { blob: false, staff: true });
      p.root.position.set(f.x, PLINTH, f.z);
      p.root.rotation.y = f.yaw;
      this.group.add(p.root);
      this.people.push({ p, room: f.room, bare: !w.clothes });
    }
  }

  /** Resolves once every form is loaded and posed. */
  async load(): Promise<void> {
    await Promise.all(this.people.map(({ p }) => this.characters.load(p.currentLook).catch(() => {})));
    for (const m of this.people) {
      // settle into the idle pose (or a stance on a ride), then stand still for good
      m.p.update(0.4);
      if (m.bare) m.p.useMaterial(this.gloss);
    }
  }

  /** After a quality change (every character is given the new material): the bare form's gloss again. */
  refresh(): void {
    for (const m of this.people) if (m.bare) m.p.useMaterial(this.gloss);
  }

  /** Only in rooms that can be seen. */
  setRooms(rooms: Set<string> | null): void {
    for (const m of this.people) m.p.root.visible = !rooms || rooms.has(m.room);
  }

  dispose(): void {
    for (const m of this.people) m.p.dispose();
    this.gloss.dispose();
    this.group.removeFromParent();
  }
}
