// v7: apartments and what goes in them. An apartment is bought once (a casino_items row, like a
// car) and upgraded in steps, each its own row: the Residence, then the Grand renovation, then the
// Penthouse. Owning one puts "Your Apartment" on the elevator's panel; the floor sends only owners
// there (shared/src/lifts.ts). Everyone's apartment has the same plan (client/src/world/home/),
// and the step you've reached decides its finishes and what's built in.
//
// Home goods are sold at the home store across the street, and in the apartment itself at the spot
// each one goes: every piece has its place (a slot), several pieces fit the same place, and the
// dearest one you own stands there unless you've picked another or picked it up (the floor keeps
// your picks, and since v1.1 where you've moved each piece to).

import { DOLLAR, type Cents } from './money.ts';

export interface ApartmentItem {
  id: string;
  kind: 'apartment';
  name: string;
  price: Cents;
  about: string;
  /** 1, 2, 3: each needs the one before. */
  tier: number;
}

/** In order: each step needs the one before it. */
export const APARTMENTS: readonly ApartmentItem[] = [
  { id: 'apt-residence', kind: 'apartment', name: 'The Residence', price: 150_000 * DOLLAR, about: 'Floor 31: an open-plan flat with a kitchen, a bedroom and the city out of every window.', tier: 1 },
  { id: 'apt-grand', kind: 'apartment', name: 'Grand Renovation', price: 1_500_000 * DOLLAR, about: 'Marble floors, walnut panelling, a fireplace, a wet bar and lights in the ceiling coves.', tier: 2 },
  { id: 'apt-penthouse', kind: 'apartment', name: 'Penthouse Upgrade', price: 12_000_000 * DOLLAR, about: 'Gold fittings throughout, and on your balcony an infinity pool, a hot tub and a fire pit.', tier: 3 },
];

const APT_BY_ID = new Map(APARTMENTS.map((a) => [a.id, a]));

export function apartmentItem(id: unknown): ApartmentItem | null {
  return typeof id === 'string' ? (APT_BY_ID.get(id) ?? null) : null;
}

/** The highest step owned (0: no apartment). Steps count only in order: owning the third without the first counts nothing. */
export function homeTier(owned: Iterable<string>): number {
  const have = new Set(owned);
  let t = 0;
  for (const a of APARTMENTS) {
    if (!have.has(a.id)) break;
    t = a.tier;
  }
  return t;
}

/** Where a piece goes in the apartment (client/src/world/home/plan.ts places each). */
export type HomeSlot =
  | 'sofa'
  | 'tv'
  | 'bed'
  | 'rug'
  | 'art'
  | 'plant'
  | 'dining'
  | 'kitchen'
  | 'bar'
  | 'aquarium'
  | 'piano'
  | 'games'
  | 'arcade'
  | 'jukebox'
  | 'safe'
  | 'trophy'
  | 'sculpture'
  | 'neon'
  | 'telescope'
  | 'chandelier'
  | 'bath'
  // v1.1:
  | 'lamp'
  | 'books'
  | 'desk'
  | 'grill';

export interface HomeItem {
  id: string;
  kind: 'home';
  slot: HomeSlot;
  name: string;
  price: Cents;
  about: string;
  /** A style the builder reads (colours, size, a variant): free-form per slot. */
  style: string;
  /** The apartment step it needs to fit (the terrace's and the big pieces'): 1 if absent. */
  tier?: number;
}

