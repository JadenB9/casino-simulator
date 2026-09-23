// Small line icons for the lobby panels, drawn as SVG elements (no markup strings, so nothing
// here needs innerHTML). Fill and stroke come from lobby.css through the lb-f / lb-s classes.

const NS = 'http://www.w3.org/2000/svg';

type Part = [tag: 'path' | 'rect' | 'circle', attrs: Record<string, string>];

function icon(name: string, parts: Part[]): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `lb-icon lb-${name}`);
  for (const [tag, attrs] of parts) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  }
  return svg;
}

export const crown = () =>
  icon('crown', [
    ['path', { class: 'lb-f', d: 'M2.4 11.2 1.3 4.6l3.6 2.9L8 2.8l3.1 4.7 3.6-2.9-1.1 6.6z' }],
    ['rect', { class: 'lb-f', x: '2.4', y: '12.2', width: '11.2', height: '1.6', rx: '0.4' }],
  ]);

export const lock = () =>
  icon('lock', [
    ['path', { class: 'lb-s', d: 'M5 7.2V5.4a3 3 0 0 1 6 0v1.8' }],
    ['rect', { class: 'lb-f', x: '3.2', y: '7.2', width: '9.6', height: '6.8', rx: '1.2' }],
  ]);

export const unlock = () =>
  icon('unlock', [
    ['path', { class: 'lb-s', d: 'M5 7.2V5.4a3 3 0 0 1 5.8-1.1' }],
    ['rect', { class: 'lb-f', x: '3.2', y: '7.2', width: '9.6', height: '6.8', rx: '1.2' }],
  ]);

export const chevron = () => icon('chev', [['path', { class: 'lb-s', d: 'm4.5 6.2 3.5 3.6 3.5-3.6' }]]);

export const back = () => icon('back', [['path', { class: 'lb-s', d: 'M9.8 3.5 5.3 8l4.5 4.5' }]]);
