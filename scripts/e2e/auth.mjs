#!/usr/bin/env node
// Headless check of logging in with a password, against the local worker: a name and password
// (the rule, Show, a short password), the menu, log out, "Continue as" asking for the password,
// a wrong password, an account from before passwords being claimed by its first password, the
// real game's boot (a saved session skips the screen, a v1 token doesn't), the cashier topping up
// $9,999.99 to $50,000, and a narrow screen.
// Screenshots of each. Usage: node scripts/e2e/auth.mjs [port] [outDir]
//
// The account from before passwords is written straight into the local D1 with wrangler, the
// way every account looked before migration 0003, under a new name each run (it isn't made
// through the API, so it doesn't count against the new-account limit).

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [port = '5173', out = '/tmp/casino-auth'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const root = fileURLToPath(new URL('../..', import.meta.url));
const dev = `http://localhost:${port}/casino/src/ui/menu/dev.html`;
const game = `http://localhost:${port}/casino/`;
// Fixed name and the dev pages' password (DEV_PASSWORD in client/src/net/api.ts).
const NAME = 'auth_tour';
const PASS = 'casino-dev';
const OLD = `old_${Date.now().toString(36).slice(-6)}`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const shots = [];
const checks = [];
const check = (what, ok, detail) => checks.push(ok ? { what, ok } : { what, ok, detail });

async function open(url, { viewport = { width: 1280, height: 800 }, last = null } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  // Low quality keeps the software-rendered floor behind the game's login quick enough to capture.
  await ctx.addInitScript((n) => {
    localStorage.setItem('casino.quality', 'low');
    if (n) localStorage.setItem('casino.lastName', n);
  }, last);
  const p = await ctx.newPage();
  // A refused login is an expected 401/429 on the network; anything else is an error.
  p.on('console', (m) => m.type() === 'error' && !/status of 40[01]|status of 429/.test(m.text()) && errors.push(`${url}: ${m.text()}`));
  p.on('pageerror', (e) => errors.push(`${url}: ${e}`));
  await p.goto(url);
  return p;
}

async function shot(p, name) {
  const path = `${out}/${name}.png`;
  await p.screenshot({ path, timeout: 120_000 });
  shots.push(path);
}

const text = (p, sel) => p.textContent(sel).then((t) => (t ?? '').trim());
const focused = (p, cls) => p.evaluate((c) => document.activeElement?.classList.contains(c) ?? false, cls);
const inMenu = (p) => p.waitForSelector('.front-menu .menu-item.sel', { timeout: 20_000 });

function sql(command) {
  return execFileSync(`${root}node_modules/.bin/wrangler`, ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--json', '--command', command], {
    cwd: root,
    env: { ...process.env, CI: '1' },
    encoding: 'utf8',
  });
}

