import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENT_MAP_STATUSES, agentMapStatuses } from '@civgraph/core/agent-map-status.mjs';

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

test('a hidden map listed by a shown map\'s variant cloneOf, or serving a variant\'s file, is a part of that map', () => {
  const s = agentMapStatuses([
    { id: 'whole', files: F('whole'), variants: [{ id: 'whole-north', cloneOf: 'north', files: F('north') }, { id: 'whole-south', files: { fgb: 'https://data.civgraph.net/data/maps/x/South Part.fgb' } }] },
    { id: 'north', hidden: true, files: F('north') },
    { id: 'south', hidden: true, files: { fgb: 'https://data.civgraph.net/data/maps/x/South%20Part.fgb?v=1' } },
    { id: 'todo', placeholder: true, variants: [{ id: 'todo-west', cloneOf: 'west', files: F('west') }] },
    { id: 'west', hidden: true, files: F('west') },
  ]);
  assert.deepEqual(s.get('north'), { status: 'ready', geometryFrom: 'north', partOf: 'whole' });
  assert.deepEqual(s.get('south'), { status: 'ready', geometryFrom: 'south', partOf: 'whole' });
  assert.deepEqual(s.get('west'), { status: 'to-be-added', geometryFrom: null });
});

test('a hidden map marked retired is retired, with no geometry, naming its replacement when the record does', () => {
  const s = agentMapStatuses([
    { id: 'new', files: F('new') },
    { id: 'old', hidden: true, retired: true, replacedBy: 'new', files: F('old') },
    { id: 'gone', hidden: true, retired: true, files: F('gone') },
    { id: 'empty', hidden: true, placeholder: true, retired: true, replacedBy: 'new' },
    { id: 'dangling', hidden: true, retired: true, replacedBy: 'no-such-map', files: F('dangling') },
    { id: 'waiting', hidden: true, replacedBy: 'new', files: F('waiting') },
  ]);
  assert.deepEqual(s.get('old'), { status: 'retired', geometryFrom: null, replacedBy: 'new' });
  assert.deepEqual(s.get('gone'), { status: 'retired', geometryFrom: null });
  assert.deepEqual(s.get('empty'), { status: 'retired', geometryFrom: null, replacedBy: 'new' });
  assert.deepEqual(s.get('dangling'), { status: 'retired', geometryFrom: null });
  // Not marked retired: a hidden map waits to be added (an AI-drawn map awaiting review, say).
  assert.deepEqual(s.get('waiting'), { status: 'to-be-added', geometryFrom: null });
});

test('a copy or a part is never retired; a shown map marked retired keeps its own state', () => {
  const s = agentMapStatuses([
    { id: 'kept', files: F('kept'), variants: ['part'] },
    { id: 'copy', hidden: true, retired: true, files: F('kept') },
    { id: 'part', hidden: true, retired: true, files: F('part') },
    { id: 'shown', retired: true, files: F('shown') },
  ]);
  assert.deepEqual(s.get('copy'), { status: 'ready', geometryFrom: 'kept', sameAs: 'kept' });
  assert.deepEqual(s.get('part'), { status: 'ready', geometryFrom: 'part', partOf: 'kept' });
  assert.deepEqual(s.get('shown'), { status: 'ready', geometryFrom: 'shown' });
});

test('the four statuses, in order', () => {
  assert.deepEqual([...AGENT_MAP_STATUSES], ['ready', 'partial', 'to-be-added', 'retired']);
});

test('maps.json: every retired map is hidden, and its replacement is a map the site shows', () => {
  /** @type {{ maps: Array<{ id: string, hidden?: boolean, placeholder?: boolean, retired?: boolean, replacedBy?: string }> }} */
  const doc = JSON.parse(readFileSync('data/database/maps.json', 'utf8'));
  const byId = new Map(doc.maps.map((m) => [m.id, m]));
  for (const m of doc.maps) {
    if (m.replacedBy !== undefined) assert.equal(m.retired, true, `${m.id}: replacedBy without retired`);
    if (m.retired === undefined) continue;
    assert.equal(m.retired, true, `${m.id}: retired is true or absent`);
    assert.equal(m.hidden, true, `${m.id}: a retired map is hidden`);
    if (m.replacedBy === undefined) continue;
    const to = byId.get(m.replacedBy);
    assert.ok(to && !to.hidden && !to.placeholder, `${m.id}: replacedBy ${m.replacedBy} is a map the site shows`);
  }
});
