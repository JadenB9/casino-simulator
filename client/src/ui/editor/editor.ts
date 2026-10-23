// The character editor. Your character stands on a small podium in a dressing room of its own
// (stage.ts), rendered by the game's one renderer (no second WebGL context): the room is built far
// below the floor, out of every other view, and the camera is borrowed while the editor is open
// and put back when it closes. The controls sit in a panel on the right (a sheet along the bottom
// on narrow screens); the character stays centred in the space left over. Drag it, or Q/E, to
// turn it; the wheel, a pinch or +/- go from the whole figure to the face, and 0 puts the view back.
//
// The fields come in three steps (body and outfit, skin and hair, clothes) named in a row of tabs
// under the title. In the full editor every field is in one scroll and a tab jumps to its part
// (the one you're looking at stays lit); Surprise me deals a whole new look, Reset puts the saved
// one back. Guided (a new player's first visit): "Pick your look" shows a step at a time, starting
// from a look of their own; any tab or Back and Next move between them, and the last step saves
// the look and goes in.

import './editor.css';
import * as THREE from 'three';
import { BUILD, DEFAULT_LOOK, HEIGHT, OUTFITS, SKIN_TONES, parseLook, type Body, type Look } from '../../../../shared/src/look.ts';
import type { Character, CharacterFactory } from '../../world/contract.ts';
import { el } from '../kit.ts';
import type { AccountApi, Closable, EngineLike, SessionLike, SfxLike } from '../menu/deps.ts';
import { icon } from '../menu/icons.ts';
import { glyph } from '../menu/glyphs.ts';
import { keycap, problemText, segmented } from '../menu/parts.ts';
import { GLOBAL_KEYS, closeButton, focusables, holdKeyboard } from '../menu/sheet.ts';
import { calm } from '../../app/comfort.ts';
import { mannequins } from './mannequin.ts';
import { BODY_CHOICES, BOTTOMS, HAIR, SHOES, SKINS, TOPS, luminance, outfitFor, outfitName, sizeWord, startingLook, type Swatch } from './palettes.ts';
import { PODIUM_TOP, dressingRoom } from './stage.ts';

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

/** The three steps: a title and the fields on it. */
const STEPS = [
  { title: 'Body and outfit', tab: 'Body', note: 'A body, its height and build, and an outfit; the colours come next.', fields: ['body', 'shape', 'outfit'] },
  { title: 'Skin and hair', tab: 'Skin & hair', note: 'Your skin tone and your hair colour.', fields: ['skin', 'hair'] },
  { title: 'Clothes', tab: 'Clothes', note: 'What you wear. Surprise me deals a whole new look.', fields: ['top', 'bottom', 'shoes'] },
] as const;
type FieldId = (typeof STEPS)[number]['fields'][number];

/** Character height plus some air above and below, for the whole-figure framing. */
const FRAME_H = 2.15;
/** The close-up: head and shoulders. */
const CLOSE_H = 0.68;
/** The turn the figure starts at (and goes back to), a three-quarter view. */
const YAW = -0.35;

