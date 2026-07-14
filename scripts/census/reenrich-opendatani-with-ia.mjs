#!/usr/bin/env node
/**
 * After Open Data NI files are mirrored to the Internet Archive
 * (mirror-opendatani-to-ia.mjs writes per-item manifests), add each IA copy as a
 * sibling download on the affected Open Data NI catalogue records, so every file
 * offers both the live Open Data NI URL and a durable Internet Archive mirror.
 *
 * In-place update of the sharded gate; record count unchanged. Idempotent.
 *
 * Usage: node scripts/census/reenrich-opendatani-with-ia.mjs <mirrored-1.json> [<mirrored-2.json> …]
 *        (or pass a directory of per-item manifests)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readApprovedPublicationGate, writeApprovedPublicationSources } from '../lib/approved-publication-index.mjs';

let args = process.argv.slice(2);
if (!args.length) { console.error('usage: reenrich-opendatani-with-ia.mjs <mirrored.json|dir> [...]'); process.exit(1); }
// expand directories
const manifests = [];
for (const a of args) {
  try { if (statSync(a).isDirectory()) { for (const f of readdirSync(a)) if (f.endsWith('.json')) manifests.push(join(a, f)); continue; } } catch { /* ignore */ }
  manifests.push(a);
}

const bySource = new Map();
for (const p of manifests) {
  let doc; try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
  for (const m of doc.mirrored || []) {
    if (m.status === 'failed') continue;
    bySource.set(m.sourceUrl, { iaUrl: m.iaUrl, item: m.item });
  }
}

const { manifest: gate, sources } = readApprovedPublicationGate();
let recs = 0, added = 0;
for (const s of sources) {
  if (!String(s.id || '').startsWith('approved-publication:opendata-ni-')) continue;
  if (!Array.isArray(s.downloads)) continue;
  const extra = [];
  for (const d of s.downloads) {
    const hit = bySource.get(d.url);
    if (!hit) continue;
    if (s.downloads.some((x) => x.url === hit.iaUrl)) continue; // idempotent
    extra.push({ label: `${d.label} (Internet Archive mirror)`, url: hit.iaUrl, type: d.type, source: 'Internet Archive', status: 'mirrored' });
  }
  if (extra.length) { s.downloads.push(...extra); recs += 1; added += extra.length; }
}

const { sources: _s, items: _i, ...meta } = gate;
const res = writeApprovedPublicationSources(meta, sources);
console.log(`Added ${added} Internet Archive mirror links across ${recs} Open Data NI records; gate ${res.total} across ${res.shardCount} shards.`);
