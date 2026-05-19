const { test, expect } = require('@playwright/test');

test('1955 counties and provinces catalogue metadata is exposed correctly', async ({ page }) => {
  await page.goto('/#layers=__none');
  await page.waitForFunction(() =>
    window.uiController
    && document.querySelector('[data-c1-id="flat-counties"]')
    && document.querySelector('[data-c1-id="flat-provinces"]')
  );

  const metadata = await page.evaluate(() => {
    const readMember = (cardId, mapId) => {
      const card = document.querySelector(`[data-c1-id="${cardId}"]`);
      const member = card?.querySelector(`.class-member[data-map-id="${mapId}"]`);
      return {
        exists: !!member,
        name: member?.querySelector('.class-member__name')?.textContent?.trim() || '',
        provider: member?.querySelector('.class-member__provider')?.textContent?.trim() || ''
      };
    };

    return {
      counties1955: readMember('flat-counties', 'counties-ireland-1955'),
      provincesCurrent: readMember('flat-provinces', 'provinces'),
      provinces1955: readMember('flat-provinces', 'provinces-1955')
    };
  });

  expect(metadata.counties1955.exists).toBe(true);
  expect(metadata.counties1955.name).toBe('1955');
  expect(metadata.counties1955.provider).toContain('OSI');
  expect(metadata.counties1955.provider).toContain('Phelim Birch');

  expect(metadata.provincesCurrent.exists).toBe(true);
  expect(metadata.provincesCurrent.name).toBe('2019');

  expect(metadata.provinces1955.exists).toBe(true);
  expect(metadata.provinces1955.name).toBe('1955');
  expect(metadata.provinces1955.provider).toContain('OSI');
  expect(metadata.provinces1955.provider).toContain('Phelim Birch');
});
