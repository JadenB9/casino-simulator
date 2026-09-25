import { chromium } from 'playwright';
const [port, out] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [w, h] of [[1280, 800], [1440, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=low`);
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 600000 });
  for (const dir of [true, false]) {
    await page.evaluate((d) => window.casino.world.map.show(d), dir);
    await page.waitForTimeout(600);
    const box = await page.evaluate(() => { const r = document.querySelector('.map-svg').getBoundingClientRect(); return [r.top, r.bottom, r.width, innerHeight]; });
    console.log(w, h, dir ? 'directory' : 'map', box.map(Math.round).join(' '));
    await page.screenshot({ path: `${out}/map-${w}-${dir ? 'dir' : 'map'}.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.close();
}
await browser.close();
