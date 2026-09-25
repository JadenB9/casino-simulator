// Cases on the lounge computers (docs/rules/online-games.md §11): the desk as it stands on the
// floor, and the website on its monitor. Pick a case and what it costs; Open settles on the server
// at once and sends the item, and the reel runs past the marker and stops on it. Under the reel,
// everything the case holds, with what it pays and how often.

import './cases.css';
import type { GameClientModule, TableView } from '../contract.ts';
import { formatMoney, type BetLimits, type Cents } from '../../../../shared/src/money.ts';
import { CASES, CASE_INFO, RARITY_NAMES, WEIGHT, rarityOf, type CaseId } from '../../../../shared/src/games/cases/rules.ts';
import { QUICK_MS, REEL_MS, type CaseOpen, type CasesEvent, type CasesView } from '../../../../shared/src/games/cases/engine.ts';
import { celebrate } from '../../table/celebrate.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, pcScreenCorners, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { OnlineScreen, AddChips, BetBox, SegChoice, actionButton, labelled, InfoList, SessionTally, commitTyping, winTier, siteTone, drawSiteBar, drawAttractPanel, multText, pctText } from '../online/screen.ts';
import { CaseReel, itemCard } from './reel.ts';

/** The chair's trim on the floor: Cases' vermilion. */
const ACCENT = '#ff5a36';
const DROPS = 8;

/** Rarity colours for the desk's picture (cases.css has the page's). */
const RARITY_COLOR: Record<string, string> = { common: '#9aa7b5', uncommon: '#4fb3ff', rare: '#3b6cff', epic: '#9b5cff', legendary: '#e040fb', mythic: '#ff4d4f', exotic: '#ffc53d' };

const chanceText = (w: number) => {
  const p = w / WEIGHT;
  return p >= 0.01 ? pctText(p) : `1 in ${Math.round(1 / p).toLocaleString('en-US')}`;
};

/** A few of the items, simply, for the desk's picture: a watch, dice, a crown, a dollar, a chip. */
function drawThing(g: CanvasRenderingContext2D, i: number, cx: number, cy: number): void {
  const disc = (r: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  };
  if (i === 0) {
    disc(15, '#c9a227');
    disc(11, '#fbf7ec');
    g.strokeStyle = '#1d1a14';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx, cy - 8);
    g.moveTo(cx, cy);
    g.lineTo(cx + 6, cy + 3);
    g.stroke();
  } else if (i === 1) {
    g.fillStyle = '#f7f4ee';
    g.beginPath();
    g.roundRect(cx - 17, cy - 6, 15, 15, 3);
    g.roundRect(cx + 1, cy - 11, 15, 15, 3);
    g.fill();
  } else if (i === 2) {
    g.fillStyle = '#f5c542';
    g.beginPath();
    g.moveTo(cx - 17, cy + 10);
    g.lineTo(cx - 19, cy - 10);
    g.lineTo(cx - 8, cy - 1);
    g.lineTo(cx, cy - 14);
    g.lineTo(cx + 8, cy - 1);
    g.lineTo(cx + 19, cy - 10);
    g.lineTo(cx + 17, cy + 10);
    g.closePath();
    g.fill();
  } else if (i === 3) {
    disc(15, '#7c8a98');
    disc(13, '#c9d3dc');
  } else {
    disc(15, '#c62b36');
    disc(9, '#a3202b');
  }
}

