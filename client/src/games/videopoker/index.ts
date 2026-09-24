// Video poker: the machine on the floor and the view for playing it. The cabinet is a 3D model;
// its screen is DOM laid over the model's screen (see screen.ts) and its deck buttons are the
// model's own, lit and pressed from here. Cards deal left to right, held cards stay put, draws
// flip in, and a win rolls up the WIN and CREDITS meters while its pay row flashes. A full house
// and better also flash the hand's name and get the table's celebration (chips on the deck for a
// straight flush or royal); a pay that only returns the bet is shown without any celebration.

import * as THREE from 'three';
import './videopoker.css';
import type { GameClientModule, TableView } from '../contract.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import type { Card } from '../../../../shared/src/cards.ts';
import { DENOMS, type VideoPokerView } from '../../../../shared/src/games/videopoker/engine.ts';
import { MAX_COINS, JACKS_OR_BETTER, FULL_HOUSE, FOUR_OF_A_KIND, STRAIGHT_FLUSH, ROYAL_FLUSH } from '../../../../shared/src/games/videopoker/hands.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { tween, wait, ease, finishAll } from '../../table/tween.ts';
import { celebrate } from '../../table/celebrate.ts';
import { el } from '../../ui/kit.ts';
import { cabinetModel, machinePose, screenCorners, BUTTONS, FOOTPRINT, SEAT, DECK_POINT, type ButtonId } from './cabinet.ts';
import { MachineScreen, GLASS_NAMES, toScreen } from './screen.ts';
import { MachineSounds } from './sounds.ts';
import { holdAdvice, betAdvice } from './advice.ts';

/** The celebration's title for the pays that get one. */
const BANNER: Record<number, string> = {
  [ROYAL_FLUSH]: 'Royal flush',
  [STRAIGHT_FLUSH]: 'Straight flush',
  [FOUR_OF_A_KIND]: 'Four of a kind',
  [FULL_HOUSE]: 'Full house',
};

const LIT = 1;
const DARK = 0.04;

/** How long the meters take to count a win up: 1-2 s for ordinary pays, 3.5-8 s for the big ones. */
function rollupMs(rank: number, credits: number, winning: boolean): number {
  if (!winning) return 450;
  if (rank === ROYAL_FLUSH) return 8000;
  if (rank === STRAIGHT_FLUSH) return 5000;
  if (rank === FOUR_OF_A_KIND) return 3500;
  return 900 + Math.min(credits, 45) * 20;
}

