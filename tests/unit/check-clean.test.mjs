/**
 * scripts/check-clean.mjs: the export holds what a commit would, and removing the export
 * never reaches the real node_modules through the link.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUILD_STEPS, exportTree, linkNodeModules, listExportFiles, parseArgs, unlinkNodeModules } from '../../scripts/check-clean.mjs';

function scratch() {
  return mkdtempSync(path.join(os.tmpdir(), 'check-clean-test-'));
}

test('unlinking node_modules leaves the target intact, so the export can be deleted', () => {
  const base = scratch();
  try {
    const realModules = path.join(base, 'real', 'node_modules');
    mkdirSync(path.join(realModules, 'pkg'), { recursive: true });
    writeFileSync(path.join(realModules, 'pkg', 'index.js'), 'module.exports = 1;\n');
    const dest = path.join(base, 'export');
    mkdirSync(dest);
    const link = linkNodeModules(realModules, dest);
    assert.ok(existsSync(path.join(link, 'pkg', 'index.js')), 'the link resolves');
    unlinkNodeModules(link);
    assert.ok(!existsSync(link), 'the link is gone');
    rmSync(dest, { recursive: true, force: true });
    assert.equal(readFileSync(path.join(realModules, 'pkg', 'index.js'), 'utf8'), 'module.exports = 1;\n', 'the real node_modules survives');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('unlinkNodeModules refuses a real directory', () => {
  const base = scratch();
  try {
    mkdirSync(path.join(base, 'node_modules'));
    assert.throws(() => unlinkNodeModules(path.join(base, 'node_modules')), /not a link/);
    assert.ok(existsSync(path.join(base, 'node_modules')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the export is tracked plus untracked-but-not-ignored files, without deleted or ignored ones', () => {
  const repo = scratch();
  try {
    const git = (...args) => assert.equal(spawnSync('git', args, { cwd: repo }).status, 0, `git ${args.join(' ')}`);
    git('init', '-q');
    writeFileSync(path.join(repo, '.gitignore'), 'ignored.txt\n');
    writeFileSync(path.join(repo, 'tracked.txt'), 't');
    writeFileSync(path.join(repo, 'gone.txt'), 'g');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'init');
    rmSync(path.join(repo, 'gone.txt'));
    writeFileSync(path.join(repo, 'new.txt'), 'n');
    writeFileSync(path.join(repo, 'ignored.txt'), 'i');
    mkdirSync(path.join(repo, 'sub'));
    writeFileSync(path.join(repo, 'sub', 'deep.txt'), 'd');
    const files = listExportFiles(repo).sort();
    assert.deepEqual(files, ['.gitignore', 'new.txt', 'sub/deep.txt', 'tracked.txt']);
    const dest = path.join(repo, '..', `${path.basename(repo)}-export`);
    exportTree(repo, dest, files);
    assert.equal(readFileSync(path.join(dest, 'sub', 'deep.txt'), 'utf8'), 'd');
    rmSync(dest, { recursive: true, force: true });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('arguments: --keep, --no-build and --in-place are ours; the rest go to run-checks', () => {
  assert.deepEqual(parseArgs(['--keep', '--only', 'check:dir-names', '--no-build']), { keep: true, build: false, inPlace: false, passthrough: ['--only', 'check:dir-names'] });
  assert.equal(parseArgs(['--in-place']).inPlace, true);
});

test('the builds start with the Pages build', () => {
  assert.deepEqual(BUILD_STEPS[0], ['npm', ['run', 'build']]);
});
