// Keno on the lounge computers (docs/rules/online-games.md §4): pick 1 to 10 of the 40 numbers,
// choose a risk and bet; the server draws ten and pays for the picks among them. The page reveals
// the ten one at a time, marks each hit with a gem, and lights the paytable column for the hits
// so far. The picks stay on the board for the next game until they're changed; Auto plays them
// game after game until one of its stops.

import './keno.css';
import type { GameClientModule, TableView } from '../contract.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { NUMBERS, MAX_PICKS, RISKS, RISK_NAMES, PAYS, hitChance, tableRtp, returnRange, type Risk } from '../../../../shared/src/games/keno/rules.ts';
import type { KenoEvent, KenoView } from '../../../../shared/src/games/keno/engine.ts';
import { wait } from '../../table/tween.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { actionButton, SegChoice, InfoList, OutcomePop, labelled, siteTone, shortTone, drawSiteBar, drawAttractPanel } from '../online/screen.ts';
import { OnlineSite } from '../online/site.ts';

/** The chair's trim on the floor: Keno's violet. */
const ACCENT = '#9b5cff';
/** Between one drawn number and the next (a little quicker on Auto). */
const REVEAL_MS = 130;

const multText = (m: number) => `${(m / 100).toFixed(2)}×`;
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const oneIn = (p: number) => `1 in ${Math.round(1 / p).toLocaleString('en-US')}`;
const cents = (c: Cents) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The monitor on the floor: the site's bar, a bet panel, and a board mid-draw. */
function drawAttract(g: CanvasRenderingContext2D, w: number, h: number): void {
  const top = drawSiteBar(g, w, 'Keno');
  drawAttractPanel(g, top, h, [['Bet', '$5.00'], ['Risk', 'Classic']], 'Bet');
  g.textAlign = 'center';

  const picked = new Set([4, 9, 13, 22, 27, 31, 38]);
  const drawn = new Set([2, 9, 13, 17, 25, 27, 30, 33, 36, 40]);
  const tw = 38;
  const th = 32;
  const gap = 6;
  const x0 = 132 + (w - 132 - (8 * tw + 7 * gap)) / 2;
  const y0 = top + 16;
  g.font = '700 14px system-ui, sans-serif';
  for (let n = 1; n <= NUMBERS; n++) {
    const x = x0 + ((n - 1) % 8) * (tw + gap);
    const y = y0 + Math.floor((n - 1) / 8) * (th + gap);
    const hit = picked.has(n) && drawn.has(n);
    const miss = drawn.has(n) && !picked.has(n);
    const [face, lip, ink] = hit ? ['#1fd65f', '#0f8f3c', '#06210f'] : picked.has(n) ? ['#8b3ffb', '#5a1fb4', '#eef3f8'] : miss ? ['#0f1e29', '#0a151d', '#ff5a5f'] : ['#2f4553', '#213743', '#eef3f8'];
    g.fillStyle = lip;
    g.beginPath();
    g.roundRect(x, y + 3, tw, th, 4);
    g.fill();
    g.fillStyle = face;
    g.beginPath();
    g.roundRect(x, y, tw, th, 4);
    g.fill();
    g.fillStyle = ink;
    g.fillText(String(n), x + tw / 2, y + th / 2 + 1);
  }
  // The paytable strip for seven picks, Classic, with three hits lit.
  const row = PAYS.classic[6]!;
  const py = h - 44;
  const pw = (w - 132 - 40 - 7 * 5) / 8;
  g.font = '700 11px system-ui, sans-serif';
  row.forEach((m, i) => {
    const x = 152 + i * (pw + 5);
    g.fillStyle = i === 3 ? '#1fd65f' : '#213743';
    g.beginPath();
    g.roundRect(x, py, pw, 24, 4);
    g.fill();
    g.fillStyle = i === 3 ? '#06210f' : m === 0 ? '#8b9cb0' : '#eef3f8';
    g.fillText(multText(m), x + pw / 2, py + 12);
  });
  g.textAlign = 'left';
}

