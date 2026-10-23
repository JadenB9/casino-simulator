// Wheel on the lounge computers (docs/rules/online-games.md §10): the desk as it stands on the
// floor, and the website on its monitor. Pick a risk and how many segments; Spin settles on the
// server at once and sends the segment, and the wheel turns onto it. Under the wheel, a key of
// every multiplier on it: hover one for its chance and what it pays at this bet. Auto spins again
// once the wheel has stopped, until one of its stops.

import './wheel.css';
import type { GameClientModule, TableView } from '../contract.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { RISKS, RISK_NAMES, SEGMENTS, WHEELS, wheelTable, type Risk, type Segments } from '../../../../shared/src/games/wheel/rules.ts';
import { SPIN_MS, type WheelEvent, type WheelSpin, type WheelView } from '../../../../shared/src/games/wheel/engine.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { SegChoice, labelled, InfoList, siteTone, shortTone, drawSiteBar, drawAttractPanel, multText, pctText } from '../online/screen.ts';
import { OnlineSite } from '../online/site.ts';
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
    let risk: Risk = 'medium';
    let segs: Segments = 30;
    let stack: Cents = 0;
    let busy = false;
    let sentAt = 0;

    const site = new OnlineSite(ctx, {
      game: 'wheel',
      title: 'Wheel',
      action: 'Spin',
      primary: () => spin(),
      sync: () => sync(),
      onBet: () => {
        sync();
        describe();
      },
      auto: {
        gapMs: 500,
        play: () => {
          const bet = site.bet;
          if (!bet || busy || wheelView.spinning) return false;
          if (bet.value > stack) return 'not enough chips here for the next spin';
          send(bet.value);
          return true;
        },
      },
    });
    const screen = site.screen;

    // The board: the wheel and the key of multipliers (the recent spins are the site's top row).
    const board = el('div', 'wh-board');
    const wheelView = new WheelBoard();
    const key = el('div', 'wh-key');
    const card = el('dl', 'wh-card');
    card.hidden = true;
    board.append(wheelView.root, key, card);
    screen.main.append(board);

    // The bet panel.
    const riskSeg = new SegChoice(RISKS.map((r) => ({ value: r, label: RISK_NAMES[r] })), risk, (r) => {
      risk = r;
      wheelChanged();
    }).label('Risk');
    const segSeg = new SegChoice(SEGMENTS.map((n) => ({ value: n, label: String(n), title: `${n} segments` })), segs, (n) => {
      segs = n;
      wheelChanged();
    }).label('Segments');
    segSeg.root.classList.add('dense');
    site.controls.append(labelled('Risk', riskSeg.root), labelled('Segments', segSeg.root));
    const info = new InfoList('This wheel');
    site.facts.append(info.root);

    const pushStrip = (s: WheelSpin, fresh: boolean) => site.history.push(multText(s.mult), s.payout > s.bet, fresh, multColor(s.mult).face);

    const sync = () => {
      const block = busy || wheelView.spinning || site.locked;
      const bet = site.bet;
      if (!wheelView.spinning) screen.setStack(stack);
      bet?.setMax(stack);
      bet?.setEnabled(!block);
      riskSeg.setEnabled(!block);
      segSeg.setEnabled(!block);
      site.auto?.setEnabled(!busy && !wheelView.spinning);
      site.paintMain('Spin', 'go', busy || wheelView.spinning || !bet || bet.value > stack, !!bet && bet.value <= stack);
    };

    const showCard = (mult: number, count: number, at: HTMLElement) => {
      const b = site.bet?.value ?? site.limits?.min ?? 100;
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
      const x = (box.left + box.width / 2 - host.left) / scale;
      // kept inside the board at its ends
      card.style.left = `${Math.min(board.offsetWidth - 110, Math.max(110, x))}px`;
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
      const b = site.bet?.value ?? site.limits?.min ?? 100;
      site.profit('Top pay', (b / 100) * top.mult - b, `${multText(top.mult)} · ${top.count} in ${segs}`);
      info.set('pays', 'Pays something', pctText(paying / segs));
      info.set('more', 'Pays more than the bet', pctText(more / segs));
      info.set('rtp', 'Return', '99.00%');
      const lim = site.limits;
      const range = lim ? ` · Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}` : '';
      screen.setNote(`Return 99.00% on every wheel · ${segs} segments, ${RISK_NAMES[risk]}${range} · Space spins`);
    };

    // Tips: every wheel returns the same 99%, and the tip says so.
    const tipFor = () => site.tip(ctx.tips.on ? 'All fifteen wheels return exactly 99%: risk and segments only change how often it pays and how much.' : null);
    const offTips = ctx.tips.subscribe(tipFor);

    const wheelChanged = () => {
      wheelView.setWheel(risk, segs);
      drawKey();
      describe();
      tipFor();
      siteTone(ctx.sfx, 880, 30, { type: 'triangle', gain: 0.03 });
    };

    const send = (amount: Cents) => {
      busy = true;
      sentAt = performance.now();
      ctx.link.act({ type: 'spin', bet: amount, risk, segments: segs });
      sync();
    };

    const spin = () => {
      const bet = site.bet;
      if (!bet || busy || wheelView.spinning) return;
      if (bet.value > stack) {
        shortTone(ctx.sfx);
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      send(bet.value);
    };

    const play = async (e: WheelEvent) => {
      site.auto?.driver.answered();
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
      screen.setStack(e.stack);
      site.settle({
        bet: e.bet,
        payout: e.payout,
        mult: e.mult,
        accent: multColor(e.mult).face,
        moment: { title: `Wheel ${multText(e.mult)}`, sub: `${e.segments} segments, ${RISK_NAMES[e.risk]} · pays ${formatMoney(e.payout)} on ${formatMoney(e.bet)}` },
      });
    };

    wheelView.setWheel(risk, segs);
    drawKey();
    describe();
    sync();

    return {
      onTable(snap) {
        stack = snap.you.stack;
        busy = false;
        site.table(snap);
        const v = snap.view as WheelView;
        site.history.clear();
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
          site.result.show(last.bet, last.payout, last.mult, false);
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
        site.seat(msg);
        stack = msg.stack;
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
