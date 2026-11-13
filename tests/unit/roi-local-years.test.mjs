// Republic of Ireland local years whose councils polled on different days (owner, 13 Nov 2026,
// OT28): each council is filed under its own poll date, and the year's dates list as one year.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROI_STAGGERED_LOCAL_YEARS, isRoiStaggeredLocalYear, isRoiStaggeredRound, roiLocalYearKey, roiLocalYearTitle,
  groupRoiStaggeredRounds, buildRoiLocalYearEntry, replaceRoiStaggeredRoundsWithYears,
} from '../../packages/core/src/roi-local-years.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the staggered years are 1928, 1934, 1955 and 1960', () => {
  assert.deepEqual([...ROI_STAGGERED_LOCAL_YEARS], [1928, 1934, 1955, 1960]);
  for (const y of [1928, '1934', '1955-06-23', 1960]) assert.ok(isRoiStaggeredLocalYear(y), String(y));
  for (const y of [1942, 1945, 1950, 1967, 1974, 2024]) assert.ok(!isRoiStaggeredLocalYear(y), String(y));
});

test('only the staggered years may hold more than one ireland-local poll date', () => {
  const dir = path.join(ROOT, 'data', 'elections-source', 'data', 'elections', 'ireland-local');
  /** @type {Map<string, string[]>} */
  const byYear = new Map();
  for (const name of readdirSync(dir)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
    const y = name.slice(0, 4);
    byYear.set(y, [...(byYear.get(y) || []), name]);
  }
  for (const [year, dates] of byYear) {
    if (dates.length > 1) assert.ok(isRoiStaggeredLocalYear(year), `${year} has ${dates.length} poll dates (${dates.join(', ')}) but is not a staggered year`);
  }
});

const round = (date, body = 'Irish local elections') => ({ key: `ireland-local__${date}`, bodySlug: 'ireland-local', body, date });

test('a staggered year groups its council dates; other years and bodies do not', () => {
  assert.ok(isRoiStaggeredRound(round('1955-06-23')));
  assert.ok(!isRoiStaggeredRound(round('1967-06-28')));
  assert.ok(!isRoiStaggeredRound({ ...round('1955-06-23'), bodySlug: 'ni-local' }));
  assert.ok(!isRoiStaggeredRound({ key: 'belfast-county-borough-council__1955-05-18', bodySlug: 'belfast-county-borough-council', date: '1955-05-18' }));
  const groups = groupRoiStaggeredRounds([round('1955-06-30'), round('1967-06-28'), round('1955-06-23'), round('1934-06-26')]);
  assert.deepEqual([...groups.keys()], [1934, 1955]);
  assert.deepEqual(groups.get(1955)?.map((r) => r.date), ['1955-06-23', '1955-06-30']);
  assert.equal(roiLocalYearKey('1955-06-23'), 'roi-local__1955');
  assert.equal(roiLocalYearTitle(1955), '1955 Irish local elections');
  const entry = buildRoiLocalYearEntry(1955, groups.get(1955));
  assert.equal(entry.key, 'roi-local__1955');
  assert.equal(entry.displayTitle, '1955 Irish local elections');
  assert.deepEqual(entry.dates, ['1955-06-23', '1955-06-30']);
  assert.deepEqual(entry.roundKeys, ['ireland-local__1955-06-23', 'ireland-local__1955-06-30']);
});

test('a list shows one entry for a staggered year, where its first date was', () => {
  const list = [round('1967-06-28'), round('1955-06-30'), { key: 'x', bodySlug: 'dail-eireann', date: '1957-03-05' }, round('1955-06-23')];
  const out = replaceRoiStaggeredRoundsWithYears(list);
  assert.deepEqual(out.map((e) => e.key), ['ireland-local__1967-06-28', 'roi-local__1955', 'x']);
});
