/**
 * The records loader and script libraries read the config module (REFACTOR-PLAN.md CFG-2, CFG-4):
 *
 * - scripts/records/paths.mjs re-exports the config's recordPaths, REPO_ROOT and DEFAULT_BUILD_DIR
 *   (the very functions, so they cannot drift), and its RECORDS_DB is the config's;
 * - the values that replaced literals are the literals they replaced (origins, User-Agent);
 * - buildVar() reads a listed variable, falls back to its default when unset or blank, and throws
 *   on a name BUILD_VARS does not list;
 * - no hard-coded origin, User-Agent or records database path is left in scripts/records or
 *   scripts/lib outside the config module and comments.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as config from '../../packages/config/src/node.mjs';
import * as paths from '../../packages/loader/src/paths.mjs';

test('paths.mjs re-exports the config module', () => {
  assert.equal(paths.recordPaths, config.recordPaths);
  assert.equal(paths.REPO_ROOT, config.REPO_ROOT);
  assert.equal(paths.DEFAULT_BUILD_DIR, config.DEFAULT_BUILD_DIR);
  assert.equal(paths.RECORDS_DB, config.recordPaths().RECORDS_DB);
  assert.equal(paths.buildDir({ CIVGRAPH_BUILD_DIR: 'legacy' }), null);
  assert.equal(paths.buildDir({}), path.join(config.REPO_ROOT, 'tmp', 'records'));
});

test('the config values equal the literals they replaced', () => {
  assert.equal(config.SITE.origin, 'https://civgraph.net');
  assert.equal(config.SITE.dataOrigin, 'https://data.civgraph.net');
  assert.equal(config.SITE.userAgent, 'civgraph-research (+https://civgraph.net)');
  assert.equal(config.recordPaths().RECORDS_DB, path.join(config.REPO_ROOT, 'tmp', 'records', 'civgraph-records.sqlite'));
});

test('buildVar: value, default, blank, unknown', () => {
  assert.equal(config.buildVar('CIVGRAPH_VOTES_DIR', {}), '');
  assert.equal(config.buildVar('CIVGRAPH_VOTES_DIR', { CIVGRAPH_VOTES_DIR: ' D:/votes ' }), 'D:/votes');
  assert.equal(config.buildVar('CIVGRAPH_BUILD_DIR', { CIVGRAPH_BUILD_DIR: '  ' }), 'tmp/records');
  assert.equal(config.buildVar('CIVGRAPH_WRANGLER_JS', { CIVGRAPH_WRANGLER_JS: 'w.js' }), 'w.js');
  assert.throws(() => config.buildVar('CIVGRAPH_NO_SUCH_VAR', {}), /unknown build variable/);
});

test('no hard-coded origin, User-Agent or database path in scripts/records and scripts/lib code', () => {
  const found = [];
  for (const dir of ['scripts/records', 'scripts/lib', 'scripts/lib/storage', 'packages/loader/src', 'packages/schema/src', 'packages/storage/src']) {
    for (const name of readdirSync(path.join(config.REPO_ROOT, dir))) {
      if (!name.endsWith('.mjs') || (dir === 'scripts/lib' && name === 'config.mjs')) continue;
      const lines = readFileSync(path.join(config.REPO_ROOT, dir, name), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const code = line.replace(/^\s*(\*|\/\/).*$/, '').replace(/\/\/ .*$/, '');
        if (/https:\/\/(data\.)?civgraph\.net|civgraph-research \(|'civgraph-records\.sqlite'|process\.env\.CIVGRAPH_/.test(code)) found.push(`${dir}/${name}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(found, []);
});
