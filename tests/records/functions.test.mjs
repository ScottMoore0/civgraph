// The records Functions against the local build (tests/records/d1-shim.mjs), and the parity oracle:
// every compatibility URL answers what the old file held. Bundles, the manifest, provenance shards
// and summaries byte for byte; the Browse and graph documents deep-equal after dropping the
// wrapper's generatedAt. Sampled across every record type plus the edge cases of phase2-plan.md
// stage D.11. Skipped without a build; the file comparisons run only while the old trees exist
// (tmp/records/browse, tmp/records/graph, tmp/records/elections...).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { recordPaths, REPO_ROOT } from '../../packages/loader/src/paths.mjs';
import { buildHasVotes, context, d1, installCaches } from './d1-shim.mjs';
import { resetDatasetMemo } from '../../packages/api/src/handlers/_records.js';
import * as elections from '../../packages/api/src/handlers/elections/index.js';
import * as persons from '../../packages/api/src/handlers/persons/index.js';
import * as sources from '../../packages/api/src/handlers/sources/index.js';
import * as register from '../../packages/api/src/handlers/register-interests/index.js';
import * as parties from '../../packages/api/src/handlers/parties/index.js';
import * as votes from '../../packages/api/src/handlers/votes/index.js';
import * as graph from '../../packages/api/src/handlers/graph/index.js';
import * as stats from '../../packages/api/src/handlers/stats/index.js';
import * as renderMetadata from '../../functions/render/metadata/[[path]].js';
import * as dataBrowse from '../../functions/data/browse/[[path]].js';
import * as dataGraph from '../../functions/data/graph/[[path]].js';

const DB = path.join(REPO_ROOT, 'tmp/records/civgraph-records.sqlite');
const P = recordPaths({ CIVGRAPH_BUILD_DIR: 'tmp/records' });
const built = existsSync(DB);
const skip = !built && 'no records build (npm run records:build)';
let env;
const setup = () => {
  if (!env) {
    installCaches();
    resetDatasetMemo();
    env = { ELECTIONS_DB: d1(DB) };
  }
  return env;
};

async function get(mod, url, params = {}) {
  const res = await mod.onRequestGet(context(url, setup(), params));
  return { status: res.status, text: res.status === 200 ? await res.text() : '', headers: res.headers };
}
const getJson = async (mod, url, params) => {
  const r = await get(mod, url, params);
  assert.equal(r.status, 200, `${url} -> ${r.status}`);
  return JSON.parse(r.text);
};
const pathParams = (url, prefix) => ({ path: url.slice(prefix.length).split('/') });
const browseUrl = (rel) => getJson(dataBrowse, `/data/browse/${rel}`, pathParams(`/data/browse/${rel}`, '/data/browse/'));
const metaUrl = (rel) => get(renderMetadata, `/render/metadata/${rel}`, pathParams(`/render/metadata/${rel}`, '/render/metadata/'));

const readFile = (file) => readFileSync(file, 'utf8');
const readJsonFile = (file) => JSON.parse(readFile(file));
const dropGeneratedAt = (doc) => {
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    const { generatedAt: _g, ...rest } = doc;
    return rest;
  }
  return doc;
};
const sample = (list, n) => {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
};

// ------------------------------------------------------------------ /render/metadata (permanent URLs)

test('render/metadata: bundles byte-identical (the three largest, edge cases and a sample)', { skip }, async () => {
  const files = readdirSync(P.ELECTION_BUNDLE_DIR).filter((f) => f.endsWith('.json'));
  const largest = files.map((f) => [f, readFileSync(path.join(P.ELECTION_BUNDLE_DIR, f)).length]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => f);
  const edge = ['northern-ireland-assembly__2022-05-05.json', 'northern-ireland-forum-for-political-dialogue__1996-05-30.json', 'bangor-borough-council__1920-01-15.json',
    'ireland-referendum__1937-07-01-plebiscite-on-the-draft-constitution.json', 'ireland-local__2004-06-11.json', 'ireland-local__2014-05-23.json'];
  for (const file of [...new Set([...largest, ...edge.filter((f) => files.includes(f)), ...sample(files, 20)])]) {
    const r = await metaUrl(`elections-test2/${file}`);
    assert.equal(r.status, 200, file);
    assert.ok(r.text === readFile(path.join(P.ELECTION_BUNDLE_DIR, file)), `${file} differs from the file`);
  }
});