export const HOME_ITEMS: readonly HomeItem[] = [
  // the living room
  { id: 'sofa-linen', kind: 'home', slot: 'sofa', name: 'Linen Sofa', price: 8_000 * DOLLAR, about: 'Three seats in oatmeal linen on oak legs.', style: 'linen' },
  { id: 'sofa-velvet', kind: 'home', slot: 'sofa', name: 'Velvet Sectional', price: 45_000 * DOLLAR, about: 'An emerald velvet L, deep enough to sleep on.', style: 'velvet' },
  { id: 'sofa-leather', kind: 'home', slot: 'sofa', name: 'Italian Leather Suite', price: 180_000 * DOLLAR, about: 'Cognac aniline leather, hand-stitched in Milan.', style: 'leather' },
  { id: 'tv-55', kind: 'home', slot: 'tv', name: '55-inch Television', price: 3_000 * DOLLAR, about: 'A 55-inch panel on a low walnut console.', style: '55' },
  { id: 'tv-85', kind: 'home', slot: 'tv', name: '85-inch OLED Wall', price: 25_000 * DOLLAR, about: 'An 85-inch OLED, wall-hung, with a soundbar.', style: '85' },
  { id: 'tv-cinema', kind: 'home', slot: 'tv', name: 'Cinema Wall', price: 250_000 * DOLLAR, about: 'A 150-inch laser screen and seven speakers behind the walls.', style: 'cinema' },
  { id: 'rug-wool', kind: 'home', slot: 'rug', name: 'Wool Rug', price: 4_000 * DOLLAR, about: 'Hand-tufted wool in charcoal and cream.', style: 'wool' },
  { id: 'rug-persian', kind: 'home', slot: 'rug', name: 'Antique Persian Rug', price: 90_000 * DOLLAR, about: 'A 19th-century Tabriz in madder red and indigo.', style: 'persian' },
  { id: 'art-print', kind: 'home', slot: 'art', name: 'Framed Print', price: 2_500 * DOLLAR, about: 'A skyline print in a black frame.', style: 'print' },
  { id: 'art-abstract', kind: 'home', slot: 'art', name: 'Abstract Canvas', price: 60_000 * DOLLAR, about: 'A big canvas of gold leaf and ink, signed.', style: 'abstract' },
  { id: 'art-master', kind: 'home', slot: 'art', name: 'Old Master', price: 8_000_000 * DOLLAR, about: 'A 17th-century oil in a carved gilt frame, lit from above.', style: 'master' },
  { id: 'plant-fig', kind: 'home', slot: 'plant', name: 'Fiddle-Leaf Fig', price: 400 * DOLLAR, about: 'Six feet of fig in a stoneware pot.', style: 'fig' },
  { id: 'plant-olive', kind: 'home', slot: 'plant', name: 'Olive Tree', price: 6_000 * DOLLAR, about: 'A hundred-year-old olive in a terracotta urn.', style: 'olive' },
  { id: 'chandelier-glass', kind: 'home', slot: 'chandelier', name: 'Glass Pendant Cluster', price: 12_000 * DOLLAR, about: 'Twelve hand-blown globes over the dining table.', style: 'glass' },
  { id: 'chandelier-crystal', kind: 'home', slot: 'chandelier', name: 'Crystal Chandelier', price: 150_000 * DOLLAR, about: 'Bohemian crystal, three tiers, a hundred lights.', style: 'crystal' },
  // eating and drinking
  { id: 'dining-oak', kind: 'home', slot: 'dining', name: 'Oak Dining Table', price: 6_000 * DOLLAR, about: 'Solid oak for six, with upholstered chairs.', style: 'oak' },
  { id: 'dining-marble', kind: 'home', slot: 'dining', name: 'Marble Dining Table', price: 70_000 * DOLLAR, about: 'Calacatta marble for ten on a brass base.', style: 'marble' },
  { id: 'kitchen-espresso', kind: 'home', slot: 'kitchen', name: 'Espresso Machine', price: 5_000 * DOLLAR, about: 'A twin-boiler machine in brushed steel.', style: 'espresso' },
  // v7.4: every apartment comes with a tired old kitchen and bathroom; these replace them
  { id: 'kitchen-modern', kind: 'home', slot: 'kitchen', name: 'Modern Kitchen', price: 25_000 * DOLLAR, about: 'White flat-front units, quartz tops, a steel fridge and an induction hob, in place of the old kitchen.', style: 'modern' },
  { id: 'bath-marble', kind: 'home', slot: 'bath', name: 'Marble Bathroom', price: 40_000 * DOLLAR, about: 'Marble walls, a glass walk-in shower and a floating vanity, in place of the old bathroom.', style: 'marble' },
  { id: 'bath-spa', kind: 'home', slot: 'bath', name: 'Spa Bathroom', price: 350_000 * DOLLAR, about: 'A copper soaking tub, a rain shower and gold taps under a lit ceiling.', style: 'spa', tier: 2 },
  { id: 'kitchen-chef', kind: 'home', slot: 'kitchen', name: "Chef's Kitchen", price: 120_000 * DOLLAR, about: 'A six-burner range, a copper hood and a marble island.', style: 'chef' },
  { id: 'bar-cart', kind: 'home', slot: 'bar', name: 'Brass Bar Cart', price: 3_500 * DOLLAR, about: 'Two tiers of brass and glass, stocked.', style: 'cart' },
  { id: 'bar-wine', kind: 'home', slot: 'bar', name: 'Wine Wall', price: 200_000 * DOLLAR, about: 'Four hundred bottles behind glass, kept at 55 degrees.', style: 'wine', tier: 2 },
  // the bedroom
  { id: 'bed-queen', kind: 'home', slot: 'bed', name: 'Queen Bed', price: 5_000 * DOLLAR, about: 'An upholstered queen with white linen.', style: 'queen' },
  { id: 'bed-king', kind: 'home', slot: 'bed', name: 'King Canopy Bed', price: 60_000 * DOLLAR, about: 'A walnut four-poster with a linen canopy.', style: 'canopy' },
  { id: 'bed-round', kind: 'home', slot: 'bed', name: 'Round Velvet Bed', price: 400_000 * DOLLAR, about: 'Nine feet across in crimson velvet, gold rails, silk sheets.', style: 'round' },
  // play
  { id: 'games-pool', kind: 'home', slot: 'games', name: 'Pool Table', price: 30_000 * DOLLAR, about: 'Eight feet of slate and green baize, cues on the wall.', style: 'pool' },
  { id: 'games-poker', kind: 'home', slot: 'games', name: 'Poker Table', price: 25_000 * DOLLAR, about: 'Your own felt for ten, a rail of cup holders.', style: 'poker' },
  { id: 'arcade-cab', kind: 'home', slot: 'arcade', name: 'Arcade Cabinet', price: 9_000 * DOLLAR, about: 'An upright cabinet with a glowing marquee.', style: 'cab' },
  { id: 'jukebox', kind: 'home', slot: 'jukebox', name: 'Chrome Jukebox', price: 22_000 * DOLLAR, about: 'Bubble tubes, chrome and a hundred records.', style: 'jukebox' },
  { id: 'piano-grand', kind: 'home', slot: 'piano', name: 'Concert Grand Piano', price: 220_000 * DOLLAR, about: 'Nine feet of ebony by the window.', style: 'ebony' },
  { id: 'piano-white', kind: 'home', slot: 'piano', name: 'White Lacquer Grand', price: 350_000 * DOLLAR, about: 'The same grand in white lacquer, as the stars have them.', style: 'white' },
  { id: 'aquarium-reef', kind: 'home', slot: 'aquarium', name: 'Reef Aquarium', price: 75_000 * DOLLAR, about: 'Two thousand litres of reef, lit blue, set into the wall.', style: 'reef' },
  { id: 'aquarium-shark', kind: 'home', slot: 'aquarium', name: 'Shark Tank', price: 2_000_000 * DOLLAR, about: 'Floor-to-ceiling glass with a pair of reef sharks.', style: 'shark', tier: 2 },
  // show
  { id: 'safe-steel', kind: 'home', slot: 'safe', name: 'Steel Safe', price: 15_000 * DOLLAR, about: 'A fireproof safe with a brass dial.', style: 'steel' },
  { id: 'safe-vault', kind: 'home', slot: 'safe', name: 'Vault Door', price: 900_000 * DOLLAR, about: 'A bank-vault door in the wall, bolts and a wheel.', style: 'vault', tier: 2 },
  { id: 'trophy-case', kind: 'home', slot: 'trophy', name: 'Trophy Case', price: 18_000 * DOLLAR, about: 'Lit glass shelves of trophies and chips.', style: 'case' },
  { id: 'sculpture-bronze', kind: 'home', slot: 'sculpture', name: 'Bronze Sculpture', price: 140_000 * DOLLAR, about: 'A life-size bronze on a marble plinth.', style: 'bronze' },
  { id: 'sculpture-gold', kind: 'home', slot: 'sculpture', name: 'Solid Gold Bull', price: 25_000_000 * DOLLAR, about: 'A charging bull cast in solid gold.', style: 'gold', tier: 3 },
  { id: 'neon-sign', kind: 'home', slot: 'neon', name: 'Neon Sign', price: 6_000 * DOLLAR, about: '"JACKPOT" in pink neon over the bar.', style: 'jackpot' },
  { id: 'telescope-brass', kind: 'home', slot: 'telescope', name: 'Brass Telescope', price: 35_000 * DOLLAR, about: 'A brass refractor on a tripod by the window.', style: 'brass' },
  // v1.1: more for the slots there were
  { id: 'sofa-chesterfield', kind: 'home', slot: 'sofa', name: 'Chesterfield', price: 95_000 * DOLLAR, about: 'Oxblood leather, deep-buttoned, rolled arms and brass studs.', style: 'chesterfield' },
  { id: 'rug-silk', kind: 'home', slot: 'rug', name: 'Silk Rug', price: 30_000 * DOLLAR, about: 'Midnight-blue silk with a border of gold.', style: 'silk' },
  { id: 'plant-palm', kind: 'home', slot: 'plant', name: 'Kentia Palm', price: 1_200 * DOLLAR, about: 'A tall palm in a white planter.', style: 'palm' },
  { id: 'plant-bonsai', kind: 'home', slot: 'plant', name: 'Bonsai on a Plinth', price: 15_000 * DOLLAR, about: 'An eighty-year-old juniper on a walnut stand.', style: 'bonsai' },
  { id: 'bed-platform', kind: 'home', slot: 'bed', name: 'Low Platform Bed', price: 18_000 * DOLLAR, about: 'A low oak platform with a padded headboard and grey linen.', style: 'platform' },
  { id: 'dining-glass', kind: 'home', slot: 'dining', name: 'Glass Dining Table', price: 22_000 * DOLLAR, about: 'Smoked glass for eight on chrome legs, with white leather chairs.', style: 'glass' },
  { id: 'games-air', kind: 'home', slot: 'games', name: 'Air Hockey Table', price: 12_000 * DOLLAR, about: 'Full size, lit rails, two mallets and a puck.', style: 'air' },
  { id: 'arcade-pinball', kind: 'home', slot: 'arcade', name: 'Pinball Machine', price: 14_000 * DOLLAR, about: 'A Vegas-themed table with a lit backglass.', style: 'pinball' },
  // v1.1: new places to fill
  { id: 'lamp-arc', kind: 'home', slot: 'lamp', name: 'Arc Floor Lamp', price: 3_200 * DOLLAR, about: 'A steel arc over the sofa on a marble foot.', style: 'arc' },
  { id: 'lamp-crystal', kind: 'home', slot: 'lamp', name: 'Crystal Floor Lamp', price: 28_000 * DOLLAR, about: 'Tiers of cut crystal on a gilt stem.', style: 'crystal' },
  { id: 'books-oak', kind: 'home', slot: 'books', name: 'Oak Bookcase', price: 7_000 * DOLLAR, about: 'Five shelves of oak, filled.', style: 'oak' },
  { id: 'books-library', kind: 'home', slot: 'books', name: 'Library Wall', price: 85_000 * DOLLAR, about: 'Walnut shelves to the ceiling, a rolling brass ladder and first editions.', style: 'library', tier: 2 },
  { id: 'desk-writing', kind: 'home', slot: 'desk', name: 'Writing Desk', price: 9_000 * DOLLAR, about: 'A walnut desk by the window with a brass lamp.', style: 'writing' },
  { id: 'desk-exec', kind: 'home', slot: 'desk', name: 'Executive Desk', price: 48_000 * DOLLAR, about: 'Black lacquer and leather, three screens and a leather chair.', style: 'exec' },
  { id: 'grill-kettle', kind: 'home', slot: 'grill', name: 'Kettle Grill', price: 900 * DOLLAR, about: 'A black kettle barbecue for the balcony.', style: 'kettle' },
  { id: 'grill-outdoor', kind: 'home', slot: 'grill', name: 'Outdoor Kitchen', price: 65_000 * DOLLAR, about: 'A steel grill, a stone counter and a bar fridge on the balcony.', style: 'outdoor' },
];

