// `config --check` (packages/config/src/check.mjs, CFG-5): the preflight of the configuration and
// the environment, which must pass on the repository as it is, catch each problem it names, and
// never print a secret's value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { envFileNames, formatFindings, preflight, readWrangler, satisfiesMinimum, PURPOSES } from '../../packages/config/src/check.mjs';
import { BINDINGS, REPO_PATHS, REPO_ROOT } from '../../packages/config/src/node.mjs';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'civgraph-config-check-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const byId = (findings, id) => findings.filter((f) => f.id === id);
const levelOf = (findings, id) => byId(findings, id).map((f) => f.level);
const clean = { CIVGRAPH_SITE_URL: '' };
const wranglerText = () => readFileSync(path.join(REPO_ROOT, 'wrangler.toml'), 'utf8');

/** The repository's configuration files in a temporary root, with changes. */
function fakeRoot(name, { wrangler, envLocal } = {}) {
  const root = path.join(tmp, name);
  mkdirSync(root, { recursive: true });
  copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(root, 'package.json'));
  writeFileSync(path.join(root, 'wrangler.toml'), wrangler ?? wranglerText());
  for (const rel of Object.values(REPO_PATHS)) {
    if (rel === REPO_PATHS.envFile || rel === REPO_PATHS.wranglerToml || rel === 'package.json') continue;
    const target = path.join(root, rel);
    if (/\.(json|toml)$/.test(rel)) { mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, '{}'); } else mkdirSync(target, { recursive: true });
  }
  if (envLocal !== undefined) writeFileSync(path.join(root, '.env.local'), envLocal);
  return root;
}

test('the repository passes the preflight for CI (no secrets, no local builds needed)', () => {
  const findings = preflight({ env: clean, gitIgnored: () => true });
  assert.deepEqual(findings.filter((f) => f.level === 'fail'), []);
  for (const id of ['node', 'bindings', 'wrangler-vars', 'compatibility-date', 'repo-paths', 'site-url']) assert.deepEqual(levelOf(findings, id), ['ok'], id);
});

test('readWrangler reads every binding config.js lists for production and preview', () => {
  const w = readWrangler(wranglerText());
  for (const [name, spec] of Object.entries(BINDINGS)) {
    if (spec.builtin) continue;
    for (const envName of ['production', 'preview']) assert.equal(w.bindings[envName].has(name), spec.environments.includes(envName), `${name} ${envName}`);
  }
  assert.equal(w.compatibilityDates.production, w.compatibilityDates.preview);
});

test('a binding missing from wrangler.toml, or one config.js does not know, fails', () => {
  const text = wranglerText().replace('binding = "SPATIAL_INDEX"', 'binding = "SPATIAL_INDEX_TYPO"');
  const findings = preflight({ root: fakeRoot('bindings', { wrangler: text }), env: clean });
  const messages = byId(findings, 'bindings').filter((f) => f.level === 'fail').map((f) => f.message).join('\n');
  assert.match(messages, /SPATIAL_INDEX_TYPO: wrangler.toml binds it/);
  assert.match(messages, /SPATIAL_INDEX: config.js expects it in production/);
});

test('a secret or dev-only variable in wrangler.toml [vars] fails; differing compatibility dates warn', () => {
  const text = `${wranglerText()}\n[vars]\nCIVGRAPH_ADMINS = "someone"\nCIVGRAPH_SSR_RECORDS = "persons"\n\n[env.preview.vars]\nCIVGRAPH_ALLOW_DEV_AUTH = "true"\n`
    .replace(/(\[env\.preview\]\r?\ncompatibility_date = )"[^"]+"/, '$1"2020-01-01"');
  const findings = preflight({ root: fakeRoot('vars', { wrangler: text }), env: clean });
  const vars = byId(findings, 'wrangler-vars').map((f) => `${f.level} ${f.message}`);
  assert.equal(vars.length, 2, vars.join('\n'));
  assert.ok(vars.every((f) => f.startsWith('fail')));
  assert.ok(!vars.join('\n').includes('someone'), 'the value is never printed');
  assert.deepEqual(levelOf(findings, 'compatibility-date'), ['warn']);
});

test('an unknown CIVGRAPH_* variable warns; a non-https site URL fails; a dangling path warns', () => {
  const findings = preflight({ env: { CIVGRAPH_BUIDL_DIR: 'x', CIVGRAPH_SITE_URL: 'http://civgraph.net', CIVGRAPH_VOTES_DIR: 'no/such/folder' }, gitIgnored: () => true });
  assert.match(byId(findings, 'env-names')[0].message, /CIVGRAPH_BUIDL_DIR/);
  assert.deepEqual(levelOf(findings, 'env-names'), ['warn']);
  assert.deepEqual(levelOf(findings, 'site-url'), ['fail']);
  assert.deepEqual(levelOf(findings, 'env-paths'), ['warn']);
});

