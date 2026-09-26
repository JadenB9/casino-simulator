// The table limits picker in the station panel: every tier of this game at once (name and
// range), plus Custom with its two amounts. Whatever is picked here is what a solo table or a new
// lobby opens at; the last pick per game is remembered, so a regular sits down at theirs with one
// key. The server clamps every choice with the same rules (shared/src/limits.ts), and the picker
// shows those rules as it goes, so nothing the server does comes as a surprise.

import type { GameId } from '../../../../shared/src/engine.ts';
import { ENGINES } from '../../../../shared/src/games/index.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import {
  applyLimits,
  limitSpec,
  limitsDetail,
  limitsLabel,
  limitsProblem,
  maxRange,
  sameLimits,
  standardLimits,
  type LimitSpec,
  type TableLimits,
} from '../../../../shared/src/limits.ts';
import { el } from '../kit.ts';
import { session } from '../../app/session.ts';

const KEY = (game: GameId) => `casino.limits.${game}`;

function remembered(game: GameId): TableLimits | null {
  try {
    const raw = localStorage.getItem(KEY(game));
    const v = raw ? (JSON.parse(raw) as TableLimits) : null;
    return v && typeof v.min === 'number' && typeof v.max === 'number' && !limitsProblem(game, v) ? { min: v.min, max: v.max } : null;
  } catch {
    return null;
  }
}

function remember(game: GameId, l: TableLimits): void {
  try {
    localStorage.setItem(KEY(game), JSON.stringify(l));
  } catch {
    /* private window: the pick just isn't remembered */
  }
}

/** Dollars typed into a field, as cents ("25", "1,000", "0.50"); NaN when it isn't an amount. */
function dollarsIn(input: HTMLInputElement): Cents {
  const text = input.value.replace(/[\s,$]/g, '');
  return /^\d{0,9}(\.\d{1,2})?$/.test(text) && text !== '' && text !== '.' ? Math.round(Number(text) * 100) : NaN;
}

/** Cents as the fields show them: "25", "0.50". */
function dollarsOut(c: Cents): string {
  return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2);
}

export class LimitsPicker {
  readonly root = el('div', 'lim');
  private readonly spec: LimitSpec;
  private readonly title = el('span', 'label');
  private readonly grid = el('div', 'lim-grid');
  private readonly buyIn = el('span', 'lim-buyin');
  private readonly detail = el('p', 'lim-detail');
  private readonly custom = el('div', 'lim-custom');
  private readonly minInput = el('input', 'lim-input');
  private readonly maxInput = el('input', 'lim-input');
  private readonly rule = el('p', 'lim-rule');
  private readonly buttons: HTMLButtonElement[] = [];
  /** Index into the tiers, or tiers.length for Custom. */
  private pick: number;
  private customLimits: TableLimits;
  private listeners = new Set<() => void>();

  constructor(
    private readonly game: GameId,
    private readonly variant: string,
    /** `prefer`: the tier this table opens at (a high-limit room's), unless your last pick was higher still. */
    opts: { prefer?: string; salon?: boolean } = {},
  ) {
    this.spec = limitSpec(game, opts.salon)!;
    const blinds = this.spec.kind === 'blinds';
    const saved = remembered(game);
    const tiers = this.spec.tiers;
    let at = saved ? tiers.findIndex((t) => sameLimits(t, saved)) : this.spec.standard;
    // (v7.4: Hold'em's tiers are its blinds, unnamed: in the salon it opens at the second highest)
    const preferred = opts.prefer ? (blinds && opts.salon ? tiers.length - 2 : tiers.findIndex((t) => t.name === opts.prefer)) : -1;
    if (preferred >= 0 && (!saved || saved.max < tiers[preferred]!.max)) at = preferred;
    this.pick = at >= 0 ? at : tiers.length;
    this.customLimits = saved ?? standardLimits(game)!;

    const head = el('div', 'lim-head');
    this.title.textContent = blinds ? 'Blinds' : 'Table limits';
    head.append(this.title, this.buyIn);
    this.grid.setAttribute('role', 'radiogroup');
    this.grid.setAttribute('aria-label', blinds ? 'Blinds' : 'Table limits');
    // Hold'em's options are the blinds themselves, one short line each ("$1K/$2K")
    this.grid.classList.toggle('blinds', blinds);
    tiers.forEach((t, i) => this.grid.append(this.option(i, t.name || limitsLabel(game, t, true), t.name ? limitsLabel(game, t, true) : '')));
    this.grid.append(this.option(tiers.length, 'Custom', blinds ? 'Any blinds' : 'Your own'));

    // Custom: two amounts in whole dollars, and the rule they have to meet.
    for (const [input, label] of [
      [this.minInput, blinds ? 'Small blind' : 'Minimum'],
      [this.maxInput, blinds ? 'Big blind' : 'Maximum'],
    ] as const) {
      input.type = 'text';
      input.inputMode = blinds ? 'decimal' : 'numeric';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('aria-label', `${label} in dollars`);
      input.addEventListener('input', () => this.typed());
      const field = el('label', 'lim-field');
      field.append(el('span', 'lim-field-name', label), el('span', 'lim-sign', '$'), input);
      this.custom.append(field);
    }
    this.minInput.value = dollarsOut(this.customLimits.min);
    this.maxInput.value = dollarsOut(this.customLimits.max);
    this.rule.setAttribute('aria-live', 'polite');
    this.custom.append(this.rule);

    this.root.append(head, this.grid, this.custom, this.detail);
    this.render();
  }

