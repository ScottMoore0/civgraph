// Which boundary changes the timeline's changes panel lists (packages/map/src/app/timeline/since.mjs;
// Phelim Birch, 27 Nov 2026): the selected edition since the one directly before it, whichever way
// the slider moved, and the "Changes since" menu of earlier editions.
//
//   node --test timeline-since.test.mjs (run from the unit-test folder)
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  limitTimelineSinceSteps, movedHectares, precedingEditionIndex, resolveTimelineSinceIndex, timelineChangeKind,
  timelineSinceOptions, timelineSinceSteps, timelineSinceSummary,
} from '@civgraph/map/src/app/timeline/since.mjs';

const COUNTIES = ['counties-ireland-1915', 'counties-ireland-1922', 'counties-ireland-1927', 'counties-ireland-1955', 'counties-ireland-1957', 'counties-ireland']
  .map((mapId) => ({ mapId }));
const year = (/** @type {{ mapId?: string | null }} */ item) => (item.mapId?.match(/\d{4}$/) || ['now'])[0];

test('the pair shown ends at the selected edition, from the one directly before it', () => {
  // Selecting 1955 shows 1927 -> 1955 whether the slider came from 1957 or from 1927.
  assert.equal(precedingEditionIndex(COUNTIES, 3), 2);
  assert.deepEqual(timelineSinceSteps(COUNTIES, resolveTimelineSinceIndex(COUNTIES, 3), 3).map((s) => s.id), ['counties-ireland-1927__counties-ireland-1955']);
  assert.deepEqual(timelineSinceSteps(COUNTIES, resolveTimelineSinceIndex(COUNTIES, 5), 5).map((s) => s.id), ['counties-ireland-1957__counties-ireland']);
});

test('the first edition has nothing earlier to compare', () => {
  assert.equal(precedingEditionIndex(COUNTIES, 0), -1);
  assert.equal(resolveTimelineSinceIndex(COUNTIES, 0, 'counties-ireland-1957'), -1);
  assert.deepEqual(timelineSinceOptions(COUNTIES, 0, year), []);
  assert.deepEqual(timelineSinceSteps(COUNTIES, -1, 0), []);
  assert.equal(timelineChangeKind([]), 'first');
});

test('a stop without a map, or repeating the map before it, is passed over', () => {
  const items = [{ mapId: 'a' }, { mapId: 'a' }, { mapId: null }, { mapId: 'b' }, { mapId: 'c' }];
  assert.equal(precedingEditionIndex(items, 3), 1);
  assert.deepEqual(timelineSinceSteps(items, 0, 4).map((s) => [s.id, s.fromIndex, s.toIndex]), [['a__b', 0, 3], ['b__c', 3, 4]]);
  assert.equal(precedingEditionIndex([{ mapId: 'a' }, { mapId: 'a' }], 1), -1);
  assert.equal(precedingEditionIndex(items, 2), -1, 'a stop with no map has no comparison');
});

test('the "Changes since" menu lists the earlier editions newest first, the preceding one marked', () => {
  const options = timelineSinceOptions(COUNTIES, 4, year);
  assert.deepEqual(options.map((o) => [o.mapId, o.label, o.preceding]), [
    ['counties-ireland-1955', '1955', true],
    ['counties-ireland-1927', '1927', false],
    ['counties-ireland-1922', '1922', false],
    ['counties-ireland-1915', '1915', false],
  ]);
  assert.equal(options[0]?.index, 3);
  // A map at several stops is offered once.
  assert.deepEqual(timelineSinceOptions([{ mapId: 'a' }, { mapId: 'b' }, { mapId: 'b' }, { mapId: 'c' }], 3, (i) => String(i.mapId)).map((o) => o.mapId), ['b', 'a']);
});

test('choosing an earlier edition lists the consecutive steps in between, oldest first', () => {
  const from = resolveTimelineSinceIndex(COUNTIES, 5, 'counties-ireland-1927');
  assert.equal(from, 2);
  assert.deepEqual(timelineSinceSteps(COUNTIES, from, 5).map((s) => s.id), [
    'counties-ireland-1927__counties-ireland-1955',
    'counties-ireland-1955__counties-ireland-1957',
    'counties-ireland-1957__counties-ireland',
  ]);
  // Not an earlier edition of the series (a later one, or another series'): the preceding edition.
  assert.equal(resolveTimelineSinceIndex(COUNTIES, 3, 'counties-ireland'), 2);
  assert.equal(resolveTimelineSinceIndex(COUNTIES, 3, 'provinces'), 2);
  assert.equal(resolveTimelineSinceIndex(COUNTIES, 3, null), 2);
  assert.deepEqual(timelineSinceSteps(COUNTIES, 3, 3), []);
  assert.deepEqual(timelineSinceSteps(COUNTIES, 4, 3), []);
});

test('a long list keeps the newest steps up to the file limit and counts the earlier ones', () => {
  const steps = ['n', 'f', 'f', 'n', 'f', 'n'].map((kind, i) => ({ i, kind }));
  const needsFile = (/** @type {{ kind: string }} */ s) => s.kind === 'f';
  assert.deepEqual(limitTimelineSinceSteps(steps, 2, needsFile), { listed: steps.slice(2), skipped: 2 });
  assert.deepEqual(limitTimelineSinceSteps(steps, 3, needsFile), { listed: steps, skipped: 0 });
  assert.deepEqual(limitTimelineSinceSteps(steps, 0, needsFile), { listed: steps.slice(5), skipped: 5 });
  assert.deepEqual(limitTimelineSinceSteps([], 2, needsFile), { listed: [], skipped: 0 });
});

test('the kind of a comparison: changes before redrawn, none only when every step says so', () => {
  assert.equal(timelineChangeKind(['none', 'changes', 'unavailable']), 'changes');
  assert.equal(timelineChangeKind(['none', 'redrawn']), 'redrawn');
  assert.equal(timelineChangeKind(['none', 'none']), 'none');
  // A step not compared (no geometry held, or no index entry) is said so, not hidden.
  assert.equal(timelineChangeKind(['unavailable']), 'unavailable');
  assert.equal(timelineChangeKind(['none', 'unknown']), 'unavailable');
});

test('the summary over several steps counts steps, changes and the hectares that changed hands', () => {
  const changes = [{ type: 'transfer', ha: 289.4 }, { type: 'renamed', ha: 171912.7 }, { type: 'merged', ha: 1000 }];
  assert.equal(movedHectares(changes), 1289.4);
  assert.equal(timelineSinceSummary({ sinceLabel: '01 Apr 1985', steps: 3, count: 12, hectares: 1289.4 }), 'Changes since 01 Apr 1985: 3 steps, 12 changes, 1,289 ha in all.');
  assert.equal(timelineSinceSummary({ sinceLabel: '1985', steps: 2, count: 1, hectares: 0 }), 'Changes since 1985: 2 steps, 1 change.');
  assert.equal(timelineSinceSummary({ sinceLabel: '1985', steps: 2, count: 0, hectares: 0 }), 'Changes since 1985: 2 steps, no boundary changes.');
});
