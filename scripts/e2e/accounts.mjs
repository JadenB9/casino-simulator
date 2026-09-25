#!/usr/bin/env node
// Headless tour of the account screens on their dev page, against the local worker: login (empty,
// the live name rule, remembered), the menu (painted, and over the 3D room), profile (new and a
// full record), the character editor (edited, turned and saved), the HUD with its "?" list and
// settings, and the cashier (refused, then a broke player's loan). Screenshots of each, plus a
// few narrow-screen ones. Usage: node scripts/e2e/accounts.mjs [port] [outDir]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [port = '5173', out = '/tmp/casino-accounts'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}/casino/src/ui/menu/dev.html`;
// One account for every run, so repeated runs don't use up the new-account limit, and the
// password the dev pages use (DEV_PASSWORD in client/src/net/api.ts) so it stays ours.
const NAME = 'e2e_tour';
const PASS = 'casino-dev';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const shots = [];
const checks = [];
const check = (what, ok, detail) => checks.push(ok ? { what, ok } : { what, ok, detail });

async function open(url, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && errors.push(`${url}: ${m.text()}`));
  p.on('pageerror', (e) => errors.push(`${url}: ${e}`));
  await p.goto(`${base}?${url}&dock=0`);
  return p;
}

async function shot(p, name) {
  const path = `${out}/${name}.png`;
  await p.screenshot({ path });
  shots.push(path);
}

const text = (p, sel) => p.textContent(sel).then((t) => (t ?? '').trim());
const selected = (p) => p.getAttribute('.menu-item.sel', 'data-id');

