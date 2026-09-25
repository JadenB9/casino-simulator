// The boutique's, the effects' and the bar's HUD buttons, drawn like menu/icons.ts (SVG elements, the CSP rules
// out inline styles and data: URLs), and the button itself, built like the HUD's own.

import { el } from '../kit.ts';

const NS = 'http://www.w3.org/2000/svg';

export type ShopIconName = 'boutique' | 'bar' | 'effects';

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
  if (name === 'boutique') {
    // A cut diamond from the side: the table, the crown's facets, the pavilion down to its point.
    path('M7 4.5h10l3.8 5L12 20.5 3.2 9.5z');
    path('M3.2 9.5h17.6');
    path('M9.6 4.5 8.3 9.5 12 20.5l3.7-11-1.3-5');
  } else if (name === 'effects') {
    // A burst: a four-point star with a small one beside it, the way a spark catches the light.
    path('M10 3.5l1.7 5.1 5.1 1.7-5.1 1.7L10 17.1l-1.7-5.1-5.1-1.7 5.1-1.7z');
    path('M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z');
  } else {
    // A cocktail glass with an olive on a pick.
    path('M4.5 5h15L12 13.2z');
    path('M12 13.2V19.5M8.5 19.5h7');
    path('M14.6 3.2 11.2 9.2');
    path('M11.3 8.1a1.3 1.3 0 1 0 .2 0');
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
