// Ingest plugins (scripts/intake/lib/plugins.mjs): the acceptance test of refactor plan
// section 9: a new source is one plugin folder and nothing else. Everything runs in a
// throwaway git repository under the OS temp directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadBatch, validateBatch } from '../../scripts/intake/lib/batch.mjs';
import { pluginMain } from '../../scripts/intake/lib/plugin-cli.mjs';
import { definePlugin, discoverPlugins, loadPlugin, pluginProblems, resolveArgv, unaccountedFiles } from '../../scripts/intake/lib/plugins.mjs';
import { stageBatch } from '../../scripts/intake/lib/stage.mjs';
import { tempDir, writeFile } from './helpers.mjs';

const PLUGINS_URL = pathToFileURL(path.resolve('scripts/intake/lib/plugins.mjs')).href;
const hasPython = spawnSync('python', ['--version']).status === 0;

const git = (repo, ...args) => {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

const EMIT = `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const [redirected, label] = process.argv.slice(2);
mkdirSync('data/out', { recursive: true });
mkdirSync('data/maps', { recursive: true });
writeFileSync('data/out/records.json', JSON.stringify({ label, n: 2 }) + '\\n');
const doc = JSON.parse(readFileSync('data/existing.json', 'utf8'));
doc.count += 1;
writeFileSync('data/existing.json', JSON.stringify(doc) + '\\n');
writeFileSync('data/maps/layer.fgb', 'fgb bytes ' + label);
writeFileSync(redirected, 'redirected ' + label + '\\n');
`;

function pluginSource(body) {
  return `import { definePlugin } from '${PLUGINS_URL}';\nexport default definePlugin(${body});\n`;
}

const COMMON = `kinds: ['elections'], personalData: { contains: false, handling: 'none' },
  sources: [{ id: 'demo-source', title: 'Demo source', rights: 'OGL', licence: 'OGL v3' }]`;

function makePluginRepo() {
  const repo = tempDir('plugins');
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'config', 'core.autocrlf', 'false');
  writeFile(repo, '.gitignore', 'data/maps/\n');
  writeFile(repo, 'data/existing.json', '{"count":1}\n');
  writeFile(repo, 'data/database/r2-publication-allowlist.json', { schemaVersion: 1, prefixes: [{ prefix: 'data/maps/' }] });
  writeFile(repo, 'scripts/ingest/demo/emit.mjs', EMIT);
  writeFile(repo, 'scripts/ingest/demo/probe.mjs', '// a research probe\n');
  writeFile(repo, 'scripts/ingest/demo/plugin.mjs', pluginSource(`{ id: 'demo', title: 'Demo source records', ${COMMON},
  inputs: { label: { env: 'DEMO_LABEL', default: 'plain' } },
  steps: { emit: { title: 'Emit the records', argv: ['node', 'scripts/ingest/demo/emit.mjs', '{out:data/out/redirected.txt}', '{input:label}'], outputs: ['data/maps/'] } },
  research: ['probe.mjs'] }`));
  writeFile(repo, 'scripts/ingest/clock/tick.mjs', "import { writeFileSync } from 'node:fs';\nwriteFileSync('data/tick.txt', String(process.hrtime.bigint()));\n");
  writeFile(repo, 'scripts/ingest/clock/plugin.mjs', pluginSource(`{ id: 'clock', title: 'A non-deterministic source', ${COMMON},
  steps: { tick: { title: 'Write the time', argv: ['node', 'scripts/ingest/clock/tick.mjs'] },
           fetch: { title: 'Fetch from outside', argv: ['node', 'scripts/ingest/clock/tick.mjs'], network: true } } }`));
  writeFile(repo, 'scripts/ingest/pybridge/run.py', [
    'import json, sys',
    'ctx = json.load(sys.stdin)',
    "print(json.dumps({'staged': [{'path': 'data/bridge/' + ctx['plugin'] + '.json', 'content': json.dumps({'args': ctx['args']}) + '\\n'}], 'notes': ['from python']}))",
    '',
  ].join('\n'));
  writeFile(repo, 'scripts/ingest/pybridge/plugin.mjs', pluginSource(`{ id: 'pybridge', title: 'A Python bridge source', ${COMMON},
  command: ['python', 'scripts/ingest/pybridge/run.py'] }`));
  writeFile(repo, 'scripts/ingest/bare/legacy.py', 'print(1)\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  return repo;
}

const quiet = () => {
  const lines = [];
  return { lines, io: { log: (s) => lines.push(s), err: (s) => lines.push(s), stdio: 'pipe' } };
};

test('definePlugin lists every problem with a plugin', () => {
  assert.throws(() => definePlugin({ id: 'Bad Id', title: 'x' }), /id must be/);
  const p = pluginProblems({ id: 'ok', title: 'A title', kinds: ['nope'], personalData: { contains: true }, sources: [{ id: 's', title: 'S', rights: 'maybe' }], steps: { s1: { title: 't', argv: ['ruby', 'x.rb'] } }, produce: () => ({}) });
  assert.ok(p.some((m) => /unknown kind nope/.test(m)));
  assert.ok(p.some((m) => /handling must say/.test(m)));
  assert.ok(p.some((m) => /unknown rights maybe/.test(m)));
  assert.ok(p.some((m) => /exactly one of steps, produce, command/.test(m)));
  assert.ok(p.some((m) => /argv must be/.test(m)));
  assert.ok(pluginProblems({ id: 'ok', title: 'A title', kinds: ['maps'], personalData: { contains: false }, sources: [{ id: 's', title: 'S' }], steps: { a: { title: 't', argv: ['node', 'scripts/x.mjs', '{input:missing}'] } } }).some((m) => /undeclared input missing/.test(m)));
});

test('resolveArgv fills {repo}, {out:...} and {input:...}', () => {
  const step = { title: 't', argv: ['node', 'scripts/x.mjs', '--root', '{repo}', '--out', '{out:data/a.json}', '{input:y}'] };
  assert.deepEqual(resolveArgv(step, { repo: '/r', outRoot: '/b/staged', inputs: { y: '1999' }, args: ['--extra'] }),
    ['node', 'scripts/x.mjs', '--root', '/r', '--out', path.join('/b/staged', 'data/a.json').split(path.sep).join('/'), '1999', '--extra']);
  assert.throws(() => resolveArgv(step, { repo: '/r', outRoot: '/b', inputs: {} }), /input y is not set/);
});

test('discovery finds each plugin, names folders without one and checks every file is accounted for', async () => {
  const repo = makePluginRepo();
  const { plugins, without, errors } = await discoverPlugins(repo);
  assert.deepEqual(plugins.map((p) => p.id), ['clock', 'demo', 'pybridge']);
  assert.deepEqual(without, ['bare']);
  assert.deepEqual(errors, []);
  const demo = await loadPlugin(repo, 'demo');
  assert.deepEqual(unaccountedFiles(demo), []);
  writeFile(repo, 'scripts/ingest/demo/stray.py', '');
  assert.deepEqual(unaccountedFiles(demo), ['stray.py']);
  const { lines, io } = quiet();
  assert.equal(await pluginMain(['plugins', '--check', '--repo', repo], io), 1);
  assert.ok(lines.some((l) => /NOT ACCOUNTED FOR: stray\.py/.test(l)));
});

test('run captures what the old script wrote into a valid batch and leaves the repository as it was', async () => {
  const repo = makePluginRepo();
  const batchDir = path.join(tempDir('run'), '2026-11-07-demo');
  const { lines, io } = quiet();
  const code = await pluginMain(['run', 'demo', batchDir, '--repo', repo, '--input', 'label=one'], io);
  assert.equal(code, 0, lines.join('\n'));
  assert.equal(git(repo, 'status', '--porcelain'), '', 'the repository is clean again');
  assert.equal(existsSync(path.join(repo, 'data/maps/layer.fgb')), false, 'the gitignored output was put back too');
  const batch = loadBatch(batchDir, { repo });
  assert.equal(batch.manifest.status, 'draft');
  assert.deepEqual(batch.manifest.operations.map((o) => o.type), ['copy-files']);
  assert.deepEqual(batch.manifest.operations[0].files.map((f) => f.to), ['data/existing.json', 'data/maps/layer.fgb', 'data/out/records.json', 'data/out/redirected.txt']);
  assert.deepEqual(validateBatch(batch).errors, []);
  assert.equal(readFileSync(path.join(batchDir, 'staged/data/out/redirected.txt'), 'utf8'), 'redirected one\n');
  assert.ok(existsSync(path.join(batchDir, 'state/run.json')));
  // Applying the batch gives what running the script directly gives.
  const res = stageBatch(batch, { write: true });
  assert.deepEqual(res.errors, []);
  assert.equal(readFileSync(path.join(repo, 'data/existing.json'), 'utf8'), '{"count":2}\n');
  assert.equal(readFileSync(path.join(repo, 'data/maps/layer.fgb'), 'utf8'), 'fgb bytes one');
  // A second run into the same folder needs --replace.
  assert.equal(await pluginMain(['run', 'demo', batchDir, '--repo', repo], quiet().io), 1);
});

test('parity: old command lines and plugin + stage write the same bytes', async () => {
  const repo = makePluginRepo();
  const { lines, io } = quiet();
  const code = await pluginMain(['parity', 'demo', '--repo', repo, '--scratch', tempDir('scratch'), '--input', 'label=two'], io);
  assert.equal(code, 0, lines.join('\n'));
  assert.ok(lines.some((l) => /^PARITY: demo emit: 4 identical output\(s\), 0 differing/.test(l)), lines.join('\n'));
  assert.equal(git(repo, 'status', '--porcelain'), '');
});

test('parity catches a script whose output differs run to run', async () => {
  const repo = makePluginRepo();
  const { lines, io } = quiet();
  assert.equal(await pluginMain(['parity', 'clock', '--step', 'tick', '--repo', repo, '--scratch', tempDir('scratch')], io), 1);
  assert.ok(lines.some((l) => /^DIFFER data\/tick\.txt/.test(l)));
  assert.ok(lines.some((l) => /^NO PARITY/.test(l)));
});

test('a network step runs only with --allow-network, and several steps must be named', async () => {
  const repo = makePluginRepo();
  const dir = path.join(tempDir('net'), 'b1');
  let q = quiet();
  assert.equal(await pluginMain(['run', 'clock', dir, '--repo', repo, '--step', 'fetch'], q.io), 1);
  assert.ok(q.lines.some((l) => /only with --allow-network/.test(l)));
  q = quiet();
  assert.equal(await pluginMain(['run', 'clock', dir, '--repo', repo], q.io), 1);
  assert.ok(q.lines.some((l) => /name them with --step/.test(l)));
});

test('the Python bridge: context as JSON on stdin, result as JSON on stdout', { skip: !hasPython && 'python is not installed' }, async () => {
  const repo = makePluginRepo();
  const dir = path.join(tempDir('py'), '2026-11-07-py');
  const { lines, io } = quiet();
  assert.equal(await pluginMain(['run', 'pybridge', dir, '--repo', repo, '--', '--year', '1925'], io), 0, lines.join('\n'));
  const m = JSON.parse(readFileSync(path.join(dir, 'batch.json'), 'utf8'));
  assert.deepEqual(m.operations[0].files.map((f) => f.to), ['data/bridge/pybridge.json']);
  assert.deepEqual(m.notes, ['from python']);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'staged/data/bridge/pybridge.json'), 'utf8')), { args: ['--year', '1925'] });
});

