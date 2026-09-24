// Plinko on the lounge computers: the desk as it stands on the floor, and the website on its
// monitor (docs/rules/online-games.md §1). Every Drop is a round of its own: the server settles it
// at once and sends the path, and a ball plays that path down the pegs while more can follow it.
// The chips at the top of the page count a ball's payout only when it lands, the way the site
// would; the server has already paid it.

import './plinko.css';
import type { GameClientModule, TableView } from '../contract.ts';
import { formatMoney, type BetLimits, type Cents } from '../../../../shared/src/money.ts';
import { ROWS, RISKS, RISK_NAMES, MULTS, binChance, boardRtp, bestBoard, returnRange, type Risk, type Rows } from '../../../../shared/src/games/plinko/rules.ts';
import type { DropEvent, PlinkoView } from '../../../../shared/src/games/plinko/engine.ts';
import { celebrate } from '../../table/celebrate.ts';
import { attractTexture, pcModel, pcPose, pcScreenCorners, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { OnlineScreen, BetBox, actionButton, SegChoice, InfoList, SessionTally, commitTyping, labelled, winTier, siteTone, drawSiteBar } from '../online/screen.ts';
import { PlinkoBoard, binColor, multText } from './board.ts';

/** The chair's trim on the floor: Plinko's pink. */
const ACCENT = '#ff3d7f';
const MIN_GAP_MS = 90;

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const oneIn = (p: number) => `1 in ${Math.round(1 / p).toLocaleString('en-US')}`;
const chance = (p: number) => (p >= 0.001 ? pct(p) : `${(p * 100).toPrecision(2)}%`);

/** The monitor on the floor: the site's bar, a bet panel, and a ten-row board with a ball on it. */
function drawAttract(g: CanvasRenderingContext2D, w: number, h: number): void {
  const top = drawSiteBar(g, w, 'Plinko');
  g.fillStyle = '#1a2c38';
  g.fillRect(0, top, 132, h - top);
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
  g.textBaseline = 'middle';
  field('Bet', '$5.00', top + 18);
  field('Risk', 'Medium', top + 70);
  field('Rows', '10', top + 122);
  g.fillStyle = '#1fd65f';
  g.beginPath();
  g.roundRect(10, top + 176, 112, 36, 5);
  g.fill();
  g.fillStyle = '#06210f';
  g.font = '800 16px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('Drop', 66, top + 195);

  const rows = 10;
  const s = 25;
  const gap = 22.5;
  const cx = 132 + (w - 132) / 2;
  const y0 = top + 30;
  g.fillStyle = '#ffffff';
  for (let r = 0; r < rows; r++) {
    for (let j = 0; j < r + 3; j++) {
      g.beginPath();
      g.arc(cx + (j - (r + 2) / 2) * s, y0 + r * gap, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  const binTop = y0 + (rows - 1) * gap + 13;
  const mults = MULTS[10].medium;
  g.font = '700 9px system-ui, sans-serif';
  for (let k = 0; k <= rows; k++) {
    const { face, lip } = binColor(k, rows);
    const x = cx + (k - rows / 2) * s;
    g.fillStyle = lip;
    g.fillRect(x - 10.5, binTop + 3, 21, 18);
    g.fillStyle = face;
    g.fillRect(x - 10.5, binTop, 21, 18);
    g.fillStyle = 'rgba(28, 6, 2, 0.9)';
    g.fillText(multText(mults[k]!).replace('×', ''), x, binTop + 9.5);
  }
  const ball = g.createRadialGradient(cx - 14, y0 + 4 * gap - 14, 1, cx - 12, y0 + 4 * gap - 12, 7);
  ball.addColorStop(0, '#ff9cb6');
  ball.addColorStop(1, '#d0103e');
  g.fillStyle = ball;
  g.beginPath();
  g.arc(cx - 12.5, y0 + 4 * gap - 10, 7, 0, Math.PI * 2);
  g.fill();
  g.textAlign = 'left';
}

export const plinko: GameClientModule = {
  game: 'plinko',
  footprint: PC_FOOTPRINT,
  createModel: () => pcModel({ attract: attractTexture(drawAttract), accent: ACCENT }),
  seats: () => [{ position: PC_SEAT, yaw: Math.PI }],
  playPose: () => pcPose(),

  mount(ctx): TableView {
    const screen = new OnlineScreen('Plinko');
    ctx.ui.append(screen.root);
    const corners = pcScreenCorners();

    let rows: Rows = 16;
    let risk: Risk = 'medium';
    /** The seat's stack as the server last said: every drop already paid. */
    let stack: Cents = 0;
    /** Payouts of balls still falling: in `stack` already, not yet on the page. */
    let falling: Cents = 0;
    /** Drops sent and not yet answered. */
    let waiting = 0;
    let sentAt = 0;
    let tickAt = 0;
    let limits: BetLimits | null = null;
    let bet: BetBox | null = null;
    let tipShown = false;

    const board = new PlinkoBoard({
      peg: () => {
        const now = performance.now();
        if (now - tickAt < 28) return;
        tickAt = now;
        siteTone(ctx.sfx, 1250 + Math.random() * 500, 24, { type: 'triangle', gain: 0.018 });
      },
      land: (d) => landed(d),
      describe: (k) => {
        const m = MULTS[rows][risk][k]!;
        const b = bet?.value ?? limits?.min ?? 100;
        const p = binChance(rows, k);
        return [
          ['Pays', `${formatMoney((b / 100) * m)} (${multText(m)})`],
          ['Profit', formatMoney((b / 100) * m - b, { sign: true })],
          ['Chance', p < 0.01 ? `${chance(p)} · ${oneIn(p)}` : chance(p)],
        ];
      },
    });
    screen.main.append(board.root);

    const riskSeg = new SegChoice(RISKS.map((r) => ({ value: r, label: RISK_NAMES[r] })), risk, (r) => {
      risk = r;
      boardChanged();
    });
    const rowsSeg = new SegChoice(ROWS.map((n) => ({ value: n, label: String(n), title: `${n} rows` })), rows, (n) => {
      rows = n;
      boardChanged();
    });
    rowsSeg.root.classList.add('dense');
    const dropBtn = actionButton('Drop', () => drop());
    dropBtn.title = 'Drop a ball (Space)';
    dropBtn.classList.add('os-fixed');
    const info = new InfoList('This board');
    const tally = new SessionTally();
    screen.side.append(labelled('Risk', riskSeg.root), labelled('Rows', rowsSeg.root), dropBtn, info.root, tally.root);

    const sync = () => {
      screen.setStack(stack - falling);
      bet?.setMax(stack);
      dropBtn.disabled = !bet || bet.value > stack;
      // The board can't change under a ball: rows and risk wait for the last one to land.
      const busy = board.inFlight > 0 || waiting > 0;
      riskSeg.setEnabled(!busy);
      rowsSeg.setEnabled(!busy);
    };

    const describeBoard = () => {
      const rtp = boardRtp(rows, risk);
      const mults = MULTS[rows][risk];
      // The chance of each multiplier (bins that print the same one count together).
      const byMult = new Map<number, number>();
      for (let k = 0; k <= rows; k++) byMult.set(mults[k]!, (byMult.get(mults[k]!) ?? 0) + binChance(rows, k));
      let likely: [number, number] = [0, 0];
      let back = 0;
      for (const [m, p] of byMult) {
        if (p > likely[1]) likely = [m, p];
        if (m >= 100) back += p;
      }
      info.set('rtp', 'Return', pct(rtp));
      info.set('top', 'Top pay', multText(mults[0]!));
      info.set('odds', 'Top pay odds', oneIn(2 / 2 ** rows));
      info.set('likely', 'Most likely', `${multText(likely[0])} · ${pct(likely[1])}`);
      info.set('back', 'Pays the bet or more', pct(back));
      const range = limits ? ` · Bet ${formatMoney(limits.min)} to ${formatMoney(limits.max)}` : '';
      screen.setNote(`Return ${pct(rtp)} · ${rows} rows, ${RISK_NAMES[risk]}${range} · Space drops a ball`);
    };

    // Tips: the board's return against the best one. Every board pays about the same; the tip
    // says so, and rings 11 rows, High, which returns the most.
    const range = returnRange();
    const best = bestBoard();
    const tipFor = () => {
      if (!ctx.tips.on) {
        if (tipShown) {
          tipShown = false;
          ctx.kit.tip(null);
          riskSeg.tip(null);
          rowsSeg.tip(null);
        }
        return;
      }
      tipShown = true;
      const here = boardRtp(rows, risk);
      ctx.kit.tip(
        rows === best.rows && risk === best.risk
          ? `${best.rows} rows, ${RISK_NAMES[best.risk]} returns ${pct(best.rtp)}: the most of any board.`
          : `This board returns ${pct(here)}. Every board is ${pct(range.min)} to ${pct(range.max)}; ${best.rows} rows, ${RISK_NAMES[best.risk]} returns the most.`,
      );
      riskSeg.tip(best.risk);
      rowsSeg.tip(best.rows);
    };
    const offTips = ctx.tips.subscribe(tipFor);

    const boardChanged = () => {
      board.setBoard(rows, risk);
      describeBoard();
      tipFor();
      siteTone(ctx.sfx, 880, 30, { type: 'triangle', gain: 0.03 });
    };

    const drop = () => {
      if (!bet) return;
      commitTyping(screen.root);
      const now = performance.now();
      if (now - sentAt < MIN_GAP_MS) return;
      if (bet.value > stack) {
        siteTone(ctx.sfx, 150, 120, { type: 'sawtooth', gain: 0.03 });
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      sentAt = now;
      waiting++;
      ctx.link.act({ type: 'drop', bet: bet.value, rows, risk });
      siteTone(ctx.sfx, 560, 45, { type: 'triangle', gain: 0.04, to: 820 });
      sync();
    };

    const landed = (d: DropEvent) => {
      falling = Math.max(0, falling - d.payout);
      tally.add(d.bet, d.payout);
      board.pushResult(d);
      if (d.mult < 100) siteTone(ctx.sfx, 330, 110, { gain: 0.045, to: 240 });
      else if (d.mult < 200) siteTone(ctx.sfx, 660, 110, { type: 'triangle', gain: 0.05 });
      else {
        const notes = d.mult >= 1_000 ? [660, 880, 1320] : [660, 990];
        notes.forEach((f, i) => siteTone(ctx.sfx, f, 150, { type: 'triangle', gain: 0.055, at: i * 80 }));
      }
      const tier = winTier(d.payout, d.bet);
      if (tier) {
        celebrate({ stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx }, { title: `Plinko ${multText(d.mult)}`, sub: `Pays ${formatMoney(d.payout)} on ${formatMoney(d.bet)}`, tier });
      }
      sync();
    };

    describeBoard();
    sync();

    return {
      onTable(snap) {
        stack = snap.you.stack;
        waiting = 0;
        falling = 0;
        board.clear();
        const lim = snap.meta.config.limits.default;
        if (!bet || !limits || lim.min !== limits.min || lim.max !== limits.max || lim.step !== limits.step) {
          bet?.root.remove();
          limits = lim;
          bet = new BetBox({
            label: 'Bet',
            min: lim.min,
            max: lim.max,
            step: lim.step,
            value: lim.min,
            onChange: () => {
              if (bet) dropBtn.disabled = bet.value > stack;
              board.refreshCard();
            },
          });
          screen.side.prepend(bet.root);
        }
        const v = snap.view as PlinkoView;
        const last = v.recent[0];
        if (last) {
          rows = last.rows;
          risk = last.risk;
          riskSeg.set(risk);
          rowsSeg.set(rows);
        }
        board.setBoard(rows, risk);
        board.showResults(v.recent);
        describeBoard();
        sync();
        tipFor();
      },

      onEvents(events) {
        for (const e of events) {
          if (e.type !== 'drop') continue;
          const d = e as unknown as DropEvent;
          waiting = Math.max(0, waiting - 1);
          stack = d.stack;
          falling += d.payout;
          if (d.rows !== rows || d.risk !== risk) {
            rows = d.rows;
            risk = d.risk;
            riskSeg.set(risk);
            rowsSeg.set(rows);
            board.setBoard(rows, risk);
            describeBoard();
          }
          board.drop(d);
        }
        sync();
      },

      onSeat(msg) {
        stack = msg.stack;
        sync();
      },

      onError() {
        waiting = Math.max(0, waiting - 1);
        sync();
      },

      keydown(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        if (e.code === 'Space') {
          if (!e.repeat) drop();
          return true;
        }
        return false;
      },

      update(dt) {
        board.update(dt);
        // A drop the server never answered (the socket dropped it) stops holding the board.
        if (waiting > 0 && performance.now() - sentAt > 5_000) {
          waiting = 0;
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
