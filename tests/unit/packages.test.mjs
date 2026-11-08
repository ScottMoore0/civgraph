// The workspace packages (REFACTOR-PLAN.md item 1, packages/README.md): each is a private ES
// module package named after its folder, the README lists it, and nothing imports one by its
// @civgraph name. Worktrees junction node_modules to the main checkout's, whose workspace links
// point at the main checkout's packages/, so a name would run that copy (and REPO_ROOT would be
// that checkout); relative paths stay inside the checkout they are in.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT } from '../../packages/config/src/node.mjs';

const PACKAGES = path.join(REPO_ROOT, 'packages');
const names = readdirSync(PACKAGES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();

test('every package is a private ES module package named after its folder, with exports and a README row', () => {
  const readme = readFileSync(path.join(PACKAGES, 'README.md'), 'utf8');
  assert.ok(names.length > 0);
  for (const name of names) {
    const file = path.join(PACKAGES, name, 'package.json');
    assert.ok(existsSync(file), `${name}: no package.json`);
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(pkg.name, `@civgraph/${name}`);
    assert.equal(pkg.private, true, `${name}: not private`);
    assert.equal(pkg.type, 'module', `${name}: not type module`);
    assert.ok(pkg.exports && typeof pkg.exports === 'object', `${name}: no exports`);
    assert.ok(readme.includes(`\`@civgraph/${name}\``), `${name}: not in packages/README.md`);
  }
  assert.deepEqual(JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).workspaces, ['packages/*']);
});

test('no module imports a package by its @civgraph name', () => {
  const files = execFileSync('git', ['ls-files', '-z', '*.js', '*.mjs', '*.cjs'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\0').filter(Boolean);
  const found = [];
  for (const rel of files) {
    const abs = path.join(REPO_ROOT, rel);
    if (!existsSync(abs)) continue;
    const src = readFileSync(abs, 'utf8');
    if (/(?:from|import)\s*\(?\s*['"]@civgraph\//.test(src)) found.push(rel);
  }
  assert.deepEqual(found, []);
});
