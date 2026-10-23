// The HUD's tools: every action the HUD offers, as one list. A tool is a button its own module
// builds (its icon, its click, any state it shows: aria-pressed, a badge) plus what the HUD needs
// to place it and name it: a label for the tooltip, the More panel and the palette, a group, an
// order, its key. A few are primary and sit in the bar; every tool, primary or not, has a row in
// the More panel (more.ts) and an entry in the palette (palette.ts).
//
//   hud.addTool({ id: 'boutique', button, label: 'Boutique', group: 'shop', order: 10 });
//
// A `.hud-btn` put straight into `.hud-right` the old way (before there was this list) is adopted:
// a known one by its class or label (KNOWN), anything else stays in the bar with its own label, so
// nothing an older module adds goes missing.

import type { KeyAction } from '../keys.ts';

export type ToolGroup = 'play' | 'shop' | 'social' | 'system';

export const GROUPS: readonly { id: ToolGroup; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'shop', label: 'Shop' },
  { id: 'social', label: 'Social' },
  { id: 'system', label: 'System' },
];

export interface HudTool {
  /** Stable and unique ('map', 'boutique'); a second tool with the same id replaces the first. */
  id: string;
  /** The button, built by its module, with its icon, its click and whatever state it shows. */
  button: HTMLButtonElement;
  /** What it is, in a word or two ("Map", "Daily bonus"). */
  label: string;
  group: ToolGroup;
  /** Its place in the group, lowest first (and in the bar). */
  order?: number;
  /** Its key: a rebindable control (ui/keys.ts) or a fixed keycap ("?", "Ctrl K"). */
  key?: KeyAction | { label: string };
  /** Shown in the bar as well as in More. */
  primary?: boolean;
  /** More words the palette finds it by ("drinks cocktails"). */
  keywords?: string;
  /** Not where there's no keyboard (the shortcut list). */
  keyboardOnly?: boolean;
  /** A toggle: its row in More says On or Off (from aria-pressed) and stays open when pressed. */
  toggle?: boolean;
  /** What it's at, for its row in More ("On", "12 on"), when aria-pressed or its tip don't say. */
  state?(): string | null;
  /** Its icon for More and the palette, when its button has no SVG of its own to show. */
  icon?(): Element;
  /**
   * How much it matters in the bar, for a primary tool: 1 stays on the narrowest screens, 2 (the
   * default) goes into More alone on a phone held upright.
   */
  rank?: 1 | 2;
}

/** The tools an older module puts in the bar by itself, known by their class or their label. */
export const KNOWN: readonly { match: (b: HTMLButtonElement, label: string) => boolean; tool: Omit<HudTool, 'button'> }[] = [
  { match: (b) => b.classList.contains('map-btn'), tool: { id: 'map', label: 'Map', group: 'play', order: 10, key: 'map', primary: true, rank: 1, keywords: 'rooms floor where directory find' } },
  { match: (_, l) => /^emotes\b/i.test(l), tool: { id: 'emotes', label: 'Emotes', group: 'play', order: 20, key: 'emotes', primary: true, rank: 1, keywords: 'wave dance cheer clap' } },
  { match: (_, l) => /^achievements\b/i.test(l), tool: { id: 'feats', label: 'Achievements', group: 'play', order: 30, key: 'feats', keywords: 'challenges titles rewards trophy' } },
  { match: (b) => b.classList.contains('daily-btn'), tool: { id: 'daily', label: 'Daily bonus', group: 'shop', order: 40, keywords: 'gift streak claim reward' } },
  { match: (_, l) => /^boutique\b/i.test(l), tool: { id: 'boutique', label: 'Boutique', group: 'shop', order: 10, keywords: 'shop buy chains watches clothes rides emotes' } },
  { match: (_, l) => /^effects\b/i.test(l), tool: { id: 'effects', label: 'Effects', group: 'shop', order: 20, keywords: 'confetti fireworks spotlight' } },
  { match: (_, l) => /^bar\b/i.test(l), tool: { id: 'bar', label: 'Bar', group: 'shop', order: 30, keywords: 'drinks food order cocktails waiter' } },
  { match: (_, l) => /^leaderboards?\b/i.test(l), tool: { id: 'boards', label: 'Leaderboards', group: 'social', order: 20, keywords: 'ranks richest top stats' } },
];

/** A button's label as it says it: its aria-label or title, without a trailing "(K)" key. */
export function buttonLabel(b: HTMLElement): string {
  const raw = b.getAttribute('aria-label') ?? b.dataset.tip ?? b.getAttribute('title') ?? b.textContent ?? '';
  return splitKey(raw).text;
}

/**
 * A title's text and the key at its end: "Mute (N)" is "Mute" and "N"; "Max: the most it takes
 * (A)" is the sentence and "A". Only a short key counts ("(Esc)", "(⇧ R)", "(1)"), not a
 * parenthesis that is part of the sentence.
 */
export function splitKey(s: string): { text: string; key: string | null } {
  const m = /^(.*\S)\s*\(([^()]{1,9})\)$/.exec(s.trim());
  if (!m || !/^[\w⇧⌘⌥⌫↑↓←→?./\-[\]=;',` ]+$/u.test(m[2]!) || m[2]!.trim().split(/\s+/).length > 2) return { text: s.trim(), key: null };
  return { text: m[1]!, key: m[2]!.trim() };
}

/** The tool for a button that came the old way, from KNOWN or from its own label. */
export function adopt(b: HTMLButtonElement): HudTool {
  const label = buttonLabel(b);
  const known = KNOWN.find((k) => k.match(b, label));
  if (known) return { ...known.tool, button: b };
  const id = `x-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tool'}`;
  // something new: in the bar, as it always was, and listed under Play
  return { id, label: label || 'Tool', group: 'play', order: 90, primary: true, button: b };
}

const GROUP_ORDER: Record<ToolGroup, number> = { play: 0, shop: 1, social: 2, system: 3 };

/** The order tools are shown in: by group, then their own order, then their label. */
export function byPlace(a: Pick<HudTool, 'group' | 'order' | 'label'>, b: Pick<HudTool, 'group' | 'order' | 'label'>): number {
  return GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || (a.order ?? 50) - (b.order ?? 50) || a.label.localeCompare(b.label);
}
