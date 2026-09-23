// A tiny in-memory stand-in for the table host, for engine tests. It applies Steps the way the
// Durable Object does (chip moves against stacks, refusing any step that would overdraw one)
// so an engine can be played for thousands of rounds without a server.

import type { EngineCtx, GameEngine, SeatCtx, Step, TableConfig, TableMode, RoundResult } from '../../src/engine.ts';
import { isRefusal } from '../../src/engine.ts';
import type { Rng } from '../../src/rng.ts';
import type { Cents } from '../../src/money.ts';

export interface SimSeat {
  seat: number;
  stack: Cents;
  ready?: boolean;
  connected?: boolean;
}

export class TableSim<S, A, V> {
  state: S;
  now = 1_000_000;
  seats = new Map<number, SeatCtx>();
  rounds: RoundResult[] = [];
  lastEvents: unknown[] = [];
  started: boolean;

  constructor(
    readonly engine: GameEngine<S, A, V>,
    readonly rng: Rng,
    readonly mode: TableMode = 'solo',
    seats: SimSeat[] = [{ seat: 0, stack: 100_000 }],
    readonly cfg: TableConfig = engine.config('', mode),
  ) {
    this.started = mode === 'solo';
    for (const s of seats) {
      this.seats.set(s.seat, {
        seat: s.seat,
        accountId: 1000 + s.seat,
        name: `P${s.seat}`,
        stack: s.stack,
        connected: s.connected ?? true,
        ready: s.ready ?? false,
      });
    }
    this.state = engine.create(cfg, this.ctx());
  }

  ctx(): EngineCtx {
    return {
      rng: this.rng,
      now: this.now,
      mode: this.mode,
      started: this.started,
      seats: [...this.seats.values()].sort((a, b) => a.seat - b.seat),
    };
  }

  stack(seat: number): Cents {
    return this.seats.get(seat)?.stack ?? 0;
  }

  /** Parse (as a client message would be) and apply an action. Throws on refusal unless allowRefusal. */
  act(seat: number, raw: unknown, opts: { allowRefusal?: boolean } = {}): { refused?: string } {
    const action = this.engine.parseAction(raw);
    if (action === null) throw new Error(`parseAction rejected ${JSON.stringify(raw)}`);
    const res = this.engine.act(this.state, seat, action, this.ctx());
    if (isRefusal(res)) {
      if (opts.allowRefusal) return { refused: res.refuse };
      throw new Error(`refused ${JSON.stringify(raw)}: ${res.refuse} ${res.msg}`);
    }
    this.apply(res);
    return {};
  }

  /** Advance the clock and run tick() until nothing more is due. */
  advance(ms: number): void {
    this.now += ms;
    for (let guard = 0; guard < 1000; guard++) {
      const due = this.engine.deadline(this.state);
      const step = this.engine.tick(this.state, this.ctx());
      if (!step) return;
      this.apply(step);
      if (due !== null && due > this.now) return;
    }
    throw new Error('tick() never settled');
  }

  apply(step: Step<S>): void {
    for (const m of step.chips ?? []) {
      const s = this.seats.get(m.seat);
      if (!s) throw new Error(`chip move for empty seat ${m.seat}`);
      if (m.bet !== undefined && (m.bet < 0 || !Number.isInteger(m.bet))) throw new Error(`bad bet ${m.bet}`);
      if (m.payout !== undefined && (m.payout < 0 || !Number.isInteger(m.payout))) throw new Error(`bad payout ${m.payout}`);
      const next = s.stack - (m.bet ?? 0) + (m.payout ?? 0);
      if (next < 0) throw new Error(`step would overdraw seat ${m.seat}`);
      s.stack = next;
    }
    this.rounds.push(...(step.rounds ?? []));
    this.lastEvents = step.events;
    this.state = step.state;
  }

  view(viewer: number | null): V {
    return this.engine.view(this.state, viewer);
  }
}
