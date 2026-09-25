// Straw, Sticks & Bricks' Blowdown, played out on the screen overlay in front of the reels. The
// server has settled it already (BlowdownView): this shows it spin by spin. The houses that started
// it hold their cells; before each spin a house being rebuilt takes a hammer's knock and comes up a
// grade; the empty plots spin and any house built on one drops in, putting the count back to three.
// When the spins run out the wolf comes to the left of the street and blows down one column after
// another: straw flies, sticks scatter, bricks shake and crumble, a mansion bursts into coins, and
// each plot shows what its house was hiding while the win meter counts it in. All fifteen built:
// the Whole Street on top.
//
// With "Reduce flashing & motion" on, nothing flickers or shakes: spinning plots breathe instead
// of strobing, houses crumble with a third of the pieces and no shake, and gusts drift slowly.

import type { Cents } from '../../../../shared/src/money.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import type { BlowdownView } from '../../../../shared/src/games/slots/protocol.ts';
import { GRADE_NAMES, PIGS } from '../../../../shared/src/games/slots/pigs.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { tween, ease } from '../../table/tween.ts';
import { calm, fewer, wave } from '../../app/comfort.ts';
import { cellCentre, OVERLAY_W, roundRect, text, type OverlaySpec } from './skin.ts';
import { house, wolfHead } from './pigs.ts';

type G = CanvasRenderingContext2D;

export interface BlowdownHost {
  /** The overlay canvas in front of the reels, and the scale it's painted at. */
  canvas: HTMLCanvasElement;
  scale: number;
  spec: OverlaySpec;
  /** The canvas changed: upload it. */
  commit(): void;
  /** The line over the window ("Blowdown · 2 spins left"). */
  tag(text: string | null): void;
  sfx: Sfx;
  /** Count `win` onto the win and credit meters. */
  pay(win: Cents, seconds: number): Promise<void>;
  gone(): boolean;
}

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  life: number;
  color: string;
  w: number;
  h: number;
}

const DEBRIS: Record<number, string[]> = {
  0: ['#f0cf6a', '#d9ab3a', '#fbe08a'],
  1: ['#8a5a32', '#6f4524', '#a8764a'],
  2: ['#a4472e', '#b85a3c', '#d8c7a8'],
  3: ['#ffe07a', '#f2c14a', '#fff2b0'],
};

// ---------------------------------------------------------------------------------------------
// sounds, synthesised

class Voice {
  private noise: AudioBuffer | null = null;
  constructor(private readonly sfx: Sfx) {}

  private get ctx(): AudioContext | null {
    try {
      const c = this.sfx.audio;
      return c.state === 'closed' ? null : c;
    } catch {
      return null;
    }
  }

  private buffer(c: AudioContext): AudioBuffer {
    if (!this.noise) {
      const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = b;
    }
    return this.noise;
  }

  /** The wolf's breath: a swell of low, filtered wind that sweeps up and dies away. */
  breath(seconds: number): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.buffer(c);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(260, t);
    f.frequency.exponentialRampToValueAtTime(900, t + seconds * 0.6);
    f.frequency.exponentialRampToValueAtTime(380, t + seconds);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(0.5, t + seconds * 0.35);
    e.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    src.connect(f).connect(e).connect(this.sfx.out);
    src.start(t, Math.random(), seconds + 0.05);
  }

  /** A house coming down: a crackle for straw, a clatter for sticks, a rumble for brick, a ring for gold. */
  crash(grade: number): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.buffer(c);
    const f = c.createBiquadFilter();
    f.type = grade >= 2 ? 'lowpass' : 'bandpass';
    f.frequency.value = [3200, 1400, 420, 2400][grade] ?? 1400;
    const e = c.createGain();
    const len = [0.25, 0.3, 0.55, 0.3][grade] ?? 0.3;
    e.gain.setValueAtTime(grade >= 2 ? 0.7 : 0.35, t);
    e.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f).connect(e).connect(this.sfx.out);
    src.start(t, Math.random(), len + 0.05);
    // sticks knock as they fall; gold rings
    const knocks = grade === 1 ? 4 : grade === 3 ? 3 : 0;
    for (let i = 0; i < knocks; i++) {
      const o = c.createOscillator();
      o.type = grade === 3 ? 'sine' : 'triangle';
      o.frequency.value = grade === 3 ? [1318.5, 1568, 2093][i]! : 300 + Math.random() * 180;
      const g = c.createGain();
      const at = t + i * (grade === 3 ? 0.07 : 0.05);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(grade === 3 ? 0.18 : 0.22, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + (grade === 3 ? 0.6 : 0.08));
      o.connect(g).connect(this.sfx.out);
      o.start(at);
      o.stop(at + 0.7);
    }
  }

  /** A hammer's knock on a house being rebuilt. */
  knock(): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    for (const [dt, f] of [[0, 220], [0.11, 260]] as const) {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f, t + dt);
      o.frequency.exponentialRampToValueAtTime(90, t + dt + 0.05);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.16, t + dt + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.07);
      o.connect(g).connect(this.sfx.out);
      o.start(t + dt);
      o.stop(t + dt + 0.1);
    }
  }

  /** A house built on a plot: a soft wooden thump. */
  thump(i: number): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180 + i * 12, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.sfx.out);
    o.start(t);
    o.stop(t + 0.2);
  }
}

