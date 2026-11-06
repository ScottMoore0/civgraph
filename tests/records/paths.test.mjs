// The record build's path constants: the legacy locations by default, everything under
// CIVGRAPH_BUILD_DIR when it is set, and the same answer from paths.mjs and paths.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { recordPaths, localPathForUrl, recordPath, REPO_ROOT } from '../../scripts/records/paths.mjs';

const LEGACY = {
  ELECTION_BUNDLE_DIR: 'render/metadata/elections-test2',
  ELECTION_MANIFEST: 'render/metadata/elections-test2.json',
  ELECTION_REPORT: 'render/metadata/elections-test2-report.json',
  ELECTION_SUMMARY_DIR: 'render/metadata/elections-test2-summaries',
  PROVENANCE_FILE: 'data/database/election-provenance.json',
  PROVENANCE_SHARD_DIR: 'render/metadata/election-provenance',
  BROWSE_DIR: 'data/browse',
  GRAPH_DIR: 'data/graph',
};

test('with CIVGRAPH_BUILD_DIR unset every constant is the legacy path', () => {
  const p = recordPaths({});
  assert.equal(p.BUILD_DIR, null);
  for (const [name, legacy] of Object.entries(LEGACY)) {
    assert.equal(p[name], path.join(REPO_ROOT, legacy), name);
  }
});

test('with CIVGRAPH_BUILD_DIR set every constant is under it', () => {
  const p = recordPaths({ CIVGRAPH_BUILD_DIR: 'tmp/records' });
  const build = path.join(REPO_ROOT, 'tmp', 'records');
  assert.equal(p.BUILD_DIR, build);
  for (const name of Object.keys(LEGACY)) {
    assert.ok(p[name].startsWith(build + path.sep), `${name} = ${p[name]}`);
  }
});

test('legacy URLs resolve into the build directory, other URLs under the repository', () => {
  const p = recordPaths({ CIVGRAPH_BUILD_DIR: 'tmp/records' });
  assert.equal(localPathForUrl('/render/metadata/elections-test2/a__b.json?v=1', p), path.join(p.ELECTION_BUNDLE_DIR, 'a__b.json'));
  assert.equal(localPathForUrl('/render/metadata/elections-test2.json', p), p.ELECTION_MANIFEST);
  assert.equal(localPathForUrl('/render/metadata/elections-test2-summaries/x.json', p), path.join(p.ELECTION_SUMMARY_DIR, 'x.json'));
  assert.equal(localPathForUrl('/data/browse/person-shards/persons-000.json', p), path.join(p.BROWSE_DIR, 'person-shards', 'persons-000.json'));
  assert.equal(localPathForUrl('/render/metadata/maps-test.json', p), path.join(REPO_ROOT, 'render', 'metadata', 'maps-test.json'));
  assert.equal(localPathForUrl('https://example.org/x.json', p), null);
  assert.equal(recordPath('data/graph/manifest.json', p), path.join(p.GRAPH_DIR, 'manifest.json'));
});

test('paths.py agrees with paths.mjs, with and without the variable', (t) => {
  const probe = spawnSync('python', ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) return t.skip('python is not available');
  for (const env of [{}, { CIVGRAPH_BUILD_DIR: 'tmp/records' }]) {
    const py = spawnSync('python', ['-c', [
      'import runpy, json, os',
      `p = runpy.run_path(${JSON.stringify(path.join(REPO_ROOT, 'scripts', 'records', 'paths.py'))})`,
      `print(json.dumps({k: p[k] for k in ${JSON.stringify(Object.keys(LEGACY))}}))`,
    ].join('\n')], { encoding: 'utf8', env: { ...process.env, CIVGRAPH_BUILD_DIR: env.CIVGRAPH_BUILD_DIR || '' } });
    assert.equal(py.status, 0, py.stderr);
    const fromPy = JSON.parse(py.stdout);
    const fromJs = recordPaths(env);
    for (const name of Object.keys(LEGACY)) {
      assert.equal(path.normalize(fromPy[name]).toLowerCase(), path.normalize(fromJs[name]).toLowerCase(), `${name} ${JSON.stringify(env)}`);
    }
  }
});