// qa6: on a fresh local database a brand-new name is greeted by the guided look editor, not the
// menu these checks walk; make NAME an account from over a quarter of an hour ago first, as it is
// on any database the script has run on before.
{
  await fetch(`http://localhost:${port}/casino/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: NAME, password: PASS }) });
  execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--command', `UPDATE casino_accounts SET created_at = created_at - 3600000 WHERE name = '${NAME}'`], { cwd: new URL('../..', import.meta.url), env: { ...process.env, CI: '1' }, stdio: 'ignore' });
}

// ---- first visit: name, password, the rule, Show; in; out; "Continue as" asks for the password
{
  const p = await open(`${dev}?screen=flow&dock=0`);
  await p.waitForSelector('.pass-input');
  await p.waitForTimeout(800);
  await shot(p, '01-login-first-visit');
  check('first-time note', (await text(p, '.login-note')).startsWith('New name? Pick a password and this name is yours.'), await text(p, '.login-note'));
  check('name field focused for someone new', await focused(p, 'name-input'));
  check('password rule shown', (await text(p, '.pass-rule')) === '4 to 64 characters', await text(p, '.pass-rule'));

  await p.fill('.name-input', NAME);
  await p.keyboard.press('Enter'); // no password yet: Enter moves on to it
  check('Enter in the name moves to the password', await focused(p, 'pass-input'));
  await p.keyboard.type('abc');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  check('short password refused before sending', (await text(p, '.pass-rule')) === 'At least 4 characters.', await text(p, '.pass-rule'));
  check('still on the login screen', !!(await p.$('.front-login')));
  await shot(p, '02-login-short-password');

  await p.fill('.pass-input', PASS);
  await p.click('.pass-show');
  check('Show reveals the password', (await p.getAttribute('.pass-input', 'type')) === 'text' && (await text(p, '.pass-show')) === 'Hide');
  await shot(p, '03-login-shown');
  await p.click('.pass-show');
  check('Hide masks it again', (await p.getAttribute('.pass-input', 'type')) === 'password');
  await p.keyboard.press('Enter');
  await inMenu(p);
  check('logged in with a password', true);

  await p.keyboard.press('End'); // Log out
  await p.keyboard.press('Enter');
  await p.waitForSelector('.continue-btn:not([hidden])');
  await p.waitForTimeout(700);
  await shot(p, '04-login-continue');
  check('continue as the remembered name', (await text(p, '.continue-name')) === NAME);
  check('coming back, the password field is focused', await focused(p, 'pass-input'));
  check('says whose password it wants', (await text(p, '.pass-rule')) === `The password for ${NAME}`, await text(p, '.pass-rule'));

  await p.click('.continue-btn'); // no password typed yet: nothing is sent, the field waits
  await p.waitForTimeout(300);
  check('Continue as without a password waits for it', !!(await p.$('.front-login')) && (await focused(p, 'pass-input')));

  await p.keyboard.type('not-the-password');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.pass-rule.err');
  await p.waitForTimeout(400);
  await shot(p, '05-login-wrong-password');
  check('wrong password: generic message', (await text(p, '.pass-rule')) === 'Wrong name or password.', await text(p, '.pass-rule'));
  check('wrong password: field cleared and focused', (await p.inputValue('.pass-input')) === '' && (await focused(p, 'pass-input')));

  await p.keyboard.type(PASS);
  await p.click('.continue-btn');
  await inMenu(p);
  check('Continue as with the password gets in', true);
  await p.context().close();
}

// ---- an account from before passwords: its first password claims it, and only that one works
{
  sql(`INSERT INTO casino_accounts (name, balance, created_at, last_seen) VALUES ('${OLD}', 5000000, 0, 0)`);
  const p = await open(`${dev}?screen=flow&dock=0`);
  await p.waitForSelector('.pass-input');
  await p.fill('.name-input', OLD);
  await p.fill('.pass-input', 'first one wins');
  await p.keyboard.press('Enter');
  await inMenu(p);
  const stored = JSON.parse(sql(`SELECT pass_hash, pass_salt FROM casino_accounts WHERE name = '${OLD}'`))[0].results[0];
  check('claim stored a PBKDF2 hash and salt', /^pbkdf2:100000:[0-9a-f]{64}$/.test(stored.pass_hash) && /^[0-9a-f]{32}$/.test(stored.pass_salt), JSON.stringify(stored));
  await p.keyboard.press('End');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.continue-btn:not([hidden])');
  await p.keyboard.type('someone else');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.pass-rule.err');
  check('after the claim, another password is refused', (await text(p, '.pass-rule')) === 'Wrong name or password.');
  await p.keyboard.type('first one wins');
  await p.keyboard.press('Enter');
  await inMenu(p);
  check('the claiming password still gets in', true);
  await p.context().close();
}

// ---- the real game: the login over the floor, then a saved session skips it, a v1 token doesn't
{
  const p = await open(game, { last: NAME });
  await p.waitForSelector('.front-login .pass-input', { timeout: 180_000 });
  // The loading screen fades out over the login once the floor is in.
  await p.waitForSelector('#boot.done', { state: 'attached', timeout: 180_000 });
  await p.waitForTimeout(2500);
  await shot(p, '06-game-login');
  await p.keyboard.type(PASS);
  await p.keyboard.press('Enter');
  await p.waitForSelector('.menu-item', { timeout: 30_000 });
  check('game: logged in from the boot screen', true);
  const token = await p.evaluate(() => sessionStorage.getItem('casino.token'));
  check('game: token is v2', typeof token === 'string' && token.startsWith('v2.'), token?.slice(0, 3));
  await p.reload();
  await p.waitForSelector('.menu-item, .front-login', { timeout: 180_000 });
  check('game: a saved session skips the login', !!(await p.$('.menu-item')) && !(await p.$('.front-login')));
  // A session from before passwords: same shape, old version. The server refuses it.
  await p.evaluate(() => sessionStorage.setItem('casino.token', 'v1' + sessionStorage.getItem('casino.token').slice(2)));
  await p.reload();
  await p.waitForSelector('.menu-item, .front-login', { timeout: 180_000 });
  check('game: a v1 token goes back to the login', !!(await p.$('.front-login')));
  await p.context().close();
}

// ---- the cashier against the real worker: $9,999.99 is under the line, a top-up to $50,000
{
  const BANKER = 'auth_bank';
  const bank = `${dev}?screen=bank&name=${BANKER}&dock=0`;
  // The dev page logs in as BANKER (making it the first time), then the balance is set straight
  // in D1: just under the line, with nothing on any table.
  let p = await open(bank);
  await p.waitForSelector('.bank-status:not(:empty)');
  await p.context().close();
  sql(`UPDATE casino_accounts SET balance = 999999 WHERE name = '${BANKER}' AND in_play = 0`);

  p = await open(bank);
  await p.waitForSelector('.bank-status.ok');
  await p.waitForTimeout(600);
  await shot(p, '08-bank-under-the-line');
  check('cashier: says what the bank will add', (await text(p, '.bank-status')) === 'You have $9,999.99 in all. The bank will add $40,000.01.', await text(p, '.bank-status'));
  check('cashier: the rule over the window', (await text(p, '.bank-rule')) === 'Under $10,000 in all? The bank tops you up to $50,000.', await text(p, '.bank-rule'));
  const loansBefore = Number(await text(p, '.bank-stats .stat:nth-child(3) .stat-value'));
  await p.click('.bank-take');
  await p.waitForFunction(() => document.querySelector('.bank-status')?.textContent?.startsWith('Loan made'));
  await p.waitForTimeout(500);
  await shot(p, '09-bank-topped-up');
  check('cashier: topped up by exactly the gap', (await text(p, '.bank-status')) === 'Loan made: $40,000.01 is in your balance, which makes $50,000 in all.', await text(p, '.bank-status'));
  check('cashier: balance now $50,000', (await text(p, '.bank-stats .stat:nth-child(1) .stat-value')) === '$50,000');
  check('cashier: the loan is counted', Number(await text(p, '.bank-stats .stat:nth-child(3) .stat-value')) === loansBefore + 1);
  await p.context().close();

  p = await open(bank);
  await p.waitForSelector('.bank-status:not(:empty)');
  await p.waitForTimeout(600);
  await shot(p, '10-bank-over-the-line');
  check('cashier: at $50,000 there is nothing to ask for', await p.isDisabled('.bank-take'));
  check('cashier: says why', (await text(p, '.bank-status')) === 'You have $50,000 in all. The bank tops you up when that is under $10,000.', await text(p, '.bank-status'));
  await p.context().close();
}

// ---- narrow screen, coming back
{
  const p = await open(`${dev}?screen=login&dock=0`, { viewport: { width: 390, height: 844 }, last: NAME });
  await p.waitForSelector('.pass-input');
  await p.waitForTimeout(700);
  await shot(p, '07-login-narrow');
  await p.context().close();
}

console.log(JSON.stringify({ out, shots: shots.length, failed: checks.filter((c) => !c.ok), passed: checks.filter((c) => c.ok).length, errors: errors.slice(0, 20) }, null, 1));
await browser.close();
if (checks.some((c) => !c.ok) || errors.length) process.exitCode = 1;
