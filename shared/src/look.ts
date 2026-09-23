// A character's appearance. Stored as JSON on the account, sent to everyone on the floor, and
// drawn by the world from the outfit models. Every field is checked before it is stored.

export const BODIES = ['m', 'f'] as const;
export type Body = (typeof BODIES)[number];

/** Outfit models per body. The ids name GLB outfits in the world's character set. */
export const OUTFITS: Record<Body, readonly string[]> = {
  m: ['suit', 'casual', 'hoodie', 'punk', 'beach'],
  f: ['dress', 'smart', 'punk'],
};

/** Skin tones, lightest to darkest. */
export const SKIN_TONES = ['#f3d2b9', '#e8b996', '#d49b76', '#b87c56', '#94603f', '#744630', '#5a3424', '#3f2419'] as const;

export interface Look {
  v: 1;
  body: Body;
  outfit: string;
  skin: number;
  hair: string;
  top: string;
  bottom: string;
  shoes: string;
}

export const DEFAULT_LOOK: Look = {
  v: 1,
  body: 'm',
  outfit: 'suit',
  skin: 2,
  hair: '#2b1d14',
  top: '#1f2430',
  bottom: '#1f2430',
  shoes: '#111111',
};

const HEX = /^#[0-9a-f]{6}$/i;

/** A clean Look from untrusted input, or null. Unknown keys are dropped. */
export function parseLook(raw: unknown): Look | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (o.body !== 'm' && o.body !== 'f') return null;
  const body = o.body;
  if (typeof o.outfit !== 'string' || !OUTFITS[body].includes(o.outfit)) return null;
  if (!Number.isInteger(o.skin) || (o.skin as number) < 0 || (o.skin as number) >= SKIN_TONES.length) return null;
  for (const k of ['hair', 'top', 'bottom', 'shoes'] as const) {
    if (typeof o[k] !== 'string' || !HEX.test(o[k] as string)) return null;
  }
  return {
    v: 1,
    body,
    outfit: o.outfit,
    skin: o.skin as number,
    // Colour pickers hand back either case; one spelling per colour keeps stored looks comparable.
    hair: (o.hair as string).toLowerCase(),
    top: (o.top as string).toLowerCase(),
    bottom: (o.bottom as string).toLowerCase(),
    shoes: (o.shoes as string).toLowerCase(),
  };
}

/** Parse stored JSON, falling back to the default look for anything missing or broken. */
export function lookFromJson(json: string | null | undefined): Look {
  if (!json) return DEFAULT_LOOK;
  try {
    return parseLook(JSON.parse(json)) ?? DEFAULT_LOOK;
  } catch {
    return DEFAULT_LOOK;
  }
}
