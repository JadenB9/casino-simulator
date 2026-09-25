// The cars' shapes, as data for the body builder (models.ts). Each car is a side silhouette (the
// body's top line from the tail to the nose, and the glasshouse's), how wide it is, where the wheels
// are and what they look like, and a few extras (fins, a wing, roof lamps, stripes). Everything is
// in metres, the car's own frame: +z forward, +x to its left, y up, the ground at 0.
//
// None of these is a real make or model: each only has the proportions of its kind.

export type RimStyle = 'wire' | 'five' | 'dish' | 'mesh' | 'turbine';
export type LampStyle = 'round' | 'quad' | 'rect' | 'slit';

export interface CarSpec {
  /** The body's top line, tail to nose: [z, y]. The builder closes it along the sills and round the wheel arches. */
  body: [number, number][];
  /** Half the body's width (before the bevel). */
  half: number;
  /** Front and rear axle z; the wheels' radius and width. */
  front: number;
  rear: number;
  wheelR: number;
  wheelW: number;
  /** The sills' height: the body's bottom edge between the arches. */
  sill: number;
  /** How much of the half-width the nose and the tail lose (plan view), over how many metres. */
  nose: [k: number, len: number];
  tail: [k: number, len: number];
  /** The sides lean in above this height, by this fraction at the top. */
  shoulder: number;
  tumble: number;
  /** The glasshouse's side line, tail to nose [z, y]; closed along its base. Absent: an open car. */
  cabin?: [number, number][];
  /** The glasshouse's half-width at its base, and how much it narrows at the top (fraction). */
  cabinHalf?: number;
  cabinTumble?: number;
  /** The glasshouse's sides are painted behind this z (the pillar behind the last window). */
  sail?: number;
  /** An open car: the windscreen's base (z, y), its height and rake; the cockpit's z range. */
  open?: { screenZ: number; screenY: number; screenH: number; rake: number; cockpit: [number, number]; seats: number };
  paint: string;
  /** Stripes down the middle (colour), on the body (and the roof). */
  stripes?: string;
  interior: string;
  lamps: LampStyle;
  /** Headlamps' and tail lamps' height, and how far out from the middle. */
  lampY: number;
  lampX: number;
  tailY: number;
  rim: RimStyle;
  /** Rim colour (the metal's vertex colour): chrome by default. */
  rimColor?: string;
  whitewall?: boolean;
  /** Chrome bumpers (the older cars), else body-coloured and black. */
  chrome?: boolean;
  grille: 'upright' | 'wide' | 'oval' | 'intake';
  wing?: { z: number; y: number; half: number };
  roofLamps?: boolean;
  roofRails?: boolean;
  fins?: boolean;
  /** Extra window pillars down each side (the stretch's). */
  pillars?: number[];
  /** A boat-tail's teak deck from z0 to z1. */
  deck?: [number, number];
  /** Side intakes ahead of the rear wheels (mid-engined). */
  intakes?: boolean;
  /** The paint is gold leaf: the body and the metal are all gold. */
  gold?: boolean;
}

const roadster: CarSpec = {
  body: [[-1.95, 0.34], [-1.95, 0.62], [-1.82, 0.78], [-1.5, 0.84], [-0.78, 0.84], [-0.7, 0.8], [0.12, 0.8], [0.25, 0.84], [1.25, 0.82], [1.7, 0.74], [1.92, 0.6], [1.95, 0.38]],
  half: 0.74,
  front: 1.17,
  rear: -1.15,
  wheelR: 0.31,
  wheelW: 0.17,
  sill: 0.25,
  nose: [0.2, 0.7],
  tail: [0.14, 0.6],
  shoulder: 0.5,
  tumble: 0.1,
  open: { screenZ: 0.24, screenY: 0.84, screenH: 0.3, rake: 0.5, cockpit: [-0.7, 0.14], seats: 2 },
  paint: '#1f4a33',
  interior: '#8a5a36',
  lamps: 'round',
  lampY: 0.64,
  lampX: 0.5,
  tailY: 0.66,
  rim: 'wire',
  chrome: true,
  grille: 'oval',
};

const rally: CarSpec = {
  body: [[-2.02, 0.4], [-2.02, 0.86], [-1.96, 0.98], [0.92, 1.0], [1.8, 0.88], [2.02, 0.72], [2.02, 0.42]],
  half: 0.86,
  front: 1.3,
  rear: -1.25,
  wheelR: 0.33,
  wheelW: 0.22,
  sill: 0.32,
  nose: [0.1, 0.5],
  tail: [0.06, 0.4],
  shoulder: 0.7,
  tumble: 0.06,
  cabin: [[-1.94, 0.95], [-1.84, 1.42], [-1.62, 1.5], [0.12, 1.52], [0.98, 0.98]],
  cabinHalf: 0.8,
  cabinTumble: 0.14,
  sail: -1.72,
  paint: '#eceef0',
  stripes: '#1d4fbf',
  interior: '#2a2a2c',
  lamps: 'rect',
  lampY: 0.78,
  lampX: 0.6,
  tailY: 0.84,
  rim: 'five',
  rimColor: '#c9a24b',
  grille: 'wide',
  wing: { z: -1.84, y: 1.52, half: 0.78 },
  roofLamps: true,
};

