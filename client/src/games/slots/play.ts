// Diamond Line, Lucky Cherries and Gold Rush at play. The server has settled every spin (and its
// wheel or free games) before a reel moves; this view spins the reels to the stops it sent, left
// to right, then presents what the spin paid the way the first three machines do (view.ts):
// nothing for nothing, a quiet "Paid $X" when the return is no more than the bet, a line or
// payline highlight with a jingle and rollup for a real win, from 10 bets a big win (50 a huge
// one) with the celebration banner, the count-up meter and the bulbs chasing, and a hand pay for
// the top award or $2,000 and up. The Cherry Wheel turns to the segment the server drew; Gold
// Rush's free games hold every wild that lands in front of the reels until they end.

import * as THREE from 'three';
import type { TableView, TableViewCtx } from '../contract.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { LINEUP } from '../../../../shared/src/games/slots/lineup.ts';
import { DIAMONDS } from '../../../../shared/src/games/slots/diamonds.ts';
import { GOLDRUSH } from '../../../../shared/src/games/slots/goldrush.ts';
import { CHERRIES } from '../../../../shared/src/games/slots/cherries.ts';
import { cellsShowing } from '../../../../shared/src/games/slots/lines.ts';
import type { ReelsEvent, ResultEvent, SlotsEvent, SlotsView, SpinEvent } from '../../../../shared/src/games/slots/protocol.ts';
import { el, button } from '../../ui/kit.ts';
import { session } from '../../app/session.ts';
import { tween, wait, ease } from '../../table/tween.ts';
import { celebrate } from '../../table/celebrate.ts';
import type { SpinTiming } from './reels.ts';
import { bulbMaterial, buttonAtUv, candleColor } from './cabinet.ts';
import { bankMaterial, ReelBank } from './bank.ts';
import { buildSkinned, payMatrix, skinEntry, winMeterAt, type SkinnedHandle } from './build.ts';
import { EMPTY_OVERLAY, lineColorOf, paintLineOverlay, paintSkinMeters, type MeterValues, type OverlayState, type SkinId } from './skin.ts';
import { DIAMOND_COLUMNS } from './diamonds.ts';
import { REGIONS } from './glass.ts';
import { MachineSound } from './sound.ts';
import { openPaysheet } from './paysheet.ts';
import { slotsTip, timesBet, winTier } from './moments.ts';
import './slots2.css';

/** IRS W-2G slot threshold from 2026: an attendant pays this by hand. */
const HAND_PAY: Cents = 200_000;
/** Bulb modes (cabinet.ts): idle chase, alternate flash, slow pulse, fast win chase. */
const IDLE = 0;
const FLASH = 1;
const CHASE = 3;

export const SKINNED: readonly SkinId[] = ['diamonds', 'cherries', 'goldrush'];
export const isSkinned = (v: string): v is SkinId => (SKINNED as readonly string[]).includes(v);

function findCabinet(ctx: TableViewCtx, id: SkinId): { handle: SkinnedHandle; owned: boolean } {
  for (const child of ctx.stage.anchor.children) {
    const h = child.userData.slots2 as SkinnedHandle | undefined;
    if (h && h.machine === id) return { handle: h, owned: false };
  }
  // the floor didn't build one (or built something else): bring our own
  const root = buildSkinned(id, ctx.stage.engine.quality);
  ctx.stage.root.add(root);
  return { handle: root.userData.slots2 as SkinnedHandle, owned: true };
}

function timing(stepper: boolean, i: number): SpinTiming {
  // about 2.5 s a spin; reels land 300-350 ms apart
  return {
    delay: i * 0.05,
    land: (stepper ? 1.45 : 1.15) + i * (stepper ? 0.35 : 0.3),
    speed: stepper ? 34 : 26,
    kick: 0.09,
    accel: 0.2,
    decel: 0.34,
    bounce: stepper ? 0.12 : 0.16,
    bounceAmp: stepper ? 0.1 : 0.12,
  };
}

const COUNT = ['', 'One', 'Two', 'Three', 'Four', 'Five'];
const PLURAL: Record<string, string> = {
  SEVEN: 'sevens', BELL: 'bells', MELON: 'melons', GRAPES: 'grapes', PLUM: 'plums', ORANGE: 'oranges', LEMON: 'lemons', CHERRY: 'cherries',
  CART: 'carts', PICK: 'pickaxes', LANTERN: 'lanterns', PAN: 'pans', A: 'aces', K: 'kings', Q: 'queens', J: 'jacks', '10': 'tens',
};
const wordsFor = (count: number, symbol: string) => `${COUNT[count] ?? count} ${PLURAL[symbol] ?? symbol.toLowerCase()}`;

