// Screenshots of a dev page, for looking at the cars: node scripts/e2e/cars6-shot.mjs <out.png> <path?query> [<out2.png> <path2>...]
//   BASE=http://localhost:6360 by default; GPU=1 uses the Mac's GPU.
import { chromium } from 'playwright';

const base = process.env.BASE ?? 'http://localhost:6360';
const pairs = process.argv.slice(2);
const browser = await chromium.launch(process.env.GPU === '1' ? { channel: 'chromium', args: ['--ignore-gpu-blocklist'] } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 800) } });
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('console:', m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
for (let i = 0; i < pairs.length; i += 2) {
  await page.goto(`${base}${pairs[i + 1]}`);
  await page.waitForTimeout(Number(process.env.WAIT ?? 2500));
  await page.screenshot({ path: pairs[i] });
  console.log('saved', pairs[i]);
}
await browser.close();