/** The monitor on the floor: the site's bar, a bet panel, and a reel stopped on a gold card. */
function drawAttract(g: CanvasRenderingContext2D, w: number, h: number): void {
  const top = drawSiteBar(g, w, 'Cases');
  const left = drawAttractPanel(g, top, h, [['Case price', '$25.00'], ['Case', 'High Roller']], 'Open');
  const cards: [string, string][] = [['rare', '2.00×'], ['common', '0.25×'], ['exotic', '100×'], ['uncommon', '1.00×'], ['common', '0.10×']];
  const cw = 64;
  const x0 = left + (w - left - (cards.length * (cw + 6) - 6)) / 2;
  const y0 = top + 70;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  cards.forEach(([r, m], i) => {
    const x = x0 + i * (cw + 6);
    const lit = i === 2;
    g.fillStyle = lit ? '#2a3a2a' : '#1a2c38';
    g.beginPath();
    g.roundRect(x, y0, cw, 86, 5);
    g.fill();
    const glow = g.createRadialGradient(x + cw / 2, y0 + 36, 2, x + cw / 2, y0 + 36, 30);
    glow.addColorStop(0, RARITY_COLOR[r]!);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.globalAlpha = lit ? 0.9 : 0.45;
    g.fillRect(x, y0, cw, 70);
    g.globalAlpha = 1;
    g.fillStyle = RARITY_COLOR[r]!;
    g.fillRect(x, y0 + 82, cw, 4);
    drawThing(g, i, x + cw / 2, y0 + 34);
    g.fillStyle = '#eef3f8';
    g.font = '700 13px system-ui, sans-serif';
    g.fillText(m, x + cw / 2, y0 + 70);
  });
  const mx = x0 + 2 * (cw + 6) + cw / 2;
  g.fillStyle = '#ffc53d';
  g.fillRect(mx - 1.5, y0 - 12, 3, 110);
  g.beginPath();
  g.moveTo(mx - 8, y0 - 14);
  g.lineTo(mx + 8, y0 - 14);
  g.lineTo(mx, y0 - 4);
  g.closePath();
  g.fill();
  g.fillStyle = '#ffc53d';
  g.font = '700 20px system-ui, sans-serif';
  g.fillText('Gold Crown  100×', left + (w - left) / 2, h - 44);
  g.textAlign = 'left';
}

