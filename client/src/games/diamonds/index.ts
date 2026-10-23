// Diamonds on the lounge computers (docs/rules/online-games.md §12): the desk as it stands on the
// floor, and the website on its monitor. Bet, and five gems are set down one by one; the hand pays
// by how their colours group, like a poker hand. The paytable along the bottom lights the pattern
// that came up, and the gems that made it glow. Auto deals hand after hand until one of its stops.

import './diamonds.css';
import type { GameClientModule, TableView } from '../contract.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { GEMS, GEM_NAMES, HANDS, PATTERNS, PATTERN_NAMES, PAYS, WAYS, matched, type Pattern } from '../../../../shared/src/games/diamonds/rules.ts';
import type { DiamondsEvent, DiamondsHand, DiamondsView } from '../../../../shared/src/games/diamonds/engine.ts';
import { wait } from '../../table/tween.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { InfoList, BetLog, siteTone, shortTone, drawSiteBar, drawAttractPanel, multText, pctText } from '../online/screen.ts';
import { OnlineSite } from '../online/site.ts';
import { GEM_TONES, gemIcon } from './gems.ts';

/** The chair's trim on the floor: Diamonds' aquamarine. */
const ACCENT = '#2fd8f0';
const DROP_GAP_MS = 190;

/** How each pattern groups five gems, for the paytable's little rows of dots: colour per gem. */
const SHAPES: Record<Pattern, (number | null)[]> = {
  five: [0, 0, 0, 0, 0],
  four: [1, 1, 1, 1, null],
  fullhouse: [2, 2, 2, 5, 5],
  three: [3, 3, 3, null, null],
  twopair: [4, 4, 6, 6, null],
  pair: [5, 5, null, null, null],
  none: [null, null, null, null, null],
};

const oneIn = (ways: number) => `1 in ${Math.round(HANDS / ways).toLocaleString('en-US')}`;

