// A slot machine at play. The server has settled every spin before a reel moves; this view spins
// the reels to the stops it sent, left to right, then presents what the spin paid by the rules in
// FEATURES.md §2: nothing for nothing, a quiet "Paid $X" when the return is no more than the bet,
// a line highlight, short jingle and rollup for a real win; from 10 bets a big win (50 bets a
// huge one) with the table's celebration banner, a count-up meter and the cabinet lights chasing
// (bells and the candle too on the steppers), and a hand pay for the top award or $2,000 and up.
// Neon Nights' free games get their own moment when they start. No autoplay, no turbo, no
// near-miss anything.

import * as THREE from 'three';
import type { TableView, TableViewCtx } from '../contract.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { MACHINES, isMachineId, type Machine, type MachineId } from '../../../../shared/src/games/slots/machines.ts';
import { neonSymbolAt } from '../../../../shared/src/games/slots/rules.ts';
import type { ReelsEvent, ResultEvent, SlotsEvent, SlotsView, SpinEvent } from '../../../../shared/src/games/slots/protocol.ts';
import { el, button } from '../../ui/kit.ts';
import { session } from '../../app/session.ts';
import { tween, wait, ease } from '../../table/tween.ts';
import { ReelSet, reelMaterial, type SpinTiming } from './reels.ts';
import { buildCabinet, bulbMaterial, buttonAtUv, candleColor, payGlassPlacement, type CabinetHandle } from './cabinet.ts';
import { lineColor, paintMeters, paintOverlay, COIN_COLUMNS, type MeterValues } from './glass.ts';
import { MachineSound } from './sound.ts';
import { openPays } from './pays.ts';
import { winTier, slotsTip, timesBet, neonHand } from './moments.ts';
import { celebrate } from '../../table/celebrate.ts';

/** IRS W-2G slot threshold from 2026: an attendant pays this by hand. */
const HAND_PAY: Cents = 200_000;
/** Bulb modes (cabinet.ts): idle chase, alternate flash, slow pulse, fast win chase. */
const IDLE = 0;
const FLASH = 1;
const CHASE = 3;

function findCabinet(ctx: TableViewCtx, machine: MachineId): { handle: CabinetHandle; owned: boolean } {
  for (const child of ctx.stage.anchor.children) {
    const h = child.userData.slots as CabinetHandle | undefined;
    if (h && h.machine === machine) return { handle: h, owned: false };
  }
  // the floor didn't build one (or built something else): bring our own
  const root = buildCabinet(machine, ctx.stage.engine.quality);
  ctx.stage.root.add(root);
  return { handle: root.userData.slots as CabinetHandle, owned: true };
}

function timing(machine: Machine, i: number): SpinTiming {
  const video = machine.kind === 'video';
  // UKGC-style pacing: the whole cycle takes about 2.5 s, reels land 300-350 ms apart
  const first = video ? 1.15 : 1.45;
  const gap = video ? 0.3 : 0.35;
  return {
    delay: i * 0.05,
    land: first + i * gap,
    speed: video ? 26 : 34,
    kick: 0.09,
    accel: 0.2,
    decel: 0.34,
    bounce: video ? 0.16 : 0.12,
    bounceAmp: video ? 0.12 : 0.1,
  };
}

