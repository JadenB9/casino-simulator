// Line icons drawn as SVG elements (the CSP rules out inline style attributes and data: URLs,
// and emoji render differently on every OS). 24-unit grid, stroked in currentColor.

const NS = 'http://www.w3.org/2000/svg';

export type IconName = 'sound' | 'muted' | 'gear' | 'help' | 'close' | 'menu' | 'turn-left' | 'turn-right';

function svg(): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ico');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  return s;
}

function path(s: SVGSVGElement, d: string, fill = false): void {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  if (fill) p.setAttribute('class', 'fill');
  s.append(p);
}

function circle(s: SVGSVGElement, r: number, fill = false, cx = 12, cy = 12): void {
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', String(r));
  if (fill) c.setAttribute('class', 'fill');
  s.append(c);
}

export function icon(name: IconName): SVGSVGElement {
  const s = svg();
  const speaker = 'M4 9.5h3.4L12 6v12l-4.6-3.5H4z';
  switch (name) {
    case 'sound':
      path(s, speaker);
      path(s, 'M15.4 9.3a3.8 3.8 0 0 1 0 5.4');
      path(s, 'M17.9 6.9a7.2 7.2 0 0 1 0 10.2');
      break;
    case 'muted':
      path(s, speaker);
      path(s, 'M15.5 9.5l5 5M20.5 9.5l-5 5');
      break;
    case 'gear': {
      circle(s, 5.6);
      circle(s, 2.2);
      // eight teeth on the rim
      let teeth = '';
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const x1 = 12 + Math.cos(a) * 5.6;
        const y1 = 12 + Math.sin(a) * 5.6;
        const x2 = 12 + Math.cos(a) * 8.4;
        const y2 = 12 + Math.sin(a) * 8.4;
        teeth += `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`;
      }
      path(s, teeth);
      break;
    }
    case 'help':
      path(s, 'M9.3 9.2a2.8 2.8 0 1 1 3.9 2.6c-.8.35-1.2 1-1.2 1.9v.5');
      circle(s, 0.95, true, 12, 17.2);
      break;
    case 'close':
      path(s, 'M6.5 6.5l11 11M17.5 6.5l-11 11');
      break;
    case 'menu':
      path(s, 'M4.5 7.5h15M4.5 12h15M4.5 16.5h15');
      break;
    case 'turn-left':
      path(s, 'M5.2 13.2A7 7 0 1 0 7.4 7');
      path(s, 'M7.6 3.6 7.4 7l3.4.3');
      break;
    case 'turn-right':
      path(s, 'M18.8 13.2A7 7 0 1 1 16.6 7');
      path(s, 'M16.4 3.6l.2 3.4-3.4.3');
      break;
  }
  return s;
}
