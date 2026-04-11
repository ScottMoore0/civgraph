/**
 * Contrast audit — runs axe-core against the homepage shell in light and
 * dark mode and writes a JSON report of WCAG 2.1 AA colour-contrast and
 * related violations to tests/browser/contrast-audit-report.json.
 *
 * axe-core is loaded from CDN at test runtime so this spec adds no npm deps.
 * Re-run with: npx playwright test contrast-audit
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const AXE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';

async function runAxe(page, modeLabel) {
  await page.addScriptTag({ url: AXE_CDN });
  // Only the contrast-related rules to keep the report focused.
  const result = await page.evaluate(async () => {
    /* global axe */
    return await axe.run(document, {
      runOnly: {
        type: 'rule',
        values: [
          'color-contrast',
          'color-contrast-enhanced',
          'link-in-text-block'
        ]
      },
      resultTypes: ['violations']
    });
  });
  return {
    mode: modeLabel,
    url: page.url(),
    timestamp: new Date().toISOString(),
    violationCount: result.violations.length,
    violations: result.violations.map(v => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      helpUrl: v.helpUrl,
      nodes: v.nodes.map(n => ({
        target: n.target,
        html: n.html.length > 240 ? n.html.slice(0, 240) + '…' : n.html,
        failureSummary: n.failureSummary
      }))
    }))
  };
}

test('contrast audit — light + dark', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#searchInput')).toBeVisible();

  // Light mode
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(150);
  const light = await runAxe(page, 'light');

  // Dark mode
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(150);
  const dark = await runAxe(page, 'dark');

  const report = { generatedAt: new Date().toISOString(), light, dark };
  const outPath = path.join(__dirname, 'contrast-audit-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Contrast audit written: ${outPath}`);
  console.log(`  light: ${light.violationCount} violation rules`);
  console.log(`  dark : ${dark.violationCount} violation rules`);
});
