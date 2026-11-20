// The election manager's typed host (rf10-map-election, 13 Nov 2026).
// packages/map/src/election/election-manager.d.ts declares what the manager
// (packages/map/app/election-manager.js) uses of the map app (ElectionHost) and what its
// method module and the NI local view see of the manager. It is hand-written, so this test holds
// it to the code, as map-app-host.test.mjs does for MapApp: every host field is set in Test2App's
// constructor, every host method is the app's or a method module's, and every method of the
// manager's method module types its `this`. The four files stay in the map type check.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
/** The repository-relative files the map package project checks. */
function mapProjectFiles() {
  const abs = path.join(ROOT, 'packages', 'map', 'tsconfig.project.json');
  const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(abs, ts.sys.readFile).config, ts.sys, path.dirname(abs), undefined, abs);
  return new Set(parsed.fileNames.map((f) => path.relative(ROOT, path.resolve(f)).split(path.sep).join('/')));
}
const HOST = read('packages/map/src/election/election-manager.d.ts');
const APP = read('packages/map/app/app.js');

/** Every .js file under packages/map/src/app (the app's method modules and their helpers). */
function appModules() {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.js')) out.push(read(child));
    }
  };
  walk('packages/map/src/app');
  return out;
}

/** The members ElectionHost declares in its own body: { name, method, optional }. */
function hostMembers() {
  const body = /export interface ElectionHost extends Pick<MapApp,[\s\S]*?> \{([\s\S]*?)\n\}/.exec(HOST)?.[1];
  assert.ok(body, 'election-manager.d.ts has no interface ElectionHost');
  return [...body.matchAll(/^ {2}(\w+)(\?)?(<[^>]*>)?(\(|:)/gm)].map((m) => ({ name: m[1], optional: Boolean(m[2]), method: m[4] === '(' }));
}

const defines = (source, name) => new RegExp(`^ {2}(?:async )?${name}\\(`, 'm').test(source);
const assigns = (source, name) => new RegExp(`this\\.${name} = `).test(source);

test('every ElectionHost field is set in Test2App, and every method is the app\'s or a method module\'s', () => {
  const modules = appModules();
  const constructorBody = /constructor\([^)]*\) \{([\s\S]*?)\n {2}\}/.exec(APP)?.[1] || '';
  const members = hostMembers();
  assert.ok(members.length >= 15, `ElectionHost declares ${members.length} members`);
  for (const { name, method, optional } of members) {
    if (method) {
      assert.ok(defines(APP, name) || modules.some((source) => defines(source, name)), `ElectionHost.${name}() is defined nowhere`);
    } else if (optional) {
      // An optional field is set later, by the method module that makes it.
      assert.ok(assigns(APP, name) || modules.some((source) => assigns(source, name)), `ElectionHost.${name} is set nowhere`);
    } else {
      assert.ok(assigns(constructorBody, name), `ElectionHost.${name} is not set in Test2App's constructor`);
    }
  }
});

test('the manager is built with the app and its map adapter', () => {
  const pane = read('packages/map/src/app/election-pane.js');
  // Each may be cast to the type the manager takes, with a comment above saying why (rf12-map-ui).
  const cast = String.raw`(?:\/\*\* @type \{\w+\} \*\/ \()?`;
  assert.match(pane, new RegExp(String.raw`new Test2ElectionManager\(\{\s*(?:\/\/[^\n]*\n\s*)*app: ${cast}this\)?,\s*mapController: ${cast}this\.mapController\)?,`));
});

test('every method of the manager\'s method modules types `this` as the manager', () => {
  // The grouped years, and the grouped entries (election-group-methods.js, 19 Nov 2026).
  for (const [file, least] of /** @type {const} */ ([['packages/map/src/election/grouped-year-methods.js', 2], ['packages/map/src/election/election-group-methods.js', 8]])) {
    const lines = read(file).split('\n');
    let methods = 0;
    lines.forEach((line, i) => {
      if (!/^ {2}(?:async )?[A-Za-z_$][\w$]*\([^)]*\) \{$/.test(line)) return;
      methods += 1;
      const doc = lines.slice(Math.max(0, i - 30), i).join('\n');
      assert.match(doc.slice(doc.lastIndexOf('/**')), /@this \{ElectionManager\}/, `${file}:${i + 1} ${line.trim()} has no @this`);
    });
    assert.ok(methods >= least, file);
  }
  const manager = read('packages/map/app/election-manager.js');
  assert.match(manager, /installMethods\(Test2ElectionManager, \[GroupedYearMethods, ElectionGroupMethods\]\)/, 'the modules are installed on the manager');
});

test('the manager, its method module, the NI local view and the declaration stay in the map type check', () => {
  // The map package project (npm run check:types:packages) since 20 Nov 2026; packages/map/tsconfig.check.json until then.
  const checked = mapProjectFiles();
  for (const entry of [
    'src/election/election-manager.d.ts',
    'src/election/grouped-year-methods.js',
    'src/election/election-group-methods.js',
    'app/ni-local-view.js',
    'app/election-manager.js'
  ]) assert.ok(checked.has(`packages/map/${entry}`), `packages/map/tsconfig.project.json lost ${entry}`);
});