export const videopoker: GameClientModule = {
  game: 'videopoker',
  footprint: FOOTPRINT,
  createModel: () => cabinetModel(),
  seats: () => [{ position: SEAT, yaw: Math.PI }],
  playPose: () => machinePose(),

  mount(ctx): TableView {
    const sounds = new MachineSounds(ctx.sfx);
    const layer = el('div', 'vp-layer pass');
    const screen = new MachineScreen(
      (i) => toggleHold(i),
      () => nextDenom(),
    );
    layer.append(screen.root);
    ctx.ui.append(layer);
    const corners = screenCorners();
    const canvas = ctx.stage.engine.renderer.domElement;

    // Under the DOM screen the cabinet's own screen goes dark; its deck buttons come alive.
    const machine = ctx.stage.anchor;
    const glass = machine.getObjectByName('vp-screen') as THREE.Mesh | undefined;
    const glassMat = glass?.material as THREE.MeshBasicMaterial | undefined;
    const attract = glassMat?.map ?? null;
    if (glassMat) {
      glassMat.map = null;
      glassMat.color.set('#0a1672');
      glassMat.needsUpdate = true;
    }
    const buttons = new Map<ButtonId, { group: THREE.Object3D; lens: THREE.MeshStandardMaterial; y: number }>();
    for (const spec of BUTTONS) {
      const group = machine.getObjectByName(`vp-btn-${spec.id}`);
      const lens = group?.getObjectByName('lens') as THREE.Mesh | undefined;
      if (group && lens) buttons.set(spec.id, { group, lens: lens.material as THREE.MeshStandardMaterial, y: group.position.y });
    }
    const pickable = [...buttons.values()].map((b) => b.group);

    let phase: VideoPokerView['phase'] = 'idle';
    let round = -1;
    let coins = MAX_COINS;
    let denom: Cents = DENOMS[0]!;
    let held = [false, false, false, false, false];
    /** The seat's stack as the server last said; `shown` is what the credit meter shows. */
    let stack = 0;
    let shown = 0;
    let win = 0;
    /** A deal or draw is on its way to the server, or its cards are still coming out. */
    let busy = false;
    let animating = false;
    let rolling = false;
    let dealAfterRollup = false;
    /** The five cards on the screen. */
    let hand: Card[] = [];
    let tipShown = false;

    const renderMeters = () => screen.setMeters(win, Math.floor(shown / denom), formatMoney(shown));

    // Tips: on a deal, the strategy list's hold with those cards ringed on the screen; before a
    // deal, the fifth coin when the bet is short of it. Gone while a deal or draw is under way.
    const clearTip = () => {
      if (!tipShown) return;
      tipShown = false;
      ctx.kit.tip(null);
      screen.pick(0);
    };
    const tipFor = () => {
      let text: string | null = null;
      let mask = 0;
      if (ctx.tips.on && !busy && !animating) {
        if (phase === 'dealt' && hand.length === 5) ({ text, mask } = holdAdvice(hand));
        else if (phase !== 'dealt') text = betAdvice(coins);
      }
      if (text === null) return clearTip();
      tipShown = true;
      ctx.kit.tip(text);
      screen.pick(mask);
    };
    const offTips = ctx.tips.subscribe(tipFor);

    const light = () => {
      const dealt = phase === 'dealt';
      for (const [id, b] of buttons) {
        const on = id === 'deal' || id === 'pays' || (id.startsWith('hold') ? dealt && !busy : !dealt && !busy);
        b.lens.emissiveIntensity = on ? LIT : DARK;
      }
      screen.setHoldable(dealt && !busy);
      screen.setDenom(formatMoney(denom), !dealt && !busy);
    };

    const press = (id: ButtonId) => {
      const b = buttons.get(id);
      if (!b) return;
      void tween(150, (k) => (b.group.position.y = b.y - 0.004 * Math.sin(Math.PI * k)), ease.linear);
    };

    const idleStatus = () => {
      if (phase === 'idle') screen.setStatus(`PLAY ${coins} CREDIT${coins > 1 ? 'S' : ''}`, 'info');
    };

    const dealOrDraw = () => {
      press('deal');
      if (rolling) {
        // Like the real thing: DEAL during a count-up finishes it and deals the next hand.
        dealAfterRollup = true;
        finishAll();
        return;
      }
      if (busy || animating) return;
      if (phase === 'dealt') {
        busy = true;
        ctx.link.act({ type: 'draw', hold: held.slice() });
      } else {
        if (coins * denom > stack) {
          sounds.refuse();
          ctx.kit.say(`Not enough credits: ${coins} × ${formatMoney(denom)} is ${formatMoney(coins * denom)}. Bet less or lower the coin value.`);
          return;
        }
        busy = true;
        ctx.link.act({ type: 'deal', coins, denom });
      }
      light();
      tipFor();
    };

    const toggleHold = (i: number) => {
      if (phase !== 'dealt' || busy) return;
      held[i] = !held[i];
      screen.setHeld(i, held[i]!);
      sounds.hold(held[i]!);
      press(`hold${i}` as ButtonId);
    };

    const betOne = (dir: 1 | -1) => {
      press('betone');
      if (phase === 'dealt' || busy || animating) return sounds.refuse();
      coins = dir > 0 ? (coins % MAX_COINS) + 1 : ((coins + MAX_COINS - 2) % MAX_COINS) + 1;
      screen.setCoins(coins);
      sounds.bet(coins);
      idleStatus();
      tipFor();
    };

    const betMax = () => {
      press('betmax');
      if (phase === 'dealt' || busy || animating) return;
      coins = MAX_COINS;
      screen.setCoins(coins);
      sounds.bet(coins);
      dealOrDraw();
    };

    const nextDenom = () => {
      if (phase === 'dealt' || busy || animating) return sounds.refuse();
      denom = DENOMS[(DENOMS.indexOf(denom) + 1) % DENOMS.length]!;
      sounds.bet(1);
      renderMeters();
      light();
    };

    /** Draw everything from a view with no animation (joining, reconnecting). */
    const redraw = (v: VideoPokerView) => {
      if (v.round !== round) held = [false, false, false, false, false];
      round = v.round;
      phase = v.phase;
      hand = v.hand.slice();
      if (v.phase !== 'idle') {
        coins = v.coins;
        denom = v.denom;
      }
      screen.setCoins(coins);
      for (let i = 0; i < 5; i++) {
        screen.setCard(i, (v.hand[i] as Card | undefined) ?? null);
        screen.setHeld(i, v.phase === 'dealt' && held[i]!);
      }
      win = 0;
      if (v.phase === 'dealt' && v.dealt !== null && v.dealt >= JACKS_OR_BETTER) {
        screen.setRow(v.dealt, 'made');
        screen.setStatus(GLASS_NAMES[v.dealt]!, 'dim');
      } else if (v.phase === 'over' && v.result && v.result.credits > 0) {
        win = v.result.credits;
        screen.setRow(v.result.rank, 'paid');
        screen.setStatus(GLASS_NAMES[v.result.rank]!, 'hand');
      } else if (v.phase === 'over') {
        screen.setRow(null);
        screen.setStatus('GAME OVER', 'over');
      } else {
        screen.setRow(null);
        screen.setStatus('');
        idleStatus();
      }
      shown = stack;
      renderMeters();
      light();
      tipFor();
    };

    const playDeal = async (e: GameEvent) => {
      const cards = e.cards as Card[];
      hand = cards.slice();
      coins = Number(e.coins);
      denom = Number(e.denom);
      round = Number(e.round);
      held = [false, false, false, false, false];
      win = 0;
      // The coins go in first: the credit meter drops by the bet before the cards come out.
      shown -= Number(e.bet);
      screen.setCoins(coins);
      screen.setRow(null);
      screen.setStatus('');
      renderMeters();
      for (let i = 0; i < 5; i++) {
        screen.setHeld(i, false);
        screen.setCard(i, null);
      }
      await wait(110);
      for (let i = 0; i < 5; i++) {
        sounds.card(i);
        await screen.flipIn(i, cards[i]!, 110);
        await wait(30);
      }
      const made = Number(e.made);
      if (made >= JACKS_OR_BETTER) {
        screen.setRow(made, 'made');
        screen.setStatus(GLASS_NAMES[made]!, 'dim');
      }
      phase = 'dealt';
      busy = false;
      light();
    };

    const playDraw = async (e: GameEvent) => {
      const hold = e.hold as boolean[];
      const cards = e.cards as Card[];
      screen.setHoldable(false);
      for (let i = 0; i < 5; i++) if (!hold[i]) screen.setCard(i, null);
      await wait(150);
      for (let i = 0; i < 5; i++) {
        if (hold[i]) continue;
        sounds.card(i);
        await screen.flipIn(i, cards[i]!, 110);
        await wait(30);
      }
    };

    const playResult = async (e: GameEvent) => {
      const rank = Number(e.rank);
      const credits = Number(e.credits);
      const payout = Number(e.payout);
      const bet = Number(e.coins) * Number(e.denom);
      phase = 'over';
      for (let i = 0; i < 5; i++) screen.setHeld(i, false);
      if (credits === 0) {
        screen.setRow(null);
        screen.setStatus('GAME OVER', 'over');
        return;
      }
      // Jacks or better only hands the bet back: shown and credited, never celebrated.
      const winning = payout > bet;
      // A full house and better flash the hand's name too, and get the table's celebration:
      // big for four of a kind or a full house, huge (chips on the deck) for a straight flush or royal.
      const moment = winning && rank >= FULL_HOUSE;
      screen.setRow(rank, winning ? 'win' : 'paid');
      screen.setStatus(GLASS_NAMES[rank]!, moment ? 'win' : 'hand');
      if (moment) {
        celebrate(
          { stage: ctx.stage, ui: ctx.ui, sfx: ctx.sfx },
          { title: BANNER[rank]!, sub: `${credits.toLocaleString('en-US')} credits · ${formatMoney(payout)}`, tier: rank >= STRAIGHT_FLUSH ? 'huge' : 'big', at: DECK_POINT.clone() },
        );
      }
      if (winning) sounds.win(rank >= FOUR_OF_A_KIND);
      const from = shown;
      const unit = Number(e.denom);
      let lastStep = -1;
      rolling = true;
      await tween(
        rollupMs(rank, credits, winning),
        (k) => {
          const c = Math.round(credits * k);
          win = c;
          shown = from + c * unit;
          renderMeters();
          const step = Math.floor(k * 40);
          if (winning && step !== lastStep && c < credits) {
            lastStep = step;
            sounds.tick(k);
          }
        },
        ease.linear,
      );
      rolling = false;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.target !== canvas) return;
      const hit = ctx.stage.pickObjects(e, pickable);
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && !o.name.startsWith('vp-btn-')) o = o.parent;
      if (!o) return;
      const id = o.name.slice(7) as ButtonId;
      if (id === 'deal') dealOrDraw();
      else if (id === 'betone') betOne(1);
      else if (id === 'betmax') betMax();
      else if (id === 'pays') {
        press('pays');
        screen.toggleHelp();
      } else toggleHold(Number(id.slice(4)));
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.target !== canvas) return;
      canvas.style.cursor = ctx.stage.pickObjects(e, pickable) ? 'pointer' : '';
    };
    addEventListener('pointerdown', onPointerDown);
    addEventListener('pointermove', onPointerMove);

    ctx.kit.say('Jacks or Better 9/6 · Space deals and draws · 1-5 hold · ↑ bets one · B bets max', 4200);

    return {
      onTable(snap) {
        stack = snap.you.stack;
        busy = false;
        animating = false;
        redraw(snap.view as VideoPokerView);
      },

      async onEvents(events, v) {
        const next = v as VideoPokerView;
        animating = true;
        try {
          for (const e of events) {
            if (e.type === 'deal') await playDeal(e);
            else if (e.type === 'draw') await playDraw(e);
            else if (e.type === 'result') await playResult(e);
          }
        } finally {
          animating = false;
          rolling = false;
          busy = false;
          phase = next.phase;
          round = next.round;
          for (let i = 0; i < 5; i++) screen.setCard(i, (next.hand[i] as Card | undefined) ?? null);
          hand = next.hand.slice();
          shown = stack;
          renderMeters();
          light();
          tipFor();
        }
        if (dealAfterRollup) {
          dealAfterRollup = false;
          dealOrDraw();
        }
      },

      onSeat(msg) {
        stack = msg.stack;
        if (!animating) {
          shown = stack;
          renderMeters();
        }
      },

      onError() {
        busy = false;
        dealAfterRollup = false;
        sounds.refuse();
        light();
        tipFor();
      },

      keydown(e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        if (e.code === 'Space') {
          if (!e.repeat) dealOrDraw();
          return true;
        }
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= 5) {
          toggleHold(n - 1);
          return phase === 'dealt';
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          betOne(e.key === 'ArrowUp' ? 1 : -1);
          return true;
        }
        const k = e.key.toLowerCase();
        if (k === 'b' || k === 'a') betMax();
        else if (k === 'd') nextDenom();
        else if (k === 'h') {
          press('pays');
          screen.toggleHelp();
        } else return false;
        return true;
      },

      update() {
        const camera = ctx.stage.engine.camera;
        camera.updateMatrixWorld();
        ctx.stage.root.updateWorldMatrix(true, false);
        screen.place(corners.map((c) => toScreen(c, ctx.stage.root, camera)));
      },

      dispose() {
        removeEventListener('pointerdown', onPointerDown);
        removeEventListener('pointermove', onPointerMove);
        canvas.style.cursor = '';
        offTips();
        clearTip();
        layer.remove();
        if (glassMat) {
          glassMat.map = attract;
          glassMat.color.set('#ffffff');
          glassMat.needsUpdate = true;
        }
        for (const b of buttons.values()) {
          b.lens.emissiveIntensity = 0.25;
          b.group.position.y = b.y;
        }
      },
    };
  },
};
