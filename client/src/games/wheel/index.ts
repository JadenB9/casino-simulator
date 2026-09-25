// Wheel on the lounge computers (docs/rules/online-games.md §10): the desk as it stands on the
// floor, and the website on its monitor. Pick a risk and how many segments; Spin settles on the
// server at once and sends the segment, and the wheel turns onto it. Under the wheel, a key of
// every multiplier on it: hover one for its chance and what it pays at this bet.

import './wheel.css';
import type { GameClientModule, TableView } from '../contract.ts';
import { formatMoney, type BetLimits, type Cents } from '../../../../shared/src/money.ts';
import { RISKS, RISK_NAMES, SEGMENTS, WHEELS, wheelTable, type Risk, type Segments } from '../../../../shared/src/games/wheel/rules.ts';
import { SPIN_MS, type WheelEvent, type WheelSpin, type WheelView } from '../../../../shared/src/games/wheel/engine.ts';
import { celebrate } from '../../table/celebrate.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, pcScreenCorners, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { OnlineScreen, AddChips, BetBox, SegChoice, actionButton, labelled, InfoList, ResultStrip, SessionTally, commitTyping, winTier, siteTone, drawSiteBar, drawAttractPanel, multText, pctText } from '../online/screen.ts';
import { WheelBoard, multColor } from './board.ts';

/** The chair's trim on the floor: Wheel's yellow. */
const ACCENT = '#fde047';

