// Dev page for floor presence, served by Vite at /casino/src/net/presence-dev.html?name=<name>.
// It logs in as <name> (the token lands in this tab's sessionStorage, so two tabs or two browser
// contexts are two players), joins the floor and draws everyone in a small lit corner of the
// casino with two tables. Arrow keys or WASD walk. scripts/e2e/presence.mjs drives it through
// window.presenceDev.

import * as THREE from 'three';
import { Engine3D, savedQuality } from '../render/engine3d.ts';
import { DEV_PASSWORD, login, saveLook, socketUrl } from './api.ts';
import { byteToYaw, FloorLink } from './presence.ts';
import { CapsuleFactory, RemotePlayers, type SeatPose } from '../world/remote-players.ts';
import { GAMES } from '../games/index.ts';
import { variantOf } from '../../../shared/src/games/catalog.ts';
import type { Look } from '../../../shared/src/look.ts';
import { el } from '../ui/kit.ts';

const WALK = 1.6; // m/s
const TURN = 10; // how fast the character turns toward where it walks, 1/s
const TAU = Math.PI * 2;

interface DevStation {
  id: string;
  anchor: THREE.Object3D;
}

const variant = variantOf('highcard', null);

function carpet(): THREE.CanvasTexture {
  // Burgundy with a thin gold lattice and a medallion in each diamond, drawn once.
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#35100f';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(190, 140, 70, 0.3)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(128, 0);
  g.lineTo(256, 128);
  g.lineTo(128, 256);
  g.lineTo(0, 128);
  g.closePath();
  g.stroke();
  for (const [x, y] of [[128, 128], [0, 0], [256, 0], [0, 256], [256, 256]] as const) {
    g.fillStyle = 'rgba(200, 150, 78, 0.34)';
    g.beginPath();
    g.arc(x, y, 18, 0, TAU);
    g.fill();
    g.fillStyle = '#4a1418';
    g.beginPath();
    g.arc(x, y, 10, 0, TAU);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(36, 36);
  t.anisotropy = 4;
  return t;
}

function room(engine: Engine3D): DevStation[] {
  const scene = engine.scene;
  scene.fog = new THREE.Fog('#0b0908', 11, 26);
  scene.add(new THREE.HemisphereLight('#ffe2b8', '#2a1a10', 0.45));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(28, 28), new THREE.MeshStandardMaterial({ map: carpet(), roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 16);
  scene.add(floor);
  const stations: DevStation[] = [];
  for (const [i, x] of [-2.4, 2.4].entries()) {
    const anchor = new THREE.Group();
    anchor.position.set(x, 0, 14.2);
    anchor.add(GAMES.highcard.createModel({ variant, quality: engine.quality }));
    scene.add(anchor);
    const spot = new THREE.SpotLight('#ffd9a3', 70, 11, Math.PI / 5, 0.55, 1.5);
    spot.position.set(x, 3.6, 14.9);
    spot.target = anchor;
    scene.add(spot);
    stations.push({ id: `dev-hc-${i + 1}`, anchor });
  }
  const glow = new THREE.PointLight('#ffc27a', 18, 9, 1.6);
  glow.position.set(0, 2.8, 18);
  scene.add(glow);
  return stations;
}

function turnToward(a: number, b: number, k: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * Math.min(1, k);
}

async function run(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, savedQuality());
  engine.camera.position.set(0, 4.3, 21.4);
  engine.camera.lookAt(0, 0.6, 15.6);
  const stations = room(engine);
  const profile = await login(params.get('name') ?? `dev_${Math.random().toString(36).slice(2, 8)}`, DEV_PASSWORD);

  const seatOf = (station: string, slot: number): SeatPose | null => {
    const st = stations.find((s) => s.id === station);
    if (!st) return null;
    const seats = GAMES.highcard.seats(variant);
    const s = seats[slot % seats.length]!;
    const p = st.anchor.localToWorld(new THREE.Vector3(...s.position));
    return { x: p.x, y: p.y, z: p.z, yaw: st.anchor.rotation.y + s.yaw };
  };

  const link = new FloorLink();
  const remotes = new RemotePlayers(link, engine.scene, { seatOf });
  const me = new CapsuleFactory().create(profile.look, profile.name);
  engine.scene.add(me.root);
  const pos = new THREE.Vector3(0, 0, 18);
  let yaw = Math.PI;
  let moving = false;
  let state = 'connecting';
  let target: { x: number; z: number; done: () => void } | null = null;

  const hello = new Promise<void>((resolve) => {
    link.on('hello', (you, first) => {
      // A fresh page stands where the server says; after a reconnect we keep our own position
      // and FloorLink tells the server.
      if (first) {
        pos.set(you.x / 100, 0, you.z / 100);
        yaw = byteToYaw(you.r);
      }
      resolve();
    });
  });
  link.on('look', (id, look) => {
    if (id === link.you?.id) me.setLook(look);
  });
  link.on('state', (s, code) => (state = code === 4001 ? 'opened in another tab' : s));

  const keys = new Set<string>();
  addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
  const held = (...k: string[]) => (k.some((x) => keys.has(x)) ? 1 : 0);

  engine.onFrame((dt) => {
    const at = link.you?.at;
    const seat = at ? seatOf(at.station, 0) : null;
    let vx = 0;
    let vz = 0;
    if (seat) {
      pos.set(seat.x, 0, seat.z);
      yaw = seat.yaw;
      target = null;
    } else {
      const ix = held('d', 'arrowright') - held('a', 'arrowleft');
      const iz = held('s', 'arrowdown') - held('w', 'arrowup');
      if (ix || iz) {
        target = null;
        const n = Math.hypot(ix, iz);
        vx = (ix / n) * WALK;
        vz = (iz / n) * WALK;
      } else if (target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.01) {
          target.done();
          target = null;
        } else {
          const v = Math.min(WALK, dist / Math.max(dt, 1e-3));
          vx = (dx / dist) * v;
          vz = (dz / dist) * v;
        }
      }
      pos.x += vx * dt;
      pos.z += vz * dt;
      if (vx || vz) yaw = turnToward(yaw, Math.atan2(vx, vz), TURN * dt);
    }
    moving = vx !== 0 || vz !== 0;
    me.root.position.copy(pos);
    me.root.rotation.y = yaw;
    me.setMotion(moving ? 1 : 0);
    me.update(dt);
    link.update({ x: pos.x, z: pos.z, yaw, moving });
    remotes.update(dt);
  });

  // HUD: who is here, refreshed a few times a second.
  const ui = document.getElementById('ui')!;
  const hud = el('div', 'panel');
  hud.style.cssText = 'position:fixed;top:12px;right:12px;padding:10px 14px;min-width:210px;font-size:15px;line-height:1.5';
  ui.append(hud);
  const paint = () => {
    const rows = [el('div', 'label', `Floor · ${link.onlineCount} online`), el('div', '', `${profile.name} (you) · ${state}`)];
    for (const p of link.players.values()) {
      const doing = p.info.at ? `at ${p.info.at.station}` : remotes.speed(p.info.id) > 0.2 ? 'walking' : 'standing';
      rows.push(el('div', '', `${p.info.name} · ${doing}`));
    }
    rows.push(el('div', 'label', 'Arrows or WASD to walk'));
    hud.replaceChildren(...rows);
  };
  setInterval(paint, 250);
  paint();

  // Sitting down is real: a solo table socket opened with ?station= makes the table tell the
  // floor who sits where, exactly as a table view does.
  let table: WebSocket | null = null;
  const devApi = {
    ready: hello,
    me: () => ({ id: link.you?.id ?? null, x: pos.x, z: pos.z, yaw, moving, at: link.you?.at ?? null, online: link.onlineCount, state, frameMs: engine.frameMs() }),
    remotes: () =>
      [...link.players.values()].map((p) => {
        const root = remotes.character(p.info.id)?.root;
        return { id: p.info.id, name: p.info.name, look: p.info.look, at: p.info.at, x: root?.position.x ?? null, z: root?.position.z ?? null, visible: root?.visible ?? false, speed: remotes.speed(p.info.id) };
      }),
    walkTo: (x: number, z: number) => new Promise<void>((done) => (target = { x, z, done })),
    setLook: (look: Look) => saveLook(look),
    sit: (station: string) =>
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(socketUrl('solo/highcard', { station }));
        table = ws;
        ws.addEventListener('message', (e) => {
          if (typeof e.data === 'string' && e.data !== 'pong' && JSON.parse(e.data).t === 'table') resolve();
        });
        ws.addEventListener('close', (e) => reject(new Error(`table closed ${e.code}`)));
      }),
    stand: () => {
      table?.send(JSON.stringify({ t: 'leave' }));
      const ws = table;
      table = null;
      setTimeout(() => ws?.close(1000, 'bye'), 500);
    },
  };
  (window as unknown as { presenceDev: typeof devApi }).presenceDev = devApi;
}

run().catch((err) => {
  console.error(err);
  document.getElementById('ui')!.append(el('div', 'panel', 'The presence dev page failed to start: see the console.'));
});
