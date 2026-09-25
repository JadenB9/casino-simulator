// The deck's Spin and Auto buttons, wired to the spin driver (auto.ts). Spin spins once on a tap
// and keeps spinning while it's held (mouse or touch); the view sends Space here the same way.
// Auto opens a small panel of stops and starts; while it runs the button reads "Auto · 23 left"
// with Stop on it, and any key, any click at the machine, Esc, leaving, the tab going to the
// background or the idle timer (which leaves the table) stops it.

import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { el, button } from '../../ui/kit.ts';
import { holdKeyboard } from '../../ui/keyboard.ts';
import { AUTO_SPINS, SpinDriver, autoCount, type AutoStops, type SpinFn } from './auto.ts';

/** The last stops chosen, for the next machine this visit. */
let remembered: AutoStops = { spins: 25, below: null, winOver: null, feature: true };

export interface AutoDeckOpts {
  spin: SpinFn;
  /** The deck the panel opens over, and the table's canvas and controls (clicks there stop Auto). */
  deck: HTMLElement;
  canvas: HTMLElement;
  ui: HTMLElement;
  bet(): Cents;
  seated(): boolean;
  say(text: string): void;
  /** Holding or Auto changed: the view redraws its buttons. */
  changed(): void;
}

export interface AutoDeck {
  driver: SpinDriver;
  spinBtn: HTMLButtonElement;
  autoBtn: HTMLButtonElement;
  /** A key at the machine: true when it was for Auto (it stops it) or the panel. */
  keydown(e: KeyboardEvent): boolean;
  /** This pointerdown stopped Auto: the view does nothing else with it. */
  ate(e: Event): boolean;
  /** Hold spin from a press on something else (the cabinet's own Spin button) until it lifts. */
  press(e: PointerEvent): void;
  refresh(): void;
  dispose(): void;
}

