// Presidential results by constituency (data/elections/president-constituency-results), from the
// Presidential Returning Officer's "Presidential Elections 1938-2025" booklet. Staged data: no build
// reads it yet. These checks hold the transcription to the booklet's own arithmetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'data', 'elections', 'president-constituency-results');
const NATIONAL = path.join(ROOT, 'data', 'elections-source', 'data', 'elections', 'ireland-president');
const COMBINED = 'county-limerick-including-limerick-county-borough.json';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const dates = readdirSync(DIR).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const areasOf = (date) => readdirSync(path.join(DIR, date))
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .map((f) => ({ file: f, ...readJson(path.join(DIR, date, f)) }));

test('every contested election from 1945 to 2025 is present', () => {
  assert.deepEqual(dates, ['1945-06-16', '1959-06-17', '1966-06-01', '1973-05-30', '1990-11-07', '1997-10-30', '2011-10-27', '2018-10-26', '2025-10-24']);
});

test('each area: first preferences plus invalid papers make the total poll', () => {
  for (const date of dates) {
    for (const a of areasOf(date)) {
      const valid = a.candidates.reduce((s, c) => s + c.counts[0], 0);
      assert.equal(a.meta.valid_poll, valid, `${date} ${a.constituency} valid poll`);
      assert.equal(valid + a.meta.spoiled, a.meta.total_poll, `${date} ${a.constituency} total poll`);
    }
  }
});

test('each later count: continuing candidates plus non-transferable papers make the valid poll', () => {
  for (const date of dates) {
    for (const a of areasOf(date)) {
      const n = a.candidates[0].counts.length;
      for (let c = 1; c < n; c++) {
        if (a.non_transferable?.[c] == null) continue;
        const live = a.candidates.reduce((s, x) => s + (x.counts[c] ?? 0), 0);
        assert.equal(live + a.non_transferable[c], a.meta.valid_poll, `${date} ${a.constituency} count ${c + 1}`);
      }
    }
  }
});

test('the areas add up to the national first count already filed for each election', () => {
  for (const date of dates) {
    const national = readJson(path.join(NATIONAL, date, 'ireland.json'));
    const sums = new Map();
    for (const a of areasOf(date)) {
      if (a.file === COMBINED) continue;
      for (const c of a.candidates) sums.set(c.name, (sums.get(c.name) || 0) + c.counts[0]);
    }
    for (const c of national.candidates) {
      assert.equal(sums.get(c.name), c.counts[0], `${date} ${c.name}`);
    }
  }
});

test('each area names one feature of its map, and no feature twice', () => {
  for (const date of dates) {
    const index = readJson(path.join(DIR, date, '_constituencies.json'));
    const features = index.constituencies.map((c) => c.feature);
    assert.ok(features.every(Boolean), `${date}: every area has a map feature`);
    assert.equal(new Set(features).size, features.length, `${date}: features are distinct`);
    for (const ref of index.references) assert.ok(ref.label && ref.url, `${date}: reference has label and url`);
  }
});
