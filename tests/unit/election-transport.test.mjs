// Election transport (packages/map/src/election/transport.mjs): where the election pane's data comes from,
// moved out of packages/map/app/election-manager.js. Exercised with a stub fetch and a stub page.
//
//   node --test tests/unit/election-transport.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  constituencyDetailUrl,
  ELECTION_MANIFEST_URL,
  electionBundleUrl,
  fetchConstituencyDetail,
  fetchElectionManifest,
  fetchFeatureIndex,
  fetchResultsBundle,
  fetchTrendBundle,
  loadProvenanceShard,
  provenanceUrl,
  reportElectionsApiIssue,
  useElectionsApi
} from '../../packages/map/src/election/transport.mjs';

const ENTRY = { key: 'westminster__2019-12-12', body: 'House of Commons', date: '2019-12-12', resultUrl: '/render/metadata/elections-test2/westminster__2019-12-12.json' };

/** A page: its query string, its stored opt-out, and the beacons it sends. */
function page({ search = '', stored = null, beacon = true } = {}) {
  const beacons = [];
  const posts = [];
  return {
    beacons,
    posts,
    location: { search, pathname: '/maps/' },
    localStorage: { getItem: (name) => (name === 'civgraph.electionsApi' ? stored : null) },
    navigator: beacon ? { sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; } } : {},
    fetch: (url, init) => { posts.push({ url, init }); return Promise.resolve(); }
  };
}

/** A fetch that answers each URL from a table: a status and a JSON body, or an Error to throw. */
function stubFetch(table) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const answer = table[url];
    if (answer instanceof Error) throw answer;
    if (!answer) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: answer.status === 200, status: answer.status, json: async () => answer.body };
  };
  impl.calls = calls;
  return impl;
}

const apiUrl = `/_api/elections?key=${encodeURIComponent(ENTRY.key)}&format=bundle&lite=1`;

test('the API is on unless the address or the stored setting turns it off', () => {
  assert.equal(useElectionsApi(page()), true);
  assert.equal(useElectionsApi(page({ search: '?electionsApi=0' })), false);
  assert.equal(useElectionsApi(page({ search: '?electionsApi=false' })), false);
  assert.equal(useElectionsApi(page({ search: '?electionsApi=1', stored: '0' })), true);
  assert.equal(useElectionsApi(page({ search: '?electionsApi=true' })), true);
  assert.equal(useElectionsApi(page({ stored: '0' })), false);
  assert.equal(useElectionsApi(page({ stored: '1' })), true);
  // No page at all (or one that throws): the default.
  assert.equal(useElectionsApi({}), true);
  assert.equal(useElectionsApi({ location: { search: '' }, get localStorage() { throw new Error('blocked'); } }), true);
});

test('URLs', () => {
  assert.equal(ELECTION_MANIFEST_URL, '/render/metadata/elections-test2.json?v=test-023');
  assert.equal(electionBundleUrl(ENTRY, true), apiUrl);
  assert.equal(electionBundleUrl(ENTRY, false), `${ENTRY.resultUrl}?v=test-023`);
  assert.equal(provenanceUrl('a b'), '/_api/elections?key=a%20b&view=provenance');
  assert.equal(constituencyDetailUrl('k', 3), '/_api/elections?key=k&constituency=3');
});

test('the manifest is fetched revalidating, and a failure says so', async () => {
  const fetchImpl = stubFetch({ [ELECTION_MANIFEST_URL]: { status: 200, body: { elections: [] } } });
  assert.deepEqual(await fetchElectionManifest({ fetchImpl }), { elections: [] });
  assert.deepEqual(fetchImpl.calls[0].init, { cache: 'default' });
  await assert.rejects(fetchElectionManifest({ fetchImpl: stubFetch({}) }), /Failed to load the MapLibre election catalogue: 404/);
});

test('a results bundle comes with its provenance', async () => {
  const fetchImpl = stubFetch({
    [apiUrl]: { status: 200, body: { results: [{ constituency: 'Foyle' }] } },
    [provenanceUrl(ENTRY.key)]: { status: 200, body: { contests: { Foyle: { checked: true } } } }
  });
  const bundle = await fetchResultsBundle(ENTRY, { fetchImpl, env: page() });
  assert.deepEqual(bundle, { results: [{ constituency: 'Foyle' }], provenance: { Foyle: { checked: true } } });
  assert.deepEqual(fetchImpl.calls.map((call) => call.url), [apiUrl, provenanceUrl(ENTRY.key)]);
});

