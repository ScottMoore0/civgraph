// The directly-elected-mayor plebiscites of 24 May 2019 (Phelim Birch review #104): three records
// under the Irish referendum body, titled by council, and their figures as the Department of
// Housing, Local Government and Heritage publishes them (each adds up).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalElectionTitle } from '../../scripts/lib/election-names.mjs';

const REF = { body: 'Referendum (Ireland)', bodySlug: 'ireland-referendum' };
const DIR = 'data/elections-source/data/elections/ireland-referendum';
/** @param {string} rel */
const readJson = (rel) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));

const PLEBISCITES = [
  ['cork-city', 'cork-city', '2019 Cork City directly elected mayor plebiscite', 'no'],
  ['limerick', 'limerick-city-and-county', '2019 Limerick directly elected mayor plebiscite', 'yes'],
  ['waterford', 'waterford-city-and-county', '2019 Waterford directly elected mayor plebiscite', 'no'],
];

test('each plebiscite is titled by its council', () => {
  for (const [tail, , title] of PLEBISCITES) {
    const date = `2019-05-24-directly-elected-mayor-${tail}`;
    assert.equal(canonicalElectionTitle({ ...REF, date, key: `ireland-referendum__${date}`, constituencies: ['x'] }), title);
  }
});

test("each plebiscite's figures add up and give its outcome", () => {
  for (const [tail, file, , outcome] of PLEBISCITES) {
    const c = readJson(`${DIR}/2019-05-24-directly-elected-mayor-${tail}/${file}.json`);
    assert.equal(c.yes + c.no, c.meta.valid_poll, tail);
    assert.equal(c.meta.valid_poll + c.meta.spoiled, c.meta.total_poll, tail);
    assert.equal(c.outcome, outcome, tail);
    assert.equal(c.candidates.find((/** @type {{ status: string }} */ x) => x.status === 'Made Quota').name.toLowerCase(), outcome);
  }
});
