// Hi-Lo on the lounge computers (docs/rules/online-games.md §7): the desk as it stands on the
// floor, and the website on its monitor. A card is always face up; Bet starts a round on it, each
// guess has the server draw the next card (there is no next card anywhere until then), and a trail
// along the bottom keeps the round's cards. Cash out any time after a right guess.

import './hilo.css';
import type { GameClientModule, TableView } from '../contract.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import { rankNumber, type Card } from '../../../../shared/src/cards.ts';
import { formatMoney, type BetLimits, type Cents } from '../../../../shared/src/money.ts';
import { winCount, singleReturn, bestFirstGuess, type Guess } from '../../../../shared/src/games/hilo/rules.ts';
import type { HiloView, HiloStep, HiloOption } from '../../../../shared/src/games/hilo/engine.ts';
import { celebrate } from '../../table/celebrate.ts';
import { wait } from '../../table/tween.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, pcScreenCorners, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { OnlineScreen, AddChips, BetBox, actionButton, InfoList, SessionTally, OutcomePop, CardTrail, commitTyping, winTier, siteTone, drawSiteBar, drawAttractPanel, multText, pctText, type TrailEntry } from '../online/screen.ts';

/** The chair's trim on the floor: Hi-Lo's violet. */
const ACCENT = '#8b5cff';
const RANK_NAMES = ['', 'ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];
const cardUrl = (c: string) => `${import.meta.env.BASE_URL}assets/cards/${c}.svg`;

/** One guess and a cash-out: floor(1287 / count) × count / 1300, best of the two guesses. */
const bestReturn = (r: number) => singleReturn(winCount(r, bestFirstGuess(r))).num / 1300;
/** Ranks where one guess returns exactly 99% (the cent floor takes nothing): A, 3, 5, 9, J, K. */
const EXACT_RANKS = Array.from({ length: 13 }, (_, i) => i + 1).filter((r) => singleReturn(winCount(r, bestFirstGuess(r))).num === 1287);
const EXACT_WORDS = 'an ace, 3, 5, 9, jack or king';

const arrow = (dir: Guess): SVGSVGElement => {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', 'hl-arrow');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', dir === 'hi' ? 'M10 3 18 15H2Z' : 'M10 17 2 5H18Z');
  svg.append(p);
  return svg;
};

function trailEntry(s: HiloStep): TrailEntry {
  if (s.how === 'start') return { card: s.card, caption: 'Start', tone: 'plain' };
  if (s.how === 'skip') return { card: s.card, caption: 'Skip', tone: 'plain' };
  const mark = s.how === 'hi' ? '▲' : '▼';
  return s.win ? { card: s.card, caption: `${mark} ${multText(s.mult)}`, tone: 'win' } : { card: s.card, caption: `${mark} Lost`, tone: 'lose' };
}

