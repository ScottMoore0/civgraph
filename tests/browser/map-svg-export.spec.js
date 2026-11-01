const { test, expect } = require('@playwright/test');
const fs = require('fs');

/**
 * "Download SVG" (app/src/map-image-export.js): a map as a Wikipedia-style locator map.
 * Driven through the real app on NI Westminster 2023 (the 2024 general election boundaries):
 * the feature details box offers the download, the file is a valid standalone SVG, the
 * clicked constituency is #ff0000, the rest #ffc8c8, the neighbouring land is grey, and the
 * major loughs (Neagh, Erne, Strangford) are cut out and left unfilled, as on the Commons file.
 *
 * The layer's FlatGeobuf and tiles come from R2, so these need the network, as the rest of
 * the app suite does.
 */

test.use({ serviceWorkers: 'block', acceptDownloads: true, viewport: { width: 1280, height: 900 } });

const FST = [-7.45, 54.35];

async function boot(page, hash) {
  await page.goto(`/maps/${hash}`);
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise, null, { timeout: 60000 });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.evaluate(() => window.__civgraphTest2.app.mapController.waitUntilSettled({ timeoutMs: 30000 }));
}

async function clickLngLat(page, lngLat) {
  const point = await page.evaluate((ll) => {
    const map = window.__civgraphTest2.app.mapController.map;
    const p = map.project(ll);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, lngLat);
  await page.mouse.click(point.x, point.y);
}

async function readDownload(download) {
  const file = await download.path();
  return fs.readFileSync(file, 'utf8');
}

/** Parse in the page: the SVG must be well-formed XML with a sensible viewBox. */
async function inspectSvg(page, svg) {
  return page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return { error: doc.querySelector('parsererror').textContent };
    const root = doc.documentElement;
    const features = root.querySelector('#Features');
    const painted = (el) => (el.getAttribute('style') || '').match(/fill:(#[0-9a-f]{3,6})/i)?.[1]?.toLowerCase() || null;
    const red = [...features.querySelectorAll('path')].filter((p) => painted(p) === '#ff0000');
    return {
      root: root.localName,
      viewBox: root.getAttribute('viewBox'),
      title: root.querySelector(':scope > title')?.textContent || '',
      desc: root.querySelector(':scope > desc')?.textContent || '',
      licence: root.querySelector('metadata')?.innerHTML.includes('creativecommons.org/licenses/by-sa/4.0') || false,
      groupFill: painted(features),
      featureCount: features.querySelectorAll('path').length,
      allHaveTitles: [...features.querySelectorAll('path')].every((p) => p.querySelector('title')?.textContent),
      red: red.map((p) => ({ id: p.id, title: p.querySelector('title')?.textContent })),
      landFill: painted(root.querySelector('#ContextLand')),
      landIds: [...root.querySelectorAll('#ContextLand path')].map((p) => p.id),
      outline: painted(root.querySelector('#Outline')),
      loughCutRule: root.querySelector('clipPath#LoughCut path')?.getAttribute('style') || '',
      loughCutRings: (root.querySelector('clipPath#LoughCut path')?.getAttribute('d') || '').split('M').length - 1,
      cutGroup: root.querySelector('#LandAndFeatures')?.getAttribute('clip-path') || '',
      cutHolds: ['ContextLand', 'Outline', 'Features'].every((id) => root.querySelector(`#LandAndFeatures > #${id}`)),
      shores: Boolean(root.querySelector('#Loughs #LoughShores')?.getAttribute('d')),
      darkShores: root.querySelector('#Loughs #LoughShoresInFeatures')?.getAttribute('clip-path') || '',
      externalRefs: [...root.querySelectorAll('[href], [*|href], image, use')].map((el) => el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).filter((h) => h && !h.startsWith('#'))
    };
  }, svg);
}

/**
 * Rasterise the SVG in the page and read the pixels at some places (lon, lat), using the view
 * bounds the file records: [r, g, b, a] each, a = 0 where nothing is drawn (sea, loughs).
 */
async function sampleSvg(page, svg, places) {
  return page.evaluate(async ({ text, places: where }) => {
    const bounds = text.match(/view bounds (-?[\d.]+), (-?[\d.]+), (-?[\d.]+), (-?[\d.]+)/).slice(1).map(Number);
    const [west, south, east, north] = bounds;
    const mx = (lon) => lon * Math.PI / 180;
    const my = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    const width = Number(root.getAttribute('width'));
    const height = Number(root.getAttribute('height'));
    const scale = 800 / (mx(east) - mx(west));
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    const out = {};
    for (const [name, [lon, lat]] of Object.entries(where)) {
      const x = Math.round((mx(lon) - mx(west)) * scale);
      const y = Math.round((my(north) - my(lat)) * scale);
      out[name] = [...ctx.getImageData(x, y, 1, 1).data];
    }
    return out;
  }, { text: svg, places });
}

test.describe('Download SVG: a Wikipedia-style locator map of the view', () => {
  test.setTimeout(120000);

  test('the feature details box offers it, and the selected constituency is red on grey neighbouring land', async ({ page }) => {
    await boot(page, '#layers=pc-2023&lng=-6.75&lat=54.65&zoom=7.4');
    await clickLngLat(page, FST);
    const button = page.locator('#featureInfo .feature-info__export-btn');
    await expect(button).toBeVisible({ timeout: 20000 });
    await expect(button).toHaveAccessibleName('Download locator map (SVG)');

    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), button.click()]);
    expect(download.suggestedFilename()).toMatch(/^pc-2023-fermanagh-and-south-tyrone\.svg$/);
    const svg = await readDownload(download);
    expect(svg.startsWith('<?xml')).toBe(true);
    const info = await inspectSvg(page, svg);
    expect(info.error).toBeUndefined();
    expect(info.root).toBe('svg');
    expect(info.viewBox).toMatch(/^0 0 800 \d+$/);
    expect(info.groupFill).toBe('#ffc8c8');
    expect(info.outline).toBe('#f3a6b2');
    expect(info.red).toHaveLength(1);
    expect(info.red[0].title).toMatch(/fermanagh and south tyrone/i);
    expect(info.red[0].id).toBe('FermanaghAndSouthTyrone');
    expect(info.featureCount).toBeGreaterThanOrEqual(18);
    expect(info.allHaveTitles).toBe(true);
    // Neighbouring land: the rest of the island and Great Britain are in frame, drawn grey.
    expect(info.landFill).toBe('#dcdcdc');
    expect(info.landIds).toEqual(expect.arrayContaining(['LandIreland', 'LandGreatBritain']));
    expect(info.licence).toBe(true);
    expect(info.desc).toContain('Civgraph (civgraph.net), CC BY-SA 4.0');
    expect(info.desc).toContain('OSNI');
    expect(info.externalRefs).toEqual([]);
    // The loughs are cut out of land, outline and features with an even-odd clip, and their
    // shores drawn, dark over the features; the credits name the lough sources.
    expect(info.loughCutRule).toContain('clip-rule:evenodd');
    expect(info.loughCutRings).toBeGreaterThanOrEqual(5);
    expect(info.cutGroup).toBe('url(#LoughCut)');
    expect(info.cutHolds).toBe(true);
    expect(info.shores).toBe(true);
    expect(info.darkShores).toBe('url(#FeatureArea)');
    expect(info.desc).toContain('Loughs, cut out and left unfilled');
    expect(info.desc).toContain('DAERA');
    expect(info.desc).toContain('Tailte Éireann');
    // Drawn: Lough Neagh, Lower Lough Erne (inside Fermanagh and South Tyrone) and Strangford
    // Lough are unfilled, as on the Commons file; the constituency around them is red.
    const pixels = await sampleSvg(page, svg, {
      neagh: [-6.45, 54.6], lowerErne: [-7.8, 54.47], strangford: [-5.6, 54.5], fst: [-7.45, 54.35]
    });
    expect(pixels.neagh[3]).toBe(0);
    expect(pixels.lowerErne[3]).toBe(0);
    expect(pixels.strangford[3]).toBe(0);
    expect(pixels.fst.slice(0, 3)).toEqual([255, 0, 0]);
    await expect(button).toBeEnabled();
  });

  test('the map\'s Download menu offers the SVG and PNG, and keeps a selection whose details are open', async ({ page }) => {
    await boot(page, '#layers=pc-2023&lng=-6.75&lat=54.65&zoom=7.4');
    await clickLngLat(page, FST);
    await expect(page.locator('#featureInfo .feature-info__export-btn')).toBeVisible({ timeout: 20000 });

    await page.fill('#searchInput', 'Parliamentary Constituencies');
    const trigger = page.locator('[data-cn-act="downloads"][data-map="pc-2023"]').first();
    await expect(trigger).toBeVisible({ timeout: 20000 });
    // Let the results settle: a re-render replaces the row and would close its menu.
    await page.waitForTimeout(1500);
    await trigger.click();
    await expect(page.getByRole('menuitem', { name: 'Map image of this view (PNG)' })).toBeVisible();
    const item = page.getByRole('menuitem', { name: 'Map image of this view (SVG)' });
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), item.click()]);
    const info = await inspectSvg(page, await readDownload(download));
    expect(info.error).toBeUndefined();
    expect(info.red.map((r) => r.id)).toEqual(['FermanaghAndSouthTyrone']);
    expect(info.landIds).toContain('LandIreland');
  });
});
