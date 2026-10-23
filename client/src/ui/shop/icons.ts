// The boutique's, the effects' and the bar's HUD buttons, drawn like menu/icons.ts (SVG elements, the CSP rules
// out inline styles and data: URLs), and the button itself, built like the HUD's own. Also the small signs the
// sheets use: the search glass, the wishlist's heart, an effect's reach, and what a drink or a plate does.

import { el } from '../kit.ts';

const NS = 'http://www.w3.org/2000/svg';

export type ShopIconName =
  | 'boutique' | 'bar' | 'effects'
  | 'search' | 'heart'
  | 'reach-you' | 'reach-room' | 'reach-casino'
  | 'does-tipsy' | 'does-quick' | 'does-bubbly' | 'does-party' | 'does-fed';

export function shopIcon(name: ShopIconName): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ico');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  const path = (d: string) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    s.append(p);
  };
  switch (name) {
    case 'boutique':
      // A cut diamond from the side: the table, the crown's facets, the pavilion down to its point.
      path('M7 4.5h10l3.8 5L12 20.5 3.2 9.5z');
      path('M3.2 9.5h17.6');
      path('M9.6 4.5 8.3 9.5 12 20.5l3.7-11-1.3-5');
      break;
    case 'effects':
      // A burst: a four-point star with a small one beside it, the way a spark catches the light.
      path('M10 3.5l1.7 5.1 5.1 1.7-5.1 1.7L10 17.1l-1.7-5.1-5.1-1.7 5.1-1.7z');
      path('M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z');
      break;
    case 'bar':
      // A cocktail glass with an olive on a pick.
      path('M4.5 5h15L12 13.2z');
      path('M12 13.2V19.5M8.5 19.5h7');
      path('M14.6 3.2 11.2 9.2');
      path('M11.3 8.1a1.3 1.3 0 1 0 .2 0');
      break;
    case 'search':
      path('M10.5 4.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z');
      path('M15 15l4.8 4.8');
      break;
    case 'heart':
      path('M12 19.6s-7.4-4.6-7.4-10A4.1 4.1 0 0 1 12 7.2a4.1 4.1 0 0 1 7.4 2.4c0 5.4-7.4 10-7.4 10z');
      break;
    case 'reach-you':
      // you, with a ring round you
      path('M12 9.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM8.6 15.5c.4-2.6 1.7-4 3.4-4s3 1.4 3.4 4');
      path('M4.5 17.6c1.8 1.4 4.4 2.2 7.5 2.2s5.7-.8 7.5-2.2');
      break;
    case 'reach-room':
      // a room's four walls with you in it
      path('M4 5h16v14H4z');
      path('M12 11a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM9.2 16c.3-2 1.4-3.1 2.8-3.1s2.5 1.1 2.8 3.1');
      break;
    case 'reach-casino':
      // the building, every window lit
      path('M3.5 20.5h17M5 20.5V9l7-5 7 5v11.5');
      path('M8.5 12h2M13.5 12h2M8.5 16h2M13.5 16h2');
      break;
    case 'does-tipsy':
      // a glass, and the room going round it
      path('M7.5 5.5h9l-1.3 8.2a3.3 3.3 0 0 1-6.4 0z');
      path('M12 17v3M9 20h6');
      path('M3.5 9.5c.8-.6 1.6-.6 2.4 0M18.1 9.5c.8-.6 1.6-.6 2.4 0');
      break;
    case 'does-quick':
      // a double chevron, forward
      path('M6 6.5l5.5 5.5L6 17.5M12.5 6.5 18 12l-5.5 5.5');
      break;
    case 'does-bubbly':
      path('M9 15.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM15.5 9.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM15 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z');
      break;
    case 'does-party':
      // a party popper and its streamers
      path('M4.5 19.5l3.6-9.6 6 6z');
      path('M13.5 7.5c1-1.8.6-3.2-.8-4M16.5 10.5c1.8-1 3.2-.6 4 .8M15 4.5l.5-1M19.5 9l1-.5');
      break;
    case 'does-fed':
      // a fork and a knife
      path('M7.5 3.5v6.2a2 2 0 0 0 4 0V3.5M9.5 3.5v17');
      path('M16.5 20.5V3.5c-2 1.2-2.7 3.6-2.7 6.4 0 1.8.9 2.9 2.7 3.1');
      break;
  }
  return s;
}

export function shopButton(name: ShopIconName, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'hud-btn');
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(shopIcon(name));
  b.addEventListener('click', onClick);
  return b;
}
