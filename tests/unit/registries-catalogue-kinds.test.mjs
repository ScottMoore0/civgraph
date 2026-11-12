/**
 * The catalogue-kinds registry (data/registries/catalogue-kinds.json) against the literals it
 * replaced: the catalogue's SECTIONS (packages/map/src/catalogue/index.js), its filter KINDS
 * (util.js) and the catalogue check's kinds (scripts/check/rules/catalogue.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadRegistry, registryErrors } from '../../packages/registries/src/index.mjs';
import { catalogueKindIds } from '../../packages/registries/src/catalogue-kinds.mjs';
import { KINDS } from '../../packages/map/src/catalogue/util.js';
import { SECTIONS } from '../../packages/map/src/catalogue/index.js';

const registry = loadRegistry('catalogue-kinds');

test('catalogue kinds: the sections, filters and check read the literals they replaced', () => {
  assert.deepEqual(SECTIONS, [['boundaries', 'Boundary', 'Boundaries', 'land-divisions'], ['places', 'Places', 'Places & routes', 'route'], ['statistics', 'Statistics', 'Statistics', 'chart-column'], ['historic', 'Historic', 'Historic Maps', 'landmark']]);
  assert.deepEqual(KINDS, [['Boundary', 'Boundaries'], ['Places', 'Places & routes'], ['Statistics', 'Statistics']]);
  const ids = catalogueKindIds(registry);
  assert.deepEqual(ids, ['Boundary', 'Places', 'Statistics', 'Historic']);
  // The check's message, as it was written: "use Boundary, Places, Statistics or Historic".
  assert.equal(`${ids.slice(0, -1).join(', ')} or ${ids.at(-1)}`, 'Boundary, Places, Statistics or Historic');
  const check = readFileSync(path.join(REPO_ROOT, 'scripts/check/rules/catalogue.mjs'), 'utf8');
  assert.ok(check.includes("const KIND_IDS = catalogueKindIds(loadRegistry('catalogue-kinds'));"));
});

test('catalogue kinds: every series and subject kind the catalogue holds is registered', () => {
  const source = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data/catalogue/catalogue.source.json'), 'utf8'));
  const ids = new Set(catalogueKindIds(registry));
  for (const s of source.series) if (s.kind) assert.ok(ids.has(s.kind), s.id);
  for (const s of source.subjects) if (s.seriesKind) assert.ok(ids.has(s.seriesKind), s.id);
});

test('catalogue kinds: the registry refuses a kind or section given twice', () => {
  const twice = structuredClone(registry);
  twice.kinds.push({ ...twice.kinds[0] });
  const errors = registryErrors('catalogue-kinds', twice);
  assert.ok(errors.some((e) => e.includes('id Boundary is given twice')));
  assert.ok(errors.some((e) => e.includes('section boundaries is given twice')));
});
