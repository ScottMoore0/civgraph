// What feeds a publish's data (packages/loader/src/publish-inputs.mjs): the classes, the import
// closure of the records entry points, and the content-addressed inputs manifest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODE_ONLY, inputsManifest, manifestDifferences, publishInputClass, READ_BY_BUILD, workingTreeFiles,
} from '@civgraph/loader/publish-inputs.mjs';
import { packageTarget } from '../../scripts/lib/package-names.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('each file has the class its folder and its readers give it', () => {
  const cases = {
    'data/elections-source/dail/1922.json': 'records',
    'data/database/maps.json': 'records',
    'data/catalogue/catalogue.json': 'records',
    'render/metadata/maps-test.json': 'records',
    'packages/loader/src/ingest-maps.mjs': 'records',
    'packages/schema/migrations/0001_records.sql': 'records',
    'scripts/build/build-browse-indexes.mjs': 'records',
    'scripts/ingest/persons/apply_person_ids_v2.py': 'records',
    'site/agent/maps-index.json': 'records',
    'site/assets/thumbnails/manifest.json': 'records',
    'site/apps/elections/config.js': 'records',
    'site/apps/elections/census/ni-areas.json': 'records',
    'site/pkg/config/src/config.js': 'records',
    'packages/map/src/public-map.mjs': 'records',
    'scripts/publish/elections-app-refresh.mjs': 'records',
    'scripts/publish/r2-env.mjs': 'records',
    'package.json': 'records',
    'wrangler.toml': 'records',
    'something-new/file.txt': 'records',
    'site/index.html': 'code',
    'site/browse/browse.js': 'code',
    'site/apps/elections/app.js': 'code',
    'functions/_api/records/index.js': 'code',
    'packages/map/app/app.js': 'code',
    'packages/map/src/ui-controller.js': 'code',
    'packages/ui/assets/tokens.css': 'code',
    'packages/api/src/queries/persons.mjs': 'code',
    'render/src/renderer.js': 'code',
    'docs/ARCHITECTURE-RULES.md': 'code',
    'CHECKS.md': 'code',
    'scripts/README.md': 'code',
    'data/elections-source/README.md': 'code',
    'scripts/check/run.mjs': 'code',
    'scripts/publish/publish.sh': 'code',
    'scripts/publish/publish-path.mjs': 'code',
    'scripts/build/app-bundle.mjs': 'code',
    'config/tsconfig.pipeline.json': 'code',
    'data/database/site-stats.json': 'code',
    'data/database/status.json': 'code',
  };
  for (const [file, cls] of Object.entries(cases)) assert.equal(publishInputClass(file), cls, file);
  assert.equal(publishInputClass(['tests', 'unit', 'x.test.mjs'].join('/')), 'code');
  // Untracked: outside every folder the build reads, it cannot change the data.
  assert.equal(publishInputClass('assets/images/proposal.docx', { tracked: false }), 'outside');
  assert.equal(publishInputClass('review-for-phelim/notes.txt', { tracked: false }), 'outside');
  assert.equal(publishInputClass('data/elections-source/new.json', { tracked: false }), 'records');
  assert.equal(publishInputClass('docs/mocks/a.html', { tracked: false }), 'code');
  assert.equal(publishInputClass('assets/images/proposal.docx'), 'records', 'tracked and unknown: records');
});

/** The relative and @civgraph static imports of a module, as repository paths. */
function importsOf(rel) {
  const text = readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm;
  const out = [];
  for (const m of text.matchAll(re)) {
    const spec = m[1] || m[2] || m[3];
    // A package name resolves through the package's exports (scripts/lib/package-names.mjs).
    const target = spec.startsWith('@civgraph/') ? packageTarget(spec) : spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)) : null;
    if (target === null) continue;
    if (existsSync(path.join(ROOT, target))) out.push(target);
  }
  return out;
}

// Every program the records build runs, the load, the extracts and their upload, and the builders
// of committed files the load reads (the catalogue, the ledgers, the maps index, the NI rounds).
const RECORD_ENTRY_POINTS = [
  'packages/loader/src/build-records-db.mjs', 'packages/loader/src/deploy-records.mjs',
  'scripts/build/build-test2-election-manifest.mjs', 'scripts/build/build-test2-election-summaries.mjs',
  'scripts/build/build-election-provenance.mjs', 'scripts/build/build-browse-indexes.mjs',
  'scripts/build/build-party-profiles.mjs', 'scripts/build/build-office-pages.mjs',
  'scripts/build/graph/build-semantic-graph.mjs', 'scripts/build/elections-app/data.mjs',
  'scripts/publish/elections-app-refresh.mjs', 'scripts/publish/elections-app-r2-upload.mjs',
  'scripts/build/build-ni-local-grouped.mjs', 'scripts/build/catalogue/build-catalogue.mjs',
  'scripts/build/build-graph-id-ledger.mjs', 'scripts/build/build-person-address-ledger.mjs',
  'scripts/build/agent-index.mjs', 'scripts/build/sync-catalogue-display-fields.mjs',
];

