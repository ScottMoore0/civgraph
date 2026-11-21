import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentMapStatuses } from '@civgraph/core/agent-map-status.mjs';

const F = (name) => ({ fgb: `https://data.civgraph.net/data/maps/x/${name}.fgb` });

test('a shown map is ready, an incomplete one partial, a placeholder to be added with no geometry', () => {
  const s = agentMapStatuses([
    { id: 'a', files: F('a') },
    { id: 'b', incomplete: true, files: F('b') },
    { id: 'c', placeholder: true, files: F('c') },
  ]);
  assert.deepEqual(s.get('a'), { status: 'ready', geometryFrom: 'a' });
  assert.deepEqual(s.get('b'), { status: 'partial', geometryFrom: 'b' });
  assert.deepEqual(s.get('c'), { status: 'to-be-added', geometryFrom: null });
});

test('a hidden map that is no copy and no part is to be added, with no geometry', () => {
  const s = agentMapStatuses([{ id: 'h', hidden: true, files: F('h') }]);
  assert.deepEqual(s.get('h'), { status: 'to-be-added', geometryFrom: null });
});

test('a hidden copy points at the map it duplicates and takes its status and geometry', () => {
  const s = agentMapStatuses([
    { id: 'kept', incomplete: true, files: F('kept') },
    { id: 'named', hidden: true, files: F('named') },
    { id: 'samefile', hidden: true, files: { fgb: `${F('kept').fgb}?v=123` } },
    { id: 'shown-dup', files: F('shown-dup') },
  ], { named: 'kept', 'shown-dup': 'kept' });
  assert.deepEqual(s.get('named'), { status: 'partial', geometryFrom: 'kept', sameAs: 'kept' });
  assert.deepEqual(s.get('samefile'), { status: 'partial', geometryFrom: 'kept', sameAs: 'kept' });
  assert.deepEqual(s.get('shown-dup'), { status: 'partial', geometryFrom: 'kept', sameAs: 'kept' });
});

test('a copy of a map to be added is to be added, with no geometry', () => {
  const s = agentMapStatuses([
    { id: 'todo', placeholder: true, files: F('todo') },
    { id: 'dup', hidden: true, files: F('dup') },
  ], { dup: 'todo' });
  assert.deepEqual(s.get('dup'), { status: 'to-be-added', geometryFrom: null, sameAs: 'todo' });
});

test('a shown map is preferred over a placeholder naming the same file', () => {
  const s = agentMapStatuses([
    { id: 'todo', placeholder: true, files: F('same') },
    { id: 'drawn', files: F('same') },
    { id: 'hid', hidden: true, files: F('same') },
  ]);
  assert.deepEqual(s.get('hid'), { status: 'ready', geometryFrom: 'drawn', sameAs: 'drawn' });
});

test('a hidden part of a shown map keeps its own geometry and points at the map', () => {
  const s = agentMapStatuses([
    { id: 'whole', files: F('whole'), variants: [{ id: 'part' }, 'part2'] },
    { id: 'part', hidden: true, files: F('part') },
    { id: 'part2', hidden: true, incomplete: true, files: F('part2') },
    { id: 'todo', placeholder: true, variants: ['part3'] },
    { id: 'part3', hidden: true, files: F('part3') },
  ]);
  assert.deepEqual(s.get('part'), { status: 'ready', geometryFrom: 'part', partOf: 'whole' });
  assert.deepEqual(s.get('part2'), { status: 'partial', geometryFrom: 'part2', partOf: 'whole' });
  assert.deepEqual(s.get('part3'), { status: 'to-be-added', geometryFrom: null });
});
