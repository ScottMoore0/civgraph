// The bulk downloads keep every snapshot version (owner decision PG15, 13 Nov 2026): an upload
// never overwrites a published version with different content, and nothing deletes one.
// The planner (packages/loader/src/downloads-guard.mjs) is tested directly; the upload script
// (scripts/publish/r2-upload-downloads.mjs), r2-upload-tree's refusal and r2-orphans' exemption
// run under the recording S3 fake (the s3-fake fixture's harness): each in a throwaway copy
// of the repository, with made-up credentials, a bucket in memory and the network shut off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runCase } from '../fixtures/s3-fake/harness.mjs';
import { DOWNLOADS_PREFIX, isVersionedName, planDownloadsUpload, versionedManifestName } from '../../packages/loader/src/downloads-guard.mjs';

const sha256 = (/** @type {string} */ text) => createHash('sha256').update(text).digest('hex');
const V = 'aaaabbbbccccdddd';
const DB = `civgraph-records-${V}.sqlite.gz`;
const BODIES = {
  [DB]: 'records database, this snapshot\n',
  'civgraph-records-latest.sqlite.gz': 'records database, this snapshot\n',
  'civgraph.jsonld.gz': 'graph export index\n',
};
const MANIFEST = {
  schemaVersion: 1,
  version: V,
  licence: 'See the Licence page.',
  files: Object.entries(BODIES).map(([name, body]) => ({ name, bytes: Buffer.byteLength(body), sha256: sha256(body) })),
};
const MANIFEST_TEXT = `${JSON.stringify(MANIFEST, null, 2)}\n`;
const MANIFEST_FILE = { bytes: Buffer.byteLength(MANIFEST_TEXT), sha256: sha256(MANIFEST_TEXT) };
const key = (/** @type {string} */ name) => `${DOWNLOADS_PREFIX}/${name}`;
const ALLOWLIST = `${JSON.stringify({ schemaVersion: 1, prefixes: [{ prefix: 'data/downloads/', rationale: 'fixture' }, { prefix: 'data/maps/', rationale: 'fixture' }] }, null, 2)}\n`;

/** The local downloads folder, and the bucket's objects. @param {object} [objects] @param {Record<string, string>} [bodies] */
function setup(objects = {}, bodies = BODIES, manifestText = MANIFEST_TEXT) {
  return (/** @type {import('../fixtures/s3-fake/harness.mjs').Fixture} */ fx) => {
    fx.write('data/database/r2-publication-allowlist.json', ALLOWLIST);
    for (const [name, body] of Object.entries(bodies)) fx.write(`downloads/${name}`, body);
    fx.write('downloads/manifest.json', manifestText);
    return { objects };
  };
}
/** @param {object} [objects] @param {string[]} [extra] */
const upload = (objects, extra = [], fixture = setup(objects)) => runCase({ id: 'downloads', script: 'r2-upload-downloads', args: ['downloads', ...extra], setup: fixture });
const puts = (/** @type {{ calls: any[] }} */ run) => run.calls.filter((c) => c.op === 'PutObject');
const putKeys = (/** @type {{ calls: any[] }} */ run) => puts(run).map((c) => c.input.Key);

// --- the planner ----------------------------------------------------------------------------

test('a snapshot names its versioned files', () => {
  assert.equal(versionedManifestName(V), `manifest-${V}.json`);
  assert.ok(isVersionedName(DB, V));
  assert.ok(isVersionedName(`manifest-${V}.json`, V));
  for (const name of ['civgraph-records-latest.sqlite.gz', 'civgraph.jsonld.gz', 'manifest.json']) assert.ok(!isVersionedName(name, V), name);
});

test('plan: nothing published yet, so everything goes up, the manifest last', () => {
  const plan = planDownloadsUpload(MANIFEST, new Map(), null, MANIFEST_FILE);
  assert.deepEqual(plan.refuse, []);
  assert.deepEqual(plan.upload, [DB, 'civgraph-records-latest.sqlite.gz', 'civgraph.jsonld.gz', `manifest-${V}.json`, 'manifest.json']);
});

test('plan: a published version with the same content is kept, with different content refused', () => {
  const db = /** @type {{ bytes: number, sha256: string }} */ (MANIFEST.files[0]);
  const same = new Map([[DB, { bytes: db.bytes, sha256: db.sha256 }], [`manifest-${V}.json`, { bytes: MANIFEST_FILE.bytes, sha256: MANIFEST_FILE.sha256 }]]);
  const kept = planDownloadsUpload(MANIFEST, same, null, MANIFEST_FILE);
  assert.deepEqual(kept.refuse, []);
  assert.deepEqual(kept.keep, [DB, `manifest-${V}.json`]);
  assert.deepEqual(kept.upload, ['civgraph-records-latest.sqlite.gz', 'civgraph.jsonld.gz', 'manifest.json']);

  for (const there of [{ bytes: db.bytes, sha256: 'f'.repeat(64) }, { bytes: db.bytes + 1, sha256: db.sha256 }, { bytes: db.bytes, sha256: null }]) {
    const plan = planDownloadsUpload(MANIFEST, new Map([[DB, there]]), null, MANIFEST_FILE);
    assert.deepEqual(plan.upload, [], JSON.stringify(there));
    assert.deepEqual(plan.refuse.map((r) => r.name), [DB], JSON.stringify(there));
  }
  // Published before the guard (no checksum metadata): the published manifest vouches for it.
  const vouched = planDownloadsUpload(MANIFEST, new Map([[DB, { bytes: db.bytes, sha256: null }]]), MANIFEST, MANIFEST_FILE);
  assert.deepEqual(vouched.refuse, []);
  assert.ok(vouched.keep.includes(DB));
  const versionedManifest = planDownloadsUpload(MANIFEST, new Map([[`manifest-${V}.json`, { bytes: MANIFEST_FILE.bytes, sha256: 'e'.repeat(64) }]]), null, MANIFEST_FILE);
  assert.deepEqual(versionedManifest.refuse.map((r) => r.name), [`manifest-${V}.json`]);
});