const dollars = (v: string): Cents | null => {
  const n = Number(v.replace(/[$,\s]/g, ''));
  return v.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

export function mountAutoDeck(o: AutoDeckOpts): AutoDeck {
  const driver = new SpinDriver({
    spin: o.spin,
    changed: () => {
      refresh();
      o.changed();
    },
    stopped: (why) => o.say(why ? `Auto stopped · ${why}` : 'Auto stopped'),
  });

  const spinBtn = button('Spin', () => {}, { cls: 'primary slots-spin', key: 'Space', title: 'Tap to spin, hold to keep spinning' });
  const autoBtn = button('Auto', () => toggle(), { cls: 'ghost slots-auto', title: 'Spin on its own until a stop' });
  autoBtn.setAttribute('aria-haspopup', 'dialog');

  // --- holding the Spin button (or the cabinet's): one pointer at a time, until it lifts
  let holdPointer: number | null = null;
  let eaten: Event | null = null;
  const press = (e: PointerEvent) => {
    if (e.button !== 0 || e === eaten || holdPointer !== null) return;
    holdPointer = e.pointerId;
    driver.hold(true);
  };
  const lift = (e: PointerEvent) => {
    if (e.pointerId !== holdPointer) return;
    holdPointer = null;
    driver.hold(false);
  };
  spinBtn.addEventListener('pointerdown', (e) => {
    if (spinBtn.disabled) return;
    e.preventDefault();
    press(e);
  });
  // a long press on a phone is a hold, not the page's menu
  spinBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  // Enter on the focused button: one spin (a pointer's click was its pointerdown)
  spinBtn.addEventListener('click', (e) => {
    if (e.detail === 0) o.spin();
  });
  addEventListener('pointerup', lift, true);
  addEventListener('pointercancel', lift, true);

  // --- anything at the machine stops Auto
  const onDown = (e: PointerEvent) => {
    const t = e.target as Node | null;
    if (!driver.auto || !t || pop?.root.contains(t) || autoBtn.contains(t)) return;
    if (t === o.canvas || o.ui.contains(t)) {
      eaten = e;
      driver.stop('');
    }
  };
  addEventListener('pointerdown', onDown, true);
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') driver.hold(false);
  };
  addEventListener('keyup', onKeyUp, true);
  const onBlur = () => {
    holdPointer = null;
    driver.hold(false);
  };
  addEventListener('blur', onBlur);
  const onHidden = () => {
    if (document.visibilityState === 'hidden') driver.stop('');
  };
  document.addEventListener('visibilitychange', onHidden);

  // --- the stops panel
  let pop: { root: HTMLElement; close: () => void } | null = null;
  const toggle = () => {
    if (driver.auto) driver.stop('');
    else if (pop) pop.close();
    else openPanel();
  };

  const openPanel = () => {
    const pick = { ...remembered };
    const root = el('div', 'slots-auto-pop panel');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Auto spins');
    root.append(el('div', 'slots-auto-head', 'Auto spins'));

    const seg = el('div', 'slots-auto-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Spins');
    const segBtns = AUTO_SPINS.map((n) => {
      const b = button(n === null ? '∞' : String(n), () => {
        pick.spins = n;
        paint();
      });
      b.setAttribute('role', 'radio');
      if (n === null) b.title = 'Until something stops it';
      return b;
    });
    seg.append(...segBtns);
    root.append(row('Spins', seg));

    const money = (v: Cents | null) => {
      const i = el('input') as HTMLInputElement;
      i.type = 'text';
      i.inputMode = 'decimal';
      i.placeholder = 'Off';
      i.value = v === null ? '' : (v / 100).toFixed(2).replace(/\.00$/, '');
      const box = el('div', 'slots-auto-money');
      box.append(el('span', '', '$'), i);
      return { box, i };
    };
    const below = money(pick.below);
    const over = money(pick.winOver);
    root.append(row('Stop if credits fall under', below.box), row('Stop on a single win over', over.box));

    const feat = el('input') as HTMLInputElement;
    feat.type = 'checkbox';
    feat.checked = pick.feature;
    const featRow = el('label', 'slots-auto-check');
    featRow.append(feat, el('span', '', 'Stop when free games or a bonus play'));
    root.append(featRow);
    root.append(el('p', 'slots-auto-note', 'Always stops when the credits can’t cover the bet, and on any key or click at the machine.'));

    const go = button('', () => {
      remembered = { spins: pick.spins, below: dollars(below.i.value), winOver: dollars(over.i.value), feature: feat.checked };
      close();
      driver.start(remembered);
    }, { cls: 'primary slots-auto-go' });
    root.append(go);

    function paint() {
      segBtns.forEach((b, i) => {
        const on = AUTO_SPINS[i] === pick.spins;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
      go.textContent = `Start · ${pick.spins === null ? 'no limit' : `${pick.spins} spins`} at ${formatMoney(o.bet())}`;
    }
    paint();

    o.ui.append(root);
    place(root);
    autoBtn.classList.add('open');
    const release = holdKeyboard(root, () => close());
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!root.contains(t) && !autoBtn.contains(t)) close();
    };
    addEventListener('pointerdown', outside, true);
    const onResize = () => place(root);
    addEventListener('resize', onResize);
    function close() {
      if (pop?.root !== root) return;
      pop = null;
      removeEventListener('resize', onResize);
      release();
      removeEventListener('pointerdown', outside, true);
      root.remove();
      autoBtn.classList.remove('open');
    }
    pop = { root, close };
    segBtns[AUTO_SPINS.indexOf(pick.spins)]?.focus({ preventScroll: true });
  };

  /**
   * Just over the deck. On a wide screen it stands at the window's right edge, clear of the
   * cabinet in the middle so the reels stay in view; on a narrow one, over the deck's right end.
   */
  function place(root: HTMLElement) {
    const d = o.deck.getBoundingClientRect();
    root.style.bottom = `${Math.round(innerHeight - d.top + 10)}px`;
    root.style.right = `${innerWidth >= 1000 && innerHeight > 480 ? 16 : Math.max(10, Math.round(innerWidth - d.right))}px`;
  }

  function row(label: string, control: HTMLElement): HTMLElement {
    const r = el('div', 'slots-auto-row');
    r.append(el('span', 'slots-auto-label', label), control);
    return r;
  }

  const refresh = () => {
    const a = driver.auto;
    autoBtn.classList.toggle('on', !!a);
    o.deck.classList.toggle('auto-on', !!a);
    autoBtn.setAttribute('aria-pressed', String(!!a));
    if (a) autoBtn.replaceChildren(el('span', 'slots-auto-word', 'Auto ·'), el('span', 'slots-auto-count', autoCount(a, driver.inFlight)), el('span', 'slots-auto-stop', 'Stop'));
    else autoBtn.replaceChildren(document.createTextNode('Auto'));
    autoBtn.disabled = !a && !o.seated();
    spinBtn.classList.toggle('held', driver.holding);
  };
  refresh();

  return {
    driver,
    spinBtn,
    autoBtn,
    keydown() {
      if (driver.auto) {
        driver.stop('');
        return true;
      }
      return false;
    },
    ate: (e) => e === eaten,
    press,
    refresh,
    dispose() {
      driver.stop(null);
      pop?.close();
      removeEventListener('pointerup', lift, true);
      removeEventListener('pointercancel', lift, true);
      removeEventListener('pointerdown', onDown, true);
      removeEventListener('keyup', onKeyUp, true);
      removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onHidden);
    },
  };
}