export const keno: GameClientModule = {
  game: 'keno',
  footprint: PC_FOOTPRINT,
  createModel: () => pcModel({ attract: attractTexture(drawAttract), accent: ACCENT }),
  seats: () => [{ position: PC_SEAT, yaw: Math.PI }],
  playPose: () => pcPose(),

  mount(ctx): TableView {
    /** The picks, in the order they were made. */
    let picks: number[] = [];
    let risk: Risk = 'classic';
    let stack: Cents = 0;
    /** A bet is on its way to the server; `playing` counts draws still being revealed. */
    let busy = false;
    let playing = 0;
    let sentAt = 0;
    /** The last draw's marks, while they stand on the board. */
    let marked = false;

    const site = new OnlineSite(ctx, {
      game: 'keno',
      title: 'Keno',
      action: 'Bet',
      primary: () => play(),
      sync: () => render(),
      auto: {
        gapMs: 650,
        play: () => {
          const bet = site.bet;
          if (!bet || busy || playing > 0) return false;
          if (picks.length === 0) return 'pick 1 to 10 numbers first';
          if (bet.value > stack) return 'not enough chips here for the next game';
          send(bet.value);
          return true;
        },
      },
    });
    const screen = site.screen;

    // The board.
    const main = el('div', 'kn-main');
    const grid = el('div', 'kn-grid');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'The forty numbers');
    const tiles: HTMLButtonElement[] = [];
    for (let n = 1; n <= NUMBERS; n++) {
      const t = el('button', 'kn-tile', String(n));
      t.type = 'button';
      t.dataset.n = String(n);
      t.setAttribute('aria-pressed', 'false');
      t.addEventListener('mousedown', (e) => e.preventDefault());
      t.addEventListener('click', () => toggle(n));
      tiles.push(t);
      grid.append(t);
    }
    const pays = el('div', 'kn-pays');
    main.append(grid, pays);
    screen.main.append(main);
    const pop = new OutcomePop(main);

    // The bet panel.
    const riskSeg = new SegChoice(RISKS.map((r) => ({ value: r, label: RISK_NAMES[r] })), risk, (r) => {
      risk = r;
      clearMarks();
      siteTone(ctx.sfx, 880, 30, { type: 'triangle', gain: 0.03 });
      render();
    }).label('Risk');
    const autoBtn = actionButton('Auto Pick', () => autoPick(), 'plain', 'A');
    autoBtn.title = 'Pick at random (A)';
    const clearBtn = actionButton('Clear Table', () => clearPicks(), 'plain', 'C');
    clearBtn.title = 'Clear the picks (C)';
    const pair = el('div', 'os-pair');
    pair.append(autoBtn, clearBtn);
    site.controls.append(labelled('Risk', riskSeg.root), pair);
    const info = new InfoList('This game');
    site.facts.append(info.root);

    const tile = (n: number) => tiles[n - 1]!;
    const pulse = (t: HTMLElement, cls = 'pop') => {
      t.classList.remove('pop', 'full', 'land');
      void t.offsetWidth;
      t.classList.add(cls);
    };

    /** The paytable for the picks made; `now` lights a column, `won` greens it. */
    const renderPays = (now: number | null = null, won = false) => {
      const p = picks.length;
      if (p === 0) {
        pays.replaceChildren(el('div', 'kn-pays-empty', 'Pick 1 to 10 numbers to play'));
        return;
      }
      const row = el('div', 'kn-pays-grid');
      PAYS[risk][p - 1]!.forEach((m, h) => {
        const col = el('div', `kn-pay${h === now ? (won ? ' won' : ' now') : ''}`);
        col.title = `${h} of ${p} hit: ${pct(hitChance(p, h))}`;
        col.append(el('div', `kn-pay-mult${m === 0 ? ' zero' : ''}`, multText(m)), el('div', 'kn-pay-hits', String(h)));
        row.append(col);
      });
      pays.replaceChildren(row);
    };

    const locked = () => busy || playing > 0 || site.locked;

    const renderTiles = () => {
      const lock = locked();
      tiles.forEach((t, i) => {
        const on = picks.includes(i + 1);
        t.classList.toggle('picked', on);
        t.setAttribute('aria-pressed', String(on));
        t.disabled = lock;
      });
    };

    const render = () => {
      renderTiles();
      if (!marked) renderPays();
      const p = picks.length;
      const lock = locked();
      const bet = site.bet;
      bet?.setMax(stack);
      bet?.setEnabled(!site.locked);
      riskSeg.setEnabled(!lock);
      autoBtn.disabled = lock;
      clearBtn.disabled = lock || p === 0;
      site.auto?.setEnabled(!busy && playing === 0);
      site.paintMain('Bet', 'go', lock || !bet || p === 0 || bet.value > stack, !!bet && p > 0 && bet.value <= stack);
      const range = returnRange();
      const b = bet?.value ?? site.limits?.min ?? 100;
      if (p === 0) site.profit('Top pay', null, 'pick 1 to 10 numbers');
      else site.profit('Top pay', (b / 100) * PAYS[risk][p - 1]![p]! - b, `${multText(PAYS[risk][p - 1]![p]!)} · ${p} of ${p} hit`);
      if (p === 0) {
        info.set('picks', 'Picks', `0 of ${MAX_PICKS}`);
        info.set('odds', 'Top pay odds', '—');
        info.set('rtp', 'Return', `${pct(range.min)} to ${pct(range.max)}`);
        info.set('profit', 'A profit from', '—');
        info.set('back', 'Pays the bet or more', '—');
      } else {
        const row = PAYS[risk][p - 1]!;
        let back = 0;
        row.forEach((m, h) => {
          if (m >= 100) back += hitChance(p, h);
        });
        const from = row.findIndex((m) => m > 100);
        info.set('picks', 'Picks', `${p} of ${MAX_PICKS}`);
        info.set('rtp', 'Return', pct(tableRtp(risk, p)));
        info.set('odds', 'Top pay odds', oneIn(hitChance(p, p)));
        info.set('profit', 'A profit from', `${from} hit${from === 1 ? '' : 's'}`);
        info.set('back', 'Pays the bet or more', pct(back));
      }
      const lim = site.limits;
      const limText = lim ? ` · Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}` : '';
      screen.setNote(p === 0 ? `Return ${pct(range.min)} to ${pct(range.max)} by risk and picks${limText} · Space bets · A picks at random · C clears` : `Return ${pct(tableRtp(risk, p))} · ${RISK_NAMES[risk]}, ${p} pick${p > 1 ? 's' : ''}${limText} · Space bets · A picks at random · C clears`);
      tipFor();
    };

    // Tips: the tables all return about 99%, a few tenths apart. The tip gives this one's return
    // and rings the risk that returns the most for this many picks.
    const range = returnRange();
    const tipFor = () => {
      riskSeg.tip(null);
      if (!ctx.tips.on) return site.tip(null);
      const p = picks.length;
      if (p === 0) {
        site.tip(`Every table returns ${pct(range.min)} to ${pct(range.max)}; ${RISK_NAMES[range.best.risk]} with ${range.best.picks} picks returns the most.`);
        return;
      }
      let best: Risk = RISKS[0];
      for (const r of RISKS) if (tableRtp(r, p) > tableRtp(best, p)) best = r;
      const s = p > 1 ? 's' : '';
      site.tip(
        best === risk
          ? `With ${p} pick${s}, ${RISK_NAMES[risk]} returns the most: ${pct(tableRtp(risk, p))}. Every table is ${pct(range.min)} to ${pct(range.max)}.`
          : `${RISK_NAMES[risk]} with ${p} pick${s} returns ${pct(tableRtp(risk, p))}; ${RISK_NAMES[best]} returns ${pct(tableRtp(best, p))}.`,
      );
      riskSeg.tip(best);
    };
    const offTips = ctx.tips.subscribe(tipFor);

    /** Take the last draw's marks off the board. */
    const clearMarks = () => {
      if (!marked) return;
      marked = false;
      for (const t of tiles) t.classList.remove('drawn', 'hit', 'land');
      pop.hide();
    };

    const toggle = (n: number) => {
      if (locked()) return;
      clearMarks();
      const i = picks.indexOf(n);
      if (i >= 0) {
        picks.splice(i, 1);
        siteTone(ctx.sfx, 520, 30, { type: 'triangle', gain: 0.025 });
      } else if (picks.length >= MAX_PICKS) {
        pulse(tile(n), 'full');
        siteTone(ctx.sfx, 150, 110, { type: 'sawtooth', gain: 0.025 });
        return;
      } else {
        picks.push(n);
        pulse(tile(n));
        siteTone(ctx.sfx, 700 + n * 6, 32, { type: 'triangle', gain: 0.03 });
      }
      render();
    };

    const autoPick = () => {
      if (locked()) return;
      clearMarks();
      const count = picks.length || MAX_PICKS;
      const pool = Array.from({ length: NUMBERS }, (_, i) => i + 1);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
      picks = pool.slice(0, count);
      for (const n of picks) pulse(tile(n));
      siteTone(ctx.sfx, 660, 50, { type: 'triangle', gain: 0.03, to: 990 });
      render();
    };

    const clearPicks = () => {
      if (locked()) return;
      clearMarks();
      picks = [];
      render();
    };

    const send = (amount: Cents) => {
      busy = true;
      sentAt = performance.now();
      clearMarks();
      renderPays();
      ctx.link.act({ type: 'bet', bet: amount, picks: picks.slice(), risk });
      render();
    };

    const play = () => {
      const bet = site.bet;
      if (!bet || busy || playing > 0) return;
      if (picks.length === 0) {
        ctx.kit.toast('Pick 1 to 10 numbers first.', 'err');
        return;
      }
      if (bet.value > stack) {
        shortTone(ctx.sfx);
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      send(bet.value);
    };

    /** Show a finished draw's marks at once (joining, reconnecting). */
    const showDraw = (drawn: readonly number[], drawnPicks: readonly number[]) => {
      marked = true;
      for (const n of drawn) {
        tile(n).classList.add('drawn');
        if (drawnPicks.includes(n)) tile(n).classList.add('hit');
      }
    };

    const playDraw = async (ev: KenoEvent) => {
      site.auto?.driver.answered();
      screen.setStack(ev.stack - ev.payout);
      // A draw starts on a clean board (a bet from this page cleared it already; a draw that
      // arrives any other way must not inherit the last one's marks), showing what was bet.
      clearMarks();
      picks = ev.picks.slice();
      risk = ev.risk;
      riskSeg.set(risk);
      marked = true;
      render();
      renderPays(0);
      let hits = 0;
      const gap = site.locked ? REVEAL_MS * 0.75 : REVEAL_MS;
      for (const n of ev.drawn) {
        await wait(gap);
        const hit = ev.picks.includes(n);
        const t = tile(n);
        t.classList.add('drawn');
        if (hit) {
          hits++;
          t.classList.add('hit');
          siteTone(ctx.sfx, 880 + hits * 110, 110, { type: 'triangle', gain: 0.05 });
          siteTone(ctx.sfx, 1760 + hits * 220, 70, { type: 'sine', gain: 0.025, at: 40 });
        } else siteTone(ctx.sfx, 260 + hits * 20, 45, { type: 'sine', gain: 0.03 });
        pulse(t, 'land');
        renderPays(hits);
      }
      const won = ev.payout > ev.bet;
      renderPays(ev.hits, won);
      if (ev.payout > 0) pop.show(ev.mult, ev.payout, ev.bet, 0, `${ev.hits} of ${ev.picks.length} hit · ${cents(ev.payout)}`);
      screen.setStack(ev.stack);
      site.settle({
        bet: ev.bet,
        payout: ev.payout,
        mult: ev.mult,
        moment: { title: `Keno ${multText(ev.mult)}`, sub: `${ev.hits} of ${ev.picks.length} hit on ${RISK_NAMES[ev.risk]} · pays ${cents(ev.payout)}` },
      });
    };

    render();

    return {
      onTable(snap) {
        stack = snap.you.stack;
        busy = false;
        site.table(snap);
        screen.setStack(stack);
        const recent = (snap.view as KenoView).recent;
        const last = recent[0];
        clearMarks();
        site.history.clear();
        for (const d of recent.slice(0, 9).reverse()) site.history.push(multText(d.mult), d.payout > d.bet, false);
        if (last) {
          picks = last.picks.slice();
          risk = last.risk;
          riskSeg.set(risk);
          showDraw(last.drawn, last.picks);
          renderPays(last.hits, last.payout > last.bet);
          site.result.show(last.bet, last.payout, last.mult, false);
        }
        render();
      },

      async onEvents(events) {
        busy = false;
        playing++;
        try {
          for (const e of events) if (e.type === 'draw') await playDraw(e as unknown as KenoEvent);
        } finally {
          playing--;
          render();
        }
      },

      onConnection(open) {
        site.connection(open);
      },

      onSeat(msg) {
        site.seat(msg);
        stack = msg.stack;
        if (playing === 0) screen.setStack(stack);
        render();
      },

      onError(_code, msg) {
        site.error(msg);
        busy = false;
        render();
      },

      keydown(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        if (e.code === 'Space') {
          if (!e.repeat) site.press();
          return true;
        }
        if (e.repeat) return false;
        if (e.code === 'KeyA') autoPick();
        else if (e.code === 'KeyC') clearPicks();
        else return false;
        return true;
      },

      update(dt) {
        if (busy && performance.now() - sentAt > 6_000) {
          busy = false;
          render();
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
