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

/** Dollars typed into a field, as cents; NaN when it isn't a whole number of dollars. */
function dollarsIn(input: HTMLInputElement): Cents {
  const text = input.value.replace(/[\s,$]/g, '');
  return /^\d{1,9}$/.test(text) ? Number(text) * 100 : NaN;
}

export class LimitsPicker {
  readonly root = el('div', 'lim');
  private readonly spec: LimitSpec;
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
  ) {
    this.spec = limitSpec(game)!;
    const blinds = this.spec.kind === 'blinds';
    const saved = remembered(game);
    const tiers = this.spec.tiers;
    const at = saved ? tiers.findIndex((t) => sameLimits(t, saved)) : this.spec.standard;
    this.pick = at >= 0 ? at : tiers.length;
    this.customLimits = saved ?? standardLimits(game)!;

    const head = el('div', 'lim-head');
    head.append(el('span', 'label', blinds ? 'Blinds' : 'Table limits'), this.buyIn);
    this.grid.setAttribute('role', 'radiogroup');
    this.grid.setAttribute('aria-label', blinds ? 'Blinds' : 'Table limits');
    this.grid.classList.toggle('wide', tiers.length + 1 > 6);
    tiers.forEach((t, i) => this.grid.append(this.option(i, t.name || limitsLabel(game, t), t.name ? limitsLabel(game, t, true) : '')));
    this.grid.append(this.option(tiers.length, 'Custom', 'Your own'));

    // Custom: two amounts in whole dollars, and the rule they have to meet.
    for (const [input, label] of [
      [this.minInput, blinds ? 'Small blind' : 'Minimum'],
      [this.maxInput, blinds ? 'Big blind' : 'Maximum'],
    ] as const) {
      input.type = 'text';
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('aria-label', `${label} in dollars`);
      input.addEventListener('input', () => this.typed());
      const field = el('label', 'lim-field');
      field.append(el('span', 'lim-field-name', label), el('span', 'lim-sign', '$'), input);
      this.custom.append(field);
    }
    this.minInput.value = String(this.customLimits.min / 100);
    this.maxInput.value = String(this.customLimits.max / 100);
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

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The picked limits are being used: remember them for next time. */
  commit(): void {
    const v = this.value;
    if (v) remember(this.game, v);
  }

  /** Arrow keys: the next or previous option, wrapping round. */
  step(dir: 1 | -1): void {
    const n = this.spec.tiers.length + 1;
    this.select((this.pick + dir + n) % n, true);
  }

  private option(i: number, name: string, range: string): HTMLButtonElement {
    const b = el('button', 'lim-opt');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.append(el('span', 'lim-opt-name', name));
    if (range) b.append(el('span', 'lim-opt-range', range));
    b.addEventListener('click', () => this.select(i, false));
    this.buttons.push(b);
    return b;
  }

  private select(i: number, focus: boolean): void {
    if (i === this.pick) return;
    this.pick = i;
    this.render();
    if (focus) this.buttons[i]?.focus({ preventScroll: true });
    if (i === this.spec.tiers.length && !focus) this.minInput.focus();
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
      const problem = Number.isNaN(this.customLimits.min) || Number.isNaN(this.customLimits.max) ? 'Whole dollars only.' : limitsProblem(this.game, this.customLimits);
      this.rule.textContent = problem ?? this.ruleText();
      this.rule.classList.toggle('bad', !!problem);
      const optRange = this.buttons[this.spec.tiers.length]!.querySelector('.lim-opt-range');
      if (optRange) optRange.textContent = v ? limitsLabel(this.game, v, true) : 'Your own';
    }
    if (!v) {
      this.buyIn.textContent = '';
      this.detail.textContent = '';
      return;
    }
    const cfg = applyLimits(ENGINES[this.game].config(this.variant, 'multi'), v);
    const lines = limitsDetail(cfg);
    this.buyIn.textContent = lines.pop()!;
    this.detail.textContent = lines.join(' · ');
    this.detail.hidden = lines.length === 0;
  }

  /** The custom rule in words, for this minimum: "Minimum $1 to $5,000. Maximum $250 to $50,000." */
  private ruleText(): string {
    const { low, high } = this.spec.min;
    const min = this.customLimits.min;
    const r = maxRange(this.spec, Number.isFinite(min) && min >= low && min <= high ? min : low);
    if (this.spec.kind === 'blinds') return `Small blind ${formatMoney(low)} to ${formatMoney(high)}; big blind two to three times it, up to ${formatMoney(this.spec.max.ceiling)}.`;
    return `Minimum ${formatMoney(low)} to ${formatMoney(high)}. Maximum ${formatMoney(r.low)} to ${formatMoney(r.high)}.`;
  }
}