/** A line machine's best line in words: "Five cherries", "Four bells and 2 more lines". */
function bestLine(lines: readonly { symbol: string; count: number; win: number }[]): string | null {
  if (!lines.length) return null;
  const best = [...lines].sort((a, b) => b.win - a.win)[0]!;
  const more = lines.length - 1;
  return more > 0 ? `${wordsFor(best.count, best.symbol)} and ${more} more line${more > 1 ? 's' : ''}` : wordsFor(best.count, best.symbol);
}

const mod = (x: number, n: number) => ((x % n) + n) % n;

export function mountSkinned(ctx: TableViewCtx): TableView {
  const id: SkinId = isSkinned(ctx.variant) ? ctx.variant : 'diamonds';
  const entry = skinEntry(id);
  const skin = entry.skin;
  const m = LINEUP[id];
  const stepper = m.kind === 'stepper';
  const rows = skin.layout.reels.rows;
  const l = skin.layout;
  const { handle, owned } = findCabinet(ctx, id);
  const sound = new MachineSound(ctx.sfx, stepper ? 'stepper' : 'video');
  let disposed = false;

  // --- this view's own copies of the parts it animates (the floor's shared ones come back on dispose)
  const sharedBank = handle.bank.material;
  const bankMat = bankMaterial(handle.strips[0]!.sharp, handle.strips[0]!.blurred, l.reels.count, handle.stops, l.reels.look.curve, skin.tint);
  handle.bank.material = bankMat;
  const reels = new ReelBank(bankMat, l.reels.count, handle.stops, stepper ? 0 : (rows - 1) / 2);
  const useStrips = (set: number) => {
    bankMat.uniforms.map.value = handle.strips[set]!.sharp;
    bankMat.uniforms.blurMap.value = handle.strips[set]!.blurred;
  };

  const meterCanvas = document.createElement('canvas');
  const meterTex = new THREE.CanvasTexture(meterCanvas);
  meterTex.colorSpace = THREE.SRGBColorSpace;
  const meterMat = new THREE.MeshBasicMaterial({ map: meterTex, toneMapped: false });
  const sharedMeterMat = handle.meters.material;
  handle.meters.material = meterMat;

  const spec = entry.overlay ?? null;
  let overlayCanvas: HTMLCanvasElement | null = null;
  let overlayTex: THREE.CanvasTexture | null = null;
  let overlayMat: THREE.MeshBasicMaterial | null = null;
  const sharedOverlayMat = handle.overlay?.material ?? null;
  if (handle.overlay && spec) {
    overlayCanvas = document.createElement('canvas');
    paintLineOverlay(overlayCanvas, spec, EMPTY_OVERLAY, handle.scale);
    overlayTex = new THREE.CanvasTexture(overlayCanvas);
    overlayTex.colorSpace = THREE.SRGBColorSpace;
    overlayMat = new THREE.MeshBasicMaterial({ map: overlayTex, transparent: true, depthWrite: false, toneMapped: false });
    handle.overlay.material = overlayMat;
  }
  const paylineMat = new THREE.MeshBasicMaterial({ color: '#ff3326', toneMapped: false });
  const sharedPayline = handle.payline?.material ?? null;
  if (handle.payline) handle.payline.material = paylineMat;

  const bulbMode = { value: IDLE };
  const bulbMat = bulbMaterial(handle.clock, bulbMode);
  const sharedBulbs = handle.bulbs.material;
  handle.bulbs.material = bulbMat;

  const tintMat = new THREE.MeshBasicMaterial({ color: candleColor(m.denoms[0]!), toneMapped: false });
  const whiteMat = new THREE.MeshBasicMaterial({ color: '#fff8ec', toneMapped: false });
  const sharedTint = handle.candleTint.material;
  const sharedWhite = handle.candleWhite.material;
  handle.candleTint.material = tintMat;
  handle.candleWhite.material = whiteMat;

  // the lit column on Diamond Line's pay glass for the coins bet
  let column: THREE.Mesh | null = null;
  if (stepper) {
    const pw = REGIONS.pay.w;
    column = new THREE.Mesh(
      new THREE.PlaneGeometry((124 / pw) * l.pay.w, l.pay.h * 0.8),
      new THREE.MeshBasicMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    column.matrixAutoUpdate = false;
    ctx.stage.root.add(column);
  }
  const placeColumn = (coins: number) => {
    if (!column) return;
    const x = (DIAMOND_COLUMNS[coins - 1]! / REGIONS.pay.w - 0.5) * l.pay.w;
    column.matrix.copy(payMatrix(l, l.bevel + 0.004)).multiply(new THREE.Matrix4().makeTranslation(x, -0.01, 0.001));
  };

  const wheel = handle.extra.wheel ?? null;

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

  // --- DOM: the button deck, the result pill at the win meter, banners and the count-up
  const deck = el('div', 'slots-deck panel');
  const paysBtn = button('Pays', () => togglePays(), { key: 'I', cls: 'ghost' });
  const coinBtn = button('', () => nextCoin(), { key: 'C', title: 'Coin value' });
  coinBtn.classList.add('slots-coin');
  const downBtn = button('−', () => setCoins(coins - 1), { key: '↓', title: stepper ? 'One coin less' : 'Fewer credits per line' });
  const betLabel = el('div', 'slots-bet');
  const upBtn = button('+', () => setCoins(coins + 1), { key: '↑', title: stepper ? 'One coin more' : 'More credits per line' });
  const maxBtn = button('Max bet', () => setCoins(m.maxCoins));
  const insertBtn = button('Insert', () => void insert(), { cls: 'ghost', title: 'Add money to this machine' });
  const spinBtn = button('Spin', () => spin(), { cls: 'primary', key: 'Space' });
  const sep = () => el('div', 'sep');
  deck.append(insertBtn, paysBtn, sep(), coinBtn, downBtn, betLabel, upBtn, maxBtn, sep(), spinBtn);
  ctx.ui.append(deck);

  const banner = el('div', `slots-banner feature skin-${id}`);
  banner.hidden = true;
  const bannerTier = el('div', 'tier');
  const bannerAmount = el('div', 'amount');
  banner.append(bannerTier, bannerAmount);
  ctx.ui.append(banner);

  const countup = el('div', `slots-countup ${stepper ? 'stepper' : 'video'} skin-${id}`);
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

  const winAt = winMeterAt(l);
  const tagAt = new THREE.Vector3(0, l.window.cy + l.window.h / 2 + 0.03, l.plate.zBack + l.plate.depth + 0.02);
  const lineAt = new THREE.Vector3(0, l.window.cy - l.window.h / 2 - 0.016, l.plate.zBack + l.plate.depth + 0.01);
  const pinned = (cls: string, at: THREE.Vector3) => {
    let tag: { obj: THREE.Object3D; el: HTMLElement } | null = null;
    return (text: string | null, color?: string) => {
      if (!text) {
        tag?.obj.removeFromParent();
        tag?.el.remove();
        tag = null;
        return;
      }
      if (!tag) {
        const e = el('div', cls);
        tag = { obj: ctx.stage.label(e, at), el: e };
      }
      tag.el.textContent = text;
      tag.el.style.borderColor = color ?? '';
    };
  };
  let result: { obj: THREE.Object3D; el: HTMLElement } | null = null;
  const clearResult = () => {
    result?.obj.removeFromParent();
    result?.el.remove();
    result = null;
  };
  const showResult = (text: string, kind: 'win' | 'push') => {
    clearResult();
    const e = el('div', `pill ${kind} slots-result`, text);
    result = { obj: ctx.stage.label(e, winAt), el: e };
  };
  const featureTag = pinned(`slots-tag skin-${id}`, tagAt);
  const lineTag = pinned(`slots-line skin-${id}`, lineAt);

  // --- meters
  const drawMeters = () => {
    paintSkinMeters(meterCanvas, skin.meter, meters, handle.scale);
    meterTex.needsUpdate = true;
  };
  const setMeters = (v: Partial<MeterValues>) => {
    meters = { ...meters, ...v };
    drawMeters();
  };

  const refreshBet = () => {
    coinBtn.firstChild!.textContent = `Coin ${formatMoney(m.denoms[denomIdx]!)}`;
    betLabel.textContent = stepper ? `${coins} coin${coins > 1 ? 's' : ''} · ${formatMoney(betOf())}` : `${coins} per line · ${formatMoney(betOf())}`;
    tintMat.color.set(candleColor(m.denoms[denomIdx]!));
    placeColumn(coins);
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
    pays = openPaysheet(ctx.ui, id, () => (pays = null));
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
  let overlay: OverlayState = EMPTY_OVERLAY;
  let lineCycle: { lines: { line: number; count: number; win: Cents; symbol: string }[]; t: number; i: number } | null = null;
  let hitReels: boolean[] = [];
  let paylineGlow = 0;
  let candleFlash: 0 | 1 | 2 = 0;
  let flashT = 0;
  let flashing = 0;
  let skip: (() => void) | null = null;

  const drawOverlay = (next: Partial<OverlayState>, flashOn = true) => {
    overlay = { ...overlay, ...next };
    if (!overlayCanvas || !overlayTex || !spec) return;
    paintLineOverlay(overlayCanvas, spec, overlay, handle.scale, flashOn);
    overlayTex.needsUpdate = true;
  };

  const clearWinShow = () => {
    lineCycle = null;
    hitReels = [];
    paylineGlow = 0;
    reels.brightAll(1);
    drawOverlay({ lines: [], rings: [], flash: [] });
    lineTag(null);
  };

  const scatterCells = (stops: readonly number[], free: boolean): number[] => {
    if (id === 'cherries') return cellsShowing(CHERRIES.strips, rows, stops, 'BONUS');
    if (id === 'goldrush') return free ? [] : cellsShowing(GOLDRUSH.strips, rows, stops, 'NUGGET');
    return [];
  };

  /** Show which lines paid: the payline and its reels on Diamond Line, drawn lines on the 5-reel machines. */
  const showWin = (e: ReelsEvent) => {
    if (stepper) {
      hitReels = e.hits;
      paylineGlow = 1;
      if (e.wilds === 1) lineTag('Diamond · pays double');
      else if (e.wilds === 2) lineTag('Two diamonds · pays four times');
      return;
    }
    const lines = e.lines.map((w) => ({ line: w.line, count: w.count, win: w.win, symbol: w.symbol }));
    lineCycle = { lines, t: 0, i: -1 };
    drawOverlay({ lines });
    if (lines.length > 1) lineTag(`${lines.length} lines`);
    else if (lines.length === 1) lineTag(`Line ${lines[0]!.line + 1} · ${formatMoney(lines[0]!.win)}`, lineColorOf(spec!, lines[0]!.line));
  };

  /** Count the win meter (and the credit meter with it) from one value to another. */
  const rollup = async (from: { win: number; credit: number }, to: { win: number; credit: number }, seconds: number, ticks: boolean, onValue?: (win: number) => void) => {
    let lastTick = 0;
    await tween(
      seconds * 1000,
      (k) => {
        const win = Math.round(from.win + (to.win - from.win) * k);
        setMeters({ win, credit: Math.round(from.credit + (to.credit - from.credit) * k) });
        onValue?.(win);
        const now = performance.now();
        if (ticks && k < 1 && now - lastTick > (stepper ? 85 : 60)) {
          lastTick = now;
          sound.tick();
        }
      },
      ease.linear,
    );
    setMeters({ win: to.win, credit: to.credit });
    onValue?.(to.win);
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

  const showBanner = async (tier: string, amount: string, ms: number) => {
    bannerTier.textContent = tier;
    bannerAmount.textContent = amount;
    banner.hidden = false;
    await skippable(ms, 600);
    banner.hidden = true;
  };

  /** Turn the Cherry Wheel clockwise, four turns and more, to rest with `segment` under the pointer. */
  const spinWheel = async (segment: number) => {
    if (!wheel) return;
    const seg = (Math.PI * 2) / CHERRIES.wheel.length;
    const from = wheel.rotation.z;
    const to = from - (mod(from - segment * seg, Math.PI * 2) + 4 * Math.PI * 2);
    let last = Math.round(from / seg);
    await tween(
      4600,
      (k) => {
        const a = from + (to - from) * (1 - (1 - k) ** 3);
        wheel.rotation.z = a;
        const s = Math.round(a / seg);
        if (s !== last) {
          last = s;
          sound.tick();
        }
      },
      ease.linear,
    );
    wheel.rotation.z = mod(to, Math.PI * 2);
  };

  // --- the round

  let round: { bet: Cents; credit: Cents; running: Cents; games: number; held: number[] } | null = null;
  let lastReels: ReelsEvent | null = null;

  const beginSpin = (e: SpinEvent) => {
    busy = true;
    pressed = false;
    clearResult();
    clearWinShow();
    featureTag(null);
    // the bet the server took, which may differ from the deck if another tab changed it
    denomIdx = Math.max(0, m.denoms.indexOf(e.denom));
    coins = e.coins;
    refreshBet();
    round = { bet: e.bet, credit: e.credit, running: 0, games: 0, held: [] };
    setMeters({ credit: e.credit, bet: e.bet, win: null });
    refreshButtons();
  };

  const playReels = async (e: ReelsEvent) => {
    const r = round!;
    const free = e.spin > 0;
    if (free) {
      // a free game: the wilds held so far stand in front of the reels while they spin
      clearWinShow();
      r.held = e.held ?? [];
      drawOverlay({ held: r.held });
      featureTag(`Free game ${e.spin} of ${r.games} · won ${formatMoney(r.running)}`);
      await wait(450);
    }
    sound.startWhir();
    await reels.spin(e.stops, (i) => timing(stepper, i), (i) => sound.reelStop(i));
    sound.stopWhir();
    if (disposed) return;

    if (free) {
      // wilds that landed now stick: flash them, then they join the held ones
      const landed = cellsShowing(GOLDRUSH.freeStrips, rows, e.stops, 'WILD').filter((c) => !r.held.includes(c));
      if (landed.length) {
        r.held = [...r.held, ...landed];
        drawOverlay({ held: r.held, flash: landed });
        flashing = 1.2;
        sound.reelStop(2);
      }
    }

    const before = r.running;
    const lineWin = e.win - (e.wheel?.win ?? 0);
    r.running += lineWin;
    const beats = lineWin > 0 && r.running > r.bet;
    if (lineWin > 0 && (beats || e.wheel || free)) showWin(e);

    if (e.wheel) {
      // the Cherry Wheel: the BONUS symbols that did it ringed, the bulbs flashing, the wheel turned
      drawOverlay({ rings: scatterCells(e.stops, false) });
      if (lineWin > 0) await rollup({ win: before, credit: r.credit }, { win: r.running, credit: r.credit }, 0.6, true);
      sound.feature();
      bulbMode.value = FLASH;
      await showBanner('Cherry Wheel', `${e.scatters} bonus · prizes x${e.wheel.mult} the bet`, 2000);
      featureTag('Cherry Wheel');
      await spinWheel(e.wheel.segment);
      bulbMode.value = IDLE;
      if (disposed) return;
      featureTag(`${e.wheel.prize}x the bet${e.wheel.mult > 1 ? ` · x${e.wheel.mult}` : ''} · ${formatMoney(e.wheel.win)}`);
      const w0 = r.running;
      r.running += e.wheel.win;
      await rollup({ win: w0, credit: r.credit }, { win: r.running, credit: r.credit }, Math.min(2.2, 0.8 + e.wheel.prize / 40), true);
      return;
    }

    if (!free && !e.trigger) return; // a plain spin: the result event presents it
    if (lineWin > 0) {
      if (beats) sound.jingle(3);
      await rollup({ win: before, credit: r.credit }, { win: r.running, credit: r.credit }, beats ? Math.min(1.4, 0.5 + (lineWin / r.bet) * 0.05) : 0.4, beats);
    } else if (free) setMeters({ win: r.running });

    if (e.trigger) {
      // the free games' own moment: the nuggets ringed, the bulbs flashing, the banner, then the
      // reels change over to the free games' strips
      r.games = e.freeLeft;
      drawOverlay({ rings: scatterCells(e.stops, false) });
      sound.feature();
      bulbMode.value = FLASH;
      await showBanner('Free games', `${e.scatters} nuggets · ${r.games} games · wilds stick`, 2600);
      bulbMode.value = IDLE;
      useStrips(1);
      drawOverlay({ rings: [] });
    }
    if (free) featureTag(`Free game ${e.spin} of ${r.games} · won ${formatMoney(r.running)}`);
  };

  const party = { stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx };

  /** What paid, in the machine's words: the pay glass row, the best line, the wheel or the free games. */
  const handOf = (res: ResultEvent, last: ReelsEvent | null): string => {
    if (res.freeSpins > 0) return `${res.freeSpins} free games`;
    if (!last) return 'Win';
    if (last.wheel) return `Cherry Wheel ${last.wheel.prize}x${last.wheel.mult > 1 ? ` x${last.wheel.mult}` : ''}`;
    if (stepper) {
      const label = DIAMONDS.pays.find((p) => p.combo === last.combo)?.label ?? 'Win';
      return last.wilds === 1 ? `${label}, doubled` : last.wilds === 2 ? `${label}, x4` : label;
    }
    return bestLine(last.lines) ?? 'Win';
  };

  const finish = async (res: ResultEvent) => {
    const total = res.win;
    const bet = res.bet;
    const ratio = total / bet;
    const top = lastReels?.combo === 'threeDI';
    const tier = winTier(total, bet);
    if (res.freeSpins > 0) {
      featureTag(`Free games won ${formatMoney(res.freeWin)}`);
      drawOverlay({ held: [], flash: [] });
      useStrips(0);
      if (lastReels) reels.set(lastReels.stops);
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
      celebrate(party, { title: 'Jackpot · Hand pay', sub: `${handOf(res, lastReels)} · ${timesBet(total, bet)}`, tier: tier ?? 'big', at: new THREE.Vector3(0, l.deck.front[1] + 0.02, l.deck.front[0] + 0.05) });
      showCount('Hand pay', total, bet);
      await skippable(4200, 1500);
      countup.hidden = true;
      setMeters({ win: total, credit: res.credit });
      showResult(`Hand pay ${formatMoney(total)} · ${formatMoney(total - bet, { sign: true })}`, 'win');
      await wait(1200);
      bulbMode.value = IDLE;
      candleFlash = 0;
    } else if (!tier) {
      const presented = res.freeSpins > 0 || !!lastReels?.wheel;
      if (!presented) sound.jingle(ratio >= 4 ? 5 : 3);
      const from = presented ? total : 0;
      await rollup({ win: from, credit: res.credit - total }, { win: total, credit: res.credit }, Math.min(1.5, 0.6 + ratio * 0.12), true);
      showResult(`Paid ${formatMoney(total)} · ${formatMoney(total - bet, { sign: true })}`, 'win');
    } else {
      // big from 10 bets, huge from 50: the banner names it, the meter counts it up, the bulbs
      // chase (and on Diamond Line the candle flashes with the bells)
      bulbMode.value = CHASE;
      if (stepper) candleFlash = 1;
      sound.jingle(stepper ? 6 : 7);
      celebrate(party, {
        title: tier === 'huge' ? 'Huge win' : 'Big win',
        sub: `${handOf(res, lastReels)} · ${timesBet(total, bet)}`,
        tier,
        at: new THREE.Vector3(0, l.deck.front[1] + 0.02, l.deck.front[0] + 0.05),
      });
      const seconds = stepper ? Math.min(6, 3.2 + ratio / 40) : Math.min(8, 4 + ratio / 25);
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
  };

  const settle = (v: SlotsView) => {
    useStrips(0);
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
      drawOverlay({ held: [] });
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
          if (e.spin === 0) lastReels = e;
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
      stack = msg.stack;
      if (!busy) setMeters({ credit: stack });
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
      // the 5-reel machines cycle through their winning lines, one at a time after showing them all
      if (lineCycle && lineCycle.lines.length > 1 && spec) {
        lineCycle.t += dt;
        if (lineCycle.t >= (lineCycle.i < 0 ? 1.4 : 1.0)) {
          lineCycle.t = 0;
          lineCycle.i = (lineCycle.i + 1) % lineCycle.lines.length;
          const w = lineCycle.lines[lineCycle.i]!;
          drawOverlay({ lines: [w] });
          lineTag(`Line ${w.line + 1} · ${wordsFor(w.count, w.symbol).toLowerCase()} · ${formatMoney(w.win)}`, lineColorOf(spec, w.line));
        }
      }
      // a wild that just stuck flashes white a few times
      if (flashing > 0) {
        const before = Math.floor(flashing * 5);
        flashing = Math.max(0, flashing - dt);
        const after = Math.floor(flashing * 5);
        if (before !== after) drawOverlay({}, after % 2 === 0 && flashing > 0);
        if (flashing === 0) drawOverlay({ flash: [] });
      }
      // Diamond Line: the reels that paid pulse behind the glass and the payline glows
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
      featureTag(null);
      lineTag(null);
      sound.stopWhir();
      handle.bank.material = sharedBank;
      bankMat.dispose();
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
