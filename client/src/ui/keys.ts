// v7.4: the floor's controls, rebindable (Settings, Controls). Each action has one key, by its
// physical place on the keyboard (KeyboardEvent.code, so an AZERTY board's keys stay where the
// defaults put them); the arrow keys always walk and steer as well, and Shift and Ctrl count either side.
// A key given to an action takes it from any other action it could clash with (one used where the
// other is: on foot, in a car, or both), and that action gets the old key, so nothing is ever left
// without one or doubled up. Esc, Enter, Tab, ?, 1-9, Alt and Cmd stay the game's own (1.3: Ctrl
// can be bound, and runs by default). What you choose is kept in this browser.

export type KeyAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'run'
  | 'jump'
  | 'crouch'
  | 'interact'
  | 'view'
  | 'gun'
  | 'ride'
  | 'sip'
  | 'emotes'
  | 'map'
  | 'chat'
  | 'feats'
  | 'mute'
  | 'horn'
  | 'carView'
  | 'turn';

/** Where an action means something: on foot, driving, or both. */
type Where = 'foot' | 'car' | 'both';

export interface KeySpec {
  action: KeyAction;
  name: string;
  where: Where;
  default: string;
}

/** Every action, in the order Settings lists them. */
export const KEY_SPECS: readonly KeySpec[] = [
  { action: 'forward', name: 'Walk forward / accelerate', where: 'both', default: 'KeyW' },
  { action: 'back', name: 'Walk back / brake', where: 'both', default: 'KeyS' },
  { action: 'left', name: 'Walk left / steer left', where: 'both', default: 'KeyA' },
  { action: 'right', name: 'Walk right / steer right', where: 'both', default: 'KeyD' },
  { action: 'run', name: 'Run (held)', where: 'foot', default: 'ControlLeft' },
  { action: 'jump', name: 'Jump / handbrake', where: 'both', default: 'Space' },
  { action: 'crouch', name: 'Crouch', where: 'foot', default: 'ShiftLeft' },
  { action: 'interact', name: 'Use what the prompt offers / get out', where: 'both', default: 'KeyE' },
  { action: 'view', name: 'First or third person', where: 'foot', default: 'KeyF' },
  { action: 'gun', name: 'Draw or put away your gun', where: 'foot', default: 'KeyV' },
  { action: 'ride', name: 'Get on or off your ride', where: 'foot', default: 'KeyB' },
  { action: 'sip', name: 'Sip or bite what you hold', where: 'foot', default: 'KeyQ' },
  { action: 'emotes', name: 'Emotes', where: 'both', default: 'KeyG' },
  { action: 'map', name: 'Map', where: 'both', default: 'KeyM' },
  { action: 'chat', name: 'Chat', where: 'both', default: 'KeyT' },
  { action: 'feats', name: 'Achievements and challenges', where: 'both', default: 'KeyJ' },
  { action: 'mute', name: 'Mute or unmute', where: 'both', default: 'KeyN' },
  { action: 'horn', name: 'Horn', where: 'car', default: 'KeyH' },
  { action: 'carView', name: 'Car camera', where: 'car', default: 'KeyC' },
  { action: 'turn', name: 'Turn a piece you are moving (your apartment)', where: 'foot', default: 'KeyR' },
];

const SPEC = new Map(KEY_SPECS.map((s) => [s.action, s]));