test('render/metadata: manifest, provenance shards and summaries byte-identical', { skip }, async () => {
  const manifest = await metaUrl('elections-test2.json');
  assert.equal(manifest.text, readFile(P.ELECTION_MANIFEST));
  for (const file of sample(readdirSync(P.PROVENANCE_SHARD_DIR).filter((f) => f.endsWith('.json')), 25)) {
    const r = await metaUrl(`election-provenance/${file}`);
    assert.equal(r.text, readFile(path.join(P.PROVENANCE_SHARD_DIR, file)), file);
  }
  for (const file of sample(readdirSync(P.ELECTION_SUMMARY_DIR).filter((f) => f.endsWith('.json')), 25)) {
    const r = await metaUrl(`elections-test2-summaries/${file}`);
    assert.equal(r.text, readFile(path.join(P.ELECTION_SUMMARY_DIR, file)), file);
  }
});

test('render/metadata: other files and unknown keys go to Pages (context.next)', { skip }, async () => {
  // The layer metadata (maps-test-index.json, layer-details-test2/...) is no longer static since
  // data phase 3: it answers 301 to /_api/layers, which tests/functions/maps.test.mjs holds.
  for (const rel of ['ni-local/1900.json', 'election-anchors-test2/x.json', 'elections-test2/no-such__1900-01-01.json']) {
    const r = await metaUrl(rel);
    assert.equal(r.headers.get('X-Static'), '1', rel);
  }
  for (const rel of ['maps-test-index.json', 'layer-details-test2/x.json']) {
    const r = await metaUrl(rel);
    assert.equal(r.status, 301, rel);
  }
});

// ------------------------------------------------------------------ /_api/elections

test('elections API: bundle mode equals the file; lite drops what it always dropped', { skip }, async () => {
  for (const key of ['northern-ireland-assembly__2022-05-05', 'northern-ireland-forum-for-political-dialogue__1996-05-30', 'ireland-local__2014-05-23']) {
    const file = readJsonFile(path.join(P.ELECTION_BUNDLE_DIR, `${key}.json`));
    assert.deepEqual(await getJson(elections, `/_api/elections?key=${key}&format=bundle`), file);
    const lite = await getJson(elections, `/_api/elections?key=${key}&format=bundle&lite=1`);
    assert.equal(lite.results.length, file.results.length);
    for (const [i, r] of lite.results.entries()) {
      assert.equal(r.countGroup, undefined);
      assert.equal(r.elected, undefined);
      assert.equal(r.animationPayload, undefined);
      assert.deepEqual(r.candidates, file.results[i].candidates);
      assert.equal(r.animationRowCount, (file.results[i].animationPayload?.Constituency?.countGroup || []).length);
    }
    assert.deepEqual(lite.mainLikeCandidateSummary, file.mainLikeCandidateSummary);
  }
});

