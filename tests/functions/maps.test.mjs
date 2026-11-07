/**
 * Data design phase 3: the map catalogue, the layer metadata and the catalogue pane's documents
 * are loaded from the working tree (scripts/records/ingest-maps.mjs) and answered by the
 * Functions (functions/_api/_maps.js and its routes) in the shapes, and where promised the bytes,
 * of the files they replaced. The database is built in memory from the real source files, so a
 * change to any of them is tested as it lands.
 *
 *   node --test tests/functions/maps.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase, TableWriter, transaction } from '../../scripts/records/db.mjs';
import { ingestMaps, layerAliasRows, layerKind, MAP_SOURCES, splitParts } from '../../scripts/records/ingest-maps.mjs';
import { REPO_ROOT } from '../../scripts/records/paths.mjs';
import { d1, installCaches } from '../records/d1-shim.mjs';
import { API_URLS, FILE_URLS, duplicateSidecar, indexEntry } from '../../functions/_lib/layer-index.js';
import * as catalogueApi from '../../functions/_api/catalogue/index.js';
import * as layersApi from '../../functions/_api/layers/[[path]].js';
import * as databaseRoute from '../../functions/data/database/[name].js';
import * as catalogueRoute from '../../functions/data/catalogue/[name].js';
import * as agentRoute from '../../functions/agent/[name].js';
import * as browseRoute from '../../functions/data/browse/[[path]].js';
import * as metadataRoute from '../../functions/render/metadata/[[path]].js';
import { resetDatasetMemo } from '../../functions/_api/_records.js';

const file = (rel) => readFileSync(path.join(REPO_ROOT, ...rel.split('/')), 'utf8');
const MAPS = JSON.parse(file(MAP_SOURCES.maps));
const LAYERS = JSON.parse(file(MAP_SOURCES.layers));

// A small Browse build (the real one is records:build output, not in a checkout).
const BROWSE = mkdtempSync(path.join(os.tmpdir(), 'civgraph-maps-browse-'));
mkdirSync(path.join(BROWSE, 'details', 'maps'), { recursive: true });
const CARDS = [
  { id: 'wards-1984', slug: 'wards-1984', type: 'map', title: '1984 council wards' },
  { id: 'lgd-2012', slug: 'lgd-2012', type: 'map', title: '2012 local government districts' },
];
writeFileSync(path.join(BROWSE, 'maps.json'), JSON.stringify({ schemaVersion: 1, generatedAt: 'x', total: 2, items: CARDS }, null, 2));
for (const c of CARDS) writeFileSync(path.join(BROWSE, 'details', 'maps', `${c.slug}.json`), JSON.stringify({ schemaVersion: 1, generatedAt: 'x', item: { ...c, description: `About ${c.title}` } }));
writeFileSync(path.join(BROWSE, 'features.json'), JSON.stringify({ schemaVersion: 1, generatedAt: 'x', totalFeatureGroups: 2, items: [{ id: 'a' }, { id: 'a' }] }));

const sqlite = createDatabase(':memory:');
const { counts, docs } = ingestMaps(sqlite, { browseDir: BROWSE });
transaction(sqlite, () => {
  const w = new TableWriter(sqlite, 'documents');
  for (const d of docs) w.add(d);
  sqlite.prepare("INSERT INTO dataset (key, value) VALUES ('version', 'test-1')").run();
});
installCaches();
const env = { ELECTIONS_DB: d1(sqlite) };

async function get(mod, url, params = {}) {
  resetDatasetMemo();
  const res = await mod.onRequestGet({
    request: new Request(new URL(url, 'https://civgraph.net')),
    env, params, waitUntil: () => {}, next: async () => new Response('static', { status: 200, headers: { 'X-Static': '1' } }),
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}
const json = (r) => JSON.parse(r.text);

test('the ingest holds every map, layer and document of the sources, in source order', () => {
  assert.equal(counts.maps, MAPS.maps.length);
  assert.equal(counts.layers, LAYERS.layers.length);
  assert.deepEqual(sqlite.prepare('SELECT map_id FROM maps ORDER BY ord').all().map((r) => r.map_id), MAPS.maps.map((m) => m.id));
  assert.deepEqual(sqlite.prepare('SELECT layer_id FROM layers ORDER BY ord').all().map((r) => r.layer_id), LAYERS.layers.map((l) => l.id));
  assert.equal(counts.map_cards, 2);
  assert.equal(counts.feature_groups, 2, 'a repeated feature-group id is kept, as in the file');
  for (const name of Object.keys(MAP_SOURCES.documents)) {
    assert.ok(sqlite.prepare('SELECT COUNT(*) AS n FROM document_parts WHERE name = ?').get(name).n >= 1, name);
  }
});

test('layer aliases: both suffix spellings and renamed prefixes, never shadowing a live id', () => {
  const live = new Set(LAYERS.layers.map((l) => l.id));
  const rows = sqlite.prepare('SELECT alias, layer_id FROM layer_aliases').all();
  for (const r of rows) {
    assert.ok(!live.has(r.alias), `${r.alias} shadows a live id`);
    assert.ok(live.has(r.layer_id), `${r.alias} -> ${r.layer_id} is not live`);
  }
  assert.deepEqual(layerAliasRows(['a-vector-test', 'b-vector', 'c-alias-test', 'd-raster-test']).map((r) => `${r.alias}>${r.layer_id}`),
    ['a-vector>a-vector-test', 'b-vector-test>b-vector', 'c-alias>c-alias-test', 'd-raster>d-raster-test']);
  assert.deepEqual(layerAliasRows(['x-vector', 'x-vector-test']), [], 'two live spellings: no alias for either');
  assert.ok(layerAliasRows(['local-authorities-1920-vector-test']).some((r) => r.alias === 'roi-local-authorities-1920-vector' && r.layer_id === 'local-authorities-1920-vector-test'));
  assert.equal(layerKind('a-vector-test'), 'vector');
  assert.equal(layerKind('a-alias'), 'alias');
  assert.equal(layerKind('lidar-cloud'), 'other');
});

test('splitParts never cuts a surrogate pair and concatenates back', () => {
  const text = `${'a'.repeat(9)}\u{1F600}${'b'.repeat(5)}`;
  const parts = splitParts(text, 10);
  assert.equal(parts.join(''), text);
  for (const p of parts) assert.ok(!/[\uD800-\uDBFF]$/.test(p));
  assert.deepEqual(splitParts(''), ['']);
});

test('/data/database/maps.json, /agent/maps-index.json and /data/catalogue/*.json are the files byte for byte', async () => {
  assert.equal((await get(databaseRoute, '/data/database/maps.json')).text, file('data/database/maps.json'));
  assert.equal((await get(agentRoute, '/agent/maps-index.json')).text, file('agent/maps-index.json'));
  for (const name of ['catalogue', 'places', 'people']) {
    const r = await get(catalogueRoute, `/data/catalogue/${name}.json`);
    assert.equal(r.status, 200);
    assert.equal(r.text, file(`data/catalogue/${name}.json`), name);
  }
  const r = await get(databaseRoute, '/data/database/maps.json');
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate');
  assert.equal(r.headers.get('ETag'), '"compat-documents-1-test-1"');
});

test('/_api/catalogue keeps its contract and adds the pane views', async () => {
  assert.deepEqual(json(await get(catalogueApi, '/_api/catalogue')), MAPS);
  const visible = json(await get(catalogueApi, '/_api/catalogue?visible=1'));
  assert.deepEqual(visible.maps.map((m) => m.id), MAPS.maps.filter((m) => !m.hidden).map((m) => m.id));
  const first = MAPS.maps[0];
  assert.deepEqual(json(await get(catalogueApi, `/_api/catalogue?id=${first.id}`)), first);
  assert.deepEqual(json(await get(catalogueApi, `/_api/catalogue?slug=${first.slug}`)), first);
  assert.equal((await get(catalogueApi, '/_api/catalogue?id=no-such-map')).status, 404);
  const cat = first.category;
  assert.deepEqual(json(await get(catalogueApi, `/_api/catalogue?category=${encodeURIComponent(cat)}`)).maps.map((m) => m.id),
    MAPS.maps.filter((m) => m.category === cat).map((m) => m.id));
  assert.equal((await get(catalogueApi, '/_api/catalogue?view=pane')).text, file('data/catalogue/catalogue.json'));
  assert.equal((await get(catalogueApi, '/_api/catalogue?view=nope')).status, 400);
});

test('/_api/layers: the full metadata, the startup index, a record and its sidecar', async () => {
  assert.deepEqual(json(await get(layersApi, '/_api/layers', { path: [] })), LAYERS);
  const index = json(await get(layersApi, '/_api/layers?view=index', { path: [] }));
  const { layers: _l, ...head } = LAYERS;
  for (const [k, v] of Object.entries(head)) assert.deepEqual(index[k], v, k);
  assert.deepEqual(Object.keys(index), [...Object.keys(LAYERS), 'generatedFrom', 'detailIndex', 'detailLayerCount']);
  assert.equal(index.detailLayerCount, LAYERS.layers.length);
  const sample = LAYERS.layers.filter((_, i) => i % 97 === 0);
  for (const layer of sample) {
    const row = sqlite.prepare('SELECT duplicates FROM layers WHERE layer_id = ?').get(layer.id);
    const expected = indexEntry(layer, row.duplicates ? JSON.parse(row.duplicates) : null, API_URLS);
    assert.deepEqual(index.layers.find((e) => e.id === layer.id), JSON.parse(JSON.stringify(expected)), layer.id);
    assert.deepEqual(json(await get(layersApi, API_URLS.detail(layer.id), { path: [layer.id] })), layer);
  }
  const withDupes = LAYERS.layers.find((l) => sqlite.prepare('SELECT duplicates FROM layers WHERE layer_id = ?').get(l.id).duplicates);
  if (withDupes) {
    const r = await get(layersApi, API_URLS.duplicates(withDupes.id), { path: [withDupes.id, 'duplicates'] });
    const featureIndex = JSON.parse(file(withDupes.featureIndexUrl.replace(/^\//, '')));
    assert.deepEqual(json(r), duplicateSidecar(withDupes, featureIndex));
  }
  assert.equal((await get(layersApi, '/_api/layers/no-such-layer', { path: ['no-such-layer'] })).status, 404);
  assert.equal((await get(layersApi, '/_api/layers?view=nope', { path: [] })).status, 400);
});

test('another spelling of a layer id answers 301 to the live id', async () => {
  // Either spelling may be the live one (before and after scripts/maps/rename-layer-ids.mjs --write).
  const live = LAYERS.layers.find((l) => /-vector(-test)?$/.test(l.id)).id;
  const other = live.endsWith('-vector-test') ? live.replace(/-vector-test$/, '-vector') : `${live}-test`;
  const r = await get(layersApi, `/_api/layers/${other}`, { path: [other] });
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), `/_api/layers/${live}`);
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=86400');
  const d = await get(layersApi, `/_api/layers/${other}/duplicates`, { path: [other, 'duplicates'] });
  assert.equal(d.headers.get('Location'), `/_api/layers/${live}/duplicates`);
});

test('the old layer-metadata file URLs answer 301 to /_api/layers (renames.csv)', async () => {
  const cases = [
    [['maps-test.json'], '/_api/layers'],
    [['maps-test-index.json'], '/_api/layers?view=index'],
    [['layer-details-test2', 'lgd-2012-vector-test.json'], '/_api/layers/lgd-2012-vector-test'],
    [['duplicate-feature-ids', 'lgd-2012-vector-test.json'], '/_api/layers/lgd-2012-vector-test/duplicates'],
  ];
  for (const [parts, location] of cases) {
    const r = await get(metadataRoute, `/render/metadata/${parts.join('/')}`, { path: parts });
    assert.equal(r.status, 301, parts.join('/'));
    assert.equal(r.headers.get('Location'), location);
  }
  // The old index's detail URLs and the file-URL builder agree on the names the 301 reads.
  assert.equal(FILE_URLS.detail('lgd-2012-vector-test'), '/render/metadata/layer-details-test2/lgd-2012-vector-test.json');
  for (const p of ['/render/metadata/maps-test.json', '/render/metadata/maps-test-index.json', '/render/metadata/layer-details-test2/*', '/render/metadata/duplicate-feature-ids/*']) {
    assert.ok(metadataRoute.ROUTE_PATTERNS.includes(p), p);
  }
});

test('Browse: the map list, map pages and feature groups from the tables; proni-roots 301', async () => {
  const list = json(await get(browseRoute, '/data/browse/maps.json', { path: ['maps.json'] }));
  assert.deepEqual(list, { schemaVersion: 1, total: 2, items: CARDS });
  const detail = json(await get(browseRoute, '/data/browse/details/maps/lgd-2012.json', { path: ['details', 'maps', 'lgd-2012.json'] }));
  assert.equal(detail.item.description, 'About 2012 local government districts');
  assert.equal((await get(browseRoute, '/data/browse/details/maps/nope.json', { path: ['details', 'maps', 'nope.json'] })).status, 404);
  const features = json(await get(browseRoute, '/data/browse/features.json', { path: ['features.json'] }));
  assert.deepEqual(features, { schemaVersion: 1, totalFeatureGroups: 2, items: [{ id: 'a' }, { id: 'a' }] });
  const roots = await get(browseRoute, '/data/browse/proni-roots.json', { path: ['proni-roots.json'] });
  assert.equal(roots.status, 301);
  assert.equal(roots.headers.get('Location'), '/_api/proni/node');
});