test('plan: a snapshot without a version is refused', () => {
  for (const version of ['unversioned', '', undefined, 'A/B', 7]) {
    const plan = planDownloadsUpload({ ...MANIFEST, version }, new Map(), null, MANIFEST_FILE);
    assert.deepEqual(plan.upload, [], String(version));
    assert.equal(plan.refuse.length, 1, String(version));
  }
});

// --- the upload, under the fake -------------------------------------------------------------

test('upload: a new snapshot goes up in order, each file with its checksum; the versioned ones immutable', () => {
  const run = upload();
  assert.equal(run.exit, 0, run.stderr);
  assert.deepEqual(putKeys(run), [DB, 'civgraph-records-latest.sqlite.gz', 'civgraph.jsonld.gz', `manifest-${V}.json`, 'manifest.json'].map(key));
  for (const call of puts(run)) {
    assert.equal(call.input.Metadata.sha256, call.input.Body.sha256, call.input.Key);
    assert.equal(/immutable/.test(call.input.CacheControl), /aaaabbbbccccdddd/.test(call.input.Key), call.input.Key);
  }
  const snapshotManifest = puts(run).find((c) => c.input.Key === key(`manifest-${V}.json`));
  assert.equal(snapshotManifest.input.Body.sha256, MANIFEST_FILE.sha256);
});

test('upload: the same snapshot again rewrites only the moving files', () => {
  const db = /** @type {{ bytes: number, sha256: string }} */ (MANIFEST.files[0]);
  const run = upload({
    [key(DB)]: { body: BODIES[DB], metadata: { sha256: db.sha256 } },
    [key(`manifest-${V}.json`)]: { body: MANIFEST_TEXT, metadata: { sha256: MANIFEST_FILE.sha256 } },
  });
  assert.equal(run.exit, 0, run.stderr);
  assert.deepEqual(putKeys(run), ['civgraph-records-latest.sqlite.gz', 'civgraph.jsonld.gz', 'manifest.json'].map(key));
  assert.match(run.stdout, new RegExp(`kept +${DB}`));
});

test('upload: a snapshot published before the guard is recognised by the published manifest', () => {
  const run = upload({ [key(DB)]: { body: BODIES[DB] }, [key('manifest.json')]: { body: MANIFEST_TEXT } });
  assert.equal(run.exit, 0, run.stderr);
  assert.ok(!putKeys(run).includes(key(DB)));
});

test('upload: a version already published with different content is refused, and nothing is written', () => {
  const changed = { ...BODIES, [DB]: 'records database, REBUILT under the same version\n', 'civgraph-records-latest.sqlite.gz': 'records database, REBUILT under the same version\n' };
  const manifest = { ...MANIFEST, files: Object.entries(changed).map(([name, body]) => ({ name, bytes: Buffer.byteLength(body), sha256: sha256(body) })) };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  const published = { [key(DB)]: { body: BODIES[DB], metadata: { sha256: sha256(BODIES[DB]) } }, [key('manifest.json')]: { body: MANIFEST_TEXT } };
  const run = upload(published, [], setup(published, changed, text));
  assert.equal(run.exit, 1);
  assert.match(run.stderr, /REFUSED/);
  assert.match(run.stderr, new RegExp(DB));
  assert.deepEqual(puts(run), []);
  // Unknown content (no checksum, no manifest naming it) is refused too.
  const unknown = upload({ [key(DB)]: { body: BODIES[DB] } });
  assert.equal(unknown.exit, 1);
  assert.match(unknown.stderr, /cannot be confirmed/);
  assert.deepEqual(puts(unknown), []);
});

test('upload: --dry-run writes nothing; a local file that does not match the manifest stops it before R2', () => {
  const dry = upload(undefined, ['--dry-run']);
  assert.equal(dry.exit, 0, dry.stderr);
  assert.deepEqual(puts(dry), []);
  assert.match(dry.stdout, /5 file\(s\) would be uploaded/);
  const tampered = upload(undefined, [], setup({}, { ...BODIES, 'civgraph.jsonld.gz': 'not what the manifest says\n' }));
  assert.equal(tampered.exit, 1);
  assert.match(tampered.stderr, /civgraph\.jsonld\.gz does not match/);
  assert.deepEqual(tampered.calls.filter((c) => c.op !== 'client'), []);
});

test('r2-upload-tree refuses the downloads prefix; r2-orphans never deletes a download', () => {
  const tree = runCase({ id: 'tree', script: 'r2-upload-tree', args: ['downloads', 'data/downloads'], setup: setup() });
  assert.equal(tree.exit, 1);
  assert.match(tree.stderr, /r2-upload-downloads\.mjs/);
  assert.deepEqual(puts(tree), []);

  const orphans = runCase({
    id: 'orphans', script: 'r2-orphans', args: ['--prefix', 'data/', '--match', '.', '--delete'],
    setup: () => ({ objects: { [key(DB)]: { body: 'x' }, 'data/maps/gone.fgb': { body: 'y' } } }),
  });
  assert.equal(orphans.exit, 0, orphans.stderr);
  const deleted = orphans.calls.filter((c) => c.op === 'DeleteObjects').flatMap((c) => c.input.Delete.Objects.map((/** @type {{ Key: string }} */ o) => o.Key));
  assert.deepEqual(deleted, ['data/maps/gone.fgb']);
});
