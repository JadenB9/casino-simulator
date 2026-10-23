// Plinko on the lounge computers: the desk as it stands on the floor, and the website on its
// monitor (docs/rules/online-games.md §1). Every Drop is a round of its own: the server settles it
// at once and sends the path, and a ball plays that path down the pegs while more can follow it.
// The chips at the top of the page count a ball's payout only when it lands, the way the site
// would; the server has already paid it. Auto drops ball after ball at the same board: each once
// the server has settled the one before, so a run keeps a few balls in the air, as a quick hand
// at the button would.

import './plinko.css';
import type { GameClientModule, TableView } from '../contract.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { ROWS, RISKS, RISK_NAMES, MULTS, binChance, boardRtp, bestBoard, returnRange, type Risk, type Rows } from '../../../../shared/src/games/plinko/rules.ts';
import type { DropEvent, PlinkoView } from '../../../../shared/src/games/plinko/engine.ts';
import { attractTexture, pcModel, pcPose, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { SegChoice, InfoList, labelled, siteTone, shortTone, drawSiteBar, drawAttractPanel } from '../online/screen.ts';
import { OnlineSite } from '../online/site.ts';
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
  drawAttractPanel(g, top, h, [['Bet', '$5.00'], ['Risk', 'Medium'], ['Rows', '10']], 'Drop');
  g.textAlign = 'center';

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

    const site = new OnlineSite(ctx, {
      game: 'plinko',
      title: 'Plinko',
      action: 'Drop',
      primary: () => drop(),
      sync: () => sync(),
      onBet: () => {
        sync();
        describeBoard();
        board.refreshCard();
      },
      // The next ball goes a beat after the server settles the last: a few stay in the air.
      auto: {
        gapMs: 340,
        play: () => {
          const bet = site.bet;
          if (!bet || waiting > 0) return false;
          if (bet.value > stack) return 'not enough chips here for the next ball';
          send(bet.value);
          return true;
        },
      },
    });
    const screen = site.screen;

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
        const b = site.bet?.value ?? site.limits?.min ?? 100;
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
    }).label('Risk');
    const rowsSeg = new SegChoice(ROWS.map((n) => ({ value: n, label: String(n), title: `${n} rows` })), rows, (n) => {
      rows = n;
      boardChanged();
    }).label('Rows');
    rowsSeg.root.classList.add('dense');
    site.controls.append(labelled('Risk', riskSeg.root), labelled('Rows', rowsSeg.root));
    const info = new InfoList('This board');
    site.facts.append(info.root);

    const sync = () => {
      const bet = site.bet;
      screen.setStack(stack - falling);
      bet?.setMax(stack);
      const locked = site.locked;
      bet?.setEnabled(!locked);
      // The board can't change under a ball: rows and risk wait for the last one to land.
      const busy = board.inFlight > 0 || waiting > 0 || locked;
      riskSeg.setEnabled(!busy);
      rowsSeg.setEnabled(!busy);
      site.auto?.setEnabled(true);
      site.paintMain('Drop', 'go', !bet || bet.value > stack);
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
      const b = site.bet?.value ?? site.limits?.min ?? 100;
      site.profit('Top pay', (b / 100) * mults[0]! - b, `${multText(mults[0]!)} · ${oneIn(2 / 2 ** rows)}`);
      info.set('likely', 'Most likely', `${multText(likely[0])} · ${pct(likely[1])}`);
      info.set('back', 'Pays the bet or more', pct(back));
      info.set('rtp', 'Return', pct(rtp));
      const lim = site.limits;
      const range = lim ? ` · Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}` : '';
      screen.setNote(`Return ${pct(rtp)} · ${rows} rows, ${RISK_NAMES[risk]}${range} · Space drops a ball`);
    };

    // Tips: the board's return against the best one. Every board pays about the same; the tip
    // says so, and rings 11 rows, High, which returns the most.
    const range = returnRange();
    const best = bestBoard();
    const tipFor = () => {
      if (!ctx.tips.on) {
        site.tip(null);
        riskSeg.tip(null);
        rowsSeg.tip(null);
        return;
      }
      const here = boardRtp(rows, risk);
      site.tip(
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

    const send = (amount: Cents) => {
      sentAt = performance.now();
      waiting++;
      ctx.link.act({ type: 'drop', bet: amount, rows, risk });
      siteTone(ctx.sfx, 560, 45, { type: 'triangle', gain: 0.04, to: 820 });
      sync();
    };

    const drop = () => {
      const bet = site.bet;
      if (!bet) return;
      const now = performance.now();
      if (now - sentAt < MIN_GAP_MS) return;
      if (bet.value > stack) {
        shortTone(ctx.sfx);
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      send(bet.value);
    };

    /** The HUD's chips wait for every ball in the air to land (TableView.settled). */
    let calm: (() => void)[] = [];
    const calmed = () => {
      if (board.inFlight === 0) for (const r of calm.splice(0)) r();
    };

    const landed = (d: DropEvent) => {
      falling = Math.max(0, falling - d.payout);
      queueMicrotask(calmed);
      site.settle({
        bet: d.bet,
        payout: d.payout,
        mult: d.mult,
        pill: multText(d.mult),
        accent: binColor(d.bin, d.rows).face,
        // auto counted this drop when the server settled it
        auto: false,
        moment: { title: `Plinko ${multText(d.mult)}`, sub: `Pays ${formatMoney(d.payout)} on ${formatMoney(d.bet)}` },
      });
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
        calmed();
        site.table(snap);
        const v = snap.view as PlinkoView;
        const last = v.recent[0];
        if (last) {
          rows = last.rows;
          risk = last.risk;
          riskSeg.set(risk);
          rowsSeg.set(rows);
          site.result.show(last.bet, last.payout, last.mult, false);
        }
        site.history.clear();
        for (const d of v.recent.slice(0, 9).reverse()) site.history.push(multText(d.mult), d.payout > d.bet, false, binColor(d.bin, d.rows).face);
        board.setBoard(rows, risk);
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
          // settled on the server: a run's next ball can go once its beat has passed
          site.auto?.driver.answered();
          site.auto?.driver.settled(d.bet, d.payout);
        }
        sync();
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
        waiting = Math.max(0, waiting - 1);
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
        board.update(dt);
        // A drop the server never answered (the socket dropped it) stops holding the board.
        if (waiting > 0 && performance.now() - sentAt > 5_000) {
          waiting = 0;
          sync();
        }
        site.update(dt);
      },

      settled() {
        return board.inFlight === 0 ? Promise.resolve() : new Promise<void>((r) => calm.push(r));
      },

      dispose() {
        offTips();
        for (const r of calm.splice(0)) r();
        site.dispose();
      },
    };
  },
};
