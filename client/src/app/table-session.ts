// Connects one table socket to one game view. Events are played in order: the next batch waits
// for the current animation, and if messages pile up the running animation snaps to its end so
// the table never lags behind the server.

import { Socket } from '../net/socket.ts';
import { socketUrl } from '../net/api.ts';
import { observeServerTime } from '../net/clock.ts';
import { finishAll } from '../table/tween.ts';
import type { GameClientModule, TableLink, TableView, TableSnapshot } from '../games/contract.ts';
import type { TableStage } from '../table/stage.ts';
import { UiKit, toast } from '../ui/kit.ts';
import type { Sfx } from '../audio/sfx.ts';
import { session } from './session.ts';
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
  ) {
    this.kit = new UiKit(ui);
    const path = target.kind === 'solo' ? `solo/${target.game}` : `table/${target.tableId}`;
    const params: Record<string, string> = {};
    if (target.kind === 'solo' && target.variant) params.variant = target.variant;
    if (target.station) params.station = target.station;
    if (target.pin) params.pin = target.pin;
    this.socket = new Socket({
      url: () => socketUrl(path, params),
      onMessage: (m) => this.onMessage(m),
      onState: (s, code) => {
        if (s === 'reconnecting') this.kit.say('Reconnecting…', 4000);
        if (s === 'closed') this.onClosed(code);
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
  };

  send(msg: unknown): void {
    if (!this.socket.send(msg)) toast('Not connected to the table yet.', 'err');
  }

  leave(): void {
    this.socket.send({ t: 'leave' });
    setTimeout(() => this.close(), 150);
  }

  close(): void {
    this.socket.close();
    this.offFrame();
    this.view?.dispose();
    this.view = null;
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
        variant: this.target.variant,
      });
    }
    return this.view;
  }

  private onMessage(m: any): void {
    if (typeof m?.now === 'number') observeServerTime(m.now);
    switch (m.t) {
      case 'table': {
        finishAll();
        this.snapshot = m;
        const view = this.mountIfNeeded();
        view.onTable(m);
        if (m.you.status === 'watching' && (m.meta.mode === 'solo' || m.meta.started)) void this.promptBuyIn();
        break;
      }
      case 'ev': {
        if (this.pending > 1) finishAll();
        this.pending++;
        const events = m.events as GameEvent[];
        this.queue = this.queue
          .then(() => this.view?.onEvents(events, m.view))
          .catch((err) => console.error('table animation failed', err))
          .finally(() => this.pending--);
        break;
      }
      case 'seat':
        this.view?.onSeat(m);
        if (m.status === 'watching' && this.snapshot?.meta.mode === 'solo' && m.stack === 0) void this.promptBuyIn();
        break;
      case 'balance':
        session.balance(m.balance, m.inPlay, m.rev);
        break;
      case 'members':
        this.view?.onMembers?.(m);
        break;
      case 'timer':
        this.view?.onTimer?.(m, Date.now());
        break;
      case 'err':
        this.kit.toast(m.msg, 'err');
        this.view?.onError?.(m.code, m.msg);
        break;
      case 'closed':
        this.onClosed();
        break;
    }
  }

  private prompting = false;

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