/** The monitor on the floor: the site's bar, the guess buttons, and a card with the trail under it. */
function drawAttract(g: CanvasRenderingContext2D, w: number, h: number): void {
  const top = drawSiteBar(g, w, 'Hi-Lo');
  const left = drawAttractPanel(g, top, h, [['Bet', '$5.00']], 'Bet');
  g.textBaseline = 'middle';
  const btn = (y: number, label: string, odds: string, up: boolean) => {
    g.fillStyle = '#2f4553';
    g.beginPath();
    g.roundRect(10, y, 112, 44, 5);
    g.fill();
    g.fillStyle = up ? '#1fd65f' : '#ff5a5f';
    g.beginPath();
    if (up) {
      g.moveTo(24, y + 13);
      g.lineTo(31, y + 25);
      g.lineTo(17, y + 25);
    } else {
      g.moveTo(24, y + 27);
      g.lineTo(31, y + 15);
      g.lineTo(17, y + 15);
    }
    g.fill();
    g.fillStyle = '#eef3f8';
    g.font = '700 11px system-ui, sans-serif';
    g.fillText(label, 36, y + 15);
    g.fillStyle = '#a7b4c6';
    g.font = '600 11px system-ui, sans-serif';
    g.fillText(odds, 36, y + 31);
  };
  btn(top + 122, 'Higher or same', '38.46% · 2.57×', true);
  btn(top + 174, 'Lower or same', '69.23% · 1.43×', false);

  // The card: a 9 of hearts, drawn plainly.
  const cx = left + (w - left) / 2;
  const cw = 92;
  const ch = 128;
  const cy = top + 22;
  g.fillStyle = '#0a141b';
  g.beginPath();
  g.roundRect(cx - cw / 2 + 5, cy + 6, cw, ch, 8);
  g.fill();
  g.fillStyle = '#fbfbf7';
  g.beginPath();
  g.roundRect(cx - cw / 2, cy, cw, ch, 8);
  g.fill();
  g.fillStyle = '#d0213a';
  g.font = '700 30px Georgia, serif';
  g.textAlign = 'left';
  g.fillText('9', cx - cw / 2 + 9, cy + 22);
  g.font = '56px Georgia, serif';
  g.textAlign = 'center';
  g.fillText('♥', cx, cy + ch / 2 + 6);
  // The trail under it.
  const tw = 30;
  const th = 42;
  const ty = h - th - 30;
  const cards = [
    ['4', '#1b1b1b'],
    ['J', '#d0213a'],
    ['2', '#1b1b1b'],
    ['9', '#d0213a'],
  ];
  cards.forEach(([rank, ink], i) => {
    const x = cx - (cards.length * (tw + 8)) / 2 + i * (tw + 8);
    g.fillStyle = '#fbfbf7';
    g.beginPath();
    g.roundRect(x, ty, tw, th, 4);
    g.fill();
    g.fillStyle = ink!;
    g.font = '700 15px Georgia, serif';
    g.fillText(rank!, x + tw / 2, ty + th / 2);
    g.fillStyle = i === 0 ? '#2f4553' : '#1d4a33';
    g.beginPath();
    g.roundRect(x - 2, ty + th + 5, tw + 4, 14, 3);
    g.fill();
  });
  g.textAlign = 'left';
}

interface GuessButton {
  root: HTMLButtonElement;
  label: HTMLElement;
  odds: HTMLElement;
}

