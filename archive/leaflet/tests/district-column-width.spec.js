const { test, expect } = require('@playwright/test');

test('local results District cells show full names without truncation', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(async () => {
    const electionController = (await import('/js/election-controller.js')).default;
    await electionController.loadElection('Belfast', '2023-05-18');
  });

  await page.getByRole('button', { name: 'By Candidate' }).click();
  const candidateRows = await page.evaluate(() => {
    return [...document.querySelectorAll('.election-count-table--candidate-sticky3 .election-cell-wrap--district')]
      .map((el) => ({
        text: el.textContent.trim(),
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight
      }));
  });
  expect(candidateRows.length).toBeGreaterThan(0);
  for (const row of candidateRows) {
    expect(row.scrollHeight, `District truncated in By Candidate: ${row.text}`).toBeLessThanOrEqual(row.clientHeight + 1);
  }

  await page.getByRole('button', { name: 'By Local Party' }).click();
  const localPartyRows = await page.evaluate(() => {
    return [...document.querySelectorAll('.election-count-table--local-party-sticky4 .election-cell-wrap--district')]
      .map((el) => ({
        text: el.textContent.trim(),
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight
      }));
  });
  expect(localPartyRows.length).toBeGreaterThan(0);
  for (const row of localPartyRows) {
    expect(row.scrollHeight, `District truncated in By Local Party: ${row.text}`).toBeLessThanOrEqual(row.clientHeight + 1);
  }
});
