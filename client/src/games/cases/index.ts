// Cases on the lounge computers (docs/rules/online-games.md §11): the desk as it stands on the
// floor, and the website on its monitor. Pick a case and what it costs; Open settles on the server
// at once and sends the item, and the reel runs past the marker and stops on it. Under the reel,
// everything the case holds, with what it pays and how often. Auto opens case after case (the
// quick reel or the full one, as chosen) until one of its stops.

import './cases.css';
import type { GameClientModule, TableView } from '../contract.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { CASES, CASE_INFO, RARITY_NAMES, WEIGHT, rarityOf, type CaseId } from '../../../../shared/src/games/cases/rules.ts';
import { QUICK_MS, REEL_MS, type CaseOpen, type CasesEvent, type CasesView } from '../../../../shared/src/games/cases/engine.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { SegChoice, labelled, InfoList, siteTone, shortTone, drawSiteBar, drawAttractPanel, multText, pctText } from '../online/screen.ts';
import { OnlineSite } from '../online/site.ts';
import { CaseReel, itemCard } from './reel.ts';

/** The chair's trim on the floor: Cases' vermilion. */
const ACCENT = '#ff5a36';

/** Rarity colours (cases.css has the same, for the page). */
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
    let chosen: CaseId = 'classic';
    let quick = false;
    let stack: Cents = 0;
    let busy = false;
    let sentAt = 0;

    const site = new OnlineSite(ctx, {
      game: 'cases',
      title: 'Cases',
      betLabel: 'Case price',
      action: 'Open case',
      primary: () => open(),
      sync: () => sync(),
      onBet: () => {
        sync();
        drawContents();
        describe();
      },
      auto: {
        gapMs: 650,
        play: () => {
          const bet = site.bet;
          if (!bet || busy || reel.spinning) return false;
          if (bet.value > stack) return 'not enough chips here for the next case';
          send(bet.value);
          return true;
        },
      },
    });
    const screen = site.screen;

    // The board: the reel, the result line, the case's contents (the last drops are the site's top row).
    const board = el('div', 'ca-board');
    const reel = new CaseReel();
    const result = el('div', 'ca-result');
    result.setAttribute('aria-live', 'polite');
    const contents = el('div', 'ca-contents');
    const contentsHead = el('div', 'ca-contents-head');
    const contentsGrid = el('div', 'ca-grid');
    contents.append(contentsHead, contentsGrid);
    board.append(reel.root, result, contents);
    screen.main.append(board);

    // The bet panel.
    const caseSeg = new SegChoice<CaseId>(
      CASES.map((id) => ({ value: id, label: CASE_INFO[id].name, title: CASE_INFO[id].about })),
      chosen,
      (id) => {
        chosen = id;
        caseChanged();
      },
    ).label('Case');
    caseSeg.root.classList.add('ca-cases');
    // each case button carries its top prize under its name
    caseSeg.root.querySelectorAll('button').forEach((b, i) => {
      const top = CASE_INFO[CASES[i]!].items.at(-1)!;
      b.append(el('span', `ca-case-top ca-r-${rarityOf(top.mult)}`, `Up to ${multText(top.mult).replace('.00', '')}`));
    });
    const speedSeg = new SegChoice<'normal' | 'quick'>([{ value: 'normal', label: 'Full reel' }, { value: 'quick', label: 'Quick open', title: 'A short reel (Q)', key: 'Q' }], 'normal', (v) => {
      quick = v === 'quick';
      siteTone(ctx.sfx, 880, 30, { type: 'triangle', gain: 0.03 });
    }).label('Reel');
    site.controls.append(labelled('Case', caseSeg.root), labelled('Reel', speedSeg.root));
    const info = new InfoList('This case');
    site.facts.append(info.root);

    const pillOf = (o: CaseOpen) => ({ text: multText(o.mult), accent: RARITY_COLOR[rarityOf(o.mult)] });

    const sync = () => {
      const block = busy || reel.spinning || site.locked;
      const bet = site.bet;
      if (!reel.spinning) screen.setStack(stack);
      bet?.setMax(stack);
      bet?.setEnabled(!block);
      caseSeg.setEnabled(!block);
      speedSeg.setEnabled(!block);
      site.auto?.setEnabled(!busy && !reel.spinning);
      site.paintMain(bet ? `Open for ${formatMoney(bet.value)}` : 'Open case', 'go', busy || reel.spinning || !bet || bet.value > stack, !!bet && bet.value <= stack);
    };

    const drawContents = () => {
      const c = CASE_INFO[chosen];
      const b = site.bet?.value ?? site.limits?.min ?? 100;
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
      const b = site.bet?.value ?? site.limits?.min ?? 100;
      site.profit('Top item', (b / 100) * top.mult - b, `${multText(top.mult)} · ${chanceText(top.weight)}`);
      info.set('more', 'Pays more than the case', pctText(more));
      info.set('likely', 'Most likely', `${likely.name} · ${multText(likely.mult)}`);
      const lim = site.limits;
      const range = lim ? ` · Cases ${formatMoney(lim.min)} to ${formatMoney(lim.max)}` : '';
      screen.setNote(`Return 99.00% on every case · ${c.name}${range} · Space opens · Q quick open`);
    };

    // Tips: every case returns the same 99%, and the tip says so.
    const tipFor = () => site.tip(ctx.tips.on ? 'Every case returns exactly 99%: a bigger case only trades steady small items for rare big ones.' : null);
    const offTips = ctx.tips.subscribe(tipFor);

    const caseChanged = (sound = true) => {
      drawContents();
      describe();
      if (!reel.spinning) reel.show(chosen);
      result.replaceChildren(el('span', 'ca-result-idle', `${CASE_INFO[chosen].name} case · ${CASE_INFO[chosen].about}`));
      tipFor();
      if (sound) siteTone(ctx.sfx, 880, 30, { type: 'triangle', gain: 0.03 });
    };

    const send = (amount: Cents) => {
      busy = true;
      sentAt = performance.now();
      ctx.link.act({ type: 'open', bet: amount, case: chosen, quick });
      sync();
    };

    const open = () => {
      const bet = site.bet;
      if (!bet || busy || reel.spinning) return;
      if (bet.value > stack) {
        shortTone(ctx.sfx);
        ctx.kit.toast('Not enough chips here for that case.', 'err');
        return;
      }
      send(bet.value);
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

    const reveal = async (e: CasesEvent) => {
      site.auto?.driver.answered();
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
      screen.setStack(e.stack);
      const it = CASE_INFO[e.case].items[e.item]!;
      const pill = pillOf(e);
      if (e.payout > e.bet) ctx.sfx.play('chips-stack', { volume: 0.5 });
      site.settle({
        bet: e.bet,
        payout: e.payout,
        mult: e.mult,
        pill: pill.text,
        accent: pill.accent,
        moment: { title: `${it.name} ${multText(e.mult)}`, sub: `${CASE_INFO[e.case].name} case · pays ${formatMoney(e.payout)} on ${formatMoney(e.bet)}` },
      });
    };

    caseChanged(false);
    sync();

    return {
      onTable(snap) {
        stack = snap.you.stack;
        busy = false;
        site.table(snap);
        const v = snap.view as CasesView;
        site.history.clear();
        for (const o of v.recent.slice(0, 9).reverse()) {
          const p = pillOf(o);
          site.history.push(p.text, o.payout > o.bet, false, p.accent);
        }
        const last = v.recent[0];
        if (last) {
          chosen = last.case;
          caseSeg.set(chosen);
        }
        caseChanged(false);
        if (last) {
          reel.show(last.case, last.item);
          showResult(last);
          site.result.show(last.bet, last.payout, last.mult, false);
        }
        sync();
      },

      async onEvents(events) {
        busy = false;
        for (const e of events) {
          if (e.type !== 'open') continue;
          sync();
          await reveal(e as unknown as CasesEvent);
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
        busy = false;
        sync();
      },

      keydown(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        if (e.code === 'Space') {
          if (!e.repeat) site.press();
          return true;
        }
        if (e.key.toLowerCase() === 'q' && !reel.spinning && !site.locked) {
          quick = !quick;
          speedSeg.set(quick ? 'quick' : 'normal');
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
