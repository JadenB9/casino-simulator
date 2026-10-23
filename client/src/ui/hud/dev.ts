// Dev page for the shell, served by Vite in development only, no worker and no 3D:
//   /casino/src/ui/hud/dev.html?open=<more|palette|settings|keys|notes|online>
// The HUD with every tool boot.ts gives it (the map's button the old way, as the world puts it
// in), canned money, toasts and big wins, over a painted stand-in for the floor. Options:
// seated=1 (chips at a table, a dealer's line and Leave on a touch screen), touch=1 (html.touch-ui),
// toasts=<n> (that many notes, half a second apart), wins=1 (big wins too), section=<id> (Settings
// at a section), q=<text> (the palette with it typed), online=<n>, bg=<image url>, daily=0
// (today's bonus taken), dock=0 (no screen links, for screenshots). window.dev has the handles.

import './dev.css';
import { session } from '../../app/session.ts';
import { Sfx } from '../../audio/sfx.ts';
import { el, toast, UiKit } from '../kit.ts';
import { regular } from '../menu/fixtures.ts';
import { mountHud } from './hud.ts';
import { socialButton } from '../social/hud.ts';
import { shopButton } from '../shop/icons.ts';
import { mountDaily } from '../daily/daily.ts';
import { WinToasts } from '../feed/toast.ts';
import { icon } from '../menu/icons.ts';
import type { SettingsSection } from './settings.ts';
import type { DailyStatus } from '../../../../shared/src/celebs.ts';

const q = new URLSearchParams(location.search);
const ui = document.getElementById('ui')!;
if (q.get('touch') === '1') document.documentElement.classList.add('touch-ui');
const bg = q.get('bg');
if (bg) {
  document.body.classList.add('bg-image');
  document.body.style.backgroundImage = `url("${bg}")`;
} else document.body.prepend(el('div', 'dev-table'));

const sfx = new Sfx();
void sfx.load().catch(() => {});
session.set({ ...regular(), name: q.get('name') ?? 'Ace_High' });

const hud = mountHud({ root: ui, session, sfx, onProfile: () => toast('The profile would open here'), onMenu: () => toast('Back to the main menu'), onOnline: () => toast('The list of who is online') });
hud.setOnline(q.has('online') ? Number(q.get('online')) : 23);

