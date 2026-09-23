// Connects one table socket to one game view. Events are played in order: the next batch waits
// for the current animation, and if messages pile up the running animation snaps to its end so
// the table never lags behind the server.

import { Socket } from '../net/socket.ts';
import { socketUrl } from '../net/api.ts';
import { observeServerTime } from '../net/clock.ts';
import { finishAll } from '../table/tween.ts';
import type { GameClientModule, SeatMsg, TableLink, TableView, TableSnapshot } from '../games/contract.ts';
import type { TableStage } from '../table/stage.ts';
import { UiKit, toast } from '../ui/kit.ts';
import type { Sfx } from '../audio/sfx.ts';
import { session } from './session.ts';
import { tips } from './tips.ts';
import type { GameEvent } from '../../../shared/src/engine.ts';

export interface TableTarget {
  kind: 'solo' | 'lobby';
  game: GameClientModule['game'];
  variant: string;
  tableId?: string;
  /** A private lobby's PIN; the table asks for it from anyone who isn't a member yet. */
  pin?: string;
  station?: string;
}

/** What the app around the table wants to hear besides the view (the HUD, the camera). */
export interface TableHooks {
  onTable?(snap: TableSnapshot): void;
  onSeat?(msg: SeatMsg): void;
  /** A view asked to stand up; the app leaves the table the way Esc does. */
  onLeave?(): void;
}

export class TableSession {
  readonly socket: Socket;
  view: TableView | null = null;
  snapshot: TableSnapshot | null = null;
  private aid = 0;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private readonly kit: UiKit;
  private offFrame: () => void;

  constructor(
    readonly target: TableTarget,
    readonly module: GameClientModule,
    readonly stage: TableStage,
    readonly ui: HTMLElement,
    readonly sfx: Sfx,
    onFrame: (fn: (dt: number) => void) => () => void,
    readonly onClosed: (code?: number) => void,
    private readonly hooks: TableHooks = {},
  ) {
    this.kit = new UiKit(ui);
    const path = target.kind === 'solo' ? `solo/${target.game}` : `table/${target.tableId}`;
    const params: Record<string, string> = {};
    if (target.kind === 'solo' && target.variant) params.variant = target.variant;
    if (target.station) params.station = target.station;
    this.pin = target.pin ?? null;
    this.socket = new Socket({
      // Rebuilt for every connection: a reconnect brings the lobby's current PIN (a watcher who
      // drops is let back in like a newcomer, and the PIN may have changed since joining).
      url: () => socketUrl(path, this.pin ? { ...params, pin: this.pin } : params),
      onMessage: (m) => this.onMessage(m),
      onState: (s, code) => {
        if (s === 'reconnecting') this.kit.say('Reconnecting…', 4000);
        if (s === 'open' && this.leavePending) this.sendLeave();
        // A close this session asked for (leaving, closing) isn't news to the app.
        if (s === 'closed' && !this.ended) this.onClosed(code);
      },
    });
    this.offFrame = onFrame((dt) => this.view?.update(dt));
  }

  readonly link: TableLink = {
    act: (a) => this.send({ t: 'act', aid: this.nextAid(), a }),
    buyIn: (amount) => this.send({ t: 'buyin', aid: this.nextAid(), amount }),
    topUp: (amount) => this.send({ t: 'topup', aid: this.nextAid(), amount }),
    cashOut: () => this.send({ t: 'cashout', aid: this.nextAid() }),
    ready: (on) => this.send({ t: 'ready', on }),
    leave: () => (this.hooks.onLeave ? this.hooks.onLeave() : this.leave()),
  };

  send(msg: unknown): void {
    if (!this.socket.send(msg)) toast('Not connected to the table yet.', 'err');
  }