test('missing or broken provenance is null and never fails the bundle', async () => {
  const fetchImpl = stubFetch({ [apiUrl]: { status: 200, body: { results: [] } } });
  assert.equal((await fetchResultsBundle(ENTRY, { fetchImpl, env: page() })).provenance, null);
  assert.equal(await loadProvenanceShard('x', stubFetch({ [provenanceUrl('x')]: new Error('offline') })), null);
  assert.equal(await loadProvenanceShard('x', stubFetch({ [provenanceUrl('x')]: { status: 200, body: {} } })), null);
});

test('a failed API bundle is reported and thrown; the static path only throws', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const env = page();
  await assert.rejects(fetchResultsBundle(ENTRY, { fetchImpl: stubFetch({ [apiUrl]: { status: 503 } }), env }),
    /Failed to load election results for House of Commons 2019-12-12: 503/);
  assert.equal(env.beacons.length, 1);
  const sent = JSON.parse(await env.beacons[0].blob.text());
  assert.equal(env.beacons[0].url, '/_api/rum');
  assert.deepEqual(sent, { source: 'elections', metric: 'elections-api-error', value: 1, path: '/maps/', event: { reason: 'bundle fetch returned 503', layerId: ENTRY.key } });

  const staticPage = page({ search: '?electionsApi=0' });
  await assert.rejects(fetchResultsBundle(ENTRY, { fetchImpl: stubFetch({}), env: staticPage }), /: 404$/);
  assert.equal(staticPage.beacons.length, 0);
});

test('a trend bundle has no provenance and its own error', async () => {
  const fetchImpl = stubFetch({ [apiUrl]: { status: 200, body: { results: [] } } });
  assert.deepEqual(await fetchTrendBundle(ENTRY, { fetchImpl, env: page() }), { results: [] });
  assert.equal(fetchImpl.calls.length, 1);
  await assert.rejects(fetchTrendBundle(ENTRY, { fetchImpl: stubFetch({}), env: page() }), /Failed to load trend data for House of Commons 2019-12-12: 404/);
});

test('constituency detail: the record, or null with a report', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const url = constituencyDetailUrl('k', 2);
  const env = page();
  assert.deepEqual(await fetchConstituencyDetail('k', 2, { fetchImpl: stubFetch({ [url]: { status: 200, body: { animationPayload: {} } } }), env }), { animationPayload: {} });
  assert.equal(env.beacons.length, 0);

  assert.equal(await fetchConstituencyDetail('k', 2, { fetchImpl: stubFetch({ [url]: { status: 500 } }), env }), null);
  assert.equal(JSON.parse(await env.beacons[0].blob.text()).event.layerId, 'k#2');

  assert.equal(await fetchConstituencyDetail('k', 2, { fetchImpl: stubFetch({ [url]: new Error('reset') }), env }), null);
  const thrown = JSON.parse(await env.beacons[1].blob.text());
  assert.deepEqual(thrown.event, { reason: 'reset', layerId: 'k' });
});

test('a feature index puts its items under items, and a missing one is null', async () => {
  const url = '/render/metadata/feature-indexes/x.json';
  const read = (body) => fetchFeatureIndex(url, { fetchImpl: stubFetch({ [url]: { status: 200, body } }) });
  assert.deepEqual((await read({ items: [1] })).items, [1]);
  assert.deepEqual((await read({ features: [2], name: 'x' })), { features: [2], name: 'x', items: [2] });
  assert.deepEqual((await read([3])).items, [3]);
  assert.deepEqual((await read({})).items, []);
  assert.equal(await fetchFeatureIndex(url, { fetchImpl: stubFetch({}) }), null);
});

test('without sendBeacon the report is a keepalive POST, and telemetry never throws', () => {
  const env = page({ beacon: false });
  reportElectionsApiIssue('m', 'r'.repeat(300), 'key', env);
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].init.keepalive, true);
  assert.equal(JSON.parse(env.posts[0].init.body).event.reason.length, 240);
  assert.doesNotThrow(() => reportElectionsApiIssue('m', 'r', 'k', { navigator: { sendBeacon() { throw new Error('no'); } } }));
});
