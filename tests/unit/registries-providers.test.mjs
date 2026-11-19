/**
 * The providers registry (data/registries/providers.json) and the catalogue's Provider filter
 * (packages/map/src/catalogue/row-model.mjs): every provider string the catalogue credits has an
 * entry, an entry's body is in the attribution registry (data/database/providers.json), distinct
 * bodies stay apart, and the filter's counts and test (Phelim Birch's notes, owner-approved 19 Nov 2026).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadRegistry, registryErrors } from '@civgraph/registries/index.mjs';
import { browserProviders } from '@civgraph/registries/providers.mjs';
import { passesProviders, providerCounts, providerIndex, rowProviderIds } from '@civgraph/map/catalogue/row-model.mjs';
import { PROVIDERS, shortProvider } from '@civgraph/map/catalogue/util.js';

const read = (/** @type {string} */ p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const registry = loadRegistry('providers');
const catalogue = read('data/catalogue/catalogue.json');

test('every provider the catalogue credits (rows and maps) has an entry, and every entry is credited', () => {
  const { idOf } = providerIndex(browserProviders(registry).providers);
  const credited = new Set();
  for (const s of catalogue.series) for (const p of s.provider || []) credited.add(p);
  for (const m of Object.values(catalogue.maps)) for (const p of /** @type {{ provider?: string[] }} */ (m).provider || []) credited.add(p);
  assert.deepEqual([...credited].filter((p) => !idOf.has(p)), [], 'add these to data/registries/providers.json');
  assert.deepEqual([...idOf.keys()].filter((n) => !credited.has(n)), [], 'entries the catalogue no longer credits');
});

test("an entry's body is in the attribution registry, and the same body is never two entries", () => {
  const bodies = new Set(read('data/database/providers.json').providers.map((/** @type {{ id: string }} */ p) => p.id));
  for (const p of registry.providers) if (p.body) assert.ok(bodies.has(p.body), `${p.id}: no body ${p.body}`);
  const seen = new Map();
  for (const p of registry.providers) if (p.body) { assert.ok(!seen.has(p.body), `${p.id} and ${seen.get(p.body)} are one body`); seen.set(p.body, p.id); }
});

test('distinct bodies stay apart; only spellings of one body are merged', () => {
  const { idOf } = PROVIDERS;
  assert.equal(idOf.get('LPS'), idOf.get('Land & Property Services'));
  assert.equal(idOf.get('DfI Roads'), idOf.get('Department for Infrastructure - Roads'));
  for (const [a, b] of [['OSNI', 'Land & Property Services (OSNI)'], ['Land & Property Services', 'Land & Property Services (OSNI)'], ['Database of British and Irish Hills', 'Hill Bagging'],
    ['Copernicus', 'Copernicus DEM'], ['GSNI', 'Tellus'], ['Department for Communities', 'Department for Communities - Historic Environment Division'], ['Ordnance Survey', 'OSNI']]) {
    assert.notEqual(idOf.get(a), idOf.get(b), `${a} / ${b}`);
  }
});

test('the registry refuses an id given twice and a string naming two entries', () => {
  const twice = { ...registry, providers: [...registry.providers, { ...registry.providers[0], name: 'Something else' }] };
  assert.ok(registryErrors('providers', twice).some((e) => /given twice/.test(e)));
  const clash = { ...registry, providers: [...registry.providers, { id: 'clash', name: 'OSNI', full: 'x', short: 'x' }] };
  assert.ok(registryErrors('providers', clash).some((e) => /names both/.test(e)));
});

test("short names: the rows' credit lines keep the ones they had", () => {
  assert.equal(shortProvider('Tailte Éireann'), 'TÉ');
  assert.equal(shortProvider('Paddy Matthews'), 'Matthews');
  assert.equal(shortProvider('Phelim Birch'), 'Birch');
  assert.equal(shortProvider('Local Government Boundary Commission for Northern Ireland'), 'LGBC NI');
  assert.equal(shortProvider('Not a provider'), 'Not a provider');
});

test('the filter: a row passes when it credits any chosen provider; counts are rows per provider', () => {
  const { idOf } = PROVIDERS;
  const rec = (/** @type {string} */ id) => catalogue.maps[id];
  const counties = catalogue.series.find((/** @type {{ id: string }} */ s) => s.id === 'counties-counties');
  const ids = rowProviderIds(counties, rec, idOf);
  assert.ok(ids.has('osni') && ids.has('tailte'));
  assert.equal(passesProviders(ids, []), true);
  assert.equal(passesProviders(ids, ['cso', 'osni']), true);
  assert.equal(passesProviders(ids, ['cso']), false);
  assert.deepEqual([...providerCounts([new Set(['a', 'b']), new Set(['a'])])], [['a', 2], ['b', 1]]);
});