/** The monitor on the floor: the site's bar, a bet panel, and a full house on its pedestals. */
function drawAttract(g: CanvasRenderingContext2D, w: number, h: number): void {
  const top = drawSiteBar(g, w, 'Diamonds');
  const left = drawAttractPanel(g, top, h, [['Bet', '$10.00']], 'Bet');
  const hand = [1, 4, 1, 4, 1];
  const s = 58;
  const gap = 12;
  const x0 = left + (w - left - (5 * s + 4 * gap)) / 2;
  const y0 = top + 96;
  hand.forEach((c, i) => {
    const x = x0 + i * (s + gap);
    const t = GEM_TONES[c]!;
    g.fillStyle = '#213743';
    g.beginPath();
    g.roundRect(x, y0, s, s + 14, 8);
    g.fill();
    const glow = g.createRadialGradient(x + s / 2, y0 + s / 2, 4, x + s / 2, y0 + s / 2, s / 2 + 4);
    glow.addColorStop(0, t.glow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.45;
    g.fillStyle = glow;
    g.fillRect(x - 4, y0 - 4, s + 8, s + 8);
    g.globalAlpha = 1;
    g.fillStyle = t.mid;
    g.beginPath();
    if (c === 1) g.arc(x + s / 2, y0 + s / 2, 20, 0, Math.PI * 2);
    else g.roundRect(x + 10, y0 + 10, s - 20, s - 20, 10);
    g.fill();
    g.fillStyle = t.light;
    g.beginPath();
    g.moveTo(x + s / 2, y0 + 16);
    g.lineTo(x + s - 16, y0 + s / 2);
    g.lineTo(x + s / 2, y0 + s - 16);
    g.lineTo(x + 16, y0 + s / 2);
    g.closePath();
    g.fill();
  });
  g.textAlign = 'center';
  g.fillStyle = '#1fd65f';
  g.font = '700 26px system-ui, sans-serif';
  g.fillText('Full house  4.00×', left + (w - left) / 2, y0 + s + 58);
  g.textAlign = 'left';
}

export const diamonds: GameClientModule = {
  game: 'diamonds',
  footprint: PC_FOOTPRINT,
  createModel: () => pcModel({ attract: attractTexture(drawAttract), accent: ACCENT }),
  seats: () => [{ position: PC_SEAT, yaw: Math.PI }],
  playPose: () => pcPose(),

  mount(ctx): TableView {
    let stack: Cents = 0;
    let busy = false;
    let animating = false;
    let sentAt = 0;

    const site = new OnlineSite(ctx, {
      game: 'diamonds',
      title: 'Diamonds',
      action: 'Bet',
      primary: () => play(),
      sync: () => sync(),
      auto: {
        gapMs: 520,
        play: () => {
          const bet = site.bet;
          if (!bet || busy || animating) return false;
          if (bet.value > stack) return 'not enough chips here for the next hand';
          send(bet.value);
          return true;
        },
      },
    });
    const screen = site.screen;

    // The board: the paytable, five pedestals, the hand's name (the recent hands are the site's top row).
    const board = el('div', 'dm-board');
    const table = el('div', 'dm-paytable');
    const rows = new Map<Pattern, HTMLElement>();
    for (const p of PATTERNS) {
      const row = el('div', `dm-pay${PAYS[p] === 0 ? ' nothing' : ''}`);
      const dots = el('div', 'dm-dots');
      for (const c of SHAPES[p]) {
        const d = el('span', 'dm-dot');
        if (c !== null) d.style.background = GEM_TONES[c]!.mid;
        dots.append(d);
      }
      row.append(dots, el('span', 'dm-pay-mult', multText(PAYS[p])), el('span', 'dm-pay-name', PATTERN_NAMES[p]), el('span', 'dm-pay-odds', pctText(WAYS[p] / HANDS)));
      row.title = `${PATTERN_NAMES[p]}: ${WAYS[p].toLocaleString('en-US')} of the ${HANDS.toLocaleString('en-US')} hands (${oneIn(WAYS[p])})`;
      rows.set(p, row);
      table.append(row);
    }
    const slots: HTMLElement[] = [];
    const stand = el('div', 'dm-stand');
    for (let i = 0; i < GEMS; i++) {
      const slot = el('div', 'dm-slot');
      slot.append(el('div', 'dm-socket'));
      slots.push(slot);
      stand.append(slot);
    }
    const verdict = el('div', 'dm-verdict');
    verdict.setAttribute('aria-live', 'polite');
    board.append(table, stand, verdict);
    screen.main.append(board);

    // The bet panel.
    const info = new InfoList('The hand');
    const log = new BetLog('Last hands', ['Hand', 'Pays', 'Payout'], 5);
    log.root.classList.add('dm-log');
    site.facts.append(info.root, log.root);
    const logHand = (h: DiamondsHand, fresh: boolean) => log.push([PATTERN_NAMES[h.pattern], multText(h.mult), formatMoney(h.payout)], h.payout > h.bet, fresh);

    const better = (['five', 'four', 'fullhouse', 'three', 'twopair'] as Pattern[]).reduce((n, p) => n + WAYS[p], 0);
    info.set('rtp', 'Return', '99.00%');
    info.set('more', 'Pays more than the bet', pctText(better / HANDS));
    info.set('any', 'Pays something', pctText((HANDS - WAYS.none) / HANDS));

    const lim0 = () => site.limits?.min ?? 100;
    const sync = () => {
      const block = busy || animating || site.locked;
      const bet = site.bet;
      if (!animating) screen.setStack(stack);
      bet?.setMax(stack);
      bet?.setEnabled(!block);
      site.auto?.setEnabled(!busy && !animating);
      site.paintMain('Bet', 'go', busy || animating || !bet || bet.value > stack, !!bet && bet.value <= stack);
      const b = bet?.value ?? lim0();
      site.profit('Five of a kind', (b / 100) * PAYS.five - b, `${multText(PAYS.five)} · ${oneIn(WAYS.five)}`);
      const lim = site.limits;
      const range = lim ? ` · Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}` : '';
      screen.setNote(`Return 99.00% · five gems, seven colours, each gem as likely as the next${range} · Space bets`);
    };

    // Tips: there is nothing to choose but the bet, and the tip says so.
    const tipFor = () => site.tip(ctx.tips.on ? 'Every gem is drawn on its own, one of seven colours: a hand returns exactly 99% whatever came before it.' : null);
    const offTips = ctx.tips.subscribe(tipFor);

    const setGem = (i: number, color: number | null, look: '' | 'lit' | 'dim' = '') => {
      const slot = slots[i]!;
      slot.className = `dm-slot${color === null ? '' : ' full'}${look ? ` ${look}` : ''}`;
      slot.replaceChildren(el('div', 'dm-socket'));
      if (color !== null) {
        const gem = el('div', 'dm-gem');
        gem.style.setProperty('--dm-glow', GEM_TONES[color]!.glow);
        gem.title = GEM_NAMES[color]!;
        gem.append(gemIcon(color));
        slot.append(gem);
      }
    };

    const showHand = (h: DiamondsHand | null) => {
      for (const r of rows.values()) r.classList.remove('hit');
      if (!h) {
        slots.forEach((_, i) => setGem(i, null));
        verdict.replaceChildren(el('span', 'dm-verdict-idle', 'Five gems, seven colours: match them for a pay'));
        return;
      }
      const m = matched(h.gems);
      h.gems.forEach((c, i) => setGem(i, c, h.pattern === 'none' ? 'dim' : m[i] ? 'lit' : 'dim'));
      rows.get(h.pattern)?.classList.add('hit');
      verdict.replaceChildren(
        el('span', `dm-verdict-name${h.payout > h.bet ? ' win' : ''}`, PATTERN_NAMES[h.pattern]),
        el('span', 'dm-verdict-pay', h.payout > 0 ? `${multText(h.mult)} · ${formatMoney(h.payout)}` : 'No pay'),
      );
    };

    const send = (amount: Cents) => {
      busy = true;
      sentAt = performance.now();
      ctx.link.act({ type: 'bet', bet: amount });
      sync();
    };

    const play = () => {
      const bet = site.bet;
      if (!bet || busy || animating) return;
      if (bet.value > stack) {
        shortTone(ctx.sfx);
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      send(bet.value);
    };

    const reveal = async (e: DiamondsEvent) => {
      site.auto?.driver.answered();
      screen.setStack(e.stack - e.payout);
      for (const r of rows.values()) r.classList.remove('hit');
      verdict.replaceChildren(el('span', 'dm-verdict-idle', ''));
      slots.forEach((_, i) => setGem(i, null));
      const seen: number[] = [];
      const gap = site.locked ? DROP_GAP_MS * 0.8 : DROP_GAP_MS;
      for (let i = 0; i < GEMS; i++) {
        await wait(i === 0 ? 60 : gap);
        const c = e.gems[i]!;
        setGem(i, c);
        slots[i]!.classList.add('drop');
        // a match with a gem already down rings higher
        const again = seen.includes(c);
        seen.push(c);
        siteTone(ctx.sfx, again ? 1175 + seen.filter((x) => x === c).length * 110 : 660 + i * 45, again ? 150 : 70, { type: 'triangle', gain: again ? 0.05 : 0.035 });
      }
      await wait(220);
      showHand(e);
      logHand(e, true);
      screen.setStack(e.stack);
      if (e.payout > e.bet) ctx.sfx.play('chips-stack', { volume: 0.5 });
      site.settle({
        bet: e.bet,
        payout: e.payout,
        mult: e.mult,
        moment: { title: PATTERN_NAMES[e.pattern], sub: `Diamonds ${multText(e.mult)} · pays ${formatMoney(e.payout)} on ${formatMoney(e.bet)}` },
      });
    };

    showHand(null);
    sync();

    return {
      onTable(snap) {
        stack = snap.you.stack;
        busy = false;
        animating = false;
        site.table(snap);
        const v = snap.view as DiamondsView;
        site.history.clear();
        for (const h of v.recent.slice(0, 9).reverse()) site.history.push(multText(h.mult), h.payout > h.bet, false);
        log.clear();
        for (const h of v.recent.slice(0, 5).reverse()) logHand(h, false);
        const last = v.recent[0] ?? null;
        showHand(last);
        if (last) site.result.show(last.bet, last.payout, last.mult, false);
        sync();
        tipFor();
      },

      async onEvents(events) {
        busy = false;
        animating = true;
        sync();
        try {
          for (const e of events) if (e.type === 'draw') await reveal(e as unknown as DiamondsEvent);
        } finally {
          animating = false;
          sync();
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
