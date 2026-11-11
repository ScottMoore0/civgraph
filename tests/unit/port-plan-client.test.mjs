// The map app's slice of the port plan (clientPortPlan, packages/map/src/renderer/metadata-service.js):
// built into the app bundle instead of fetching the 2.8 MB render/metadata/main-site-port-plan.json
// on every visit (QA 2026-11-11, M8). The app must see exactly what it saw with the whole file.
//
//   node --test tests/unit/port-plan-client.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { clientPortPlan, normalizeMetadata } from '../../packages/map/src/renderer/metadata-service.js';
import { clientPortPlanModule } from '../../scripts/build/build-test2-metadata-shards.mjs';
import CLIENT_PORT_PLAN from '../../packages/map/src/renderer/port-plan-client.generated.js';

const read = (file) => JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));
const PLAN = read('render/metadata/main-site-port-plan.json');
const INDEX = read('render/metadata/maps-test-index.json');

test('the app reads the same metadata from the slice as from the whole port plan', () => {
  const whole = normalizeMetadata(INDEX, PLAN);
  const slice = normalizeMetadata(INDEX, clientPortPlan(PLAN));
  assert.deepEqual(slice.categories, whole.categories);
  assert.equal(slice.layers.length, whole.layers.length);
  assert.deepEqual(slice, whole);
});

test('the slice is a small fraction of the file', () => {
  const size = JSON.stringify(clientPortPlan(PLAN)).length;
  assert.ok(size < JSON.stringify(PLAN).length / 20, `${size} bytes`);
});

test('the slice keeps unconverted rows whole and one row per category of the converted', () => {
  const plan = {
    schemaVersion: 1,
    totals: { total: 4 },
    rows: [
      { sourceMapId: 'a', category: 'Boundaries', group: 'Maps', conversionStatus: 'converted', name: 'A', bounds: [1, 2, 3, 4] },
      { sourceMapId: 'b', category: 'Boundaries', group: 'Other', conversionStatus: 'convertedAlias', name: 'B' },
      { sourceMapId: 'c', category: 'Places', group: 'Maps', conversionStatus: 'metadataOnly', name: 'C', references: [{ url: 'x' }] },
      { sourceMapId: 'd', categoryId: 'census', conversionStatus: 'convertedComposite', name: 'D' }
    ]
  };
  assert.deepEqual(clientPortPlan(plan), {
    schemaVersion: 1,
    totals: { total: 4 },
    rows: [
      { conversionStatus: 'converted', category: 'Boundaries', group: 'Maps' },
      plan.rows[2],
      { conversionStatus: 'convertedComposite', categoryId: 'census' }
    ]
  });
  const index = { layers: [{ id: 'a', name: 'A', category: 'Boundaries' }] };
  assert.deepEqual(normalizeMetadata(index, clientPortPlan(plan)), normalizeMetadata(index, plan));
});

test('the module built into the bundle is up to date with the port plan (npm run build:test2:metadata)', () => {
  const file = readFileSync(new URL('../../packages/map/src/renderer/port-plan-client.generated.js', import.meta.url), 'utf8');
  assert.equal(file, clientPortPlanModule(PLAN));
  assert.deepEqual(CLIENT_PORT_PLAN, clientPortPlan(PLAN));
});
