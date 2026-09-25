// The caller's voice: the browser's own speech (no recordings, nothing fetched), saying each ball
// the way a hall's caller does. Off when the casino is muted or the player turns it off; quiet on
// browsers without speech. Lines that pile up are dropped, never queued: the next ball matters more.

import type { Sfx } from '../../audio/sfx.ts';

const KEY = 'casino.bingo.caller';

export class BingoVoice {
  on: boolean;
  private readonly synth: SpeechSynthesis | null;
  private voice: SpeechSynthesisVoice | null = null;

  constructor(private readonly sfx: Sfx) {
    this.synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;
    let on = true;
    try {
      on = localStorage.getItem(KEY) !== '0';
    } catch {
      /* private mode */
    }
    this.on = on && this.synth !== null;
    this.pickVoice();
    this.synth?.addEventListener?.('voiceschanged', this.pickVoice);
  }

  /** An English voice, a British one if there is one (bingo calls are British). */
  private pickVoice = (): void => {
    const all = this.synth?.getVoices() ?? [];
    this.voice = all.find((v) => v.lang === 'en-GB') ?? all.find((v) => v.lang.startsWith('en')) ?? null;
  };

  setOn(on: boolean): void {
    this.on = on && this.synth !== null;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      /* private mode */
    }
    if (!this.on) this.synth?.cancel();
  }

  say(text: string): void {
    if (!this.on || !this.synth || this.sfx.muted) return;
    // "B 7" reads better as "B, 7"
    const u = new SpeechSynthesisUtterance(text.replace(/^([BINGO]) (\d+)/, '$1, $2'));
    if (this.voice) u.voice = this.voice;
    u.rate = 1.05;
    u.pitch = 0.95;
    u.volume = Math.max(0.2, this.sfx.volume);
    this.synth.cancel();
    this.synth.speak(u);
  }

  dispose(): void {
    this.synth?.cancel();
    this.synth?.removeEventListener?.('voiceschanged', this.pickVoice);
  }
}