/** Where keyboard focus starts inside `within`: the first control Tab would reach (a group's chosen radio, not its first). */
function focusStart(within: HTMLElement): void {
  const first = focusables(within).find((e) => e.tabIndex >= 0);
  (first ?? within).focus({ preventScroll: true });
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
    // the chosen one wears a ring and a check: dark on a light colour, light on a dark one
    const b = el('button', luminance(s.hex) > 0.36 ? 'sw light' : 'sw');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', s.name);
    b.title = s.name;
    const dot = el('i');
    dot.style.background = s.hex;
    const check = glyph('check');
    check.classList.add('sw-check');
    b.append(dot, check);
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

/** A small button with a glyph, its words beside it where there's room (always its label to a reader). */
function iconButton(cls: string, label: string, ico: SVGSVGElement, words?: string): HTMLButtonElement {
  const b = el('button', `btn ghost ed-icon ${cls}`.trim());
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(ico);
  if (words) b.append(el('span', 'ed-btn-text', words));
  return b;
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
  // no name tag here: the framing is for the character, and the tag would sit above the view
  character.setName('');
  character.setMotion(0);
  room.pivot.add(character.root);
  let yaw = YAW;
  let yawTarget = YAW;
  // 0 the whole figure, 1 the close-up; `zoomNow` follows `zoom` a little behind
  let zoom = 0;
  let zoomNow = 0;
  room.pivot.rotation.y = yaw;

  // ---- DOM
  const root = el('div', 'editor');
  const stage = el('div', 'editor-stage');
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', 'Preview');
  const turnBy = (d: number) => (yawTarget += d);
  const zoomTo = (z: number) => (zoom = Math.max(0, Math.min(1, z)));
  const resetView = () => {
    // the shortest way back round to the three-quarter view
    yawTarget = YAW + Math.round((yawTarget - YAW) / (Math.PI * 2)) * Math.PI * 2;
    zoomTo(0);
  };
  const view = el('div', 'ed-view');
  view.setAttribute('role', 'group');
  view.setAttribute('aria-label', 'View');
  const viewButton = (label: string, ico: SVGSVGElement, run: () => void) => {
    const b = el('button', 'ed-view-btn');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.append(ico);
    b.addEventListener('click', run);
    return b;
  };
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const hint = el('span', 'ed-view-hint', touch ? 'Drag to turn · pinch to zoom' : 'Drag to turn');
  if (!touch) hint.append(keycap('Q'), keycap('E'));
  view.append(
    viewButton('Turn left (Q)', icon('turn-left'), () => turnBy(-Math.PI / 4)),
    hint,
    viewButton('Turn right (E)', icon('turn-right'), () => turnBy(Math.PI / 4)),
    el('i', 'ed-view-sep'),
    viewButton('Zoom out (-)', glyph('minus'), () => zoomTo(zoom - 0.5)),
    viewButton('Zoom in (+)', glyph('plus'), () => zoomTo(zoom + 0.5)),
    el('i', 'ed-view-sep'),
    viewButton('Reset the view (0)', glyph('recenter'), resetView),
  );
  stage.append(view);

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

  // the three steps as tabs: guided, where you are (and the ones done); the full editor, which
  // part of the scroll you're looking at
  const steps = el('nav', 'ed-steps');
  steps.setAttribute('aria-label', guided ? 'Steps' : 'Parts');
  const stepButtons = STEPS.map((s, i) => {
    const b = el('button', 'ed-step');
    b.type = 'button';
    b.dataset.step = String(i);
    const num = el('span', 'ed-step-num');
    num.append(el('span', 'ed-step-n', String(i + 1)), glyph('check'));
    b.append(num, el('span', 'ed-step-title', s.tab));
    b.title = s.title;
    b.addEventListener('click', () => (guided ? goTo(i) : jumpTo(i)));
    return b;
  });
  // said to a screen reader as the step changes (and read by scripts/e2e/world3)
  const stepName = el('span', 'ed-step-name');
  stepName.setAttribute('aria-live', 'polite');
  steps.append(...stepButtons, stepName);

  const scroll = el('div', 'ed-scroll');
  const sections = STEPS.map((s, i) => {
    const sec = el('section', 'ed-section');
    sec.dataset.step = String(i);
    sec.setAttribute('aria-label', s.title);
    return sec;
  });
  const outfitBox = el('div');
  const status = el('p', 'ed-status');
  status.setAttribute('aria-live', 'polite');

  const saveBtn = el('button', 'btn primary', 'Save');
  saveBtn.type = 'button';
  const cancelBtn = el('button', 'btn ghost', 'Cancel');
  cancelBtn.type = 'button';
  // Reset only shows once there's something to put back, beside the line that says so
  const resetBtn = el('button', 'ed-undo', 'Reset');
  resetBtn.type = 'button';
  resetBtn.title = 'Put your saved look back';
  // (guided, Surprise me keeps ed-reset as well: scripts/e2e/world3 presses it by that)
  const surpriseBtn = iconButton(guided ? 'ed-reset ed-surprise' : 'ed-surprise', 'Surprise me: a whole new look', glyph('dice'), 'Surprise me');
  const backBtn = el('button', 'btn ghost', 'Back');
  backBtn.type = 'button';
  const nextBtn = el('button', 'btn primary', 'Next');
  nextBtn.type = 'button';
  const foot = el('footer', 'ed-foot');
  const state = el('div', 'ed-state');
  state.append(status);
  if (!guided) state.append(resetBtn);
  const buttons = el('div', 'ed-buttons');
  if (guided) buttons.append(surpriseBtn, backBtn, nextBtn);
  else buttons.append(surpriseBtn, cancelBtn, saveBtn);
  foot.append(state, buttons);
  panel.append(head, steps, scroll, foot);
  root.append(stage, panel);
  deps.root.append(root);

  // a new player's look is saved whatever it is: the account still has the default one
  const changed = () => JSON.stringify(look) !== JSON.stringify(saved);
  const dirty = () => guided || changed();
  const last = () => step === STEPS.length - 1;
  const paintState = (msg?: string, kind = '') => {
    const d = dirty();
    saveBtn.disabled = busy || !d;
    resetBtn.hidden = !changed();
    resetBtn.disabled = busy;
    cancelBtn.disabled = busy;
    backBtn.hidden = step === 0;
    backBtn.disabled = busy;
    surpriseBtn.disabled = busy;
    nextBtn.disabled = busy;
    nextBtn.textContent = busy ? 'Saving' : last() ? 'Enter the casino' : 'Next';
    status.className = `ed-status ${kind}`.trim();
    status.textContent = msg ?? (guided ? '' : d ? 'Unsaved changes.' : '');
  };

  // the part of the full editor's scroll in view, for its tab
  let inView = 0;
  const paintSteps = () => {
    stepButtons.forEach((b, i) => {
      const on = guided ? i === step : i === inView;
      b.classList.toggle('on', on);
      b.classList.toggle('done', guided && i < step);
      if (on) b.setAttribute('aria-current', guided ? 'step' : 'true');
      else b.removeAttribute('aria-current');
    });
    stepName.textContent = guided ? `${step + 1} of ${STEPS.length} · ${STEPS[step]!.title}` : '';
  };

  let faceY: number | null = null;
  const update = (next: Partial<Look>) => {
    look = { ...look, ...next };
    character.setLook(look);
    faceY = null; // a new height or body: measure the face again
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
    const bodySeg = segmented<Body>(
      'Body',
      BODY_CHOICES,
      look.body,
      (b) => {
        body.value.textContent = BODY_CHOICES.find((x) => x.id === b)!.label;
        update({ body: b, outfit: outfitFor(b, look.outfit) });
        renderOutfits();
      },
      'ed-seg',
    );
    body.root.replaceChild(bodySeg.root, body.root.lastChild!);
    renderOutfits();
    const fields: Record<FieldId, HTMLElement> = {
      body: body.root,
      shape: shapeField(look, (o) => update(o)),
      outfit: outfitBox,
      skin: swatchField('Skin', SKINS, SKIN_TONES[look.skin] ?? SKIN_TONES[2], (hex) => update({ skin: Math.max(0, SKIN_TONES.indexOf(hex as (typeof SKIN_TONES)[number])) })),
      hair: swatchField('Hair', HAIR, look.hair, (hex) => update({ hair: hex })),
      top: swatchField('Top', TOPS, look.top, (hex) => update({ top: hex })),
      bottom: swatchField('Bottom', BOTTOMS, look.bottom, (hex) => update({ bottom: hex })),
      shoes: swatchField('Shoes', SHOES, look.shoes, (hex) => update({ shoes: hex })),
    };
    if (!guided) {
      const top = scroll.scrollTop;
      sections.forEach((sec, i) => sec.replaceChildren(el('h3', 'ed-section-title', STEPS[i]!.title), ...STEPS[i]!.fields.map((f) => fields[f])));
      scroll.replaceChildren(...sections);
      scroll.scrollTop = top;
      paintSteps();
      return;
    }
    const current = STEPS[step]!;
    const part = el('div', 'ed-part');
    part.append(el('p', 'ed-step-note', current.note), ...current.fields.map((f) => fields[f]));
    scroll.replaceChildren(part);
    scroll.scrollTop = 0;
    paintSteps();
  };
  const goTo = (i: number) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, i));
    if (next === step) return;
    step = next;
    renderFields();
    paintState();
    deps.sfx?.play('ui-switch', { volume: 0.25 });
    queueMicrotask(() => focusStart(scroll));
  };
  // the full editor: a tab scrolls its part to the top (smoothly, unless motion is reduced)
  const jumpTo = (i: number) => {
    const sec = sections[i]!;
    inView = i;
    paintSteps();
    scroll.scrollTo({ top: Math.max(0, sec.offsetTop - 6), behavior: calm() ? 'auto' : 'smooth' });
    focusStart(sec);
  };
  let scrollRaf = 0;
  scroll.addEventListener(
    'scroll',
    () => {
      if (guided || scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        const top = scroll.getBoundingClientRect().top;
        let at = 0;
        sections.forEach((s, i) => {
          if (s.getBoundingClientRect().top - top <= 40) at = i;
        });
        // scrolled to the end: the last part is the one in view, however short it is
        if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 4) at = sections.length - 1;
        if (at !== inView) {
          inView = at;
          paintSteps();
        }
      });
    },
    { passive: true },
  );
  renderFields();
  paintState();

  // ---- framing: centre the character in the space the panel leaves, whole or close up
  const full = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const close = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const _focus = new THREE.Vector3();
  const _face = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _look = new THREE.Vector3();
  let free = { x0: 0, x1: 1, y0: 0, y1: 1 };
  const measure = () => {
    const vw = innerWidth;
    const vh = innerHeight;
    const r = panel.getBoundingClientRect();
    const side = r.top < vh * 0.25; // panel down the right side, or a sheet along the bottom
    // the view's buttons under the feet, unless they stand up the stage's edge (narrow screens)
    const v = view.getBoundingClientRect();
    const reserve = v.width > v.height ? v.height + 30 : 16;
    free = side ? { x0: 0, x1: Math.max(1, r.left), y0: 0, y1: vh - reserve } : { x0: 0, x1: vw, y0: 0, y1: Math.max(1, r.top - reserve) };
  };
  /**
   * Where the camera stands to show `h` metres of the figure around height `y` (and `wide` metres
   * across, for a tall narrow stage), centred in the free space.
   */
  const framing = (y: number, h: number, wide: number, out: { pos: THREE.Vector3; look: THREE.Vector3 }) => {
    const vw = innerWidth;
    const vh = innerHeight;
    const half = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const frac = (free.y1 - free.y0) / vh;
    const fracX = (free.x1 - free.x0) / vw;
    const d = Math.max(h / (2 * half * frac * 0.9), wide / (2 * half * (vw / vh) * fracX * 0.9));
    const cx = ((free.x0 + free.x1) / 2 / vw) * 2 - 1;
    const cy = -(((free.y0 + free.y1) / 2 / vh) * 2 - 1);
    _focus.copy(room.group.position);
    _focus.y += PODIUM_TOP + y;
    const halfH = d * half;
    const halfW = halfH * (vw / vh);
    out.pos.set(_focus.x, _focus.y + 0.08, _focus.z + d);
    out.look.set(_focus.x - cx * halfW, _focus.y + 0.08 - cy * halfH, _focus.z);
  };
  const frame = () => {
    framing(0.86, FRAME_H, 1.4, full);
    // the face, once the model can say where it is; until then, where a face usually is
    if (faceY === null) {
      const at = character.part?.('face', _face);
      if (at) faceY = at.y;
    }
    framing((faceY ?? 1.52 * (look.height ?? 1)) - 0.13, CLOSE_H, 0.55, close);
  };
  let framed = false;
  let settled = -1;
  const offFrame = engine.onFrame((dt) => {
    if (!framed) {
      measure();
      framed = true;
      settled = -1;
    }
    yaw += (yawTarget - yaw) * Math.min(1, dt * 9);
    room.pivot.rotation.y = yaw;
    character.update(dt);
    // the zoom glides (gentler while motion is reduced); the camera is written only while it moves
    zoomNow += (zoom - zoomNow) * Math.min(1, dt * (calm() ? 4 : 8));
    if (Math.abs(zoom - zoomNow) < 0.0005) zoomNow = zoom;
    if (zoomNow !== settled || (faceY === null && zoomNow > 0)) {
      frame();
      const t = zoomNow * zoomNow * (3 - 2 * zoomNow);
      cam.position.copy(_pos.lerpVectors(full.pos, close.pos, t));
      cam.lookAt(_look.lerpVectors(full.look, close.look, t));
      settled = zoomNow;
    }
  });
  const onResize = () => {
    framed = false;
  };
  addEventListener('resize', onResize);

  // ---- turning by drag, zooming by the wheel or a pinch
  const pointers = new Map<number, [number, number]>();
  let pinch: { dist: number; zoom: number } | null = null;
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0;
  };
  stage.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.ed-view')) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
    if (pointers.size === 2) pinch = { dist: spread(), zoom };
  });
  stage.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p[0];
    p[0] = e.clientX;
    p[1] = e.clientY;
    if (pinch && pointers.size >= 2) zoomTo(pinch.zoom + (spread() - pinch.dist) / 240);
    else yawTarget += dx * 0.012;
  });
  const endDrag = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomTo(zoom - e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    },
    { passive: false },
  );

  root.addEventListener('keydown', (e) => {
    if (GLOBAL_KEYS.has(e.key)) return;
    e.stopPropagation(); // keep editor keys away from the floor and table handlers
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement;
    // arrows belong to a radio group or a slider when one has the focus
    const owned = !!target.closest('[role="radiogroup"]') || target instanceof HTMLInputElement;
    if (e.code === 'KeyQ' || (!owned && e.key === 'ArrowLeft')) turnBy(-0.3);
    else if (e.code === 'KeyE' || (!owned && e.key === 'ArrowRight')) turnBy(0.3);
    else if (e.key === '+' || e.key === '=') zoomTo(zoom + 0.25);
    else if (e.key === '-' || e.key === '_') zoomTo(zoom - 0.25);
    else if (e.key === '0') resetView();
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
    cancelAnimationFrame(scrollRaf);
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
    if (changed() && !confirmDiscard) {
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
    faceY = null;
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
    // another whole look, dealt from the same palettes (anything worn from the shop stays on, and
    // so do the height and build)
    look = { ...look, ...startingLook((Date.now() + ++deals * 7919) & 0x7fffffff) };
    character.setLook(look);
    faceY = null;
    confirmDiscard = false;
    renderFields();
    paintState();
    deps.sfx?.play('ui-switch', { volume: 0.3 });
  });

  queueMicrotask(() => focusStart(scroll));
  return { root, close: () => finish(null) };
}

