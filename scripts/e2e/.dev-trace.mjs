import { chromium } from 'playwright';
const [url] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  const orig = Element.prototype.remove;
  Element.prototype.remove = function () { if (this.classList?.contains('ft-card')) console.log('REMOVE ft-card', new Error().stack); return orig.call(this); };
  const rc = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...a) { if (this.classList?.contains('ft-cards')) console.log('REPLACE', a.length, new Error().stack.split('\n').slice(0,4).join(' | ')); return rc.apply(this, a); };
});
const page = await ctx.newPage();
page.on('console', (m) => /REMOVE|REPLACE/.test(m.text()) && console.log(m.text().slice(0, 600)));
await page.goto(url);
await page.waitForTimeout(1500);
await browser.close();
