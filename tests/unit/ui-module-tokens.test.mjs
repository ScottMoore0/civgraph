/**
 * The modules Browse, the PRONI Search app and Words in parliament import are versioned by an import map.
 *
 * Each page loads its entry script with a hand-stamped ?v= token (browse-cache-tokens.mjs keeps
 * those; Words in parliament loads words.js without one, as before). The modules that script imports (its state machines and the shared helper,
 * assets/ui/state/machine.js) are imported by plain paths, which the page's
 * <script type="importmap"> maps to the same path with ?v=<first 12 hex of the file's SHA-256>.
 * So a deploy that changes a module changes its URL, and the service worker's
 * stale-while-revalidate cache can never pair a new entry script with an old module.
 *
 * This test fails when
 *   - a module the entry script reaches (statically, transitively) has no import-map entry;
 *   - an entry's token is not the file's current hash;
 *   - an import specifier carries its own ?v= (the map does that, and TypeScript cannot
 *     resolve a specifier with a query).
 * The failure prints the import map to paste; npm run build:import-maps writes it. The graph and
 * the tokens come from scripts/lib/import-map.mjs, which the stamper shares.
 *
 *   node --test tests/unit/ui-module-tokens.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { IMPORT_MAP_PAGES, expectedImportMap, importsOf, moduleGraph, pageParts as htmlParts, readServed, token } from '../../scripts/lib/import-map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGES = IMPORT_MAP_PAGES;
const read = readServed;
const pageParts = (rel) => htmlParts(read(rel).toString('utf8'));
const expectedMap = expectedImportMap;

for (const rel of PAGES) {
  test(`${rel}: every imported module is in the import map at its current hash`, () => {
    const { entry, map } = pageParts(rel);
    assert.ok(entry, `${rel} has no module entry script`);
    const graph = moduleGraph(entry);
    if (!graph.size) return;
    assert.ok(map, `${rel} imports modules but has no import map. Add, before the entry script:\n${expectedMap(entry)}`);
    for (const modulePath of graph) {
      assert.equal(map[modulePath], `${modulePath}?v=${token(modulePath.slice(1))}`,
        `${rel}: ${modulePath} is missing or stale in the import map. Expected:\n${expectedMap(entry)}`);
    }
    for (const key of Object.keys(map)) assert.ok(graph.has(key), `${rel}: import map names ${key}, which the page does not import`);
  });
}

test('no UI import specifier carries its own ?v= token', () => {
  for (const rel of PAGES) {
    const { entry } = pageParts(rel);
    for (const modulePath of [entry, ...moduleGraph(entry)]) {
      for (const spec of importsOf(read(modulePath.slice(1)).toString('utf8'))) {
        assert.ok(!/\?v=/.test(spec), `${modulePath} imports ${spec}: version it in the page's import map instead`);
      }
    }
  }
});

test('npm run build:browse-cache stamps every page this test holds', () => {
  const stamper = readFileSync(path.join(ROOT, 'scripts', 'check', 'rules', 'browse-cache-tokens.mjs'), 'utf8');
  for (const rel of PAGES) assert.ok(stamper.includes(`'site/${rel}'`), `browse-cache-tokens.mjs HTML_FILES lacks site/${rel}`);
});
