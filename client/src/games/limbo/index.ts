// Limbo on the lounge computers (docs/rules/online-games.md §3): name a target multiplier, and win
// the target times the bet if the result reaches it. The server draws the result so that it
// reaches any target x with probability 0.99 / x, which makes every target return exactly 99%.
// The page counts the big number up to the result and turns it green or red. Auto bets again and
// again at the same target until one of its stops.

import './limbo.css';
import type { GameClientModule, TableView } from '../contract.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { MIN_TARGET, MAX_TARGET, RETURN_HUNDREDTHS, winPayout, targetForChance } from '../../../../shared/src/games/limbo/rules.ts';
import type { LimboEvent, LimboView } from '../../../../shared/src/games/limbo/engine.ts';
import { tween, ease } from '../../table/tween.ts';
import { el } from '../../ui/kit.ts';
import { calm } from '../../app/comfort.ts';
import { attractTexture, pcModel, pcPose, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { NumberField, InfoList, BetLog, siteTone, shortTone, drawSiteBar, drawAttractPanel } from '../online/screen.ts';
import { OnlineSite } from '../online/site.ts';

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
  drawAttractPanel(g, top, h, [['Bet', '$20.00'], ['Profit on Win', '$20.00']], 'Bet');
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
  g.textAlign = 'center';
  const cx = 132 + (w - 132) / 2;
  g.shadowColor = 'rgba(31, 214, 95, 0.45)';
  g.shadowBlur = 24;
  g.fillStyle = '#1fd65f';
  g.font = '700 84px system-ui, sans-serif';
  g.fillText('2.47×', cx, top + 104);
  g.shadowBlur = 0;
  g.fillStyle = '#8b9cb0';
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
    /** The target multiplier, in hundredths. */
    let target = 200;
    let stack: Cents = 0;
    let busy = false;
    /** Results still playing out: the chips on the page wait for them. */
    let playing = 0;
    let sentAt = 0;

    const site = new OnlineSite(ctx, {
      game: 'limbo',
      title: 'Limbo',
      action: 'Bet',
      primary: () => play(),
      sync: () => sync(),
      onBet: () => render(),
      auto: {
        gapMs: 320,
        play: () => {
          const bet = site.bet;
          if (!bet || busy || playing > 0) return false;
          if (bet.value > stack) return 'not enough chips here for the next bet';
          send(bet.value);
          return true;
        },
      },
    });
    const screen = site.screen;

    // The board: the big number and the two fields (the recent results are the site's top row).
    const main = el('div', 'lb-main');
    const stage = el('div', 'lb-stage');
    const number = el('div', 'lb-number', multText(100));
    const caption = el('div', 'lb-caption');
    // a band of light behind the number that rises with the count (still while calm)
    const glow = el('div', 'lb-glow');
    stage.append(glow, number, caption);
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
    main.append(stage, fields);
    screen.main.append(main);

    // The bet panel: the facts and the last bets (the profit on a win is the bet's own line).
    const info = new InfoList('This bet');
    const log = new BetLog('Last bets', ['Target', 'Result', 'Payout'], 4);
    site.facts.append(info.root, log.root);

    /** The big number, sized to fit: 2.47× fills the stage, 1,000,000.00× still fits across it. */
    let shownText = '';
    const showNumber = (m: number, tone: 'win' | 'lose' | null) => {
      const text = multText(m);
      if (text !== shownText) {
        shownText = text;
        number.textContent = text;
        number.style.fontSize = `${text.length <= 6 ? 168 : text.length <= 9 ? 140 : text.length <= 11 ? 118 : 100}px`;
      }
      const cls = `lb-number${tone ? ` ${tone}` : ''}`;
      if (number.className !== cls) number.className = cls;
    };

    const setTarget = (t: number) => {
      if (site.locked) return;
      target = clamp(t, MIN_TARGET, MAX_TARGET);
      render();
    };

    const render = () => {
      targetField.set(target);
      chanceField.set(target);
      const b = site.bet?.value ?? site.limits?.min ?? 100;
      const pays = winPayout(b, target);
      site.profit('Profit on win', pays - b, `${multText(target)} · ${chanceText(target)}%`);
      caption.replaceChildren('Target ', el('b', '', multText(target)), ` · wins ${chanceText(target)}% of the time`);
      info.set('pays', 'A win pays', cents(pays));
      info.set('rtp', 'Return', '99.00%');
      const lim = site.limits;
      const range = lim ? ` · Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}` : '';
      screen.setNote(`Return 99.00% on every target${range} · Space bets`);
      sync();
    };

    // Tips: there is no better target, and the tip says so.
    const tipFor = () => site.tip(ctx.tips.on ? 'Every target returns exactly 99%: a higher one only makes the swings bigger.' : null);
    const offTips = ctx.tips.subscribe(tipFor);

    const sync = () => {
      const bet = site.bet;
      bet?.setMax(stack);
      const locked = site.locked;
      bet?.setEnabled(!locked);
      targetField.setEnabled(!locked);
      chanceField.setEnabled(!locked);
      site.auto?.setEnabled(true);
      site.paintMain('Bet', 'go', !bet || bet.value > stack);
    };

    const send = (amount: Cents) => {
      busy = true;
      sentAt = performance.now();
      ctx.link.act({ type: 'bet', bet: amount, target });
    };

    const play = () => {
      const bet = site.bet;
      if (!bet || busy) return;
      if (bet.value > stack) {
        shortTone(ctx.sfx);
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      send(bet.value);
    };

    const playResult = async (ev: LimboEvent) => {
      site.auto?.driver.answered();
      screen.setStack(ev.stack - ev.payout);
      // Count up on a log scale, so 1.00× to 2.00× takes as long to read as 100× to 200×; on
      // Auto a little quicker, so a run reads as a run.
      const ms = Math.min(1_000, 220 + 170 * Math.log10(ev.result / 100)) * (site.locked ? 0.7 : 1);
      const top = ev.result / 100;
      let lastTick = -1;
      stage.classList.add('counting');
      await tween(
        ms,
        (k) => {
          const shown = k >= 1 ? ev.result : Math.min(ev.result, Math.floor(100 * top ** k));
          showNumber(shown, null);
          // the glow climbs with the count toward the target (held low while calm)
          glow.style.setProperty('--lb-rise', calm() ? '0.2' : Math.min(1, Math.log(Math.max(1, shown / 100)) / Math.log(Math.max(1.01, ev.target / 100))).toFixed(3));
          const t = Math.floor(k * 14);
          if (t !== lastTick && k < 1) {
            lastTick = t;
            siteTone(ctx.sfx, 520 + t * 55, 16, { type: 'triangle', gain: 0.018 });
          }
        },
        ease.out,
      );
      stage.classList.remove('counting');
      glow.style.setProperty('--lb-rise', '0');
      showNumber(ev.result, ev.win ? 'win' : 'lose');
      log.push([multText(ev.target), multText(ev.result), cents(ev.payout)], ev.win);
      screen.setStack(ev.stack);
      site.settle({
        bet: ev.bet,
        payout: ev.payout,
        mult: ev.win ? ev.target : 0,
        pill: multText(ev.result),
        moment: { title: `Limbo ${multText(ev.target)}`, sub: `The result reached ${multText(ev.result)} · pays ${cents(ev.payout)}` },
      });
    };

    render();

    return {
      onTable(snap) {
        stack = snap.you.stack;
        busy = false;
        site.table(snap);
        screen.setStack(stack);
        const v = snap.view as LimboView;
        site.history.clear();
        log.clear();
        for (const b of v.recent.slice(0, 9).reverse()) site.history.push(multText(b.result), b.win, false);
        for (const b of v.recent.slice(0, 4).reverse()) log.push([multText(b.target), multText(b.result), cents(b.payout)], b.win, false);
        const last = v.recent[0];
        if (last) {
          target = last.target;
          showNumber(last.result, last.win ? 'win' : 'lose');
          site.result.show(last.bet, last.payout, last.win ? last.target : 0, false);
        }
        render();
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
          sync();
        }
      },

      onSeat(msg) {
        site.seat(msg);
        stack = msg.stack;
        if (playing === 0) screen.setStack(stack);
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
        if (busy && performance.now() - sentAt > 6_000) {
          busy = false;
          sync();
        }
        site.update(dt);
      },

      dispose() {
        offTips();
        site.dispose();
      },
    };
  },
};