export const hilo: GameClientModule = {
  game: 'hilo',
  footprint: PC_FOOTPRINT,
  createModel: () => pcModel({ attract: attractTexture(drawAttract), accent: ACCENT }),
  seats: () => [{ position: PC_SEAT, yaw: Math.PI }],
  playPose: () => pcPose(),

  mount(ctx): TableView {
    const screen = new OnlineScreen('Hi-Lo');
    ctx.ui.append(screen.root);
    const cashier = new AddChips(screen, ctx);
    const corners = pcScreenCorners();

    let view: HiloView | null = null;
    let stack: Cents = 0;
    let animating = false;
    let busy = false;
    let limits: BetLimits | null = null;
    let bet: BetBox | null = null;
    let tipShown = false;

    // --- the board: the deck, the card, what each guess would pay, the trail
    const stage = el('div', 'hl-stage');
    const deck = el('div', 'hl-deck');
    for (let i = 0; i < 3; i++) {
      const back = el('img', 'hl-back');
      back.src = cardUrl('back-red');
      back.alt = '';
      back.draggable = false;
      deck.append(back);
    }
    const cardBox = el('div', 'hl-card-box');
    const card = el('img', 'hl-card');
    card.alt = '';
    card.draggable = false;
    cardBox.append(card);
    const edge = (letter: string, text: string, cls: string) => {
      const b = el('div', `hl-edge ${cls}`);
      b.append(el('span', 'hl-edge-letter', letter), el('span', 'hl-edge-text', text));
      return b;
    };
    stage.append(edge('K', 'King is the highest', 'k'), deck, cardBox, edge('A', 'Ace is the lowest', 'a'));
    const stat = (label: string) => {
      const s = el('div', 'os-stat');
      const l = el('span', 'os-stat-label', label);
      const v = el('span', 'os-stat-value', '$0');
      s.append(l, v);
      return { root: s, label: l, value: v };
    };
    const profitHi = stat('Profit higher');
    const profitLo = stat('Profit lower');
    const profitAll = stat('Total profit');
    const stats = el('div', 'os-stats hl-stats');
    stats.append(profitHi.root, profitLo.root, profitAll.root);
    const trail = new CardTrail(11);
    trail.root.classList.add('hl-trail');
    const pop = new OutcomePop(cardBox);
    const boardEl = el('div', 'hl-board');
    boardEl.append(stage, stats, trail.root);
    screen.main.append(boardEl);

    // --- the panel
    const guessButton = (dir: Guess): GuessButton => {
      const root = el('button', `hl-guess ${dir}`);
      root.type = 'button';
      root.title = dir === 'hi' ? 'Higher (↑ or H)' : 'Lower (↓ or L)';
      root.addEventListener('mousedown', (e) => e.preventDefault());
      root.addEventListener('click', () => guess(dir));
      const label = el('span', 'hl-guess-label');
      const odds = el('span', 'hl-guess-odds');
      const text = el('span', 'hl-guess-text');
      text.append(label, odds);
      root.append(arrow(dir), text);
      return { root, label, odds };
    };
    const hiBtn = guessButton('hi');
    const loBtn = guessButton('lo');
    const guesses = el('div', 'hl-guesses');
    guesses.append(hiBtn.root, loBtn.root);
    const main = actionButton('Bet', () => primary());
    main.title = 'Bet, or cash out (Space)';
    const skip = actionButton('Skip card', () => act({ type: 'skip' }), 'plain');
    skip.title = 'Skip this card (S)';
    skip.classList.add('hl-skip');
    const info = new InfoList('This round');
    const tally = new SessionTally();
    screen.side.append(main, guesses, skip, info.root, tally.root);

    const playing = () => view?.phase === 'playing';

    const act = (a: object) => {
      if (busy || animating) return;
      busy = true;
      ctx.link.act(a);
      sync();
    };

    const guess = (dir: Guess) => {
      if (!playing() || !view) return;
      const o = dir === 'hi' ? view.hi : view.lo;
      if (!o.allowed) return;
      act({ type: 'guess', dir });
    };

    const primary = () => {
      commitTyping(screen.root);
      if (playing()) {
        if ((view?.mult ?? 0) > 0) act({ type: 'cashout' });
        return;
      }
      if (!bet) return;
      if (bet.value > stack) {
        siteTone(ctx.sfx, 150, 120, { type: 'sawtooth', gain: 0.03 });
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      pop.hide();
      act({ type: 'bet', amount: bet.value });
      siteTone(ctx.sfx, 520, 60, { type: 'triangle', gain: 0.04, to: 760 });
    };

    /** A guess button: what it wins on, its chance, and what a win multiplies the round by. */
    const showOption = (b: GuessButton, o: HiloOption, on: boolean) => {
      b.label.textContent = o.label;
      b.odds.textContent = `${pctText(o.count / 13)} · ×${(Math.floor(1287 / o.count) / 100).toFixed(2)}`;
      b.root.disabled = !on || !o.allowed;
      b.root.classList.toggle('capped', !o.allowed);
    };

    const sync = () => {
      const on = playing();
      const v = view;
      if (!animating) screen.setStack(stack);
      bet?.setEnabled(!on && !busy);
      const stake = on && v ? v.bet : bet?.value ?? 0;
      const free = !busy && !animating;
      if (on && v) {
        const cash = (v.bet / 100) * v.mult;
        main.className = 'os-action cash';
        main.textContent = v.mult > 0 ? `Cash out ${formatMoney(cash)}` : 'Cash out';
        main.disabled = !free || v.mult === 0;
      } else {
        main.className = 'os-action go';
        main.textContent = 'Bet';
        main.disabled = !free || !bet || bet.value > stack;
      }
      if (v) {
        showOption(hiBtn, v.hi, on && free);
        showOption(loBtn, v.lo, on && free);
        // what winning each guess would put the round at, and what the round stands at now
        const pay = (m: number) => (stake / 100) * m;
        profitHi.label.textContent = `Profit on ${v.hi.label.toLowerCase()} (${multText(v.hi.mult)})`;
        profitHi.value.textContent = formatMoney(pay(v.hi.mult) - stake, { sign: true });
        profitLo.label.textContent = `Profit on ${v.lo.label.toLowerCase()} (${multText(v.lo.mult)})`;
        profitLo.value.textContent = formatMoney(pay(v.lo.mult) - stake, { sign: true });
        const now = on ? v.mult : 0;
        profitAll.label.textContent = `Total profit (${multText(now || 100)})`;
        profitAll.value.textContent = formatMoney(now > 0 ? pay(now) - stake : 0, { sign: true });
        profitAll.value.className = `os-stat-value${now > 100 ? ' win' : ''}`;
        info.set('now', 'Cash out now', on && v.mult > 0 ? `${multText(v.mult)} · ${formatMoney(pay(v.mult))}` : '—', on && v.mult > 0 ? 'win' : null);
        info.set('wins', 'Right guesses', String(on ? v.trail.filter((t) => t.how !== 'start' && t.how !== 'skip' && t.win).length : 0));
        info.set('skips', 'Skips left', String(v.skipsLeft));
      }
      skip.disabled = !free || (on && (v?.skipsLeft ?? 0) === 0);
      const lim = limits ? ` · Bet ${formatMoney(limits.min)} to ${formatMoney(limits.max)}` : '';
      screen.setNote(`Each guess pays 12.87 ÷ the winning ranks: 99% of what rides, before the cent${lim} · Space bets and cashes out · ↑ ↓ guess · S skips`);
      tipFor();
    };

    // Tips. Every guess keeps 1% of what rides, so after a right guess the most you can keep is
    // by cashing out. Before one, the floor to the cent decides: one guess returns exactly 99% on
    // an ace, 3, 5, 9, jack or king (the guess ringed), and a little less on the others, where a
    // free skip is worth more.
    const clearTip = () => {
      if (!tipShown) return;
      tipShown = false;
      ctx.kit.tip(null);
      for (const b of [main, skip, hiBtn.root, loBtn.root]) b.classList.remove('tip-pick');
    };
    const tipFor = () => {
      if (!ctx.tips.on || busy || animating || !view) return clearTip();
      for (const b of [main, skip, hiBtn.root, loBtn.root]) b.classList.remove('tip-pick');
      const r = rankNumber(view.card);
      const best = bestFirstGuess(r);
      const bestOpt = best === 'hi' ? view.hi : view.lo;
      let text: string;
      let ring: HTMLElement | null = null;
      if (playing() && view.mult > 0) {
        text = `Cash out: every further guess keeps another 1% of the ${formatMoney((view.bet / 100) * view.mult)} riding.`;
        ring = main;
      } else if (EXACT_RANKS.includes(r)) {
        text = `${bestOpt.label} on a${r === 1 || r === 8 ? 'n' : ''} ${RANK_NAMES[r]} returns exactly 99.00% (${bestOpt.count} in 13 to win).`;
        ring = playing() ? (best === 'hi' ? hiBtn.root : loBtn.root) : main;
      } else {
        text = `Skip: one guess on ${EXACT_WORDS} returns 99.00%; the best guess on this ${RANK_NAMES[r]} returns ${pctText(bestReturn(r))}.`;
        ring = skip;
      }
      tipShown = true;
      ctx.kit.tip(text);
      ring?.classList.add('tip-pick');
    };
    const offTips = ctx.tips.subscribe(tipFor);

    const setCard = (c: Card) => {
      card.src = cardUrl(c);
      card.alt = c;
    };

    /** The next card comes off the deck and turns over in the card's place. */
    const flipTo = async (c: Card, tone: 'win' | 'lose' | 'plain') => {
      cardBox.classList.remove('win', 'lose', 'deal');
      card.classList.add('turn');
      ctx.sfx.play('card-flip', { volume: 0.55 });
      await wait(140);
      setCard(c);
      card.classList.remove('turn');
      void cardBox.offsetWidth;
      cardBox.classList.add('deal');
      if (tone !== 'plain') cardBox.classList.add(tone);
      await wait(260);
    };

    const redraw = (v: HiloView) => {
      view = v;
      setCard(v.card);
      trail.clear();
      for (const s of v.trail) trail.push(trailEntry(s), false);
      cardBox.classList.remove('win', 'lose', 'deal');
      if (v.phase === 'over' && v.result?.outcome === 'bust') cardBox.classList.add('lose');
    };

    const onOver = (e: GameEvent) => {
      const payout = Number(e.payout);
      const b = Number(e.bet);
      const mult = Number(e.mult);
      tally.add(b, payout);
      if (payout > 0) {
        pop.show(mult, payout, b);
        ctx.sfx.play('chips-stack', { volume: 0.6 });
        [784, 988, 1319].forEach((f, i) => siteTone(ctx.sfx, f, 140, { type: 'triangle', gain: 0.05, at: i * 70 }));
        const tier = winTier(payout, b);
        if (tier) celebrate({ stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx }, { title: `Hi-Lo ${multText(mult)}`, sub: `${Number(e.guesses)} right guesses · pays ${formatMoney(payout)} on ${formatMoney(b)}`, tier });
      }
    };

    return {
      onTable(snap) {
        cashier.table(snap);
        stack = snap.you.stack;
        busy = false;
        animating = false;
        const lim = snap.meta.config.limits.default;
        if (!bet || !limits || lim.min !== limits.min || lim.max !== limits.max || lim.step !== limits.step) {
          bet?.root.remove();
          limits = lim;
          bet = new BetBox({ label: 'Bet', min: lim.min, max: lim.max, step: lim.step, value: lim.min, onChange: () => sync() });
          screen.side.prepend(bet.root);
        }
        bet.setMax(stack);
        pop.hide();
        redraw(snap.view as HiloView);
        sync();
      },

      async onEvents(events, v) {
        const next = v as HiloView;
        animating = true;
        busy = false;
        sync();
        try {
          for (const e of events) {
            if (e.type === 'bet') {
              pop.hide();
              trail.clear();
              cardBox.classList.remove('win', 'lose');
              trail.push({ card: String(e.card), caption: 'Start', tone: 'plain' });
            } else if (e.type === 'skip') {
              await flipTo(e.card as Card, 'plain');
              trail.push({ card: String(e.card), caption: 'Skip', tone: 'plain' });
              siteTone(ctx.sfx, 520, 50, { type: 'triangle', gain: 0.03 });
            } else if (e.type === 'guess') {
              const win = e.win === true;
              await flipTo(e.card as Card, win ? 'win' : 'lose');
              trail.push(trailEntry({ card: e.card as Card, how: e.dir as Guess, win, mult: Number(e.mult) }));
              if (win) {
                siteTone(ctx.sfx, 880, 90, { type: 'triangle', gain: 0.05 });
                siteTone(ctx.sfx, 1320, 120, { type: 'triangle', gain: 0.04, at: 70 });
              } else siteTone(ctx.sfx, 240, 380, { type: 'sawtooth', gain: 0.05, to: 60 });
            } else if (e.type === 'over') {
              onOver(e);
            }
          }
        } finally {
          animating = false;
          view = next;
          setCard(next.card);
          sync();
        }
      },

      onSeat(msg) {
        cashier.seat(msg);
        stack = msg.stack;
        bet?.setMax(stack);
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
          if (!e.repeat) primary();
          return true;
        }
        const k = e.key.toLowerCase();
        if (e.key === 'ArrowUp' || k === 'h') {
          guess('hi');
          return true;
        }
        if (e.key === 'ArrowDown' || k === 'l') {
          guess('lo');
          return true;
        }
        if (k === 's') {
          if (!skip.disabled) act({ type: 'skip' });
          return true;
        }
        return false;
      },

      update() {
        const camera = ctx.stage.engine.camera;
        camera.updateMatrixWorld();
        ctx.stage.root.updateWorldMatrix(true, false);
        screen.follow(ctx.stage.root, camera, corners);
      },

      dispose() {
        offTips();
        clearTip();
        pop.hide();
        screen.dispose();
      },
    };
  },
};
