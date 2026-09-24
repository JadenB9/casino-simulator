// Mines on the lounge computers (docs/rules/online-games-b.md §2): the desk as it stands on the
// floor, and the website on its monitor. Bet lays the mines on the server; each tile you turn
// asks the server what is under it, and where the other mines are never reaches this page until
// the round is over. Cash out any time after the first gem.

import './mines.css';
import type { GameClientModule, TableView } from '../contract.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import { formatMoney, type BetLimits, type Cents } from '../../../../shared/src/money.ts';
import { TILES, MIN_MINES, MAX_MINES, gemsOf, multiplier, returnAt, bestStop } from '../../../../shared/src/games/mines/rules.ts';
import type { MinesView } from '../../../../shared/src/games/mines/engine.ts';
import { celebrate } from '../../table/celebrate.ts';
import { attractTexture, pcModel, pcPose, pcScreenCorners, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { OnlineScreen, BetBox, NumberField, actionButton, InfoList, SessionTally, OutcomePop, commitTyping, winTier, siteTone, drawSiteBar, multText, pctText } from '../online/screen.ts';
import { MinesBoard } from './board.ts';

/** The chair's trim on the floor: Mines' mint. */
const ACCENT = '#2ee6a6';

const ret = (m: number, k: number) => {
  const r = returnAt(m, k);
  return r.num / r.den;
};

/** The monitor on the floor: the site's bar, a bet panel, and a board with gems turned. */
function drawAttract(g: CanvasRenderingContext2D, w: number, h: number): void {
  const top = drawSiteBar(g, w, 'Mines');
  g.fillStyle = '#1a2c38';
  g.fillRect(0, top, 132, h - top);
  g.textBaseline = 'middle';
  const field = (label: string, text: string, y: number) => {
    g.fillStyle = '#a7b4c6';
    g.font = '600 11px system-ui, sans-serif';
    g.fillText(label, 12, y);
    g.fillStyle = '#0f1e29';
    g.beginPath();
    g.roundRect(10, y + 8, 112, 28, 4);
    g.fill();
    g.fillStyle = '#eef3f8';
    g.font = '600 15px system-ui, sans-serif';
    g.fillText(text, 18, y + 23);
  };
  field('Bet', '$5.00', top + 18);
  field('Mines', '3', top + 70);
  g.fillStyle = '#f5b93b';
  g.beginPath();
  g.roundRect(10, top + 124, 112, 36, 5);
  g.fill();
  g.fillStyle = '#2a1a00';
  g.font = '800 15px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('Cash out', 66, top + 143);

  const s = 42;
  const gap = 8;
  const size = 5 * s + 4 * gap;
  const x0 = 132 + (w - 132 - size) / 2;
  const y0 = top + (h - top - size) / 2;
  const gems = new Set([6, 7, 12, 13, 17]);
  for (let i = 0; i < TILES; i++) {
    const x = x0 + (i % 5) * (s + gap);
    const y = y0 + Math.floor(i / 5) * (s + gap);
    const gem = gems.has(i);
    g.fillStyle = gem ? '#071824' : '#2f4553';
    g.beginPath();
    g.roundRect(x, y, s, s, 6);
    g.fill();
    if (!gem) {
      g.fillStyle = '#213743';
      g.fillRect(x + 3, y + s - 4, s - 6, 4);
      continue;
    }
    const cx = x + s / 2;
    const cy = y + s / 2;
    g.fillStyle = '#16c96d';
    g.beginPath();
    g.moveTo(cx - 13, cy - 3);
    g.lineTo(cx - 7, cy - 10);
    g.lineTo(cx + 7, cy - 10);
    g.lineTo(cx + 13, cy - 3);
    g.lineTo(cx, cy + 13);
    g.closePath();
    g.fill();
    g.fillStyle = '#9dffc9';
    g.beginPath();
    g.moveTo(cx - 4, cy - 10);
    g.lineTo(cx + 4, cy - 10);
    g.lineTo(cx + 6, cy - 3);
    g.lineTo(cx - 6, cy - 3);
    g.closePath();
    g.fill();
  }
  g.textAlign = 'left';
}

export const mines: GameClientModule = {
  game: 'mines',
  footprint: PC_FOOTPRINT,
  createModel: () => pcModel({ attract: attractTexture(drawAttract), accent: ACCENT }),
  seats: () => [{ position: PC_SEAT, yaw: Math.PI }],
  playPose: () => pcPose(),

  mount(ctx): TableView {
    const screen = new OnlineScreen('Mines');
    ctx.ui.append(screen.root);
    const corners = pcScreenCorners();

    let count = 3;
    let view: MinesView | null = null;
    let stack: Cents = 0;
    let animating = false;
    let busy = false;
    let limits: BetLimits | null = null;
    let bet: BetBox | null = null;
    let tipShown = false;

    const board = new MinesBoard((tile) => act({ type: 'reveal', tile }));
    const pop = new OutcomePop(screen.main);
    screen.main.append(board.root);

    const setCount = (n: number) => {
      count = Math.min(MAX_MINES, Math.max(MIN_MINES, Math.round(n)));
      minesField.set(count);
      gemsField.set(gemsOf(count));
      pop.hide();
      if (view?.phase !== 'playing') board.show({ revealed: [], field: null, hit: null, live: false });
      sync();
    };
    const minesField = new NumberField({ label: 'Mines', format: (n) => String(n), value: count, onCommit: (n) => setCount(n) });
    minesField.addButton('−', 'One mine fewer', () => setCount(count - 1));
    minesField.addButton('+', 'One mine more', () => setCount(count + 1));
    const gemsField = new NumberField({ label: 'Gems', format: (n) => String(n), value: gemsOf(count) });
    const counts = document.createElement('div');
    counts.className = 'mn-counts';
    counts.append(minesField.root, gemsField.root);
    const main = actionButton('Bet', () => primary());
    main.title = 'Bet, or cash out (Space)';
    const random = actionButton('Random tile', () => act({ type: 'random' }), 'plain');
    random.title = 'Turn a tile at random (R)';
    random.classList.add('mn-random');
    const info = new InfoList('This board');
    const tally = new SessionTally();
    screen.side.append(counts, main, random, info.root, tally.root);

    const playing = () => view?.phase === 'playing';

    const act = (a: object) => {
      if (busy || animating) return;
      busy = true;
      ctx.link.act(a);
      sync();
    };

    const primary = () => {
      commitTyping(screen.root);
      if (playing()) {
        if ((view?.revealed.length ?? 0) > 0) act({ type: 'cashout' });
        return;
      }
      if (!bet) return;
      if (bet.value > stack) {
        siteTone(ctx.sfx, 150, 120, { type: 'sawtooth', gain: 0.03 });
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      pop.hide();
      act({ type: 'bet', amount: bet.value, mines: count });
      siteTone(ctx.sfx, 520, 60, { type: 'triangle', gain: 0.04, to: 760 });
    };

    const sync = () => {
      const on = playing();
      const m = on && view ? view.mines : count;
      const found = on && view ? view.revealed.length : 0;
      if (!animating) screen.setStack(stack);
      bet?.setEnabled(!on && !busy);
      minesField.setEnabled(!on && !busy);
      if (on && view) {
        const cash = (view.bet / 100) * view.mult;
        main.className = 'os-action cash';
        main.textContent = found > 0 ? `Cash out ${formatMoney(cash)}` : 'Cash out';
        main.disabled = busy || animating || found === 0;
      } else {
        main.className = 'os-action go';
        main.textContent = 'Bet';
        main.disabled = busy || animating || !bet || bet.value > stack;
      }
      random.hidden = !on;
      random.disabled = busy || animating;
      board.setEnabled(on && !busy && !animating);

      const left = TILES - found;
      const gemsLeft = gemsOf(m) - found;
      if (on && found > 0 && view) info.set('now', 'Cash out now', `${multText(view.mult)} · ${formatMoney((view.bet / 100) * view.mult)}`, 'win');
      else info.set('now', 'Cash out now', '—');
      if (gemsLeft > 0) {
        info.set('next', `Gem ${found + 1} pays`, multText(multiplier(m, found + 1)));
        info.set('odds', 'Chance of a gem', `${gemsLeft} in ${left} · ${pctText(gemsLeft / left)}`);
        info.set('ret', `Return at ${found + 1} gem${found ? 's' : ''}`, pctText(ret(m, found + 1)));
      }
      const lim = limits ? ` · Bet ${formatMoney(limits.min)} to ${formatMoney(limits.max)}` : '';
      screen.setNote(`${m} mine${m > 1 ? 's' : ''}, ${gemsOf(m)} gems · Every cash-out returns 98.28% to 99.00%${lim} · Space bets and cashes out · R turns a random tile`);
      tipFor();
    };

    // Tips: the gem count with the best exact return from here (the cent floor is all that
    // separates the stops), which often means cashing out now.
    const clearTip = () => {
      if (!tipShown) return;
      tipShown = false;
      ctx.kit.tip(null);
      main.classList.remove('tip-pick');
    };
    const tipFor = () => {
      if (!ctx.tips.on || busy || animating) return clearTip();
      let text: string;
      let ring = false;
      if (playing() && view) {
        const m = view.mines;
        const found = view.revealed.length;
        if (found === 0) text = 'Every closed tile is as likely as the next to hide a mine: there is no pattern to find.';
        else {
          const best = bestStop(m, found);
          const now = ret(m, found);
          const later = Array.from({ length: gemsOf(m) - found }, (_, i) => ret(m, found + 1 + i));
          if (best > found) text = `Stopping at ${best} gems returns ${pctText(ret(m, best))} against ${pctText(now)} for cashing out now.`;
          else if (later.every((x) => x === now)) {
            text = `Every later stop returns the same ${pctText(now)}: going on adds risk, not value.`;
            ring = true;
          } else {
            text = `Cash out: no later stop returns more than stopping here (${pctText(now)}).`;
            ring = true;
          }
        }
      } else {
        const best = bestStop(count, 0);
        text = `With ${count} mine${count > 1 ? 's' : ''}, cashing out after ${best} gem${best > 1 ? 's' : ''} returns the most, ${pctText(ret(count, best))}; every stop returns 99% before the cent floor.`;
      }
      tipShown = true;
      ctx.kit.tip(text);
      main.classList.toggle('tip-pick', ring);
    };
    const offTips = ctx.tips.subscribe(tipFor);

    const redraw = (v: MinesView) => {
      view = v;
      if (v.phase !== 'idle') {
        count = v.mines;
        minesField.set(count);
        gemsField.set(gemsOf(count));
      }
      board.show({ revealed: v.revealed, field: v.field, hit: v.hit, live: v.phase === 'playing' });
    };

    const onOver = (e: GameEvent) => {
      const payout = Number(e.payout);
      const b = Number(e.bet);
      const mult = Number(e.mult);
      tally.add(b, payout);
      if (payout > 0) {
        pop.show(mult, payout, b);
        ctx.sfx.play('chips-stack', { volume: 0.6 });
        [784, 988, 1319].forEach((f, i) => siteTone(ctx.sfx, f, 140, { type: 'triangle', gain: 0.05, at: i * 70 }));
        const tier = winTier(payout, b);
        if (tier) {
          const title = e.outcome === 'cleared' ? 'Board cleared' : `Mines ${multText(mult)}`;
          celebrate({ stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx }, { title, sub: `${Number(e.gems)} gems · pays ${formatMoney(payout)} on ${formatMoney(b)}`, tier });
        }
      }
    };

    return {
      onTable(snap) {
        stack = snap.you.stack;
        busy = false;
        animating = false;
        const lim = snap.meta.config.limits.default;
        if (!bet || !limits || lim.min !== limits.min || lim.max !== limits.max || lim.step !== limits.step) {
          bet?.root.remove();
          limits = lim;
          bet = new BetBox({ label: 'Bet', min: lim.min, max: lim.max, step: lim.step, value: lim.min, onChange: () => sync() });
          screen.side.prepend(bet.root);
        }
        bet.setMax(stack);
        pop.hide();
        redraw(snap.view as MinesView);
        sync();
      },

      async onEvents(events, v) {
        const next = v as MinesView;
        animating = true;
        busy = false;
        sync();
        try {
          for (const e of events) {
            if (e.type === 'bet') {
              pop.hide();
              count = Number(e.mines);
              minesField.set(count);
              gemsField.set(gemsOf(count));
              board.show({ revealed: [], field: null, hit: null, live: true });
            } else if (e.type === 'reveal') {
              const safe = e.safe === true;
              await board.reveal(Number(e.tile), safe);
              if (safe) {
                // each gem a step higher, the way the site's chime climbs
                const f = 740 * 2 ** (Math.min(24, Number(e.gems) - 1) / 12);
                siteTone(ctx.sfx, f, 110, { type: 'sine', gain: 0.06 });
                siteTone(ctx.sfx, f * 2, 90, { type: 'triangle', gain: 0.02, at: 30 });
              } else {
                siteTone(ctx.sfx, 180, 460, { type: 'sawtooth', gain: 0.06, to: 40 });
                siteTone(ctx.sfx, 60, 320, { gain: 0.14 });
              }
            } else if (e.type === 'over') {
              await board.revealAll(e.field as number[], next.revealed, (e.hit as number | null) ?? next.revealed.at(-1) ?? null);
              onOver(e);
            } else if (e.type === 'void') {
              board.show({ revealed: [], field: null, hit: null, live: false });
            }
          }
        } finally {
          animating = false;
          redraw(next);
          sync();
        }
      },

      onSeat(msg) {
        stack = msg.stack;
        bet?.setMax(stack);
        sync();
      },

      onError() {
        busy = false;
        sync();
      },

      keydown(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        if (e.code === 'Space') {
          if (!e.repeat) primary();
          return true;
        }
        if (e.key.toLowerCase() === 'r' && playing()) {
          act({ type: 'random' });
          return true;
        }
        return false;
      },

      update() {
        const camera = ctx.stage.engine.camera;
        camera.updateMatrixWorld();
        ctx.stage.root.updateWorldMatrix(true, false);
        screen.follow(ctx.stage.root, camera, corners);
      },

      dispose() {
        offTips();
        clearTip();
        pop.hide();
        screen.dispose();
      },
    };
  },
};
