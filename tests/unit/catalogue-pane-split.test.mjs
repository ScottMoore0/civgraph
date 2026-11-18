// The catalogue pane split (packages/core/src/catalogue-pane.mjs): /maps/ loads the core first and
// the contest index only when search needs it. The records load stores both halves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitCataloguePane } from '@civgraph/core/catalogue-pane.mjs';

test('the core is the whole without contestIndex, in the same key order and form', () => {
  const doc = { schemaVersion: 1, about: 'x', shelves: [{ id: 'a' }], maps: { m: { name: 'Dáil' } }, contestIndex: { belfast: ['k1', 'k2'] }, redirects: {}, mapLinks: {} };
  const { core, contests } = splitCataloguePane(`${JSON.stringify(doc)}\n`);
  assert.equal(core, `${JSON.stringify({ schemaVersion: 1, about: 'x', shelves: [{ id: 'a' }], maps: { m: { name: 'Dáil' } }, redirects: {}, mapLinks: {} })}\n`);
  assert.equal(contests, `${JSON.stringify({ schemaVersion: 1, contestIndex: { belfast: ['k1', 'k2'] } })}\n`);
});

test('a document without an index splits into itself and an empty index', () => {
  const { core, contests } = splitCataloguePane('{"schemaVersion":1,"maps":{}}\n');
  assert.equal(core, '{"schemaVersion":1,"maps":{}}\n');
  assert.deepEqual(JSON.parse(contests), { schemaVersion: 1, contestIndex: {} });
});

test('the built pane document: the core drops only contestIndex, and is a third smaller', () => {
  const text = readFileSync(new URL('../../data/catalogue/catalogue.json', import.meta.url), 'utf8');
  const { core, contests } = splitCataloguePane(text);
  const whole = JSON.parse(text);
  const { contestIndex, ...rest } = whole;
  assert.equal(core, `${JSON.stringify(rest)}\n`);
  assert.deepEqual(JSON.parse(contests).contestIndex, contestIndex);
  assert.ok(core.length < text.length * 0.75, `core ${core.length} of ${text.length}`);
});
