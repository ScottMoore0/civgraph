// intake plan / upload / post-upload / report: the commands built for the existing R2 scripts,
// run through a mocked spawn. No child process is started and nothing touches the network.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadBatch } from '../../scripts/intake/lib/batch.mjs';
import { SCRIPTS, buildPostUploadSteps, buildUploadSteps, formatStep, runSteps } from '../../scripts/intake/lib/commands.mjs';
import { planBatch, renderReport } from '../../scripts/intake/lib/plan.mjs';
import { main } from '../../scripts/intake/intake.mjs';
import { makeBatch, makeRepo, tempDir, writeFile } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV = '--env-file=.env.local';

function fixture(overrides) {
  const repo = makeRepo();
  const { dir } = makeBatch(overrides);
  return { repo, dir, batch: loadBatch(dir, { repo }) };
}

test('upload --dry-run uses each script\'s own dry form and lists only real steps as skipped', () => {
  const { batch } = fixture();
  const steps = buildUploadSteps(batch, { dryRun: true, tmpDir: () => tempDir('manifests') });
  const argv = steps.map((s) => s.argv);
  assert.deepEqual(argv[0], ['node', ENV, 'scripts/publish/r2-upload-files.mjs', 'data/maps/health/New_Layer.fgb=data/maps/health/New_Layer.fgb', '--dry-run']);
  assert.equal(argv[1][2], 'scripts/publish/r2-upload-manifest.mjs');
  assert.deepEqual(argv[1].slice(-4), ['--prefix', 'data/maps/health/', '--force', '--dry']);
  // the generated manifest is the [{local, rel}] form upload-tree-r2 reads
  const manifest = JSON.parse(readFileSync(argv[1][4], 'utf8'));
  assert.deepEqual(manifest.map((e) => e.rel), ['Lookup.csv']);
  assert.ok(path.isAbsolute(manifest[0].local));
  assert.deepEqual(argv[2].slice(-2), ['data/maps/health/', '--verify-only']);
  assert.equal(steps[2].realOnly, true);
  assert.deepEqual(argv[3], ['node', ENV, 'scripts/publish/r2-cache-control.mjs', '--prefix', 'data/maps/health/']); // no --apply
  assert.deepEqual(argv[4], ['node', 'scripts/publish/r2-manifest.mjs']);
  assert.deepEqual(argv[5], ['node', ENV, 'scripts/publish/r2-upload-pmtiles.mjs', '--ids', 'dd-1921-vector-test,dd-1924-vector-test', '--dry-run']);
  assert.deepEqual(argv[6], ['node', ENV, 'scripts/publish/verify-pmtiles-cdn.mjs', '--ids', 'dd-1921-vector-test,dd-1924-vector-test']);
  assert.deepEqual(argv.slice(7), [
    ['node', ENV, 'scripts/stamp-map-cache-tokens.mjs', '--write'],
    ['node', ENV, 'scripts/stamp-map-cache-tokens.mjs', '--check'],
  ]);
  assert.deepEqual(steps.filter((s) => s.realOnly).map((s) => s.argv[s.argv.length - 1]), ['--verify-only', 'scripts/publish/r2-manifest.mjs', 'dd-1921-vector-test,dd-1924-vector-test', '--write', '--check']);
});

test('a real upload applies Cache-Control and drops the dry flags', () => {
  const { batch } = fixture();
  const steps = buildUploadSteps(batch, { dryRun: false, writeManifests: false });
  const text = steps.map(formatStep).join('\n');
  assert.doesNotMatch(text, /--dry/);
  assert.match(text, /publish\/r2-cache-control\.mjs --prefix data\/maps\/health\/ --apply/);
  assert.match(text, /publish\/r2-upload-manifest\.mjs --manifest <tmp>\/upload-manifest-csv\.json --prefix data\/maps\/health\/ --force$/m);
});

test('FGB pairs are split into chunks, as the 74-pair batch of 2 Nov had to be', () => {
  const pairs = Array.from({ length: 74 }, (_, i) => ({ file: `data/maps/health/f${i}.fgb`, key: `data/maps/health/f${i}.fgb` }));
  const { batch } = fixture({ operations: [{ id: 'fgb', type: 'r2-fgb', pairs, chunkSize: 37 }] });
  const steps = buildUploadSteps(batch, { dryRun: false });
  assert.equal(steps.length, 2);
  assert.equal(steps[0].argv.length, 3 + 37);
  assert.equal(steps[1].argv.at(-1), 'data/maps/health/f73.fgb=data/maps/health/f73.fgb');
});

test('runSteps: a dry run skips real-only steps and continues past a failing step', () => {
  const { repo, batch } = fixture();
  writeFile(repo, '.env.local', 'placeholder');
  const calls = [];
  const spawn = (argv) => { calls.push(argv); return { status: argv.includes('--dry') ? 1 : 0 }; };
  const log = [];
  const results = runSteps(buildUploadSteps(batch, { dryRun: true, tmpDir: () => tempDir('m') }), { cwd: repo, dryRun: true, spawn, log: (l) => log.push(l) });
  assert.equal(calls.length, 4); // fgb, tree, cache-control, pmtiles
  assert.ok(calls.every((argv) => argv[1] === ENV));
  assert.equal(results.filter((r) => r.status === 'skipped').length, 5);
  assert.ok(log.some((l) => /dry run: step exited 1, continuing/.test(l)));
});