test('elections API: index, constituency by seq, name and slug; views', { skip }, async () => {
  const index = await getJson(elections, '/_api/elections');
  assert.ok(index.count >= 1829);
  const order = index.elections.map((e) => [e.date, e.key]);
  const cmp = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  assert.deepEqual(order, [...order].sort(cmp));
  const bySeq = await getJson(elections, '/_api/elections?key=northern-ireland-assembly__2022-05-05&constituency=0');
  const byName = await getJson(elections, `/_api/elections?key=northern-ireland-assembly__2022-05-05&constituencyName=${encodeURIComponent(bySeq.constituency.name)}`);
  const bySlug = await getJson(elections, '/_api/elections?key=northern-ireland-assembly__2022-05-05&contest=belfast-east');
  assert.deepEqual(byName, bySeq);
  assert.equal(bySlug.constituency.name, 'Belfast East');
  const regional = await getJson(elections, '/_api/elections?key=northern-ireland-forum-for-political-dialogue__1996-05-30&contest=regional-list');
  assert.ok(regional.candidates.length > 0);
  const manifest = await getJson(elections, '/_api/elections?view=manifest');
  assert.deepEqual(manifest, readJsonFile(P.ELECTION_MANIFEST));
  const key = 'northern-ireland-assembly__2022-05-05';
  assert.deepEqual(await getJson(elections, `/_api/elections?key=${key}&view=provenance`), readJsonFile(path.join(P.PROVENANCE_SHARD_DIR, `${key}.json`)));
  const entry = manifest.elections.find((e) => e.key === key);
  assert.deepEqual(await getJson(elections, `/_api/elections?key=${key}&view=summary`), readJsonFile(path.join(P.ELECTION_SUMMARY_DIR, entry.summaryUrl.split('/').pop())));
  const slug = 'northern-ireland-assembly-2022-05-05';
  assert.deepEqual(await getJson(elections, `/_api/elections?key=${slug}&view=detail`), dropGeneratedAt(readJsonFile(path.join(P.BROWSE_DIR, 'details/elections', `${slug}.json`))));
  assert.deepEqual(await getJson(elections, `/_api/elections?key=${key}&view=contests`), dropGeneratedAt(readJsonFile(path.join(P.BROWSE_DIR, 'details/election-contests', `${slug}.json`))));
  const record = await getJson(elections, `/_api/elections?view=record&slug=${slug}-belfast-east`);
  assert.equal(record.item.slug, `${slug}-belfast-east`);
  assert.equal(record.parent, slug);
  const page = await getJson(elections, '/_api/elections?view=list&body=northern-ireland-assembly&limit=5');
  assert.equal(page.items.length, 5);
  assert.ok(page.total > 5);
});

// ------------------------------------------------------------------ /data/browse (the files Browse reads)

test('data/browse: documents and lists deep-equal the files', { skip: (skip || !existsSync(P.BROWSE_DIR)) && 'no build or no Browse tree' }, async () => {
  for (const rel of ['index.json', 'persons.json', 'sources.json', 'register-interests.json', 'persons-facets.json', 'parties.json', 'party-names.json', 'party-label-folds.json', 'offices.json']) {
    assert.deepEqual(await browseUrl(rel), dropGeneratedAt(readJsonFile(path.join(P.BROWSE_DIR, rel))), rel);
  }
  // Retired on 8 Nov 2026 (owner): no page reads them.
  for (const rel of ['elections-list.json', 'election-contest-parents.json', 'source-merges.json', 'election-contest-parents/0007.json', 'votes/persons/1.json', 'details/source-shards/sources-000.json']) {
    const res = await dataBrowse.onRequestGet(context(`/data/browse/${rel}`, setup(), pathParams(`/data/browse/${rel}`, '/data/browse/')));
    assert.equal(res.status, 410, rel);
  }
  const big = await browseUrl('elections.json');
  const file = dropGeneratedAt(readJsonFile(path.join(P.BROWSE_DIR, 'elections.json')));
  assert.equal(big.items.length, file.items.length);
  assert.deepEqual(big, file);
});

test('data/browse: index shards rebuild from rows (persons, sources, register)', { skip: (skip || !existsSync(P.BROWSE_DIR)) && 'no Browse tree' }, async () => {
  for (const dir of ['person-shards', 'source-index-shards', 'register-interest-shards']) {
    for (const file of sample(readdirSync(path.join(P.BROWSE_DIR, dir)), 3)) {
      assert.deepEqual(await browseUrl(`${dir}/${file}`), dropGeneratedAt(readJsonFile(path.join(P.BROWSE_DIR, dir, file))), `${dir}/${file}`);
    }
  }
});