/** v7.1: Height and Build, two sliders (seen by everyone: they're part of the look). */
function shapeField(look: Look, update: (o: Partial<Look>) => void): HTMLElement {
  const root = el('div', 'ed-field ed-shape');
  const slider = (label: string, key: 'height' | 'build', range: readonly [number, number]) => {
    const row = el('label', 'ed-slider');
    const name = el('span', 'ed-slider-name', label);
    const input = el('input');
    input.type = 'range';
    input.min = String(range[0]);
    input.max = String(range[1]);
    input.step = '0.01';
    input.value = String(look[key] ?? 1);
    const value = el('span', 'ed-slider-value money');
    // where 100% sits along the track, 0 to 1 (the fill runs from there to the thumb)
    const mid = (1 - range[0]) / (range[1] - range[0]);
    row.style.setProperty('--mid', mid.toFixed(4));
    const paint = () => {
      const v = Number(input.value);
      const text = `${sizeWord(key, v)} · ${Math.round(v * 100)}%`;
      value.textContent = text;
      input.setAttribute('aria-valuetext', text);
      const now = (v - range[0]) / (range[1] - range[0]);
      row.style.setProperty('--from', Math.min(mid, now).toFixed(4));
      row.style.setProperty('--to', Math.max(mid, now).toFixed(4));
    };
    input.addEventListener('input', () => {
      paint();
      update({ [key]: Number(input.value) } as Partial<Look>);
    });
    // a double click puts it back in the middle
    input.addEventListener('dblclick', () => {
      input.value = '1';
      paint();
      update({ [key]: 1 } as Partial<Look>);
    });
    paint();
    row.append(name, input, value);
    return row;
  };
  root.append(slider('Height', 'height', HEIGHT), slider('Build', 'build', BUILD));
  return root;
}
