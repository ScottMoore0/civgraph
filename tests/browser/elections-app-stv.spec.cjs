const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Readable STV counts in the Elections app (el-stv, 14 Nov 2026; the app is not public yet): each
// count labelled, the stepper (buttons, keys, URL), the transfers between candidates, the whole
// count as a flow, the quota's formula and the last seat, the count stacked on a phone, and an
// election's party-to-party transfers and closest seats. Needs the records build, like
// elections-app.spec.cjs; skipped without it.
const ROOT = path.join(__dirname, '..', '..');
const RECORDS = fs.existsSync(path.join(ROOT, 'tmp', 'records', 'civgraph-records.sqlite'));
const CONTEST = '/elections/northern-ireland-assembly-2022-05-05/belfast-east/';

test.describe('Civgraph Elections: STV counts', () => {
  test.skip(!RECORDS, 'needs the records build (npm run records:build)');

  test('every count is labelled with what it did; the quota gives its Droop formula; the last seat its margin', async ({ page }) => {
    await page.goto(CONTEST);
    const labels = page.locator('.el-count-labels li');
    await expect(labels).toHaveCount(11);
    await expect(labels.nth(0)).toHaveText('Count 1: first preferences');
    await expect(labels.nth(1)).toHaveText("Count 2: distribution of Naomi Long's surplus (986)");
    await expect(labels.nth(2)).toHaveText(/^Count 3: exclusion of Eoin MacNeill \(/);
    await expect(page.locator('[data-quota-formula="droop"]')).toContainText('divided by 6 (the 5 seats plus one), rounded down, plus one');
    await expect(page.locator('[data-margin]')).toContainText('won the last seat ahead of');
    // A fraction of the quota is never written as a percentage.
    await expect(page.locator('#el-quota')).not.toContainText('of quota');
  });

  test('the stepper steps with buttons and keys, keeps the count in the URL, and opens at a shared count', async ({ page }) => {
    await page.goto(`${CONTEST}?count=4`);
    const pos = page.locator('[data-step-pos]');
    await expect(pos).toHaveText('Count 4 of 11');
    await expect(page.locator('[data-step-now] h3')).toHaveText(/^Count 4: distribution of Joanne Bunting's surplus/);
    await page.locator('button[data-step="next"]').click();
    await expect(pos).toHaveText('Count 5 of 11');
    expect(new URL(page.url()).searchParams.get('count')).toBe('5');
    await page.locator('button[data-step="next"]').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(pos).toHaveText('Count 4 of 11');
    await page.keyboard.press('End');
    await expect(pos).toHaveText('Count 11 of 11');
    await expect(page.locator('button[data-step="next"]')).toBeDisabled();
    // The button that was used is now disabled: focus moved to one still enabled.
    await expect(page.locator('button[data-step="prev"]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(pos).toHaveText('Count 1 of 11');
    expect(new URL(page.url()).searchParams.get('count')).toBeNull();
    // The announcement is the count's label and sentences, not the whole page.
    await expect(page.locator('[data-step-now][aria-live="polite"]')).toContainText('The first preferences were counted.');
    await expect(page.locator('#el-view')).not.toHaveAttribute('aria-live', 'assertive');
  });

  test('transfers between candidates and the whole count as a flow, with names, titles and a table', async ({ page }) => {
    await page.goto(CONTEST);
    const matrix = page.locator('table.el-matrix');
    await expect(matrix.locator('tbody tr')).toHaveCount(10);
    await expect(matrix.locator('tbody tr').first()).toContainText("Naomi Long's surplus");
    const svg = page.locator('svg.el-sankey');
    await expect(svg).toHaveAttribute('role', 'img');
    await expect(svg.locator('text', { hasText: 'Naomi Long (elected)' })).toHaveCount(1);
    expect(await svg.locator('path title').count()).toBeGreaterThan(20);
  });

  test('on a phone: the count stacked a count at a time, no page overflow, the flow scrolls at full size', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(CONTEST);
    await expect(page.locator('.el-sheet-wrap')).toBeHidden();
    await expect(page.locator('.el-stacked .el-stack-count')).toHaveCount(11);
    await expect(page.locator('.el-stacked h3').nth(1)).toHaveText("Count 2: distribution of Naomi Long's surplus (986)");
    await expect(page.locator('table.el-matrix')).toBeHidden();
    const sizes = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      flow: document.querySelector('svg.el-sankey')?.getBoundingClientRect().width || 0,
      stepper: (() => { const w = document.querySelector('.el-stepper .cg-table-wrap'); return w ? w.scrollWidth - w.clientWidth : 0; })(),
    }));
    expect(sizes.page).toBeLessThanOrEqual(375);
    expect(sizes.flow).toBeGreaterThan(375);
    expect(sizes.stepper).toBeLessThanOrEqual(1);
    await expect(page.locator('.el-sankey-wrap')).toHaveAttribute('tabindex', '0');
  });

  test('an election: party-to-party transfers read on demand, with their coverage, and the closest last seats', async ({ page }) => {
    const bundles = [];
    page.on('request', (req) => { if (/format=bundle/.test(req.url())) bundles.push(req.url()); });
    await page.goto('/elections/northern-ireland-assembly-2022-05-05/');
    await expect(page.locator('#el-stv-election-h')).toBeVisible();
    expect(bundles).toHaveLength(0);
    await page.locator('.el-stv-load summary').click();
    await expect(page.locator('[data-stv-coverage]')).toContainText('Built from 18 of the 18 contests');
    await expect(page.locator('table.el-party-matrix tbody tr').first()).toBeVisible();
    await expect(page.locator('ol.el-closest li').first()).toContainText('won the last seat ahead of');
    expect(new URL(page.url()).searchParams.get('transfers')).toBe('1');
    expect(bundles).toHaveLength(1);
  });
});