export const cases: GameClientModule = {
  game: 'cases',
  footprint: PC_FOOTPRINT,
  createModel: () => pcModel({ attract: attractTexture(drawAttract), accent: ACCENT }),
  seats: () => [{ position: PC_SEAT, yaw: Math.PI }],
  playPose: () => pcPose(),

  mount(ctx): TableView {
    const screen = new OnlineScreen('Cases');
    ctx.ui.append(screen.root);
    const cashier = new AddChips(screen, ctx);
    const corners = pcScreenCorners();

    let chosen: CaseId = 'classic';
    let quick = false;
    let stack: Cents = 0;
    let busy = false;
    let sentAt = 0;
    let limits: BetLimits | null = null;
    let bet: BetBox | null = null;
    let tipShown = false;

    // The board: the last drops, the reel, the result line, the case's contents.
    const board = el('div', 'ca-board');
    const drops = el('div', 'ca-drops');
    const dropsLabel = el('span', 'os-caption ca-drops-label', 'Last drops');
    const dropsList = el('div', 'ca-drops-list');
    drops.append(dropsLabel, dropsList);
    const reel = new CaseReel();
    const result = el('div', 'ca-result');
    const contents = el('div', 'ca-contents');
    const contentsHead = el('div', 'ca-contents-head');
    const contentsGrid = el('div', 'ca-grid');
    contents.append(contentsHead, contentsGrid);
    board.append(drops, reel.root, result, contents);
    screen.main.append(board);

    // The bet panel.
    const caseSeg = new SegChoice<CaseId>(
      CASES.map((id) => ({ value: id, label: CASE_INFO[id].name, title: CASE_INFO[id].about })),
      chosen,
      (id) => {
        chosen = id;
        caseChanged();
      },
    );
    caseSeg.root.classList.add('ca-cases');
    // each case button carries its top prize under its name
    caseSeg.root.querySelectorAll('button').forEach((b, i) => {
      const top = CASE_INFO[CASES[i]!].items.at(-1)!;
      b.append(el('span', `ca-case-top ca-r-${rarityOf(top.mult)}`, `Up to ${multText(top.mult).replace('.00', '')}`));
    });
    const speedSeg = new SegChoice<'normal' | 'quick'>([{ value: 'normal', label: 'Full reel' }, { value: 'quick', label: 'Quick open', title: 'A short reel (Q)' }], 'normal', (v) => {
      quick = v === 'quick';
      siteTone(ctx.sfx, 880, 30, { type: 'triangle', gain: 0.03 });
    });
    const openBtn = actionButton('Open case', () => open());
    openBtn.title = 'Open the case (Space)';
    openBtn.classList.add('os-fixed');
    const info = new InfoList('This case');
    const tally = new SessionTally();
    screen.side.append(labelled('Case', caseSeg.root), labelled('Reel', speedSeg.root), openBtn, info.root, tally.root);

    const pushDrop = (o: CaseOpen, fresh: boolean) => {
      const it = CASE_INFO[o.case].items[o.item]!;
      const c = itemCard(it, `ca-drop${fresh ? ' fresh' : ''}`);
      c.title = `${it.name}, ${CASE_INFO[o.case].name} case · ${formatMoney(o.payout)} on ${formatMoney(o.bet)}`;
      dropsList.prepend(c);
      while (dropsList.childElementCount > DROPS) dropsList.lastElementChild!.remove();
    };

    const sync = () => {
      const block = busy || reel.spinning;
      if (!reel.spinning) screen.setStack(stack);
      bet?.setMax(stack);
      bet?.setEnabled(!block);
      openBtn.disabled = block || !bet || bet.value > stack;
      openBtn.textContent = bet ? `Open for ${formatMoney(bet.value)}` : 'Open case';
      caseSeg.setEnabled(!block);
      speedSeg.setEnabled(!block);
    };

    const drawContents = () => {
      const c = CASE_INFO[chosen];
      const b = bet?.value ?? limits?.min ?? 100;
      contentsHead.replaceChildren(el('span', 'os-caption', `In the ${c.name} case`), el('span', 'ca-contents-about', c.about));
      contentsGrid.replaceChildren(
        ...[...c.items].reverse().map((it) => {
          const card = itemCard(it, 'ca-item', true);
          card.append(el('span', 'ca-item-odds', chanceText(it.weight)));
          card.title = `${it.name} · ${RARITY_NAMES[rarityOf(it.mult)]} · pays ${formatMoney((b / 100) * it.mult)} at this price`;
          return card;
        }),
      );
      contentsGrid.dataset.count = String(c.items.length);
    };

    const describe = () => {
      const c = CASE_INFO[chosen];
      const more = c.items.filter((it) => it.mult > 100).reduce((n, it) => n + it.weight, 0) / WEIGHT;
      const likely = c.items.reduce((a, it) => (it.weight > a.weight ? it : a));
      const top = c.items.at(-1)!;
      info.set('rtp', 'Return', '99.00%');
      info.set('top', 'Top item', `${multText(top.mult)} · ${chanceText(top.weight)}`);
      info.set('more', 'Pays more than the case', pctText(more));
      info.set('likely', 'Most likely', `${likely.name} · ${multText(likely.mult)}`);
      const range = limits ? ` · Cases ${formatMoney(limits.min)} to ${formatMoney(limits.max)}` : '';
      screen.setNote(`Return 99.00% on every case · ${c.name}${range} · Space opens · Q quick open`);
    };

    // Tips: every case returns the same 99%, and the tip says so.
    const tipFor = () => {
      if (!ctx.tips.on) {
        if (tipShown) {
          tipShown = false;
          ctx.kit.tip(null);
        }
        return;
      }
      tipShown = true;
      ctx.kit.tip('Every case returns exactly 99%: a bigger case only trades steady small items for rare big ones.');
    };
    const offTips = ctx.tips.subscribe(tipFor);

    const caseChanged = (sound = true) => {
      drawContents();
      describe();
      if (!reel.spinning) reel.show(chosen);
      result.replaceChildren(el('span', 'ca-result-idle', `${CASE_INFO[chosen].name} case · ${CASE_INFO[chosen].about}`));
      tipFor();
      if (sound) siteTone(ctx.sfx, 880, 30, { type: 'triangle', gain: 0.03 });
    };

    const open = () => {
      if (!bet || busy || reel.spinning) return;
      commitTyping(screen.root);
      if (bet.value > stack) {
        siteTone(ctx.sfx, 150, 120, { type: 'sawtooth', gain: 0.03 });
        ctx.kit.toast('Not enough chips here for that case.', 'err');
        return;
      }
      busy = true;
      sentAt = performance.now();
      ctx.link.act({ type: 'open', bet: bet.value, case: chosen, quick });
      sync();
    };

    const showResult = (o: CaseOpen) => {
      const it = CASE_INFO[o.case].items[o.item]!;
      const r = rarityOf(it.mult);
      result.replaceChildren(
        el('span', `ca-result-rarity ca-r-${r}`, RARITY_NAMES[r]),
        el('span', 'ca-result-name', it.name),
        el('span', `ca-result-mult${o.payout > o.bet ? ' win' : ''}`, `${multText(it.mult)} · ${formatMoney(o.payout)}`),
      );
    };

    const play = async (e: CasesEvent) => {
      if (e.case !== chosen) {
        chosen = e.case;
        caseSeg.set(chosen);
        caseChanged(false);
      }
      screen.setStack(e.stack - e.payout);
      result.replaceChildren(el('span', 'ca-result-idle', 'Opening…'));
      siteTone(ctx.sfx, 440, 90, { type: 'triangle', gain: 0.05, to: 660 });
      let lastTick = 0;
      let ticks = 0;
      await reel.spin(e.case, e.item, e.quick ? QUICK_MS : REEL_MS, () => {
        const now = performance.now();
        ticks++;
        if (now - lastTick < 30) return;
        lastTick = now;
        siteTone(ctx.sfx, 1320 + (ticks % 2) * 90, 16, { type: 'square', gain: 0.014 });
      });
      showResult(e);
      pushDrop(e, true);
      tally.add(e.bet, e.payout);
      screen.setStack(e.stack);
      const r = rarityOf(e.mult);
      if (e.payout > e.bet) {
        const notes = r === 'exotic' || r === 'mythic' ? [523, 659, 784, 1047, 1319] : r === 'legendary' || r === 'epic' ? [659, 880, 1175] : [784, 1047];
        notes.forEach((f, i) => siteTone(ctx.sfx, f, 170, { type: 'triangle', gain: 0.055, at: i * 75 }));
        ctx.sfx.play('chips-stack', { volume: 0.5 });
      } else siteTone(ctx.sfx, 330, 110, { gain: 0.04, to: 250 });
      const tier = winTier(e.payout, e.bet);
      if (tier) {
        const it = CASE_INFO[e.case].items[e.item]!;
        celebrate({ stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx }, { title: `${it.name} ${multText(e.mult)}`, sub: `${CASE_INFO[e.case].name} case · pays ${formatMoney(e.payout)} on ${formatMoney(e.bet)}`, tier });
      }
    };

    caseChanged(false);
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
          bet = new BetBox({ label: 'Case price', min: lim.min, max: lim.max, step: lim.step, value: lim.min, onChange: () => {
            if (!bet) return;
            openBtn.disabled = busy || reel.spinning || bet.value > stack;
            openBtn.textContent = `Open for ${formatMoney(bet.value)}`;
          } });
          screen.side.prepend(bet.root);
        }
        const v = snap.view as CasesView;
        dropsList.replaceChildren();
        for (const o of v.recent.slice(0, DROPS).reverse()) pushDrop(o, false);
        const last = v.recent[0];
        if (last) {
          chosen = last.case;
          caseSeg.set(chosen);
        }
        caseChanged(false);
        if (last) {
          reel.show(last.case, last.item);
          showResult(last);
        }
        sync();
      },

      async onEvents(events) {
        busy = false;
        for (const e of events) {
          if (e.type !== 'open') continue;
          sync();
          await play(e as unknown as CasesEvent);
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
          if (!e.repeat) open();
          return true;
        }
        if (e.key.toLowerCase() === 'q' && !reel.spinning) {
          quick = !quick;
          speedSeg.set(quick ? 'quick' : 'normal');
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
