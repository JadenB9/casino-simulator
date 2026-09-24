#!/usr/bin/env node
// Load time on a fresh browser: how long until the login screen (the floor loaded behind the
// loading screen), and until the floor is playable after logging in; every request by type with
// its bytes on the wire, and anything fetched twice. Point it at a production build (`vite preview`
// of dist/casino with the worker behind it) for real sizes; the dev server's are unbundled.
//
// Usage: node scripts/e2e/loadtime.mjs [port] [--net none|4g|3g] [--runs N] [--name perf_load]
//   4g: 9 Mbps down, 1.5 up, 150 ms round trips; 3g: 1.6 Mbps, 0.75 up, 300 ms.

import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const port = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')) ?? '4173';
const net = opt('net', 'none');
const runs = Number(opt('runs', 1));
const name = opt('name', 'perf_load');
const PROFILES = {
  none: null,
  '4g': { latency: 150, downloadThroughput: (9e6 / 8) | 0, uploadThroughput: (1.5e6 / 8) | 0 },
  '3g': { latency: 300, downloadThroughput: (1.6e6 / 8) | 0, uploadThroughput: (0.75e6 / 8) | 0 },
};

const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const all = [];
for (let run = 0; run < runs; run++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  if (PROFILES[net]) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...PROFILES[net] });
  const reqs = new Map();
  cdp.on('Network.responseReceived', (e) => {
    const r = reqs.get(e.requestId) ?? {};
    reqs.set(e.requestId, { ...r, url: e.response.url, status: e.response.status, type: e.type, mime: e.response.mimeType, cache: e.response.headers['cache-control'] ?? e.response.headers['Cache-Control'] ?? '' });
  });
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.bytes = e.encodedDataLength;
  });
  const errors = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));

  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/casino/`);
  await page.waitForSelector('.name-input', { timeout: 300_000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 300_000 });
  const loginAt = Date.now() - t0;
  const marks = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) };
  });
  const atLogin = [...reqs.values()];
  await page.fill('.name-input', name);
  await page.fill('.pass-input', 'casino-dev');
  const t1 = Date.now();
  await page.click('.enter-btn');
  await page.waitForSelector('.menu-item, .editor-panel', { timeout: 60_000 });
  if (await page.$('.menu-item')) await page.click('.menu-item >> nth=0');
  else {
    for (let k = 0; k < 10 && !(await page.$('.hud')); k++) {
      const next = await page.$('.editor-panel .ed-buttons .btn.primary');
      if (next) await next.click();
      await page.waitForTimeout(700);
    }
  }
  await page.waitForSelector('.hud', { timeout: 60_000 });
  const floorAt = Date.now() - t1;
  // what the first minute on the floor fetches (characters, lazily loaded parts)
  await page.waitForTimeout(3000);
  const list = [...reqs.values()].filter((r) => r.url && !r.url.startsWith('data:'));
  const kind = (r) => (/\.js(\?|$)/.test(r.url) ? 'js' : /\.css(\?|$)/.test(r.url) ? 'css' : /\.(glb|gltf)(\.gz)?(\?|$)/.test(r.url) ? 'models' : /\.(png|jpe?g|webp|ktx2|avif|svg)(\?|$)/.test(r.url) ? 'images' : /\.(woff2?|ttf|otf)(\?|$)/.test(r.url) ? 'fonts' : /\.(ogg|mp3|m4a|wav|webm)(\?|$)/.test(r.url) ? 'audio' : /\.json(\?|$)/.test(r.url) ? 'json' : /\/api\//.test(r.url) ? 'api' : 'other');
  const by = {};
  for (const r of list) {
    const k = kind(r);
    by[k] ??= { n: 0, kb: 0 };
    by[k].n++;
    by[k].kb += (r.bytes ?? 0) / 1024;
  }
  for (const k of Object.keys(by)) by[k].kb = Math.round(by[k].kb);
  const count = new Map();
  for (const r of list) count.set(r.url, (count.get(r.url) ?? 0) + 1);
  const twice = [...count].filter(([, n]) => n > 1).map(([u, n]) => `${n}x ${u.replace(/^.*\/casino\//, '')}`);
  const res = {
    net,
    loginScreenMs: loginAt,
    domContentLoadedMs: marks.domContentLoaded,
    floorAfterLoginMs: floorAt,
    requestsBeforeLogin: atLogin.length,
    kbBeforeLogin: Math.round(atLogin.reduce((a, r) => a + (r.bytes ?? 0), 0) / 1024),
    requests: list.length,
    kbTotal: Math.round(list.reduce((a, r) => a + (r.bytes ?? 0), 0) / 1024),
    byType: by,
    fetchedTwice: twice,
    errors: [...new Set(errors)].slice(0, 8),
  };
  all.push(res);
  console.log(JSON.stringify(res));
  await ctx.close();
}
if (runs > 1) {
  const med = (k) => [...all.map((r) => r[k])].sort((a, b) => a - b)[Math.floor(all.length / 2)];
  console.log('MEDIAN', JSON.stringify({ net, loginScreenMs: med('loginScreenMs'), floorAfterLoginMs: med('floorAfterLoginMs'), kbBeforeLogin: med('kbBeforeLogin'), kbTotal: med('kbTotal') }));
}
await browser.close();
