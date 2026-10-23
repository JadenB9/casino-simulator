// Crash on the lounge computers (docs/rules/online-games.md §8): the desk as it stands on the
// floor, and the website on its monitor. The table runs its own rounds from its first seat: a
// betting window, the flight, the crash. The page draws the curve from the server's launch time
// on the server's clock (so every screen at the table shows the same multiplier) and knows the
// crash point only when the crash arrives. A cash-out is judged by the server at the moment it
// gets there. Everyone's bets and cash-outs show in the table beside the graph.
//
// Auto: a bet in every round's betting window, each with the auto cash-out (a run turns it on),
// until one of its stops; the bet is the same one the button places.

import './crash.css';
import type { GameClientModule, TableView } from '../contract.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { CAP, MIN_AUTO, MAX_AUTO, timeTo, multAt } from '../../../../shared/src/games/crash/rules.ts';
import { BETTING_MS, type CrashView, type CrashViewBet } from '../../../../shared/src/games/crash/engine.ts';
import { serverNow } from '../../net/clock.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { NumberField, SegChoice, InfoList, PlayersTable, OutcomePop, labelled, siteTone, shortTone, drawSiteBar, drawAttractPanel, multText, pctText } from '../online/screen.ts';
import { OnlineSite } from '../online/site.ts';
import { CrashGraph } from './graph.ts';

/** The chair's trim on the floor: Crash's sky blue. */
const ACCENT = '#39a0ff';
/** A run's bet goes only while this much of the window is left (it must reach the table in time). */
const WINDOW_SPARE_MS = 700;

