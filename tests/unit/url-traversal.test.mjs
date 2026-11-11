// The address a Back or Forward step arrived at (packages/map/src/app/url-sync.mjs
// createTraversal): a write between the step's popstate and its hashchange must not decide
// what the map is restored to (map-ux-review "Back closes the election ...", 11 Nov 2026).
//
//   node --test tests/unit/url-traversal.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTraversal } from '../../packages/map/src/app/url-sync.mjs';

const ELECTION = 'http://x/maps/#layers=election-a&electionBody=B&electionDate=2019-12-12';
const STALE = 'http://x/maps/#lng=-8.05&lat=53.5&zoom=5.9&cat=elections';

test('a step whose entry was rewritten before the restore gets its own address back', () => {
  const t = createTraversal();
  t.arrived(ELECTION);
  assert.equal(t.take(STALE), ELECTION);
  // Consumed: a later restore with no new step leaves the address alone.
  assert.equal(t.take(STALE), null);
});

test('an entry left as the step found it, or no step at all, is not touched', () => {
  const t = createTraversal();
  assert.equal(t.take(STALE), null);
  t.arrived(ELECTION);
  assert.equal(t.take(ELECTION), null);
});

test('two quick steps: the later one is the address restored', () => {
  const t = createTraversal();
  t.arrived(STALE);
  t.arrived(ELECTION);
  assert.equal(t.take(ELECTION), null);
  t.arrived(ELECTION);
  assert.equal(t.take(STALE), ELECTION);
});
