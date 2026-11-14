// The publish's path decision (scripts/publish/publish-path.mjs) on fixture file lists, and
// publish.sh's use of it, of the records-freshness check, the safe verify and the deploy hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decidePublishPath, describeDecision, SKIPPED_ON_CODE_ONLY } from '../../scripts/publish/publish-path.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = { commit: '1df2dbbf352048b9a456b7390353f30ac3052272', from: 'fixture' };
const files = (/** @type {string[]} */ ...paths) => paths.map((p) => ({ path: p, tracked: true }));

test('only code changed since the last load: the code-only path', () => {
  const d = decidePublishPath({ base: BASE, changed: files('site/browse/browse.js', 'functions/_api/records/index.js', 'packages/map/app/app.js', 'docs/notes.md', 'scripts/publish/publish.sh') });
  assert.equal(d.path, 'code-only');
  assert.deepEqual(d.reasons, []);
  assert.equal(d.code.length, 5);
  const lines = describeDecision(d, BASE);
  assert.equal(lines.at(-1), 'PATH code-only');
  for (const skipped of SKIPPED_ON_CODE_ONLY) assert.ok(lines.some((l) => l.includes(skipped)), skipped);
  assert.ok(lines.some((l) => /records:build/.test(l)) && lines.some((l) => /D1 load/.test(l)) && lines.some((l) => /R2/.test(l)));
});

test('nothing changed since the last load: code-only (there is nothing to load)', () => {
  assert.equal(decidePublishPath({ base: BASE, changed: [] }).path, 'code-only');
});

test('any file that feeds the records, D1 or R2 takes the full path', () => {
  for (const file of [
    'data/elections-source/dail/2024.json', 'data/catalogue/catalogue.json', 'render/metadata/maps-test.json',
    'packages/loader/src/ingest-maps.mjs', 'packages/schema/migrations/0003_x.sql', 'scripts/build/build-browse-indexes.mjs',
    'site/agent/maps-index.json', 'site/apps/elections/config.js', 'scripts/publish/elections-app-refresh.mjs',
    'packages/map/src/public-map.mjs', 'package-lock.json', 'brand-new-folder/x.json',
  ]) {
    const d = decidePublishPath({ base: BASE, changed: files('site/index.html', file) });
    assert.equal(d.path, 'full', file);
    assert.deepEqual(d.records, [file]);
    assert.match(d.reasons.join(), /feed the records/);
    assert.equal(describeDecision(d, BASE).at(-1), 'PATH full');
  }
});

test('in doubt, the full path: no base, --rebuild, --downloads', () => {
  const code = files('site/index.html');
  const noBase = decidePublishPath({ base: null, baseProblem: 'no last-loaded snapshot', changed: code });
  assert.equal(noBase.path, 'full');
  assert.match(noBase.reasons[0], /no known base for D1: no last-loaded snapshot/);
  assert.equal(decidePublishPath({ base: BASE, changed: code, rebuild: true }).path, 'full');
  assert.equal(decidePublishPath({ base: BASE, changed: code, downloads: true }).path, 'full');
});

test('untracked files: outside the folders the build reads they are ignored; inside, they count', () => {
  const stray = decidePublishPath({ base: BASE, changed: [{ path: 'assets/images/proposal.docx', tracked: false }, { path: 'review-ni-council-xref/a.csv', tracked: false }] });
  assert.equal(stray.path, 'code-only');
  assert.deepEqual(stray.outside, ['assets/images/proposal.docx', 'review-ni-council-xref/a.csv']);
  assert.equal(decidePublishPath({ base: BASE, changed: [{ path: 'data/elections-source/new.json', tracked: false }] }).path, 'full');
});

const SH = readFileSync(path.join(ROOT, 'scripts', 'publish', 'publish.sh'), 'utf8');
const code = SH.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

test('publish.sh takes the code-only path only on an exact last line, and keeps --rebuild', () => {
  assert.match(code, /= "PATH code-only" \]; then ROUTE=code-only; fi/);
  assert.match(code, /ROUTE=full /);
  assert.match(code, /--rebuild\) REBUILD=1/);
  assert.match(code, /publish-path\.mjs \$\{REBUILD:\+--rebuild\} \$\{DOWNLOADS:\+--downloads\}/);
  // Reuse only after the freshness check passes, and never with --rebuild.
  assert.match(code, /if \[ -n "\$REBUILD" \]; then echo "  building: --rebuild given"\n\s*elif node scripts\/publish\/records-freshness\.mjs/);
});

test('publish.sh runs the safe verify after a load, never --check, and never rolls back', () => {
  assert.match(code, /npm run -s records:verify:safe -- --remote --db "\$WORK\/last-loaded\.sqlite"/);
  assert.doesNotMatch(code, /--check/);
  const load = code.indexOf('records:deploy -- --remote >');
  const verify = code.indexOf('( npm run -s records:verify:safe');
  assert.ok(load > 0 && verify > load, 'the verify follows the real load');
  assert.match(code, /SAFE VERIFY FAILED/);
  assert.match(code, /FAILED\*\) exit 3/);
  // Nothing after the verify loads, deletes or reverts.
  assert.doesNotMatch(code.slice(verify), /records:deploy|git revert|git reset|--rollback/);
  assert.match(code, /echo " {2}safe verify: {3}\$VERIFY"/);
});

test('publish.sh deploys from here only with CIVGRAPH_DIRECT_DEPLOY=1, after the push', () => {
  const push = code.indexOf('git push -q origin HEAD:main');
  const deploy = code.indexOf('node scripts/publish/deploy-pages.mjs');
  assert.ok(push > 0 && deploy > push);
  assert.match(code, /if \[ "\$\{CIVGRAPH_DIRECT_DEPLOY:-\}" != "1" \]; then/);
  assert.match(code, /\[ ! -f scripts\/publish\/deploy-pages\.mjs \]/);
  assert.match(code, /deploy-pages\.mjs --dry-run/);
  // The next decision's base is recorded only after a full publish has pushed.
  assert.ok(code.indexOf('publish-path.mjs --record-load') > code.lastIndexOf('git push -q origin HEAD:main'));
});
