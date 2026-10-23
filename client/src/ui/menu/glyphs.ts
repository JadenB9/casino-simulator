// Line glyphs for the front screens, the editor and the first-run guide, in the same hand as the
// HUD's icons (menu/icons.ts: a 24-unit grid, stroked in currentColor, `ico` class), kept here so
// the shared set stays the HUD's own.

const NS = 'http://www.w3.org/2000/svg';

export type GlyphName =
  | 'eye'
  | 'eye-off'
  | 'person'
  | 'chart'
  | 'gear'
  | 'door'
  | 'arrow'
  | 'plus'
  | 'minus'
  | 'recenter'
  | 'dice'
  | 'check'
  | 'walk'
  | 'chair'
  | 'map'
  | 'tools'
  | 'gift'
  | 'caps';

function draw(d: readonly string[], dots: readonly [number, number, number][] = []): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ico');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  for (const p of d) {
    const e = document.createElementNS(NS, 'path');
    e.setAttribute('d', p);
    s.append(e);
  }
  for (const [cx, cy, r] of dots) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', String(cx));
    c.setAttribute('cy', String(cy));
    c.setAttribute('r', String(r));
    c.setAttribute('class', 'fill');
    s.append(c);
  }
  return s;
}

const PATHS: Record<GlyphName, () => SVGSVGElement> = {
  eye: () => draw(['M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12z', 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z']),
  'eye-off': () => draw(['M4.5 4.5l15 15', 'M9.9 6.1A9.6 9.6 0 0 1 12 5.8c5.8 0 9.2 6.2 9.2 6.2a16 16 0 0 1-2.6 3.3', 'M6.3 7.7A15.5 15.5 0 0 0 2.8 12s3.4 6.2 9.2 6.2a9 9 0 0 0 4-.9', 'M10 10a2.8 2.8 0 0 0 4 4']),
  // a head and shoulders
  person: () => draw(['M12 4.2a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z', 'M4.8 19.8c.8-3.8 3.6-5.8 7.2-5.8s6.4 2 7.2 5.8']),
  // three bars on a base line
  chart: () => draw(['M4 19.5h16', 'M7 16.5v-5', 'M12 16.5V6.5', 'M17 16.5v-8']),
  gear: () => {
    let teeth = '';
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      teeth += `M${(12 + Math.cos(a) * 5.6).toFixed(2)} ${(12 + Math.sin(a) * 5.6).toFixed(2)}L${(12 + Math.cos(a) * 8.4).toFixed(2)} ${(12 + Math.sin(a) * 8.4).toFixed(2)}`;
    }
    return draw(['M12 6.4a5.6 5.6 0 1 0 0 11.2 5.6 5.6 0 0 0 0-11.2z', 'M12 9.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z', teeth]);
  },
  // a door left ajar with an arrow out of it
  door: () => draw(['M13.5 4.5H6.2v15h7.3', 'M10.5 12h9.3', 'M16.8 8.8 20 12l-3.2 3.2']),
  arrow: () => draw(['M5 12h13.5', 'M13.5 7l5 5-5 5']),
  plus: () => draw(['M12 6v12M6 12h12']),
  minus: () => draw(['M6 12h12']),
  // a frame's four corners round a dot: put the view back
  recenter: () => draw(['M4.5 9V4.5H9', 'M15 4.5h4.5V9', 'M19.5 15v4.5H15', 'M9 19.5H4.5V15'], [[12, 12, 1.6]]),
  dice: () => draw(['M6.5 4.5h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z'], [[8.8, 8.8, 1.25], [15.2, 8.8, 1.25], [12, 12, 1.25], [8.8, 15.2, 1.25], [15.2, 15.2, 1.25]]),
  check: () => draw(['M5.5 12.5l4.2 4.2 8.8-9.4']),
  // a figure mid-stride
  walk: () => draw(['M13.4 6.6a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z', 'M10.6 20.5l2-5.3 2.6 2.4v2.9', 'M12.6 15.2l.9-5.6-3.4 1.6-1.6 3', 'M13.5 9.6l2.2 2.6 2.6.8']),
  // a stool at a table's edge
  chair: () => draw(['M4 9.5h16', 'M6.5 9.5v10M17.5 9.5v10', 'M9 14.5h6', 'M9.2 9.5V4.8h5.6v4.7']),
  // a folded map
  map: () => draw(['M3.8 6.4 9 4.5l6 2 5.2-1.9v13l-5.2 1.9-6-2-5.2 1.9z', 'M9 4.5v13M15 6.5v13']),
  // a row of three buttons in a bar
  tools: () => draw(['M3.5 7.5h17v9h-17z', 'M9.2 7.5v9M14.8 7.5v9']),
  gift: () => draw(['M4.5 9.5h15v3h-15z', 'M5.8 12.5v7.5h12.4v-7.5', 'M12 9.5V20', 'M12 9.5c-1.6-3.6-5.6-4.4-5.9-2.2-.3 1.8 3 2.2 5.9 2.2', 'M12 9.5c1.6-3.6 5.6-4.4 5.9-2.2.3 1.8-3 2.2-5.9 2.2']),
  // an arrow up over a bar: Caps Lock
  caps: () => draw(['M12 4.5 5.5 11h3.6v4h5.8v-4h3.6z', 'M9 19h6']),
};

export function glyph(name: GlyphName): SVGSVGElement {
  return PATHS[name]();
}