/** The monitor on the floor: the site's bar, a curve with its rocket, and the multiplier. */
function drawAttract(g: CanvasRenderingContext2D, w: number, h: number): void {
  const top = drawSiteBar(g, w, 'Crash');
  const left = drawAttractPanel(g, top, h, [['Bet', '$10.00'], ['Cash out at', '2.00×']], 'Bet');

  // The graph: axes, the curve with its glow, the rocket, the multiplier.
  g.textAlign = 'center';
  const x0 = left + 30;
  const y0 = h - 26;
  const x1 = w - 24;
  const y1 = top + 26;
  g.strokeStyle = '#2f4553';
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = y0 - ((y0 - y1) * i) / 3;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
  }
  const pts: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const k = i / 40;
    pts.push([x0 + (x1 - x0 - 40) * k, y0 - (y0 - y1 - 30) * ((Math.exp(2.2 * k) - 1) / (Math.exp(2.2) - 1))]);
  }
  const grad = g.createLinearGradient(0, y1, 0, y0);
  grad.addColorStop(0, 'rgba(255, 176, 32, 0.35)');
  grad.addColorStop(1, 'rgba(255, 176, 32, 0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(x0, y0);
  for (const [x, y] of pts) g.lineTo(x, y);
  g.lineTo(pts[pts.length - 1]![0], y0);
  g.fill();
  g.strokeStyle = '#ffb020';
  g.lineWidth = 4;
  g.shadowColor = '#ffb020';
  g.shadowBlur = 10;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.shadowBlur = 0;
  const [tx, ty] = pts[pts.length - 1]!;
  g.fillStyle = '#eef3f8';
  g.beginPath();
  g.ellipse(tx, ty, 13, 6, -0.9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#eef3f8';
  g.font = '700 54px system-ui, sans-serif';
  g.fillText('2.47×', (x0 + x1) / 2 - 30, top + 96);
  g.textAlign = 'left';
}

export const crash: GameClientModule = {
  game: 'crash',
  footprint: PC_FOOTPRINT,
  createModel: () => pcModel({ attract: attractTexture(drawAttract), accent: ACCENT }),
  seats: () => [{ position: PC_SEAT, yaw: Math.PI }],
  playPose: () => pcPose(),

  mount(ctx): TableView {
    let view: CrashView | null = null;
    let mySeat: number | null = null;
    let stack: Cents = 0;
    /** An action of ours is on its way; `sentAt` lets a lost one stop holding the button. */
    let busy = false;
    let sentAt = 0;
    /** A bet to place as soon as the next window opens. */
    let queued = false;
    let autoOn = false;
    let autoAt = 200;
    /** The betting window's length as last announced (a full window, or the short one once everyone is in). */
    let windowMs = BETTING_MS;
    /** Rounds already counted in the session tally. */
    let tallied = -1;
    let lastWhole = 1;
    let shown = { mult: '', sub: '', cls: '', bar: -1, round: '' };
    let tone = '';

    const site = new OnlineSite(ctx, {
      game: 'crash',
      title: 'Crash',
      action: 'Bet',
      history: 12,
      primary: () => primary(),
      sync: () => sync(),
      // A run bets in each window (with the auto cash-out on) once the last round has settled.
      auto: {
        gapMs: 0,
        play: () => {
          const bet = site.bet;
          if (!bet || busy || !view || mine()) return false;
          if (view.phase !== 'betting' || !view.deadline || view.deadline - serverNow() < WINDOW_SPARE_MS) return false;
          if (bet.value > stack) return 'not enough chips here for the next round';
          act({ type: 'bet', amount: bet.value, auto: autoAt });
          return true;
        },
      },
    });
    const screen = site.screen;
    site.history.root.classList.add('cs-history');

    // --- the board (the recent crash points are the site's top row)
    const board = el('div', 'cs-board');
    const graphBox = el('div', 'cs-graph');
    const graph = new CrashGraph();
    const roundLabel = el('span', 'cs-round');
    const multEl = el('div', 'cs-mult');
    const subEl = el('div', 'cs-sub');
    const bar = el('div', 'cs-bar');
    const barFill = el('div', 'cs-bar-fill');
    bar.append(barFill);
    const overlay = el('div', 'cs-overlay');
    overlay.append(multEl, subEl, bar);
    graphBox.append(graph.canvas, roundLabel, overlay);
    const pop = new OutcomePop(graphBox);
    const players = new PlayersTable();
    players.root.classList.add('cs-players');
    const body = el('div', 'cs-body');
    body.append(graphBox, players.root);
    board.append(body);
    screen.main.append(board);
    // The graph's box is a fixed part of the page: measured when it changes size, never per frame.
    let box = { w: 0, h: 0 };
    const measure = () => (box = { w: graphBox.offsetWidth, h: graphBox.offsetHeight });
    const resize = new ResizeObserver(measure);
    resize.observe(graphBox);

    // --- the panel
    const autoField = new NumberField({
      label: 'Cash out at',
      suffix: '×',
      format: (x) => (x / 100).toFixed(2),
      value: autoAt,
      onCommit: (typed) => {
        autoAt = Math.min(MAX_AUTO, Math.max(MIN_AUTO, Math.round(typed * 100)));
        autoField.set(autoAt);
        sync();
      },
    });
    const autoSeg = new SegChoice(
      [
        { value: 'off', label: 'By hand', title: 'Cash out with the button (Space)' },
        { value: 'on', label: 'Auto cash-out' },
      ],
      'off',
      (v) => {
        autoOn = v === 'on';
        sync();
      },
    ).label('Cash out');
    site.controls.append(labelled('Cash out', autoSeg.root), autoField.root);
    const info = new InfoList('This bet');
    site.facts.append(info.root);

    const mine = (): CrashViewBet | null => (view && mySeat !== null ? view.bets.find((b) => b.seat === mySeat) ?? null : null);
    const riding = () => view?.phase === 'running' && mine()?.cashed === null;
    // a run always cashes out on its own
    const target = () => (autoOn || site.autoOn ? autoAt : null);

    const act = (a: object) => {
      if (busy) return;
      busy = true;
      sentAt = performance.now();
      ctx.link.act(a);
      site.auto?.driver.asked();
      sync();
    };

    const placeBet = () => {
      const bet = site.bet;
      if (!bet) return;
      if (bet.value > stack) {
        shortTone(ctx.sfx);
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      act({ type: 'bet', amount: bet.value, auto: target() });
    };

    const primary = () => {
      const phase = view?.phase;
      const b = mine();
      if (phase === 'betting') {
        if (b) act({ type: 'cancel' });
        else placeBet();
        return;
      }
      if (riding()) {
        act({ type: 'cashout' });
        return;
      }
      // In the air without a bet, or between rounds: bet on the next one.
      queued = !queued;
      siteTone(ctx.sfx, queued ? 660 : 440, 50, { type: 'triangle', gain: 0.03 });
      sync();
    };

    /** The multiplier on show now, hundredths, and the flight time. */
    const now = (): { t: number; mult: number } => {
      if (!view || view.launchAt === null) return { t: 0, mult: 100 };
      if (view.phase === 'crashed' && view.crash !== null) return { t: timeTo(view.crash), mult: view.crash };
      const t = Math.max(0, serverNow() - view.launchAt);
      return { t, mult: Math.min(CAP, multAt(t)) };
    };

    const rows = () =>
      (view?.bets ?? []).map((b) => ({ name: b.name, bet: b.amount, cashed: b.cashed, payout: b.payout, busted: b.busted, you: b.seat === mySeat }));

    const sync = () => {
      const v = view;
      const b = mine();
      const phase = v?.phase ?? 'idle';
      const locked = site.locked;
      // a round with our bet in it is live on the page (Cash out is the button between runs)
      site.midRound = !!b && (phase === 'betting' || riding());
      screen.setStack(stack);
      site.bet?.setMax(stack);
      site.bet?.setEnabled(!busy && !(phase === 'betting' && b) && !locked);
      // Auto bets always cash out on their own: the choice waits on it
      if (site.autoOn && !autoOn) {
        autoOn = true;
        autoSeg.set('on');
      }
      autoSeg.setEnabled(!(phase === 'betting' && b) && !riding() && !site.autoOn);
      autoField.setEnabled(autoOn && !(phase === 'betting' && b) && !riding() && !locked);
      autoField.root.classList.toggle('cs-off', !autoOn);
      site.auto?.setEnabled(!busy && !b);
      if (v) {
        players.set(rows());
        const round = v.round > 0 ? `Round ${v.round.toLocaleString('en-US')}` : '';
        if (round !== shown.round) roundLabel.textContent = shown.round = round;
      }
      const amount = site.bet?.value ?? 0;
      const x = target();
      if (x) site.profit(`Profit at ${multText(x)}`, (amount / 100) * x - amount, `reaches it ${pctText(0.99 / (x / 100))}`);
      else site.profit('Profit', null, 'cash out by hand');
      info.set('auto', 'Auto cash-out', x ? `${multText(x)} · ${formatMoney((amount / 100) * x - amount, { sign: true })}` : 'Off: cash out by hand');
      info.set('odds', x ? `Reaches ${multText(x)}` : 'Reaches 2.00×', pctText(0.99 / ((x ?? 200) / 100)));
      info.set('ret', 'Return', '99.00% at any point');
      const lim = site.limits;
      const limText = lim ? ` · Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}` : '';
      screen.setNote(`The multiplier gets past x with chance 0.99 ÷ x; 1 round in 100 ends at 1.00× · Return 99.00% on every cash-out${limText} · Space bets and cashes out`);
      tipFor();
      frame(true);
    };

    // Tips: nothing is better than anything else here, and saying so is the advice: every
    // target returns exactly 99%, a lower one just wins more often, and timing a click adds nothing.
    const tipFor = () => {
      const x = target() ?? 200;
      site.tip(ctx.tips.on ? `Every cash-out point returns exactly 99%: ${multText(x)} wins ${pctText(0.99 / (x / 100))} of rounds. Watching the curve can't tell you when it crashes.` : null);
    };
    const offTips = ctx.tips.subscribe(tipFor);

    /** Draw the graph and refresh the texts that move with it (only when they change). */
    const frame = (force = false) => {
      graph.resize(box.w, box.h);
      const phase = view?.phase ?? 'idle';
      const { t, mult } = now();
      let windowLeft = 0;
      if (phase === 'betting' && view?.deadline) windowLeft = Math.max(0, view.deadline - serverNow());
      graph.draw({ phase, t, mult, window: windowMs ? windowLeft / windowMs : 0 });

      let big = multText(mult);
      let sub = '';
      const cls = phase;
      if (phase === 'betting') {
        big = `${(windowLeft / 1000).toFixed(1)}s`;
        sub = 'Next round in';
      } else if (phase === 'crashed') sub = 'Crashed';
      else if (phase === 'idle') {
        big = '—';
        sub = 'Waiting for players';
      }
      if (force || big !== shown.mult || sub !== shown.sub || cls !== shown.cls) {
        multEl.textContent = big;
        subEl.textContent = sub;
        overlay.className = `cs-overlay ${cls}`;
        shown = { ...shown, mult: big, sub, cls };
      }
      // the window's bar empties by transform, written only when it moves
      const fill = phase === 'betting' ? Math.min(1, windowLeft / windowMs) : 0;
      const q = Math.round(fill * 400) / 400;
      if (q !== shown.bar) {
        barFill.style.transform = `scaleX(${q})`;
        shown.bar = q;
      }
      if (bar.hidden !== (phase !== 'betting')) bar.hidden = phase !== 'betting';
      // the climbing number warms through the multiples
      const heat = phase === 'running' ? (mult >= 1000 ? 'hot' : mult >= 300 ? 'warm' : '') : '';
      if (heat !== tone) {
        multEl.classList.toggle('warm', heat === 'warm');
        multEl.classList.toggle('hot', heat === 'hot');
        tone = heat;
      }

      // The main button follows the round.
      const b = mine();
      let label: string;
      let kind: 'go' | 'cash' | 'plain';
      let disabled = busy;
      if (phase === 'betting') {
        label = b ? 'Cancel bet' : 'Bet';
        kind = b ? 'plain' : 'go';
        if (!b && (!site.bet || site.bet.value > stack)) disabled = true;
      } else if (riding() && b) {
        label = `Cash out ${formatMoney((b.amount / 100) * mult)}`;
        kind = 'cash';
        // a run's bet cashes out at its target; Stop autobet first to take it by hand
        if (site.locked) disabled = true;
      } else {
        label = queued ? 'Cancel next bet' : 'Bet next round';
        kind = queued ? 'plain' : 'go';
        disabled = busy || (!queued && (!site.bet || site.bet.value > stack));
      }
      site.paintMain(label, kind, disabled, !!site.bet && site.bet.value <= stack);

      // A soft tick as the curve passes each whole multiplier.
      if (phase === 'running') {
        const whole = Math.floor(mult / 100);
        if (whole > lastWhole) siteTone(ctx.sfx, 520 + Math.min(whole, 12) * 60, 70, { type: 'sine', gain: 0.03 });
        lastWhole = whole;
      } else lastWhole = 1;
    };

    const onCashout = (e: GameEvent) => {
      if (e.seat !== mySeat) {
        siteTone(ctx.sfx, 1320, 40, { type: 'sine', gain: 0.015 });
        return;
      }
      const payout = Number(e.payout);
      const amount = Number(e.amount);
      const at = Number(e.at);
      tallied = view?.round ?? tallied;
      pop.show(at, payout, amount, 2600);
      ctx.sfx.play('chips-stack', { volume: 0.6 });
      site.settle({
        bet: amount,
        payout,
        mult: at,
        history: false,
        moment: { title: `Cashed out at ${multText(at)}`, sub: `Pays ${formatMoney(payout)} on ${formatMoney(amount)}` },
      });
    };

    const onCrash = (e: GameEvent, before: CrashView | null) => {
      graph.explode();
      site.history.push(multText(Number(e.crash)), Number(e.crash) >= 200);
      siteTone(ctx.sfx, 170, 520, { type: 'sawtooth', gain: 0.06, to: 38 });
      siteTone(ctx.sfx, 55, 400, { gain: 0.14 });
      const mineThen = before?.bets.find((b) => b.seat === mySeat && b.cashed === null);
      if (mineThen && (e.busted as number[]).includes(mySeat ?? -1) && tallied !== Number(e.round)) {
        tallied = Number(e.round);
        site.settle({ bet: mineThen.amount, payout: 0, mult: 0, history: false, sound: false });
      }
    };

    const load = (v: CrashView) => {
      view = v;
      site.history.clear();
      for (const c of [...v.history].reverse()) site.history.push(multText(c), c >= 200, false);
      if (v.phase === 'crashed') graph.explode();
    };

    return {
      onTable(snap) {
        // Back after a drop: a bet the table settled meanwhile (its auto cash-out, or the crash)
        // counts in this session's tally like one seen live. Still on show, it says what it paid;
        // rounds later, what the stack gained while we were away is what it paid.
        const back = snap.view as CrashView;
        const was = view;
        const left = was && mySeat !== null && (was.phase === 'betting' || was.phase === 'running') ? was.bets.find((b) => b.seat === mySeat && b.cashed === null) : undefined;
        if (was && left && snap.you.status === 'seated' && tallied !== was.round) {
          const shownBet = back.round === was.round ? back.bets.find((b) => b.seat === mySeat) : undefined;
          if (shownBet && (shownBet.cashed !== null || shownBet.busted)) {
            site.tally.add(shownBet.amount, shownBet.payout);
            tallied = was.round;
          } else if (back.round > was.round) {
            site.tally.add(left.amount, Math.max(0, snap.you.stack - stack));
            tallied = was.round;
          }
        }
        stack = snap.you.stack;
        mySeat = snap.you.status === 'watching' ? null : snap.you.seat;
        busy = false;
        site.table(snap);
        pop.hide();
        load(back);
        windowMs = BETTING_MS;
        sync();
      },

      onEvents(events, v) {
        const before = view;
        const next = v as CrashView;
        view = next;
        // Our answer is an event about our seat (or the phase moving on); other players' bets
        // arriving in the meantime don't free the button.
        if (events.some((e) => e.seat === mySeat || e.type === 'betting' || e.type === 'crash' || e.type === 'launch')) {
          busy = false;
          site.auto?.driver.answered();
        }
        for (const e of events) {
          switch (e.type) {
            case 'betting':
              graph.clearBurst();
              pop.hide();
              windowMs = BETTING_MS;
              if (queued && !site.autoOn) {
                queued = false;
                sync();
                placeBet();
              }
              break;
            case 'closing':
              if (typeof e.deadline === 'number') windowMs = Math.max(1, Math.min(BETTING_MS, (e.deadline as number) - serverNow()));
              break;
            case 'bet':
              if (e.seat === mySeat) ctx.sfx.play('chip-lay', { volume: 0.6 });
              else siteTone(ctx.sfx, 900, 30, { type: 'triangle', gain: 0.015 });
              break;
            case 'launch':
              siteTone(ctx.sfx, 220, 700, { type: 'sine', gain: 0.05, to: 660 });
              break;
            case 'cashout':
              onCashout(e);
              break;
            case 'crash':
              onCrash(e, before);
              break;
          }
        }
        sync();
      },

      onSeat(msg) {
        site.seat(msg);
        stack = msg.stack;
        mySeat = msg.status === 'watching' ? null : msg.seat;
        sync();
      },

      onError(_code, msg) {
        site.error(msg);
        busy = false;
        sync();
      },

      keydown(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        if (e.code === 'Space') {
          if (!e.repeat) site.press();
          return true;
        }
        return false;
      },

      update(dt) {
        if (busy && performance.now() - sentAt > 5_000) busy = false;
        frame();
        site.update(dt);
      },

      dispose() {
        resize.disconnect();
        offTips();
        pop.hide();
        site.dispose();
      },
    };
  },
};
