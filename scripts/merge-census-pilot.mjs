#!/usr/bin/env node
/**
 * Merge a census candidate file into the LIVE approved-publication gate under a
 * named counts bucket. Census cubes are separate Category-1 provenance chains
 * (not the June Category-3 pack), so each tranche lands in its own counts bucket
 * and only counts.total grows (kept === sources.length). Idempotent by id.
 *
 * Usage: node scripts/merge-census-pilot.mjs <candidateFile> <bucketKey> <trancheLabel>
 *   e.g. ... census-gate-records.full.json censusCategory1 cat1-census-cso-ccby
 *        ... census-nisra-records.json     censusNisraOgl  cat1-census-nisra-ogl
 */
import { readFileSync, writeFileSync } from 'fs';

const GATE = 'data/database/approved-publication-sources.json';
const [file, bucketKey, trancheLabel] = process.argv.slice(2);
if (!file || !bucketKey) { console.error('usage: merge-census-pilot.mjs <file> <bucketKey> [trancheLabel]'); process.exit(1); }

const gate = JSON.parse(readFileSync(GATE, 'utf8'));
const incoming = JSON.parse(readFileSync(file, 'utf8')).sources;

const existing = new Set(gate.sources.map(s => s.id));
const toAdd = incoming.filter(s => !existing.has(s.id));

const LOCAL = /(?:[A-Z]:\\|\\\\|C:\/Users\/|D:\/)/i;
for (const s of toAdd) {
  if (!(s.id && s.title && s.type)) throw new Error('record missing id/title/type: ' + s.id);
  if (s.approval?.recommendedAction !== 'publish') throw new Error('record not publish: ' + s.id);
  if (LOCAL.test(JSON.stringify(s))) throw new Error('record leaks local path: ' + s.id);
  for (const l of [...(s.references || []), ...(s.downloads || [])]) {
    if (l.url && !/^https?:\/\//i.test(l.url)) throw new Error('record non-public url: ' + s.id);
  }
}

gate.sources.push(...toAdd);
const c = gate.counts;
const prev = c[bucketKey]?.publish || 0;
c[bucketKey] = {
  publish: prev + toAdd.length,
  tranche: trancheLabel || c[bucketKey]?.tranche || bucketKey,
  note: `Category-1 census tranche. Distinct provenance from the June Category-3 pack; cat-3 publish/variants counts unchanged.`,
};
c.total = gate.sources.length; // validator requires counts.total === sources.length

writeFileSync(GATE, JSON.stringify(gate, null, 2) + '\n');
const already = incoming.length - toAdd.length;
console.log(`[${bucketKey}] added ${toAdd.length} (${already} already present) -> ${bucketKey}.publish ${c[bucketKey].publish}; gate ${gate.sources.length} sources, counts.total ${c.total}`);
