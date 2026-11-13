// A plugin's Python step runs isolated (packages/intake/src/plugins.mjs spawnArgv, through
// frozen-clock/run_isolated.py): `python -I`, so neither the working folder nor PYTHONPATH can
// put a module in front of the standard library, while the script keeps its own folder, the
// user's site-packages, PYTHONDONTWRITEBYTECODE, the frozen clock and the offline guard.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { frozenClockEnv, offlineEnv, pythonIsolatedArgs, spawnArgv } from '../../packages/intake/src/plugins.mjs';
import { tempDir, writeFile } from './helpers.mjs';

const hasPython = spawnSync('python', ['--version']).status === 0;

test('a script runs as `python -I run_isolated.py <script> ...`; flags pass through after -I', () => {
  const args = pythonIsolatedArgs(['scripts/ingest/x/y.py', '--out', 'z']);
  assert.equal(args[0], '-I');
  assert.equal(path.basename(args[1] ?? ''), 'run_isolated.py');
  assert.deepEqual(args.slice(2), ['scripts/ingest/x/y.py', '--out', 'z']);
  assert.deepEqual(pythonIsolatedArgs(['-c', 'print(1)']), ['-I', '-c', 'print(1)']);
  assert.deepEqual(pythonIsolatedArgs([]), ['-I']);
});

test('the step is isolated but keeps its folder, its arguments and the user packages', { skip: !hasPython && 'python is not installed' }, () => {
  const dir = tempDir('pyiso');
  const cwd = tempDir('pyiso-cwd');
  // A module planted in the working folder and one on PYTHONPATH must not load.
  writeFile(cwd, 'planted.py', 'raise SystemExit("planted module loaded")\n');
  const pathDir = tempDir('pyiso-path');
  writeFile(pathDir, 'planted2.py', 'raise SystemExit("PYTHONPATH module loaded")\n');
  writeFile(dir, 'sibling.py', 'X = 42\n');
  writeFile(dir, 'probe.py', [
    'import json, os, site, sys, time',
    'import sibling',
    'def loads(name):',
    '    try:',
    '        __import__(name)',
    '        return True',
    '    except ImportError:',
    '        return False',
    'user = site.getusersitepackages()',
    'print(json.dumps({"isolated": sys.flags.isolated, "argv": sys.argv[1:], "sibling": sibling.X, "main": __name__,',
    '  "planted": loads("planted"), "planted2": loads("planted2"), "nobytecode": sys.dont_write_bytecode,',
    '  "userSite": (user in sys.path) if os.path.isdir(user) else None, "time": time.time()}))',
    '',
  ].join('\n'));
  const script = path.join(dir, 'probe.py');
  /** @param {Record<string, string>} env */
  const probe = (env) => {
    const r = spawnArgv(['python', script, 'a b', '--flag'], { cwd, env: { PYTHONPATH: pathDir, PYTHONDONTWRITEBYTECODE: '1', ...env }, stdio: 'pipe' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const plain = probe({});
  assert.equal(plain.isolated, 1);
  assert.deepEqual(plain.argv, ['a b', '--flag']);
  assert.equal(plain.sibling, 42);
  assert.equal(plain.main, '__main__');
  assert.equal(plain.planted, false);
  assert.equal(plain.planted2, false);
  assert.equal(plain.nobytecode, true);
  assert.notEqual(plain.userSite, false);
  // The frozen clock still holds (it came through PYTHONPATH before, which -I ignores).
  const frozen = probe(frozenClockEnv());
  assert.equal(frozen.time, Date.parse('2026-01-01T00:00:00.000Z') / 1000);
  assert.equal(frozen.planted2, false);
});

test('offline, an isolated Python step still cannot open a socket', { skip: !hasPython && 'python is not installed' }, () => {
  const dir = tempDir('pyiso-offline');
  const script = writeFile(dir, 'net.py', "import socket\nsocket.getaddrinfo('example.invalid', 80)\n");
  const r = spawnArgv(['python', script], { cwd: dir, env: offlineEnv(frozenClockEnv()), stdio: 'pipe' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /INTAKE_OFFLINE/);
});