test('nothing the records build, the load or the extracts import is classed as code', () => {
  const seen = new Set();
  const stack = [...RECORD_ENTRY_POINTS];
  while (stack.length) {
    const rel = /** @type {string} */ (stack.pop());
    if (seen.has(rel)) continue;
    seen.add(rel);
    stack.push(...importsOf(rel));
  }
  assert.ok(seen.size > 80, `the walk reached ${seen.size} files`);
  const code = [...seen].filter((file) => publishInputClass(file) === 'code').sort();
  assert.deepEqual(code, [], 'add each to READ_BY_BUILD (or move it out of a code folder)');
  // Each exception still names an imported file, so the list cannot rot.
  for (const re of READ_BY_BUILD) assert.ok([...seen].some((file) => re.test(file)), `${re} matches no imported file`);
});

test('the data files classed as code are read by nothing but their builders and checks', () => {
  // status-snapshots.mjs names status.json in a comment only (it writes the ledger status.json is built from).
  const dataCode = { 'site-stats.json': ['scripts/build/build-site-stats.mjs'], 'database/status.json': ['scripts/build/build-status.mjs', 'scripts/build/status-snapshots.mjs'] };
  const files = execFileSync('git', ['ls-files', 'scripts', 'packages', 'functions', 'site'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter((f) => /\.(mjs|js|cjs|py)$/.test(f) && !f.startsWith('scripts/check/'));
  for (const [needle, builder] of Object.entries(dataCode)) {
    const readers = files.filter((f) => readFileSync(path.join(ROOT, f), 'utf8').includes(needle));
    assert.deepEqual(readers, builder, `${needle} is read by ${readers.join(', ')}`);
  }
  assert.ok(CODE_ONLY.some((re) => re.test('data/database/site-stats.json')));
});

test('the inputs manifest hashes records content only, whatever the order or the code', () => {
  const ctx = /** @type {const} */ ({ votes: 'built', seed: '1:2' });
  const files = [
    { path: 'data/a.json', blob: 'aa', tracked: true },
    { path: 'site/index.html', blob: 'bb', tracked: true },
    { path: 'assets/x.docx', blob: 'cc', tracked: false },
  ];
  const one = inputsManifest(files, ctx);
  assert.equal(one.files, 1);
  assert.deepEqual(inputsManifest([...files].reverse(), ctx), one);
  assert.equal(inputsManifest([files[0], { ...files[1], blob: 'changed' }, { ...files[2], blob: 'changed' }], ctx).hash, one.hash, 'code and outside files do not count');
  assert.notEqual(inputsManifest([{ ...files[0], blob: 'ab' }], ctx).hash, one.hash);
  assert.notEqual(inputsManifest([...files, { path: 'data/new.json', blob: 'dd', tracked: false }], ctx).hash, one.hash, 'an untracked data file counts');
  assert.deepEqual(manifestDifferences(one, one), []);
  assert.match(manifestDifferences(null, one)[0], /no input manifest/);
  assert.match(manifestDifferences({ ...one, hash: 'x'.repeat(32) }, one)[0], /inputs changed/);
  assert.match(manifestDifferences({ ...one, votes: 'carried' }, one)[0], /votes were carried/);
  assert.match(manifestDifferences({ ...one, seed: '' }, one)[0], /seed/);
});

test('the working tree lists the same content before and after a commit', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'publish-inputs-'));
  const g = (/** @type {string[]} */ ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' });
  try {
    g('init', '-q');
    mkdirSync(path.join(dir, 'data'));
    writeFileSync(path.join(dir, 'data', 'a.json'), '1\n');
    writeFileSync(path.join(dir, 'data', 'gone.json'), 'x\n');
    g('add', '.');
    g('commit', '-q', '-m', 'one');
    writeFileSync(path.join(dir, 'data', 'a.json'), '2\n');
    writeFileSync(path.join(dir, 'data', 'new.json'), '3\n');
    rmSync(path.join(dir, 'data', 'gone.json'));
    const before = workingTreeFiles(dir).sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(before.map((f) => [f.path, f.tracked]), [['data/a.json', true], ['data/new.json', false]]);
    g('add', '-A');
    g('commit', '-q', '-m', 'two');
    const after = workingTreeFiles(dir).sort((a, b) => a.path.localeCompare(b.path));
    const ctx = /** @type {const} */ ({ votes: 'carried', seed: '' });
    assert.equal(inputsManifest(after, ctx).hash, inputsManifest(before.map((f) => ({ ...f, tracked: true })), ctx).hash);
    assert.deepEqual(after.map((f) => f.blob), before.map((f) => f.blob));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