/** The arrow keys walk and steer whatever the letters are. */
const ALSO: Partial<Record<KeyAction, string>> = { forward: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

/** Keys that stay the game's own: menus, the emote wheel's and pickers' numbers, the help. */
export function reservedKey(code: string): boolean {
  return /^(Escape|Enter|NumpadEnter|Tab|Slash|Backquote|Digit\d|Numpad\d|Arrow\w+|Meta\w*|Alt\w*|CapsLock|ContextMenu|F\d+|OS\w*)$/.test(code) || code === '';
}

const STORE = 'casino.keys';
let map = load();
const listeners = new Set<() => void>();

function defaults(): Record<KeyAction, string> {
  return Object.fromEntries(KEY_SPECS.map((s) => [s.action, s.default])) as Record<KeyAction, string>;
}

function load(): Record<KeyAction, string> {
  const out = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, unknown>;
    for (const s of KEY_SPECS) {
      const v = raw[s.action];
      if (typeof v === 'string' && !reservedKey(v)) out[s.action] = v;
    }
    // 1.3: the defaults moved (Map M, Crouch Shift, Run Ctrl): a control left on its default that
    // now shares a key with one you chose moves to the first letter nothing else has
    const letters = Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`);
    const clashes = (a: KeySpec, k: string) => KEY_SPECS.some((o) => o !== a && same(out[o.action], k) && clash(a.where, o.where));
    for (const s of KEY_SPECS) {
      if (typeof raw[s.action] === 'string' || !clashes(s, out[s.action])) continue;
      out[s.action] = letters.find((k) => !clashes(s, k)) ?? out[s.action];
    }
  } catch {
    /* storage blocked or corrupt: the defaults */
  }
  return out;
}

function save(): void {
  try {
    const changed = Object.fromEntries(KEY_SPECS.filter((s) => map[s.action] !== s.default).map((s) => [s.action, map[s.action]]));
    if (Object.keys(changed).length) localStorage.setItem(STORE, JSON.stringify(changed));
    else localStorage.removeItem(STORE);
  } catch {
    /* kept for this visit only */
  }
  for (const fn of listeners) fn();
}

/** Two actions that could both be wanted at one moment can't share a key. */
function clash(a: Where, b: Where): boolean {
  return a === 'both' || b === 'both' || a === b;
}

/** Either side's Shift (or Ctrl) is the same key. */
function side(k: string): string {
  return k.startsWith('Shift') ? 'Shift' : k.startsWith('Control') ? 'Control' : k;
}
function same(a: string, b: string): boolean {
  return side(a) === side(b);
}

/** An action's name and where it works. */
export function keySpec(action: KeyAction): KeySpec {
  return SPEC.get(action)!;
}

/** The key bound to an action (a KeyboardEvent.code). */
export function keyFor(action: KeyAction): string {
  return map[action];
}

/**
 * Alt or Cmd held, or Ctrl when no control has it: a shortcut of the browser's or the system's,
 * not a press of the game's. (With Ctrl bound, running, E and the rest still work while it's held.)
 */
export function modified(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return e.metaKey || e.altKey || (e.ctrlKey && !KEY_SPECS.some((s) => side(map[s.action]) === 'Control'));
}

/** Whether this key press is the action (Shift either side; the arrows for walking). */
export function isKey(e: { code: string }, action: KeyAction): boolean {
  return same(e.code, map[action]) || ALSO[action] === e.code;
}

/** Whether a set of held key codes has the action's key down. */
export function held(keys: ReadonlySet<string>, action: KeyAction): boolean {
  const k = map[action];
  if (keys.has(k) || keys.has(ALSO[action] ?? '')) return true;
  const both = side(k);
  return both !== k && (keys.has(`${both}Left`) || keys.has(`${both}Right`));
}

/** Whether `code` is free for `action`: nothing it could clash with has it. */
function freeFor(action: KeyAction, code: string): boolean {
  const where = SPEC.get(action)!.where;
  return KEY_SPECS.every((s) => s.action === action || !same(map[s.action], code) || !clash(where, s.where));
}

/**
 * Bind `code` to `action`. The control that had it (where the two could clash) swaps onto
 * `action`'s old key; anything that swap doubles up moves on to its own default or the first free
 * letter, and so on down the chain, each control settled once, until nothing shares. Returns the
 * controls that moved, or false for a key that can't be used.
 */
export function bindKey(action: KeyAction, code: string): KeyAction[] | false {
  if (reservedKey(code)) return false;
  const old = map[action];
  map[action] = code;
  const moved: KeyAction[] = [];
  const settled = new Set<KeyAction>([action]);
  const letters = Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`);
  const clashesWithSettled = (a: KeyAction, k: string) => [...settled].some((s) => s !== a && same(map[s], k) && clash(SPEC.get(s)!.where, SPEC.get(a)!.where));
  for (;;) {
    const bump = KEY_SPECS.find((s) => !settled.has(s.action) && !freeFor(s.action, map[s.action]));
    if (!bump) break;
    // the first gets the old key (a swap); the rest a key none of the settled ones clash with
    const next = moved.length === 0 ? old : [bump.default, ...letters].find((k) => !clashesWithSettled(bump.action, k) && freeFor(bump.action, k)) ?? old;
    map[bump.action] = next;
    settled.add(bump.action);
    moved.push(bump.action);
  }
  save();
  return moved;
}

export function resetKeys(): void {
  map = defaults();
  save();
}

export function customised(): boolean {
  return KEY_SPECS.some((s) => map[s.action] !== s.default);
}

/** Hear any change to the bindings (the help, the prompts' keycaps). */
export function onKeysChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const NAMES: Record<string, string> = {
  Space: 'Space',
  ShiftLeft: '⇧',
  ShiftRight: '⇧',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  Backspace: '⌫',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Delete: 'Del',
  Insert: 'Ins',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

/** How a key code reads on a keycap: "W", "Space", "⇧", "[", "Num 5". */
export function keyName(code: string): string {
  if (NAMES[code]) return NAMES[code]!;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

/** The keycap for an action now. */
export function keyLabel(action: KeyAction): string {
  return keyName(map[action]);
}

/** Run `paint` now and whenever the bindings change (a title or keycap naming a key). */
export function keyed(paint: () => void): () => void {
  paint();
  return onKeysChange(paint);
}

// 1.3: running with Ctrl on Windows and Linux, W is one slip from Ctrl+W, which closes the tab and
// can't be stopped: while Ctrl is held for a control, the browser asks before the page goes.
if (typeof addEventListener === 'function' && !/Mac|iPhone|iPad/.test(navigator.platform)) {
  let ctrlDown = false;
  addEventListener('keydown', (e) => (ctrlDown = e.ctrlKey), true);
  addEventListener('keyup', (e) => (ctrlDown = e.ctrlKey), true);
  addEventListener('blur', () => (ctrlDown = false));
  addEventListener('beforeunload', (e) => {
    if (ctrlDown && KEY_SPECS.some((s) => side(map[s.action]) === 'Control')) e.preventDefault();
  });
}
