#!/usr/bin/env node
/**
 * After NISRA files are mirrored to Internet Archive (mirror-nisra-files-to-ia.mjs
 * writes a per-item mirrored manifest), add the IA copy as a sibling download on
 * the affected NISRA catalogue records, so each file offers both the live NISRA
 * URL and a durable Internet Archive mirror.
 *
 * In-place update of the sharded gate; record count unchanged. Idempotent.
 *
 * Usage: node scripts/census/reenrich-nisra-with-ia.mjs <mirrored-1.json> [<mirrored-2.json> …]
 */
import { readFileSync } from 'node:fs';
import { readApprovedPublicationGate, writeApprovedPublicationSources } from '../lib/approved-publication-index.mjs';

const manifests = process.argv.slice(2);
if (!manifests.length) { console.error('usage: reenrich-nisra-with-ia.mjs <mirrored.json> [...]'); process.exit(1); }

const bySource = new Map();
for (const p of manifests) {
  for (const m of JSON.parse(readFileSync(p, 'utf8')).mirrored || []) {
    if (m.status === 'failed') continue;
    bySource.set(m.sourceUrl, { iaUrl: m.iaUrl, item: m.item });
  }
}

const { manifest: gate, sources } = readApprovedPublicationGate();
let recs = 0, added = 0;
for (const s of sources) {
  if (!String(s.id || '').startsWith('approved-publication:nisra-pub-')) continue;
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
console.log(`Added ${added} Internet Archive mirror links across ${recs} NISRA records; gate ${res.total} across ${res.shardCount} shards.`);
