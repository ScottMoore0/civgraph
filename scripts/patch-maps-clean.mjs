#!/usr/bin/env node
/**
 * Append the 20 clean-map entries (from clean-maps-publish/entries.json) to the
 * `maps` array in data/database/maps.json, in place, with a minimal diff.
 * `maps` is the last top-level key, so we splice before its closing `  ]`.
 */
import { readFileSync, writeFileSync } from 'fs';

const MAPS = 'data/database/maps.json';
const ENTRIES = process.argv[2] || 'data/review-inputs/clean-maps-publish/entries.json';

const text = readFileSync(MAPS, 'utf8');
const parsed = JSON.parse(text);
const existing = new Set((parsed.maps || []).map(m => m && (m.id || m.slug)));
const entries = JSON.parse(readFileSync(ENTRIES, 'utf8'));

const toAdd = entries.filter(e => !existing.has(e.id));
const skipped = entries.length - toAdd.length;
if (!toAdd.length) { console.log(`nothing to add (${skipped} already present)`); process.exit(0); }

const indent = (s, n) => s.split('\n').map(l => ' '.repeat(n) + l).join('\n');
const block = toAdd.map(e => indent(JSON.stringify(e, null, 2), 4)).join(',\n');

const idx = text.lastIndexOf('\n  ]'); // closing bracket of the last top-level array (maps)
if (idx < 0) { console.error('could not locate maps array close'); process.exit(1); }
const out = text.slice(0, idx) + ',\n' + block + text.slice(idx);

// sanity: must still parse and have +toAdd entries
const check = JSON.parse(out);
if (check.maps.length !== parsed.maps.length + toAdd.length) {
  console.error(`length mismatch: ${parsed.maps.length} + ${toAdd.length} != ${check.maps.length}`); process.exit(1);
}
writeFileSync(MAPS, out);
console.log(`added ${toAdd.length} entries (${skipped} skipped) -> maps now ${check.maps.length}`);
console.log('added ids:', toAdd.map(e => e.id).join(', '));
