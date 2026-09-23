// Tiny tweening driven by the render loop, so animations pause with the tab and can be snapped
// to their end when the next server message arrives (`finishAll`).

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  out: (t: number) => 1 - (1 - t) ** 3,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
  outQuint: (t: number) => 1 - (1 - t) ** 5,
};

interface Running {
  elapsed: number;
  duration: number;
  apply: (k: number) => void;
  ease: Ease;
  done: () => void;
}

const running = new Set<Running>();

/** Run `apply(k)` for k from 0 to 1 over `ms`, resolving when it lands. */
export function tween(ms: number, apply: (k: number) => void, e: Ease = ease.out): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      apply(1);
      resolve();
      return;
    }
    running.add({ elapsed: 0, duration: ms / 1000, apply, ease: e, done: resolve });
  });
}

export function wait(ms: number): Promise<void> {
  return tween(ms, () => {});
}

export function updateTweens(dt: number): void {
  for (const r of running) {
    r.elapsed += dt;
    const k = Math.min(1, r.elapsed / r.duration);
    r.apply(r.ease(k));
    if (k >= 1) {
      running.delete(r);
      r.done();
    }
  }
}

/** Jump every running animation to its end state. */
export function finishAll(): void {
  for (const r of running) {
    r.apply(1);
    r.done();
  }
  running.clear();
}
