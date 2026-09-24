// Dice on the lounge computers (docs/rules/online-games.md §2): roll a number from 0.00 to 99.99
// over or under a target. The target, the win chance and the multiplier are one choice seen three
// ways, and the page lets you set any of them: drag the slider, or type a target, a chance or a
// multiplier, and the other two follow. A roll is one action: the server draws it and pays it,
// and the result tag slides along the slider to where it landed.

import './dice.css';
import type { GameClientModule, TableView } from '../contract.ts';
import { formatMoney, type BetLimits, type Cents } from '../../../../shared/src/money.ts';
import { GRID, MIN_CHANCE, MAX_CHANCE, RETURN_ROLLS, winCount, targetFor, winPayout, rtpOf, nearestExactChance } from '../../../../shared/src/games/dice/rules.ts';
import type { DiceView, RollEvent } from '../../../../shared/src/games/dice/engine.ts';
import { tween, ease } from '../../table/tween.ts';
import { celebrate } from '../../table/celebrate.ts';
import { el } from '../../ui/kit.ts';
import { attractTexture, pcModel, pcPose, pcScreenCorners, PC_FOOTPRINT, PC_SEAT } from '../online/pc.ts';
import { OnlineScreen, BetBox, actionButton, NumberField, InfoList, ResultStrip, SessionTally, BetLog, commitTyping, winTier, siteTone, drawSiteBar, drawAttractPanel } from '../online/screen.ts';

