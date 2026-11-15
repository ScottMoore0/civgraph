// scripts/build/timeline-changes.py in a checkout without the source FlatGeobufs (a git
// worktree, a clean checkout): the sources are not tracked, so every pair resolved to no files,
// was recomputed as "unavailable" and had its tracked change file deleted (wave 14 speed-publish).
// sources_missing_here() keeps such a pair's previous entry and file as they were.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO = new URL('../..', import.meta.url);

/** @param {import('node:test').TestContext} t @param {unknown} cases */
function verdicts(t, cases) {
  const code = [
    'import json, runpy, sys',
    "m = runpy.run_path('scripts/build/timeline-changes.py')",
    'cases = json.loads(sys.stdin.read())',
    "print(json.dumps([m['sources_missing_here'](c['pair'], c['old'], lambda rel, held=set(c['held']): rel in held) for c in cases]))",
  ].join('\n');
  const python = process.env.CIVGRAPH_PYTHON || 'python';
  const res = spawnSync(python, ['-c', code], { encoding: 'utf8', cwd: REPO, input: JSON.stringify(cases) });
  if (res.error) {
    t.skip(`no python (${res.error.message})`);
    return null;
  }
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout.trim().split('\n').pop() || 'null');
}

const old = { fromSources: ['a.fgb'], toSources: ['b1.fgb', 'b2.fgb'], path: 'data/timeline-changes/x.json' };
/** @param {string[]} from @param {string[]} to */
const pair = (from, to) => ({ fromSources: from.map((s) => [s, 'NAME']), toSources: to.map((s) => [s, 'NAME']) });

test('a pair whose sources are not held here keeps its previous entry; a held or moved one is recomputed', (t) => {
  const got = verdicts(t, [
    { pair: pair([], []), old, held: [] },                                   // worktree: nothing held
    { pair: pair(['a.fgb'], ['b1.fgb']), old, held: ['a.fgb', 'b1.fgb'] },   // group map, one child missing
    { pair: pair(['a.fgb'], ['b1.fgb', 'b2.fgb']), old, held: ['a.fgb', 'b1.fgb', 'b2.fgb'] }, // main checkout
    { pair: pair(['a.fgb'], ['c.fgb']), old, held: ['a.fgb', 'c.fgb'] },     // map moved to a file held here
    { pair: pair([], []), old: null, held: [] },                             // new pair: computed as before
    { pair: pair([], []), old: { fromSources: [], toSources: [] }, held: [] }, // never had sources
  ]);
  if (!got) return;
  assert.deepEqual(got, [true, true, false, false, false, false]);
});
