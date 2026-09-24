// Limbo on the lounge computers (docs/rules/online-games.md §3): name a target multiplier, and win
// the target times the bet if the result reaches it. The server draws the result so that it
// reaches any target x with probability 0.99 / x, which makes every target return exactly 99%.
// The page counts the big number up to the result and turns it green or red.

import './limbo.css';
import type { GameClientModule, TableView } from '../contract.ts';
import { formatMoney, type BetLimits, type Cents } from '../../../../shared/src/money.ts';
import { MIN_TARGET, MAX_TARGET, RETURN_HUNDREDTHS, winPayout, targetForChance } from '../../../../shared/src/games/limbo/rules.ts';
import type { LimboEvent, LimboView } from '../../../../shared/src/games/limbo/engine.ts';
import { tween, ease } from '../../table/tween.ts';
import { celebrate } from '../../table/celebrate.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, pcScreenCorners, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { OnlineScreen, BetBox, actionButton, NumberField, InfoList, ResultStrip, SessionTally, BetLog, commitTyping, winTier, siteTone, drawSiteBar } from '../online/screen.ts';

/** The chair's trim on the floor: Limbo's amber. */
const ACCENT = '#ffb020';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** A multiplier in hundredths as the page prints it: 1,234.56×. */
const multText = (m: number) => `${(m / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
/** The win chance of a target, as a percentage with the digits that matter: 49.50, 0.0099, 0.000099. */
const chanceText = (target: number) => {
  const p = (RETURN_HUNDREDTHS * 100) / target;
  return p >= 1 ? p.toFixed(2) : p >= 0.01 ? p.toFixed(4) : p.toPrecision(2);
};
const cents = (c: Cents) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The monitor on the floor: the site's bar, a bet panel, and a green 2.47× over a 2.00× target. */
function drawAttract(g: CanvasRenderingContext2D, w: number, h: number): void {
  const top = drawSiteBar(g, w, 'Limbo');
  g.fillStyle = '#1a2c38';
  g.fillRect(0, top, 132, h - top);
  g.textBaseline = 'middle';
  const field = (label: string, text: string, x: number, y: number, width: number) => {
    g.fillStyle = '#a7b4c6';
    g.font = '600 11px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(label, x + 2, y);
    g.fillStyle = '#0f1e29';
    g.beginPath();
    g.roundRect(x, y + 8, width, 28, 4);
    g.fill();
    g.fillStyle = '#eef3f8';
    g.font = '600 15px system-ui, sans-serif';
    g.fillText(text, x + 8, y + 23);
  };
  field('Bet', '$20.00', 10, top + 18, 112);
  field('Profit on Win', '$20.00', 10, top + 70, 112);
  g.fillStyle = '#1fd65f';
  g.beginPath();
  g.roundRect(10, top + 124, 112, 36, 5);
  g.fill();
  g.fillStyle = '#06210f';
  g.font = '800 16px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('Bet', 66, top + 143);
  const cx = 132 + (w - 132) / 2;
  g.shadowColor = 'rgba(31, 214, 95, 0.45)';
  g.shadowBlur = 24;
  g.fillStyle = '#1fd65f';
  g.font = '700 84px system-ui, sans-serif';
  g.fillText('2.47×', cx, top + 104);
  g.shadowBlur = 0;
  g.fillStyle = '#6f8196';
  g.font = '600 14px system-ui, sans-serif';
  g.fillText('Target 2.00×', cx, top + 160);
  field('Target Multiplier', '2.00', 150, h - 58, 158);
  field('Win Chance', '49.50', 326, h - 58, 158);
  g.textAlign = 'left';
}

export const limbo: GameClientModule = {
  game: 'limbo',
  footprint: PC_FOOTPRINT,
  createModel: () => pcModel({ attract: attractTexture(drawAttract), accent: ACCENT }),
  seats: () => [{ position: PC_SEAT, yaw: Math.PI }],
  playPose: () => pcPose(),

  mount(ctx): TableView {
    const screen = new OnlineScreen('Limbo');
    ctx.ui.append(screen.root);
    const corners = pcScreenCorners();

    /** The target multiplier, in hundredths. */
    let target = 200;
    let stack: Cents = 0;
    let limits: BetLimits | null = null;
    let bet: BetBox | null = null;
    let busy = false;
    /** Results still playing out: the chips on the page wait for them. */
    let playing = 0;
    let sentAt = 0;
    let tipShown = false;

    // The board: recent results, the big number, the two fields.
    const main = el('div', 'lb-main');
    const stripWrap = el('div', 'lb-strip');
    const strip = new ResultStrip(9);
    stripWrap.append(strip.root);
    const stage = el('div', 'lb-stage');
    const number = el('div', 'lb-number', multText(100));
    const caption = el('div', 'lb-caption');
    stage.append(number, caption);
    const targetField = new NumberField({
      label: 'Target Multiplier',
      suffix: '×',
      value: target,
      format: (t) => (t / 100).toFixed(2),
      onCommit: (x) => setTarget(Math.round(x * 100)),
    });
    const chanceField = new NumberField({
      label: 'Win Chance',
      suffix: '%',
      value: target,
      format: chanceText,
      onCommit: (p) => setTarget(targetForChance(p)),
    });
    const fields = el('div', 'lb-fields');
    fields.append(targetField.root, chanceField.root);
    main.append(stripWrap, stage, fields);
    screen.main.append(main);

    // The bet panel.
    const profit = new NumberField({ label: 'Profit on Win', value: 0, format: cents });
    const betBtn = actionButton('Bet', () => play());
    betBtn.title = 'Bet (Space)';
    betBtn.classList.add('os-fixed');
    const info = new InfoList('This bet');
    const log = new BetLog('Last bets', ['Target', 'Result', 'Payout'], 4);
    const tally = new SessionTally();
    screen.side.append(profit.root, betBtn, info.root, log.root, tally.root);

    /** The big number, sized to fit: 2.47× fills the stage, 1,000,000.00× still fits across it. */
    const showNumber = (m: number, tone: 'win' | 'lose' | null) => {
      const text = multText(m);
      number.textContent = text;
      number.style.fontSize = `${text.length <= 6 ? 168 : text.length <= 9 ? 140 : text.length <= 11 ? 118 : 100}px`;
      number.className = `lb-number${tone ? ` ${tone}` : ''}`;
    };

    const setTarget = (t: number) => {
      target = clamp(t, MIN_TARGET, MAX_TARGET);
      render();
    };

    const render = () => {
      targetField.set(target);
      chanceField.set(target);
      const b = bet?.value ?? limits?.min ?? 100;
      const pays = winPayout(b, target);
      profit.set(pays - b);
      caption.replaceChildren('Target ', el('b', '', multText(target)), ` · wins ${chanceText(target)}% of the time`);
      info.set('pays', 'A win pays', cents(pays));
      info.set('chance', 'Win chance', `${chanceText(target)}%`);
      info.set('rtp', 'Return', '99.00%');
      const range = limits ? ` · Bet ${formatMoney(limits.min)} to ${formatMoney(limits.max)}` : '';
      screen.setNote(`Return 99.00% on every target${range} · Space bets`);
    };

    // Tips: there is no better target, and the tip says so.
    const tipFor = () => {
      if (!ctx.tips.on) {
        if (tipShown) {
          tipShown = false;
          ctx.kit.tip(null);
        }
        return;
      }
      tipShown = true;
      ctx.kit.tip('Every target returns exactly 99%: a higher one only makes the swings bigger.');
    };
    const offTips = ctx.tips.subscribe(tipFor);

    const sync = () => {
      bet?.setMax(stack);
      betBtn.disabled = !bet || bet.value > stack;
    };

    const play = () => {
      if (!bet || busy) return;
      commitTyping(screen.root);
      if (bet.value > stack) {
        siteTone(ctx.sfx, 150, 120, { type: 'sawtooth', gain: 0.03 });
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      busy = true;
      sentAt = performance.now();
      ctx.link.act({ type: 'bet', bet: bet.value, target });
    };

    const playResult = async (ev: LimboEvent) => {
      screen.setStack(ev.stack - ev.payout);
      // Count up on a log scale, so 1.00× to 2.00× takes as long to read as 100× to 200×.
      const ms = Math.min(1_000, 220 + 170 * Math.log10(ev.result / 100));
      const top = ev.result / 100;
      let lastTick = -1;
      await tween(
        ms,
        (k) => {
          const shown = k >= 1 ? ev.result : Math.min(ev.result, Math.floor(100 * top ** k));
          showNumber(shown, null);
          const t = Math.floor(k * 14);
          if (t !== lastTick && k < 1) {
            lastTick = t;
            siteTone(ctx.sfx, 520 + t * 55, 16, { type: 'triangle', gain: 0.018 });
          }
        },
        ease.out,
      );
      showNumber(ev.result, ev.win ? 'win' : 'lose');
      strip.push(multText(ev.result), ev.win);
      log.push([multText(ev.target), multText(ev.result), cents(ev.payout)], ev.win);
      tally.add(ev.bet, ev.payout);
      screen.setStack(ev.stack);
      if (ev.win) {
        siteTone(ctx.sfx, 784, 90, { type: 'triangle', gain: 0.05 });
        siteTone(ctx.sfx, 1175, 140, { type: 'triangle', gain: 0.05, at: 70 });
      } else siteTone(ctx.sfx, 220, 120, { gain: 0.045, to: 170 });
      const tier = winTier(ev.payout, ev.bet);
      if (tier) {
        celebrate({ stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx }, { title: `Limbo ${multText(ev.target)}`, sub: `The result reached ${multText(ev.result)} · pays ${cents(ev.payout)}`, tier });
      }
    };

    render();
    sync();

    return {
      onTable(snap) {
        stack = snap.you.stack;
        busy = false;
        screen.setStack(stack);
        const lim = snap.meta.config.limits.default;
        if (!bet || !limits || lim.min !== limits.min || lim.max !== limits.max || lim.step !== limits.step) {
          bet?.root.remove();
          limits = lim;
          // onChange must not call setMax (sync): below the table minimum the box would clamp,
          // change and call back forever.
          bet = new BetBox({ label: 'Bet', min: lim.min, max: lim.max, step: lim.step, value: lim.min, onChange: () => {
            if (!bet) return;
            render();
            betBtn.disabled = bet.value > stack;
          } });
          screen.side.prepend(bet.root);
        }
        const v = snap.view as LimboView;
        strip.clear();
        log.clear();
        for (const b of v.recent.slice(0, 9).reverse()) strip.push(multText(b.result), b.win, false);
        for (const b of v.recent.slice(0, 4).reverse()) log.push([multText(b.target), multText(b.result), cents(b.payout)], b.win, false);
        const last = v.recent[0];
        if (last) {
          target = last.target;
          showNumber(last.result, last.win ? 'win' : 'lose');
        }
        render();
        sync();
        tipFor();
      },

      async onEvents(events) {
        // The server has answered: the next press can go while this number counts.
        busy = false;
        playing++;
        try {
          for (const e of events) if (e.type === 'result') await playResult(e as unknown as LimboEvent);
        } finally {
          playing--;
        }
      },

      onSeat(msg) {
        stack = msg.stack;
        if (playing === 0) screen.setStack(stack);
        sync();
      },

      onError() {
        busy = false;
        sync();
      },

      keydown(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        if (e.code === 'Space') {
          if (!e.repeat) play();
          return true;
        }
        return false;
      },

      update() {
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
        screen.dispose();
      },
    };
  },
};
