// Every row of a paged records answer, the pages after the first asked a few at a time
// (packages/map/src/app/paged-fetch.mjs; the party pages' candidate lists).
//
//   node --test tests/unit/paged-fetch.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAllPages } from '../../packages/map/src/app/paged-fetch.mjs';

const ids = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `p${from + i}` }));
const options = { pageSize: 200, maxPages: 20, idOf: (row) => row.id };

/** A paging endpoint over `total` rows, recording the pages asked and how many at once. */
function endpoint(total, { pageable = true, failPage = -1, withTotal = true } = {}) {
  const asked = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchPage = async (page) => {
    asked.push(page);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    if (page === failPage) return null;
    const start = pageable ? page * 200 : 0;
    return { rows: ids(Math.max(0, Math.min(200, total - start)), start), ...(withTotal ? { total } : {}) };
  };
  return { fetchPage, asked, get maxInFlight() { return maxInFlight; } };
}

test('every row, in order, the later pages a few at a time', async () => {
  const e = endpoint(3372);
  const { rows, capped } = await loadAllPages(e.fetchPage, options);
  assert.equal(rows.length, 3372);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.id), ['p0', 'p1']);
  assert.equal(rows.at(-1).id, 'p3371');
  assert.equal(capped, false);
  assert.equal(e.asked.length, 17);
  assert.ok(e.maxInFlight > 1 && e.maxInFlight <= 4, `in flight: ${e.maxInFlight}`);
});

test('one short page is the whole answer', async () => {
  const e = endpoint(57);
  assert.deepEqual(await loadAllPages(e.fetchPage, options).then((r) => [r.rows.length, r.capped]), [57, false]);
  assert.deepEqual(e.asked, [0]);
});

test('partial answers are marked capped', async () => {
  // More rows than maxPages holds.
  assert.equal((await loadAllPages(endpoint(5000).fetchPage, options)).capped, true);
  // An endpoint that does not page: every page repeats the first.
  const flat = await loadAllPages(endpoint(3372, { pageable: false }).fetchPage, options);
  assert.deepEqual([flat.rows.length, flat.capped], [200, true]);
  // A page that fails.
  const failed = await loadAllPages(endpoint(1000, { failPage: 2 }).fetchPage, options);
  assert.deepEqual([failed.rows.length, failed.capped], [400, true]);
  // No first page at all.
  assert.deepEqual(await loadAllPages(async () => null, options), { rows: [], capped: true });
});

test('without a total, pages are asked one after another until a short one', async () => {
  const e = endpoint(450, { withTotal: false });
  const { rows, capped } = await loadAllPages(e.fetchPage, options);
  assert.deepEqual([rows.length, capped], [450, false]);
  assert.deepEqual(e.asked, [0, 1, 2]);
});