test('mark moves the status one guarded step and keeps the lock', async () => {
  const repo = makePluginRepo();
  const dir = path.join(tempDir('mark'), '2026-11-07-mark');
  assert.equal(await pluginMain(['run', 'demo', dir, '--repo', repo], quiet().io), 0);
  let q = quiet();
  assert.equal(await pluginMain(['mark', dir, 'published', '--repo', repo], q.io), 1);
  assert.ok(q.lines.some((l) => /draft -> published is not allowed/.test(l)));
  // Lock, then mark: the lock is refreshed because only the status changed.
  const { main } = await import('../../scripts/intake/intake.mjs');
  assert.equal(main(['validate', dir, '--lock', '--repo', repo], { log: () => {} }), 0);
  assert.equal(await pluginMain(['mark', dir, 'staged', '--repo', repo], quiet().io), 0);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'batch.json'), 'utf8')).status, 'staged');
  assert.equal(main(['validate', dir, '--repo', repo], { log: () => {} }), 0, 'the lock still holds');
  q = quiet();
  assert.equal(await pluginMain(['mark', dir, 'committed', '--repo', repo], q.io), 1);
  assert.ok(q.lines.some((l) => /repo\.commits/.test(l)));
  // An edit after review blocks mark until it is re-locked.
  const m = JSON.parse(readFileSync(path.join(dir, 'batch.json'), 'utf8'));
  m.summary = 'changed';
  writeFileSync(path.join(dir, 'batch.json'), `${JSON.stringify(m, null, 2)}\n`);
  q = quiet();
  assert.equal(await pluginMain(['mark', dir, 'abandoned', '--repo', repo], q.io), 1);
  assert.ok(q.lines.some((l) => /changed since review/.test(l)));
  rmSync(dir, { recursive: true, force: true });
});
