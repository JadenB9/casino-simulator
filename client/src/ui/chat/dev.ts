// Dev page for the chat, served by Vite in development only:
//   /casino/src/ui/chat/dev.html?state=<open|quiet|unread|table|typing|muted|hidden>
// No server: a stand-in floor socket hands your lines back as the server would, and two stand-in
// players by a dev room's table talk on a script. It is also a worked example of the wiring
// app/boot.ts needs (createChat, setVisible, setTable, tableMessage).

import type { Character } from '../../world/contract.ts';
import { Engine3D, savedQuality } from '../../render/engine3d.ts';
import { Sfx } from '../../audio/sfx.ts';
import { devRoom } from '../../world/dev-room.ts';
import { GAMES } from '../../games/index.ts';
import { CapsuleFactory } from '../../world/remote-players.ts';
import { FloorLink } from '../../net/presence.ts';
import { session } from '../../app/session.ts';
import { el } from '../kit.ts';
import { regular } from '../menu/fixtures.ts';
import { mountHud } from '../menu/index.ts';
import { cleanChat, type ChatLine, type ChatServerMsg, type PlayerInfo } from '../../../../shared/src/protocol.ts';
import type { Look } from '../../../../shared/src/look.ts';
import { createChat } from './index.ts';

const q = new URLSearchParams(location.search);
const state = q.get('state') ?? 'open';
const ui = document.getElementById('ui')!;

const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, savedQuality());
const sfx = new Sfx();
devRoom(engine, GAMES.blackjack, '');
engine.camera.position.set(0.2, 2.35, 6.4);
engine.camera.lookAt(0, 1.45, 0);

const look = (top: string, bottom: string, skin: number, hair: string, body: 'm' | 'f' = 'm'): Look => ({ v: 1, body, outfit: 'casual', skin, hair, top, bottom, shoes: '#1a1a1a' });
const profile = regular();
const cast = [
  { id: profile.id, name: profile.name, look: look('#1f2430', '#1f2430', 3, '#2b1d14'), at: [0.25, 2.3, Math.PI] as const },
  { id: 21, name: 'Lucky_Lou', look: look('#7a2430', '#2a2a30', 1, '#c9a063'), at: [-1.35, 1.2, 0.5] as const },
  { id: 22, name: 'Rosa_M', look: look('#2f5d50', '#1d1d24', 5, '#1a1310', 'f'), at: [1.45, 1.0, -0.45] as const },
];
const factory = new CapsuleFactory();
const chars = new Map<number, Character>();
for (const p of cast) {
  const ch = factory.create(p.look, p.id === profile.id ? '' : p.name);
  ch.root.position.set(p.at[0], 0, p.at[1]);
  ch.root.rotation.y = p.at[2];
  engine.scene.add(ch.root);
  chars.set(p.id, ch);
}
engine.onFrame((dt) => chars.forEach((ch) => ch.update(dt)));

// The stand-in floor socket.
let n = 0;
const line = (id: number, text: string, ago = 0): ChatLine => ({ n: ++n, id, name: cast.find((p) => p.id === id)!.name, text, at: Date.now() - ago });
const you: PlayerInfo = { id: profile.id, name: profile.name, look: cast[0]!.look, x: 0, z: 0, r: 0, at: null };
const backlog: ChatLine[] = [
  line(21, 'evening all', 300_000),
  line(22, 'is the roulette wheel in the pit American or European?', 240_000),
  line(21, 'both, the one by the Big Six is single zero', 230_000),
  line(profile.id, 'thanks, heading there after this shoe', 200_000),
  line(22, 'nice hand earlier Lou', 90_000),
];
let feed: (m: unknown) => void = () => {};
const link = new FloorLink({
  open: (onMessage, onState) => {
    feed = onMessage;
    queueMicrotask(() => {
      onState('open');
      feed({ t: 'hello', v: 1, you, players: [], online: 3, now: Date.now() });
      if (state !== 'quiet') feed({ t: 'chat', lines: backlog, backlog: true } satisfies ChatServerMsg);
    });
    return {
      send: (m) => {
        const msg = m as { t?: string; text?: string };
        const text = msg.t === 'say' ? cleanChat(msg.text ?? '') : null;
        if (text) setTimeout(() => feed({ t: 'chat', lines: [line(profile.id, text)] } satisfies ChatServerMsg), 80);
        return true;
      },
      close: () => {},
    };
  },
});
const say = (id: number, text: string) => feed({ t: 'chat', lines: [line(id, text)] } satisfies ChatServerMsg);

async function start(): Promise<void> {
  session.set(profile);
  const hud = mountHud({ root: ui, session, sfx, onMenu: () => {} });
  hud.setOnline(3);
  const chat = createChat({ root: ui, floor: link, character: (id) => chars.get(id), onFrame: (fn) => engine.onFrame(fn), camera: engine.camera });
  chat.setVisible(true);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const open = () => document.querySelector<HTMLButtonElement>('.chat-dock')?.click();
  await wait(300);
  switch (state) {
    case 'open':
      open();
      say(21, 'anyone want to split a shoe at bj-1?');
      await wait(400);
      say(22, 'sure, give me a minute to cash out');
      break;
    case 'unread':
      say(21, 'anyone want to split a shoe at bj-1?');
      await wait(700);
      say(22, 'sure, give me a minute to cash out');
      await wait(700);
      say(21, 'I will open a private lobby');
      break;
    case 'table': {
      let t = 0;
      const table = (id: number, text: string, ago = 0): ChatLine => ({ n: ++t, id, name: cast.find((p) => p.id === id)!.name, text, at: Date.now() - ago });
      chat.setTable({
        say: (text) => {
          setTimeout(() => chat.tableMessage({ t: 'chat', lines: [table(profile.id, text)] }), 80);
          return true;
        },
      });
      chat.tableMessage({ t: 'chat', lines: [table(21, 'good luck all', 30_000), table(22, 'dealer is showing a six, stand on anything', 12_000)], backlog: true });
      open();
      await wait(300);
      say(21, 'meanwhile on the floor: who is at the craps table?');
      break;
    }
    case 'typing': {
      open();
      chat.focus();
      const input = document.querySelector<HTMLInputElement>('.chat-input')!;
      input.value = 'Split the aces or not? I never know with a dealer showing';
      input.dispatchEvent(new Event('input'));
      break;
    }
    case 'muted':
      open();
      feed({ t: 'chat.no', code: 'MUTED', msg: 'Muted for a minute: too many lines too fast.', until: Date.now() + 52_000, now: Date.now() } satisfies ChatServerMsg);
      break;
    case 'hidden':
      open();
      chat.panel.setMuted(true);
      say(21, 'hello? anyone?');
      break;
  }
  (window as unknown as { dev: unknown }).dev = { engine, chat, say, feed: (m: unknown) => feed(m) };
}

start().catch((err) => {
  console.error(err);
  ui.append(el('p', 'dev-error', String(err?.message ?? err)));
});