// qa6: on a fresh local database a brand-new name is greeted by the guided look editor, not the
// menu these checks walk; make NAME an account from over a quarter of an hour ago first, as it is
// on any database the script has run on before.
{
  await fetch(`http://localhost:${port}/casino/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: NAME, password: PASS }) });
  execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--command', `UPDATE casino_accounts SET created_at = created_at - 3600000 WHERE name = '${NAME}'`], { cwd: new URL('../..', import.meta.url), env: { ...process.env, CI: '1' }, stdio: 'ignore' });
}

// ---- login, the live rule, the menu by keyboard, a new player's profile, log out, continue
{
  const p = await open('screen=flow');
  await p.waitForSelector('.name-input');
  await p.waitForTimeout(800);
  await shot(p, '01-login');
  await p.fill('.name-input', 'ab');
  check('rule: too short', (await text(p, '.name-rule')) === 'At least 3 characters.', await text(p, '.name-rule'));
  check('enter disabled for a bad name', await p.isDisabled('.enter-btn'));
  await p.fill('.name-input', 'no spaces');
  check('rule: characters', (await text(p, '.name-rule')) === 'Letters, numbers and _ only.', await text(p, '.name-rule'));
  await shot(p, '02-login-rule');
  await p.fill('.name-input', NAME);
  check('enter enabled for a good name', !(await p.isDisabled('.enter-btn')));
  await p.fill('.pass-input', PASS);
  await p.keyboard.press('Enter');
  await p.waitForSelector('.front-menu .menu-item.sel');
  await p.waitForTimeout(800);
  await shot(p, '03-menu');
  check('menu starts on Enter Casino', (await selected(p)) === 'enter');
  await p.keyboard.press('ArrowDown');
  check('arrow down selects Character', (await selected(p)) === 'character');
  await p.keyboard.press('KeyS');
  check('S selects Profile', (await selected(p)) === 'profile');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.profile-sheet .pf-games tbody tr, .profile-sheet .pf-games-wrap .quiet'); // qa6: stats6's games table (or its empty note)
  await p.waitForFunction(() => !document.querySelector('.profile-sheet .sheet-sub')?.textContent?.includes('Updating'));
  await p.waitForTimeout(500);
  await shot(p, '04-profile-new');
  check('profile shows the $50,000 balance or more', /\$\d/.test(await text(p, '.pf-strip .stat-value'))); // qa6: stats6's strip
  await p.keyboard.press('KeyW'); // must not reach the menu behind the sheet
  await p.keyboard.press('Escape');
  await p.waitForSelector('.sheet-scrim', { state: 'detached' });
  check('sheet kept W from the menu', (await selected(p)) === 'profile');
  check('focus returns to the menu', await p.evaluate(() => document.activeElement?.classList.contains('menu-item')));
  await p.keyboard.press('End');
  check('End selects Log out', (await selected(p)) === 'logout');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.continue-btn:not([hidden])');
  await p.waitForTimeout(700);
  await shot(p, '05-login-remembered');
  check('continue as the remembered name', (await text(p, '.continue-name')) === NAME);
  check('the password field waits for it', await p.evaluate(() => document.activeElement?.classList.contains('pass-input')));
  await p.keyboard.type(PASS);
  await p.keyboard.press('Enter'); // empty name field: continue as the remembered name
  await p.waitForSelector('.front-menu .menu-item.sel');
  check('Enter continued as the remembered name', true);
  await p.context().close();
}

// ---- the menu over the 3D room, and a full record on the profile (canned player)
{
  const p = await open('screen=menu&fixture=1&backdrop=3d');
  await p.waitForSelector('.front-menu .menu-item.sel');
  await p.waitForTimeout(1600);
  await shot(p, '06-menu-3d');
  await p.context().close();
}
{
  const p = await open('screen=profile&fixture=1');
  await p.waitForSelector('.profile-sheet .loans');
  await p.waitForTimeout(900);
  await shot(p, '07-profile');
  check('profile lists two loans', (await p.$$('.profile-sheet .loans tbody tr')).length === 2);
  check('profile says Loans taken: 2', (await text(p, '.pf-lower')).includes('Loans taken: 2')); // qa6: stats6's lower row
  await p.context().close();
}

// ---- the editor: defaults, edited, turned, saved through the real API
{
  const p = await open(`screen=editor&name=${NAME}`);
  await p.waitForSelector('.editor-panel .sw');
  // start every run from the default look
  await p.evaluate(async () => {
    const t = sessionStorage.getItem('casino.token');
    const look = { v: 1, body: 'm', outfit: 'suit', skin: 2, hair: '#2b1d14', top: '#1f2430', bottom: '#1f2430', shoes: '#111111' };
    await fetch('/casino/api/me/look', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ look }) });
  });
  await p.reload();
  await p.waitForSelector('.editor-panel .sw');
  await p.waitForTimeout(1800);
  await shot(p, '08-editor');
  check('save disabled until something changes', await p.isDisabled('.ed-buttons .btn.primary'));
  await p.click('.seg-btn:text-is("Female")');
  await p.click('.seg-btn:text-is("Dress")');
  await p.click('.sw[aria-label="Auburn"]');
  await p.click('.ed-field:has(.ed-label:text-is("Top")) .sw[aria-label="Burgundy"]');
  await p.click('.ed-field:has(.ed-label:text-is("Bottom")) .sw[aria-label="Oxblood"]');
  await p.click('.sw[aria-label="Medium deep"]');
  await p.waitForTimeout(900);
  await shot(p, '09-editor-edited');
  await p.mouse.move(420, 420);
  await p.mouse.down();
  await p.mouse.move(560, 420, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(900);
  await shot(p, '10-editor-turned');
  await p.click('.ed-buttons .btn.primary');
  await p.waitForSelector('.editor', { state: 'detached' });
  const look = await p.evaluate(async () => {
    const t = sessionStorage.getItem('casino.token');
    const r = await fetch('/casino/api/me', { headers: { Authorization: `Bearer ${t}` } });
    return (await r.json()).profile.look;
  });
  check('saved look reached the server', look.body === 'f' && look.outfit === 'dress' && look.hair === '#6e3b22' && look.top === '#6b1f2a', JSON.stringify(look));
  await p.context().close();
}

// ---- the HUD, the "?" list, settings, mute
{
  const p = await open(`screen=hud&name=${NAME}`);
  await p.waitForSelector('.hud-balance .stat-value:not(:empty)');
  await p.waitForTimeout(900);
  await shot(p, '11-hud');
  check('HUD shows chips at the table', (await text(p, '.hud-table .stat-value')) === '$1,250');
  check('HUD shows the online count', (await text(p, '.hud-online')).startsWith('14'));
  await p.keyboard.press('?');
  await p.waitForSelector('.shortcuts-sheet');
  await p.waitForTimeout(500);
  await shot(p, '12-shortcuts');
  await p.keyboard.press('Escape');
  await p.waitForSelector('.sheet-scrim', { state: 'detached' });
  await p.click('.hud-btn[title="Settings"]');
  await p.waitForSelector('.settings-sheet');
  await p.click('.seg-btn:text-is("Low")');
  await p.waitForTimeout(400);
  await shot(p, '13-settings');
  check('quality saved for the next load', (await p.evaluate(() => localStorage.getItem('casino.quality'))) === 'low');
  check('reload note shown', await p.isVisible('.set-pending'));
  await p.click('.seg-btn:text-is("High")');
  await p.keyboard.press('Escape');
  await p.waitForSelector('.sheet-scrim', { state: 'detached' });
  await p.keyboard.press('m');
  check('M mutes', (await p.getAttribute('.hud-btn[aria-label="Mute (M)"]', 'aria-pressed')) === 'true');
  await p.keyboard.press('m');
  check('M unmutes', (await p.getAttribute('.hud-btn[aria-label="Mute (M)"]', 'aria-pressed')) === 'false');
  await p.context().close();
}

// ---- the cashier: refused with money, then a broke player's loan
{
  const p = await open(`screen=bank&name=${NAME}`);
  await p.waitForSelector('.bank-status:not(:empty)');
  await p.waitForTimeout(700);
  await shot(p, '14-bank');
  check('no loan with money in the balance', await p.isDisabled('.bank-take'));
  await p.context().close();
}
{
  const p = await open('screen=bank&fixture=1&broke=1');
  await p.waitForSelector('.bank-status.ok');
  await p.waitForTimeout(700);
  await shot(p, '15-bank-broke');
  await p.click('.bank-take');
  await p.waitForFunction(() => document.querySelector('.bank-status')?.textContent?.startsWith('Loan made'));
  await p.waitForTimeout(500);
  await shot(p, '16-bank-lent');
  check('loan shows in the count', (await text(p, '.bank-stats .stat:nth-child(3) .stat-value')) === '3');
  await p.context().close();
}

// ---- narrow screens
{
  const narrow = { width: 390, height: 844 };
  let p = await open('screen=login&fixture=1', narrow);
  await p.waitForSelector('.name-input');
  await p.waitForTimeout(700);
  await shot(p, '17-login-narrow');
  await p.context().close();
  p = await open('screen=menu&fixture=1', narrow);
  await p.waitForSelector('.menu-item.sel');
  await p.waitForTimeout(700);
  await shot(p, '18-menu-narrow');
  await p.context().close();
  p = await open('screen=editor&fixture=1', narrow);
  await p.waitForSelector('.editor-panel .sw');
  await p.waitForTimeout(1500);
  await shot(p, '19-editor-narrow');
  await p.context().close();
}

console.log(JSON.stringify({ out, shots: shots.length, failed: checks.filter((c) => !c.ok), passed: checks.filter((c) => c.ok).length, errors: errors.slice(0, 20) }, null, 1));
await browser.close();
if (checks.some((c) => !c.ok) || errors.length) process.exitCode = 1;
