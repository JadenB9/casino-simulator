// One House Originals page, as every game on the lounge's computers shares it: the screen on the
// monitor, the cashier by the chips, the bet box for the table's limits, the board's top row (the
// last round's result and the recent results), the main button with its key, auto-bet where the
// game has it, the Tips line and the session tally. A game builds its board and its own choices
// into it and says when a round has played out; the site keeps everything else the same in all
// twelve, so a player who knows one page knows them all.
//
// The bet panel, top to bottom (flat on a phone, the main button comes up under the bet):
//   .os-modes      Manual or Auto (games with auto-bet)
//   .os-bet-slot   the bet box, rebuilt when the table's limits change
//   .os-controls   the game's own choices (risk, rows, segments, the call...)
//   main button    Bet / Drop / Roll / Cash out; Start or Stop autobet in Auto
//   .os-extras     the game's other buttons (Random pick, Skip, the guesses...)
//   .os-auto       auto-bet's settings, in Auto
//   .os-facts      the game's facts (the return, the odds, the last bets), in Manual
//   .os-tally      this session

import type { TableSnapshot, TableViewCtx, SeatMsg } from '../contract.ts';
import { formatMoney, type BetLimits, type Cents } from '../../../../shared/src/money.ts';
import { celebrate } from '../../table/celebrate.ts';
import { el } from '../../ui/kit.ts';
import { pcScreenCorners } from './pc.ts';
import { AddChips, BetBox, OnlineScreen, ResultStrip, RoundResult, SessionTally, actionButton, commitTyping, paintButton, resultTone, winTier } from './screen.ts';
import { AutoControl } from './autopanel.ts';
import type { PlayFn } from './auto.ts';

export interface SiteOptions {
  /** Which game (auto-bet remembers its stops per game). */
  game: string;
  title: string;
  /** The bet box's label: "Bet", "Case price". */
  betLabel?: string;
  /** The main button's first words and what it does in Manual (the game repaints it as it goes). */
  action: string;
  primary: () => void;
  /** The game's redraw of its buttons and choices (after Manual/Auto or a run changes). */
  sync: () => void;
  /** The bet changed (typed, ½, 2×, Max, or brought down to the chips here); sync by default. */
  onBet?: () => void;
  /** Auto-bet, for a game where it fits: the beat between bets and the game's own Bet. */
  auto?: { gapMs: number; answerMs?: number; play: PlayFn };
  /** How many recent results the top row holds. */
  history?: number;
}

export interface Settled {
  bet: Cents;
  payout: Cents;
  /** The round's multiplier, hundredths (null where there's no one number). */
  mult: number | null;
  /** The pill in the recent results (defaults to the multiplier). */
  pill?: string;
  /** A colour for the pill's edge (Plinko's bin, a case item's rarity). */
  accent?: string;
  /** The celebration's words, for a win big enough for one. */
  moment?: { title: string; sub: string };
  /** The site's result sound (off for a game that plays its own). */
  sound?: boolean;
  /** Counted by auto-bet as the run's bet playing out (off where the game tells it itself). */
  auto?: boolean;
  /** Pushed to the recent results (off where they're the table's, not yours: Crash's points). */
  history?: boolean;
}

export class OnlineSite {
  readonly screen: OnlineScreen;
  readonly cashier: AddChips;
  readonly history: ResultStrip;
  readonly result = new RoundResult();
  readonly tally = new SessionTally();
  /** The page's main button: the game's action in Manual, Start or Stop autobet in Auto. */
  readonly main: HTMLButtonElement;
  readonly controls = el('div', 'os-controls');
  readonly extras = el('div', 'os-extras');
  readonly facts = el('div', 'os-facts');
  readonly auto: AutoControl | null;
  bet: BetBox | null = null;
  limits: BetLimits | null = null;
  private readonly betSlot = el('div', 'os-bet-slot');
  private foot: Parameters<BetBox['setFoot']>[0] = null;
  private readonly corners = pcScreenCorners();

  constructor(
    private readonly ctx: TableViewCtx,
    private readonly o: SiteOptions,
  ) {
    this.screen = new OnlineScreen(o.title);
    ctx.ui.append(this.screen.root);
    this.cashier = new AddChips(this.screen, ctx);
    this.history = new ResultStrip(o.history ?? 9);
    this.screen.head.append(this.result.root, this.history.root);
    this.main = actionButton(o.action, () => this.press(), 'go', 'Space');
    this.main.classList.add('os-fixed', 'os-main-btn');
    this.auto = o.auto
      ? new AutoControl({
          game: o.game,
          gapMs: o.auto.gapMs,
          answerMs: o.auto.answerMs,
          play: o.auto.play,
          bet: () => this.bet?.value ?? this.limits?.min ?? 0,
          changed: () => o.sync(),
          say: (text) => ctx.kit.toast(text, 'info'),
        })
      : null;
    const side = this.screen.side;
    if (this.auto) side.append(this.auto.modes.root);
    side.append(this.betSlot, this.controls, this.main, this.extras);
    if (this.auto) side.append(this.auto.block);
    side.append(this.facts, this.tally.root);
  }

