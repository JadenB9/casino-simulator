// Dice on the lounge computers (docs/rules/online-games.md §2): roll a number from 0.00 to 99.99
// over or under a target. The target, the win chance and the multiplier are one choice seen three
// ways, and the page lets you set any of them: drag the slider, or type a target, a chance or a
// multiplier, and the other two follow. A roll is one action: the server draws it and pays it,
// and the result tag slides along the slider to where it landed. Auto rolls again and again at
// the same bet and target until one of its stops.

import './dice.css';
import type { GameClientModule, TableView } from '../contract.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { GRID, MIN_CHANCE, MAX_CHANCE, RETURN_ROLLS, winCount, targetFor, winPayout, rtpOf, nearestExactChance } from '../../../../shared/src/games/dice/rules.ts';
import type { DiceView, RollEvent } from '../../../../shared/src/games/dice/engine.ts';
import { tween, ease } from '../../table/tween.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { NumberField, InfoList, BetLog, siteTone, shortTone, drawSiteBar, drawAttractPanel } from '../online/screen.ts';
import { OnlineSite } from '../online/site.ts';

/** The chair's trim on the floor: Dice's blue. */
const ACCENT = '#2f9bff';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** Hundredths as the page prints them: 49.50. */
const hund = (n: number) => (n / 100).toFixed(2);
const multOf = (chance: number) => RETURN_ROLLS / chance;
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
/** Money to the cent, always with the cents: $1.41. */
const cents = (c: Cents) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** What a roll paid as a multiplier of its bet, hundredths (2.00× on a 49.50% win). */
const paidMult = (payout: Cents, bet: Cents) => (bet > 0 ? Math.round((payout * 100) / bet) : 0);

/** The monitor on the floor: the site's bar, a bet panel, and the slider with a roll on it. */
function drawAttract(g: CanvasRenderingContext2D, w: number, h: number): void {
  const top = drawSiteBar(g, w, 'Dice');
  drawAttractPanel(g, top, h, [['Bet', '$10.00'], ['Profit on Win', '$10.00']], 'Roll');
  g.textAlign = 'center';

  // The slider: 0-100, red under the target, green over it, the handle, and a roll of 71.34.
  const x0 = 170;
  const x1 = w - 38;
  const y = top + 128;
  g.fillStyle = '#a7b4c6';
  g.font = '600 12px system-ui, sans-serif';
  for (const v of [0, 25, 50, 75, 100]) g.fillText(String(v), x0 + ((x1 - x0) * v) / 100, y - 38);
  g.fillStyle = '#213743';
  g.beginPath();
  g.roundRect(x0 - 18, y - 22, x1 - x0 + 36, 44, 22);
  g.fill();
  const at = x0 + (x1 - x0) * 0.5049;
  g.fillStyle = '#ff5a5f';
  g.beginPath();
  g.roundRect(x0, y - 4, at - x0, 8, [4, 0, 0, 4]);
  g.fill();
  g.fillStyle = '#1fd65f';
  g.beginPath();
  g.roundRect(at, y - 4, x1 - at, 8, [0, 4, 4, 0]);
  g.fill();
  g.fillStyle = '#5b7a92';
  g.beginPath();
  g.roundRect(at - 12, y - 12, 24, 24, 4);
  g.fill();
  const r = x0 + (x1 - x0) * 0.7134;
  g.fillStyle = '#eef3f8';
  g.beginPath();
  g.roundRect(r - 30, y - 68, 60, 32, 5);
  g.fill();
  g.beginPath();
  g.moveTo(r - 7, y - 36);
  g.lineTo(r + 7, y - 36);
  g.lineTo(r, y - 29);
  g.fill();
  g.fillStyle = '#10a54a';
  g.font = '700 19px system-ui, sans-serif';
  g.fillText('71.34', r, y - 52);
  // The three fields along the bottom.
  const fy = h - 58;
  const labels: [string, string][] = [['Multiplier', '2.0000×'], ['Roll Over', '50.49'], ['Win Chance', '49.50%']];
  g.textAlign = 'left';
  labels.forEach(([label, value], i) => {
    const fx = 150 + i * 118;
    g.fillStyle = '#a7b4c6';
    g.font = '600 10px system-ui, sans-serif';
    g.fillText(label, fx, fy);
    g.fillStyle = '#0f1e29';
    g.beginPath();
    g.roundRect(fx - 2, fy + 8, 108, 26, 4);
    g.fill();
    g.fillStyle = '#eef3f8';
    g.font = '600 14px system-ui, sans-serif';
    g.fillText(value, fx + 6, fy + 21);
  });
}