  leave(): void {
    // Nothing more is asked of a player on the way out: the kit's prompts close with it (the last
    // seat message says "watching, $0", which would otherwise offer a buy-in at the table just left).
    this.ended = true;
    this.kit.dispose();
    // A leave pressed while reconnecting goes out as soon as the socket is back (or the seat is
    // held for the grace period and its bets play on timeouts); give up after a while.
    if (!this.socket.send({ t: 'leave' })) {
      this.leavePending = true;
      setTimeout(() => this.close(), 15_000);
      return;
    }
    setTimeout(() => this.close(), 150);
  }

  private sendLeave(): void {
    this.leavePending = false;
    this.socket.send({ t: 'leave' });
    setTimeout(() => this.close(), 150);
  }

  /** Close the socket and take the table's view and stage out of the scene. */
  close(): void {
    this.ended = true;
    this.kit.dispose();
    this.socket.close();
    this.offFrame();
    this.view?.dispose();
    this.view = null;
    this.stage.dispose();
  }

  private nextAid(): string {
    return `${Date.now().toString(36)}${(this.aid++).toString(36)}`;
  }

  private mountIfNeeded(): TableView {
    if (!this.view) {
      const me = session.profile!;
      this.view = this.module.mount({
        stage: this.stage,
        ui: this.ui,
        link: this.link,
        kit: this.kit,
        sfx: this.sfx,
        me: { accountId: me.id, name: me.name },
        tips,
        // The table's own variant: a lobby joined by PIN can be a different wheel than the
        // station's.
        variant: this.snapshot?.meta.variant ?? this.target.variant,
      });
    }
    return this.view;
  }

  private onMessage(m: any): void {
    if (typeof m?.now === 'number') observeServerTime(m.now);
    switch (m.t) {
      case 'table': {
        finishAll();
        // A fresh snapshot supersedes whatever was still queued from before it (a reconnect).
        this.gen++;
        if (m.meta.pin) this.pin = m.meta.pin;
        this.snapshot = m;
        const view = this.mountIfNeeded();
        view.onTable(m);
        this.hooks.onTable?.(m);
        if (m.you.status === 'watching' && (m.meta.mode === 'solo' || m.meta.started)) void this.promptBuyIn();
        break;
      }
      case 'ev': {
        if (this.pending > 1) finishAll();
        this.pending++;
        const events = m.events as GameEvent[];
        const gen = this.gen;
        this.queue = this.queue
          .then(() => (gen === this.gen ? this.view?.onEvents(events, m.view) : undefined))
          .catch((err) => console.error('table animation failed', err))
          .finally(() => this.pending--);
        break;
      }
      case 'seat':
        this.view?.onSeat(m);
        this.hooks.onSeat?.(m);
        if (m.status === 'watching' && this.snapshot?.meta.mode === 'solo' && m.stack === 0) void this.promptBuyIn();
        break;
      case 'balance':
        session.balance(m.balance, m.inPlay, m.rev);
        break;
      case 'members':
        if (m.pin) this.pin = m.pin;
        this.view?.onMembers?.(m);
        break;
      case 'err':
        this.kit.toast(m.msg, 'err');
        this.view?.onError?.(m.code, m.msg);
        break;
      case 'closed':
        if (!this.ended) this.onClosed();
        break;
    }
  }

  private prompting = false;
  /** The lobby's PIN as last heard (members are told it), for reconnecting. */
  private pin: string | null = null;
  private leavePending = false;
  /** Bumped by each full snapshot; event batches queued before it are skipped. */
  private gen = 0;
  /** Left or closed: nothing more is reported to the app. */
  private ended = false;

  async promptBuyIn(): Promise<void> {
    const snap = this.snapshot;
    const p = session.profile;
    if (this.prompting || !snap || !p) return;
    this.prompting = true;
    const amount = await this.kit.askBuyIn({ min: snap.meta.config.buyIn.min, max: snap.meta.config.buyIn.max, balance: p.balance });
    this.prompting = false;
    if (amount) this.link.buyIn(amount);
  }
}
