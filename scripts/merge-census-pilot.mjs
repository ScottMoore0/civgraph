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
import { readFileSync } from 'fs';
import { GATE_MANIFEST_REL, resolveApprovedPublicationSources, writeApprovedPublicationSources } from './lib/approved-publication-index.mjs';

const GATE = GATE_MANIFEST_REL;
const [file, bucketKey, trancheLabel] = process.argv.slice(2);
if (!file || !bucketKey) { console.error('usage: merge-census-pilot.mjs <file> <bucketKey> [trancheLabel]'); process.exit(1); }

const gate = JSON.parse(readFileSync(GATE, 'utf8'));
const gateSources = resolveApprovedPublicationSources(gate);
const incoming = resolveApprovedPublicationSources(JSON.parse(readFileSync(file, 'utf8')));

const existing = new Set(gateSources.map(s => s.id));
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

gateSources.push(...toAdd);
const c = gate.counts;
const prev = c[bucketKey]?.publish || 0;
c[bucketKey] = {
  publish: prev + toAdd.length,
  tranche: trancheLabel || c[bucketKey]?.tranche || bucketKey,
  note: `Category-1 census tranche. Distinct provenance from the June Category-3 pack; cat-3 publish/variants counts unchanged.`,
};
c.total = gateSources.length; // validator requires counts.total === sources.length

// Persist as a sharded manifest + shard files (repo-size safe). Carry every
// manifest field except the records array through to the new manifest.
const { sources: _drop, items: _drop2, ...meta } = gate;
const res = writeApprovedPublicationSources(meta, gateSources);
const already = incoming.length - toAdd.length;
console.log(`[${bucketKey}] added ${toAdd.length} (${already} already present) -> ${bucketKey}.publish ${c[bucketKey].publish}; gate ${gateSources.length} sources across ${res.shardCount} shards, counts.total ${c.total}`);
