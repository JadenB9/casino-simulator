// Dev page for the lobby panels (vite dev only; it isn't part of the build):
//   /casino/src/ui/lobby/dev.html?name=<name>&game=<id>[&variant=<v>]
// Logs in as <name>, stands in front of a table in the dev room and runs the real flow against the
// local worker: the choice, the live list over a floor socket, Create, Join with a PIN, then the
// party panel fed by the table socket. scripts/e2e/lobby.mjs drives it with two browsers.
//   ?screen=invites   no server: two invite cards from a stand-in floor (one about to run out), and
//                     a private table's party panel with the people you've played with to invite
//   ?scene=0          a still backdrop instead of the 3D room

import { Engine3D, savedQuality } from '../../render/engine3d.ts';
import { devRoom } from '../../world/dev-room.ts';
import { GAMES } from '../../games/index.ts';
import { session } from '../../app/session.ts';
import { DEV_PASSWORD, login, socketUrl } from '../../net/api.ts';
import { Socket } from '../../net/socket.ts';
import { CATALOG, isGameId, variantOf } from '../../../../shared/src/games/catalog.ts';
import type { FloorServerMsg, TableClientMsg } from '../../../../shared/src/protocol.ts';
import type { TableSnapshot } from '../../games/contract.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { limitsLabel } from '../../../../shared/src/limits.ts';
import { askBuyIn, el, toast } from '../kit.ts';
import { InviteHub, PartyPanel, buyInPanel, openTableFlow, type InviteFloor, type LobbyFloor } from './index.ts';
import { regular } from '../menu/fixtures.ts';
import { ENGINES } from '../../../../shared/src/games/index.ts';
import type { FloorServerMsg as FloorMsg, Invite } from '../../../../shared/src/protocol.ts';
import { sceneWanted, stillBackdrop } from '../social/dev-backdrop.ts';

const params = new URLSearchParams(location.search);
const asked = params.get('game');
const game = isGameId(asked) ? asked : 'blackjack';
const variant = variantOf(game, params.get('variant'));
const ui = document.getElementById('ui')!;
/** For the headless check: what this page is connected to (and the engine, to pause for a still). */
const dev: { floor?: LobbyFloor; tableId?: string | null; engine?: Engine3D } = {};

async function main(): Promise<void> {
  // The room and the table, seen from where a player stands after walking up to it.
  // (?scene=0: a still backdrop instead, for quick screenshots)
  (window as unknown as { lobbyDev: unknown }).lobbyDev = dev;
  if (sceneWanted()) {
    const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, savedQuality());
    devRoom(engine, GAMES[game], variant);
    dev.engine = engine;
    engine.camera.position.set(0.95, 1.75, 2.5);
    engine.camera.lookAt(0.95, 0.45, 0);
  } else stillBackdrop(document.getElementById('scene') as HTMLCanvasElement);

  session.set(await login(params.get('name') ?? `dev_${Math.random().toString(36).slice(2, 8)}`, DEV_PASSWORD));
  const hud = el('div', 'panel');
  hud.style.cssText = 'position:fixed;top:12px;left:12px;padding:8px 12px;font-size:16px';
  const renderHud = () => (hud.textContent = `${session.profile?.name} · ${formatMoney(session.profile?.balance ?? 0)}`);
  session.on(renderHud);
  renderHud();
  ui.append(hud);

  // The floor socket and the two-method view of it the lobby wants.
  const listeners = new Set<(m: FloorServerMsg) => void>();
  const floorSocket = new Socket({ url: () => socketUrl('floor'), onMessage: (m) => listeners.forEach((fn) => fn(m)) });
  const floor: LobbyFloor = {
    send: (m) => floorSocket.send(m),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  (window as unknown as { lobbyDev: unknown }).lobbyDev = dev;
  dev.floor = floor;
  await approach(floor);
}

/** The "Press E" moment, then the flow. */
async function approach(floor: LobbyFloor): Promise<void> {
  const choice = await openTableFlow({ game, variant, floor });
  if (!choice) return pressE(floor);
  if (choice.kind === 'solo') {
    const at = choice.limits ? ` at ${limitsLabel(game, choice.limits)}` : '';
    toast(`The solo table opens here in the game${at}.`);
    return pressE(floor);
  }
  sit(choice.tableId!, floor, choice.pin);
}

function pressE(floor: LobbyFloor): void {
  const prompt = el('div', 'panel');
  prompt.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);padding:8px 14px;font-size:16px;letter-spacing:0.06em';
  prompt.append(el('span', 'lb-key', 'E'), document.createTextNode(`  ${CATALOG[game].name}`));
  ui.append(prompt);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'e' && e.key !== 'E') return;
    removeEventListener('keydown', onKey);
    prompt.remove();
    void approach(floor);
  };
  addEventListener('keydown', onKey);
}

