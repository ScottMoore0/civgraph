// The publish step that keeps the Elections app's R2 extracts current (scripts/publish/elections-app-refresh.mjs,
// called from scripts/publish/publish.sh after the D1 load and before the push).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { manifestChanged } from '../../scripts/publish/elections-app-refresh.mjs';

test('an upload is due only when the manifest differs from R2, or R2 has none', () => {
  const a = JSON.stringify({ files: [{ name: 'dail-abc.parquet', sha256: 'x' }] });
  assert.equal(manifestChanged(a, null), true);
  assert.equal(manifestChanged(a, a), false);
  // Whitespace alone never forces an upload.
  assert.equal(manifestChanged(a, JSON.stringify(JSON.parse(a), null, 2)), false);
  assert.equal(manifestChanged(a, JSON.stringify({ files: [{ name: 'dail-abd.parquet', sha256: 'y' }] })), true);
  // An unreadable answer is treated as changed (the upload script re-checks everything).
  assert.equal(manifestChanged(a, '<html>'), true);
});

test('publish.sh runs the refresh after the D1 load and before the push, and a failure aborts the publish', () => {
  const sh = readFileSync(new URL('../../scripts/publish/publish.sh', import.meta.url), 'utf8');
  const load = sh.indexOf('stage to loaded');
  const refresh = sh.indexOf('node scripts/publish/elections-app-refresh.mjs >');
  const push = sh.indexOf('git push');
  assert.ok(load > 0 && refresh > load && push > refresh, 'load, then refresh, then push');
  const line = sh.slice(refresh, sh.indexOf('\n', refresh));
  assert.match(line, /\|\| \{ echo "ABORT: .*aborted aborted-after-load; exit 1; \}/);
  assert.match(sh, /elections-app-refresh\.mjs --dry-run/);
});

test('the refresh builds, checks strictly and uploads only through the gated upload script', () => {
  const src = readFileSync(new URL('../../scripts/publish/elections-app-refresh.mjs', import.meta.url), 'utf8');
  assert.match(src, /'build:elections-app'/);
  assert.match(src, /'check:elections-app-extracts', '--', '--strict'/);
  assert.match(src, /elections-app-r2-upload\.mjs'\), '--upload'/);
});
