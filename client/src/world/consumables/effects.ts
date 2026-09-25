// What a drink or a plate does for you once it's had: an espresso or an energy drink puts a spring
// in your step, champagne makes you sparkle, a few drinks make you a little tipsy (a sway and a
// warm edge to the view that grow with how many you've had and wear off), a Dom has you
// celebrating, and a plate leaves you well fed. None of it touches money or odds: it's how you
// walk, how you look and what the staff say.
//
// Pure: times are milliseconds (the page's own clock is fine), portions are counted as they're had.

/** What each portion does, and what finishing the order does. */
export interface ItemEffect {
  /** Drinks' worth of alcohol per portion (a whole glass of wine is about 1). */
  tipsy?: number;
  /** A faster pace: this factor on walking and running, for this long from the first portion (ms). */
  pace?: { k: number; ms: number };
  /** Sparkling, for this long from the first portion (ms). */
  bubbly?: number;
  /** Celebrating (a Dom), for this long from the first portion (ms). */
  party?: number;
  /** Well fed, for this long from the last bite (ms). */
  fed?: number;
}

const MIN = 60_000;

export const ITEM_EFFECTS: Record<string, ItemEffect> = {
  beer: { tipsy: 1 / 8 },
  'red-wine': { tipsy: 1 / 6 },
  cocktail: { tipsy: 1.3 / 5 },
  whiskey: { tipsy: 1.2 / 4 },
  margarita: { tipsy: 1.2 / 6 },
  champagne: { tipsy: 0.8 / 6, bubbly: 4 * MIN },
  dom: { tipsy: 3 / 8, bubbly: 6 * MIN, party: 5 * MIN },
  espresso: { pace: { k: 1.2, ms: 3 * MIN } },
  'energy-drink': { pace: { k: 1.3, ms: 2 * MIN } },
  sliders: { fed: 5 * MIN },
  'truffle-fries': { fed: 4 * MIN },
  'shrimp-cocktail': { fed: 4 * MIN },
  lobster: { fed: 7 * MIN },
  caviar: { fed: 5 * MIN },
  ribeye: { fed: 8 * MIN },
  macarons: { fed: 3 * MIN },
  'birthday-cake': { fed: 5 * MIN, party: 3 * MIN },
};

/** The fastest the walker may be made to go: 1.3 of a run is 6.2 m/s, well under the floor server's 9. */
export const PACE_CAP = 1.3;
/** Pace time stacks (a second espresso adds its time) up to this much ahead (ms). */
export const PACE_STACK_MS = 8 * MIN;
/** Well fed stacks (a second plate adds its time) up to this much ahead (ms). */
export const FED_STACK_MS = 12 * MIN;
/** Tipsiness wears off at one drink every this many ms; twice as fast on a full stomach. */
export const SOBER_MS = 6 * MIN;
/** You can't get tipsier than this many drinks (the sway stays mild). */
export const TIPSY_MAX = 6;
/** Tipsy starts to show at this many drinks in you. */
export const TIPSY_FROM = 0.6;

export type ChipId = 'wired' | 'tipsy' | 'bubbly' | 'party' | 'fed';

export interface Chip {
  id: ChipId;
  name: string;
  /** Time left (ms), or null for one that wears off gradually (tipsy). */
  left: number | null;
  /** 0-1: how strong (tipsy's sway, a pace boost's size). */
  level: number;
}

export class Effects {
  private tipsy = 0;
  private tipsyAt = 0;
  private pace = { k: 1, until: 0 };
  private bubbly = 0;
  private party = 0;
  private fed = 0;

  /** One portion of `item` had at `now`; `first` for the order's first. */
  portion(item: string, now: number, first: boolean): void {
    const e = ITEM_EFFECTS[item];
    if (!e) return;
    if (e.tipsy) {
      this.tipsy = Math.min(TIPSY_MAX, this.tipsyNow(now) + e.tipsy);
      this.tipsyAt = now;
    }
    if (!first) return;
    if (e.pace) {
      const on = this.pace.until > now;
      this.pace = {
        k: Math.min(PACE_CAP, on ? Math.max(this.pace.k, e.pace.k) : e.pace.k),
        until: Math.min(now + PACE_STACK_MS, (on ? this.pace.until : now) + e.pace.ms),
      };
    }
    if (e.bubbly) this.bubbly = Math.max(this.bubbly, now + e.bubbly);
    if (e.party) this.party = Math.max(this.party, now + e.party);
  }

  /** The whole order had at `now`. */
  finished(item: string, now: number): void {
    const e = ITEM_EFFECTS[item];
    if (e?.fed) {
      // settle the tipsiness at the old rate up to now, then the full stomach speeds it
      this.tipsy = this.tipsyNow(now);
      this.tipsyAt = now;
      this.fed = Math.min(now + FED_STACK_MS, Math.max(this.fed, now) + e.fed);
    }
  }

  /** Drinks' worth in you now. */
  tipsyNow(now: number): number {
    const dt = Math.max(0, now - this.tipsyAt);
    // a full stomach doubles the rate for as long as it lasts
    const fedFor = Math.max(0, Math.min(dt, this.fed - this.tipsyAt));
    const gone = (dt + fedFor) / SOBER_MS;
    return Math.max(0, this.tipsy - gone);
  }

  /** How tipsy it looks, 0-1: nothing below TIPSY_FROM, growing to 1 at TIPSY_MAX. */
  sway(now: number): number {
    const t = this.tipsyNow(now);
    if (t <= TIPSY_FROM) return 0;
    return Math.min(1, (t - TIPSY_FROM) / (TIPSY_MAX - TIPSY_FROM));
  }

  /** The factor on walking and running now (1 = none). */
  paceNow(now: number): number {
    return this.pace.until > now ? Math.min(PACE_CAP, this.pace.k) : 1;
  }

  isFed(now: number): boolean {
    return this.fed > now;
  }

  isBubbly(now: number): boolean {
    return this.bubbly > now;
  }

  isParty(now: number): boolean {
    return this.party > now;
  }

  /** What's on you now, for the HUD. */
  chips(now: number): Chip[] {
    const out: Chip[] = [];
    if (this.pace.until > now) out.push({ id: 'wired', name: this.pace.k >= 1.3 ? 'Buzzing' : 'Wired', left: this.pace.until - now, level: (this.pace.k - 1) / (PACE_CAP - 1) });
    const sway = this.sway(now);
    if (sway > 0) out.push({ id: 'tipsy', name: sway > 0.6 ? 'Merry' : 'Tipsy', left: null, level: sway });
    if (this.bubbly > now) out.push({ id: 'bubbly', name: 'Bubbly', left: this.bubbly - now, level: 1 });
    if (this.party > now) out.push({ id: 'party', name: 'Celebrating', left: this.party - now, level: 1 });
    if (this.fed > now) out.push({ id: 'fed', name: 'Well fed', left: this.fed - now, level: 1 });
    return out;
  }
}
