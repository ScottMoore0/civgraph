// The decisions of the direct Pages deploy (scripts/publish/deploy-pages.mjs): which branch, whether
// the commit may go out, whether dist/ is reused, what dist/ must hold, and what wrangler is told.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDist, checkSource, commitMessage, lockMismatches, MESSAGE_MAX, PAGES_HARD_LIMIT, parseArgs, parseWranglerOutput,
  planBuild, wranglerArgs,
} from '../../scripts/publish/deploy-pages.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('production is the default, on the production branch', () => {
  assert.deepEqual(parseArgs([]), { preview: false, branch: 'main', dryRun: false, rebuild: false, help: false });
  assert.equal(parseArgs(['--branch', 'main']).branch, 'main');
});

test('--preview defaults to the preview branch and takes a name', () => {
  assert.equal(parseArgs(['--preview']).branch, 'preview');
  assert.equal(parseArgs(['--preview', '--branch', 'preview-direct']).branch, 'preview-direct');
  assert.equal(parseArgs(['--preview', '--branch=preview-direct', '--dry-run']).dryRun, true);
});

test('a preview can never land on production, nor production on a preview branch', () => {
  assert.throws(() => parseArgs(['--preview', '--branch', 'main']), /production branch/);
  assert.throws(() => parseArgs(['--branch', 'preview-direct']), /add --preview/);
  assert.throws(() => parseArgs(['--preview', '--branch']), /needs a name/);
  assert.throws(() => parseArgs(['--preview', '--branch', '--dry-run']), /needs a name/);
  assert.throws(() => parseArgs(['--preview', '--branch', 'a b']), /letters, digits/);
  assert.throws(() => parseArgs(['--prod']), /unknown option/);
});

test('production deploys only a clean, pushed commit', () => {
  const prod = { preview: false, dryRun: false };
  assert.deepEqual(checkSource(prod, { dirty: [], head: A, remoteMain: A }), { errors: [], warnings: [] });
  assert.match(checkSource(prod, { dirty: [], head: A, remoteMain: B }).errors[0], /not main on GitHub/);
  assert.match(checkSource(prod, { dirty: [], head: A, remoteMain: null }).errors[0], /could not read main/);
  assert.match(checkSource(prod, { dirty: ['site/index.html'], head: A, remoteMain: A }).errors[0], /uncommitted changes \(site\/index.html\)/);
  const many = checkSource(prod, { dirty: ['1', '2', '3', '4', '5', '6'], head: A, remoteMain: A }).errors[0];
  assert.match(many, /^6 tracked file\(s\).*5, \.\.\.\)/);
  assert.match(checkSource(prod, { dirty: [], head: 'HEAD', remoteMain: 'HEAD' }).errors[0], /not a commit hash/);
});

test('a preview may be unpushed, with a warning, but never dirty', () => {
  const preview = { preview: true, dryRun: false };
  const unpushed = checkSource(preview, { dirty: [], head: A, remoteMain: B });
  assert.deepEqual(unpushed.errors, []);
  assert.match(unpushed.warnings[0], /unpushed commit/);
  assert.deepEqual(checkSource(preview, { dirty: [], head: A, remoteMain: A }), { errors: [], warnings: [] });
  assert.equal(checkSource(preview, { dirty: ['x'], head: A, remoteMain: A }).errors.length, 1);
});

test('a dry run reports every refusal and carries on', () => {
  const r = checkSource({ preview: false, dryRun: true }, { dirty: ['x'], head: A, remoteMain: B });
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 2);
  assert.ok(r.warnings.every((w) => w.startsWith('a real deploy would refuse: ')));
});

