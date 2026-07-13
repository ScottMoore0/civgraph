#!/usr/bin/env node
/**
 * Attach direct download-file links to the NISRA publication catalogue records
 * already in the gate, using the file manifest from
 * crawl-nisra-publication-files.mjs. This makes the actual NISRA data files
 * (xlsx/ods/xls/csv/zip/pdf, OGL v3.0) downloadable straight from Civgraph
 * rather than only via the publication landing page.
 *
 * In-place update of the sharded gate; record count/counts unchanged.
 *
 * Usage: node scripts/census/enrich-nisra-records-with-files.mjs <fileManifest.json>
 */
import { readFileSync } from 'node:fs';
import { readApprovedPublicationGate, writeApprovedPublicationSources } from '../lib/approved-publication-index.mjs';

const manifestPath = process.argv[2];
if (!manifestPath) { console.error('usage: enrich-nisra-records-with-files.mjs <fileManifest.json>'); process.exit(1); }
const MAX_FILES = 30; // cap per record to bound size

const bySlug = new Map();
for (const p of JSON.parse(readFileSync(manifestPath, 'utf8')).publications) bySlug.set(p.slug, p.files);

const { manifest: gate, sources } = readApprovedPublicationGate();
let enriched = 0, linked = 0;
for (const s of sources) {
  if (!String(s.id || '').startsWith('approved-publication:nisra-pub-')) continue;
  const slug = (String(s.url || '').match(/\/publications\/(.+)$/) || [])[1];
  const files = slug && bySlug.get(slug);
  if (!files || !files.length) continue;
  s.downloads = files.slice(0, MAX_FILES).map((f) => ({
    label: decodeURIComponent((f.url.split('/').pop() || '')),
    url: f.url,
    type: f.ext.toUpperCase(),
    source: 'NISRA',
  }));
  enriched += 1;
  linked += s.downloads.length;
}

const { sources: _s, items: _i, ...meta } = gate;
const res = writeApprovedPublicationSources(meta, sources);
console.log(`Enriched ${enriched} NISRA records with ${linked} direct download links; gate ${res.total} across ${res.shardCount} shards.`);
