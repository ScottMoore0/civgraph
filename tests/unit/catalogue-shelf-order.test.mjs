// A flat shelf's rows: `first` at the top, `last` at the end (packages/map/src/catalogue/util.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderShelfRows, otherRowsLast } from '../../packages/map/src/catalogue/util.js';

const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
const ids = (/** @type {{ id: string }[]} */ r) => r.map((x) => x.id).join('');

test('first rows lead, last rows trail, the rest keep their order', () => {
  assert.equal(ids(orderShelfRows(rows, {})), 'abcde');
  assert.equal(ids(orderShelfRows(rows, { first: ['d'] })), 'dabce');
  assert.equal(ids(orderShelfRows(rows, { last: ['b', 'a'] })), 'cdeba');
  assert.equal(ids(orderShelfRows(rows, { first: ['e', 'c'], last: ['a'] })), 'ecbda');
});

test('an id the shelf does not show is skipped, and a row is never listed twice', () => {
  assert.equal(ids(orderShelfRows(rows, { first: ['x', 'b'], last: ['b', 'y'] })), 'bacde');
});

test('Water opens with the coast (Phelim Birch review #70)', () => {
  const src = JSON.parse(readFileSync('data/catalogue/catalogue.source.json', 'utf8'));
  assert.deepEqual(src.shelves.find((/** @type {{ id: string }} */ s) => s.id === 'water').first, ['coasts-seas-and-islands-coastline']);
});

test('a row named "Other ..." goes to the end of its shelf, after the last rows (Phelim Birch review #18)', () => {
  const named = [{ id: 'a', name: 'Plans' }, { id: 'o', name: 'Other' }, { id: 'b', name: 'Registers' }, { id: 'p', name: 'Other Sites' }, { id: 'c', name: 'Otherworld Tours' }];
  assert.equal(ids(orderShelfRows(named, {})), 'abcop');
  assert.equal(ids(orderShelfRows(named, { last: ['a'] })), 'bcaop');
  assert.equal(ids(orderShelfRows(named, { first: ['o'] })), 'abcop');
  assert.equal(ids(otherRowsLast(named)), 'abcop');
  assert.equal(ids(otherRowsLast(rows)), 'abcde');
});

test('Planning & Property ends with its "Other" row', () => {
  const src = JSON.parse(readFileSync('data/catalogue/catalogue.source.json', 'utf8'));
  /** @type {{ id: string, name: string, subject: string }[]} */
  const series = src.series;
  const shelf = src.shelves.find((/** @type {{ id: string }} */ s) => s.id === 'planning-and-property');
  const rowsOf = shelf.subjects.flatMap((/** @type {string} */ sub) => series.filter((s) => s.subject === sub));
  const ordered = orderShelfRows(rowsOf, shelf);
  assert.equal(ordered.at(-1)?.id, 'housing-and-regeneration-housing-and-land');
});

test('on every shelf, Surfaces & Scans included, no row follows an "Other ..." row (Phelim Birch review #18)', () => {
  const src = JSON.parse(readFileSync('data/catalogue/catalogue.source.json', 'utf8'));
  /** @type {{ id: string, name: string, subject: string }[]} */
  const series = src.series;
  const isOther = (/** @type {{ name: string }} */ s) => /^other(?![a-z])/i.test(s.name.trim());
  assert.ok(src.shelves.some((/** @type {{ id: string }} */ s) => s.id === 'surfaces-and-scans'));
  for (const shelf of src.shelves) {
    const rowsOf = shelf.subjects.flatMap((/** @type {string} */ sub) => series.filter((s) => s.subject === sub));
    // A row a test names as "Other" on this shelf, to prove the rule holds where none is yet.
    const probe = { id: `${shelf.id}--probe-other`, name: 'Other', subject: shelf.subjects[0] };
    const ordered = orderShelfRows([probe, ...rowsOf], shelf);
    const firstOther = ordered.findIndex(isOther);
    assert.ok(ordered.slice(firstOther).every(isOther), shelf.id);
    assert.equal(ordered.at(-1)?.name.trim().toLowerCase().startsWith('other'), true, shelf.id);
  }
});
