// Mines on the lounge computers (docs/rules/online-games.md §6): the desk as it stands on the
// floor, and the website on its monitor. Bet lays the mines on the server; each tile you turn
// asks the server what is under it, and where the other mines are never reaches this page until
// the round is over. Cash out any time after the first gem.
//
// Auto: pick the tiles on the board first; each round of a run bets, turns them in the order they
// were picked (each turn waits for the server's answer, as a click would) and cashes out once the
// last is a gem, or ends on the mine. Only the round's own messages go: bet, reveal, cashout.

import './mines.css';
import type { GameClientModule, TableView } from '../contract.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { TILES, MIN_MINES, MAX_MINES, gemsOf, multiplier, returnAt, bestStop } from '../../../../shared/src/games/mines/rules.ts';
import type { MinesView } from '../../../../shared/src/games/mines/engine.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { NumberField, actionButton, InfoList, OutcomePop, siteTone, shortTone, drawSiteBar, drawAttractPanel, multText, pctText } from '../online/screen.ts';
import { OnlineSite } from '../online/site.ts';
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
  const left = drawAttractPanel(g, top, h, [['Bet', '$5.00'], ['Mines', '3']], 'Bet');

  const s = 42;
  const gap = 8;
  const size = 5 * s + 4 * gap;
  const x0 = left + (w - left - size) / 2;
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
    let count = 3;
    let view: MinesView | null = null;
    let stack: Cents = 0;
    let animating = false;
    let busy = false;
    let sentAt = 0;
    /** Auto's tiles, in the order they were picked. */
    let chosen: number[] = [];
    /** The round on the board is a run's: the page turns its tiles and cashes out itself. */
    let autoRound = false;

    const site = new OnlineSite(ctx, {
      game: 'mines',
      title: 'Mines',
      action: 'Bet',
      primary: () => primary(),
      sync: () => sync(),
      auto: {
        gapMs: 600,
        play: () => {
          const bet = site.bet;
          if (!bet || busy || animating || playing()) return false;
          if (chosen.length === 0) return 'pick the tiles a round turns first';
          if (bet.value > stack) return 'not enough chips here for the next board';
          autoRound = true;
          pop.hide();
          act({ type: 'bet', amount: bet.value, mines: count });
          return true;
        },
      },
    });
    const screen = site.screen;
    // on a phone the page keeps the grid (548 px) and a margin, so the tiles come up big enough to tap
    screen.flatWidth(600);

    const board = new MinesBoard(
      (tile) => act({ type: 'reveal', tile }),
      (tile) => choose(tile),
    );
    const pop = new OutcomePop(screen.main);
    screen.main.append(board.root);

    const setCount = (n: number) => {
      if (site.locked) return;
      count = Math.min(MAX_MINES, Math.max(MIN_MINES, Math.round(n)));
      minesField.set(count);
      gemsField.set(gemsOf(count));
      // a pick can't be one more tile than there are gems
      if (chosen.length > gemsOf(count)) chosen = chosen.slice(0, gemsOf(count));
      pop.hide();
      if (view?.phase !== 'playing') board.show({ revealed: [], field: null, hit: null, live: false });
      sync();
    };
    const minesField = new NumberField({ label: 'Mines', format: (n) => String(n), value: count, onCommit: (n) => setCount(n) });
    minesField.addButton('−', 'One mine fewer', () => setCount(count - 1));
    minesField.addButton('+', 'One mine more', () => setCount(count + 1));
    const gemsField = new NumberField({ label: 'Gems', format: (n) => String(n), value: gemsOf(count) });
    const counts = el('div', 'mn-counts');
    counts.append(minesField.root, gemsField.root);
    site.controls.append(counts);
    const random = actionButton('Random tile', () => act({ type: 'random' }), 'plain', 'R');
    random.title = 'Turn a tile at random (R)';
    random.classList.add('mn-random');
    // Auto: the tiles a round turns, picked on the board
    const choiceNote = el('div', 'mn-choose-note');
    const clearChoice = actionButton('Clear picks', () => {
      chosen = [];
      sync();
    }, 'plain');
    clearChoice.classList.add('mn-random');
    site.extras.append(random, choiceNote, clearChoice);
    const info = new InfoList('This board');
    site.facts.append(info.root);

    const playing = () => view?.phase === 'playing';

    const act = (a: object) => {
      if (busy || animating) return;
      busy = true;
      sentAt = performance.now();
      ctx.link.act(a);
      site.auto?.driver.asked();
      sync();
    };

    /** A click on the board while Auto is being set: ring the tile, or take its ring off. */
    const choose = (tile: number) => {
      if (site.locked || playing()) return;
      const i = chosen.indexOf(tile);
      if (i >= 0) chosen.splice(i, 1);
      else if (chosen.length < gemsOf(count)) chosen.push(tile);
      else {
        siteTone(ctx.sfx, 150, 110, { type: 'sawtooth', gain: 0.025 });
        return;
      }
      siteTone(ctx.sfx, i >= 0 ? 520 : 700 + chosen.length * 30, 30, { type: 'triangle', gain: 0.03 });
      pop.hide();
      if (view?.phase === 'over') board.show({ revealed: [], field: null, hit: null, live: false });
      sync();
    };

    const primary = () => {
      if (playing()) {
        if ((view?.revealed.length ?? 0) > 0) act({ type: 'cashout' });
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
      act({ type: 'bet', amount: bet.value, mines: count });
      siteTone(ctx.sfx, 520, 60, { type: 'triangle', gain: 0.04, to: 760 });
    };

    /** A run's round goes on by itself: the next picked tile, or the cash-out after the last. */
    const autoStep = () => {
      if (!autoRound || !site.locked || !playing() || !view || busy || animating) return;
      const next = chosen.find((t) => !view!.revealed.includes(t));
      if (next !== undefined) act({ type: 'reveal', tile: next });
      else act({ type: 'cashout' });
    };

    const sync = () => {
      const on = playing();
      const m = on && view ? view.mines : count;
      const found = on && view ? view.revealed.length : 0;
      const locked = site.locked;
      const autoOn = site.autoOn;
      site.midRound = on;
      if (!animating) screen.setStack(stack);
      const bet = site.bet;
      bet?.setMax(stack);
      bet?.setEnabled(!on && !busy && !locked);
      minesField.setEnabled(!on && !busy && !locked);
      if (on && view) {
        const cash = (view.bet / 100) * view.mult;
        site.paintMain(found > 0 ? `Cash out ${formatMoney(cash)}` : 'Cash out', 'cash', busy || animating || found === 0 || (locked && autoRound));
      } else site.paintMain('Bet', 'go', busy || animating || !bet || bet.value > stack, !!bet && bet.value <= stack && chosen.length > 0);
      random.hidden = !on || locked;
      random.disabled = busy || animating;
      // Auto: the picks are ringed, and between runs the board takes them
      const choosing = autoOn && !on && !locked;
      board.setChoosing(autoOn, chosen, !locked);
      board.setEnabled(on && !busy && !animating && !(locked && autoRound));
      choiceNote.hidden = !autoOn || on;
      clearChoice.hidden = !choosing || chosen.length === 0;
      choiceNote.textContent =
        chosen.length === 0 ? 'Pick the tiles each round turns, on the board.' : `${chosen.length} tile${chosen.length > 1 ? 's' : ''} a round · cashes out at ${multText(multiplier(count, chosen.length))}`;
      site.auto?.setEnabled(!on && !busy && !animating);

      const left = TILES - found;
      const gemsLeft = gemsOf(m) - found;
      const stake = on && view ? view.bet : (bet?.value ?? site.limits?.min ?? 100);
      if (gemsLeft > 0) site.profit(`Profit on gem ${found + 1}`, (stake / 100) * multiplier(m, found + 1) - stake, `${multText(multiplier(m, found + 1))} · ${pctText(gemsLeft / left)}`);
      else site.profit('Board cleared', null);
      if (on && found > 0 && view) info.set('now', 'Cash out now', `${multText(view.mult)} · ${formatMoney((view.bet / 100) * view.mult)}`, 'win');
      else info.set('now', 'Cash out now', '—');
      if (gemsLeft > 0) {
        info.set('next', `Gem ${found + 1} pays`, multText(multiplier(m, found + 1)));
        info.set('odds', 'Chance of a gem', `${gemsLeft} in ${left} · ${pctText(gemsLeft / left)}`);
        info.set('ret', `Return at ${found + 1} gem${found ? 's' : ''}`, pctText(ret(m, found + 1)));
      }
      const lim = site.limits;
      const limText = lim ? ` · Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}` : '';
      screen.setNote(`${m} mine${m > 1 ? 's' : ''}, ${gemsOf(m)} gems · Every cash-out returns 98.28% to 99.00%${limText} · Space bets and cashes out · R turns a random tile`);
      tipFor();
    };

    // Tips: the gem count with the best exact return from here (the cent floor is all that
    // separates the stops), which often means cashing out now.
    const tipFor = () => {
      site.main.classList.remove('tip-pick');
      if (!ctx.tips.on || busy || animating) return site.tip(null);
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
          // Given the gems found, the ratio of the two plans' returns is the gain from here.
          if (best > found) text = `From here, stopping at ${best} gems is worth ${pctText(ret(m, best) / now - 1)} more on average than cashing out now: the floor to the cent takes less there.`;
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
        const all = Array.from({ length: gemsOf(count) }, (_, i) => ret(count, i + 1));
        const lo = Math.min(...all);
        text =
          lo === 0.99
            ? `With ${count} mine${count > 1 ? 's' : ''} every cash-out returns exactly 99%: where you stop only changes the swings.`
            : `With ${count} mine${count > 1 ? 's' : ''} a cash-out returns ${pctText(lo)} to ${pctText(ret(count, best))} (the floor to the cent is the difference); ${best} gem${best > 1 ? 's' : ''} returns the most.`;
      }
      site.tip(text);
      site.main.classList.toggle('tip-pick', ring);
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
      autoRound = false;
      if (payout > 0) {
        pop.show(mult, payout, b);
        ctx.sfx.play('chips-stack', { volume: 0.6 });
      }
      site.settle({
        bet: b,
        payout,
        mult,
        moment: { title: e.outcome === 'cleared' ? 'Board cleared' : `Mines ${multText(mult)}`, sub: `${Number(e.gems)} gems · pays ${formatMoney(payout)} on ${formatMoney(b)}` },
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
        redraw(snap.view as MinesView);
        sync();
      },

      async onEvents(events, v) {
        const next = v as MinesView;
        animating = true;
        busy = false;
        site.auto?.driver.answered();
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
        if (e.key.toLowerCase() === 'r' && playing() && !site.locked) {
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
        pop.hide();
        site.dispose();
      },
    };
  },
};
