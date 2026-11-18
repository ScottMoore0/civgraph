/**
 * Seat apportionment (packages/core/src/apportionment.mjs): D'Hondt, Sainte-Laguë, the largest
 * remainder with the Hare quota, and plurality, on textbook cases, with caps and ties.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { divisor, highestAverages, largestRemainder, plurality } from '@civgraph/core/apportionment.mjs';

const lists = (/** @type {Record<string, number>} */ votes) => Object.entries(votes).map(([id, v]) => ({ id, votes: v }));
const obj = (/** @type {Map<string, number>} */ m) => Object.fromEntries([...m].sort());

test('divisors: D\'Hondt 1, 2, 3; Sainte-Laguë 1, 3, 5', () => {
  assert.deepEqual([0, 1, 2].map((h) => divisor('dhondt', h)), [1, 2, 3]);
  assert.deepEqual([0, 1, 2].map((h) => divisor('sainte-lague', h)), [1, 3, 5]);
});

test("D'Hondt: the textbook case (100 000, 80 000, 30 000, 20 000 for 8 seats)", () => {
  const v = lists({ A: 100000, B: 80000, C: 30000, D: 20000 });
  assert.deepEqual(obj(highestAverages(v, 8, 'dhondt')), { A: 4, B: 3, C: 1 });
});

test('Sainte-Laguë: the same votes give the smaller lists more', () => {
  const v = lists({ A: 100000, B: 80000, C: 30000, D: 20000 });
  assert.deepEqual(obj(highestAverages(v, 8, 'sainte-lague')), { A: 3, B: 3, C: 1, D: 1 });
});

test('largest remainder (Hare): whole quotas, then the largest remainders', () => {
  // 230 000 votes, 8 seats: quota 28 750. A 3 (rem 13 750), B 2 (rem 22 500), C 1 (rem 1 250), D 0 (rem 20 000).
  const v = lists({ A: 100000, B: 80000, C: 30000, D: 20000 });
  assert.deepEqual(obj(largestRemainder(v, 8)), { A: 3, B: 3, C: 1, D: 1 });
  assert.equal([...largestRemainder(v, 8).values()].reduce((s, n) => s + n, 0), 8);
});

test('a capped list (a candidate standing alone) takes no more than its cap', () => {
  const v = [{ id: 'Ind', votes: 90000, cap: 1 }, { id: 'P', votes: 10000 }];
  assert.deepEqual(obj(highestAverages(v, 3, 'dhondt')), { Ind: 1, P: 2 });
  assert.deepEqual(obj(highestAverages(v, 3, 'sainte-lague')), { Ind: 1, P: 2 });
  assert.deepEqual(obj(largestRemainder(v, 3)), { Ind: 1, P: 2 });
  // Every list capped and too few of them: the seats left stay empty rather than loop.
  const short = [{ id: 'X', votes: 5, cap: 1 }, { id: 'Y', votes: 3, cap: 1 }];
  assert.deepEqual(obj(highestAverages(short, 4)), { X: 1, Y: 1 });
  assert.deepEqual(obj(largestRemainder(short, 4)), { X: 1, Y: 1 });
});

test('ties go to the larger vote total, then the list id, whatever the input order', () => {
  // 6 and 3: after A's first seat, A/2 = 3 ties B/1 = 3: A has more votes.
  assert.deepEqual(obj(highestAverages(lists({ B: 3, A: 6 }), 2)), { A: 2 });
  // Equal votes: the id breaks the tie, in either order.
  assert.deepEqual(obj(highestAverages(lists({ Y: 10, X: 10 }), 1)), { X: 1 });
  assert.deepEqual(obj(highestAverages(lists({ X: 10, Y: 10 }), 1)), { X: 1 });
  assert.equal(plurality(lists({ Y: 10, X: 10 })), 'X');
});

test('lists with no votes take no seats; no votes at all gives nothing', () => {
  assert.deepEqual(obj(highestAverages(lists({ A: 10, Z: 0 }), 3)), { A: 3 });
  assert.equal(highestAverages([], 3).size, 0);
  assert.equal(largestRemainder(lists({ A: 0 }), 3).size, 0);
  assert.equal(plurality([]), null);
});

test('quotients are compared exactly, not as rounded floats', () => {
  // 3/3 = 1 and 1/1 = 1 exactly: the tie goes to the larger total (A), not to float noise.
  assert.deepEqual(obj(highestAverages(lists({ A: 3, B: 1 }), 3, 'dhondt')), { A: 3 });
  assert.deepEqual(obj(highestAverages(lists({ A: 3, B: 1 }), 4, 'dhondt')), { A: 3, B: 1 });
});