test('runSteps: a real run stops at the first failure', () => {
  const { repo, batch } = fixture();
  writeFile(repo, '.env.local', 'placeholder');
  const calls = [];
  const spawn = (argv) => { calls.push(argv); return { status: calls.length === 2 ? 3 : 0 }; };
  assert.throws(
    () => runSteps(buildUploadSteps(batch, { dryRun: false, tmpDir: () => tempDir('m') }), { cwd: repo, dryRun: false, spawn, log: () => {} }),
    /step failed \(exit 3\)/,
  );
  assert.equal(calls.length, 2);
});

test('runSteps: no .env.local, nothing runs', () => {
  const { repo, batch } = fixture();
  let called = false;
  assert.throws(
    () => runSteps(buildUploadSteps(batch, { dryRun: true, tmpDir: () => tempDir('m') }), { cwd: repo, dryRun: true, spawn: () => { called = true; return { status: 0 }; } }),
    /\.env\.local is missing/,
  );
  assert.equal(called, false);
});

test('the CLI: upload needs --dry-run or --yes, and --yes needs a committed batch', () => {
  const { repo, dir } = fixture();
  writeFile(repo, '.env.local', 'placeholder');
  const errs = [];
  const quiet = { log: () => {}, err: (l) => errs.push(l), spawn: () => ({ status: 0 }) };
  assert.equal(main(['upload', dir, '--repo', repo], quiet), 2);
  assert.equal(main(['upload', dir, '--repo', repo, '--dry-run', '--yes'], quiet), 2);
  assert.equal(main(['upload', dir, '--repo', repo, '--yes'], quiet), 1);
  assert.match(errs.at(-1), /status is draft/);
  const calls = [];
  assert.equal(main(['upload', dir, '--repo', repo, '--dry-run'], { log: () => {}, spawn: (a) => { calls.push(a); return { status: 0 }; } }), 0);
  assert.equal(calls.length, 4);
  assert.equal(main(['upload', dir, '--repo', repo, '--force'], quiet), 2); // unknown flags are refused
});

test('post-upload: switch to the CDN, thumbnails and the sync, printed unless --write', () => {
  const { repo, dir, batch } = fixture();
  const steps = buildPostUploadSteps(batch).map((s) => s.argv);
  assert.deepEqual(steps, [
    ['node', 'scripts/publish/switch-pmtiles-to-cdn.mjs', '--ids', 'dd-1921-vector-test,dd-1924-vector-test'],
    ['python', 'scripts/regen-thumbnails.py', '--download', '--ids', 'dd-1921,dd-1924'],
    ['node', ENV, 'scripts/publish/r2-upload-tree.mjs', 'assets/thumbnails', 'assets/thumbnails', '--concurrency=16', '--changed-only'],
  ]);
  const calls = [];
  const lines = [];
  assert.equal(main(['post-upload', dir, '--repo', repo], { log: (l) => lines.push(l), spawn: (a) => { calls.push(a); return { status: 0 }; } }), 0);
  assert.equal(calls.length, 0);
  assert.match(lines.at(-1), /^DRY RUN: 3 step\(s\)/);
});

