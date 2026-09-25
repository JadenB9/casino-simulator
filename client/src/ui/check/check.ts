// The Quick check (server/src/fair.ts): the panel a player gets if the server asks, at a pause
// between rounds. It never says why beyond "to keep the tables fair". Until it's passed no new
// bets or buy-ins go through anywhere, while standing up and cashing out work as always, so
// closing it ("Later") is fine: the next bet opens it again.
//
// The built-in check is a picture the Worker drew: felt, six rings, and words saying which ring
// the chip goes on. Drag the chip there (or tap the ring). With Turnstile set up on the Worker it
// shows Cloudflare's widget instead, and the picture if that won't load.

import type { CheckChallenge, CheckResponse } from '../../../../shared/src/protocol.ts';
import { CHECK_MSG } from '../../../../shared/src/protocol.ts';
import { ApiError, answerCheck, getCheck } from '../../net/api.ts';
import { button, el, modal, toast } from '../kit.ts';
import './check.css';

const TURNSTILE_JS = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const CHIP_R = 15;

interface Turnstile {
  render(el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; 'error-callback': () => boolean; theme?: string }): string;
  remove(id: string): void;
}

let installed = false;
let open: { close: () => void } | null = null;

/** Listen for the check (a table's `check`, an API refusal), and open it now if one is waiting. */
export function installCheck(): void {
  if (!installed) {
    installed = true;
    addEventListener('casino:check', () => void openCheck());
  }
  void getCheck()
    .then((r) => {
      if (r.state !== 'ok') void openCheck(r);
    })
    .catch(() => {
      /* offline: the next refusal opens it */
    });
}

/** The panel; one at a time. `first` is a response already in hand. */
export async function openCheck(first?: CheckResponse): Promise<void> {
  if (open) return;
  const body = el('div', 'check');
  const say = el('p', 'check-say', `${CHECK_MSG} It takes a moment.`);
  const stage = el('div', 'check-stage');
  const status = el('p', 'check-status');
  status.setAttribute('role', 'status');
  body.append(say, stage, status);
  let timer = 0;
  let widget: { id: string; ts: Turnstile } | null = null;
  const fresh = button('New picture', () => void load('chip'), { cls: 'plain' });
  const later = button('Later', () => close(), { cls: 'plain' });
  const m = modal('Quick check', [body], [fresh, later], () => close());
  m.root.classList.add('check-modal');
  const close = () => {
    clearInterval(timer);
    if (widget) widget.ts.remove(widget.id);
    m.close();
    open = null;
  };
  open = { close };

  const passed = () => {
    close();
    toast('Thanks. Enjoy the tables.');
  };

  const waitUntil = (at: number) => {
    stage.replaceChildren();
    fresh.disabled = true;
    const tick = () => {
      const left = Math.ceil((at - Date.now()) / 1000);
      if (left > 0) {
        status.textContent = `Not quite. Another go in ${left} s.`;
        return;
      }
      clearInterval(timer);
      void load();
    };
    clearInterval(timer);
    timer = setInterval(tick, 500) as unknown as number;
    tick();
  };

  const show = (r: CheckResponse) => {
    if (r.state === 'ok') return passed();
    if (r.wait && r.wait > Date.now()) return waitUntil(r.wait);
    if (!r.challenge) return;
    fresh.disabled = false;
    status.textContent = '';
    if (r.challenge.kind === 'turnstile') void turnstile(r.challenge);
    else void chip(r.challenge);
  };

  async function load(kind?: 'chip'): Promise<void> {
    status.textContent = '';
    try {
      show(await getCheck(kind));
    } catch (err) {
      status.textContent = err instanceof ApiError ? err.message : 'The casino is not answering. Try again in a moment.';
    }
  }

  async function submit(a: { id: string; x?: number; y?: number; token?: string }): Promise<void> {
    status.textContent = 'Checking…';
    try {
      const r = await answerCheck(a);
      if (r.ok) return passed();
      if (r.wait) return waitUntil(r.wait);
      void load();
    } catch (err) {
      status.textContent = err instanceof ApiError ? err.message : 'The casino is not answering. Try again in a moment.';
    }
  }

  async function turnstile(ch: Extract<CheckChallenge, { kind: 'turnstile' }>): Promise<void> {
    say.textContent = CHECK_MSG;
    fresh.hidden = true;
    const box = el('div', 'check-turnstile');
    stage.replaceChildren(box);
    try {
      const ts = await loadTurnstile();
      const id = ts.render(box, {
        sitekey: ch.sitekey,
        theme: 'dark',
        callback: (token) => void submit({ id: ch.id, token }),
        // It couldn't run here (blocked, offline): the picture instead.
        'error-callback': () => {
          void load('chip');
          return true;
        },
      });
      widget = { id, ts };
    } catch {
      void load('chip');
    }
  }

  async function chip(ch: Extract<CheckChallenge, { kind: 'chip' }>): Promise<void> {
    fresh.hidden = false;
    say.textContent = `${CHECK_MSG} Drag the chip onto the ring the picture names.`;
    const canvas = el('canvas', 'check-canvas');
    canvas.width = ch.w;
    canvas.height = ch.h;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'A picture of rings on felt, with words naming one; drag the chip onto that ring.');
    stage.replaceChildren(canvas);
    const bytes = Uint8Array.from(atob(ch.png), (c) => c.charCodeAt(0));
    const picture = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const ctx = canvas.getContext('2d')!;
    const at = { ...ch.chip };
    let dragging = false;
    let sent = false;
    const draw = () => {
      ctx.drawImage(picture, 0, 0);
      drawChip(ctx, at.x, at.y, dragging);
    };
    draw();
    const point = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * ch.w, y: ((e.clientY - r.top) / r.height) * ch.h };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (sent) return;
      canvas.setPointerCapture(e.pointerId);
      dragging = true;
      // A tap away from the chip puts it there (a drag works from anywhere too).
      Object.assign(at, point(e));
      draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      Object.assign(at, point(e));
      draw();
    });
    const drop = () => {
      if (!dragging || sent) return;
      dragging = false;
      draw();
      if (Math.hypot(at.x - ch.chip.x, at.y - ch.chip.y) < 12) return;
      sent = true;
      void submit({ id: ch.id, x: Math.round(at.x), y: Math.round(at.y) });
    };
    canvas.addEventListener('pointerup', drop);
    canvas.addEventListener('pointercancel', () => {
      dragging = false;
      draw();
    });
  }

  if (first) show(first);
  else await load();
}

/** A casino chip: a coloured disc with an edge of stripes and an inlay. */
function drawChip(ctx: CanvasRenderingContext2D, x: number, y: number, lifted: boolean): void {
  ctx.save();
  if (lifted) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
  }
  ctx.beginPath();
  ctx.arc(x, y, CHIP_R, 0, Math.PI * 2);
  ctx.fillStyle = '#8f1d24';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#f4efe4';
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.arc(x, y, CHIP_R - 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, CHIP_R - 7, 0, Math.PI * 2);
  ctx.fillStyle = '#d8b06a';
  ctx.fill();
  ctx.restore();
}

let turnstileLoad: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  const w = window as unknown as { turnstile?: Turnstile };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  turnstileLoad ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TURNSTILE_JS;
    s.async = true;
    s.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error('no turnstile')));
    s.onerror = () => {
      turnstileLoad = null;
      reject(new Error('turnstile blocked'));
    };
    document.head.append(s);
  });
  return turnstileLoad;
}
