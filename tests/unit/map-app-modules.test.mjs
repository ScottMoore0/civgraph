// The map app's method modules (packages/map/src/app/*, frontend-plan.md 5.2) and installMethods.
//
// packages/map/app/app.js keeps the state and start-up of Test2App; its other methods are written in
// classes under packages/map/src/app/ and installed on Test2App.prototype. These tests hold that wiring:
// every method class is installed, no method is defined twice, and installMethods copies methods
// as a class body would define them.
//
//   node --test tests/unit/map-app-modules.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installMethods } from '../../packages/map/src/app/install-methods.mjs';
import { mapAppSourceFiles } from '../../scripts/lib/map-app-source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const espree = require('espree');

function parse(file) {
  return espree.parse(readFileSync(path.join(ROOT, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
}

function classMethods(classNode) {
  return classNode.body.body.filter((m) => m.type === 'MethodDefinition').map((m) => m.key.name);
}

test('installMethods copies methods non-enumerable, with `this` the target instance', () => {
  class Target {
    constructor() { this.n = 2; }
    own() { return 'own'; }
  }
  class Extra {
    double() { return this.n * 2; }
    async later() { return this.own(); }
  }
  assert.equal(installMethods(Target, [Extra]), Target);
  const t = new Target();
  assert.equal(t.double(), 4);
  assert.deepEqual(Object.keys(Target.prototype), []);
  const descriptor = Object.getOwnPropertyDescriptor(Target.prototype, 'double');
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  assert.equal(Target.prototype.constructor, Target);
  return t.later().then((value) => assert.equal(value, 'own'));
});

test('installMethods refuses a name defined twice', () => {
  class Target { a() {} }
  class One { b() {} }
  class Two { b() {} }
  class Clash { a() {} }
  assert.throws(() => installMethods(Target, [Clash]), /Target\.a is defined twice/);
  assert.throws(() => installMethods(class T {}, [One, Two]), /\.b is defined twice \(again in Two\)/);
});

test('every method class under packages/map/src/app is installed on Test2App, and no method is defined twice', () => {
  const files = mapAppSourceFiles(ROOT);
  assert.equal(files[0], 'packages/map/app/app.js');
  const app = parse('packages/map/app/app.js');
  const appClass = app.body.find((n) => n.type === 'ClassDeclaration' && n.id.name === 'Test2App');
  assert.ok(appClass, 'app.js declares Test2App');
  const install = app.body.find((n) => n.type === 'ExpressionStatement' && n.expression.callee?.name === 'installMethods');
  assert.ok(install, 'app.js calls installMethods');
  const installed = install.expression.arguments[1].elements.map((e) => e.name);

  const seen = new Map(classMethods(appClass).map((name) => [name, 'Test2App']));
  const exported = [];
  for (const file of files.slice(1)) {
    for (const node of parse(file).body) {
      const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : null;
      if (decl?.type !== 'ClassDeclaration' || !/Methods$/.test(decl.id.name)) continue;
      exported.push(decl.id.name);
      for (const name of classMethods(decl)) {
        assert.notEqual(name, 'constructor', `${decl.id.name} must not have a constructor`);
        assert.ok(!seen.has(name), `${name} is defined in ${seen.get(name)} and ${decl.id.name}`);
        seen.set(name, decl.id.name);
      }
    }
  }
  assert.deepEqual([...installed].sort(), [...exported].sort());
  // The split moved 187 methods; this changes only when a method is added or removed.
  assert.ok(seen.size >= 180, `expected the app's methods, found ${seen.size}`);
});