/** The chair's trim on the floor: Dice's blue. */
const ACCENT = '#2f9bff';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** Hundredths as the page prints them: 49.50. */
const hund = (n: number) => (n / 100).toFixed(2);
const multOf = (chance: number) => RETURN_ROLLS / chance;
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
/** Money to the cent, always with the cents: $1.41. */
const cents = (c: Cents) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
    const screen = new OnlineScreen('Dice');
    ctx.ui.append(screen.root);
    const corners = pcScreenCorners();

    /** The target in hundredths, and the side: Roll Over wins above it, Roll Under below it. */
    let target = 4950;
    let over = false;
    let stack: Cents = 0;
    let limits: BetLimits | null = null;
    let bet: BetBox | null = null;
    let busy = false;
    /** Results still playing out: the chips on the page wait for them. */
    let playing = 0;
    let sentAt = 0;
    let tipShown = false;
    /** Where the result tag stands, as a percentage along the track. */
    let markerAt = 50;
    const chance = () => winCount(target, over);

    // The board: recent rolls, the slider, the three fields.
    const main = el('div', 'dc-main');
    const stripWrap = el('div', 'dc-strip');
    const strip = new ResultStrip(9);
    stripWrap.append(strip.root);
    const stage = el('div', 'dc-stage');
    const scale = el('div', 'dc-scale');
    for (const v of [0, 25, 50, 75, 100]) {
      const s = el('span', '', String(v));
      s.style.left = `${v}%`;
      scale.append(s);
    }
    const card = el('div', 'dc-card');
    const track = el('div', 'dc-track');
    const winZone = el('div', 'dc-win');
    const handle = el('div', 'dc-handle');
    const marker = el('div', 'dc-marker');
    marker.hidden = true;
    track.append(winZone, handle, marker);
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
    targetField.addButton('⇄', 'Swap roll over and roll under', () => swap());
    const chanceField = new NumberField({
      label: 'Win Chance',
      suffix: '%',
      value: chance(),
      format: hund,
      onCommit: (p) => setChance(Math.round(p * 100)),
    });
    const fields = el('div', 'dc-fields');
    fields.append(multField.root, targetField.root, chanceField.root);
    main.append(stripWrap, stage, fields);
    screen.main.append(main);

    // The bet panel.
    const profit = new NumberField({ label: 'Profit on Win', value: 0, format: cents });
    const rollBtn = actionButton('Roll', () => roll());
    rollBtn.title = 'Roll (Space)';
    rollBtn.classList.add('os-fixed');
    const info = new InfoList('This bet');
    const log = new BetLog('Last rolls', ['Target', 'Roll', 'Payout'], 4);
    const tally = new SessionTally();
    screen.side.append(profit.root, rollBtn, info.root, log.root, tally.root);

    const setTarget = (t: number) => {
      target = over ? clamp(t, GRID - 1 - MAX_CHANCE, GRID - 1 - MIN_CHANCE) : clamp(t, MIN_CHANCE, MAX_CHANCE);
      render();
    };
    const setChance = (c: number) => {
      target = targetFor(clamp(c, MIN_CHANCE, MAX_CHANCE), over);
      render();
    };
    const swap = () => {
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
      zone.replaceChildren(
        'Wins on ',
        el('b', '', over ? `${hund(target + 1)} to 99.99` : `0.00 to ${hund(target - 1)}`),
        ` · ${c.toLocaleString('en-US')} of ${GRID.toLocaleString('en-US')} rolls`,
      );
      multField.set(multOf(c));
      targetField.set(target);
      targetField.setLabel(over ? 'Roll Over' : 'Roll Under');
      chanceField.set(c);
      const b = bet?.value ?? limits?.min ?? 100;
      const pays = winPayout(b, c);
      const rtp = rtpOf(b, c);
      profit.set(pays - b);
      info.set('pays', 'A win pays', cents(pays));
      info.set('mult', 'Paid multiplier', `${(pays / b).toFixed(4)}×`);
      info.set('rtp', 'Return at this bet', pct(rtp));
      const range = limits ? ` · Bet ${formatMoney(limits.min)} to ${formatMoney(limits.max)}` : '';
      screen.setNote(`Return ${pct(rtp)}${rtp < 0.99 ? ' (99% before cents are rounded down)' : ''}${range} · Space rolls`);
      tipFor();
    };

    // Tips: every chance returns 99% before the payout is floored to the cent. When the floor
    // costs something at this bet, say what, and name the nearest chance that pays exactly 99%.
    const tipFor = () => {
      chanceField.root.classList.remove('tip-pick');
      if (!ctx.tips.on || !bet) {
        if (tipShown) {
          tipShown = false;
          ctx.kit.tip(null);
        }
        return;
      }
      tipShown = true;
      const b = bet.value;
      const c = chance();
      if ((b * RETURN_ROLLS) % c === 0) {
        ctx.kit.tip(`${hund(c)}% returns exactly 99% at ${formatMoney(b)}: a win pays ${cents(winPayout(b, c))}, no cents lost.`);
        return;
      }
      const best = nearestExactChance(b, c);
      ctx.kit.tip(`${formatMoney(b)} at ${hund(c)}% pays ${cents(winPayout(b, c))} (${pct(rtpOf(b, c))}, cents rounded down). ${hund(best)}% pays exactly 99%.`);
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
      if (e.button !== 0) return;
      e.preventDefault();
      commitTyping(screen.root);
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

    // The button only greys out for a bet the chips can't cover; a press while a roll is on
    // its way to the server is ignored, and the next roll's slide queues behind this one's.
    const sync = () => {
      bet?.setMax(stack);
      rollBtn.disabled = !bet || bet.value > stack;
    };

    const roll = () => {
      if (!bet || busy) return;
      commitTyping(screen.root);
      if (bet.value > stack) {
        siteTone(ctx.sfx, 150, 120, { type: 'sawtooth', gain: 0.03 });
        ctx.kit.toast('Not enough chips here for that bet.', 'err');
        return;
      }
      busy = true;
      sentAt = performance.now();
      ctx.link.act({ type: 'roll', bet: bet.value, target, over });
      sync();
    };

    const showMarker = (roll: number, win: boolean | null) => {
      markerAt = roll / 100;
      marker.hidden = false;
      marker.textContent = hund(roll);
      marker.style.left = `${markerAt}%`;
      marker.className = `dc-marker${win === null ? '' : win ? ' win' : ' lose'}`;
    };

    const playRoll = async (ev: RollEvent) => {
      screen.setStack(ev.stack - ev.payout);
      const from = markerAt;
      const to = ev.roll / 100;
      marker.hidden = false;
      marker.className = 'dc-marker';
      marker.textContent = hund(ev.roll);
      let lastTick = -1;
      await tween(
        380,
        (k) => {
          markerAt = from + (to - from) * k;
          marker.style.left = `${markerAt}%`;
          const t = Math.floor(k * 9);
          if (t !== lastTick && k < 1) {
            lastTick = t;
            siteTone(ctx.sfx, 900 + t * 70, 14, { type: 'triangle', gain: 0.02 });
          }
        },
        ease.out,
      );
      showMarker(ev.roll, ev.win);
      strip.push(hund(ev.roll), ev.win);
      log.push([`${ev.over ? '>' : '<'} ${hund(ev.target)}`, hund(ev.roll), ev.win ? cents(ev.payout) : cents(0)], ev.win);
      tally.add(ev.bet, ev.payout);
      screen.setStack(ev.stack);
      if (ev.win) {
        siteTone(ctx.sfx, 784, 90, { type: 'triangle', gain: 0.05 });
        siteTone(ctx.sfx, 1175, 130, { type: 'triangle', gain: 0.05, at: 70 });
      } else siteTone(ctx.sfx, 220, 120, { gain: 0.045, to: 170 });
      const tier = winTier(ev.payout, ev.bet);
      if (tier) {
        celebrate(
          { stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx },
          { title: `Dice ${(ev.payout / ev.bet).toFixed(2)}×`, sub: `Rolled ${hund(ev.roll)} ${ev.over ? 'over' : 'under'} ${hund(ev.target)} · pays ${cents(ev.payout)}`, tier },
        );
      }
    };

    render();
    sync();

    return {
      onTable(snap) {
        stack = snap.you.stack;
        busy = false;
        screen.setStack(stack);
        const lim = snap.meta.config.limits.default;
        if (!bet || !limits || lim.min !== limits.min || lim.max !== limits.max || lim.step !== limits.step) {
          bet?.root.remove();
          limits = lim;
          // onChange must not call setMax (sync): below the table minimum the box would clamp,
          // change and call back forever.
          bet = new BetBox({ label: 'Bet', min: lim.min, max: lim.max, step: lim.step, value: lim.min, onChange: () => {
            if (!bet) return;
            render();
            rollBtn.disabled = bet.value > stack;
          } });
          screen.side.prepend(bet.root);
        }
        const v = snap.view as DiceView;
        strip.clear();
        log.clear();
        for (const r of v.recent.slice(0, 9).reverse()) strip.push(hund(r.roll), r.win, false);
        for (const r of v.recent.slice(0, 4).reverse()) log.push([`${r.over ? '>' : '<'} ${hund(r.target)}`, hund(r.roll), cents(r.payout)], r.win, false);
        const last = v.recent[0];
        if (last) {
          over = last.over;
          target = last.target;
          showMarker(last.roll, last.win);
        }
        render();
        sync();
      },

      async onEvents(events) {
        // The server has answered: the next press can go while this roll slides.
        busy = false;
        playing++;
        try {
          for (const e of events) if (e.type === 'roll') await playRoll(e as unknown as RollEvent);
        } finally {
          playing--;
        }
      },

      onSeat(msg) {
        stack = msg.stack;
        if (playing === 0) screen.setStack(stack);
        sync();
      },

      onError() {
        busy = false;
        sync();
      },

      keydown(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        if (e.code === 'Space') {
          if (!e.repeat) roll();
          return true;
        }
        return false;
      },

      update() {
        // A roll the server never answered (the socket dropped it) frees the button again.
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
