#!/usr/bin/env node
/**
 * Merge the title-dated census pilot slice into the LIVE approved-publication gate.
 * The census cubes are a separate Category-1 CC-BY provenance chain (not the June
 * Category-3 pack that generated the base gate), so they land in their own
 * `counts.censusCategory1` bucket; the cat-3 publish/variants numbers are untouched
 * and only `counts.total` grows. Idempotent (skips ids already present).
 * Usage: node scripts/merge-census-pilot.mjs [pilotFile]
 */
import { readFileSync, writeFileSync } from 'fs';

const GATE = 'data/database/approved-publication-sources.json';
const PILOT = process.argv[2] || 'data/review-inputs/census-publish-ready/census-gate-records.pilot-dated.json';

const gate = JSON.parse(readFileSync(GATE, 'utf8'));
const pilot = JSON.parse(readFileSync(PILOT, 'utf8')).sources;

const existing = new Set(gate.sources.map(s => s.id));
const toAdd = pilot.filter(s => !existing.has(s.id));
if (!toAdd.length) { console.log('nothing to add (all pilot ids already present)'); process.exit(0); }

// sanity on every incoming record (mirror the validator's per-source asserts)
const LOCAL = /(?:[A-Z]:\\|\\\\|C:\/Users\/|D:\/)/i;
for (const s of toAdd) {
  if (!(s.id && s.title && s.type)) throw new Error('census record missing id/title/type: ' + s.id);
  if (s.approval?.recommendedAction !== 'publish') throw new Error('census record not publish: ' + s.id);
  if (LOCAL.test(JSON.stringify(s))) throw new Error('census record leaks local path: ' + s.id);
  for (const l of [...(s.references || []), ...(s.downloads || [])]) {
    if (l.url && !/^https?:\/\//i.test(l.url)) throw new Error('census record non-public url: ' + s.id);
  }
}

gate.sources.push(...toAdd);
const c = gate.counts;
c.censusCategory1 = {
  publish: (c.censusCategory1?.publish || 0) + toAdd.length,
  tranche: 'cat1-census-cso-ccby',
  slice: 'title-dated-pilot',
  note: 'CSO CC-BY census cubes (Category-1), title-dated pilot slice. Full tranche of 6,560 staged in data/review-inputs/census-publish-ready/. Distinct provenance from the June Category-3 pack; cat-3 publish/variants counts unchanged.',
};
c.total = c.publish + c.variants + c.censusCategory1.publish;
gate.approvalPolicy += ' Plus a Category-1 CSO census-cube pilot (title-dated CC-BY cubes) approved for publication.';

writeFileSync(GATE, JSON.stringify(gate, null, 2) + '\n');
console.log(`added ${toAdd.length} census pilot records -> gate now ${gate.sources.length} sources; counts.total ${c.total} (publish ${c.publish} + variants ${c.variants} + census ${c.censusCategory1.publish})`);
