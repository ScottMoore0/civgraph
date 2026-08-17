#!/usr/bin/env node
/**
 * A map hidden from the catalogue must not be reachable through Browse.
 *
 * Tech-debt item 20 recorded "98 hidden maps with orphaned Browse details".
 * Measured 2026-08-17 it is resolved: 118 maps carry `hidden`, and none of them
 * appears in data/browse/maps.json or has a file in data/browse/details/.
 *
 * This exists so it stays resolved. `hidden` is the mechanism by which a layer is
 * withdrawn -- from a rights question, a data defect, or work in progress -- and
 * the failure it guards against is silent: the catalogue stops offering a layer
 * while Browse keeps a page for it, so the thing that was withdrawn is still
 * reachable by anyone with the link or a search engine.
 *
 * Note what this does NOT assert: that every visible map appears in Browse.
 * data/browse/maps.json legitimately holds 80 `data-*` entries that live in
 * dataEntries rather than maps.json, so the two counts do not reconcile and a
 * naive equality check here would fail for the wrong reason.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const CATALOGUE = 'data/database/maps.json';
const BROWSE_INDEX = 'data/browse/maps.json';
const DETAIL_DIR = 'data/browse/details';

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const hidden = new Set(catalogue.maps.filter((m) => m.hidden).map((m) => m.id));

if (!existsSync(BROWSE_INDEX)) {
  console.log(`SKIP: ${BROWSE_INDEX} not built; nothing to check.`);
  process.exit(0);
}

const index = JSON.parse(readFileSync(BROWSE_INDEX, 'utf8'));
const items = index.items || index.maps || [];

const listed = items.filter((item) => hidden.has(item.id)).map((item) => item.id);

const detailed = existsSync(DETAIL_DIR)
  ? readdirSync(DETAIL_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((id) => hidden.has(id))
  : [];

if (listed.length || detailed.length) {
  console.error('FAIL: maps hidden from the catalogue are still reachable in Browse:');
  for (const id of listed.slice(0, 10)) console.error(`  - listed in the index: ${id}`);
  for (const id of detailed.slice(0, 10)) console.error(`  - has a detail page  : ${id}`);
  const total = listed.length + detailed.length;
  if (total > 20) console.error(`  ... and ${total - 20} more`);
  console.error('');
  console.error('  `hidden` is how a layer is withdrawn. A withdrawn layer with a live');
  console.error('  Browse page is still reachable by link or search engine.');
  console.error('  Rebuild the browse indexes: npm run build:browse');
  process.exit(1);
}

console.log(`PASS: none of the ${hidden.size} hidden map(s) appears in Browse `
  + `(${items.length} index entries checked).`);
