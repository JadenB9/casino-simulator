// Coinflip on the lounge computers (docs/rules/online-games.md §9): the desk as it stands on the
// floor, and the website on its monitor. Bet with a call and the coin goes up; a right call pays
// 1.98× and the round stays open, so every further right call doubles what rides, and the ladder
// under the coin shows how far the streak has climbed. Cash out any time. Each flip is drawn on
// the server when it is called, so there is nothing ahead of time for the page to know.

import './coinflip.css';
import type { GameClientModule, TableView } from '../contract.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import { formatMoney, type BetLimits, type Cents } from '../../../../shared/src/money.ts';
import { MAX_STREAK, streakMult, type Side } from '../../../../shared/src/games/coinflip/rules.ts';
import type { CoinflipRound, CoinflipView } from '../../../../shared/src/games/coinflip/engine.ts';
import { celebrate } from '../../table/celebrate.ts';
import { tween, ease } from '../../table/tween.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, pcScreenCorners, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { OnlineScreen, AddChips, BetBox, SegChoice, actionButton, labelled, InfoList, ResultStrip, SessionTally, OutcomePop, commitTyping, winTier, siteTone, drawSiteBar, drawAttractPanel, multText } from '../online/screen.ts';
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
    const screen = new OnlineScreen('Coinflip');
    ctx.ui.append(screen.root);
    const cashier = new AddChips(screen, ctx);
    const corners = pcScreenCorners();

    let side: Side = 'heads';
    let view: CoinflipView | null = null;
    let stack: Cents = 0;
    let busy = false;
    let animating = false;
    let sentAt = 0;
    let limits: BetLimits | null = null;
    let bet: BetBox | null = null;
    let tipShown = false;
    /** The coin's turn about its horizontal axis, degrees: a multiple of 360 shows heads. */
    let angle = 0;

    // The board: recent rounds, the coin, this round's flips, the streak ladder.
    const board = el('div', 'cf-board');
    const stripWrap = el('div', 'cf-strip');
    const strip = new ResultStrip(9);
    stripWrap.append(strip.root);
    const stage = el('div', 'cf-stage');
    const shadow = el('div', 'cf-shadow');
    const toss = el('div', 'cf-toss');
    const coin = el('div', 'cf-coin');
    const front = el('div', 'cf-side cf-front');
    const back = el('div', 'cf-side cf-back');
    front.append(coinFace('heads'));
    back.append(coinFace('tails'));
    coin.append(front, back);
    toss.append(coin);
    const caption = el('div', 'cf-caption');
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
    board.append(stripWrap, stage, flipsRow, ladder);
    screen.main.append(board);
    const pop = new OutcomePop(stage);

    // The bet panel.
    const callSeg = new SegChoice<Side>([{ value: 'heads', label: 'Heads', title: 'Call heads (H)' }, { value: 'tails', label: 'Tails', title: 'Call tails (T)' }], side, (s) => {
      side = s;
      siteTone(ctx.sfx, 880, 30, { type: 'triangle', gain: 0.03 });
      sync();
    });
    callSeg.root.classList.add('cf-call');
    const main = actionButton('Bet', () => primary());
    main.classList.add('os-fixed');
    const cash = actionButton('Cash out', () => cashOut(), 'cash');
    cash.classList.add('os-fixed', 'cf-cash');
    cash.title = 'Take what rides (C)';
    const random = actionButton('Random call', () => {
      callSeg.set(Math.random() < 0.5 ? 'heads' : 'tails');
      side = callSeg.value;
      primary();
    }, 'plain');
    random.classList.add('cf-random');
    random.title = 'Call a side at random (R)';
    const info = new InfoList('This round');
    const tally = new SessionTally();
    screen.side.append(labelled('Call', callSeg.root), main, cash, random, info.root, tally.root);

    const playing = () => view?.phase === 'playing';
    const streak = () => (playing() && view ? view.streak : 0);

    const act = (a: object) => {
      if (busy || animating) return;
      busy = true;
      sentAt = performance.now();
      ctx.link.act(a);
      sync();
    };

    const primary = () => {
      commitTyping(screen.root);
      if (playing()) {
        act({ type: 'flip', side });
        return;
      }
      if (!bet) return;
      if (bet.value > stack) {
        siteTone(ctx.sfx, 150, 120, { type: 'sawtooth', gain: 0.03 });
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      pop.hide();
      act({ type: 'bet', amount: bet.value, side });
    };

    const cashOut = () => {
      if (playing() && streak() > 0) act({ type: 'cashout' });
    };

    /** Where the ladder sits: the step being played for second from the left. */
    const showLadder = (k: number, live: boolean) => {
      steps.forEach((s, i) => {
        s.classList.toggle('done', i < k);
        s.classList.toggle('next', live && i === k);
      });
      const first = Math.max(0, Math.min(MAX_STREAK - STEPS_SHOWN, k - 1));
      track.style.transform = `translateX(${-first * STEP_W}px)`;
    };

    const setCoin = (a: number, lift: number) => {
      coin.style.transform = `rotateX(${a}deg)`;
      toss.style.transform = `translateY(${-lift * 150}px) scale(${1 + lift * 0.18})`;
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
      if (!animating) screen.setStack(stack);
      bet?.setEnabled(!on && !busy);
      bet?.setMax(stack);
      const block = busy || animating;
      if (on && view) {
        main.textContent = `Flip ${sideName(side).toLowerCase()} · ${multText(streakMult(k + 1))}`;
        main.disabled = block;
        cash.hidden = false;
        cash.textContent = `Cash out ${formatMoney((view.bet / 100) * view.mult)}`;
        cash.disabled = block || k === 0;
      } else {
        main.textContent = 'Bet';
        main.disabled = block || !bet || bet.value > stack;
        cash.hidden = true;
      }
      main.title = on ? 'Call again (Space)' : 'Bet and flip (Space)';
      random.disabled = main.disabled;
      callSeg.setEnabled(!block);

      const b = on && view ? view.bet : (bet?.value ?? limits?.min ?? 100);
      info.set('streak', 'Streak', on ? `${k} right` : '—');
      info.set('now', 'Cash out now', on && k > 0 ? `${multText(streakMult(k))} · ${formatMoney((b / 100) * streakMult(k))}` : '—', on && k > 0 ? 'win' : null);
      info.set('next', on ? 'Next right call pays' : 'A right call pays', `${multText(streakMult(k + 1))} · ${formatMoney((b / 100) * streakMult(k + 1))}`);
      info.set('odds', 'Chance', '50.00%');
      if (!view || view.phase === 'idle') caption.replaceChildren('Call ', el('b', '', sideName(side)), ' and bet: a right call pays 1.98×');
      const lim = limits ? ` · Bet ${formatMoney(limits.min)} to ${formatMoney(limits.max)}` : '';
      screen.setNote(`Return 99.00% at every stop${lim} · Space bets and flips · C cashes out · H and T call a side`);
      tipFor();
    };

    // Tips: no call and no stop is better than another, and the tip says so.
    const tipFor = () => {
      if (!ctx.tips.on) {
        if (tipShown) {
          tipShown = false;
          ctx.kit.tip(null);
        }
        return;
      }
      tipShown = true;
      ctx.kit.tip(
        playing()
          ? 'Cashing out now and flipping on are worth exactly the same 99%: the next call only doubles the swing.'
          : 'Heads and tails are an even 50%, and every stop returns exactly 99%: how long you ride only changes the swings.',
      );
    };
    const offTips = ctx.tips.subscribe(tipFor);

    const flipTo = async (landed: Side) => {
      // four to five whole turns, ending on the side that landed
      const turns = 4 + (Math.random() < 0.5 ? 1 : 0);
      const from = angle;
      let to = from + turns * 360;
      if ((((to % 360) + 360) % 360 === 0) !== (landed === 'heads')) to += 180;
      siteTone(ctx.sfx, 620, 70, { type: 'triangle', gain: 0.04, to: 980 });
      let ticks = 0;
      await tween(
        FLIP_MS,
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
      coin.classList.remove('land');
      void coin.offsetWidth;
      coin.classList.add('land');
    };

    const pushRound = (r: CoinflipRound, fresh: boolean) => strip.push(r.outcome === 'bust' ? '0.00×' : multText(r.mult), r.payout > r.bet, fresh);

    const onOver = (e: GameEvent) => {
      const payout = Number(e.payout);
      const b = Number(e.bet);
      const k = Number(e.streak);
      tally.add(b, payout);
      pushRound(e as unknown as CoinflipRound, true);
      if (payout > 0) {
        pop.show(Number(e.mult), payout, b, 2_600);
        ctx.sfx.play('chips-stack', { volume: 0.6 });
        [784, 988, 1319].forEach((f, i) => siteTone(ctx.sfx, f, 140, { type: 'triangle', gain: 0.05, at: i * 70 }));
        caption.replaceChildren('Cashed out after ', el('b', '', `${k} right call${k === 1 ? '' : 's'}`));
        const tier = winTier(payout, b);
        if (tier) {
          celebrate({ stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx }, { title: e.outcome === 'max' ? 'Twenty in a row' : `Coinflip ${multText(Number(e.mult))}`, sub: `${k} right calls · pays ${formatMoney(payout)} on ${formatMoney(b)}`, tier });
        }
      }
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
        cashier.table(snap);
        stack = snap.you.stack;
        busy = false;
        animating = false;
        const lim = snap.meta.config.limits.default;
        if (!bet || !limits || lim.min !== limits.min || lim.max !== limits.max || lim.step !== limits.step) {
          bet?.root.remove();
          limits = lim;
          bet = new BetBox({ label: 'Bet', min: lim.min, max: lim.max, step: lim.step, value: lim.min, onChange: () => {
            if (!bet) return;
            main.disabled = !playing() && bet.value > stack;
          } });
          screen.side.prepend(bet.root);
        }
        pop.hide();
        const v = snap.view as CoinflipView;
        strip.clear();
        for (const r of v.recent.slice(0, 9).reverse()) pushRound(r, false);
        redraw(v);
        sync();
      },

      async onEvents(events, v) {
        const next = v as CoinflipView;
        animating = true;
        busy = false;
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
        }
      },

      onSeat(msg) {
        cashier.seat(msg);
        stack = msg.stack;
        sync();
      },

      onError() {
        cashier.refused();
        busy = false;
        sync();
      },

      keydown(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        if (e.code === 'Space') {
          if (!e.repeat) primary();
          return true;
        }
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
        if (key === 'r') {
          random.click();
          return true;
        }
        return false;
      },

      update() {
        // A call the server never answered (the socket dropped it) stops holding the page.
        if (busy && performance.now() - sentAt > 6_000) {
          busy = false;
          sync();
        }
        const camera = ctx.stage.engine.camera;
        camera.updateMatrixWorld();
        ctx.stage.root.updateWorldMatrix(true, false);
        screen.follow(ctx.stage.root, camera, corners);
      },

      dispose() {
        offTips();
        if (tipShown) ctx.kit.tip(null);
        pop.hide();
        screen.dispose();
      },
    };
  },
};
