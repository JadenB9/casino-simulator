// Who is playing and how much they have: the profile from the API, kept current by the balance
// messages tables send (the newest `rev` wins, so two tabs can't show a stale number).

import type { Profile } from '../../../shared/src/protocol.ts';

type Listener = (p: Profile) => void;

class Session {
  profile: Profile | null = null;
  private listeners = new Set<Listener>();

  set(p: Profile): void {
    this.profile = p;
    this.emit();
  }

  balance(balance: number, inPlay: number, rev: number): void {
    if (!this.profile || rev < this.profile.rev) return;
    this.profile = { ...this.profile, balance, inPlay, rev };
    this.emit();
  }

  /** Log out: forget the profile. Listeners stay; they hear from the next login. */
  clear(): void {
    this.profile = null;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    if (this.profile) for (const fn of this.listeners) fn(this.profile);
  }
}

export const session = new Session();
