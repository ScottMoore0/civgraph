// Offline replays (packages/intake/src/plugins.mjs offlineEnv, `intake parity --offline`): a
// network step runs with the network closed to it, so it replays from its own cache or fails,
// and parity can prove it byte for byte without reaching a live source. Nothing here makes a
// request: the guards refuse before any connection or name lookup, and the hosts are .invalid.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pluginMain } from '../../packages/intake/src/plugin-cli.mjs';
import { frozenClockEnv, offlineEnv } from '../../packages/intake/src/plugins.mjs';
import { tempDir, writeFile } from './helpers.mjs';

const REPO = path.resolve('.');
const hasPython = spawnSync('python', ['--version']).status === 0;

const run = (exe, args, env) => spawnSync(exe, args, { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 });

test('offline, a Node step cannot fetch, connect or look a name up', () => {
  const env = offlineEnv();
  for (const code of [
    "await fetch('https://example.invalid/x')",
    "const h = await import('node:https'); h.get('https://example.invalid/x')",
    "const { request } = await import('node:http'); request('http://example.invalid/x')",
    "const n = await import('node:net'); n.connect(80, 'example.invalid')",
    "const d = await import('node:dns'); d.lookup('example.invalid', () => {})",
  ]) {
    const r = run(process.execPath, ['--input-type=module', '-e', code], env);
    assert.notEqual(r.status, 0, code);
    assert.match(r.stderr, /INTAKE_OFFLINE/, code);
  }
  // A Node process the step starts inherits NODE_OPTIONS, and so the guard.
  const child = "const { spawnSync } = await import('node:child_process'); const r = spawnSync(process.execPath, ['--input-type=module', '-e', \"await fetch('https://example.invalid/')\"], { encoding: 'utf8' }); process.stdout.write(r.stderr); process.exit(r.status);";
  const r = run(process.execPath, ['--input-type=module', '-e', child], env);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /INTAKE_OFFLINE/);
  // Without --offline nothing is loaded: the frozen clock alone leaves fetch alone.
  const clockOnly = run(process.execPath, ['--input-type=module', '-e', "process.stdout.write(String(typeof fetch === 'function' && !String(fetch).includes('INTAKE_OFFLINE')))"], frozenClockEnv());
  assert.equal(clockOnly.stdout, 'true');
});

test('offline, a Python step cannot open a socket or resolve a name', { skip: !hasPython && 'python is not installed' }, () => {
  const env = offlineEnv(frozenClockEnv());
  for (const code of [
    "import urllib.request; urllib.request.urlopen('http://example.invalid/')",
    "import socket; socket.create_connection(('example.invalid', 80))",
    "import socket; socket.getaddrinfo('example.invalid', 80)",
  ]) {
    const r = run('python', ['-c', code], env);
    assert.notEqual(r.status, 0, code);
    assert.match(r.stderr, /INTAKE_OFFLINE/, code);
  }
  // The frozen clock still holds alongside.
  const t = run('python', ['-c', 'import time; print(time.time())'], env);
  assert.equal(Number(t.stdout.trim()), Date.parse('2026-01-01T00:00:00.000Z') / 1000);
  // Without INTAKE_OFFLINE the sockets are untouched.
  const free = run('python', ['-c', 'import socket; print(socket.create_connection.__name__)'], frozenClockEnv());
  assert.equal(free.stdout.trim(), 'create_connection');
});

const git = (repo, ...args) => {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

/**
 * A throwaway repository holding the logainm plugin, its script and what they import, with a
 * small cache: a crosswalk naming `ids` and an API answer cached for each id in `cached`. The
 * place names are made up.
 */
function logainmRepo({ ids, cached }) {
  const repo = tempDir('logainm');
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'config', 'core.autocrlf', 'false');
  for (const rel of ['scripts/i18n/fetch-logainm.mjs', 'scripts/ingest/logainm/plugin.mjs', 'packages/config/src/node.mjs', 'packages/config/src/config.js', 'packages/intake/src']) {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    cpSync(path.join(REPO, rel), path.join(repo, rel), { recursive: true });
  }
  writeFile(repo, '.gitignore', 'tmp/\n');
  writeFile(repo, 'data/database/r2-publication-allowlist.json', { schemaVersion: 1, prefixes: [] });
  writeFile(repo, 'tmp/i18n-cache/place-name-crosswalk.tsv', ['layer\tfeature\tenglish\tirish\tlogainm', ...ids.map((id, i) => `test-layer\tf${i}\tTesttown ${i}\t\t${id}`)].join('\n') + '\n');
  for (const id of cached) {
    writeFile(repo, `tmp/i18n-cache/logainm-cache/${id}.json`, JSON.stringify({
      placenames: [{ language: 'ga', wording: `Baile Tástála ${id}` }, { language: 'en', wording: `Testtown ${id}` }],
      category: { nameEN: 'Townland' }, modifiedDate: '2020-01-01T00:00:00',
    }));
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  return repo;
}

const quiet = () => {
  const lines = [];
  return { lines, io: { log: (s) => lines.push(s), err: (s) => lines.push(s), stdio: 'pipe' } };
};

/** Run with LOGAINM_API_KEY set to a dummy (the script stops before its loop without one). */
async function withKey(fn) {
  const before = process.env.LOGAINM_API_KEY;
  process.env.LOGAINM_API_KEY = 'offline-replay-no-key';
  try { return await fn(); } finally {
    if (before === undefined) delete process.env.LOGAINM_API_KEY;
    else process.env.LOGAINM_API_KEY = before;
  }
}

test('a network step replays offline from its cache: logainm names, old command line and plugin byte for byte', async () => {
  const repo = logainmRepo({ ids: ['101', '202', '303'], cached: ['101', '202', '303'] });
  const { lines, io } = quiet();
  const code = await withKey(() => pluginMain(['parity', 'logainm', '--step', 'names', '--offline', '--repo', repo, '--scratch', tempDir('scratch')], io));
  assert.equal(code, 0, lines.join('\n'));
  assert.ok(lines.some((l) => /^PARITY: logainm names: 1 identical output\(s\), 0 differing/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /same tmp\/i18n-cache\/logainm-names\.tsv/.test(l)));
  assert.equal(git(repo, 'status', '--porcelain'), '', 'the repository is as it was');
});

test('offline, a network step that would have to fetch fails instead', async () => {
  const repo = logainmRepo({ ids: ['101', '404'], cached: ['101'] });
  const { lines, io } = quiet();
  const code = await withKey(() => pluginMain(['parity', 'logainm', '--step', 'names', '--offline', '--repo', repo, '--scratch', tempDir('scratch')], io));
  assert.notEqual(code, 0);
  assert.ok(lines.some((l) => /logainm\/names exited/.test(l)), lines.join('\n'));
});

test('without --offline, parity refuses a network step', async () => {
  const repo = logainmRepo({ ids: ['101'], cached: ['101'] });
  const { lines, io } = quiet();
  assert.equal(await pluginMain(['parity', 'logainm', '--step', 'names', '--repo', repo], io), 1);
  assert.ok(lines.some((l) => /only with --allow-network/.test(l)), lines.join('\n'));
});