const HOME_BY_ID = new Map(HOME_ITEMS.map((h) => [h.id, h]));

export function homeItem(id: unknown): HomeItem | null {
  return typeof id === 'string' ? (HOME_BY_ID.get(id) ?? null) : null;
}

/** What each slot is called on its card and its prompt. */
export const SLOT_NAMES: Record<HomeSlot, string> = {
  sofa: 'Sofa',
  tv: 'Television',
  bed: 'Bed',
  rug: 'Rug',
  art: 'Art',
  plant: 'Plant',
  dining: 'Dining table',
  kitchen: 'Kitchen',
  bar: 'Bar',
  aquarium: 'Aquarium',
  piano: 'Piano',
  games: 'Games table',
  arcade: 'Arcade',
  jukebox: 'Jukebox',
  safe: 'Safe',
  trophy: 'Trophy case',
  sculpture: 'Sculpture',
  neon: 'Neon',
  telescope: 'Telescope',
  chandelier: 'Chandelier',
  bath: 'Bathroom',
  lamp: 'Floor lamp',
  books: 'Bookcase',
  desk: 'Desk',
  grill: 'Grill',
};

/**
 * v1.1: an owner can pick a piece up (the slot left empty until they put one back): a pick of
 * STOWED. The kitchen and the bathroom are built in and can't be.
 */
