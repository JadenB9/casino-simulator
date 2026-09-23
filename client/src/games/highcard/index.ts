// High Card's table: the reference client. It shows the pattern every game follows: a model for
// the floor, a felt with named regions, the chip tray, bets as chip stacks, cards dealt from a
// shoe, and results pinned to the spots they belong to, all animated toward what the server
// already decided and then settled on the view it sent.

import * as THREE from 'three';
import type { GameClientModule, TableView } from '../contract.ts';
import type { HighCardView } from '../../../../shared/src/games/highcard/engine.ts';
import type { GameEvent } from '../../../../shared/src/engine.ts';
import type { Card } from '../../../../shared/src/cards.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { Felt } from '../../table/felt.ts';
import { CardMesh, dealCard, CARD_W } from '../../table/cards.ts';
import { ChipStack } from '../../table/chips.ts';
import { ChipTray } from '../../ui/kit.ts';
import { wait } from '../../table/tween.ts';

const TOP_Y = 0.76;
const SHOE = new THREE.Vector3(0.55, TOP_Y + 0.02, -0.35);
const DEALER = new THREE.Vector3(0, TOP_Y + 0.001, -0.22);
const PLAYER = new THREE.Vector3(0, TOP_Y + 0.001, 0.18);
const BET = new THREE.Vector3(0, TOP_Y, 0.38);

function tableModel(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#3a2415', roughness: 0.6 });
  const rail = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.045, 12, 64), new THREE.MeshStandardMaterial({ color: '#2b1a12', roughness: 0.5 }));
  rail.rotation.x = Math.PI / 2;
  rail.position.y = TOP_Y + 0.02;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.7, 0.1, 48), wood);
  body.position.y = TOP_Y - 0.05;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.22, TOP_Y - 0.1, 16), wood);
  leg.position.y = (TOP_Y - 0.1) / 2;
  g.add(body, rail, leg);
  return g;
}

function felt(): Felt {
  return new Felt({
    width: 1.4,
    depth: 1.4,
    color: '#1d5c3b',
    paint(g, px) {
      g.strokeStyle = 'rgba(241,213,154,0.75)';
      g.fillStyle = 'rgba(241,213,154,0.85)';
      g.lineWidth = px(0.004);
      g.beginPath();
      g.arc(0, px(BET.z), px(0.07), 0, Math.PI * 2);
      g.stroke();
      g.textAlign = 'center';
      g.font = `600 ${px(0.035)}px Cinzel, serif`;
      g.fillText('HIGH CARD PAYS 1 TO 1', 0, px(-0.02));
      g.font = `${px(0.022)}px Cinzel, serif`;
      g.fillText('TIES PUSH', 0, px(0.02));
    },
    regions: [{ id: 'bet', shape: { kind: 'circle', x: 0, z: BET.z, r: 0.08 } }],
  });
}

export const highcard: GameClientModule = {
  game: 'highcard',
  footprint: { width: 1.6, depth: 1.6 },
  createModel: () => tableModel(),
  seats: () => [{ position: [0, 0, 0.95], yaw: Math.PI }],
  playPose: () => ({ position: [0, 1.32, 0.98], target: [0, TOP_Y, -0.02] }),

  mount(ctx): TableView {
    const f = felt();
    ctx.stage.addFelt(f, TOP_Y + 0.0005);
    const bet = new ChipStack();
    bet.position.copy(BET);
    ctx.stage.root.add(bet);
    let cards: CardMesh[] = [];
    let view: HighCardView | null = null;
    let lastBet = 0;
    let stack = 0;

    const tray = new ChipTray({
      clear: () => ctx.link.act({ type: 'clear' }),
      rebet: () => lastBet && ctx.link.act({ type: 'bet', amount: lastBet }),
      primary: { label: 'Deal', run: () => ctx.link.act({ type: 'deal' }) },
    });
    ctx.ui.append(tray.root);

    const onClick = (e: PointerEvent) => {
      const hit = ctx.stage.pick(e);
      if (hit?.region === 'bet') {
        ctx.link.act({ type: 'bet', amount: tray.selected.value });
        ctx.sfx.play('chip-lay');
      }
    };
    addEventListener('pointerdown', onClick);

    const clearCards = () => {
      for (const c of cards) c.removeFromParent();
      cards = [];
    };

    const place = (target: 'dealer' | 'player', card: Card | null) => {
      const m = new CardMesh(card);
      m.position.copy(target === 'dealer' ? DEALER : PLAYER);
      if (card) m.rotation.x = 0;
      ctx.stage.root.add(m);
      cards.push(m);
      return m;
    };

    const draw = (v: HighCardView) => {
      view = v;
      bet.set(v.bets[0] ?? 0);
      clearCards();
      if (v.cards[0]) place('player', v.cards[0]);
      if (v.dealer) place('dealer', v.dealer);
      tray.setPrimary('Deal', v.phase === 'betting' && !!v.bets[0]);
    };

    return {
      onTable(snap) {
        stack = snap.you.stack;
        draw(snap.view as HighCardView);
      },
      async onEvents(events: GameEvent[], v) {
        const next = v as HighCardView;
        for (const e of events) {
          if (e.type === 'betting') clearCards();
          if (e.type === 'bet') bet.set(Number(e.total));
          if (e.type === 'card') {
            const target = e.target === 'dealer' ? 'dealer' : 'player';
            const m = new CardMesh(null);
            ctx.stage.root.add(m);
            cards.push(m);
            ctx.sfx.play('card-deal');
            await dealCard(m, SHOE, target === 'dealer' ? DEALER : PLAYER, { faceUp: false, ms: 280 });
            m.setCard(e.card as Card);
            await dealCard(m, m.position.clone(), m.position.clone(), { faceUp: true, ms: 200 });
          }
          if (e.type === 'result' && e.seat === 0) {
            const payout = Number(e.payout);
            const staked = next.bets[0] ?? 0;
            const text = e.outcome === 'win' ? `WIN ${formatMoney(payout - staked, { sign: true })}` : e.outcome === 'push' ? 'PUSH' : 'LOSE';
            ctx.kit.pill(ctx.stage, new THREE.Vector3(0, TOP_Y + 0.05, BET.z + 0.12), text, e.outcome as 'win' | 'lose' | 'push');
            if (e.outcome === 'win') ctx.sfx.play('chips-stack');
            lastBet = staked;
            await wait(400);
          }
        }
        draw(next);
      },
      onSeat(msg) {
        stack = msg.stack;
        tray.root.dataset.stack = String(stack);
      },
      keydown(e) {
        if (tray.key(e)) return true;
        if (e.code === 'Space') {
          ctx.link.act({ type: 'deal' });
          return true;
        }
        if (e.key === 'x' || e.key === 'X') {
          ctx.link.act({ type: 'clear' });
          return true;
        }
        if (e.key === 'r' && lastBet) {
          ctx.link.act({ type: 'bet', amount: lastBet });
          return true;
        }
        return false;
      },
      update() {},
      dispose() {
        removeEventListener('pointerdown', onClick);
        tray.root.remove();
        clearCards();
        bet.removeFromParent();
        f.mesh.removeFromParent();
        void view;
        void CARD_W;
      },
    };
  },
};
