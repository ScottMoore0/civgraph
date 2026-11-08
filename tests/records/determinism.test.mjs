// Two builds of the same commit give a zero delta (no timestamps or wall-clock order leak into
// rows). Heavy: it runs records:build again, so it runs only with RECORDS_DETERMINISM=1
// (RECORDS_DETERMINISM=full re-runs the transforms too; otherwise only the ingest is repeated).
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from '../../packages/loader/src/paths.mjs';
import { buildDelta } from '../../packages/loader/src/diff-load.mjs';

const DB = path.join(REPO_ROOT, 'tmp/records/civgraph-records.sqlite');
const mode = process.env.RECORDS_DETERMINISM;

test('a second build of the same tree gives an empty delta', { skip: (!mode || !existsSync(DB)) && 'set RECORDS_DETERMINISM=1 (or full) with a build present', timeout: 3_600_000 }, () => {
  const first = path.join(REPO_ROOT, 'tmp/records/determinism-first.sqlite');
  copyFileSync(DB, first);
  const args = ['scripts/records/build-records-db.mjs', mode === 'full' ? '--force-transform' : '--no-transform', '--no-source-checks'];
  const run = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr.slice(-2000));
  const lines = [];
  const result = buildDelta({ toFile: DB, fromFile: first, write: (s) => lines.push(s), loadedAt: 'x' });
  const changed = Object.entries(result.summary).filter(([, s]) => s.deleted || s.upserted);
  assert.deepEqual(changed, [], `tables changed between two builds: ${JSON.stringify(changed)}`);
  // Only the opening loading mark and the closing dataset statement remain.
  assert.equal(result.statements, 2);
});
