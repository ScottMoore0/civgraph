// /_api/spatial?mapIds=a,b,c (packages/api/src/handlers/spatial.js) and the map search's use of it
// (src/feature-loader.js loadMapIndexes): one request where the search made one per map, about 30
// per query (QA 2026-11-11, M9), with each map's answer identical to `?mapId=<id>`.
//
//   node --test tests/functions/spatial-batch.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_BATCH_MAPS, onRequestGet, parseMapIds } from '../../packages/api/src/handlers/spatial.js';
import { CONTRACTS, variantFor } from '../../packages/api/src/v1/contracts/v1.js';
import { ROUTES } from '../../packages/api/src/v1/v1.js';
import { validate } from '../../packages/api/src/v1/json-schema.js';

const INDEX = {
  'lgd-2012': [
    { id: 'lgd-2012:0', name: 'Belfast', mapId: 'lgd-2012', bbox: [-6.05, 54.53, -5.81, 54.67] },
    { id: 'lgd-2012:1', name: 'Derry City and Strabane', mapId: 'lgd-2012', bbox: [-7.9, 54.6, -6.9, 55.2] },
    { id: 'lgd-2012:2', name: 'No bbox', mapId: 'lgd-2012' }
  ],
  'pc-2023': [{ id: 'pc-2023:0', name: 'BELFAST WEST', mapId: 'pc-2023', bbox: [-6.1, 54.55, -5.95, 54.64] }]
};
const kv = { async get(key) { return INDEX[key.replace(/^map:/, '')] ? structuredClone(INDEX[key.replace(/^map:/, '')]) : null; } };

async function get(query, env = { SPATIAL_INDEX: kv }) {
  const res = await onRequestGet(/** @type {any} */ ({ request: new Request(`https://civgraph.net/_api/spatial?${query}`), env }));
  return { status: res.status, body: await res.json(), headers: res.headers };
}

test('a batch answers, per map, exactly what the single-map request answers', async () => {
  const batch = await get('mapIds=lgd-2012,pc-2023,missing-map');
  assert.equal(batch.status, 200);
  assert.deepEqual(Object.keys(batch.body.maps), ['lgd-2012', 'pc-2023', 'missing-map']);
  for (const id of ['lgd-2012', 'pc-2023', 'missing-map']) {
    assert.deepEqual(batch.body.maps[id], (await get(`mapId=${id}`)).body.features, id);
  }
  assert.equal(batch.headers.get('Cache-Control'), 'public, max-age=300');
});

test('a batch applies the bounding box to every map, as the single request does', async () => {
  const bbox = '-6.1,54.5,-5.8,54.7';
  const batch = await get(`mapIds=lgd-2012,pc-2023&bbox=${bbox}`);
  assert.deepEqual(batch.body.maps['lgd-2012'].map((f) => f.name), ['Belfast']);
  for (const id of ['lgd-2012', 'pc-2023']) {
    assert.deepEqual(batch.body.maps[id], (await get(`mapId=${id}&bbox=${bbox}`)).body.features);
  }
});

test('a batch without KV reads the static chunk files, and a missing one answers [] like the single request', async () => {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    const id = /spatial-index\/(.+)\.json$/.exec(String(url))?.[1];
    return INDEX[id] ? new Response(JSON.stringify(INDEX[id])) : new Response('missing', { status: 404 });
  };
  try {
    const batch = await get('mapIds=pc-2023,gone', {});
    assert.deepEqual(batch.body.maps, { 'pc-2023': INDEX['pc-2023'], gone: [] });
    assert.deepEqual((await get('mapId=gone', {})).body, { features: [] });
    assert.ok(asked.every((url) => url.startsWith('https://civgraph.net/data/database/spatial-index/')));
  } finally {
    globalThis.fetch = real;
  }
});

