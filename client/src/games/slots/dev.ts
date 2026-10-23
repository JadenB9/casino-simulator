// Dev page for the slot machines' controls, served by Vite in development only:
//   /casino/src/games/slots/dev.html?machine=<id>&show=<pays|auto|session|count|hand|banner>&coins=<n>&coin=<i>&theme=<light|dark>
// The real deck, Pays sheet, session readout, count-up and feature banner (deck.ts, pays.ts,
// paysheet.ts) over a stand-in for the cabinet, with no 3D and no server, so they can be checked
// at any window size and in both themes in a few seconds. `coin` is the index of the coin value;
// &spins=<n> fills the session with that many made-up spins; &seated=0 shows the deck before money
// goes in. Space "spins" (the deck goes busy for the reels' time), I opens Pays, Esc closes.

import { formatCompact } from '../../../../shared/src/money.ts';
import { LINEUP, isSlotId, type SlotId } from '../../../../shared/src/games/slots/lineup.ts';
import { isMachineId } from '../../../../shared/src/games/slots/machines.ts';
import { mountDeck, Banner, CountUp, SessionLog, SessionPanel } from './deck.ts';
import { openPays, type PaysSheet } from './pays.ts';
import { openPaysheet } from './paysheet.ts';
import { isSkinned } from './play.ts';
import './diamonds.ts';
import './cherries.ts';
import './goldrush.ts';
import './pigs.ts';
import './slots.css';
import './slots2.css';

const q = new URLSearchParams(location.search);
const theme = q.get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
if (theme === 'dark') delete document.documentElement.dataset.theme;

const id: SlotId = isSlotId(q.get('machine')) ? (q.get('machine') as SlotId) : 'sevens';
const m = LINEUP[id];
const stepper = m.kind === 'stepper';
const ui = document.getElementById('ui')!;
const canvas = document.getElementById('scene') as HTMLCanvasElement;

// a stand-in for the cabinet: the machine's own dark glass in the middle of the screen
const g = canvas.getContext('2d')!;
const paint = () => {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  const grad = g.createLinearGradient(0, 0, 0, innerHeight);
  grad.addColorStop(0, '#120c0a');
  grad.addColorStop(0.55, '#2a0d0e');
  grad.addColorStop(1, '#4a0b10');
  g.fillStyle = grad;
  g.fillRect(0, 0, innerWidth, innerHeight);
  const w = Math.min(innerWidth * 0.62, innerHeight * 0.5);
  const x = (innerWidth - w) / 2;
  g.fillStyle = '#6e0d14';
  g.fillRect(x, innerHeight * 0.06, w, innerHeight * 0.9);
  g.fillStyle = '#f3ecdb';
  g.fillRect(x + w * 0.08, innerHeight * 0.5, w * 0.84, innerHeight * 0.18);
  g.fillStyle = '#120d0c';
  g.fillRect(x + w * 0.08, innerHeight * 0.7, w * 0.84, innerHeight * 0.06);
};
paint();
addEventListener('resize', paint);

let coins = Math.max(1, Math.min(m.maxCoins, Number(q.get('coins') ?? 1) || 1));
let denomIdx = Math.max(0, Math.min(m.denoms.length - 1, Number(q.get('coin') ?? 0) || 0));
const seated = q.get('seated') !== '0';
let busy = false;
const betOf = () => m.lines * coins * m.denoms[denomIdx]!;

let pays: PaysSheet | null = null;
const togglePays = () => {
  if (pays) {
    pays.close();
    pays = null;
    return;
  }
  const bet = { coins, denom: m.denoms[denomIdx]! };
  pays = isSkinned(id) ? openPaysheet(ui, deck.root, id, bet, () => (pays = null)) : openPays(ui, deck.root, isMachineId(id) ? id : 'sevens', bet, () => (pays = null));
};

const refresh = () => {
  deck.showBet(coins, formatCompact(m.denoms[denomIdx]!), betOf());
  deck.spinBtn.disabled = busy || !seated;
  deck.downBtn.disabled = busy || coins <= 1;
  deck.upBtn.disabled = busy || coins >= m.maxCoins;
  deck.maxBtn.disabled = busy || coins >= m.maxCoins;
  deck.coinBtn.disabled = busy;
  deck.insertBtn.classList.toggle('attn', !seated);
  deck.auto.refresh();
  pays?.bet({ coins, denom: m.denoms[denomIdx]! });
};

const deck = mountDeck({
  ui,
  canvas,
  stepper,
  lines: m.lines,
  insert: () => {},
  pays: togglePays,
  nextCoin: () => {
    denomIdx = (denomIdx + 1) % m.denoms.length;
    refresh();
  },
  step: (dir) => {
    coins = Math.max(1, Math.min(m.maxCoins, coins + dir));
    refresh();
  },
  max: () => {
    coins = m.maxCoins;
    refresh();
  },
  session: () => panel.toggle(),
  spin: () => {
    if (busy) return false;
    busy = true;
    refresh();
    setTimeout(() => {
      busy = false;
      const bet = betOf();
      log.add(bet, Math.random() < 0.25 ? bet * (1 + Math.floor(Math.random() * 12)) : 0);
      panel.refresh();
      refresh();
      deck.auto.driver.settled({ bet, win: 0, credit: 100_000, feature: false, jackpot: false });
    }, 2500);
    return true;
  },
  bet: betOf,
  seated: () => seated,
  say: () => {},
  changed: () => refresh(),
});

const log = new SessionLog();
for (let i = 0; i < Number(q.get('spins') ?? 0); i++) log.add(betOf(), i % 5 === 2 ? betOf() * (i % 3 ? 3 : 17) : 0);
const panel = new SessionPanel(ui, log, deck);
const banner = new Banner(ui, `slots-banner feature${isSkinned(id) ? ` skin-${id}` : ''}`);
const countup = new CountUp(ui, `slots-countup ${stepper ? 'stepper' : 'video'}${isSkinned(id) ? ` skin-${id}` : ''}`);
refresh();

const show = q.get('show');
if (show === 'pays') togglePays();
if (show === 'auto') deck.auto.autoBtn.click();
if (show === 'session') panel.toggle();
if (show === 'banner') banner.show('Free games', '3 scatters · 10 games, wins x3');
if (show === 'count' || show === 'hand') {
  countup.show(show === 'hand' ? 'Hand pay' : 'Win', betOf() * 41, betOf());
  countup.skippable(true);
}

addEventListener('keydown', (e) => {
  if (deck.auto.keydown(e)) return;
  if (e.code === 'Space') {
    e.preventDefault();
    deck.auto.driver.hold(true);
  } else if (e.key === 'i' || e.key === 'I') togglePays();
  else if (e.key === 'Escape') panel.close();
});
setInterval(() => panel.tick(), 1000);
(window as unknown as { slotsDev: unknown }).slotsDev = { deck, panel, countup, banner, log };
