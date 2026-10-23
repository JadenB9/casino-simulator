// Tower on the lounge computers (docs/rules/online-games.md §5): the desk as it stands on the
// floor, and the website on its monitor. Bet builds a tower on the server; each pick asks the
// server whether that tile holds an egg, and nothing about the tiles you haven't picked reaches
// this page until the climb is over. Cash out any time after the first egg.
//
// Auto: set a path on the tower first, a tile on each row from the bottom up; each climb of a run
// bets, takes the path a row at a time (each pick waits for the server's answer, as a click
// would) and cashes out at its top, or ends on the dragon. Only the climb's own messages go.

import './tower.css';
import type { GameClientModule, TableView } from '../contract.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { DIFFICULTIES, SPECS, LEVELS, eggs, multiplier, returnAt, bestStop, type Difficulty } from '../../../../shared/src/games/tower/rules.ts';
import type { TowerView } from '../../../../shared/src/games/tower/engine.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { actionButton, SegChoice, InfoList, OutcomePop, labelled, siteTone, shortTone, drawSiteBar, drawAttractPanel, multText, pctText } from '../online/screen.ts';
import { OnlineSite } from '../online/site.ts';
import { TowerBoard } from './board.ts';

/** The chair's trim on the floor: Tower's ember orange. */
const ACCENT = '#ff8a1f';
const NAMES: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', master: 'Master' };

const ret = (d: Difficulty, k: number) => {
  const r = returnAt(d, k);
  return r.num / r.den;
};
/** Lowest and highest return of any row of a difficulty. */
function range(d: Difficulty): { lo: number; hi: number } {
  const all = Array.from({ length: LEVELS }, (_, i) => ret(d, i + 1));
  return { lo: Math.min(...all), hi: Math.max(...all) };
}
const EXACT = DIFFICULTIES.filter((d) => range(d).lo === 0.99);

