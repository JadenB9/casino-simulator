// The tables' views fetched on demand (client/src/games/lazy.ts): a folder that mounts directly
// is ready from the start, a view that comes as code is fetched once and again after a failure,
// and a table mounted before its view is here gets a stand-in that plays everything the table
// said, in order, to the real view when it lands, without the table's queue moving on early.

import { describe, expect, it, vi } from 'vitest';
import type { GameId } from '../../shared/src/engine.ts';
import type { GameClientDef, MountView, TableSnapshot, TableView, TableViewCtx } from '../src/games/contract.ts';
import { GameViews } from '../src/games/lazy.ts';

const ctx = {} as TableViewCtx;
const snap = (n: number) => ({ t: 'table', n }) as unknown as TableSnapshot;
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A view that writes down every call made on it. */
function recorder(log: string[], events?: () => Promise<void>): TableView {
  return {
    onTable: (s) => void log.push(`table ${(s as unknown as { n: number }).n}`),
    onEvents: async (ev) => {
      log.push(`events ${ev.length}`);
      await events?.();
      log.push(`played ${ev.length}`);
    },
    onSeat: () => void log.push('seat'),
    onMembers: () => void log.push('members'),
    onError: (code) => void log.push(`error ${code}`),
    keydown: () => true,
    settled: async () => void log.push('settled'),
    update: (dt) => void log.push(`update ${dt}`),
    dispose: () => void log.push('dispose'),
  };
}

const floor = (game: GameId) => ({
  game,
  footprint: { width: 1, depth: 1 },
  createModel: () => ({}) as never,
  seats: () => [],
  playPose: () => ({ position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] }),
});

/** A view to hand over by hand: `give()` lands it, `fail()` fails the fetch. */
function deferred() {
  let give!: (m: MountView) => void;
  let fail!: (e: unknown) => void;
  const fetches: Promise<MountView>[] = [];
  const view = vi.fn(() => {
    const p = new Promise<MountView>((res, rej) => {
      give = res;
      fail = rej;
    });
    fetches.push(p);
    return p;
  });
  return { view, give: (m: MountView) => give(m), fail: (e: unknown) => fail(e), fetches };
}

function views(defs: Partial<Record<GameId, GameClientDef>>, opts = {}) {
  return new GameViews(defs as Record<GameId, GameClientDef>, opts);
}