const muscle: CarSpec = {
  body: [[-2.5, 0.38], [-2.5, 0.84], [-2.36, 0.96], [-1.6, 0.94], [0.6, 0.94], [2.3, 0.9], [2.48, 0.8], [2.5, 0.4]],
  half: 0.92,
  front: 1.5,
  rear: -1.33,
  wheelR: 0.35,
  wheelW: 0.26,
  sill: 0.29,
  nose: [0.06, 0.4],
  tail: [0.05, 0.4],
  shoulder: 0.66,
  tumble: 0.06,
  cabin: [[-1.72, 0.9], [-0.62, 1.34], [0.3, 1.36], [0.98, 0.92]],
  cabinHalf: 0.78,
  cabinTumble: 0.18,
  sail: -0.8,
  paint: '#16233f',
  stripes: '#eef0f2',
  interior: '#1c1c1e',
  lamps: 'quad',
  lampY: 0.72,
  lampX: 0.62,
  tailY: 0.78,
  rim: 'five',
  chrome: true,
  grille: 'wide',
};

const cabriolet: CarSpec = {
  body: [[-2.65, 0.42], [-2.65, 0.8], [-2.35, 0.88], [-1.25, 0.88], [-1.18, 0.84], [0.62, 0.84], [0.72, 0.9], [2.4, 0.86], [2.62, 0.72], [2.65, 0.44]],
  half: 0.95,
  front: 1.55,
  rear: -1.45,
  wheelR: 0.36,
  wheelW: 0.2,
  sill: 0.28,
  nose: [0.1, 0.6],
  tail: [0.04, 0.5],
  shoulder: 0.6,
  tumble: 0.05,
  open: { screenZ: 0.72, screenY: 0.9, screenH: 0.34, rake: 0.55, cockpit: [-1.18, 0.64], seats: 4 },
  paint: '#ece0bf',
  interior: '#8e1b1b',
  lamps: 'round',
  lampY: 0.7,
  lampX: 0.68,
  tailY: 0.76,
  rim: 'dish',
  whitewall: true,
  chrome: true,
  grille: 'wide',
  fins: true,
};

const suv: CarSpec = {
  body: [[-2.55, 0.56], [-2.55, 1.16], [-2.5, 1.22], [1.62, 1.22], [2.42, 1.18], [2.55, 1.04], [2.55, 0.56]],
  half: 0.96,
  front: 1.55,
  rear: -1.48,
  wheelR: 0.42,
  wheelW: 0.28,
  sill: 0.5,
  nose: [0.05, 0.3],
  tail: [0.03, 0.3],
  shoulder: 1.0,
  tumble: 0.04,
  cabin: [[-2.49, 1.18], [-2.44, 1.88], [-2.3, 1.95], [0.92, 1.95], [1.64, 1.2]],
  cabinHalf: 0.9,
  cabinTumble: 0.1,
  sail: -2.28,
  pillars: [-0.3, -1.45],
  paint: '#121316',
  interior: '#1a1a1a',
  lamps: 'rect',
  lampY: 1.02,
  lampX: 0.68,
  tailY: 1.1,
  rim: 'turbine',
  rimColor: '#3c3f44',
  grille: 'upright',
  roofRails: true,
};

const saloon: CarSpec = {
  body: [[-2.7, 0.42], [-2.7, 0.9], [-2.58, 1.0], [-1.6, 1.02], [1.2, 1.02], [2.55, 0.96], [2.7, 0.82], [2.7, 0.44]],
  half: 0.94,
  front: 1.62,
  rear: -1.66,
  wheelR: 0.37,
  wheelW: 0.25,
  sill: 0.31,
  nose: [0.05, 0.4],
  tail: [0.05, 0.4],
  shoulder: 0.8,
  tumble: 0.06,
  cabin: [[-1.66, 0.98], [-1.06, 1.5], [0.36, 1.52], [1.22, 0.99]],
  cabinHalf: 0.82,
  cabinTumble: 0.16,
  sail: -1.22,
  pillars: [-0.25],
  paint: '#15203a',
  interior: '#c9b89a',
  lamps: 'rect',
  lampY: 0.84,
  lampX: 0.66,
  tailY: 0.9,
  rim: 'mesh',
  chrome: true,
  grille: 'upright',
};

const stretch: CarSpec = {
  ...saloon,
  body: [[-3.8, 0.42], [-3.8, 0.9], [-3.68, 1.0], [-2.7, 1.02], [2.3, 1.02], [3.65, 0.96], [3.8, 0.82], [3.8, 0.44]],
  front: 2.72,
  rear: -2.76,
  cabin: [[-2.76, 0.98], [-2.16, 1.5], [1.46, 1.52], [2.32, 0.99]],
  paint: '#0d0e10',
  interior: '#2b2320',
  sail: -2.32,
  pillars: [-1.1, 0.35],
};