export const dice: GameClientModule = {
  game: 'dice',
  footprint: PC_FOOTPRINT,
  createModel: () => pcModel({ attract: attractTexture(drawAttract), accent: ACCENT }),
  seats: () => [{ position: PC_SEAT, yaw: Math.PI }],
  playPose: () => pcPose(),

  mount(ctx): TableView {
    /** The target in hundredths, and the side: Roll Over wins above it, Roll Under below it. */
    let target = 4950;
    let over = false;
    let stack: Cents = 0;
    let busy = false;
    /** Results still playing out: the chips on the page wait for them. */
    let playing = 0;
    let sentAt = 0;
    /** Where the result tag stands, as a percentage along the track. */
    let markerAt = 50;
    const chance = () => winCount(target, over);

    const site = new OnlineSite(ctx, {
      game: 'dice',
      title: 'Dice',
      action: 'Roll',
      primary: () => roll(),
      sync: () => sync(),
      onBet: () => render(),
      // Auto rolls once the last roll's tag has landed and a beat has passed.
      auto: {
        gapMs: 260,
        play: () => {
          const bet = site.bet;
          if (!bet || busy || playing > 0) return false;
          if (bet.value > stack) return 'not enough chips here for the next roll';
          send(bet.value);
          return true;
        },
      },
    });
    const screen = site.screen;

    // The board: the slider and the three fields (the recent rolls are the site's top row).
    const main = el('div', 'dc-main');
    const stage = el('div', 'dc-stage');
    const scale = el('div', 'dc-scale');
    for (const v of [0, 25, 50, 75, 100]) {
      const s = el('span', '', String(v));
      s.style.left = `${v}%`;
      scale.append(s);
    }
    const card = el('div', 'dc-card');
    const track = el('div', 'dc-track');
    track.setAttribute('role', 'slider');
    track.setAttribute('aria-label', 'Win chance');
    track.tabIndex = 0;
    const winZone = el('div', 'dc-win');
    const handle = el('div', 'dc-handle');
    // The result tag rides a rail as wide as the track, moved by transform (no layout per frame).
    const rail = el('div', 'dc-rail');
    const marker = el('div', 'dc-marker');
    marker.hidden = true;
    rail.append(marker);
    track.append(winZone, handle, rail);
    card.append(track);
    const zone = el('div', 'dc-zone');
    stage.append(card, scale, zone);

    const multField = new NumberField({
      label: 'Multiplier',
      suffix: '×',
      value: multOf(chance()),
      format: (v) => v.toFixed(4),
      onCommit: (m) => setChance(m > 0 ? Math.round(RETURN_ROLLS / m) : MAX_CHANCE),
    });
    const targetField = new NumberField({
      label: 'Roll Under',
      value: target,
      format: hund,
      onCommit: (t) => setTarget(Math.round(t * 100)),
    });
    targetField.addButton('⇄', 'Swap roll over and roll under (X)', () => swap()).setAttribute('aria-keyshortcuts', 'X');
    const chanceField = new NumberField({
      label: 'Win Chance',
      suffix: '%',
      value: chance(),
      format: hund,
      onCommit: (p) => setChance(Math.round(p * 100)),
    });
    const fields = el('div', 'dc-fields');
    fields.append(multField.root, targetField.root, chanceField.root);
    main.append(stage, fields);
    screen.main.append(main);

    // The bet panel: the facts and the last rolls (the profit on a win is the bet's own line).
    const info = new InfoList('This bet');
    const log = new BetLog('Last rolls', ['Target', 'Roll', 'Payout'], 4);
    site.facts.append(info.root, log.root);

    const setTarget = (t: number) => {
      if (site.locked) return;
      target = over ? clamp(t, GRID - 1 - MAX_CHANCE, GRID - 1 - MIN_CHANCE) : clamp(t, MIN_CHANCE, MAX_CHANCE);
      render();
    };
    const setChance = (c: number) => {
      if (site.locked) return;
      target = targetFor(clamp(c, MIN_CHANCE, MAX_CHANCE), over);
      render();
    };
    const swap = () => {
      if (site.locked) return;
      const c = chance();
      over = !over;
      target = targetFor(c, over);
      siteTone(ctx.sfx, 740, 40, { type: 'triangle', gain: 0.03 });
      render();
    };

    const render = () => {
      const c = chance();
      const at = target / 100;
      handle.style.left = `${at}%`;
      winZone.className = `dc-win ${over ? 'right' : 'left'}`;
      winZone.style.width = over ? `${100 - at}%` : `${at}%`;
      track.setAttribute('aria-valuenow', hund(c));
      track.setAttribute('aria-valuetext', `${hund(c)}% to win, ${over ? 'over' : 'under'} ${hund(target)}`);
      zone.replaceChildren(
        'Wins on ',
        el('b', '', over ? `${hund(target + 1)} to 99.99` : `0.00 to ${hund(target - 1)}`),
        ` · ${c.toLocaleString('en-US')} of ${GRID.toLocaleString('en-US')} rolls`,
      );
      multField.set(multOf(c));
      targetField.set(target);
      targetField.setLabel(over ? 'Roll Over' : 'Roll Under');
      chanceField.set(c);
      const b = site.bet?.value ?? site.limits?.min ?? 100;
      const pays = winPayout(b, c);
      const rtp = rtpOf(b, c);
      site.profit('Profit on win', pays - b, `${(pays / b).toFixed(4)}× · ${hund(c)}%`);
      info.set('pays', 'A win pays', cents(pays));
      info.set('rtp', 'Return at this bet', pct(rtp));
      const lim = site.limits;
      const range = lim ? ` · Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}` : '';
      screen.setNote(`Return ${pct(rtp)}${rtp < 0.99 ? ' (99% before cents are rounded down)' : ''}${range} · Space rolls · X swaps over and under`);
      sync();
      tipFor();
    };

    // Tips: every chance returns 99% before the payout is floored to the cent. When the floor
    // costs something at this bet, say what, and name the nearest chance that pays exactly 99%.
    const tipFor = () => {
      chanceField.root.classList.remove('tip-pick');
      const bet = site.bet;
      if (!ctx.tips.on || !bet) return site.tip(null);
      const b = bet.value;
      const c = chance();
      if ((b * RETURN_ROLLS) % c === 0) {
        site.tip(`${hund(c)}% returns exactly 99% at ${formatMoney(b)}: a win pays ${cents(winPayout(b, c))}, no cents lost.`);
        return;
      }
      const best = nearestExactChance(b, c);
      site.tip(`${formatMoney(b)} at ${hund(c)}% pays ${cents(winPayout(b, c))} (${pct(rtpOf(b, c))}, cents rounded down). ${hund(best)}% pays exactly 99%.`);
      chanceField.root.classList.add('tip-pick');
    };
    const offTips = ctx.tips.subscribe(tipFor);

    // The slider: press anywhere on it and drag. The win chance snaps to half a percent, on
    // either side, so a drag lands on round chances and clean multipliers (25% is 3.9600×).
    const fromPointer = (e: PointerEvent) => {
      const r = track.getBoundingClientRect();
      const f = clamp((e.clientX - r.left) / r.width, 0, 1);
      setChance(Math.round((over ? 1 - f : f) * 200) * 50);
    };
    track.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || site.locked) return;
      e.preventDefault();
      track.focus({ preventScroll: true });
      track.setPointerCapture(e.pointerId);
      track.classList.add('dragging');
      fromPointer(e);
    });
    track.addEventListener('pointermove', (e) => {
      if (track.hasPointerCapture(e.pointerId)) fromPointer(e);
    });
    const release = (e: PointerEvent) => {
      if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
      track.classList.remove('dragging');
    };
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);
    // the slider from the keyboard once it has focus: a point at a time, ten with Shift
    track.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      e.stopPropagation();
      setChance(chance() + step * (e.shiftKey ? 1000 : 100) * (over ? -1 : 1));
    });

    // The button only greys out for a bet the chips can't cover; a press while a roll is on
    // its way to the server is ignored, and the next roll's slide queues behind this one's.
    const sync = () => {
      const bet = site.bet;
      bet?.setMax(stack);
      const locked = site.locked;
      bet?.setEnabled(!locked);
      for (const f of [multField, targetField, chanceField]) f.setEnabled(!locked);
      track.classList.toggle('locked', locked);
      site.auto?.setEnabled(true);
      site.paintMain('Roll', 'go', !bet || bet.value > stack);
    };

    const send = (amount: Cents) => {
      busy = true;
      sentAt = performance.now();
      ctx.link.act({ type: 'roll', bet: amount, target, over });
    };

    const roll = () => {
      const bet = site.bet;
      if (!bet || busy) return;
      if (bet.value > stack) {
        shortTone(ctx.sfx);
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      send(bet.value);
      sync();
    };

    const showMarker = (roll: number, win: boolean | null) => {
      markerAt = roll / 100;
      marker.hidden = false;
      marker.textContent = hund(roll);
      rail.style.setProperty('--dc-at', String(markerAt / 100));
      marker.className = `dc-marker${win === null ? '' : win ? ' win' : ' lose'}`;
    };

    const playRoll = async (ev: RollEvent) => {
      site.auto?.driver.answered();
      screen.setStack(ev.stack - ev.payout);
      const from = markerAt;
      const to = ev.roll / 100;
      marker.hidden = false;
      marker.className = 'dc-marker sliding';
      marker.textContent = hund(ev.roll);
      let lastTick = -1;
      await tween(
        380,
        (k) => {
          markerAt = from + (to - from) * k;
          rail.style.setProperty('--dc-at', String(markerAt / 100));
          const t = Math.floor(k * 9);
          if (t !== lastTick && k < 1) {
            lastTick = t;
            siteTone(ctx.sfx, 900 + t * 70, 14, { type: 'triangle', gain: 0.02 });
          }
        },
        ease.out,
      );
      showMarker(ev.roll, ev.win);
      log.push([`${ev.over ? '>' : '<'} ${hund(ev.target)}`, hund(ev.roll), ev.win ? cents(ev.payout) : cents(0)], ev.win);
      screen.setStack(ev.stack);
      site.settle({
        bet: ev.bet,
        payout: ev.payout,
        mult: paidMult(ev.payout, ev.bet),
        pill: hund(ev.roll),
        moment: { title: `Dice ${(ev.payout / ev.bet).toFixed(2)}×`, sub: `Rolled ${hund(ev.roll)} ${ev.over ? 'over' : 'under'} ${hund(ev.target)} · pays ${cents(ev.payout)}` },
      });
    };

    render();

    return {
      onTable(snap) {
        stack = snap.you.stack;
        busy = false;
        site.table(snap);
        screen.setStack(stack);
        const v = snap.view as DiceView;
        site.history.clear();
        log.clear();
        for (const r of v.recent.slice(0, 9).reverse()) site.history.push(hund(r.roll), r.win, false);
        for (const r of v.recent.slice(0, 4).reverse()) log.push([`${r.over ? '>' : '<'} ${hund(r.target)}`, hund(r.roll), cents(r.payout)], r.win, false);
        const last = v.recent[0];
        if (last) {
          over = last.over;
          target = last.target;
          showMarker(last.roll, last.win);
          site.result.show(last.bet, last.payout, paidMult(last.payout, last.bet), false);
        }
        render();
      },

      async onEvents(events) {
        // The server has answered: the next press can go while this roll slides.
        busy = false;
        playing++;
        try {
          for (const e of events) if (e.type === 'roll') await playRoll(e as unknown as RollEvent);
        } finally {
          playing--;
          sync();
        }
      },

      onConnection(open) {
        site.connection(open);
      },

      onSeat(msg) {
        site.seat(msg);
        stack = msg.stack;
        if (playing === 0) screen.setStack(stack);
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
        if (e.code === 'KeyX' && !e.repeat) {
          swap();
          return true;
        }
        return false;
      },

      update(dt) {
        // A roll the server never answered (the socket dropped it) frees the button again.
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
