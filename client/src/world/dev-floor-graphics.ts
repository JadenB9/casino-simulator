// Dev page for the Settings sheet's graphics rows (render/graphics-settings.ts), on their own
// with no floor behind them, for checking them at every size and in both themes:
//   /casino/src/world/dev-floor-graphics.html?quality=high|low
// (`quality`: the rows as a renderer running at that quality shows them). The options change
// render/graphics.ts's store as they would in the game; the page shows what's kept.

import '../ui/hud/hud.css';
import { el } from '../ui/kit.ts';
import { openSheet } from '../ui/menu/sheet.ts';
import { graphicsSettings } from '../render/graphics-settings.ts';
import { onGraphicsPrefs } from '../render/graphics.ts';

const q = new URLSearchParams(location.search).get('quality') === 'low' ? 'low' : 'high';
const ui = document.getElementById('ui')!;
const sheet = openSheet(ui, { title: 'Settings', cls: 'settings-sheet' });
const kept = el('p', 'set-note', '');
const show = () => (kept.textContent = `Kept: ${localStorage.getItem('casino.graphics') ?? '(defaults)'}`);
show();
onGraphicsPrefs(show);
sheet.body.append(el('h3', 'section-label', 'Graphics'), graphicsSettings({ quality: q, reload: () => location.reload() }), kept);
