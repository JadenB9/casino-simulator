// The emotes and leaderboard buttons, built like the HUD's own (class "hud-btn", styled by
// hud/hud.css), for app/boot.ts to put in the HUD's right-hand bar.

import { el } from '../kit.ts';
import { socialIcon, type SocialIconName } from './icons.ts';

export function socialButton(name: SocialIconName, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'hud-btn');
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(socialIcon(name));
  b.addEventListener('click', onClick);
  return b;
}
