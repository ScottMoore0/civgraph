import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1400 } });
const page = await ctx.newPage();
await page.goto('https://civgraph.net/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForTimeout(14000);
const failed = (await page.evaluate(() => document.body.innerText)).includes('Failed to load Civgraph runtime');
console.log('runtime failed:', failed, '| c1-cards:', await page.locator('.c1-card').count());
if (!failed) {
  await page.locator('text=Wards & Electoral Divisions').first().click({ timeout: 60000 });
  await page.waitForTimeout(3500);
  const out = await page.evaluate(() => ({
    containers: document.querySelectorAll('.variants-container').length,
    expanded: document.querySelectorAll('.variants-container--expanded').length,
    activeToggles: document.querySelectorAll('.variants-toggle.active').length,
    visibleVariants: [...document.querySelectorAll('.variant-item')].filter(e => e.offsetParent !== null).length
  }));
  console.log('LIVE variants:', JSON.stringify(out));
}
await browser.close();