test('dist/ is reused only when built for this commit, lockfile and Node, and still whole', () => {
  const stamp = { head: A, lockHash: 'L', node: '24', files: 5180, builtAt: 't' };
  const base = { head: A, lockHash: 'L', node: '24', rebuild: false, stamp, stageHead: A, distFiles: 5180 };
  assert.equal(planBuild(base).reuse, true);
  assert.equal(planBuild({ ...base, rebuild: true }).reason, '--rebuild');
  assert.equal(planBuild({ ...base, stamp: null }).reason, 'no earlier build');
  assert.match(planBuild({ ...base, head: B, stageHead: B }).reason, /built for aaaaaaaaaa/);
  assert.match(planBuild({ ...base, stageHead: B }).reason, /another commit/);
  assert.match(planBuild({ ...base, lockHash: 'M' }).reason, /package-lock/);
  assert.match(planBuild({ ...base, node: '22' }).reason, /Node 24, running 22/);
  assert.match(planBuild({ ...base, distFiles: null }).reason, /missing/);
  assert.match(planBuild({ ...base, distFiles: 5179 }).reason, /holds 5179 files/);
});

test('node_modules must match the lockfile; an absent optional package is fine', () => {
  const locked = {
    '': { version: '1.0.0' },
    'node_modules/esbuild': { version: '0.25.0' },
    'node_modules/@esbuild/linux-x64': { version: '0.25.0', optional: true },
    'node_modules/maplibre-gl': { version: '5.0.0' },
  };
  assert.deepEqual(lockMismatches(locked, { 'node_modules/esbuild': { version: '0.25.0' }, 'node_modules/maplibre-gl': { version: '5.0.0' } }), []);
  assert.deepEqual(lockMismatches(locked, { 'node_modules/esbuild': { version: '0.24.0' } }), [
    'esbuild: 0.24.0 installed, 0.25.0 locked',
    'maplibre-gl: not installed',
  ]);
});

test('dist/ must stay under the limits and hold the entry files', () => {
  const ok = { files: 5180, oversized: [], hasIndex: true, hasRoutes: true };
  assert.deepEqual(checkDist(ok), []);
  assert.match(checkDist({ ...ok, files: 18501 })[0], /18500-file guardrail/);
  assert.match(checkDist({ ...ok, files: PAGES_HARD_LIMIT })[0], /refuses 20000/);
  assert.match(checkDist({ ...ok, oversized: ['data/big.json'] })[0], /data\/big.json is over 25 MiB/);
  assert.deepEqual(checkDist({ ...ok, hasIndex: false, hasRoutes: false }).length, 2);
});

test('the commit message is one safe line of bounded length', () => {
  assert.equal(commitMessage('Fixed the "map" 100% & more\nsecond line'), 'Fixed the map 100 more');
  const long = commitMessage('x'.repeat(500));
  assert.equal(long.length, MESSAGE_MAX);
  assert.ok(long.endsWith('...'));
});

test('wrangler deploys dist/ of the commit to the named branch, never dirty', () => {
  assert.deepEqual(wranglerArgs({ branch: 'preview-direct', head: A, message: 'm' }), [
    'pages', 'deploy', 'dist', '--project-name', 'civgraph', '--branch', 'preview-direct',
    '--commit-hash', A, '--commit-message', 'm', '--commit-dirty=false',
  ]);
});

test('the deployment URL, alias and upload counts are read from wrangler', () => {
  const out = [
    'Uploading... (5180/5180)',
    '✨ Success! Uploaded 12 files (5168 already uploaded) (3.21 sec)',
    '✨ Compiled Worker successfully',
    '🌎 Deploying...',
    '✨ Deployment complete! Take a peek over at https://0123abcd.example.pages.dev',
    '✨ Deployment alias URL: https://preview-direct.example.pages.dev',
  ].join('\n');
  assert.deepEqual(parseWranglerOutput(out), {
    url: 'https://0123abcd.example.pages.dev', alias: 'https://preview-direct.example.pages.dev', uploaded: 12, alreadyUploaded: 5168,
  });
  assert.deepEqual(parseWranglerOutput('✨ Success! Uploaded 1 file (3.1 sec)'), { url: null, alias: null, uploaded: 1, alreadyUploaded: 0 });
  assert.deepEqual(parseWranglerOutput('✘ [ERROR] failed'), { url: null, alias: null, uploaded: null, alreadyUploaded: null });
});
