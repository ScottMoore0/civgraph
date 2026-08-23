#!/usr/bin/env node
/**
 * Every surface that reports "N maps" must report the SAME N.
 *
 * The site gave three answers to one question: the homepage said 1,0xx, /browse said 993,
 * and data/database/maps.json holds 1,031 entries of which 794 are neither hidden nor
 * placeholder. None was wrong on its own terms -- each surface applied its own filter --
 * which is exactly why nobody noticed for so long. A wrong number announces itself; three
 * plausible ones do not.
 *
 * The rule, decided 2026-08-23: a map is PUBLIC if it is visible, loadable, and not a
 * placeholder. It lives in src/public-map.mjs and is imported by both the app and
 * build-browse-indexes.mjs, so there is one implementation rather than three.
 *
 * This checks the derived artefact against the rule. It cannot check the rendered
 * homepage -- that needs a browser, and tests/browser/ux-t3-fixes.spec.js asserts the
 * displayed figure there.
 *
 * Offline, so it belongs to `check:` rather than `verify:`.
 *
 *   node scripts/validate-public-map-count.mjs
 */
import { readFileSync } from 'node:fs';
import { isPublicMap } from '../src/public-map.mjs';

const CATALOGUE = 'data/database/maps.json';
const RENDER = 'render/metadata/maps-test.json';
const BROWSE = 'data/browse/maps.json';

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const render = JSON.parse(readFileSync(RENDER, 'utf8'));
const browse = JSON.parse(readFileSync(BROWSE, 'utf8'));

const renderLayerIds = new Set((render.layers || []).map((layer) => layer.sourceMapId).filter(Boolean));
const raw = catalogue.maps || [];
const byId = new Map(raw.map((map) => [map.id, map]));

const expected = raw.filter((map) => isPublicMap(map, (id) => byId.get(id), (id) => renderLayerIds.has(id)));
const expectedIds = new Set(expected.map((map) => map.id));
const browseItems = browse.items || [];

const problems = [];
if (browseItems.length !== expected.length) {
  problems.push(`${BROWSE} lists ${browseItems.length} map(s); the rule gives ${expected.length}`);
}
if (browse.total !== undefined && browse.total !== expected.length) {
  problems.push(`${BROWSE} declares total ${browse.total}; the rule gives ${expected.length}`);
}
const extra = browseItems.filter((item) => !expectedIds.has(item.id)).map((item) => item.id);
if (extra.length) {
  problems.push(`${BROWSE} lists ${extra.length} map(s) the rule excludes: ${extra.slice(0, 5).join(', ')}`);
}

// A visible, non-placeholder map that is NOT loadable is its own finding: the catalogue
// offers something that cannot be drawn. Measured 2026-08-23: zero.
const unloadable = raw
  .filter((map) => !map.hidden && !map.placeholder)
  .filter((map) => !expectedIds.has(map.id))
  .map((map) => map.id);
if (unloadable.length) {
  problems.push(`${unloadable.length} visible non-placeholder map(s) are not loadable: ${unloadable.slice(0, 5).join(', ')}`);
}

if (problems.length) {
  console.error('FAIL: the public map count does not agree across surfaces.');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('');
  console.error('  Fix: node scripts/build-browse-indexes.mjs');
  console.error('  If the RULE should change, change src/public-map.mjs -- not one caller.');
  process.exit(1);
}

console.log(`PASS: ${expected.length} public map(s), agreed by ${CATALOGUE} and ${BROWSE}.`);
