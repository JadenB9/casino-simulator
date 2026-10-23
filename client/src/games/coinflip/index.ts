// Coinflip on the lounge computers (docs/rules/online-games.md §9): the desk as it stands on the
// floor, and the website on its monitor. Bet with a call and the coin goes up; a right call pays
// 1.98× and the round stays open, so every further right call doubles what rides, and the ladder
// under the coin shows how far the streak has climbed. Cash out any time. Each flip is drawn on
// the server when it is called, so there is nothing ahead of time for the page to know.
//
// Auto: each round of a run bets on the call, calls it again until the streak reaches the number
// set, then cashes out (a wrong call ends the round as a loss). Only the round's own messages go.

import './coinflip.css';
import type { GameClientModule, TableView } from '../contract.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { MAX_STREAK, streakMult, type Side } from '../../../../shared/src/games/coinflip/rules.ts';
import type { CoinflipRound, CoinflipView } from '../../../../shared/src/games/coinflip/engine.ts';
import { tween, ease } from '../../table/tween.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { SegChoice, NumberField, actionButton, labelled, InfoList, OutcomePop, siteTone, shortTone, drawSiteBar, drawAttractPanel, multText } from '../online/screen.ts';
import { OnlineSite } from '../online/site.ts';
import { coinFace } from './coin.ts';

/** The chair's trim on the floor: Coinflip's gold. */
const ACCENT = '#f5b93b';
const FLIP_MS = 900;
/** Ladder steps across the board at once. */
const STEPS_SHOWN = 8;
/** A step's tile and the gap after it (coinflip.css). */
const STEP_W = 109;

const sideName = (s: Side) => (s === 'heads' ? 'Heads' : 'Tails');
/** A ladder step's multiplier, short enough for its tile: 1.98×, 1,013.76×, 1,038,090×. */
const stepText = (m: number) => `${(m / 100).toLocaleString('en-US', { minimumFractionDigits: m >= 10_000_000 ? 0 : 2, maximumFractionDigits: m >= 10_000_000 ? 0 : 2 })}×`;

/** The monitor on the floor: the site's bar, a bet panel, a gold coin over the streak ladder. */
function drawAttract(g: CanvasRenderingContext2D, w: number, h: number): void {
  const top = drawSiteBar(g, w, 'Coinflip');
  const left = drawAttractPanel(g, top, h, [['Bet', '$10.00'], ['Call', 'Heads']], 'Bet');
  const cx = left + (w - left) / 2;
  const cy = top + 104;
  g.fillStyle = 'rgba(0, 0, 0, 0.35)';
  g.beginPath();
  g.ellipse(cx, cy + 82, 58, 10, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#a86a0c';
  g.beginPath();
  g.arc(cx, cy, 70, 0, Math.PI * 2);
  g.fill();
  const face = g.createRadialGradient(cx - 22, cy - 26, 6, cx, cy, 66);
  face.addColorStop(0, '#ffe7a3');
  face.addColorStop(0.5, '#f5b93b');
  face.addColorStop(1, '#b97a14');
  g.fillStyle = face;
  g.beginPath();
  g.arc(cx, cy, 63, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#7a4a05';
  g.beginPath();
  const pts = [[-29, 17], [-31, -17], [-15, -2], [-8, -24], [0, -7], [8, -24], [15, -2], [31, -17], [29, 17]] as const;
  g.moveTo(cx + pts[0][0], cy + pts[0][1]);
  for (const [x, y] of pts.slice(1)) g.lineTo(cx + x, cy + y);
  g.closePath();
  g.fill();
  g.fillRect(cx - 29, cy + 18, 58, 10);
  // the ladder: three steps climbed, the fourth next
  const mults = ['1.98×', '3.96×', '7.92×', '15.84×', '31.68×'];
  const bw = 62;
  const x0 = cx - (mults.length * (bw + 6) - 6) / 2;
  const y0 = h - 58;
  g.font = '700 13px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  mults.forEach((m, i) => {
    g.fillStyle = i < 3 ? '#1fd65f' : i === 3 ? '#2f4553' : '#213743';
    g.beginPath();
    g.roundRect(x0 + i * (bw + 6), y0, bw, 34, 5);
    g.fill();
    g.fillStyle = i < 3 ? '#06210f' : '#eef3f8';
    g.fillText(m, x0 + i * (bw + 6) + bw / 2, y0 + 17);
  });
  g.textAlign = 'left';
}