test('.env.local must be ignored by git; its names count as set, its values are never read out', () => {
  const secret = 'v3ry-s3cret-value';
  const envLocal = `# comment\nR2_ACCOUNT_ID=${secret}\nR2_ACCESS_KEY_ID = ${secret}\nexport R2_SECRET_ACCESS_KEY=${secret}\nEMPTY=\n`;
  assert.deepEqual(envFileNames(envLocal), ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']);
  const root = fakeRoot('envfile', { envLocal });
  assert.deepEqual(levelOf(preflight({ root, env: clean, gitIgnored: () => false }), 'env-file'), ['fail']);
  const upload = preflight({ root, env: { ...clean, CLOUDFLARE_API_TOKEN: secret, CIVGRAPH_ADMINS: secret }, purpose: 'upload', gitIgnored: () => true });
  assert.deepEqual(levelOf(upload, 'r2-keys'), ['ok']);
  assert.deepEqual(levelOf(upload, 'env-file'), ['ok']);
  assert.ok(!formatFindings(upload).includes(secret) && !JSON.stringify(upload).includes(secret));
});

test('each purpose adds its own requirements, and the default needs no secrets', () => {
  assert.deepEqual(PURPOSES, ['check', 'records', 'deploy', 'upload', 'publish']);
  const root = fakeRoot('purposes');
  assert.deepEqual(levelOf(preflight({ root, env: clean, purpose: 'upload' }), 'r2-keys'), ['fail']);
  const deploy = preflight({ root, env: { ...clean, CIVGRAPH_TEST_TRUST_EMAIL_HEADER: 'true' }, purpose: 'deploy' });
  assert.deepEqual(levelOf(deploy, 'dev-auth'), ['fail']);
  assert.deepEqual(levelOf(deploy, 'cloudflare-token'), ['warn']);
  assert.deepEqual(levelOf(preflight({ root, env: { ...clean, CIVGRAPH_RECORDS_DB: 'none.sqlite' }, purpose: 'records' }), 'records-db'), ['warn']);
  const publish = preflight({ root, env: { ...clean, CIVGRAPH_RECORDS_DB: 'none.sqlite' }, purpose: 'publish' });
  assert.deepEqual(levelOf(publish, 'records-db'), ['fail']);
  assert.ok(byId(publish, 'r2-keys').length && byId(publish, 'dev-auth').length);
  const plain = preflight({ root, env: clean });
  assert.equal(byId(plain, 'r2-keys').length + byId(plain, 'cloudflare-token').length + byId(plain, 'records-db').length, 0);
  assert.throws(() => preflight({ root, env: clean, purpose: /** @type {any} */ ('nonsense') }), /unknown purpose/);
});

test('Node versions against engines ranges', () => {
  assert.equal(satisfiesMinimum('v24.11.0', '>=24'), true);
  assert.equal(satisfiesMinimum('v22.5.1', '>=24'), false);
  assert.equal(satisfiesMinimum('v24.0.0', '>=24.1'), false);
  assert.equal(satisfiesMinimum('v24.1.0', '>= 24.1.0'), true);
  assert.equal(satisfiesMinimum('v20.0.0', '^24'), true, 'a range form it does not read is not failed');
});

test('the command line: config:check and node.mjs --check exit 0 here; a bad purpose exits 2; it is a step of npm run check', () => {
  const run = (...args) => spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, CIVGRAPH_SITE_URL: '' } });
  const direct = run('packages/config/src/check.mjs');
  assert.equal(direct.status, 0, direct.stdout + direct.stderr);
  assert.match(direct.stdout, /^PASS: config --check/m);
  const viaNode = run('packages/config/src/node.mjs', '--check', '--json');
  assert.equal(viaNode.status, 0, viaNode.stderr);
  assert.equal(JSON.parse(viaNode.stdout).purpose, 'check');
  assert.equal(run('packages/config/src/check.mjs', '--for', 'nonsense').status, 2);
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['config:check'], 'node packages/config/src/check.mjs');
  assert.ok(pkg.scripts.check.split('&&').map((s) => s.trim()).includes('npm run config:check'), 'config:check is a step of npm run check (and so check:fast and CI)');
});
