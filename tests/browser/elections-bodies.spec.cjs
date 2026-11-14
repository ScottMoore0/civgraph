const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The Elections app's by-election tracker and council control (stream el-bodies, 14 Nov 2026).
// Both read tables built with the pivot extracts (npm run build:elections-app); without them the
// views say they are not available, and these tests skip.
const ROOT = path.join(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'site', 'apps', 'elections', 'extracts', 'index.json');
const TABLES = fs.existsSync(INDEX) && !!JSON.parse(fs.readFileSync(INDEX, 'utf8')).tables;

test.describe('Civgraph Elections: by-elections and council control', () => {
  test.skip(!TABLES, 'needs the extracts with their tables (npm run build:elections-app)');

  test('by-elections: summary, filters kept in the address, CSV, keyboard-reachable table', async ({ page }) => {
    await page.goto('/elections/byelections/');
    await expect(page.locator('h1')).toHaveText('By-elections and vacancies');
    await expect(page.locator('.cg-tabs__bar a[data-tab="byelections"]')).toHaveAttribute('aria-current', 'page');
    const summary = page.locator('#be-summary');
    await expect(summary).toContainText(/by-elections, [\d,]+ changed hands\./);
    await expect(page.locator('.el-be-table tbody tr')).toHaveCount(100);
    await page.selectOption('#be-body', 'northern-ireland-assembly');
    await expect(page).toHaveURL(/body=northern-ireland-assembly/);
    await expect(page.locator('.el-be-table tbody tr')).toHaveCount(4);
    await page.selectOption('#be-result', 'gained');
    await expect(page).toHaveURL(/result=gained/);
    const rows = await page.locator('.el-be-table tbody tr').count();
    await expect(summary).toContainText(`${rows} by-election`);
    // The state reloads from the address.
    await page.reload();
    await expect(page.locator('#be-body')).toHaveValue('northern-ireland-assembly');
    await expect(page.locator('.el-be-table tbody tr')).toHaveCount(rows);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#be-csv')]);
    expect(download.suggestedFilename()).toBe('civgraph-by-elections.csv');
    const csv = fs.readFileSync(await download.path(), 'utf8').trim().split('\n');
    expect(csv[0]).toMatch(/^date,type,body,area,/);
    expect(csv.length - 1).toBe(rows);
    await expect(page.locator('.el-be-table').locator('xpath=ancestor::div[@role="region"]')).toHaveAttribute('tabindex', '0');
  });

  test('by-elections: sorting by a party\'s share shows that share, and a filter keeps focus in the form', async ({ page }) => {
    await page.goto('/elections/byelections/?body=dail-eireann&sort=share&party=fianna-fail');
    await expect(page.locator('.el-be-table thead th').last()).toContainText('Share');
    await page.focus('#be-area');
    await page.keyboard.type('dublin');
    await expect(page).toHaveURL(/area=dublin/);
    await expect(page.locator('#be-area')).toBeFocused();
    const first = await page.locator('.el-be-table tbody tr').first().locator('th').innerText();
    expect(first.toLowerCase()).toContain('dublin');
  });

  test('council control: a council\'s timeline with its predecessor, the chart rows and the table', async ({ page }) => {
    await page.goto('/elections/control/?council=ni-1973-belfast');
    await expect(page.locator('h1')).toContainText('Belfast');
    await expect(page.locator('.el-ctl-chart li').first()).toContainText('1973');
    await expect(page.locator('.el-ctl-table tbody tr').first()).toContainText('whole council elected');
    await expect(page.getByRole('link', { name: 'Belfast County Borough Council' }).first()).toBeVisible();
    await expect(page.locator('.el-ctl-pred')).toHaveCount(1);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#cc-csv')]);
    expect(download.suggestedFilename()).toBe('civgraph-council-control-ni-1973-belfast.csv');
  });

  test('council control: every council in a year, stepping years, no page overflow at phone width (both views)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/elections/control/?year=1967');
    await expect(page.locator('h1')).toHaveText('Council control, 1967');
    await expect(page.locator('#cc-summary')).toContainText(/councils in 1967\./);
    expect(await page.locator('table tbody tr').count()).toBeGreaterThan(40);
    await page.click('#cc-next');
    await expect(page).toHaveURL(/year=1968/);
    await expect(page.locator('#cc-next')).toBeFocused();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.goto('/elections/control/?council=belfast-county-borough-council');
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow2).toBeLessThanOrEqual(0);
    await page.goto('/elections/byelections/');
    await expect(page.locator('.el-be-table')).toBeVisible();
    const overflow3 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow3).toBeLessThanOrEqual(0);
  });

  test('an unknown council is "Not found"', async ({ page }) => {
    await page.goto('/elections/control/?council=no-such-council');
    await expect(page.locator('h1')).toHaveText('Not found');
  });
});