export const coinflip: GameClientModule = {
  game: 'coinflip',
  footprint: PC_FOOTPRINT,
  createModel: () => pcModel({ attract: attractTexture(drawAttract), accent: ACCENT }),
  seats: () => [{ position: PC_SEAT, yaw: Math.PI }],
  playPose: () => pcPose(),

  mount(ctx): TableView {
    let side: Side = 'heads';
    let view: CoinflipView | null = null;
    let stack: Cents = 0;
    let busy = false;
    let animating = false;
    let sentAt = 0;
    /** The coin's turn about its horizontal axis, degrees: a multiple of 360 shows heads. */
    let angle = 0;
    /** Auto cashes out once a round's streak reaches this many right calls. */
    let target = 1;
    /** The round on the coin is a run's: the page calls again and cashes out itself. */
    let autoRound = false;

    const site = new OnlineSite(ctx, {
      game: 'coinflip',
      title: 'Coinflip',
      action: 'Bet',
      primary: () => primary(),
      sync: () => sync(),
      auto: {
        gapMs: 600,
        play: () => {
          const bet = site.bet;
          if (!bet || busy || animating || playing()) return false;
          if (bet.value > stack) return 'not enough chips here for the next round';
          autoRound = true;
          pop.hide();
          act({ type: 'bet', amount: bet.value, side });
          return true;
        },
      },
    });
    const screen = site.screen;

    // The board: the coin, this round's flips, the streak ladder (recent rounds are the site's top row).
    const board = el('div', 'cf-board');
    const stage = el('div', 'cf-stage');
    const shadow = el('div', 'cf-shadow');
    const toss = el('div', 'cf-toss');
    const coin = el('div', 'cf-coin');
    const front = el('div', 'cf-side cf-front');
    const back = el('div', 'cf-side cf-back');
    front.append(coinFace('heads'));
    back.append(coinFace('tails'));
    // the coin's milled edge, seen as it turns edge-on
    const rim = el('div', 'cf-rim');
    coin.append(rim, front, back);
    toss.append(coin);
    const caption = el('div', 'cf-caption');
    caption.setAttribute('aria-live', 'polite');
    stage.append(shadow, toss, caption);
    const flipsRow = el('div', 'cf-flips');
    const ladder = el('div', 'cf-ladder');
    const track = el('div', 'cf-track');
    const steps: HTMLElement[] = [];
    for (let k = 1; k <= MAX_STREAK; k++) {
      const s = el('div', 'cf-step');
      s.append(el('span', 'cf-step-m', stepText(streakMult(k))), el('span', 'cf-step-n', k === 1 ? '1 call' : `${k} in a row`));
      steps.push(s);
      track.append(s);
    }
    const trackWindow = el('div', 'cf-track-window');
    trackWindow.append(track);
    ladder.append(trackWindow);
    board.append(stage, flipsRow, ladder);
    screen.main.append(board);
    const pop = new OutcomePop(stage);

    // The bet panel.
    const callSeg = new SegChoice<Side>([{ value: 'heads', label: 'Heads', title: 'Call heads (H)', key: 'H' }, { value: 'tails', label: 'Tails', title: 'Call tails (T)', key: 'T' }], side, (s) => {
      side = s;
      siteTone(ctx.sfx, 880, 30, { type: 'triangle', gain: 0.03 });
      sync();
    }).label('Call');
    callSeg.root.classList.add('cf-call');
    // Auto: how many right calls a round rides before it cashes out
    const targetField = new NumberField({
      label: 'Auto cashes out after',
      suffix: 'right',
      format: (n) => String(n),
      value: target,
      onCommit: (n) => {
        target = Math.min(MAX_STREAK, Math.max(1, Math.round(n)));
        targetField.set(target);
        sync();
      },
    });
    targetField.addButton('−', 'One call fewer', () => {
      target = Math.max(1, target - 1);
      targetField.set(target);
      sync();
    });
    targetField.addButton('+', 'One call more', () => {
      target = Math.min(MAX_STREAK, target + 1);
      targetField.set(target);
      sync();
    });
    targetField.root.classList.add('cf-target');
    site.controls.append(labelled('Call', callSeg.root), targetField.root);
    const cash = actionButton('Cash out', () => cashOut(), 'cash', 'C');
    cash.classList.add('os-fixed', 'cf-cash');
    cash.title = 'Take what rides (C)';
    const random = actionButton('Random call', () => {
      callSeg.set(Math.random() < 0.5 ? 'heads' : 'tails');
      side = callSeg.value;
      primary();
    }, 'plain', 'R');
    random.classList.add('cf-random');
    random.title = 'Call a side at random (R)';
    site.extras.append(cash, random);
    const info = new InfoList('This round');
    site.facts.append(info.root);

    const playing = () => view?.phase === 'playing';
    const streak = () => (playing() && view ? view.streak : 0);

    const act = (a: object) => {
      if (busy || animating) return;
      busy = true;
      sentAt = performance.now();
      ctx.link.act(a);
      site.auto?.driver.asked();
      sync();
    };

    const primary = () => {
      if (playing()) {
        act({ type: 'flip', side });
        return;
      }
      const bet = site.bet;
      if (!bet) return;
      if (bet.value > stack) {
        shortTone(ctx.sfx);
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      pop.hide();
      autoRound = false;
      act({ type: 'bet', amount: bet.value, side });
    };

    const cashOut = () => {
      if (playing() && streak() > 0 && !(site.locked && autoRound)) act({ type: 'cashout' });
    };

    /** A run's round goes on by itself: call again until the streak is the target, then cash out. */
    const autoStep = () => {
      if (!autoRound || !site.locked || !playing() || busy || animating) return;
      if (streak() >= target) act({ type: 'cashout' });
      else act({ type: 'flip', side });
    };

    /** Where the ladder sits: the step being played for second from the left. */
    const showLadder = (k: number, live: boolean) => {
      steps.forEach((s, i) => {
        s.classList.toggle('done', i < k);
        s.classList.toggle('next', live && i === k);
        s.classList.toggle('goal', site.autoOn && i === target - 1);
      });
      const first = Math.max(0, Math.min(MAX_STREAK - STEPS_SHOWN, k - 1));
      track.style.transform = `translateX(${-first * STEP_W}px)`;
    };

    const setCoin = (a: number, lift: number) => {
      coin.style.transform = `rotateX(${a}deg)`;
      toss.style.transform = `translateY(${-lift * 70}px) scale(${1 + lift * 0.16})`;
      shadow.style.transform = `scale(${1 - lift * 0.55})`;
      shadow.style.opacity = String(1 - lift * 0.6);
    };

    const showSide = (s: Side) => {
      angle = s === 'heads' ? 0 : 180;
      setCoin(angle, 0);
    };

    const flipChip = (call: Side, landed: Side, fresh: boolean) => {
      const win = call === landed;
      const chip = el('div', `cf-flip ${win ? 'win' : 'lose'}${fresh ? ' fresh' : ''}`);
      chip.title = `Called ${sideName(call).toLowerCase()}, landed ${sideName(landed).toLowerCase()}`;
      chip.append(coinFace(landed, 'cf-mini'));
      flipsRow.append(chip);
      while (flipsRow.childElementCount > 12) flipsRow.firstElementChild!.remove();
    };

    const sync = () => {
      const on = playing();
      const k = streak();
      const locked = site.locked;
      const autoOn = site.autoOn;
      site.midRound = on;
      if (!animating) screen.setStack(stack);
      const bet = site.bet;
      bet?.setEnabled(!on && !busy && !locked);
      bet?.setMax(stack);
      const block = busy || animating;
      if (on && view) {
        site.paintMain(`Flip ${sideName(side).toLowerCase()} · ${multText(streakMult(k + 1))}`, 'go', block || (locked && autoRound));
        cash.hidden = false;
        cash.textContent = `Cash out ${formatMoney((view.bet / 100) * view.mult)}`;
        cash.disabled = block || k === 0 || (locked && autoRound);
      } else {
        site.paintMain('Bet', 'go', block || !bet || bet.value > stack, !!bet && bet.value <= stack);
        cash.hidden = true;
      }
      site.main.title = on ? 'Call again (Space)' : 'Bet and flip (Space)';
      random.disabled = block || locked || (!on && (!bet || bet.value > stack));
      random.hidden = autoOn && !on;
      callSeg.setEnabled(!block && !locked);
      targetField.root.hidden = !autoOn;
      targetField.setEnabled(!locked);
      site.auto?.setEnabled(!on && !block);
      showLadder(on && view ? view.streak : 0, on);

      const b = on && view ? view.bet : (bet?.value ?? site.limits?.min ?? 100);
      site.profit(on ? 'Profit on the next call' : 'Profit on a right call', (b / 100) * streakMult(k + 1) - b, `${multText(streakMult(k + 1))} · 50.00%`);
      info.set('streak', 'Streak', on ? `${k} right` : '—');
      info.set('now', 'Cash out now', on && k > 0 ? `${multText(streakMult(k))} · ${formatMoney((b / 100) * streakMult(k))}` : '—', on && k > 0 ? 'win' : null);
      info.set('next', on ? 'Next right call pays' : 'A right call pays', `${multText(streakMult(k + 1))} · ${formatMoney((b / 100) * streakMult(k + 1))}`);
      info.set('odds', 'Chance', '50.00%');
      if (!view || view.phase === 'idle') caption.replaceChildren('Call ', el('b', '', sideName(side)), ' and bet: a right call pays 1.98×');
      if (autoOn && !on && !locked) targetField.setNote(`${multText(streakMult(target))} · ${formatMoney((b / 100) * streakMult(target))}`);
      else targetField.setNote('');
      const lim = site.limits;
      const limText = lim ? ` · Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}` : '';
      screen.setNote(`Return 99.00% at every stop${limText} · Space bets and flips · C cashes out · H and T call a side · R calls at random`);
      tipFor();
    };

    // Tips: no call and no stop is better than another, and the tip says so.
    const tipFor = () =>
      site.tip(
        !ctx.tips.on
          ? null
          : playing()
            ? 'Cashing out now and flipping on are worth exactly the same 99%: the next call only doubles the swing.'
            : 'Heads and tails are an even 50%, and every stop returns exactly 99%: how long you ride only changes the swings.',
      );
    const offTips = ctx.tips.subscribe(tipFor);

    const flipTo = async (landed: Side) => {
      // four to five whole turns, ending on the side that landed (a little quicker on Auto)
      const turns = 4 + (Math.random() < 0.5 ? 1 : 0);
      const from = angle;
      let to = from + turns * 360;
      if ((((to % 360) + 360) % 360 === 0) !== (landed === 'heads')) to += 180;
      siteTone(ctx.sfx, 620, 70, { type: 'triangle', gain: 0.04, to: 980 });
      let ticks = 0;
      await tween(
        site.locked ? FLIP_MS * 0.8 : FLIP_MS,
        (k) => {
          const spin = 1 - (1 - k) ** 2;
          const lift = Math.sin(Math.PI * k);
          setCoin(from + (to - from) * spin, lift);
          const half = Math.floor(((to - from) * spin) / 180);
          if (half > ticks && k < 0.92) {
            ticks = half;
            siteTone(ctx.sfx, 1500 + half * 40, 14, { type: 'triangle', gain: 0.012 });
          }
        },
        ease.linear,
      );
      angle = to % 360;
      setCoin(angle, 0);
      // it lands with a little bounce
      toss.classList.remove('land');
      coin.classList.remove('land');
      void coin.offsetWidth;
      coin.classList.add('land');
      toss.classList.add('land');
    };

    const pushRound = (r: CoinflipRound, fresh: boolean) => site.history.push(r.outcome === 'bust' ? '0.00×' : multText(r.mult), r.payout > r.bet, fresh);

    const onOver = (e: GameEvent) => {
      const payout = Number(e.payout);
      const b = Number(e.bet);
      const k = Number(e.streak);
      autoRound = false;
      if (payout > 0) {
        pop.show(Number(e.mult), payout, b, 2_600);
        ctx.sfx.play('chips-stack', { volume: 0.6 });
        caption.replaceChildren('Cashed out after ', el('b', '', `${k} right call${k === 1 ? '' : 's'}`));
      }
      site.settle({
        bet: b,
        payout,
        mult: payout > 0 ? Number(e.mult) : 0,
        moment: { title: e.outcome === 'max' ? 'Twenty in a row' : `Coinflip ${multText(Number(e.mult))}`, sub: `${k} right calls · pays ${formatMoney(payout)} on ${formatMoney(b)}` },
      });
    };

    const redraw = (v: CoinflipView) => {
      view = v;
      flipsRow.replaceChildren();
      for (const f of v.flips) flipChip(f.call, f.side, false);
      const last = v.flips.at(-1);
      if (last) {
        showSide(last.side);
        if (v.phase !== 'playing') side = last.call;
      }
      callSeg.set(side);
      showLadder(v.phase === 'idle' ? 0 : v.streak, v.phase === 'playing');
      coin.classList.toggle('lost', v.result?.outcome === 'bust');
      if (v.phase === 'playing') caption.replaceChildren(el('b', '', `${v.streak} right`), ` · ${multText(v.mult)} rides · call again or cash out`);
      else if (v.result) {
        const k = v.result.streak;
        caption.replaceChildren(v.result.outcome === 'bust' ? 'Wrong call after ' : 'Cashed out after ', el('b', '', `${k} right call${k === 1 ? '' : 's'}`));
      }
    };

    showLadder(0, false);
    showSide('heads');
    sync();

    return {
      onTable(snap) {
        stack = snap.you.stack;
        busy = false;
        animating = false;
        autoRound = false;
        site.table(snap);
        pop.hide();
        const v = snap.view as CoinflipView;
        site.history.clear();
        for (const r of v.recent.slice(0, 9).reverse()) pushRound(r, false);
        const last = v.recent[0];
        if (last) site.result.show(last.bet, last.payout, last.outcome === 'bust' ? 0 : last.mult, false);
        redraw(v);
        sync();
      },

      async onEvents(events, v) {
        const next = v as CoinflipView;
        animating = true;
        busy = false;
        site.auto?.driver.answered();
        sync();
        try {
          for (const e of events) {
            if (e.type === 'bet') {
              pop.hide();
              coin.classList.remove('lost');
              flipsRow.replaceChildren();
              showLadder(0, true);
            } else if (e.type === 'flip') {
              const landed = e.side as Side;
              caption.replaceChildren('Called ', el('b', '', sideName(e.call as Side)));
              await flipTo(landed);
              flipChip(e.call as Side, landed, true);
              if (e.win) {
                const f = 660 * 2 ** (Math.min(20, Number(e.streak) - 1) / 12);
                siteTone(ctx.sfx, f, 120, { type: 'triangle', gain: 0.055 });
                siteTone(ctx.sfx, f * 1.5, 110, { type: 'sine', gain: 0.03, at: 60 });
                showLadder(Number(e.streak), true);
                caption.replaceChildren(el('b', '', sideName(landed)), ` · ${Number(e.streak)} right · ${multText(Number(e.mult))} rides`);
              } else {
                siteTone(ctx.sfx, 200, 380, { type: 'sawtooth', gain: 0.05, to: 60 });
                coin.classList.add('lost');
                caption.replaceChildren(el('b', '', sideName(landed)), ` · called ${sideName(e.call as Side).toLowerCase()}`);
              }
            } else if (e.type === 'over') {
              onOver(e);
            }
          }
        } finally {
          animating = false;
          view = next;
          showLadder(next.phase === 'playing' ? next.streak : next.result?.streak ?? 0, next.phase === 'playing');
          sync();
          autoStep();
        }
      },

      onConnection(open) {
        site.connection(open);
      },

      onSeat(msg) {
        site.seat(msg);
        stack = msg.stack;
        sync();
      },

      onError(_code, msg) {
        site.error(msg);
        busy = false;
        autoRound = false;
        sync();
      },

      keydown(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        if (e.code === 'Space') {
          if (!e.repeat) site.press();
          return true;
        }
        if (site.locked) return false;
        const key = e.key.toLowerCase();
        if (key === 'c' && playing()) {
          cashOut();
          return true;
        }
        if ((key === 'h' || key === 't') && !(busy || animating)) {
          side = key === 'h' ? 'heads' : 'tails';
          callSeg.set(side);
          sync();
          return true;
        }
        if (key === 'r' && !random.hidden) {
          random.click();
          return true;
        }
        return false;
      },

      update(dt) {
        // A call the server never answered (the socket dropped it) stops holding the page.
        if (busy && performance.now() - sentAt > 6_000) {
          busy = false;
          sync();
        }
        site.update(dt);
      },

      dispose() {
        offTips();
        pop.hide();
        site.dispose();
      },
    };
  },
};
