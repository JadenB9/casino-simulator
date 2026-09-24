// The character editor. Your character stands on a small podium in a dressing room of its own,
// rendered by the game's one renderer (no second WebGL context): the room is built far below the
// floor, out of every other view, and the camera is borrowed while the editor is open and put
// back when it closes. The controls sit in a panel on the right; the character stays centred in
// the space left over, and turns when you drag it, press Q/E, or use the buttons under it.
//
// Guided (a new player's first visit): the same room and controls, a few at a time. "Pick your
// look" walks through body and outfit, then skin and hair, then clothes, starting from a look of
// their own; Surprise me deals another, and the last step saves it and goes in.

import './editor.css';
import * as THREE from 'three';
import { DEFAULT_LOOK, OUTFITS, SKIN_TONES, parseLook, type Body, type Look } from '../../../../shared/src/look.ts';
import type { Character, CharacterFactory } from '../../world/contract.ts';
import { el } from '../kit.ts';
import type { AccountApi, Closable, EngineLike, SessionLike, SfxLike } from '../menu/deps.ts';
import { icon } from '../menu/icons.ts';
import { keycap, problemText, segmented } from '../menu/parts.ts';
import { GLOBAL_KEYS, closeButton, focusFirst, holdKeyboard } from '../menu/sheet.ts';
import { mannequins } from './mannequin.ts';
import { BODY_CHOICES, BOTTOMS, HAIR, SHOES, SKINS, TOPS, outfitFor, outfitName, startingLook, type Swatch } from './palettes.ts';

export interface EditorDeps {
  root: HTMLElement;
  api: Pick<AccountApi, 'saveLook'>;
  session: SessionLike;
  engine: EngineLike;
  /** The world's characters; without it a mannequin stands in. */
  characters?: CharacterFactory;
  /** Where the dressing room is built. Default: 60 m below the floor, outside every other view. */
  at?: THREE.Vector3;
  /** Called once, with the saved look or null if nothing was saved. */
  onClose?(saved: Look | null): void;
  sfx?: Pick<SfxLike, 'play'>;
  /**
   * A new player's walk-through: the fields a step at a time, no Cancel, and the last step saves
   * (even an unchanged look: the account still has the default one) and closes with it.
   */
  guided?: boolean;
  /** The look to start from, instead of the saved one (a new player's own starting look). */
  start?: Look;
}

/** The guided walk-through's steps: a title and the fields on it. */
const STEPS = [
  { title: 'Body and outfit', fields: ['body', 'outfit'] },
  { title: 'Skin and hair', fields: ['skin', 'hair'] },
  { title: 'Clothes', fields: ['top', 'bottom', 'shoes'] },
] as const;
type FieldId = (typeof STEPS)[number]['fields'][number];

const PODIUM_TOP = 0.07;
/** Character height plus some air above and below, for framing. */
const FRAME_H = 2.15;

function canvasTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The dressing room: a podium with a brass edge, a pool of light, a dim wall with far-off lights. */
function dressingRoom(at: THREE.Vector3): { group: THREE.Group; pivot: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = 'dressing-room';
  group.position.copy(at);

  const floorTex = canvasTexture(512, 512, (g) => {
    const r = g.createRadialGradient(256, 256, 0, 256, 256, 256);
    r.addColorStop(0, '#3b2a1f');
    r.addColorStop(0.18, '#2a1d15');
    r.addColorStop(0.55, '#110c09');
    r.addColorStop(1, '#070504');
    g.fillStyle = r;
    g.fillRect(0, 0, 512, 512);
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64), new THREE.MeshBasicMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  const wallTex = canvasTexture(1024, 512, (g) => {
    const v = g.createLinearGradient(0, 0, 0, 512);
    v.addColorStop(0, '#040303');
    v.addColorStop(0.42, '#140e0b');
    v.addColorStop(0.5, '#1c140f');
    v.addColorStop(0.62, '#0c0907');
    v.addColorStop(1, '#050404');
    g.fillStyle = v;
    g.fillRect(0, 0, 1024, 512);
    // distant lights along the horizon, out of focus
    g.globalCompositeOperation = 'lighter';
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const x = rnd() * 1024;
      const y = 200 + rnd() * 90;
      const rad = 4 + rnd() * 16;
      const warm = rnd() < 0.8;
      const col = warm ? '255,200,130' : rnd() < 0.5 ? '255,110,95' : '110,210,200';
      const a = 0.05 + rnd() * 0.14;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(${col},${a})`);
      gr.addColorStop(0.7, `rgba(${col},${a * 0.7})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
  });
  const wall = new THREE.Mesh(new THREE.SphereGeometry(9, 48, 24), new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide }));
  wall.position.y = 1.2;
  group.add(wall);

  const leather = new THREE.MeshStandardMaterial({ color: '#1b130e', roughness: 0.55 });
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.64, PODIUM_TOP, 64), leather);
  podium.position.y = PODIUM_TOP / 2;
  const inlay = new THREE.Mesh(new THREE.CircleGeometry(0.55, 64), new THREE.MeshStandardMaterial({ color: '#2a1c14', roughness: 0.75 }));
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = PODIUM_TOP + 0.0006;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.615, 0.007, 8, 128), new THREE.MeshStandardMaterial({ color: '#c9a24b', metalness: 0.9, roughness: 0.28 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = PODIUM_TOP;
  group.add(podium, inlay, ring);

  // Lights with a short reach: 60 m down, they never touch the floor above.
  const key = new THREE.SpotLight('#fff0dc', 26, 9, 0.55, 0.7, 1.4);
  key.position.set(1.4, 3.0, 2.3);
  key.target.position.set(0, 1.0, 0);
  const rim = new THREE.SpotLight('#ffe9cc', 36, 8, 0.6, 0.75, 1.4);
  rim.position.set(-1.6, 2.5, -1.9);
  rim.target.position.set(0, 1.25, 0);
  const fill = new THREE.PointLight('#f6dcc0', 6, 7, 1.6);
  fill.position.set(-1.9, 1.3, 2.4);
  group.add(key, key.target, rim, rim.target, fill);

  const pivot = new THREE.Group();
  pivot.position.y = PODIUM_TOP;
  group.add(pivot);

  return {
    group,
    pivot,
    dispose() {
      group.removeFromParent();
      // The character is its owner's to dispose (the world's may share geometry between players).
      group.remove(pivot);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.dispose();
      });
    },
  };
}

/** A row of colour swatches as a radio group; the chosen colour's name shows beside the label. */
function swatchField(label: string, list: readonly Swatch[], value: string, onPick: (hex: string) => void): HTMLElement {
  const field = el('div', 'ed-field');
  const head = el('div', 'ed-field-head');
  const name = el('span', 'ed-value');
  head.append(el('span', 'ed-label', label), name);
  const row = el('div', 'swatches');
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', label);
  // A colour saved from elsewhere that isn't in the palette still shows, as "Custom".
  const all = list.some((s) => s.hex === value) ? list : [...list, { hex: value, name: 'Custom' }];
  let current = value;
  const buttons = all.map((s) => {
    const b = el('button', 'sw');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', s.name);
    b.title = s.name;
    const dot = el('i');
    dot.style.background = s.hex;
    b.append(dot);
    b.addEventListener('click', () => pick(s.hex));
    row.append(b);
    return b;
  });
  const paint = () => {
    all.forEach((s, i) => {
      const on = s.hex === current;
      buttons[i]!.setAttribute('aria-checked', String(on));
      buttons[i]!.tabIndex = on ? 0 : -1;
    });
    name.textContent = all.find((s) => s.hex === current)?.name ?? '';
  };
  const pick = (hex: string, focus = false) => {
    if (hex === current) return;
    current = hex;
    paint();
    if (focus) buttons[all.findIndex((s) => s.hex === hex)]?.focus();
    onPick(hex);
  };
  row.addEventListener('keydown', (e) => {
    const i = all.findIndex((s) => s.hex === current);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    pick(all[(i + step + all.length) % all.length]!.hex, true);
  });
  paint();
  field.append(head, row);
  return field;
}

function field(label: string, value: string, control: HTMLElement): { root: HTMLElement; value: HTMLElement } {
  const root = el('div', 'ed-field');
  const head = el('div', 'ed-field-head');
  const v = el('span', 'ed-value', value);
  head.append(el('span', 'ed-label', label), v);
  root.append(head, control);
  return { root, value: v };
}

