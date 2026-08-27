const { test, expect } = require('@playwright/test');

// The wordmark must SCALE on a narrow screen, never truncate and never disappear.
//
// It used to be a flat 60px at every width -- a 55px logo beside a 34px wordmark -- so on
// a phone it did not fit, and the mobile CSS hid the overflow behind an ellipsis
// ("Civgra...") and then removed the wordmark entirely below 360px. Reported from a real
// phone, 2026-08-27.
//
// Three stylesheets carry this header independently -- assets/css/main.css, browse.css,
// and build/about.css generated from main -- and browse.css had a SECOND flat override at
// its 900px breakpoint. Each page is checked, because fixing one did not fix the others.

const PHONE_WIDTHS = [320, 360, 375, 390, 414, 430];
const PAGES = [['home', '/'], ['browse', '/browse/'], ['apps', '/apps/']];

async function readBrand(page) {
  return page.evaluate(() => {
    const wordmark = document.querySelector('.app-header__wordmark');
    if (!wordmark) return null;
    const style = getComputedStyle(wordmark);
    const header = document.querySelector('.app-header').getBoundingClientRect();
    const brand = document.querySelector('.app-header__brand').getBoundingClientRect();
    return {
      text: wordmark.textContent.trim(),
      visible: style.display !== 'none' && wordmark.getBoundingClientRect().width > 0,
      fontPx: parseFloat(style.fontSize),
      // scrollWidth > clientWidth is the definition of "the text does not fit its box",
      // which is what an ellipsis hides.
      clipped: wordmark.scrollWidth > wordmark.clientWidth + 1,
      overflowsHeader: brand.right > header.right + 1,
    };
  });
}

for (const width of PHONE_WIDTHS) {
  test(`wordmark is whole and unclipped at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
    await page.waitForTimeout(1200);

    const brand = await readBrand(page);
    expect(brand, 'the wordmark should exist').toBeTruthy();
    expect(brand.text).toBe('Civgraph');
    expect(brand.visible, 'the wordmark must not be hidden on a phone').toBe(true);
    expect(brand.clipped, 'the wordmark must scale down, not be clipped').toBe(false);
    expect(brand.overflowsHeader, 'the brand must fit inside the header').toBe(false);
    // It must actually shrink rather than stay at its 34px desktop size.
    expect(brand.fontPx).toBeLessThan(28);
    expect(brand.fontPx, 'but not shrink to illegibility').toBeGreaterThan(12);
  });
}

for (const [name, url] of PAGES) {
  test(`${name} header brand survives a 390px screen`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(url);
    await page.waitForTimeout(2200);
    const brand = await readBrand(page);
    expect(brand, `${name} should carry the header brand`).toBeTruthy();
    expect(brand.text).toBe('Civgraph');
    expect(brand.visible).toBe(true);
    expect(brand.clipped, `${name} truncates the wordmark`).toBe(false);
  });
}

test('the desktop brand is unchanged', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  const brand = await readBrand(page);
  // The clamp reaches its 60px ceiling well below 1280, so desktop must look exactly as
  // it did: this fix was for phones and should be invisible here.
  expect(Math.round(brand.fontPx)).toBe(34);
  expect(brand.clipped).toBe(false);
});