  /** The limits picked, or null while Custom holds something the game doesn't allow. */
  get value(): TableLimits | null {
    if (this.pick < this.spec.tiers.length) {
      const t = this.spec.tiers[this.pick]!;
      return { min: t.min, max: t.max };
    }
    return limitsProblem(this.game, this.customLimits) ? null : { ...this.customLimits };
  }

  /** "$25–$5,000", or why Custom can't be used yet. */
  get label(): string {
    const v = this.value;
    return v ? limitsLabel(this.game, v) : 'Check the limits';
  }

  /** The line over the options: "Table limits" on its own, "Start a table" where it opens a lobby. */
  setTitle(text: string): void {
    this.title.textContent = text;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The picked limits are being used: remember them for next time. */
  commit(): void {
    const v = this.value;
    if (v) remember(this.game, v);
  }

  /**
   * Arrow keys: the next or previous option, wrapping round. Focus stays where it is (on Single
   * player, say), so Enter still sits down at what was just picked.
   */
  step(dir: 1 | -1): void {
    const n = this.spec.tiers.length + 1;
    this.select((this.pick + dir + n) % n, 'key');
  }

  private option(i: number, name: string, range: string): HTMLButtonElement {
    const b = el('button', 'lim-opt');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.append(el('span', 'lim-opt-name', name));
    if (range) b.append(el('span', 'lim-opt-range', range));
    b.addEventListener('click', () => this.select(i, 'click'));
    this.buttons.push(b);
    return b;
  }

  /**
   * A click on Custom goes on to its first field. An arrow key moves focus along the options
   * only if it was on one; from anywhere else focus stays put.
   */
  private select(i: number, how: 'click' | 'key'): void {
    if (i === this.pick) return;
    const inGrid = this.grid.contains(document.activeElement);
    this.pick = i;
    this.render();
    if (how === 'key' && inGrid) this.buttons[i]?.focus({ preventScroll: true });
    else if (how === 'click' && i === this.spec.tiers.length) this.minInput.focus();
    this.changed();
  }

  private typed(): void {
    this.customLimits = { min: dollarsIn(this.minInput), max: dollarsIn(this.maxInput) };
    this.render();
    this.changed();
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  private render(): void {
    const custom = this.pick === this.spec.tiers.length;
    this.buttons.forEach((b, i) => {
      b.setAttribute('aria-checked', String(i === this.pick));
      b.tabIndex = i === this.pick ? 0 : -1;
    });
    this.custom.hidden = !custom;
    const v = this.value;
    if (custom) {
      const problem = Number.isNaN(this.customLimits.min) || Number.isNaN(this.customLimits.max) ? 'Amounts in dollars, like 25 or 0.50.' : limitsProblem(this.game, this.customLimits);
      this.rule.textContent = problem ?? this.ruleText();
      this.rule.classList.toggle('bad', !!problem);
      const opt = this.buttons[this.spec.tiers.length]!;
      const optRange = opt.querySelector('.lim-opt-range');
      if (optRange) optRange.textContent = v ? limitsLabel(this.game, v, true) : this.spec.kind === 'blinds' ? 'Any blinds' : 'Your own';
      else opt.querySelector('.lim-opt-name')!.textContent = v ? limitsLabel(this.game, v, true) : 'Custom';
    }
    if (!v) {
      this.buyIn.textContent = '';
      this.detail.textContent = '';
      return;
    }
    const cfg = applyLimits(ENGINES[this.game].config(this.variant, 'multi'), v);
    const lines = limitsDetail(cfg);
    this.buyIn.textContent = lines.pop()!;
    // Said before sitting down, not after: a table whose smallest buy-in is more than the balance.
    const balance = session.profile?.balance;
    const short = balance !== undefined && balance < cfg.buyIn.min;
    this.buyIn.classList.toggle('short', short);
    this.buyIn.title = short ? `More than your balance of ${formatMoney(balance)}` : '';
    if (short) this.buyIn.textContent += ` · you have ${formatMoney(balance)}`;
    this.detail.textContent = lines.join(' · ');
    this.detail.hidden = lines.length === 0;
  }

  /** The custom rule in words, for this minimum: "Minimum $1 to $5,000. Maximum $250 to $50,000." */
  private ruleText(): string {
    const { low, high } = this.spec.min;
    const min = this.customLimits.min;
    const r = maxRange(this.spec, Number.isFinite(min) && min >= low && min <= high ? min : low);
    if (this.spec.kind === 'blinds') {
      const small = this.spec.min.fine !== undefined && low < 100 ? `${formatMoney(low)}, or whole dollars up to ${formatMoney(high)}` : `${formatMoney(low)} to ${formatMoney(high)}`;
      return `Any stakes: small blind ${small}; big blind two to three times it, in whole dollars.`;
    }
    return `Minimum ${formatMoney(low)} to ${formatMoney(high)}. Maximum ${formatMoney(r.low)} to ${formatMoney(r.high)}.`;
  }
}
