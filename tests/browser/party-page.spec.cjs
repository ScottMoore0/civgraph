const { test, expect } = require('@playwright/test');

/**
 * The party page's candidate list (11 Nov 2026).
 *
 * Fianna Fáil's page read its 3,372 people as seventeen pages of whole Browse cards from
 * /_api/persons?party= (about 14.6 MB), and the whole page waited for them. It now reads them from
 * the party's members view (/_api/parties?slug=&view=members: the fields of each election row the
 * list reads, packages/core/src/party-members.mjs), shows the page before the list arrives, and
 * fills the list in when it does.
 *
 * Checked on the largest list (the UUP's 4,509 people; Fianna Fáil's 3,372 are smaller in this form): what the list costs to transfer, that the page shows before the
 * list, and that the list is the one the cards gave -- the same people, in the same order, with
 * the same counts, votes, years, bodies and constituencies.
 */

test.use({ serviceWorkers: 'block' });

const PARTY = 'uup';
const BUDGET = 1024 * 1024;

test('the largest party\'s candidate list comes in under 1 MB and matches the cards', async ({ page }) => {
  test.setTimeout(120000);
  /** @type {{ url: string, bytes: number }[]} */
  const lists = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (!/\/_api\/(parties\?.*view=members|persons\?.*party=)/.test(url)) return;
    const body = await response.body().catch(() => null);
    if (body) lists.push({ url, bytes: body.length });
  });

  await page.goto(`/maps/#page=party:${PARTY}`);
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise, null, { timeout: 60000 });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);

  // The page is there with its history; the candidate list follows.
  const detail = page.locator('#catalogueDetailView');
  await expect(detail.locator('#catalogue-party-history-table-h')).toBeVisible({ timeout: 60000 });
  await expect(detail.locator('[data-party-candidates-loading]')).toHaveCount(0, { timeout: 60000 });
  await expect(detail.locator('#catalogue-party-candidates-table-h')).toHaveText(/^Candidates \([\d,]+\)$/);

  const fetched = lists.filter((r) => r.url.includes('view=members'));
  expect(fetched.length, 'the list is read from the members view').toBeGreaterThan(0);
  expect(lists.filter((r) => r.url.includes('/_api/persons')), 'and not from the cards').toEqual([]);
  const bytes = fetched.reduce((n, r) => n + r.bytes, 0);
  expect(bytes, `${fetched.length} request(s), ${bytes} bytes`).toBeLessThan(BUDGET);

  // The same list as the cards give, field by field as the table shows them.
  const compared = await page.evaluate(async (slug) => {
    const app = window.__civgraphTest2.app;
    const shown = window.uiController._electionEntityDetailCache.get(window.uiController._currentDetailViewKey);
    const response = await fetch(`/_api/parties?slug=${slug}`);
    const item = (await response.json()).item;
    const index = await app.loadPartyIndex();
    // All of them: at its usual 20 pages the cards path stopped at 4,000 people, short of the UUP's.
    const cards = await app.loadPartyCards(item, { maxPages: 40 });
    const before = app.buildPartyCandidateSummaries(item, cards.persons, index);
    const view = (rows) => rows.map((row) => ({
      personId: row.personId,
      name: row.name,
      totalFirstPrefs: row.totalFirstPrefs,
      timesStood: row.timesStood,
      timesElected: row.timesElected,
      byGroup: row.byGroup,
      firstYear: row.firstYear,
      lastYear: row.lastYear,
      constituencyGroups: row.constituencyGroups.map((g) => ({ name: g.name, label: g.label, years: g.years, count: g.count, elected: g.elected })),
    }));
    return {
      before: view(before.summaries),
      after: view(shown.candidateSummaries),
      listBefore: before.listEntries,
      listAfter: shown.listEntriesLeftOut,
      cappedBefore: cards.capped,
      cappedAfter: shown.candidatesCapped,
      cardPeople: cards.persons.length,
    };
  }, PARTY);
  expect(compared.cardPeople).toBeGreaterThan(3000);
  expect(compared.cappedAfter).toBe(compared.cappedBefore);
  expect(compared.listAfter).toBe(compared.listBefore);
  expect(compared.after.length).toBe(compared.before.length);
  expect(compared.after).toEqual(compared.before);

  // And the table shows it: its first row is the list's first person.
  const firstRow = detail.locator('[data-entity-table-host="catalogue-party-candidates-table"] tbody tr').first();
  await expect(firstRow).toContainText(compared.before[0].name);
});