test('malformed or oversized batches are refused; mapId still wins when both are given', async () => {
  assert.equal((await get('mapIds=')).status, 400);
  assert.equal((await get('mapIds=../secrets')).status, 400);
  assert.equal((await get('mapIds=a%2Fb')).status, 400);
  const many = Array.from({ length: MAX_BATCH_MAPS + 1 }, (_, i) => `m${i}`).join(',');
  assert.equal((await get(`mapIds=${many}`)).status, 400);
  assert.equal((await get('')).status, 400, 'neither parameter: the old error');
  const both = await get('mapId=pc-2023&mapIds=lgd-2012');
  assert.deepEqual(both.body, { features: INDEX['pc-2023'] });
  assert.deepEqual(parseMapIds(' a, b ,a,, c '), ['a', 'b', 'c']);
});

test('the batch has a v1 contract, and its answer fits it', async () => {
  assert.ok(ROUTES.spatial.parameters.includes('mapIds'));
  const url = 'https://civgraph.net/api/v1/spatial?mapIds=lgd-2012,pc-2023';
  const variant = variantFor('spatial', url);
  assert.equal(variant?.name, 'batch');
  assert.equal(variantFor('spatial', 'https://civgraph.net/api/v1/spatial?mapId=lgd-2012')?.name, 'features');
  const { body } = await get('mapIds=lgd-2012,pc-2023');
  assert.deepEqual(validate(variant.schema, body), []);
  assert.ok(CONTRACTS.spatial.variants.some((v) => v.name === 'features'), 'the single-map variant stays');
});

test('the map search loads its candidate maps in one request and caches each as before', async () => {
  const { default: featureLoader } = await import('../../src/feature-loader.js');
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    const query = new URL(String(url), 'https://civgraph.net').searchParams;
    if (query.get('mapIds')) {
      const maps = {};
      for (const id of query.get('mapIds').split(',')) maps[id] = INDEX[id] || [];
      return new Response(JSON.stringify({ maps }));
    }
    return new Response(JSON.stringify({ features: INDEX[query.get('mapId')] || [] }));
  };
  try {
    featureLoader.spatialIndexByMap.clear();
    const result = await featureLoader.loadMapIndexes(['pc-2023', 'lgd-2012', 'pc-2023', 'nothing']);
    assert.equal(asked.length, 1, `one request, not ${asked.length}`);
    assert.equal(asked[0], '/_api/spatial?mapIds=lgd-2012,nothing,pc-2023');
    assert.deepEqual([...result.keys()], ['pc-2023', 'lgd-2012', 'nothing']);
    assert.deepEqual(result.get('lgd-2012'), INDEX['lgd-2012']);
    assert.deepEqual(result.get('nothing'), []);
    // The per-map reads that follow come from the cache: no more requests.
    assert.deepEqual(await featureLoader.loadMapIndex('pc-2023'), INDEX['pc-2023']);
    assert.equal(asked.length, 1);
    // One map left to load: the single-map request, as before.
    await featureLoader.loadMapIndexes(['pc-2023', 'other']);
    assert.equal(asked.at(-1), '/_api/spatial?mapId=other');
  } finally {
    globalThis.fetch = real;
    featureLoader.spatialIndexByMap.clear();
  }
});

test('when the batch is not answered, each map is loaded on its own exactly as before', async () => {
  const { default: featureLoader } = await import('../../src/feature-loader.js');
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    if (String(url).includes('mapIds=')) return new Response('not found', { status: 404 });
    const id = new URL(String(url), 'https://civgraph.net').searchParams.get('mapId');
    return new Response(JSON.stringify({ features: INDEX[id] || [] }));
  };
  try {
    featureLoader.spatialIndexByMap.clear();
    const result = await featureLoader.loadMapIndexes(['lgd-2012', 'pc-2023']);
    assert.deepEqual(result.get('lgd-2012'), INDEX['lgd-2012']);
    assert.deepEqual(result.get('pc-2023'), INDEX['pc-2023']);
    assert.deepEqual(asked.slice(1).sort(), ['/_api/spatial?mapId=lgd-2012', '/_api/spatial?mapId=pc-2023']);
  } finally {
    globalThis.fetch = real;
    featureLoader.spatialIndexByMap.clear();
  }
});