/** The monitor on the floor: the site's bar, a bet panel, and a tower half climbed. */
function drawAttract(g: CanvasRenderingContext2D, w: number, h: number): void {
  const top = drawSiteBar(g, w, 'Tower');
  const left = drawAttractPanel(g, top, h, [['Bet', '$10.00'], ['Difficulty', 'Medium']], 'Bet');

  // The tower: nine rows of three, the bottom four climbed.
  const cols = 3;
  const rows = LEVELS;
  const tw = 60;
  const th = 21;
  const gap = 5;
  const width = cols * tw + (cols - 1) * gap;
  const x0 = left + (w - left - width) / 2 + 22;
  const y0 = h - 16;
  g.fillStyle = '#13242f';
  g.beginPath();
  g.roundRect(x0 - 62, top + 10, width + 74, h - top - 18, 8);
  g.fill();
  const climbed = [1, 0, 2, 1];
  for (let r = 0; r < rows; r++) {
    const y = y0 - (r + 1) * (th + gap);
    g.fillStyle = r === climbed.length ? '#eef3f8' : '#8b9cb0';
    g.font = '600 12px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText(`${(multiplier('medium', r + 1) / 100).toFixed(2)}×`, x0 - 8, y + th / 2);
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * (tw + gap);
      const egg = climbed[r] === c;
      g.fillStyle = egg ? '#3a2c10' : r === climbed.length ? '#3d5a6c' : '#213743';
      g.beginPath();
      g.roundRect(x, y, tw, th, 4);
      g.fill();
      if (egg) {
        const eg = g.createRadialGradient(x + tw / 2 - 2, y + th / 2 - 3, 1, x + tw / 2, y + th / 2, 8);
        eg.addColorStop(0, '#fff5cf');
        eg.addColorStop(0.5, '#ffc93f');
        eg.addColorStop(1, '#b8700f');
        g.fillStyle = eg;
        g.beginPath();
        g.ellipse(x + tw / 2, y + th / 2 + 0.5, 6, 8, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  g.textAlign = 'left';
}

export const tower: GameClientModule = {
  game: 'tower',
  footprint: PC_FOOTPRINT,
  createModel: () => pcModel({ attract: attractTexture(drawAttract), accent: ACCENT }),
  seats: () => [{ position: PC_SEAT, yaw: Math.PI }],
  playPose: () => pcPose(),

  mount(ctx): TableView {
    let difficulty: Difficulty = 'easy';
    let view: TowerView | null = null;
    /** The seat's stack as the server last said, and what the page shows (it catches up after an animation). */
    let stack: Cents = 0;
    let animating = false;
    /** An action is on its way to the server. */
    let busy = false;
    let sentAt = 0;
    /** Auto's path: the tile it takes on each row, from the bottom up. */
    let path: number[] = [];
    /** The climb on the board is a run's: the page takes its path and cashes out itself. */
    let autoRound = false;

    const site = new OnlineSite(ctx, {
      game: 'tower',
      title: 'Tower',
      action: 'Bet',
      primary: () => primary(),
      sync: () => sync(),
      auto: {
        gapMs: 600,
        play: () => {
          const bet = site.bet;
          if (!bet || busy || animating || climbing()) return false;
          if (path.length === 0) return 'set a path on the tower first';
          if (bet.value > stack) return 'not enough chips here for the next climb';
          autoRound = true;
          pop.hide();
          act({ type: 'bet', amount: bet.value, difficulty });
          return true;
        },
      },
    });
    const screen = site.screen;

    const board = new TowerBoard(
      (_row, tile) => act({ type: 'pick', tile }),
      (row, tile) => choose(row, tile),
    );
    const pop = new OutcomePop(screen.main);
    screen.main.append(board.root);

    const diffSeg = new SegChoice(DIFFICULTIES.map((d) => ({ value: d, label: NAMES[d], title: `${SPECS[d].tiles} tiles a row, ${SPECS[d].bad} dragon${SPECS[d].bad > 1 ? 's' : ''}` })), difficulty, (d) => {
      difficulty = d;
      // a path for another width of tower doesn't fit this one
      path = path.filter((t) => t < SPECS[d].tiles);
      pop.hide();
      board.setup(d);
      board.show({ level: 0, picks: [], active: null, tower: null, bust: false });
      siteTone(ctx.sfx, 880, 30, { type: 'triangle', gain: 0.03 });
      sync();
    }).label('Difficulty');
    diffSeg.root.classList.add('dense');
    site.controls.append(labelled('Difficulty', diffSeg.root));
    const random = actionButton('Random pick', () => act({ type: 'random' }), 'plain', 'R');
    random.title = 'Pick a tile at random (R)';
    random.classList.add('tw-random');
    const pathNote = el('div', 'tw-path-note');
    const clearPath = actionButton('Clear path', () => {
      path = [];
      sync();
    }, 'plain');
    clearPath.classList.add('tw-random');
    site.extras.append(random, pathNote, clearPath);
    const info = new InfoList('This climb');
    site.facts.append(info.root);

    const climbing = () => view?.phase === 'climbing';

    const act = (a: object) => {
      if (busy || animating) return;
      busy = true;
      sentAt = performance.now();
      ctx.link.act(a);
      site.auto?.driver.asked();
      sync();
    };

    /** A click on the tower while Auto's path is being set: that row's tile, from the bottom up. */
    const choose = (row: number, tile: number) => {
      if (site.locked || climbing()) return;
      if (row > path.length) {
        siteTone(ctx.sfx, 150, 110, { type: 'sawtooth', gain: 0.025 });
        return;
      }
      if (path[row] === tile) path = path.slice(0, row);
      else {
        path = path.slice(0, row);
        path.push(tile);
      }
      siteTone(ctx.sfx, 660 * 2 ** (row / 12), 30, { type: 'triangle', gain: 0.03 });
      pop.hide();
      if (view?.phase === 'over') board.show({ level: 0, picks: [], active: null, tower: null, bust: false });
      sync();
    };

    const primary = () => {
      if (climbing()) {
        if ((view?.level ?? 0) > 0) act({ type: 'cashout' });
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
      act({ type: 'bet', amount: bet.value, difficulty });
      siteTone(ctx.sfx, 520, 60, { type: 'triangle', gain: 0.04, to: 760 });
    };

    /** A run's climb goes on by itself: the path's next row, or the cash-out at its top. */
    const autoStep = () => {
      if (!autoRound || !site.locked || !climbing() || !view || busy || animating) return;
      const level = view.level;
      const tile = path[level];
      if (tile !== undefined && level < LEVELS) act({ type: 'pick', tile });
      else act({ type: 'cashout' });
    };

    /** Buttons, fields and facts for the moment the game is in. */
    const sync = () => {
      const up = climbing();
      const level = view?.level ?? 0;
      const d = up && view ? view.difficulty : difficulty;
      const locked = site.locked;
      const autoOn = site.autoOn;
      site.midRound = up;
      if (!animating) screen.setStack(stack);
      const bet = site.bet;
      bet?.setMax(stack);
      bet?.setEnabled(!up && !busy && !locked);
      diffSeg.setEnabled(!up && !busy && !locked);
      if (up) {
        const cash = level > 0 && view ? (view.bet / 100) * view.mult : 0;
        site.paintMain(level > 0 ? `Cash out ${formatMoney(cash)}` : 'Cash out', 'cash', busy || animating || level === 0 || (locked && autoRound));
      } else site.paintMain('Bet', 'go', busy || animating || !bet || bet.value > stack, !!bet && bet.value <= stack && path.length > 0);
      random.hidden = !up || locked;
      random.disabled = busy || animating;
      board.setChoosing(autoOn, path, !locked);
      board.setEnabled(up && !busy && !animating && !(locked && autoRound));
      pathNote.hidden = !autoOn || up;
      clearPath.hidden = !autoOn || up || locked || path.length === 0;
      pathNote.textContent =
        path.length === 0 ? 'Set the path on the tower: a tile on each row, from the bottom up.' : `${path.length} row${path.length > 1 ? 's' : ''} a climb · cashes out at ${multText(multiplier(d, Math.min(LEVELS, path.length)))}`;
      site.auto?.setEnabled(!up && !busy && !animating);

      const next = Math.min(LEVELS, up ? level + 1 : 1);
      const { tiles } = SPECS[d];
      const stake = up && view ? view.bet : (bet?.value ?? site.limits?.min ?? 100);
      if (up && level === LEVELS) site.profit('Top reached', null);
      else site.profit(`Profit on row ${next}`, (stake / 100) * multiplier(d, next) - stake, `${multText(multiplier(d, next))} · ${pctText(eggs(d) / tiles)}`);
      if (up && level > 0 && view) info.set('now', 'Cash out now', `${multText(view.mult)} · ${formatMoney((view.bet / 100) * view.mult)}`, 'win');
      else info.set('now', 'Cash out now', '—');
      info.set('next', up && level === LEVELS ? 'Top reached' : `Row ${next} pays`, multText(multiplier(d, next)));
      info.set('odds', 'Chance of an egg', `${eggs(d)} in ${tiles} · ${pctText(eggs(d) / tiles)}`);
      info.set('ret', `Return at row ${next}`, pctText(ret(d, next), 2));
      const rr = range(d);
      const span = rr.lo === rr.hi ? `${pctText(rr.hi)} on every row` : `${pctText(rr.lo)} to ${pctText(rr.hi)} by row`;
      const lim = site.limits;
      const limText = lim ? ` · Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}` : '';
      screen.setNote(`${NAMES[d]}: ${tiles} tiles a row, ${SPECS[d].bad} dragon${SPECS[d].bad > 1 ? 's' : ''} · Return ${span}${limText} · Space bets and cashes out · 1-${tiles} pick · R picks at random`);
      tipFor();
    };

    // Tips: Hard, Expert and Master return exactly 99% on every row, Easy and Medium a little
    // less on some. Mid-climb, the row with the best return from here (the floor to the cent is
    // all that separates them), which is often simply cashing out now.
    const clearTip = () => {
      site.tip(null);
      diffSeg.tip(null);
      site.main.classList.remove('tip-pick');
    };
    const tipFor = () => {
      if (!ctx.tips.on || busy || animating) return clearTip();
      let text: string;
      let ringMain = false;
      diffSeg.tip(null);
      if (climbing() && view) {
        const d = view.difficulty;
        const level = view.level;
        if (level === 0) text = 'Every tile is as likely as the next to hide the dragon: there is no pattern to find.';
        else {
          const best = bestStop(d, level);
          const now = ret(d, level);
          const above = Array.from({ length: LEVELS - level }, (_, i) => ret(d, level + 1 + i));
          // Given the eggs found, both are this row's chance of getting here away from their
          // plans' returns, so the ratio of the returns is the gain from here.
          if (best > level) text = `From here, stopping at row ${best} is worth ${pctText(ret(d, best) / now - 1)} more on average than cashing out now: the floor to the cent takes less there.`;
          else if (above.every((x) => x === now)) {
            text = `Every row above returns the same ${pctText(now)}: climbing adds risk, not value.`;
            ringMain = true;
          } else {
            text = `Cash out: no row above returns more than stopping here (${pctText(now)}).`;
            ringMain = true;
          }
        }
      } else {
        const d = difficulty;
        const rr = range(d);
        if (EXACT.includes(d)) text = `${NAMES[d]} returns exactly 99% on every row. Easy and Medium lose a little more to the cent, down to ${pctText(range('medium').lo)}.`;
        else text = `${NAMES[d]} returns ${pctText(rr.lo)} to ${pctText(rr.hi)} by row; Hard, Expert and Master return exactly 99% on every row.`;
        diffSeg.tip(EXACT.includes(d) ? d : 'hard');
      }
      site.tip(text);
      site.main.classList.toggle('tip-pick', ringMain);
    };
    const offTips = ctx.tips.subscribe(tipFor);

    const redraw = (v: TowerView) => {
      view = v;
      if (v.phase !== 'idle') {
        difficulty = v.difficulty;
        diffSeg.set(difficulty);
      }
      board.setup(difficulty);
      board.show({
        level: v.level,
        picks: v.picks,
        active: v.phase === 'climbing' ? v.level : null,
        tower: v.tower,
        bust: v.result?.outcome === 'bust',
      });
    };

    const onOver = (e: GameEvent) => {
      const payout = Number(e.payout);
      const b = Number(e.bet);
      const mult = Number(e.mult);
      autoRound = false;
      if (payout > 0) {
        pop.show(mult, payout, b);
        ctx.sfx.play('chips-stack', { volume: 0.6 });
      }
      site.settle({
        bet: b,
        payout,
        mult,
        moment: { title: e.outcome === 'top' ? 'Top of the tower' : `Tower ${multText(mult)}`, sub: `Pays ${formatMoney(payout)} on ${formatMoney(b)}` },
      });
    };

    return {
      onTable(snap) {
        stack = snap.you.stack;
        busy = false;
        animating = false;
        autoRound = false;
        site.table(snap);
        pop.hide();
        redraw(snap.view as TowerView);
        sync();
      },

      async onEvents(events, v) {
        const next = v as TowerView;
        animating = true;
        busy = false;
        site.auto?.driver.answered();
        sync();
        try {
          for (const e of events) {
            if (e.type === 'bet') {
              pop.hide();
              difficulty = e.difficulty as Difficulty;
              diffSeg.set(difficulty);
              board.setup(difficulty);
              board.show({ level: 0, picks: [], active: 0, tower: null, bust: false });
            } else if (e.type === 'pick') {
              const safe = e.safe === true;
              await board.pick(Number(e.row), Number(e.tile), safe);
              if (safe) {
                const f = 660 * 2 ** (Number(e.row) / 12);
                siteTone(ctx.sfx, f, 90, { type: 'triangle', gain: 0.05 });
                siteTone(ctx.sfx, f * 1.5, 120, { type: 'triangle', gain: 0.04, at: 70 });
              } else {
                siteTone(ctx.sfx, 200, 420, { type: 'sawtooth', gain: 0.06, to: 48 });
                siteTone(ctx.sfx, 70, 260, { gain: 0.12 });
              }
            } else if (e.type === 'over') {
              await board.revealAll(e.tower as number[][], next.picks);
              onOver(e);
            } else if (e.type === 'void') {
              board.show({ level: 0, picks: [], active: null, tower: null, bust: false });
            }
          }
        } finally {
          animating = false;
          redraw(next);
          sync();
          autoStep();
        }
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
        const n = Number(e.key);
        if (/^[1-4]$/.test(e.key)) return board.pickKey(n);
        if (e.key.toLowerCase() === 'r' && climbing()) {
          act({ type: 'random' });
          return true;
        }
        return false;
      },

      update(dt) {
        // An action the server never answered (the socket dropped it) frees the page again.
        if (busy && performance.now() - sentAt > 6_000) {
          busy = false;
          sync();
        }
        site.update(dt);
      },

      dispose() {
        offTips();
        clearTip();
        pop.hide();
        site.dispose();
      },
    };
  },
};
