// The tables' views, fetched when they are wanted (games/index.ts says when). Each game's floor
// half (model, seats, poses, preload) is there from the start; a view that comes as code to fetch
// (contract.ts, GameClientDef) is fetched once, and a fetch that fails is forgotten so the next
// ask tries again. Mounting never waits: a view that isn't here yet gets a stand-in that keeps
// what the table says, in order, for the real view once it lands.

import type { GameId } from '../../../shared/src/engine.ts';
import type { GameClientDef, GameClientModule, MountView, TableView, TableViewCtx } from './contract.ts';

export interface GameViewsOptions {
  /** A table someone is at couldn't fetch its view, even on a second try (the page says so). */
  failed?: (game: GameId) => void;
  /** Runs `fn` when the page has a moment to spare. */
  idle?: (fn: () => void) => void;
}

/** Shows nothing: what a stand-in hands the table to when its view's code never came. */
const NOTHING: TableView = { onTable() {}, onEvents() {}, onSeat() {}, update() {}, dispose() {} };

const whenIdle = (fn: () => void): void => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 3000 });
  else setTimeout(fn, 200);
};

export class GameViews {
  /** Every game as the rest of the page uses it: the floor half as the folder gave it, and a mount that always works. */
  readonly modules: Record<GameId, GameClientModule>;
  /** Each game's mount once its view's code is here (from the start for a folder that mounts directly). */
  private readonly mounts = new Map<GameId, MountView>();
  /** Views on their way. */
  private readonly loading = new Map<GameId, Promise<MountView>>();
  private warming = false;

  constructor(
    private readonly defs: Record<GameId, GameClientDef>,
    private readonly opts: GameViewsOptions = {},
  ) {
    for (const def of Object.values(defs)) if (def.mount) this.mounts.set(def.game, def.mount);
    const modules = {} as Record<GameId, GameClientModule>;
    for (const [id, def] of Object.entries(defs) as [GameId, GameClientDef][]) {
      const { view: _view, mount: _mount, ...floor } = def;
      modules[id] = {
        ...floor,
        mount: (ctx) => {
          const mount = this.mounts.get(def.game);
          return mount ? mount(ctx) : this.standIn(def.game, ctx);
        },
      };
    }
    this.modules = modules;
  }

  /** Whether a game's view can be mounted right now, with nothing left to fetch. */
  ready(game: GameId): boolean {
    return this.mounts.has(game);
  }

  /**
   * Fetch a game's view unless it is here already; resolves once it is. Rejects when the fetch
   * fails (offline, or a page older than the casino now deployed): mounting still works then, on
   * a stand-in that tries once more and says so if the view never comes.
   */
  async load(game: GameId): Promise<void> {
    await this.fetch(game);
  }

  /**
   * Fetch every view that isn't here yet, one at a time, each when the page has a moment to
   * spare. A view that fails is left for load() to try again when someone sits down at it.
   */
  warm(): void {
    if (this.warming) return;
    this.warming = true;
    const idle = this.opts.idle ?? whenIdle;
    const left = (Object.keys(this.defs) as GameId[]).filter((g) => !this.mounts.has(g));
    const next = (): void => {
      const game = left.shift();
      if (game) void this.fetch(game).then(() => idle(next), () => idle(next));
    };
    idle(next);
  }

  private fetch(game: GameId): Promise<MountView> {
    const have = this.mounts.get(game);
    if (have) return Promise.resolve(have);
    let p = this.loading.get(game);
    if (!p) {
      p = this.defs[game].view!().then(
        (mount) => {
          this.mounts.set(game, mount);
          this.loading.delete(game);
          return mount;
        },
        (err: unknown) => {
          this.loading.delete(game);
          throw err;
        },
      );
      this.loading.set(game, p);
    }
    return p;
  }

  /**
   * Stands in for a view whose code is still on its way. Every call the table makes is kept, in
   * order, and made on the real view as soon as it is mounted; an event batch resolves once the
   * real view has played it, so the table's queue (and the HUD's chips behind it) wait as always.
   */
  private standIn(game: GameId, ctx: TableViewCtx): TableView {
    let real: TableView | null = null;
    let gone = false;
    const queued: ((v: TableView) => void)[] = [];
    /** Make this call on the real view: now if it's here, else as soon as it is. */
    const call = (fn: (v: TableView) => void): void => {
      if (real) fn(real);
      else queued.push(fn);
    };
    /** The same for an event batch, resolving (or failing) once the real view has played it. */
    const play = (fn: (v: TableView) => Promise<void> | void): Promise<void> =>
      new Promise<void>((resolve, reject) => call((v) => Promise.resolve().then(() => fn(v)).then(resolve, reject)));
    const land = (v: TableView): void => {
      real = v;
      for (const fn of queued.splice(0)) {
        try {
          fn(v);
        } catch (err) {
          console.error(`the ${game} table's view failed`, err);
        }
      }
    };
    const ready = this.fetch(game)
      .catch(() => this.fetch(game))
      .then(
        (mount) => {
          if (!gone) land(mount(ctx));
        },
        (err: unknown) => {
          console.error(`the ${game} table's view failed to load`, err);
          if (gone) return;
          this.opts.failed?.(game);
          land(NOTHING);
        },
      );
    return {
      onTable: (snap) => call((v) => v.onTable(snap)),
      onEvents: (events, view) => play((v) => v.onEvents(events, view)),
      onSeat: (msg) => call((v) => v.onSeat(msg)),
      onMembers: (msg) => call((v) => v.onMembers?.(msg)),
      onError: (code, msg) => call((v) => v.onError?.(code, msg)),
      keydown: (e) => real?.keydown?.(e) ?? false,
      settled: () => ready.then(() => real?.settled?.()),
      update: (dt) => real?.update(dt),
      dispose: () => {
        gone = true;
        queued.length = 0;
        real?.dispose();
      },
    };
  }
}