export function openEditor(deps: EditorDeps): Closable {
  const profile = deps.session.profile;
  const saved: Look = profile?.look ?? DEFAULT_LOOK;
  const guided = !!deps.guided;
  let look: Look = { ...(deps.start ?? saved) };
  let busy = false;
  let confirmDiscard = false;
  let step = 0;

  // ---- 3D
  const { engine } = deps;
  const cam = engine.camera;
  const camBefore = { position: cam.position.clone(), quaternion: cam.quaternion.clone() };
  const room = dressingRoom(deps.at ?? new THREE.Vector3(0, -60, 0));
  engine.scene.add(room.group);
  const character: Character = (deps.characters ?? mannequins).create(look, profile?.name ?? '');
  character.setName(profile?.name ?? '');
  character.setMotion(0);
  room.pivot.add(character.root);
  let yaw = -0.35;
  let yawTarget = -0.35;
  room.pivot.rotation.y = yaw;

  // ---- DOM
  const root = el('div', 'editor');
  const stage = el('div', 'editor-stage');
  stage.setAttribute('aria-hidden', 'true');
  const turn = el('div', 'ed-turn');
  const turnBy = (d: number) => (yawTarget += d);
  const left = el('button', 'ed-turn-btn');
  left.type = 'button';
  left.tabIndex = -1;
  left.title = 'Turn left (Q)';
  left.append(icon('turn-left'));
  left.addEventListener('click', () => turnBy(-Math.PI / 4));
  const right = el('button', 'ed-turn-btn');
  right.type = 'button';
  right.tabIndex = -1;
  right.title = 'Turn right (E)';
  right.append(icon('turn-right'));
  right.addEventListener('click', () => turnBy(Math.PI / 4));
  const turnHint = el('span', 'ed-turn-hint');
  turnHint.append(el('span', '', 'Drag to turn'), keycap('Q'), keycap('E'));
  turn.append(left, turnHint, right);
  stage.append(turn);

  const panel = el('aside', guided ? 'editor-panel guided' : 'editor-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'editor-title');
  const head = el('header', 'sheet-head');
  const titles = el('div', 'sheet-titles');
  const title = el('h2', 'sheet-title', guided ? 'Pick your look' : 'Character');
  title.id = 'editor-title';
  titles.append(title, el('p', 'sheet-sub', guided ? 'Everyone on the floor sees you like this. You can change it any time from Character in the menu.' : 'How everyone on the floor sees you.'));
  head.append(titles);
  if (!guided) head.append(closeButton(() => requestClose(), 'Cancel'));
  // the walk-through's progress: which step, as a row of rules and its name
  const progress = el('div', 'ed-steps');
  const stepName = el('span', 'ed-step-name');
  const ticks = STEPS.map(() => el('i', 'ed-tick'));
  const tickRow = el('span', 'ed-ticks');
  tickRow.append(...ticks);
  progress.append(tickRow, stepName);

  const scroll = el('div', 'ed-scroll');
  const outfitBox = el('div');
  const status = el('p', 'ed-status');
  status.setAttribute('aria-live', 'polite');

  const saveBtn = el('button', 'btn primary', 'Save');
  saveBtn.type = 'button';
  const cancelBtn = el('button', 'btn ghost', 'Cancel');
  cancelBtn.type = 'button';
  const resetBtn = el('button', 'btn ghost ed-reset', 'Reset');
  resetBtn.type = 'button';
  // the walk-through's own buttons
  const surpriseBtn = el('button', 'btn ghost ed-reset', 'Surprise me');
  surpriseBtn.type = 'button';
  const backBtn = el('button', 'btn ghost', 'Back');
  backBtn.type = 'button';
  const nextBtn = el('button', 'btn primary', 'Next');
  nextBtn.type = 'button';
  const foot = el('footer', 'ed-foot');
  const buttons = el('div', 'ed-buttons');
  if (guided) buttons.append(surpriseBtn, backBtn, nextBtn);
  else buttons.append(resetBtn, cancelBtn, saveBtn);
  foot.append(status, buttons);
  if (guided) panel.append(head, progress, scroll, foot);
  else panel.append(head, scroll, foot);
  root.append(stage, panel);
  deps.root.append(root);

  // a new player's look is saved whatever it is: the account still has the default one
  const dirty = () => guided || JSON.stringify(look) !== JSON.stringify(saved);
  const last = () => step === STEPS.length - 1;
  const paintState = (msg?: string, kind = '') => {
    const d = dirty();
    saveBtn.disabled = busy || !d;
    resetBtn.disabled = busy || !d;
    cancelBtn.disabled = busy;
    backBtn.hidden = step === 0;
    backBtn.disabled = busy;
    surpriseBtn.disabled = busy;
    nextBtn.disabled = busy;
    nextBtn.textContent = busy ? 'Saving' : last() ? 'Enter the casino' : 'Next';
    status.className = `ed-status ${kind}`.trim();
    status.textContent = msg ?? (guided ? '' : d ? 'Unsaved changes.' : '');
  };

  const update = (next: Partial<Look>) => {
    look = { ...look, ...next };
    character.setLook(look);
    confirmDiscard = false;
    deps.sfx?.play('ui-switch', { volume: 0.2 });
    paintState();
  };

  const renderOutfits = () => {
    const f = field('Outfit', outfitName(look.outfit), el('div'));
    const seg = segmented(
      'Outfit',
      OUTFITS[look.body].map((id) => ({ id, label: outfitName(id) })),
      look.outfit,
      (id) => {
        f.value.textContent = outfitName(id);
        update({ outfit: id });
      },
      'ed-seg',
    );
    f.root.replaceChild(seg.root, f.root.lastChild!);
    outfitBox.replaceChildren(f.root);
  };

  const renderFields = () => {
    const body = field('Body', BODY_CHOICES.find((b) => b.id === look.body)!.label, el('div'));
    const bodySeg = segmented<Body>('Body', BODY_CHOICES, look.body, (b) => {
      body.value.textContent = BODY_CHOICES.find((x) => x.id === b)!.label;
      update({ body: b, outfit: outfitFor(b, look.outfit) });
      renderOutfits();
    }, 'ed-seg');
    body.root.replaceChild(bodySeg.root, body.root.lastChild!);
    renderOutfits();
    const fields: Record<FieldId, HTMLElement> = {
      body: body.root,
      outfit: outfitBox,
      skin: swatchField('Skin', SKINS, SKIN_TONES[look.skin] ?? SKIN_TONES[2], (hex) => update({ skin: Math.max(0, SKIN_TONES.indexOf(hex as (typeof SKIN_TONES)[number])) })),
      hair: swatchField('Hair', HAIR, look.hair, (hex) => update({ hair: hex })),
      top: swatchField('Top', TOPS, look.top, (hex) => update({ top: hex })),
      bottom: swatchField('Bottom', BOTTOMS, look.bottom, (hex) => update({ bottom: hex })),
      shoes: swatchField('Shoes', SHOES, look.shoes, (hex) => update({ shoes: hex })),
    };
    if (!guided) {
      scroll.replaceChildren(...STEPS.flatMap((s) => s.fields.map((f) => fields[f])));
      return;
    }
    const current = STEPS[step]!;
    stepName.textContent = `${step + 1} of ${STEPS.length} · ${current.title}`;
    ticks.forEach((t, i) => t.classList.toggle('on', i <= step));
    scroll.replaceChildren(...current.fields.map((f) => fields[f]));
  };
  const goTo = (i: number) => {
    step = Math.max(0, Math.min(STEPS.length - 1, i));
    renderFields();
    paintState();
    deps.sfx?.play('ui-switch', { volume: 0.25 });
    queueMicrotask(() => focusFirst(scroll));
  };
  renderFields();
  paintState();

  // ---- framing: centre the character in the space the panel leaves
  const frame = () => {
    const vw = innerWidth;
    const vh = innerHeight;
    const r = panel.getBoundingClientRect();
    const side = r.top < vh * 0.25; // panel down the right side, or a sheet along the bottom
    const reserve = turn.getBoundingClientRect().height + 36; // the turn control under the feet
    const free = side ? { x0: 0, x1: Math.max(1, r.left), y0: 0, y1: vh - reserve } : { x0: 0, x1: vw, y0: 0, y1: Math.max(1, r.top - reserve) };
    const half = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const frac = (free.y1 - free.y0) / vh;
    const d = FRAME_H / (2 * half * frac * 0.9);
    const cx = ((free.x0 + free.x1) / 2 / vw) * 2 - 1;
    const cy = -((((free.y0 + free.y1) / 2) / vh) * 2 - 1);
    const focus = room.group.position.clone().add(new THREE.Vector3(0, PODIUM_TOP + 0.86, 0));
    const halfH = d * half;
    const halfW = halfH * (vw / vh);
    cam.position.set(focus.x, focus.y + 0.08, focus.z + d);
    cam.lookAt(focus.x - cx * halfW, focus.y + 0.08 - cy * halfH, focus.z);
  };
  let framed = false;
  const offFrame = engine.onFrame((dt) => {
    if (!framed) {
      frame();
      framed = true;
    }
    yaw += (yawTarget - yaw) * Math.min(1, dt * 9);
    room.pivot.rotation.y = yaw;
    character.update(dt);
  });
  const onResize = () => frame();
  addEventListener('resize', onResize);

  // ---- turning by drag
  let drag: { id: number; x: number } | null = null;
  stage.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.ed-turn-btn')) return;
    drag = { id: e.pointerId, x: e.clientX };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    yawTarget += (e.clientX - drag.x) * 0.012;
    drag.x = e.clientX;
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  root.addEventListener('keydown', (e) => {
    if (GLOBAL_KEYS.has(e.key)) return;
    e.stopPropagation(); // keep editor keys away from the floor and table handlers
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const inGroup = (e.target as HTMLElement).closest('[role="radiogroup"]');
    if (e.code === 'KeyQ' || (!inGroup && e.key === 'ArrowLeft')) turnBy(-0.3);
    else if (e.code === 'KeyE' || (!inGroup && e.key === 'ArrowRight')) turnBy(0.3);
    else return;
    e.preventDefault();
  });

  // ---- closing
  let finished = false;
  const finish = (result: Look | null) => {
    if (finished) return;
    finished = true;
    release();
    offFrame();
    removeEventListener('resize', onResize);
    character.dispose();
    room.dispose();
    cam.position.copy(camBefore.position);
    cam.quaternion.copy(camBefore.quaternion);
    root.classList.add('closing');
    setTimeout(() => root.remove(), 200);
    deps.onClose?.(result);
  };
  const requestClose = () => {
    if (busy) return;
    // the walk-through has no Cancel: Esc steps back
    if (guided) {
      if (step > 0) goTo(step - 1);
      return;
    }
    if (dirty() && !confirmDiscard) {
      confirmDiscard = true;
      paintState('Unsaved changes. Press Esc again to discard them, or Save.', 'warn');
      return;
    }
    finish(null);
  };
  const release = holdKeyboard(root, requestClose);

  cancelBtn.addEventListener('click', () => finish(null));
  resetBtn.addEventListener('click', () => {
    look = { ...saved };
    character.setLook(look);
    confirmDiscard = false;
    renderFields();
    paintState();
  });
  const save = async () => {
    const clean = parseLook(look);
    if (!clean || busy) return;
    busy = true;
    saveBtn.textContent = 'Saving';
    paintState('Saving your look.');
    try {
      const stored = await deps.api.saveLook(clean);
      const p = deps.session.profile;
      if (p) deps.session.set({ ...p, look: stored });
      deps.sfx?.play('ui-click', { volume: 0.45 });
      busy = false;
      finish(stored);
    } catch (err) {
      busy = false;
      saveBtn.textContent = 'Save';
      paintState(problemText(err), 'err');
    }
  };
  saveBtn.addEventListener('click', () => void save());
  nextBtn.addEventListener('click', () => (last() ? void save() : goTo(step + 1)));
  backBtn.addEventListener('click', () => goTo(step - 1));
  let deals = 0;
  surpriseBtn.addEventListener('click', () => {
    // another whole look, dealt from the same palettes
    look = startingLook((Date.now() + ++deals * 7919) & 0x7fffffff);
    character.setLook(look);
    renderFields();
    paintState();
    deps.sfx?.play('ui-switch', { volume: 0.3 });
  });

  queueMicrotask(() => focusFirst(panel));
  return { root, close: () => finish(null) };
}