// ---------------------------------------------------------------------------------------------

export async function presentBlowdown(host: BlowdownHost, bd: BlowdownView, bet: Cents): Promise<void> {
  const { canvas, spec } = host;
  const cells = 5 * spec.rows;
  const cw = (OVERLAY_W - spec.side * 2) / 5;
  const ch = spec.height / spec.rows;
  const voice = new Voice(host.sfx);
  const grid: (number | null)[] = new Array<number | null>(cells).fill(null);
  const pop = new Array<number>(cells).fill(1);
  const knock = new Array<number>(cells).fill(0);
  const shake = new Array<number>(cells).fill(0);
  const standing = new Array<boolean>(cells).fill(true);
  const prize: (string | null)[] = new Array<string | null>(cells).fill(null);
  let spinning = false;
  let fade = 0;
  let clock = 0;
  let wolf = -1; // 0..1 as he comes in; -1 while he's away
  let blowing = 0;
  let gust: { to: number; k: number } | null = null;
  let street = 0;
  const pieces: Piece[] = [];
  let lastT = performance.now();

  const paint = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    clock += dt;
    const g = canvas.getContext('2d')!;
    g.setTransform(host.scale, 0, 0, host.scale, 0, 0);
    g.clearRect(0, 0, OVERLAY_W, spec.height);
    g.globalAlpha = fade;
    // the night street: the side strips and the plots
    g.fillStyle = spec.ground;
    g.fillRect(0, 0, OVERLAY_W, spec.height);
    const sky = g.createLinearGradient(0, 0, 0, spec.height);
    sky.addColorStop(0, '#0d1730');
    sky.addColorStop(1, '#1f2f24');
    g.fillStyle = sky;
    g.fillRect(spec.side, 0, OVERLAY_W - spec.side * 2, spec.height);
    for (let c = 0; c < cells; c++) {
      const [x, y] = cellCentre(spec, Math.floor(c / spec.rows), c % spec.rows);
      const gr = grid[c];
      roundRect(g, x - cw / 2 + 5, y - ch / 2 + 5, cw - 10, ch - 10, 12);
      if (gr === null || gr === undefined) {
        // an empty plot: a patch of grass, shimmering while it spins
        const lit = spinning ? (calm() ? 0.5 + 0.2 * wave(clock * 4 + c) : 0.35 + 0.35 * Math.abs(Math.sin(clock * 22 + c * 1.7))) : 0.3;
        g.fillStyle = `rgba(62,107,51,${lit.toFixed(3)})`;
        g.fill();
        g.strokeStyle = 'rgba(242,201,138,0.25)';
        g.lineWidth = 2;
        g.stroke();
        if (spinning && !calm()) {
          // the plot's own little reel: house outlines running down through it
          g.save();
          g.clip();
          const off = ((clock * 900 + c * 37) % ch) - ch / 2;
          g.globalAlpha = fade * 0.35;
          for (const k of [-1, 0, 1]) {
            g.save();
            g.translate(x, y + off + k * ch);
            house(g, (c + k + 3) % 3, ch * 0.7);
            g.restore();
          }
          g.restore();
          g.globalAlpha = fade;
        }
        continue;
      }
      // a built plot
      const glow = gr === 3 ? 0.55 + 0.25 * wave(clock * 3) : 0.2;
      g.fillStyle = gr === 3 ? `rgba(120,86,14,${glow.toFixed(3)})` : 'rgba(22,34,58,0.9)';
      g.fill();
      g.strokeStyle = gr === 3 ? '#ffd36b' : gr === 2 ? '#c9674a' : gr === 1 ? '#a8764a' : '#e8c35a';
      g.lineWidth = gr === 3 ? 4 : 3;
      g.stroke();
      if (standing[c]) {
        const p = pop[c]!;
        const kn = knock[c]!;
        const sq = 1 - 0.18 * Math.sin(kn * Math.PI);
        const sh = calm() ? 0 : shake[c]! * Math.sin(clock * 90) * 5;
        g.save();
        g.translate(x + sh, y + (1 - p) * -40);
        g.scale(p * (2 - sq), p * sq);
        house(g, gr, ch * 0.82);
        g.restore();
        if (kn > 0 && kn < 1) {
          // the knock: a burst of sawdust stars
          g.fillStyle = `rgba(255,236,170,${(1 - kn).toFixed(3)})`;
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            g.fillRect(x + Math.cos(a) * (20 + kn * 40) - 3, y - 20 + Math.sin(a) * (14 + kn * 26) - 3, 6, 6);
          }
        }
      }
      const pz = prize[c];
      if (pz) {
        const big = gr >= 2;
        text(g, pz, x, y + 4, `600 ${big ? 38 : 32}px 'Barlow Condensed', sans-serif`, gr === 3 ? '#ffe07a' : '#fff4dc', { stroke: '#120a04', strokeWidth: 7 });
        text(g, GRADE_NAMES[gr]!.toUpperCase(), x, y + ch / 2 - 22, `600 17px 'Barlow Condensed', sans-serif`, '#f2c98a');
      }
    }
    // the pieces of blown houses
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        pieces.splice(i, 1);
        continue;
      }
      p.vy += 700 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      g.save();
      g.globalAlpha = fade * Math.min(1, p.life * 2);
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.color;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    // the wind: streaks from the wolf's mouth to the column he's blowing
    if (gust) {
      const x0 = spec.side + 40;
      const x1 = spec.side + (gust.to + 1) * cw;
      g.save();
      g.strokeStyle = 'rgba(220,235,255,0.55)';
      g.lineCap = 'round';
      const lines = calm() ? 4 : 9;
      for (let i = 0; i < lines; i++) {
        const y = spec.height * (0.18 + (0.64 * i) / (lines - 1)) + Math.sin(clock * 6 + i) * 6;
        const head = x0 + (x1 - x0) * Math.min(1, gust.k * 1.4 - i * 0.03);
        const len = 60 + (i % 3) * 30;
        g.lineWidth = 3 + (i % 2) * 2;
        g.beginPath();
        g.moveTo(Math.max(x0, head - len), y);
        g.quadraticCurveTo(head - len / 2, y - 10, head, y);
        g.stroke();
      }
      g.restore();
    }
    // the wolf, looking in from the left
    if (wolf >= 0) {
      g.save();
      g.translate(-120 + wolf * 200, spec.height / 2 + 20);
      g.rotate(0.12);
      wolfHead(g, 300, blowing);
      g.restore();
    }
    if (street > 0) {
      g.fillStyle = `rgba(10,8,4,${(0.55 * street).toFixed(3)})`;
      g.fillRect(0, spec.height / 2 - 62, OVERLAY_W, 124);
      g.globalAlpha = fade * street;
      text(g, 'THE WHOLE STREET', OVERLAY_W / 2, spec.height / 2 - 18, '64px Limelight, serif', '#ffd36b', { stroke: '#2a1a04', strokeWidth: 9 });
      text(g, `${formatMoney(bd.street)} · ${PIGS.bonus.street.toLocaleString('en-US')}x the bet`, OVERLAY_W / 2, spec.height / 2 + 34, `600 34px 'Barlow Condensed', sans-serif`, '#fff4dc');
    }
    g.globalAlpha = 1;
    host.commit();
  };

  const run = (ms: number, fn: (k: number) => void = () => {}) =>
    tween(
      ms,
      (k) => {
        if (host.gone()) return;
        fn(k);
        paint();
      },
      ease.linear,
    );

  const burst = (c: number, grade: number) => {
    const [x, y] = cellCentre(spec, Math.floor(c / spec.rows), c % spec.rows);
    const colors = DEBRIS[grade] ?? DEBRIS[0]!;
    const n = fewer(grade === 2 ? 22 : 16);
    for (let i = 0; i < n; i++) {
      const strawy = grade === 0;
      pieces.push({
        x: x + (Math.random() - 0.5) * cw * 0.5,
        y: y + (Math.random() - 0.5) * ch * 0.5,
        // blown to the right, up and away
        vx: (calm() ? 60 : 180) + Math.random() * (calm() ? 60 : 260),
        vy: -(calm() ? 60 : 160) - Math.random() * (calm() ? 60 : 200),
        rot: Math.random() * 6,
        spin: (Math.random() - 0.5) * (calm() ? 3 : 14),
        life: calm() ? 0.6 : 0.9 + Math.random() * 0.5,
        color: colors[i % colors.length]!,
        w: strawy ? 16 : grade === 1 ? 22 : grade === 3 ? 10 : 14,
        h: strawy ? 3 : grade === 1 ? 5 : grade === 3 ? 10 : 8,
      });
    }
  };

  const spinsLeft = (n: number) => `Blowdown · ${n} spin${n === 1 ? '' : 's'} left`;

  // --- the board comes up over the reels, the houses that started it standing on it
  for (const [c, gr] of bd.start) {
    grid[c] = gr;
    pop[c] = 0;
  }
  host.tag(spinsLeft(PIGS.bonus.respins));
  await run(350, (k) => (fade = k));
  const order = bd.start.map(([c]) => c);
  await run(260 + order.length * 70, (k) => {
    order.forEach((c, i) => (pop[c] = Math.max(0, Math.min(1, (k * (260 + order.length * 70) - i * 70) / 260))));
  });

  // --- the spins
  for (const s of bd.spins) {
    if (host.gone()) return;
    if (s.rebuilt.length) {
      voice.knock();
      const upgradedTo: number[] = [];
      await run(460, (k) => {
        for (const c of s.rebuilt) {
          knock[c] = k;
          if (k >= 0.5 && upgradedTo.indexOf(c) < 0) {
            grid[c] = Math.min(3, (grid[c] ?? 0) + 1);
            upgradedTo.push(c);
          }
        }
      });
      for (const c of s.rebuilt) knock[c] = 0;
      const gold = s.rebuilt.filter((c) => grid[c] === 3).length;
      host.tag(gold ? 'Rebuilt into a gold mansion' : `${s.rebuilt.length} house${s.rebuilt.length > 1 ? 's' : ''} rebuilt stronger`);
    }
    spinning = true;
    await run(620);
    spinning = false;
    for (const [c, gr] of s.landed) {
      grid[c] = gr;
      pop[c] = 0;
    }
    if (s.landed.length) {
      const landed = s.landed.map(([c]) => c);
      landed.forEach((_, i) => setTimeout(() => voice.thump(i), i * 90));
      await run(300 + landed.length * 90, (k) => {
        const t = k * (300 + landed.length * 90);
        landed.forEach((c, i) => (pop[c] = ease.outBack(Math.max(0, Math.min(1, (t - i * 90) / 300)))));
      });
      host.tag(`${s.landed.length === 1 ? 'A house built' : `${s.landed.length} houses built`} · back to ${PIGS.bonus.respins} spins`);
    } else host.tag(s.left > 0 ? spinsLeft(s.left) : 'The spins are done');
    await run(280);
  }

  // --- the wolf blows the street down, column by column
  host.tag('The wolf comes to blow the houses down');
  await run(650, (k) => (wolf = ease.out(k)));
  const prizes = new Map(bd.houses.map(([c, gr, win]) => [c, { gr, win }] as const));
  for (let col = 0; col < 5; col++) {
    if (host.gone()) return;
    const here = [0, 1, 2].map((row) => col * spec.rows + row).filter((c) => prizes.has(c));
    if (!here.length) continue;
    voice.breath(0.7);
    gust = { to: col, k: 0 };
    const sturdy = here.some((c) => (grid[c] ?? 0) >= 2);
    await run(sturdy ? 520 : 380, (k) => {
      gust!.k = k;
      blowing = Math.sin(k * Math.PI);
      for (const c of here) shake[c] = (grid[c] ?? 0) >= 2 ? k : 0;
    });
    let won = 0;
    for (const c of here) {
      const p = prizes.get(c)!;
      shake[c] = 0;
      standing[c] = false;
      burst(c, p.gr);
      voice.crash(p.gr);
      prize[c] = formatMoney(p.win);
      won += p.win;
    }
    gust = null;
    blowing = 0;
    await Promise.all([host.pay(won, Math.min(1.2, 0.35 + (won / bet) * 0.04)), run(420)]);
  }
  host.tag(`The wolf blew down ${bd.houses.length} houses · ${formatMoney(bd.win - bd.street)}`);
  await run(500, (k) => (wolf = 1 - ease.out(k)));
  wolf = -1;

  if (bd.street > 0) {
    voice.crash(3);
    await run(500, (k) => (street = k));
    host.tag(`The Whole Street · ${formatMoney(bd.street)}`);
    await host.pay(bd.street, 2.4);
    await run(900);
  }
  await run(900);
  await run(300, (k) => (fade = 1 - k));
}
