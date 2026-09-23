// Curated colours for the character editor. Evening-wear fabrics and natural hair, plus two
// dyed shades for the punk looks; every value is lowercase #rrggbb, which is what the server's
// look validator accepts.

import { OUTFITS, SKIN_TONES, type Body } from '../../../../shared/src/look.ts';

export interface Swatch {
  hex: string;
  name: string;
}

export const HAIR: readonly Swatch[] = [
  { hex: '#16110d', name: 'Jet' },
  { hex: '#2b1d14', name: 'Dark brown' },
  { hex: '#4a2e1c', name: 'Chestnut' },
  { hex: '#6e3b22', name: 'Auburn' },
  { hex: '#9a5a2c', name: 'Copper' },
  { hex: '#b8894e', name: 'Honey' },
  { hex: '#d8c29a', name: 'Platinum' },
  { hex: '#8c877f', name: 'Silver' },
  { hex: '#5a2438', name: 'Plum' },
  { hex: '#2f4f7a', name: 'Ink blue' },
];

export const TOPS: readonly Swatch[] = [
  { hex: '#1f2430', name: 'Midnight' },
  { hex: '#121212', name: 'Black' },
  { hex: '#3b3f46', name: 'Charcoal' },
  { hex: '#ece6d8', name: 'Ivory' },
  { hex: '#6b1f2a', name: 'Burgundy' },
  { hex: '#1f4636', name: 'Racing green' },
  { hex: '#22325a', name: 'Navy' },
  { hex: '#a3794c', name: 'Camel' },
  { hex: '#c2a15a', name: 'Champagne' },
  { hex: '#8e2330', name: 'Crimson' },
  { hex: '#1b5c57', name: 'Teal' },
  { hex: '#5b4a7a', name: 'Amethyst' },
];

export const BOTTOMS: readonly Swatch[] = [
  { hex: '#1f2430', name: 'Midnight' },
  { hex: '#121212', name: 'Black' },
  { hex: '#3b3f46', name: 'Charcoal' },
  { hex: '#8f8266', name: 'Khaki' },
  { hex: '#c9bfa9', name: 'Stone' },
  { hex: '#3c526f', name: 'Denim' },
  { hex: '#22325a', name: 'Navy' },
  { hex: '#4b3527', name: 'Walnut' },
  { hex: '#5c1c27', name: 'Oxblood' },
  { hex: '#e9e4d8', name: 'White' },
];

export const SHOES: readonly Swatch[] = [
  { hex: '#111111', name: 'Black' },
  { hex: '#2e1f16', name: 'Espresso' },
  { hex: '#4a1a1c', name: 'Oxblood' },
  { hex: '#8a5a34', name: 'Tan' },
  { hex: '#ece8df', name: 'White' },
  { hex: '#5c5f66', name: 'Slate' },
  { hex: '#1d2436', name: 'Navy' },
  { hex: '#b8923e', name: 'Gold' },
];

const SKIN_NAMES = ['Very light', 'Light', 'Light medium', 'Medium', 'Medium deep', 'Deep', 'Very deep', 'Darkest'];

export const SKINS: readonly Swatch[] = SKIN_TONES.map((hex, i) => ({ hex, name: SKIN_NAMES[i] ?? `Tone ${i + 1}` }));

const OUTFIT_NAMES: Record<string, string> = {
  suit: 'Suit',
  casual: 'Casual',
  hoodie: 'Hoodie',
  punk: 'Punk',
  beach: 'Beach',
  dress: 'Dress',
  smart: 'Smart',
};

export function outfitName(id: string): string {
  return OUTFIT_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export const BODY_CHOICES: readonly { id: Body; label: string }[] = [
  { id: 'm', label: 'Male' },
  { id: 'f', label: 'Female' },
];

// The nearest outfit on the other body, so switching back and forth lands where it started.
const ACROSS: Record<string, string> = {
  suit: 'dress',
  casual: 'smart',
  hoodie: 'smart',
  punk: 'punk',
  beach: 'dress',
  dress: 'suit',
  smart: 'suit',
};

export function outfitFor(body: Body, outfit: string): string {
  const list = OUTFITS[body];
  if (list.includes(outfit)) return outfit;
  const near = ACROSS[outfit];
  return near && list.includes(near) ? near : list[0]!;
}