const supercar: CarSpec = {
  body: [[-2.25, 0.3], [-2.25, 0.78], [-2.1, 0.88], [-1.0, 0.9], [0.9, 0.76], [1.9, 0.58], [2.22, 0.44], [2.25, 0.3]],
  half: 0.96,
  front: 1.38,
  rear: -1.27,
  wheelR: 0.35,
  wheelW: 0.3,
  sill: 0.2,
  nose: [0.22, 0.9],
  tail: [0.08, 0.5],
  shoulder: 0.55,
  tumble: 0.1,
  cabin: [[-1.16, 0.88], [-0.42, 1.16], [0.1, 1.18], [1.06, 0.72]],
  cabinHalf: 0.72,
  cabinTumble: 0.22,
  sail: -0.72,
  paint: '#e5561b',
  interior: '#18181a',
  lamps: 'slit',
  lampY: 0.56,
  lampX: 0.62,
  tailY: 0.78,
  rim: 'five',
  rimColor: '#2b2d31',
  grille: 'intake',
  wing: { z: -1.95, y: 1.06, half: 0.8 },
  intakes: true,
};

const gt: CarSpec = {
  body: [[-2.2, 0.36], [-2.2, 0.78], [-2.1, 0.86], [-1.25, 0.86], [0.6, 0.84], [1.9, 0.76], [2.18, 0.56], [2.2, 0.36]],
  half: 0.8,
  front: 1.28,
  rear: -1.12,
  wheelR: 0.33,
  wheelW: 0.2,
  sill: 0.25,
  nose: [0.26, 0.9],
  tail: [0.1, 0.5],
  shoulder: 0.5,
  tumble: 0.1,
  cabin: [[-1.42, 0.84], [-0.52, 1.2], [0.08, 1.22], [0.72, 0.84]],
  cabinHalf: 0.66,
  cabinTumble: 0.2,
  sail: -0.95,
  paint: '#a3161b',
  interior: '#3a2a1e',
  lamps: 'round',
  lampY: 0.64,
  lampX: 0.5,
  tailY: 0.72,
  rim: 'wire',
  chrome: true,
  grille: 'oval',
};

const hyper: CarSpec = {
  body: [[-2.35, 0.28], [-2.35, 0.64], [-2.2, 0.8], [-1.0, 0.84], [1.0, 0.66], [2.0, 0.46], [2.32, 0.34], [2.35, 0.24]],
  half: 1.0,
  front: 1.42,
  rear: -1.33,
  wheelR: 0.36,
  wheelW: 0.32,
  sill: 0.17,
  nose: [0.2, 0.9],
  tail: [0.14, 0.7],
  shoulder: 0.45,
  tumble: 0.12,
  cabin: [[-1.24, 0.82], [-0.5, 1.12], [0.05, 1.13], [1.12, 0.64]],
  cabinHalf: 0.7,
  cabinTumble: 0.24,
  sail: -0.78,
  paint: '#26303b',
  interior: '#141416',
  lamps: 'slit',
  lampY: 0.48,
  lampX: 0.7,
  tailY: 0.68,
  rim: 'turbine',
  rimColor: '#1d1f22',
  grille: 'intake',
  wing: { z: -2.12, y: 0.98, half: 0.86 },
  intakes: true,
};

const boattail: CarSpec = {
  body: [[-2.95, 0.5], [-2.85, 0.8], [-2.5, 0.9], [-1.25, 0.92], [-1.18, 0.86], [0.6, 0.86], [0.7, 0.92], [2.6, 0.9], [2.82, 0.76], [2.85, 0.46]],
  half: 0.97,
  front: 1.72,
  rear: -1.6,
  wheelR: 0.37,
  wheelW: 0.24,
  sill: 0.29,
  nose: [0.08, 0.5],
  tail: [0.6, 1.6],
  shoulder: 0.62,
  tumble: 0.06,
  open: { screenZ: 0.7, screenY: 0.92, screenH: 0.3, rake: 0.6, cockpit: [-1.18, 0.62], seats: 2 },
  paint: '#9fb6c9',
  interior: '#b08a60',
  lamps: 'round',
  lampY: 0.72,
  lampX: 0.66,
  tailY: 0.72,
  rim: 'dish',
  chrome: true,
  grille: 'upright',
  deck: [-2.7, -1.3],
};

/** Each catalog car's shape (items.ts CARS). */
export const CAR_SPECS: Record<string, CarSpec> = {
  'halden-roadster': roadster,
  'brenner-rally': rally,
  'stallard-440': muscle,
  'solenne-cabriolet': cabriolet,
  'ardent-overland': suv,
  'aurelian-saloon': saloon,
  'aurelian-stretch': stretch,
  'raffica-v10': supercar,
  'strale-gt': gt,
  'ombra-hyper': hyper,
  'halden-boattail': boattail,
  'ombra-oro': { ...hyper, paint: '#d4a53c', gold: true, rimColor: '#e0b84a' },
};

/** Colours a parked car might be, for the valet lot (real paint colours, mostly quiet). */
export const LOT_PAINTS = ['#101113', '#e9eaec', '#8d949b', '#2d3138', '#1b2b4a', '#5a0f16', '#1f3a2c', '#c9c3b6', '#34414f', '#6d1f1f', '#d8d2c4', '#0f1a2a'];