/** At a lobby table: a table socket feeding the party panel. A private table wants its PIN from everyone, its creator too. */
function sit(tableId: string, floor: LobbyFloor, pin?: string): void {
  dev.tableId = tableId;
  let snap: TableSnapshot | null = null;
  let aid = 0;
  let party: PartyPanel | null = null;
  const socket = new Socket({
    url: () => socketUrl(`table/${tableId}`, pin ? { pin } : {}),
    onMessage: (m) => {
      if (m.t === 'table') {
        snap = m;
        party?.onTable(m);
      } else if (m.t === 'members') party?.onMembers(m);
      else if (m.t === 'balance') session.balance(m.balance, m.inPlay, m.rev);
      else if (m.t === 'err') {
        toast(m.msg, 'err');
        party?.onError();
      }
    },
    onState: (s, code) => {
      if (s !== 'closed') return;
      if (code) toast(code === 4005 ? 'That table is full.' : code === 4004 ? 'That table has closed.' : `Table closed (${code}).`, 'err');
      party?.dispose();
      party = null;
      dev.tableId = null;
      pressE(floor);
    },
  });
  const send = (msg: TableClientMsg) => {
    if (!socket.send(msg)) toast('Not connected to the table yet.', 'err');
  };
  party = new PartyPanel({
    me: session.profile!.id,
    game,
    send,
    leave: () => {
      send({ t: 'leave' });
      setTimeout(() => socket.close(), 150);
    },
    sit: async () => {
      if (!snap || !session.profile) return;
      const amount = await askBuyIn({ min: snap.meta.config.buyIn.min, max: snap.meta.config.buyIn.max, balance: session.profile.balance });
      if (amount) send({ t: 'buyin', aid: `dev${Date.now().toString(36)}${aid++}`, amount });
    },
  });
}

/** ?screen=invites: the invite cards and a party panel's quick invites, with no server. */
function invitesScreen(): void {
  const me = regular();
  session.set(me);
  // people you've played with, two of them on the floor now
  const now = Date.now();
  try {
    localStorage.setItem('casino.invites.recent', JSON.stringify([
      { id: 21, name: 'Lucky_Lou', at: now - 2 * 3_600_000 },
      { id: 22, name: 'Rosa_M', at: now - 3 * 86_400_000 },
      { id: 29, name: 'gone_home', at: now - 3_600_000 },
    ]));
  } catch {
    /* blocked: no quick invites to show */
  }
  const listeners = new Set<(m: FloorMsg) => void>();
  const player = (id: number, name: string, x: number) => [id, { info: { id, name, at: null }, last: { x, z: 0 } }] as const;
  const floor: InviteFloor = {
    send: (m) => {
      toast(`(sent ${m.t})`);
      return true;
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    players: new Map([player(me.id, me.name, 0), player(21, 'Lucky_Lou', 300), player(22, 'Rosa_M', -900), player(23, 'snake_eyes', 1500)]),
    you: { id: me.id },
  };
  const hub = new InviteHub({
    floor,
    root: ui,
    stations: [],
    collider: { resolve: () => {} },
    where: () => ({ x: 0, z: 0 }),
    onFloor: () => true,
    covered: () => false,
    atTable: () => null,
    standUp: async () => {},
    hold: () => {},
    sitAt: () => {},
  });
  const bj = ENGINES.blackjack.config('', 'multi');
  const invite = (id: string, over: Partial<Invite>): Invite => ({
    id,
    from: { id: 21, name: 'Lucky_Lou' },
    tableId: `bj-${id.slice(0, 10)}`,
    game: 'blackjack',
    variant: '',
    private: false,
    all: false,
    lobby: { tableId: `bj-${id.slice(0, 10)}`, game: 'blackjack', variant: '', leader: 'Lucky_Lou', players: 3, max: 7, started: false, limits: { min: 50_000, max: 5_000_000 } },
    station: null,
    at: now,
    until: now + 110_000,
    ...over,
  });
  for (const fn of listeners) fn({ t: 'invited', invite: invite('aaaaaaaaaaaa', {}) });
  for (const fn of listeners) {
    fn({
      t: 'invited',
      invite: invite('bbbbbbbbbbbb', {
        from: { id: 22, name: 'Rosa_M' },
        game: 'baccarat',
        tableId: 'bc-bbbbbbbbbb',
        private: true,
        all: true,
        lobby: { tableId: 'bc-bbbbbbbbbb', game: 'baccarat', variant: '', leader: 'Rosa_M', players: 5, max: 7, started: true },
        at: now - 100_000,
        until: now + 12_000,
      }),
    });
  }
  const party = new PartyPanel({
    me: me.id,
    game: 'blackjack',
    send: () => {},
    leave: () => toast('(leave)'),
    sit: () => void buyInPanel({ min: bj.buyIn.min, max: bj.buyIn.max, balance: me.balance }),
    root: ui,
    invites: hub,
  });
  party.onTable({
    t: 'table',
    v: 1,
    meta: { tableId: 'bj-devtable01', game: 'blackjack', variant: '', mode: 'multi', visibility: 'private', pin: '4827', started: false, config: bj },
    members: [{ accountId: me.id, name: me.name, look: me.look, seat: null, joinedAt: now, connected: true, ready: false, status: 'watching', stack: 0 }],
    leader: me.id,
    you: { accountId: me.id, seat: null, status: 'watching', stack: 0 },
    view: null,
    seq: 0,
    now,
  });
}

if (params.get('screen') === 'invites') {
  // (no room to stand in: the still backdrop)
  stillBackdrop(document.getElementById('scene') as HTMLCanvasElement);
  invitesScreen();
} else main().catch((err) => {
  console.error(err);
  toast(`The lobby page failed: ${String(err)}`, 'err', 10_000);
});