  /** Auto is chosen and a run is going: the game's choices and the bet stay as they are. */
  get locked(): boolean {
    return this.auto?.running ?? false;
  }

  /** Auto is chosen (running or not). */
  get autoOn(): boolean {
    return this.auto?.on ?? false;
  }

  /**
   * A round is live on the page (a climb, a board, a streak): between runs in Auto the main button
   * is the round's own (Cash out), so a run stopped mid-round can still be finished by hand.
   */
  midRound = false;

  /** Auto paints and presses the main button now (a run going, or Auto chosen between rounds). */
  private get autoButton(): boolean {
    const a = this.auto;
    return !!a && a.on && (a.running || !this.midRound);
  }

  /** The main button (or Space): the game's action in Manual, start or stop a run in Auto. */
  press(): void {
    commitTyping(this.screen.root);
    if (this.autoButton) this.auto!.toggle();
    else this.o.primary();
  }

  /**
   * Paint the main button: the game's own words for Manual; in Auto, Start autobet (enabled when
   * `ready`: the bet is one the chips cover) or Stop autobet with the count. The facts give way to
   * the auto settings while Auto is chosen.
   */
  paintMain(label: string, kind: 'go' | 'cash' | 'plain', disabled: boolean, ready = !disabled): void {
    const a = this.auto;
    if (a && this.autoButton) {
      const l = a.label();
      paintButton(this.main, l.text, l.kind, !a.running && !ready);
    } else paintButton(this.main, label, kind, disabled);
    const autoShown = a?.on ?? false;
    if (this.facts.hidden !== autoShown) this.facts.hidden = autoShown;
  }

  /** From the view's onTable: the cashier, the bet box for these limits; a run going stops. */
  table(snap: TableSnapshot): BetBox {
    this.cashier.table(snap);
    this.auto?.driver.reset();
    const lim = snap.meta.config.limits.default;
    if (!this.bet || !this.limits || lim.min !== this.limits.min || lim.max !== this.limits.max || lim.step !== this.limits.step) {
      this.limits = lim;
      // a change of bet redraws the game (its sync may bring the bet down to the chips again:
      // BetBox calls back only for a real change, so that settles at once)
      this.bet = new BetBox({
        label: this.o.betLabel ?? 'Bet',
        min: lim.min,
        max: lim.max,
        step: lim.step,
        value: lim.min,
        onChange: () => {
          this.auto?.refresh();
          (this.o.onBet ?? this.o.sync)();
        },
      });
      this.betSlot.replaceChildren(this.bet.root);
      this.bet.setFoot(this.foot);
    }
    return this.bet;
  }

  /**
   * The line under the bet, the same in every game: what a win of this bet makes (or the top pay,
   * where a round pays many ways), with the multiplier and the chance as its note.
   */
  profit(label: string, profit: Cents | null, note = ''): void {
    this.foot = { label, value: profit === null ? '—' : formatMoney(profit, { sign: true }), note, tone: profit !== null && profit > 0 ? 'win' : null };
    this.bet?.setFoot(this.foot);
  }

  seat(msg: SeatMsg): void {
    this.cashier.seat(msg);
  }

  /** The table turned something down: the cashier forgets a top-up, a run stops. */
  error(msg = ''): void {
    this.cashier.refused();
    this.auto?.driver.refused(msg);
  }

  /** A round has played out on the page: the result, the history, the tally, the sound, a moment. */
  settle(r: Settled): void {
    this.result.show(r.bet, r.payout, r.mult);
    if (r.history !== false) this.history.push(r.pill ?? (r.mult === null ? '—' : multPill(r.mult)), r.payout > r.bet, true, r.accent);
    this.tally.add(r.bet, r.payout);
    if (r.sound !== false) resultTone(this.ctx.sfx, r.payout, r.bet);
    const tier = winTier(r.payout, r.bet);
    if (tier && r.moment) celebrate({ stage: this.ctx.stage, ui: this.ctx.ui, sfx: this.ctx.sfx }, { ...r.moment, tier });
    if (r.auto !== false) this.auto?.driver.settled(r.bet, r.payout);
  }

  /** The Tips line: the game's advice while Tips is on, cleared (once) when it isn't. */
  tip(text: string | null): void {
    if (text === this.tipText) return;
    this.tipText = text;
    this.ctx.kit.tip(text);
  }

  private tipText: string | null = null;

  /** From the view's update(): the page follows the glass; auto-bet's clock runs. */
  update(dt: number): void {
    this.auto?.update(dt);
    const camera = this.ctx.stage.engine.camera;
    camera.updateMatrixWorld();
    this.ctx.stage.root.updateWorldMatrix(true, false);
    this.screen.follow(this.ctx.stage.root, camera, this.corners);
  }

  dispose(): void {
    this.auto?.dispose();
    this.tip(null);
    this.screen.dispose();
  }
}

/** A multiplier as a history pill: 2.47×, 1,000×, 0.20×. */
export function multPill(m: number): string {
  const x = m / 100;
  return `${x.toLocaleString('en-US', { minimumFractionDigits: x >= 1000 ? 0 : 2, maximumFractionDigits: 2 })}×`;
}