/** The monitor on the floor: the site's bar, a bet panel, and a Medium wheel with its pointer. */
function drawAttract(g: CanvasRenderingContext2D, w: number, h: number): void {
  const top = drawSiteBar(g, w, 'Wheel');
  const left = drawAttractPanel(g, top, h, [['Bet', '$10.00'], ['Risk', 'Medium'], ['Segments', '20']], 'Spin');
  const cx = left + (w - left) / 2;
  const cy = top + (h - top) / 2 + 4;
  const mults = WHEELS.medium[20];
  const step = (Math.PI * 2) / mults.length;
  g.fillStyle = '#0b1720';
  g.beginPath();
  g.arc(cx, cy, 124, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < mults.length; i++) {
    const a0 = -Math.PI / 2 + i * step + 0.01;
    const a1 = a0 + step - 0.02;
    g.fillStyle = multColor(mults[i]!).face;
    g.beginPath();
    g.arc(cx, cy, 118, a0, a1);
    g.arc(cx, cy, 94, a1, a0, true);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#0f1e29';
  g.beginPath();
  g.arc(cx, cy, 88, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fde047';
  g.font = '700 36px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('2.00×', cx, cy + 2);
  g.fillStyle = '#ff4d6d';
  g.beginPath();
  g.moveTo(cx - 11, cy - 134);
  g.lineTo(cx + 11, cy - 134);
  g.lineTo(cx, cy - 110);
  g.closePath();
  g.fill();
  g.textAlign = 'left';
}

export const wheel: GameClientModule = {
  game: 'wheel',
  footprint: PC_FOOTPRINT,
  createModel: () => pcModel({ attract: attractTexture(drawAttract), accent: ACCENT }),
  seats: () => [{ position: PC_SEAT, yaw: Math.PI }],
  playPose: () => pcPose(),

  mount(ctx): TableView {
    const screen = new OnlineScreen('Wheel');
    ctx.ui.append(screen.root);
    const cashier = new AddChips(screen, ctx);
    const corners = pcScreenCorners();

    let risk: Risk = 'medium';
    let segs: Segments = 30;
    let stack: Cents = 0;
    let busy = false;
    let sentAt = 0;
    let limits: BetLimits | null = null;
    let bet: BetBox | null = null;
    let tipShown = false;

    // The board: recent spins, the wheel, the key of multipliers.
    const board = el('div', 'wh-board');
    const stripWrap = el('div', 'wh-strip');
    const strip = new ResultStrip(9);
    stripWrap.append(strip.root);
    const wheelView = new WheelBoard();
    const key = el('div', 'wh-key');
    const card = el('dl', 'wh-card');
    card.hidden = true;
    board.append(stripWrap, wheelView.root, key, card);
    screen.main.append(board);

    // The bet panel.
    const riskSeg = new SegChoice(RISKS.map((r) => ({ value: r, label: RISK_NAMES[r] })), risk, (r) => {
      risk = r;
      wheelChanged();
    });
    const segSeg = new SegChoice(SEGMENTS.map((n) => ({ value: n, label: String(n), title: `${n} segments` })), segs, (n) => {
      segs = n;
      wheelChanged();
    });
    segSeg.root.classList.add('dense');
    const spinBtn = actionButton('Spin', () => spin());
    spinBtn.title = 'Spin (Space)';
    spinBtn.classList.add('os-fixed');
    const info = new InfoList('This wheel');
    const tally = new SessionTally();
    screen.side.append(labelled('Risk', riskSeg.root), labelled('Segments', segSeg.root), spinBtn, info.root, tally.root);

    const pushStrip = (s: WheelSpin, fresh: boolean) => strip.push(multText(s.mult), s.payout > s.bet, fresh);

    const sync = () => {
      const block = busy || wheelView.spinning;
      if (!wheelView.spinning) screen.setStack(stack);
      bet?.setMax(stack);
      bet?.setEnabled(!block);
      spinBtn.disabled = block || !bet || bet.value > stack;
      riskSeg.setEnabled(!block);
      segSeg.setEnabled(!block);
    };

    const showCard = (mult: number, count: number, at: HTMLElement) => {
      const b = bet?.value ?? limits?.min ?? 100;
      const rows: [string, string][] = [
        ['Pays', `${formatMoney((b / 100) * mult)} (${multText(mult)})`],
        ['Profit', formatMoney((b / 100) * mult - b, { sign: true })],
        ['Chance', `${count} in ${segs} · ${pctText(count / segs)}`],
      ];
      card.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', '', k), el('dd', '', v)]));
      card.hidden = false;
      const box = at.getBoundingClientRect();
      const host = board.getBoundingClientRect();
      // the page is scaled onto the monitor: measure in its own design pixels
      const scale = host.width / board.offsetWidth || 1;
      card.style.left = `${(box.left + box.width / 2 - host.left) / scale}px`;
      card.style.top = `${(box.top - host.top) / scale - 10}px`;
    };

    const drawKey = () => {
      const table = wheelTable(risk, segs).sort((a, b) => a.mult - b.mult);
      key.replaceChildren(
        ...table.map(({ mult, count }) => {
          const { face, ink } = multColor(mult);
          const chip = el('div', 'wh-key-item');
          chip.dataset.mult = String(mult);
          chip.style.setProperty('--wh-face', face);
          chip.style.setProperty('--wh-ink', ink);
          chip.append(el('span', 'wh-key-mult', multText(mult)), el('span', 'wh-key-count', `${count} of ${segs}`));
          chip.addEventListener('mouseenter', () => showCard(mult, count, chip));
          chip.addEventListener('mouseleave', () => (card.hidden = true));
          return chip;
        }),
      );
    };

    const describe = () => {
      const table = wheelTable(risk, segs);
      const top = table[0]!;
      const paying = table.filter((r) => r.mult > 0).reduce((n, r) => n + r.count, 0);
      const more = table.filter((r) => r.mult > 100).reduce((n, r) => n + r.count, 0);
      info.set('rtp', 'Return', '99.00%');
      info.set('top', 'Top pay', `${multText(top.mult)} · ${top.count} in ${segs}`);
      info.set('pays', 'Pays something', pctText(paying / segs));
      info.set('more', 'Pays more than the bet', pctText(more / segs));
      const range = limits ? ` · Bet ${formatMoney(limits.min)} to ${formatMoney(limits.max)}` : '';
      screen.setNote(`Return 99.00% on every wheel · ${segs} segments, ${RISK_NAMES[risk]}${range} · Space spins`);
    };

    // Tips: every wheel returns the same 99%, and the tip says so.
    const tipFor = () => {
      if (!ctx.tips.on) {
        if (tipShown) {
          tipShown = false;
          ctx.kit.tip(null);
        }
        return;
      }
      tipShown = true;
      ctx.kit.tip('All fifteen wheels return exactly 99%: risk and segments only change how often it pays and how much.');
    };
    const offTips = ctx.tips.subscribe(tipFor);

    const wheelChanged = () => {
      wheelView.setWheel(risk, segs);
      drawKey();
      describe();
      tipFor();
      siteTone(ctx.sfx, 880, 30, { type: 'triangle', gain: 0.03 });
    };

    const spin = () => {
      if (!bet || busy || wheelView.spinning) return;
      commitTyping(screen.root);
      if (bet.value > stack) {
        siteTone(ctx.sfx, 150, 120, { type: 'sawtooth', gain: 0.03 });
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      busy = true;
      sentAt = performance.now();
      ctx.link.act({ type: 'spin', bet: bet.value, risk, segments: segs });
      sync();
    };

    const play = async (e: WheelEvent) => {
      if (e.risk !== risk || e.segments !== segs) {
        risk = e.risk;
        segs = e.segments;
        riskSeg.set(risk);
        segSeg.set(segs);
        wheelChanged();
      }
      screen.setStack(e.stack - e.payout);
      for (const k of key.children) k.classList.remove('hit');
      wheelView.setHub(null);
      siteTone(ctx.sfx, 520, 60, { type: 'triangle', gain: 0.04, to: 780 });
      let lastTick = 0;
      await wheelView.spin(e.segment, SPIN_MS - 150, () => {
        const now = performance.now();
        if (now - lastTick < 26) return;
        lastTick = now;
        siteTone(ctx.sfx, 1900, 12, { type: 'square', gain: 0.012 });
      });
      wheelView.setHub(e.mult, e.payout > 0 ? `Pays ${formatMoney(e.payout)}` : 'No pay');
      key.querySelector(`[data-mult="${e.mult}"]`)?.classList.add('hit');
      pushStrip(e, true);
      tally.add(e.bet, e.payout);
      screen.setStack(e.stack);
      if (e.payout > e.bet) {
        const notes = e.mult >= 990 ? [660, 880, 1320, 1760] : [784, 1175];
        notes.forEach((f, i) => siteTone(ctx.sfx, f, 150, { type: 'triangle', gain: 0.055, at: i * 80 }));
      } else if (e.payout > 0) siteTone(ctx.sfx, 520, 110, { type: 'triangle', gain: 0.04 });
      else siteTone(ctx.sfx, 220, 140, { gain: 0.045, to: 160 });
      const tier = winTier(e.payout, e.bet);
      if (tier) {
        celebrate({ stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx }, { title: `Wheel ${multText(e.mult)}`, sub: `${e.segments} segments, ${RISK_NAMES[e.risk]} · pays ${formatMoney(e.payout)} on ${formatMoney(e.bet)}`, tier });
      }
    };

    wheelView.setWheel(risk, segs);
    drawKey();
    describe();
    sync();

    return {
      onTable(snap) {
        cashier.table(snap);
        stack = snap.you.stack;
        busy = false;
        const lim = snap.meta.config.limits.default;
        if (!bet || !limits || lim.min !== limits.min || lim.max !== limits.max || lim.step !== limits.step) {
          bet?.root.remove();
          limits = lim;
          bet = new BetBox({ label: 'Bet', min: lim.min, max: lim.max, step: lim.step, value: lim.min, onChange: () => {
            if (bet) spinBtn.disabled = busy || wheelView.spinning || bet.value > stack;
          } });
          screen.side.prepend(bet.root);
        }
        const v = snap.view as WheelView;
        strip.clear();
        for (const s of v.recent.slice(0, 9).reverse()) pushStrip(s, false);
        const last = v.recent[0];
        if (last) {
          risk = last.risk;
          segs = last.segments;
          riskSeg.set(risk);
          segSeg.set(segs);
          wheelView.setWheel(risk, segs);
          wheelView.restOn(last.segment);
          wheelView.setHub(last.mult, last.payout > 0 ? `Pays ${formatMoney(last.payout)}` : 'No pay');
        }
        drawKey();
        describe();
        sync();
        tipFor();
      },

      async onEvents(events) {
        busy = false;
        for (const e of events) {
          if (e.type !== 'spin') continue;
          sync();
          await play(e as unknown as WheelEvent);
        }
        sync();
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
          if (!e.repeat) spin();
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