test('plan and report: repository changes, R2 objects with sizes, and the commands', () => {
  const { repo, dir, batch } = fixture();
  const plan = planBatch(batch);
  assert.equal(plan.stage.changes.length, 10);
  assert.deepEqual(plan.r2.objects.map((o) => [o.key, o.bytes]), [
    ['data/maps/health/New_Layer.fgb', 15], // size of the batch copy: not in the repo yet
    ['data/maps/health/Lookup.csv', 8],
  ]);
  assert.deepEqual(plan.r2.pmtiles.map((p) => p.key), [
    'data/maps/test/pmtiles/generated/dd-1921-vector-test.pmtiles',
    'data/maps/test/pmtiles/generated/dd-1924-vector-test.pmtiles',
  ]);
  const md = renderReport(plan, batch.manifest, { generatedAt: '2026-11-06' });
  assert.match(md, /^# Test batch/);
  assert.match(md, /\*\*gazette\*\*: Belfast Gazette; licence: OGL v3\.0/);
  assert.match(md, /\| `data\/maps\/health\/New_Layer\.fgb` \| 15 B \|/);
  assert.match(md, /node --env-file=\.env\.local scripts\/publish\/r2-upload-pmtiles\.mjs --ids dd-1921-vector-test,dd-1924-vector-test/);
  assert.match(md, /The intake tool never runs it\./);
  const out = path.join(tempDir('report'), 'REPORT.md');
  assert.equal(main(['report', dir, '--repo', repo, '--out', out], { log: () => {} }), 0);
  assert.ok(existsSync(out));
});

test('every script the steps call exists in this repository', () => {
  for (const script of Object.values(SCRIPTS)) assert.ok(existsSync(path.join(ROOT, script)), `${script} is missing`);
});

// The worked example: the hand-written upload.ps1 of batch-2026-11-05, step by step.
test('docs/intake-examples/batch-2026-11-05 reproduces that batch\'s upload.ps1 and post-upload.txt', () => {
  const batch = loadBatch(tempDir('empty'), { manifest: path.join(ROOT, 'docs/intake-examples/batch-2026-11-05/batch.json'), repo: tempDir('repo') });
  const ids = 'dispensary-districts-ni-1921-04-01-vector-test,dispensary-districts-ni-1924-04-01-vector-test,dispensary-districts-ni-1929-01-01-vector-test,tia-towns-ni-1921-05-03-vector-test,tia-towns-ni-1925-04-01-vector-test,tia-towns-ni-1927-04-01-vector-test,tia-towns-ni-1934-08-01-vector-test,tia-towns-ni-1937-04-01-vector-test,tia-towns-ni-1959-05-29-vector-test';
  const fgb = [
    'health/Dispensary_Districts_NI_1921-04-01', 'health/Dispensary_Districts_NI_1924-04-01', 'health/Dispensary_Districts_NI_1929-01-01',
    'local-government/Towns_Improvement_Act_Towns_NI_1921-05-03', 'local-government/Towns_Improvement_Act_Towns_NI_1925-04-01',
    'local-government/Towns_Improvement_Act_Towns_NI_1927-04-01', 'local-government/Towns_Improvement_Act_Towns_NI_1934-08-01',
    'local-government/Towns_Improvement_Act_Towns_NI_1937-04-01', 'local-government/Towns_Improvement_Act_Towns_NI_1959-05-29',
  ].map((p) => `data/maps/${p}.fgb=data/maps/${p}.fgb`);
  // upload.ps1 without -DryRun, in order (its tree manifest was a file in the batch folder; ours is generated)
  const expected = [
    ['node', ENV, 'scripts/publish/r2-upload-files.mjs', ...fgb],
    ['node', ENV, 'scripts/publish/r2-upload-manifest.mjs', '--manifest', '<tmp>/upload-manifest-lookup-csv.json', '--prefix', 'data/maps/health/', '--force'],
    ['node', ENV, 'scripts/publish/r2-upload-manifest.mjs', '--manifest', '<tmp>/upload-manifest-lookup-csv.json', '--prefix', 'data/maps/health/', '--verify-only'],
    ['node', ENV, 'scripts/publish/r2-cache-control.mjs', '--prefix', 'data/maps/health/', '--apply'],
    ['node', ENV, 'scripts/publish/r2-cache-control.mjs', '--prefix', 'data/maps/local-government/', '--apply'],
    ['node', ENV, 'scripts/publish/r2-cache-control.mjs', '--prefix', 'data/maps/health/', '--ext', 'csv', '--apply'],
    ['node', 'scripts/publish/r2-manifest.mjs'],
    ['node', ENV, 'scripts/publish/r2-upload-pmtiles.mjs', '--ids', ids],
    ['node', ENV, 'scripts/publish/verify-pmtiles-cdn.mjs', '--ids', ids],
    ['node', ENV, 'scripts/stamp-map-cache-tokens.mjs', '--write'],
    ['node', ENV, 'scripts/stamp-map-cache-tokens.mjs', '--check'],
  ];
  assert.deepEqual(buildUploadSteps(batch, { dryRun: false, writeManifests: false }).map((s) => s.argv), expected);
  // upload.ps1 -DryRun ran fgb, tree, the three Cache-Control listings and PMTiles in their dry forms, then stopped
  const dry = buildUploadSteps(batch, { dryRun: true, writeManifests: false }).filter((s) => !s.realOnly).map((s) => s.argv);
  assert.deepEqual(dry, [
    [...expected[0], '--dry-run'],
    [...expected[1], '--dry'],
    expected[3].slice(0, -1), expected[4].slice(0, -1), expected[5].slice(0, -1),
    [...expected[7], '--dry-run'],
  ]);
  // post-upload.txt steps 1, 3, 4 and 5
  const thumbIds = ids.replace(/-vector-test/g, '');
  assert.deepEqual(buildPostUploadSteps(batch).map(formatStep), [
    `node scripts/publish/switch-pmtiles-to-cdn.mjs --ids ${ids}`,
    'node scripts/publish/r2-manifest.mjs',
    'npm run rebuild -- --plan',
    'npm run build',
    `python scripts/regen-thumbnails.py --download --ids ${thumbIds}`,
    'node --env-file=.env.local scripts/publish/r2-upload-tree.mjs assets/thumbnails assets/thumbnails --concurrency=16 --changed-only',
    'node scripts/validate-test-cdn-manifest.mjs',
    'npm run check:fast',
    'node --env-file=.env.local scripts/stamp-map-cache-tokens.mjs --check',
  ]);
});
