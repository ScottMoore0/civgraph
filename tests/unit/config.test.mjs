/**
 * The config module (functions/_lib/config.js, scripts/lib/config.mjs) agrees with every copy of
 * the facts it is to replace, so switching a caller over to it changes nothing:
 * - recordPaths() equals scripts/records/paths.mjs for each CIVGRAPH_BUILD_DIR spelling;
 * - the site origin and name equal the shell's, the records cache policy equals _records.js's;
 * - the bindings equal wrangler.toml's, per environment, both ways;
 * - every env.X a Function reads is a binding or variable the config knows.
 * And it never prints a secret.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import * as runtime from '../../packages/config/src/config.js';
import * as config from '../../packages/config/src/node.mjs';
import { recordPaths as legacyRecordPaths } from '../../packages/loader/src/paths.mjs';
import { SITE_NAME, SITE_ORIGIN } from '../../functions/_templates/shell.js';

const ROOT = config.REPO_ROOT;
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

test('the build half re-exports the runtime half', () => {
  assert.equal(config.SITE, runtime.SITE);
  assert.equal(config.BINDINGS, runtime.BINDINGS);
  assert.equal(config.API, runtime.API);
});

test('recordPaths() equals scripts/records/paths.mjs for every build-dir spelling', () => {
  for (const env of [{}, { CIVGRAPH_BUILD_DIR: '' }, { CIVGRAPH_BUILD_DIR: 'tmp/other' }, { CIVGRAPH_BUILD_DIR: 'legacy' }, { CIVGRAPH_BUILD_DIR: path.join(ROOT, 'tmp', 'abs') }]) {
    assert.deepEqual(config.recordPaths(env), legacyRecordPaths(env), JSON.stringify(env));
  }
});

test('the site identity equals the shell\'s, and the User-Agent names no person', () => {
  assert.equal(runtime.SITE.origin, SITE_ORIGIN);
  assert.equal(runtime.SITE.name, SITE_NAME);
  assert.ok(!runtime.SITE.userAgent.includes('@'), 'the User-Agent must not carry an email address');
  assert.ok(runtime.SITE.userAgent.includes(runtime.SITE.origin));
});

test('the records wrapper writes its cache policies from the config', () => {
  const records = read('packages/api/src/handlers/_records.js');
  assert.match(records, /import \{[^}]*\bCACHE\b[^}]*\} from '(?:\.\.\/)+config\/src\/config\.js'/);
  for (const name of ['records', 'loading', 'lastGood', 'error']) {
    assert.ok(records.includes(`CACHE.${name}`), `_records.js no longer writes CACHE.${name}`);
  }
  for (const policy of [runtime.CACHE.records, runtime.CACHE.lastGood]) {
    assert.ok(!records.includes(`'${policy}'`), `_records.js writes ${policy} out again instead of CACHE`);
  }
});

/** wrangler.toml's bindings per environment: { production: Map(name -> kind), preview: ... }. */
function wranglerBindings() {
  const text = read('wrangler.toml').replace(/#.*$/gm, '');
  const out = { production: new Map(), preview: new Map() };
  const kinds = { d1_databases: 'd1', kv_namespaces: 'kv', r2_buckets: 'r2' };
  let current = null;
  for (const line of text.split('\n')) {
    const table = line.match(/^\s*\[\[(env\.preview\.)?(d1_databases|kv_namespaces|r2_buckets)\]\]/);
    if (table) { current = { env: table[1] ? 'preview' : 'production', kind: kinds[table[2]] }; continue; }
    if (/^\s*\[/.test(line)) { current = null; continue; }
    const b = line.match(/^\s*binding\s*=\s*"([^"]+)"/);
    if (b && current) out[current.env].set(b[1], current.kind);
  }
  return out;
}

test('the bindings equal wrangler.toml\'s, per environment, in both directions', () => {
  const declared = wranglerBindings();
  assert.ok(declared.production.size > 0, 'parsed no bindings from wrangler.toml');
  for (const envName of ['production', 'preview']) {
    for (const [name, kind] of declared[envName]) {
      const spec = runtime.BINDINGS[name];
      assert.ok(spec, `${name} (wrangler.toml, ${envName}) is missing from functions/_lib/config.js BINDINGS`);
      assert.equal(spec.kind, kind, `${name}: kind`);
      assert.ok(spec.environments.includes(envName), `${name}: wrangler.toml binds it in ${envName}`);
    }
    for (const [name, spec] of Object.entries(runtime.BINDINGS)) {
      if (spec.builtin || !spec.environments.includes(envName)) continue;
      if (!declared[envName].has(name)) {
        assert.ok(spec.retiring, `${name} is configured for ${envName} but wrangler.toml does not bind it (mark it retiring, or drop the environment)`);
      }
    }
  }
});

function functionFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...functionFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

test('every env.X a Function reads is a binding or variable the config knows', () => {
  const unknown = new Set();
  for (const file of [...functionFiles(path.join(ROOT, 'functions')), ...functionFiles(path.join(ROOT, 'packages', 'api', 'src'))]) {
    const text = readFileSync(file, 'utf8');
    // env.X, and binding(env, 'X') since the Functions read bindings through config.binding()
    for (const m of text.matchAll(/\benv\??\.([A-Z][A-Z0-9_]{2,})\b|\bbinding\([^,()]+,\s*'([A-Z][A-Z0-9_]{2,})'\)/g)) {
      const name = m[1] || m[2];
      if (!Object.hasOwn(runtime.BINDINGS, name) && !Object.hasOwn(runtime.RUNTIME_VARS, name)) unknown.add(`${name} (${path.relative(ROOT, file)})`);
    }
  }
  assert.deepEqual([...unknown], [], 'add these to BINDINGS or RUNTIME_VARS in functions/_lib/config.js');
});

test('binding() and runtimeVar() refuse a name the config does not know', () => {
  const env = { ELECTIONS_DB: { prepare() {} }, CIVGRAPH_SSR_RECORDS: ' persons ' };
  assert.equal(runtime.binding(env, 'ELECTIONS_DB'), env.ELECTIONS_DB);
  assert.equal(runtime.binding(env, 'PRONI_DB'), null);
  assert.throws(() => runtime.binding(env, 'ELECTION_DB'), /unknown binding/);
  assert.equal(runtime.runtimeVar(env, 'CIVGRAPH_SSR_RECORDS'), 'persons');
  assert.throws(() => runtime.runtimeVar(env, 'CIVGRAPH_SSR'), /unknown variable/);
});

test('environmentFor() tells production, preview and local apart by host', () => {
  assert.equal(runtime.environmentFor('https://civgraph.net/_api/stats'), 'production');
  assert.equal(runtime.environmentFor('https://abc123.civgraph.pages.dev/'), 'preview');
  assert.equal(runtime.environmentFor('http://localhost:8788/api/v1/'), 'local');
  assert.equal(runtime.environmentFor('http://127.0.0.1:5050/'), 'local');
  assert.equal(runtime.environmentFor('https://example.org/'), 'unknown');
  assert.equal(runtime.environmentFor('not a url'), 'unknown');
});

test('loadConfig() resolves from the environment it is given, with defaults', () => {
  const c = config.loadConfig({ CIVGRAPH_VOTES_DIR: 'D:/votes', CIVGRAPH_SITE_URL: 'http://localhost:8788/' });
  assert.equal(c.votesDir, path.resolve('D:/votes'));
  assert.equal(c.verifySite, 'http://localhost:8788');
  assert.equal(c.recordsDb, path.join(ROOT, 'tmp', 'records', 'civgraph-records.sqlite'));
  assert.equal(c.gazetteDir, null);
  assert.equal(c.api.prefix, '/api/v1');
  assert.equal(c.paths.migrations, path.join(ROOT, 'packages', 'schema', 'migrations'));
  const d = config.loadConfig({});
  assert.equal(d.verifySite, 'https://civgraph.net');
});

test('describeEnv() reports a secret as set, never its value', () => {
  const rows = config.describeEnv({ R2_SECRET_ACCESS_KEY: 'do-not-print', CIVGRAPH_ADMINS: 'someone', CIVGRAPH_VOTES_DIR: 'D:/votes' });
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName.R2_SECRET_ACCESS_KEY.value, '(set)');
  assert.equal(byName.CIVGRAPH_ADMINS.value, '(set)');
  assert.equal(byName.CIVGRAPH_VOTES_DIR.value, 'D:/votes');
  assert.ok(!JSON.stringify(rows).includes('do-not-print'));
  assert.ok(runtime.SECRETS.includes('CIVGRAPH_ADMINS'));
});
