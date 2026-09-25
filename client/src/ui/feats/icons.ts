// Drawings for the feats: the HUD's cup, and the medallion each row carries (filled once earned).
// Built as SVG elements in the menu icons' style: 24-unit grid, currentColor, line work.

const NS = 'http://www.w3.org/2000/svg';

function svg(cls: string): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  return s;
}

function path(s: SVGElement, d: string, cls?: string): void {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  if (cls) p.setAttribute('class', cls);
  s.append(p);
}

/** A cup on a short stem, handles either side: the HUD button. */
export function cupIcon(): SVGSVGElement {
  const s = svg('ico');
  path(s, 'M7.5 4h9v4.6a4.5 4.5 0 0 1-9 0z');
  path(s, 'M7.5 5.6H5.2a2.1 2.1 0 0 0 .4 4.1l2.2.5M16.5 5.6h2.3a2.1 2.1 0 0 1-.4 4.1l-2.2.5');
  path(s, 'M12 13.1v3.4M9 20h6M9.8 16.5h4.4l.6 3.5H9.2z');
  return s;
}

/**
 * The row's medallion: a diamond in a ring. Earned, the diamond is solid brass; locked, only its
 * outline; a challenge under way shows how far round the ring it has come (`k`, 0-1).
 */
export function medal(earned: boolean, k = 0): SVGSVGElement {
  const s = svg(`ft-medal${earned ? ' on' : ''}`);
  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('cx', '12');
  ring.setAttribute('cy', '12');
  ring.setAttribute('r', '10');
  ring.setAttribute('class', 'ft-ring');
  s.append(ring);
  if (!earned && k > 0) {
    // the part of the ring done, drawn from the top clockwise
    const arc = document.createElementNS(NS, 'circle');
    arc.setAttribute('cx', '12');
    arc.setAttribute('cy', '12');
    arc.setAttribute('r', '10');
    arc.setAttribute('class', 'ft-arc');
    arc.setAttribute('pathLength', '100');
    arc.setAttribute('stroke-dasharray', `${Math.max(1, Math.round(k * 100))} 100`);
    arc.setAttribute('transform', 'rotate(-90 12 12)');
    s.append(arc);
  }
  path(s, 'M12 6.2l5.8 5.8-5.8 5.8-5.8-5.8z', earned ? 'ft-gem fill' : 'ft-gem');
  return s;
}
