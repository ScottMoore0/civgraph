// A flat shelf's rows: `first` at the top, `last` at the end (packages/map/src/catalogue/util.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderShelfRows } from '../../packages/map/src/catalogue/util.js';

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