// the tools boot.ts adds, the same way
hud.addTool({ id: 'emotes', button: socialButton('emotes', 'Emotes (G)', () => toast('The emote wheel')), label: 'Emotes', group: 'play', order: 20, key: 'emotes', primary: true, rank: 1, keywords: 'wave dance' });
hud.addTool({ id: 'boards', button: socialButton('leaderboard', 'Leaderboards', () => toast('The leaderboards')), label: 'Leaderboards', group: 'social', order: 20 });
hud.addTool({ id: 'boutique', button: shopButton('boutique', 'Boutique', () => toast('The boutique')), label: 'Boutique', group: 'shop', order: 10 });
hud.addTool({ id: 'effects', button: shopButton('effects', 'Effects', () => toast('The effects')), label: 'Effects', group: 'shop', order: 20 });
hud.addTool({ id: 'bar', button: shopButton('bar', 'Bar', () => toast('The bar menu')), label: 'Bar', group: 'shop', order: 30 });
const day: DailyStatus = { day: '2026-10-23', streak: 2, claimed: q.get('daily') === '0', next: 3, amount: 750_000, amounts: [250_000, 500_000, 750_000, 1_000_000, 1_500_000, 2_500_000, 5_000_000], resetAt: Date.now() + 5 * 3_600_000, met: {} };
const slot = el('div');
mountDaily({ root: ui, bar: slot, api: { status: async () => day, claim: async () => ({ ok: true, ...day, claimed: true, paid: day.amount, balance: 0, inPlay: 0, rev: 0 }) as never }, money: () => {} });
const gift = slot.querySelector<HTMLButtonElement>('.daily-btn');
if (gift) hud.addTool({ id: 'daily', button: gift, label: 'Daily bonus', group: 'shop', order: 40 });
// the achievements' cup, as feats/index.ts builds it
const cup = el('button', 'hud-btn');
cup.type = 'button';
cup.title = 'Achievements (J)';
cup.setAttribute('aria-label', 'Achievements (J)');
cup.append(icon('bulb'));
cup.addEventListener('click', () => toast('The achievements'));
hud.addTool({ id: 'feats', button: cup, label: 'Achievements', group: 'play', order: 30, key: 'feats' });
// the map's button, put straight into the bar as world/wayfinding.ts does (adopted by the HUD)
const map = el('button', 'hud-btn map-btn');
map.type = 'button';
map.title = 'Map (M)';
map.setAttribute('aria-label', 'Map of the casino (M)');
map.append(icon('search'));
map.addEventListener('click', () => toast('The map'));
setTimeout(() => {
  const bar = document.querySelector('.hud .hud-right')!;
  bar.insertBefore(map, bar.querySelector('.hud-btn'));
}, 300);
hud.addCommands(() => [
  { id: 'room:pit', label: 'The Pit', hint: 'Blackjack, Roulette, Craps, Baccarat', group: 'Room', icon: () => icon('pin'), keywords: 'blackjack roulette craps', run: () => toast('The directory at the Pit') },
  { id: 'room:bingo', label: 'Bingo Hall', hint: 'Bingo', group: 'Room', icon: () => icon('pin'), run: () => toast('The directory at the Bingo Hall') },
  { id: 'game:Blackjack', label: 'Classic Blackjack', hint: 'In the Pit', group: 'Game', icon: () => icon('chip'), keywords: 'blackjack', run: () => toast('The directory at the Pit') },
]);

// at a table: the chips, the dealer's line, and (touch) the Leave button touch.ts puts first in the bar
const kit = new UiKit(ui);
if (q.get('seated') === '1') {
  hud.setTableChips(125_000, 100_000);
  kit.say('Place your bets', 60_000);
  if (q.get('touch') === '1') {
    const leave = el('button', 'touch-leave');
    leave.type = 'button';
    leave.append(el('span', 'touch-leave-label', 'Leave'));
    document.querySelector('.hud .hud-right')!.prepend(leave);
  }
}

const n = Number(q.get('toasts') ?? 0);
const lines = ['Your chips are back in your balance.', 'Choose between $5 and $500.', "Your Ferrari is at the curb. The valet hands you the keys.", 'Lost the table.'];
for (let i = 0; i < n; i++) setTimeout(() => toast(lines[i % lines.length]!, i === 1 ? 'err' : 'info', 30_000), 400 + i * 500);
if (q.get('wins') === '1') {
  const wins = new WinToasts(ui);
  setTimeout(() => wins.show({ name: 'mara_v', game: 'roulette', amount: 350_000, what: 'Straight 17', at: Date.now() }), 600);
}

const open = q.get('open');
setTimeout(() => {
  if (open === 'more') hud.toggleMore();
  else if (open === 'palette') hud.openPalette(q.get('q') ?? undefined);
  else if (open === 'settings') hud.openSettings((q.get('section') as SettingsSection | null) ?? undefined);
  else if (open === 'keys') hud.toggleShortcuts();
  else if (open === 'notes') (document.querySelector('.hud [data-tool="notes"]') as HTMLButtonElement | null)?.click();
  document.body.dataset.ready = '1';
}, 700);

if (q.get('dock') !== '0') {
  const dock = el('nav', 'dev-dock');
  for (const s of ['hud', 'more', 'palette', 'settings', 'keys', 'notes']) {
    const a = el('a', (open ?? 'hud') === s ? 'on' : '', s);
    const p = new URLSearchParams(q);
    if (s === 'hud') p.delete('open');
    else p.set('open', s);
    a.href = `?${p}`;
    dock.append(a);
  }
  ui.append(dock);
}

(window as unknown as { dev: unknown }).dev = { hud, sfx, session, kit, toast };
