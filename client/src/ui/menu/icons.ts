// Line icons drawn as SVG elements (the CSP rules out inline style attributes and data: URLs,
// and emoji render differently on every OS). 24-unit grid, stroked in currentColor.

const NS = 'http://www.w3.org/2000/svg';

export type IconName =
  | 'sound'
  | 'muted'
  | 'gear'
  | 'help'
  | 'close'
  | 'menu'
  | 'turn-left'
  | 'turn-right'
  | 'bulb'
  | 'sun'
  | 'moon'
  // the HUD's More panel, the palette and the notes
  | 'more'
  | 'search'
  | 'bell'
  | 'keyboard'
  | 'people'
  | 'door'
  | 'chevron'
  | 'enter'
  | 'pin'
  | 'chip';

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
    case 'bulb':
      path(s, 'M9.2 15.5c-.1-1.3-.8-2.1-1.6-3a4.6 4.6 0 1 1 8.8 0c-.8.9-1.5 1.7-1.6 3z');
      path(s, 'M9.6 18h4.8M10.6 20.4h2.8');
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
    // the theme button: the sun while it's dark (press for light), the moon while it's light
    case 'sun': {
      circle(s, 3.6);
      let rays = '';
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        rays += `M${(12 + Math.cos(a) * 6.2).toFixed(2)} ${(12 + Math.sin(a) * 6.2).toFixed(2)}L${(12 + Math.cos(a) * 8.6).toFixed(2)} ${(12 + Math.sin(a) * 8.6).toFixed(2)}`;
      }
      path(s, rays);
      break;
    }
    case 'moon':
      path(s, 'M14.2 3.6a8.4 8.4 0 1 0 6.2 11.8 7 7 0 0 1-6.2-11.8z');
      break;
    // three dots in a row: everything else (the HUD's More)
    case 'more':
      circle(s, 1.35, true, 5.5);
      circle(s, 1.35, true, 12);
      circle(s, 1.35, true, 18.5);
      break;
    case 'search':
      circle(s, 5.6, false, 10.6, 10.6);
      path(s, 'M14.8 14.8l4.7 4.7');
      break;
    // a bell with its clapper: the notes that went by
    case 'bell':
      path(s, 'M6.6 16.6V11a5.4 5.4 0 0 1 10.8 0v5.6l1.6 1.6H5z');
      path(s, 'M10.2 20.3a2 2 0 0 0 3.6 0');
      break;
    // a keyboard's outline and three rows of keys
    case 'keyboard':
      path(s, 'M3.5 7h17a1 1 0 0 1 1 1v8.4a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z');
      path(s, 'M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7.5 12.7h.01M10.5 12.7h.01M13.5 12.7h.01M16.5 12.7h.01M8.5 15h7');
      break;
    // two people, one a step behind: who's on
    case 'people':
      circle(s, 2.9, false, 9.2, 8.4);
      path(s, 'M3.6 19.2c.5-3.2 2.8-5.2 5.6-5.2s5.1 2 5.6 5.2');
      path(s, 'M15.2 5.9a2.9 2.9 0 0 1 0 5.2M17.2 14.3c1.8.7 2.9 2.4 3.2 4.9');
      break;
    // a door left open: back out to the main menu
    case 'door':
      path(s, 'M13.5 4.5H6.8v15h6.7');
      path(s, 'M10.5 12h9.5');
      path(s, 'M16.6 8.6 20 12l-3.4 3.4');
      break;
    case 'chevron':
      path(s, 'M9.5 6.5 15 12l-5.5 5.5');
      break;
    // a map pin: a room on the floor (the palette)
    case 'pin':
      path(s, 'M12 20.5s-6-5.6-6-10.3a6 6 0 0 1 12 0c0 4.7-6 10.3-6 10.3z');
      circle(s, 2.2, false, 12, 10.2);
      break;
    // a casino chip from above: a game (the palette)
    case 'chip': {
      circle(s, 8);
      circle(s, 4.2);
      let edge = '';
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        edge += `M${(12 + Math.cos(a) * 5.6).toFixed(2)} ${(12 + Math.sin(a) * 5.6).toFixed(2)}L${(12 + Math.cos(a) * 7.4).toFixed(2)} ${(12 + Math.sin(a) * 7.4).toFixed(2)}`;
      }
      path(s, edge);
      break;
    }
    // the return key's bent arrow (the palette: Enter runs it)
    case 'enter':
      path(s, 'M19 6v5.5a2 2 0 0 1-2 2H6');
      path(s, 'M9.5 10 6 13.5 9.5 17');
      break;
  }
  return s;
}
