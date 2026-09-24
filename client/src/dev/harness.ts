// Dev harness: /casino/?dev=table&game=<id>[&variant=<v>][&name=<n>][&limits=<min>-<max>] opens a
// solo table of one game in a bare room, logged in as a throwaway name, at those limits (in cents;
// the table's Standard ones without). Every game agent develops against this.

import { Engine3D, savedQuality } from '../render/engine3d.ts';
import { GAMES } from '../games/index.ts';
import { isGameId, variantOf } from '../../../shared/src/games/catalog.ts';
import { devRoom } from '../world/dev-room.ts';
import { TableStage } from '../table/stage.ts';
import { TableSession } from '../app/table-session.ts';
import { session } from '../app/session.ts';
import { DEV_PASSWORD, login } from '../net/api.ts';
import { updateTweens } from '../table/tween.ts';
import { loadCards } from '../table/cards.ts';
import { Sfx } from '../audio/sfx.ts';
import { el, toast } from '../ui/kit.ts';
import { formatMoney } from '../../../shared/src/money.ts';
import { parseLimitsParam } from '../../../shared/src/limits.ts';

export async function runHarness(params: URLSearchParams): Promise<void> {
  const game = params.get('game');
  if (!isGameId(game)) throw new Error(`?game= must be one of the game ids`);
  const variant = variantOf(game, params.get('variant'));
  const module = GAMES[game];
  const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, savedQuality());
  engine.onFrame((dt) => updateTweens(dt));
  const sfx = new Sfx();
  await Promise.all([loadCards(), sfx.load().catch(() => {}), module.preload?.()]);
  const name = params.get('name') ?? `dev_${Math.random().toString(36).slice(2, 8)}`;
  session.set(await login(name, DEV_PASSWORD));

  const station = devRoom(engine, module, variant);
  const stage = new TableStage(engine, station.anchor);
  const pose = stage.worldPose(module.playPose(variant, 0));
  engine.camera.position.copy(pose.position);
  engine.camera.lookAt(pose.target);

  const ui = document.getElementById('ui')!;
  const hud = el('div', 'panel dev-hud');
  hud.style.cssText = 'position:fixed;top:12px;right:12px;padding:8px 12px;font-size:16px';
  ui.append(hud);
  const renderHud = () => (hud.textContent = `${session.profile?.name} · balance ${formatMoney(session.profile?.balance ?? 0)}`);
  session.on(renderHud);
  renderHud();

  // The play pose can depend on the table (a solo player on several spots is framed wider), so
  // take it again once the view has seen the table, as the app does when you sit down.
  let posed = JSON.stringify(module.playPose(variant, 0));
  const repose = (seat: number | null) => {
    const next = module.playPose(variant, seat ?? 0);
    if (JSON.stringify(next) === posed) return;
    posed = JSON.stringify(next);
    const at = stage.worldPose(next);
    engine.camera.position.copy(at.position);
    engine.camera.lookAt(at.target);
    stage.setRest(next);
  };
  const limits = parseLimitsParam(params.get('limits')) ?? undefined;
  const table = new TableSession({ kind: 'solo', game, variant, station: station.id, limits }, module, stage, ui, sfx, (fn) => engine.onFrame(fn), (code) => toast(`Table closed (${code ?? ''})`, 'err'), {
    onTable: (snap) => repose(snap.you.seat),
  });
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (table.view?.keydown?.(e)) e.preventDefault();
  });
  (window as unknown as { casino: unknown }).casino = { engine, table, session };
}
