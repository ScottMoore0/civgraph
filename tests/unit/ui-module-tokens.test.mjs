/**
 * The modules Browse and the PRONI Search app import are versioned by an import map.
 *
 * Each page loads its entry script with a hand-stamped ?v= token (browse-cache-tokens.mjs keeps
 * those). The modules that script imports (its state machines and the shared helper,
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
 * The failure prints the import map to paste.
 *
 *   node --test tests/unit/ui-module-tokens.test.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGES = ['browse/index.html', 'catalogue/index.html', 'records/index.html', 'apps/proni-search/index.html'];

const read = (rel) => readFileSync(path.join(ROOT, rel));
export const token = (rel) => createHash('sha256').update(read(rel)).digest('hex').slice(0, 12);

/** Static import specifiers of a module (import ... from '...'; export ... from '...'). */
function importsOf(source) {
  const out = [];
  for (const match of source.matchAll(/^\s*(?:import|export)\s[^;'"]*?\sfrom\s+['"]([^'"]+)['"]/gm)) out.push(match[1]);
  for (const match of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(match[1]);
  return out;
}

/** Every module an entry reaches by relative or root-relative static imports, as site paths. */
export function moduleGraph(entry) {
  const seen = new Set();
  const visit = (sitePath) => {
    for (const spec of importsOf(read(sitePath.slice(1)).toString('utf8'))) {
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
      const resolved = new URL(spec, `https://site.invalid${sitePath}`).pathname;
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      visit(resolved);
    }
  };
  visit(entry);
  return seen;
}

function pageParts(rel) {
  const html = read(rel).toString('utf8');
  const entry = html.match(/<script type="module" src="([^"?]+)(?:\?[^"]*)?"/)?.[1];
  const mapText = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  return { entry, map: mapText ? JSON.parse(mapText).imports || {} : null };
}

/** The import map a page should carry, for the failure message. */
function expectedMap(entry) {
  const imports = Object.fromEntries([...moduleGraph(entry)].sort().map((p) => [p, `${p}?v=${token(p.slice(1))}`]));
  return `<script type="importmap">${JSON.stringify({ imports })}</script>`;
}

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