test('data/browse: details, profiles and the votes index for a sample of each', { skip: (skip || !existsSync(P.BROWSE_DIR)) && 'no Browse tree' }, async () => {
  for (const kind of ['details/parties', 'details/elections', 'details/election-contests', 'details/offices', 'party-profiles']) {
    const names = readdirSync(path.join(P.BROWSE_DIR, kind));
    for (const file of [...sample(names, 20), ...(kind === 'details/parties' ? ['uup.json', 'administrator-alliance.json'] : [])].filter((f) => names.includes(f))) {
      assert.deepEqual(await browseUrl(`${kind}/${file}`), dropGeneratedAt(readJsonFile(path.join(P.BROWSE_DIR, kind, file))), `${kind}/${file}`);
    }
  }
  const votesDir = existsSync(path.join(P.BROWSE_DIR, 'votes')) ? path.join(P.BROWSE_DIR, 'votes') : path.join(REPO_ROOT, '..', 'boundaries-website', 'data', 'browse', 'votes');
  if (existsSync(votesDir)) {
    assert.deepEqual(await browseUrl('votes/index.json'), readJsonFile(path.join(votesDir, 'index.json')));
  }
});

// ------------------------------------------------------------------ record APIs

test('persons, sources, register: by slug, old ids, merged ids, views', { skip }, async () => {
  const paisley = await getJson(persons, '/_api/persons?slug=ian-paisley-48601');
  assert.equal(paisley.person.slug, 'ian-paisley-48601');
  assert.equal((await getJson(persons, '/_api/persons?slug=48601')).person.slug, 'ian-paisley-48601');
  const merged = await getJson(persons, '/_api/persons?slug=104292');
  assert.equal(String(merged.person.id), '103875', 'a merged id answers with the person it joined');
  const cand = await getJson(persons, '/_api/persons?slug=ian-paisley-48601&view=candidacies');
  // The card also lists contests from sources without candidacy rows; every row is the person's.
  assert.ok(cand.candidacies.length >= 20 && cand.candidacies.length <= paisley.person.elections.length);
  const keys = cand.candidacies.map((c) => [c.date, c.electionKey, c.contestSeq, c.ord]);
  const cmp = (a, b) => { for (let i = 0; i < 4; i += 1) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
  assert.deepEqual(keys, [...keys].sort(cmp));
  const facets = await getJson(persons, '/_api/persons?facets=1');
  assert.deepEqual(facets.facets, readJsonFile(path.join(P.BROWSE_DIR, 'persons-facets.json')).facets);
  const list = await getJson(persons, '/_api/persons?limit=3&sort=contests');
  assert.equal(list.persons.length, 3);

  const src = await getJson(sources, '/_api/sources?slug=election-source-house-of-commons-of-the-united-kingdom-1878-12-18&view=detail');
  assert.ok(src.item.references || src.item.sourceItems || src.item.title);
  const reg = await getJson(register, '/_api/register-interests?slug=ni-register-record-000eb0d4af017f1a&view=detail');
  assert.ok(Array.isArray(reg.item.interests));
  assert.equal((await get(persons, '/_api/persons?slug=nobody-at-all-0')).status, 404);
});

test('parties API: list, detail, retired slug, profile, names, folds', { skip }, async () => {
  const list = await getJson(parties, '/_api/parties');
  assert.deepEqual(list, dropGeneratedAt(readJsonFile(path.join(P.BROWSE_DIR, 'parties.json'))));
  const uup = await getJson(parties, '/_api/parties?slug=uup');
  assert.equal(uup.item.slug, 'uup');
  const retired = await getJson(parties, '/_api/parties?slug=administrator-alliance');
  assert.equal(retired.redirect, 'alliance');
  assert.ok(await getJson(parties, '/_api/parties?view=names'));
  assert.ok((await getJson(parties, '/_api/parties?view=folds')).folds);
  const profileFile = path.join(P.BROWSE_DIR, 'party-profiles', 'uup.json');
  if (existsSync(profileFile)) assert.deepEqual(await getJson(parties, '/_api/parties?slug=uup&view=profile'), readJsonFile(profileFile));
});

test('votes, graph and stats APIs', { skip }, async () => {
  // Votes only when the build holds them (CI and check:clean build without the dataset).
  if (buildHasVotes(DB)) {
    const index = await getJson(votes, '/_api/votes?view=index');
    assert.ok(index.bodies);
    const person = await getJson(votes, '/_api/votes?person=100002');
    assert.ok(Array.isArray(person.terms));
  }
  const g = await getJson(graph, '/_api/graph?browse=persons:ian-paisley-48601&browse=persons:48601');
  assert.ok(g.entityId);
  assert.ok(g.statements.length > 0);
  const shardDir = path.join(P.GRAPH_DIR, 'indexes', 'statements-by-subject-shards');
  if (existsSync(shardDir)) {
    for (const file of sample(readdirSync(shardDir), 4)) {
      const shard = readJsonFile(path.join(shardDir, file));
      for (const id of sample(Object.keys(shard.items), 3)) {
        const r = await getJson(graph, `/_api/graph?entity=${encodeURIComponent(id)}`);
        assert.deepEqual(r.statements, shard.items[id], id);
      }
    }
  }
  const related = await getJson(graph, '/_api/graph?entity=cg:party:uup&related=1');
  assert.ok(related.reverse.length > 0);
  const search = await getJson(graph, '/_api/graph?q=paisley');
  assert.ok(search.items.length > 0);
  // The old graph file URLs retired on 8 Nov 2026 (owner): 410, except the bulk dumps.
  const manifest = await dataGraph.onRequestGet(context('/data/graph/manifest.json', setup(), { path: ['manifest.json'] }));
  assert.equal(manifest.status, 410);
  const exp = await dataGraph.onRequestGet(context('/data/graph/exports/civgraph.jsonld', setup(), { path: ['exports', 'civgraph.jsonld'] }));
  // No R2 copy in the test setup: the export has moved to the bulk downloads.
  assert.equal(exp.status, 301);
  assert.equal(exp.headers.get('Location'), 'https://data.civgraph.net/downloads/civgraph.jsonld.gz');
  const expManifest = await dataGraph.onRequestGet(context('/data/graph/exports/manifest.json', setup(), { path: ['exports', 'manifest.json'] }));
  assert.equal(expManifest.headers.get('Location'), 'https://data.civgraph.net/downloads/manifest.json');
  // While the R2 copy is there (until the downloads are published), it is served as before.
  const withCopy = { ...setup(), MAPS_BUCKET: { get: async (key) => (key === 'data/graph/exports/civgraph.jsonld' ? { body: '{"@graph":[]}' } : null) } };
  const fromR2 = await dataGraph.onRequestGet(context('/data/graph/exports/civgraph.jsonld', withCopy, { path: ['exports', 'civgraph.jsonld'] }));
  assert.equal(fromR2.status, 200);
  assert.equal(await fromR2.text(), '{"@graph":[]}');
  const s = await getJson(stats, '/_api/stats');
  assert.ok(s.candidacies >= 67000 && s.people >= 31000);
});

test('caching: an ETag from the dataset version, and a 304 for it', { skip }, async () => {
  const first = await elections.onRequestGet(context('/_api/elections?body=dail-eireann', setup()));
  const etag = first.headers.get('ETag');
  assert.match(etag, /^"elections-8-[0-9a-f]{16}"$/);
  const ctx = context('/_api/elections?body=dail-eireann', setup());
  const req = new Request(ctx.request.url, { headers: { 'If-None-Match': etag } });
  const second = await elections.onRequestGet({ ...ctx, request: req });
  assert.equal(second.status, 304);
});