export function mountSlots(ctx: TableViewCtx): TableView {
  const machineId: MachineId = isMachineId(ctx.variant) ? ctx.variant : 'sevens';
  const m = MACHINES[machineId];
  const video = m.kind === 'video';
  const { handle, owned } = findCabinet(ctx, machineId);
  const l = handle.layout;
  const sound = new MachineSound(ctx.sfx, video ? 'video' : 'stepper');
  let disposed = false;

  // --- this view's own copies of the parts it animates (the floor's shared ones come back on dispose)
  const reelMats = handle.reels.map((_, i) => reelMaterial(handle.sharp[i]!, handle.blurred[i]!, handle.stops, l.reels.look.curve, video ? '#ffffff' : '#fff4e2'));
  const reels = new ReelSet(handle.reels, reelMats, handle.stops, video ? 1 : 0);

  const meterCanvas = document.createElement('canvas');
  const meterTex = new THREE.CanvasTexture(meterCanvas);
  meterTex.colorSpace = THREE.SRGBColorSpace;
  const meterMat = new THREE.MeshBasicMaterial({ map: meterTex, toneMapped: false });
  const sharedMeterMat = handle.meters.material;
  handle.meters.material = meterMat;

  let overlayCanvas: HTMLCanvasElement | null = null;
  let overlayTex: THREE.CanvasTexture | null = null;
  let overlayMat: THREE.MeshBasicMaterial | null = null;
  const sharedOverlayMat = handle.overlay?.material ?? null;
  if (handle.overlay) {
    overlayCanvas = document.createElement('canvas');
    paintOverlay(overlayCanvas, null, handle.scale);
    overlayTex = new THREE.CanvasTexture(overlayCanvas);
    overlayTex.colorSpace = THREE.SRGBColorSpace;
    overlayMat = new THREE.MeshBasicMaterial({ map: overlayTex, transparent: true, depthWrite: false, toneMapped: false });
    handle.overlay.material = overlayMat;
  }
  const paylineMat = new THREE.MeshBasicMaterial({ color: '#ff3326', toneMapped: false });
  const sharedPayline = handle.payline?.material ?? null;
  if (handle.payline) handle.payline.material = paylineMat;

  const bulbMode = { value: 0 };
  const bulbMat = bulbMaterial(handle.clock, bulbMode);
  const sharedBulbs = handle.bulbs.material;
  handle.bulbs.material = bulbMat;

  const tintMat = new THREE.MeshBasicMaterial({ color: candleColor(m.denoms[0]!), toneMapped: false });
  const whiteMat = new THREE.MeshBasicMaterial({ color: '#fff8ec', toneMapped: false });
  const sharedTint = handle.candleTint.material;
  const sharedWhite = handle.candleWhite.material;
  handle.candleTint.material = tintMat;
  handle.candleWhite.material = whiteMat;

  // the lit column on the pay glass for the coins bet (3-reel machines)
  let column: THREE.Mesh | null = null;
  if (!video) {
    const pg = payGlassPlacement(l);
    const colW = (124 / 1024) * pg.w;
    column = new THREE.Mesh(
      new THREE.PlaneGeometry(colW, pg.h * 0.8),
      new THREE.MeshBasicMaterial({ color: '#ffe9b0', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    column.matrixAutoUpdate = false;
    column.userData.columns = pg.columns;
    column.userData.base = pg.matrix;
    handle.root.parent === ctx.stage.anchor || owned ? ctx.stage.root.add(column) : ctx.stage.root.add(column);
  }

  // --- bet state
  let denomIdx = 0;
  let coins = 1;
  const betOf = () => m.lines * coins * m.denoms[denomIdx]!;
  let stack: Cents = 0;
  let status = 'watching';
  let busy = false;
  let pressed = false;
  let meters: MeterValues = { credit: 0, bet: betOf(), win: null };
  let lastWin: Cents | null = null;

  // --- DOM: the button deck, a result tag at the win meter, banners
  const deck = el('div', 'slots-deck panel');
  const paysBtn = button('Pays', () => togglePays(), { key: 'I', cls: 'ghost' });
  const coinBtn = button('', () => nextCoin(), { key: 'C', title: 'Coin value' });
  coinBtn.classList.add('slots-coin');
  const downBtn = button('−', () => setCoins(coins - 1), { key: '↓', title: video ? 'Fewer credits per line' : 'One coin less' });
  const betLabel = el('div', 'slots-bet');
  const upBtn = button('+', () => setCoins(coins + 1), { key: '↑', title: video ? 'More credits per line' : 'One coin more' });
  const maxBtn = button('Max bet', () => setCoins(m.maxCoins));
  const insertBtn = button('Insert', () => void insert(), { cls: 'ghost', title: 'Add money to this machine' });
  const spinBtn = button('Spin', () => spin(), { cls: 'primary', key: 'Space' });
  const sep = () => el('div', 'sep');
  deck.append(insertBtn, paysBtn, sep(), coinBtn, downBtn, betLabel, upBtn, maxBtn, sep(), spinBtn);
  ctx.ui.append(deck);

  const banner = el('div', 'slots-banner');
  banner.hidden = true;
  const bannerTier = el('div', 'tier');
  const bannerAmount = el('div', 'amount');
  banner.append(bannerTier, bannerAmount);
  ctx.ui.append(banner);

  // the count-up meter under the celebration banner: the win climbing, and how many bets it is
  const countup = el('div', `slots-countup ${video ? 'video' : 'stepper'}`);
  countup.hidden = true;
  const countLabel = el('div', 'label', 'Win');
  const countAmount = el('div', 'amount');
  const countTimes = el('div', 'times');
  countup.append(countLabel, countAmount, countTimes);
  ctx.ui.append(countup);
  const showCount = (label: string, win: Cents, bet: Cents) => {
    countLabel.textContent = label;
    countAmount.textContent = formatMoney(win);
    countTimes.textContent = win >= bet ? timesBet(win, bet) : '';
    countup.hidden = false;
  };

  // Tips: the one honest line, for as long as the player wants tips
  const refreshTip = () => ctx.kit.tip(ctx.tips.on ? slotsTip(m) : null);
  const unTips = ctx.tips.subscribe(refreshTip);
  refreshTip();

  const winAt = new THREE.Vector3(((840 / 1024) - 0.5) * l.meters.w, l.meters.cy + l.meters.h / 2 + 0.028, l.plate.zBack + l.plate.depth + 0.02);
  let resultTag: { obj: THREE.Object3D; el: HTMLElement } | null = null;
  const tagAt = new THREE.Vector3(0, l.window.cy + l.window.h / 2 + 0.03, l.plate.zBack + l.plate.depth + 0.02);
  let featureTag: { obj: THREE.Object3D; el: HTMLElement } | null = null;

  const clearResult = () => {
    if (resultTag) {
      resultTag.obj.removeFromParent();
      resultTag.el.remove();
      resultTag = null;
    }
  };
  const showResult = (text: string, kind: 'win' | 'push') => {
    clearResult();
    const e = el('div', `pill ${kind} slots-result`, text);
    resultTag = { obj: ctx.stage.label(e, winAt), el: e };
  };
  const setFeatureTag = (text: string | null) => {
    if (!text) {
      featureTag?.obj.removeFromParent();
      featureTag?.el.remove();
      featureTag = null;
      return;
    }
    if (!featureTag) {
      const e = el('div', 'slots-tag');
      featureTag = { obj: ctx.stage.label(e, tagAt), el: e };
    }
    featureTag.el.textContent = text;
  };

  // --- meters
  const drawMeters = () => {
    paintMeters(meterCanvas, machineId, meters, handle.scale);
    meterTex.needsUpdate = true;
  };
  const setMeters = (v: Partial<MeterValues>) => {
    meters = { ...meters, ...v };
    drawMeters();
  };

  const coinText = () => formatMoney(m.denoms[denomIdx]!);
  const refreshBet = () => {
    coinBtn.firstChild!.textContent = `Coin ${coinText()}`;
    betLabel.textContent = video ? `${coins} per line · ${formatMoney(betOf())}` : `${coins} coin${coins > 1 ? 's' : ''} · ${formatMoney(betOf())}`;
    tintMat.color.set(candleColor(m.denoms[denomIdx]!));
    if (column) {
      const cols = column.userData.columns as number[];
      column.matrix.copy(column.userData.base as THREE.Matrix4).multiply(new THREE.Matrix4().makeTranslation(cols[coins - 1] ?? 0, -0.01, 0.001));
    }
    if (!busy) setMeters({ bet: betOf() });
    refreshButtons();
  };
  const refreshButtons = () => {
    const idle = !busy && !pressed;
    const seated = status === 'seated';
    spinBtn.disabled = !idle || !seated || stack < betOf();
    downBtn.disabled = !idle || coins <= 1;
    upBtn.disabled = !idle || coins >= m.maxCoins;
    maxBtn.disabled = !idle || coins >= m.maxCoins;
    coinBtn.disabled = !idle;
    insertBtn.disabled = busy;
    insertBtn.classList.toggle('attn', seated && idle && stack < m.lines * m.denoms[0]!);
  };
  void COIN_COLUMNS;

  const setCoins = (n: number) => {
    if (busy || pressed) return;
    const c = Math.max(1, Math.min(m.maxCoins, n));
    if (c !== coins) ctx.sfx.play('ui-click', { volume: 0.5 });
    coins = c;
    refreshBet();
  };
  const nextCoin = () => {
    if (busy || pressed) return;
    denomIdx = (denomIdx + 1) % m.denoms.length;
    ctx.sfx.play('ui-switch', { volume: 0.5 });
    refreshBet();
  };

  const spin = () => {
    if (busy || pressed || disposed) return;
    if (status !== 'seated') {
      void insert();
      return;
    }
    if (stack < betOf()) {
      ctx.kit.say(stack < m.lines * m.denoms[0]! ? 'Insert money to play' : 'Lower the bet or insert more money');
      return;
    }
    pressed = true;
    refreshButtons();
    sound.press();
    ctx.link.act({ type: 'spin', coins, denom: m.denoms[denomIdx]! });
  };

  const insert = async () => {
    const p = session.profile;
    if (!p) return;
    const max = Math.max(0, 10_000_00 - stack);
    const amount = await ctx.kit.askBuyIn({ min: 20_00, max, balance: p.balance, verb: 'Insert' });
    if (!amount) return;
    if (status === 'seated') ctx.link.topUp(amount);
    else ctx.link.buyIn(amount);
  };

  // --- pays screen
  let pays: { close: () => void } | null = null;
  const togglePays = () => {
    if (pays) {
      pays.close();
      pays = null;
      return;
    }
    pays = openPays(ctx.ui, machineId, () => (pays = null));
  };

  // --- 3D deck buttons
  const onPointer = (e: PointerEvent) => {
    if (e.target !== ctx.stage.engine.renderer.domElement) return;
    if (skip) {
      skip();
      return;
    }
    const hit = ctx.stage.pickObjects(e, [handle.printed]);
    const b = buttonAtUv(hit?.uv);
    if (b === 'spin') spin();
    else if (b === 'maxBet') setCoins(m.maxCoins);
    else if (b === 'betOne') setCoins(coins >= m.maxCoins ? 1 : coins + 1);
    else if (b === 'pays') togglePays();
  };
  addEventListener('pointerdown', onPointer);

  // --- presentation state driven from update()
  let lineCycle: { lines: { line: number; count: number; win: Cents; symbol: string }[]; scatters: [number, number][]; t: number; i: number } | null = null;
  let hitReels: boolean[] = [];
  let paylineGlow = 0;
  let candleFlash: 0 | 1 | 2 = 0;
  let flashT = 0;
  let skip: (() => void) | null = null;

  const drawOverlay = (show: { line: number; count: number }[] | null, scatters: [number, number][] = []) => {
    if (!overlayCanvas || !overlayTex) return;
    paintOverlay(overlayCanvas, show, handle.scale, scatters);
    overlayTex.needsUpdate = true;
  };

  const clearWinShow = () => {
    lineCycle = null;
    hitReels = [];
    paylineGlow = 0;
    handle.reels.forEach((_, i) => reels.bright(i, 1));
    drawOverlay(null);
    lineTag(null);
  };

  let lineTagEl: { obj: THREE.Object3D; el: HTMLElement } | null = null;
  const lineTag = (text: string | null, color?: string) => {
    if (!text) {
      lineTagEl?.obj.removeFromParent();
      lineTagEl?.el.remove();
      lineTagEl = null;
      return;
    }
    if (!lineTagEl) {
      const e = el('div', 'slots-line');
      lineTagEl = { obj: ctx.stage.label(e, new THREE.Vector3(0, l.window.cy - l.window.h / 2 - 0.016, l.plate.zBack + l.plate.depth + 0.01)), el: e };
    }
    lineTagEl.el.textContent = text;
    if (color) lineTagEl.el.style.borderColor = color;
  };

  const scatterCells = (stops: readonly number[]): [number, number][] => {
    const cells: [number, number][] = [];
    stops.forEach((s, reel) => {
      for (let row = 0; row < 3; row++) if (neonSymbolAt(reel, s, row) === 'SCATTER') cells.push([reel, row]);
    });
    return cells;
  };

  /** Show which lines paid: steppers light the payline and the reels that made it; the 5-reel draws its lines. */
  const showWin = (e: ReelsEvent) => {
    if (video) {
      const scat = e.scatterWin > 0 ? scatterCells(e.stops) : [];
      lineCycle = { lines: e.lines.map((w) => ({ line: w.line, count: w.count, win: w.win, symbol: w.symbol })), scatters: scat, t: 0, i: -1 };
      drawOverlay(lineCycle.lines, scat);
      if (e.lines.length > 1) lineTag(`${e.lines.length} lines`);
      else if (e.lines.length === 1) lineTag(`Line ${e.lines[0]!.line + 1} · ${formatMoney(e.lines[0]!.win)}`, lineColor(e.lines[0]!.line));
      else if (scat.length) lineTag(`${e.scatters} scatters · ${formatMoney(e.scatterWin)}`);
    } else {
      hitReels = e.hits;
      paylineGlow = 1;
    }
  };

  /** Count the win meter (and the credit meter with it) from one value to another. */
  const rollup = async (from: { win: number; credit: number }, to: { win: number; credit: number }, seconds: number, ticks: boolean, onValue?: (win: number) => void) => {
    let lastTick = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setMeters({ win: to.win, credit: to.credit });
      onValue?.(to.win);
    };
    const run = tween(
      seconds * 1000,
      (k) => {
        if (done) return;
        const win = Math.round(from.win + (to.win - from.win) * k);
        const credit = Math.round(from.credit + (to.credit - from.credit) * k);
        setMeters({ win, credit });
        onValue?.(win);
        const now = performance.now();
        if (ticks && k < 1 && now - lastTick > (video ? 60 : 85)) {
          lastTick = now;
          sound.tick();
        }
      },
      ease.linear,
    );
    await run;
    finish();
  };

  /** Wait, but let Space or a click cut it short once `after` ms have passed. */
  const skippable = (ms: number, after: number): Promise<void> =>
    new Promise((resolve) => {
      let over = false;
      const end = () => {
        if (over) return;
        over = true;
        skip = null;
        resolve();
      };
      void wait(after).then(() => {
        if (!over) skip = end;
      });
      void wait(ms).then(end);
    });

  // --- the round

  let round: { bet: Cents; credit: Cents; running: Cents; awarded: number; free: number } | null = null;

  const beginSpin = (e: SpinEvent) => {
    busy = true;
    pressed = false;
    clearResult();
    clearWinShow();
    setFeatureTag(null);
    // the bet the server took, which may differ from the deck if another tab changed it
    denomIdx = Math.max(0, m.denoms.indexOf(e.denom));
    coins = e.coins;
    refreshBet();
    round = { bet: e.bet, credit: e.credit, running: 0, awarded: 0, free: 0 };
    setMeters({ credit: e.credit, bet: e.bet, win: null });
    refreshButtons();
  };

  const playReels = async (e: ReelsEvent) => {
    const r = round!;
    if (e.spin > 0) {
      clearWinShow();
      r.free = e.spin;
      setFeatureTag(`Free game ${e.spin} of ${r.awarded} · won ${formatMoney(r.running)}`);
      await wait(450);
    }
    sound.startWhir();
    await reels.spin(e.stops, (i) => timing(m, i), (i) => sound.reelStop(i));
    sound.stopWhir();
    if (disposed) return;
    const before = r.running;
    r.running += e.win;
    const celebrate = e.win > 0 && r.running > r.bet;
    if (e.win > 0 && celebrate) showWin(e);

    if (e.spin === 0 && !e.trigger) return; // a plain spin: the result event presents it
    if (e.win > 0) {
      if (celebrate) sound.jingle(3);
      await rollup({ win: before, credit: r.credit }, { win: r.running, credit: r.credit }, celebrate ? Math.min(1.4, 0.5 + (e.win / r.bet) * 0.05) : 0.4, celebrate);
    } else if (e.spin > 0) setMeters({ win: r.running });
    if (e.trigger) {
      // the free games' own moment: the scatters that did it lit on the glass, the bulbs flashing
      // in turn, the feature banner, then the reels take on the free games' tint
      const free = m.kind === 'video' ? m.freeSpins : 10;
      const times = m.kind === 'video' ? m.freeMultiplier : 1;
      r.awarded += free;
      sound.feature();
      drawOverlay(lineCycle?.lines ?? [], scatterCells(e.stops));
      bulbMode.value = FLASH;
      await showBanner(e.spin === 0 ? 'Free games' : 'Retrigger', e.spin === 0 ? `${e.scatters} scatters · ${free} games, wins x${times}` : `${e.scatters} scatters · +${free} games`, 'feature', 2600);
      bulbMode.value = IDLE;
      if (e.spin === 0) reelMats.forEach((mat) => mat.uniforms.uTint.value.set('#f3dcff'));
    }
    if (e.spin > 0) setFeatureTag(`Free game ${e.spin} of ${r.awarded} · won ${formatMoney(r.running)}`);
  };

  const showBanner = async (tier: string, amount: string, kind: 'feature', ms: number) => {
    banner.className = `slots-banner ${kind}`;
    bannerTier.textContent = tier;
    bannerAmount.textContent = amount;
    banner.hidden = false;
    await wait(ms);
    banner.hidden = true;
  };

  const party = { stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx };

  /** What paid, in the machine's words: the pay glass row, the best line, or the free games. */
  const handOf = (res: ResultEvent, last: ReelsEvent | null): string => {
    if (res.freeSpins > 0) return `${res.freeSpins} free games`;
    if (!last) return 'Win';
    if (!video) return m.pays.find((p) => p.combo === last.combo)?.label ?? 'Win';
    return neonHand(last.lines) ?? (last.scatters ? `${last.scatters} scatters` : 'Win');
  };

  const finish = async (res: ResultEvent) => {
    const r = round!;
    const total = res.win;
    const bet = res.bet;
    const ratio = total / bet;
    const lastReels = lastReelsEvent;
    const top = lastReels && (lastReels.combo === 'three7' || lastReels.combo === 'threeWX') && lastReels.spin === 0;
    const tier = winTier(total, bet);
    if (res.freeSpins > 0) {
      setFeatureTag(`Free games won ${formatMoney(res.freeWin)}`);
      reelMats.forEach((mat) => mat.uniforms.uTint.value.set(video ? '#ffffff' : '#fff4e2'));
    }

    if (total === 0) {
      setMeters({ win: null, credit: res.credit });
    } else if (total <= bet) {
      // a return that doesn't beat the stake: pay it quietly and show the net
      await rollup({ win: 0, credit: res.credit - total }, { win: total, credit: res.credit }, 0.45, false);
      showResult(`Paid ${formatMoney(total)} · ${formatMoney(total - bet, { sign: true })}`, 'push');
    } else if (total >= HAND_PAY || top) {
      // hand pay: the machine locks up with the amount showing, the tower light flashes slowly and
      // the bulbs chase until the attendant has paid it; then the credits land all at once
      bulbMode.value = CHASE;
      candleFlash = 2;
      sound.handPayBell(6);
      celebrate(party, { title: 'Jackpot · Hand pay', sub: `${handOf(res, lastReels)} · ${timesBet(total, bet)}`, tier: tier ?? 'big' });
      showCount('Hand pay', total, bet);
      await skippable(4200, 1500);
      countup.hidden = true;
      setMeters({ win: total, credit: res.credit });
      showResult(`Hand pay ${formatMoney(total)} · ${formatMoney(total - bet, { sign: true })}`, 'win');
      await wait(1200);
      bulbMode.value = IDLE;
      candleFlash = 0;
    } else if (!tier) {
      if (res.freeSpins === 0) sound.jingle(ratio >= 4 ? 5 : 3);
      const from = res.freeSpins > 0 ? total : 0;
      await rollup({ win: from, credit: res.credit - total }, { win: total, credit: res.credit }, Math.min(1.5, 0.6 + ratio * 0.12), true);
      showResult(`Paid ${formatMoney(total)} · ${formatMoney(total - bet, { sign: true })}`, 'win');
    } else {
      // big from 10 bets, huge from 50: the banner names it, the meter counts it up, the bulbs
      // chase (and on the steppers the candle flashes with the bells)
      bulbMode.value = CHASE;
      if (!video) candleFlash = 1;
      sound.jingle(video ? 7 : 6);
      celebrate(party, { title: tier === 'huge' ? 'Huge win' : 'Big win', sub: `${handOf(res, lastReels)} · ${timesBet(total, bet)}`, tier });
      const seconds = video ? Math.min(8, 4 + ratio / 25) : Math.min(6, 3.2 + ratio / 40);
      let counted = false;
      showCount('Win', 0, bet);
      await Promise.race([
        rollup({ win: 0, credit: res.credit - total }, { win: total, credit: res.credit }, seconds, true, (v) => {
          if (!counted) showCount('Win', v, bet);
        }),
        skippable(seconds * 1000, 1000),
      ]);
      counted = true;
      setMeters({ win: total, credit: res.credit });
      showCount('Win', total, bet);
      await skippable(1400, 0);
      countup.hidden = true;
      bulbMode.value = IDLE;
      candleFlash = 0;
      showResult(`Paid ${formatMoney(total)} · ${formatMoney(total - bet, { sign: true })}`, 'win');
    }
    lastWin = total > 0 ? total : null;
    void r;
  };

  let lastReelsEvent: ReelsEvent | null = null;

  const settle = (v: SlotsView) => {
    reels.set(v.stops);
    busy = false;
    pressed = false;
    round = null;
    skip = null;
    setMeters({ credit: stack, bet: betOf(), win: lastWin });
    refreshButtons();
  };

  // --- initial picture
  drawMeters();
  refreshBet();

  return {
    onTable(snap) {
      const v = snap.view as SlotsView;
      stack = snap.you.stack;
      status = snap.you.status;
      if (v.round > 0) {
        denomIdx = Math.max(0, m.denoms.indexOf(v.denom));
        coins = Math.max(1, Math.min(m.maxCoins, v.coins));
      }
      lastWin = v.last && v.last.win > 0 ? v.last.win : null;
      clearWinShow();
      banner.hidden = true;
      countup.hidden = true;
      bulbMode.value = IDLE;
      candleFlash = 0;
      refreshBet();
      settle(v);
    },

    async onEvents(events, view) {
      const v = view as SlotsView;
      for (const e of events as SlotsEvent[]) {
        if (disposed) return;
        if (e.type === 'spin') beginSpin(e);
        else if (e.type === 'reels') {
          lastReelsEvent = e;
          await playReels(e);
        } else if (e.type === 'result') {
          stack = e.credit;
          await finish(e);
        }
      }
      if (disposed) return;
      settle(v);
    },

    onSeat(msg) {
      status = msg.status;
      // the credit meter follows the spin while one is playing; it catches up when it settles
      if (!busy) {
        stack = msg.stack;
        setMeters({ credit: stack });
      } else stack = msg.stack;
      refreshButtons();
    },

    onError() {
      pressed = false;
      refreshButtons();
    },

    keydown(e) {
      if (e.code === 'Space') {
        if (skip) skip();
        else spin();
        return true;
      }
      if (e.key === 'ArrowUp') {
        setCoins(coins + 1);
        return true;
      }
      if (e.key === 'ArrowDown') {
        setCoins(coins - 1);
        return true;
      }
      if (e.key === 'i' || e.key === 'I') {
        togglePays();
        return true;
      }
      if (e.key === 'c' || e.key === 'C') {
        nextCoin();
        return true;
      }
      if (e.key === 'Escape' && pays) {
        togglePays();
        return true;
      }
      return false;
    },

    update(dt) {
      flashT += dt;
      // the 5-reel cycles through its winning lines, one at a time after showing them all
      if (lineCycle && lineCycle.lines.length > 1) {
        lineCycle.t += dt;
        const step = lineCycle.i < 0 ? 1.4 : 1.0;
        if (lineCycle.t >= step) {
          lineCycle.t = 0;
          lineCycle.i = (lineCycle.i + 1) % lineCycle.lines.length;
          const w = lineCycle.lines[lineCycle.i]!;
          drawOverlay([w], lineCycle.scatters);
          lineTag(`Line ${w.line + 1} · ${w.count} ${w.symbol === '10' ? 'tens' : w.symbol.toLowerCase()} · ${formatMoney(w.win)}`, lineColor(w.line));
        }
      }
      // steppers: the reels that paid pulse behind the glass and the payline glows
      if (hitReels.length) {
        const pulse = 1.12 + 0.18 * Math.sin(flashT * 7);
        hitReels.forEach((hit, i) => reels.bright(i, hit ? pulse : 0.8));
      }
      if (handle.payline) {
        const k = paylineGlow ? 0.5 + 0.5 * Math.sin(flashT * 7) : 0;
        paylineMat.color.setRGB(1, 0.2 + 0.7 * k, 0.15 + 0.7 * k);
      }
      if (candleFlash) {
        const on = candleFlash === 1 ? Math.sin(flashT * 18) > 0 : Math.cos(flashT * Math.PI) > 0;
        whiteMat.color.set(on ? '#ffffff' : '#3a3632');
        tintMat.color.set(candleColor(m.denoms[denomIdx]!)).multiplyScalar(on ? 1.2 : 0.35);
      } else {
        whiteMat.color.set('#fff8ec');
        tintMat.color.set(candleColor(m.denoms[denomIdx]!));
      }
    },

    dispose() {
      disposed = true;
      unTips();
      ctx.kit.tip(null);
      removeEventListener('pointerdown', onPointer);
      pays?.close();
      deck.remove();
      banner.remove();
      countup.remove();
      clearResult();
      setFeatureTag(null);
      lineTag(null);
      sound.stopWhir();
      reels.dispose();
      handle.meters.material = sharedMeterMat;
      meterMat.dispose();
      meterTex.dispose();
      if (handle.overlay && sharedOverlayMat) handle.overlay.material = sharedOverlayMat;
      overlayMat?.dispose();
      overlayTex?.dispose();
      if (handle.payline && sharedPayline) handle.payline.material = sharedPayline;
      paylineMat.dispose();
      handle.bulbs.material = sharedBulbs;
      bulbMat.dispose();
      handle.candleTint.material = sharedTint;
      handle.candleWhite.material = sharedWhite;
      tintMat.dispose();
      whiteMat.dispose();
      if (column) {
        column.removeFromParent();
        column.geometry.dispose();
        (column.material as THREE.Material).dispose();
      }
      if (owned) handle.root.removeFromParent();
    },
  };
}
