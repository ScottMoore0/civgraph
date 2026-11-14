#!/usr/bin/env node
/**
 * Write each module page's import map from its entry script's module graph
 * (npm run build:import-maps).
 *
 * build:browse-cache re-hashes the entries a map already has. This also adds the modules a page
 * now imports and drops the ones it no longer does, so a map taken from main's side of a rebase
 * conflict (npm run land) is whole again. The result is the map the ui-module-tokens unit test
 * expects, byte for byte; a page whose map already holds exactly those entries is left as it is.
 *
 *   node scripts/build/stamp-import-maps.mjs           write the maps
 *   node scripts/build/stamp-import-maps.mjs --check   fail if a map is not what it should be
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { sourceOf } from './site.mjs';
import { IMPORT_MAP_BLOCK, IMPORT_MAP_PAGES, expectedImportMap, expectedImports, pageParts } from '../lib/import-map.mjs';

const CHECK = process.argv.includes('--check');

/** @type {string[]} */
const stale = [];
/** @type {string[]} */
const problems = [];
for (const rel of IMPORT_MAP_PAGES) {
  const file = sourceOf(rel);
  const html = readFileSync(file, 'utf8');
  const { entry, map } = pageParts(html);
  if (!entry) { problems.push(`${file}: no module entry script`); continue; }
  const expected = expectedImports(entry);
  if (!Object.keys(expected).length) continue;
  if (!map) { problems.push(`${file}: imports modules but has no import map; add, before the entry script:\n${expectedImportMap(entry)}`); continue; }
  const sorted = Object.keys(map).sort().map((key) => [key, map[key]]);
  if (JSON.stringify(sorted) === JSON.stringify(Object.entries(expected))) continue;
  stale.push(file);
  if (!CHECK) writeFileSync(file, html.replace(IMPORT_MAP_BLOCK, () => expectedImportMap(entry)));
}

for (const problem of problems) console.error(`FAIL: ${problem}`);
if (problems.length) process.exit(1);
if (CHECK && stale.length) {
  console.error(`FAIL: ${stale.length} import map(s) out of date: ${stale.join(', ')}. Run npm run build:import-maps.`);
  process.exit(1);
}
console.log(stale.length
  ? `${CHECK ? 'Stale' : 'Wrote'} ${stale.length} import map(s): ${stale.join(', ')}`
  : `${IMPORT_MAP_PAGES.length} import map(s) already current.`);
