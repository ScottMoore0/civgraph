// The workspace packages (REFACTOR-PLAN.md item 1, packages/README.md): each is a private ES
// module package named after its folder, the README lists it, and since rf-final (18 Nov 2026)
// code the site does not serve as a file imports another package by its @civgraph name
// (scripts/lib/package-names.mjs); served files keep relative imports. A worktree's workspace
// links point at its own packages/ (scripts/lib/node-modules-links.mjs).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT } from '@civgraph/config/node';
import { nameFor, readPackages, resolveExport, scan, servedNameImports } from '../../scripts/lib/package-names.mjs';

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

test('a module the site does not serve imports another package by its @civgraph name', () => {
  const left = scan();
  assert.deepEqual(left.filter((site) => site.name).map((site) => `${site.file}: ${site.spec} -> ${site.name}`), [],
    'run node scripts/lib/package-names.mjs --write');
  assert.deepEqual(left.filter((site) => !site.name).map((site) => `${site.file}: ${site.spec}`), [],
    'no export of the package reaches these: add one to its package.json');
});

test('a module the site serves as a file never imports by name (the browser resolves URLs only)', () => {
  assert.deepEqual(servedNameImports(), []);
});

test('every @civgraph name resolves to the file its relative path named (exports round trip)', () => {
  const packages = readPackages();
  const core = /** @type {import('../../scripts/lib/package-names.mjs').WorkspacePackage} */ (packages.get('core'));
  assert.equal(nameFor(core, 'src/html.js'), '@civgraph/core/html.js');
  const storage = /** @type {import('../../scripts/lib/package-names.mjs').WorkspacePackage} */ (packages.get('storage'));
  assert.equal(nameFor(storage, 'src/sqlite.mjs'), '@civgraph/storage/node');
  assert.equal(nameFor(storage, 'src/index.js'), '@civgraph/storage');
  const map = /** @type {import('../../scripts/lib/package-names.mjs').WorkspacePackage} */ (packages.get('map'));
  assert.equal(nameFor(map, 'src/app/helpers.mjs'), '@civgraph/map/src/app/helpers.mjs');
  assert.equal(nameFor(map, 'app/boot.js'), '@civgraph/map/app/boot.js');
  const types = /** @type {import('../../scripts/lib/package-names.mjs').WorkspacePackage} */ (packages.get('types'));
  assert.equal(nameFor(types, 'index.js'), '@civgraph/types');
  for (const pkg of packages.values()) {
    for (const [key] of pkg.entries.filter(([k]) => !k.includes('*'))) assert.notEqual(resolveExport(pkg.entries, key), null, `${pkg.name} ${key}`);
  }
});

test('the workspace links resolve each name to the packages of this checkout, not of another', async () => {
  for (const name of names) {
    const link = path.join(REPO_ROOT, 'node_modules', '@civgraph', name);
    if (!existsSync(link)) continue;
    assert.equal(realpathSync(link), realpathSync(path.join(PACKAGES, name)), `node_modules/@civgraph/${name} points elsewhere: npm run worktree:links`);
  }
  const { REPO_ROOT: viaName } = await import('@civgraph/config/node');
  assert.equal(realpathSync(viaName), realpathSync(REPO_ROOT));
});