export const STOWED = '';

/** The slots whose piece can't be picked up (built in). */
export const BUILT_IN: ReadonlySet<HomeSlot> = new Set(['kitchen', 'bath']);

/**
 * v1.1: the pieces an owner can move about their apartment (the ones standing on the floor; what
 * hangs on or is set into a wall stays where it is): where each stands, in cm, and which way it
 * faces (a yaw byte, 256 to a turn, 0 facing +z).
 */
export const MOVABLE: ReadonlySet<HomeSlot> = new Set(['sofa', 'bed', 'dining', 'games', 'arcade', 'jukebox', 'piano', 'plant', 'sculpture', 'telescope', 'lamp', 'books', 'desk', 'grill', 'bar']);

export interface HomePlace {
  x: number;
  z: number;
  r: number;
}

/** The flat and its balcony (cm; plan.ts APT and TERRACE): a moved piece's middle stays in here. */
export const PLACE_BOUNDS = { x0: -15_400, x1: -12_140, z0: 5_800, z1: 8_400, flatX1: -13_000, terraceZ0: 6_000, terraceZ1: 8_200 } as const;

/** A moved piece's place is somewhere in the flat or on its balcony (the client checks the walls and the rest). */
export function placeOk(p: HomePlace): boolean {
  const B = PLACE_BOUNDS;
  if (![p.x, p.z, p.r].every(Number.isInteger) || p.r < 0 || p.r > 255) return false;
  if (p.x < B.x0 || p.x > B.x1 || p.z < B.z0 || p.z > B.z1) return false;
  return p.x <= B.flatX1 || (p.z >= B.terraceZ0 && p.z <= B.terraceZ1);
}

/**
 * The piece that stands in a slot: none if it was picked up (STOWED), the one picked (if still
 * owned), else the dearest owned that the apartment's step allows, else null (the slot is empty).
 */
export function pieceIn(slot: HomeSlot, owned: ReadonlySet<string>, tier: number, picked: string | null): HomeItem | null {
  if (picked === STOWED && !BUILT_IN.has(slot)) return null;
  const fits = HOME_ITEMS.filter((h) => h.slot === slot && owned.has(h.id) && (h.tier ?? 1) <= tier);
  const chosen = picked ? fits.find((h) => h.id === picked) : undefined;
  if (chosen) return chosen;
  return fits.reduce<HomeItem | null>((best, h) => (!best || h.price > best.price ? h : best), null);
}