describe('game views', () => {
  it('a folder that mounts directly is ready from the start and mounts straight through', () => {
    const v = recorder([]);
    const gv = views({ dice: { ...floor('dice'), mount: () => v } });
    expect(gv.ready('dice')).toBe(true);
    expect(gv.modules.dice.mount(ctx)).toBe(v);
    expect(gv.modules.dice.footprint).toEqual({ width: 1, depth: 1 });
    expect('view' in gv.modules.dice).toBe(false);
  });

  it('a view that comes as code is fetched once however often it is asked for, then mounts straight through', async () => {
    const d = deferred();
    const gv = views({ blackjack: { ...floor('blackjack'), view: d.view } });
    expect(gv.ready('blackjack')).toBe(false);
    const a = gv.load('blackjack');
    const b = gv.load('blackjack');
    expect(d.view).toHaveBeenCalledTimes(1);
    const v = recorder([]);
    d.give(() => v);
    await Promise.all([a, b]);
    expect(gv.ready('blackjack')).toBe(true);
    await gv.load('blackjack');
    expect(d.view).toHaveBeenCalledTimes(1);
    expect(gv.modules.blackjack.mount(ctx)).toBe(v);
  });

  it('a fetch that failed is tried again the next time', async () => {
    const d = deferred();
    const gv = views({ war: { ...floor('war'), view: d.view } });
    const first = gv.load('war');
    d.fail(new Error('offline'));
    await expect(first).rejects.toThrow('offline');
    expect(gv.ready('war')).toBe(false);
    const second = gv.load('war');
    expect(d.view).toHaveBeenCalledTimes(2);
    d.give(() => recorder([]));
    await second;
    expect(gv.ready('war')).toBe(true);
  });

  it('a table mounted before its view is here: everything it said reaches the real view in order', async () => {
    const d = deferred();
    const gv = views({ baccarat: { ...floor('baccarat'), view: d.view } });
    const log: string[] = [];
    const stand = gv.modules.baccarat.mount(ctx);
    stand.onTable(snap(1));
    const played = Promise.resolve(stand.onEvents([{ type: 'deal' }, { type: 'flip' }], {}));
    stand.onSeat({} as never);
    stand.onMembers?.({} as never);
    stand.onError?.('BUSY', 'busy');
    stand.update(0.016);
    expect(stand.keydown?.({} as KeyboardEvent)).toBe(false);
    let done = false;
    void played.then(() => (done = true));
    await tick();
    expect(done).toBe(false);
    let release!: () => void;
    const mount = vi.fn(() => recorder(log, () => new Promise<void>((r) => (release = r))));
    d.give(mount);
    await tick();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(log).toEqual(['table 1', 'seat', 'members', 'error BUSY', 'events 2']);
    // the batch isn't over until the real view has played it
    expect(done).toBe(false);
    release();
    await played;
    expect(log).toContain('played 2');
    // from now on it is the real view's
    stand.update(0.02);
    expect(log).toContain('update 0.02');
    expect(stand.keydown?.({} as KeyboardEvent)).toBe(true);
    await stand.settled?.();
    expect(log.at(-1)).toBe('settled');
    stand.dispose();
    expect(log.at(-1)).toBe('dispose');
  });

  it('a view that never comes: said once, and the table still gets through its queue', async () => {
    const d = deferred();
    const failed = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const gv = views({ threecard: { ...floor('threecard'), view: d.view } }, { failed });
    const stand = gv.modules.threecard.mount(ctx);
    stand.onTable(snap(1));
    const played = Promise.resolve(stand.onEvents([{ type: 'deal' }], {}));
    d.fail(new Error('gone'));
    await tick();
    // tried once more before giving up
    expect(d.view).toHaveBeenCalledTimes(2);
    d.fail(new Error('still gone'));
    await played;
    await stand.settled?.();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith('threecard');
    expect(() => stand.onSeat({} as never)).not.toThrow();
    error.mockRestore();
  });

  it('a table left before its view came never mounts it', async () => {
    const d = deferred();
    const gv = views({ holdem: { ...floor('holdem'), view: d.view } });
    const stand = gv.modules.holdem.mount(ctx);
    stand.onTable(snap(1));
    stand.dispose();
    const mount = vi.fn(() => recorder([]));
    d.give(mount);
    await tick();
    expect(mount).not.toHaveBeenCalled();
    // the code is here for the next table all the same
    expect(gv.ready('holdem')).toBe(true);
  });

  it('warming fetches every view not yet here, one at a time, and leaves out the ones that are', async () => {
    const a = deferred();
    const b = deferred();
    const idle: (() => void)[] = [];
    const gv = views(
      { dice: { ...floor('dice'), mount: () => recorder([]) }, craps: { ...floor('craps'), view: a.view }, bingo: { ...floor('bingo'), view: b.view } },
      { idle: (fn: () => void) => idle.push(fn) },
    );
    gv.warm();
    gv.warm();
    expect(idle).toHaveLength(1);
    idle.shift()!();
    expect(a.view).toHaveBeenCalledTimes(1);
    expect(b.view).not.toHaveBeenCalled();
    a.fail(new Error('blip'));
    await tick();
    // a failure doesn't stop the rest
    idle.shift()!();
    expect(b.view).toHaveBeenCalledTimes(1);
    b.give(() => recorder([]));
    await tick();
    expect(gv.ready('bingo')).toBe(true);
    expect(gv.ready('craps')).toBe(false);
    idle.shift()?.();
    expect(a.view).toHaveBeenCalledTimes(1);
  });
});
