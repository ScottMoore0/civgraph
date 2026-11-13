#!/usr/bin/env node
/**
 * Give the NISRA publication records in the approved-publication gate their direct download
 * links, from the manifest crawl-nisra-publication-files.mjs writes: each record whose
 * publication has files gets up to MAX_FILES `{ label, url, type, source: 'NISRA' }` entries, in
 * page order (the shape the July 2026 enrichment gave 2,821 records).
 *
 * Only a record with no `downloads` yet is given them, so a record that already has its links
 * (and any mirror links added beside them) is never rewritten. In-place update of the sharded
 * gate; the record count does not change. Idempotent.
 *
 * Usage: node scripts/ingest/census/enrich-nisra-records-with-files.mjs <files-manifest.json>
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readApprovedPublicationGate, writeApprovedPublicationSources } from '../../lib/approved-publication-index.mjs';

/** The most links one record carries. */
export const MAX_FILES = 30;
const NISRA_ID = 'approved-publication:nisra-pub-';

/** @typedef {{ label: string, url: string, type: string, source: 'NISRA' }} Download */
/** @typedef {{ id?: string, url?: string, downloads?: unknown[] }} GateRecord */
/** @typedef {{ publications: { slug: string, files: { url: string, ext: string }[] }[] }} FilesManifest */

/**
 * A publication's download entries: the file name (decoded) as the label, the extension as the type.
 * @param {{ url: string, ext: string }[]} files
 * @returns {Download[]}
 */
export function nisraDownloads(files) {
  return files.slice(0, MAX_FILES).map((f) => ({
    label: decodeURIComponent(f.url.split('/').pop() || ''),
    url: f.url,
    type: f.ext.toUpperCase(),
    source: 'NISRA',
  }));
}

/**
 * Add downloads, in place, to the NISRA records that have none and whose publication the
 * manifest lists with files.
 * @param {GateRecord[]} sources
 * @param {FilesManifest} manifest
 * @returns {{ enriched: string[], linked: number }}
 */
export function enrichNisraSources(sources, manifest) {
  const bySlug = new Map(manifest.publications.map((p) => [p.slug, p.files]));
  /** @type {string[]} */
  const enriched = [];
  let linked = 0;
  for (const s of sources) {
    if (!String(s.id || '').startsWith(NISRA_ID) || s.downloads !== undefined) continue;
    const slug = /\/publications\/(.+)$/.exec(String(s.url || ''))?.[1];
    const files = slug ? bySlug.get(slug) : undefined;
    if (!files || !files.length) continue;
    s.downloads = nisraDownloads(files);
    enriched.push(String(s.id));
    linked += s.downloads.length;
  }
  return { enriched, linked };
}

function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error('usage: enrich-nisra-records-with-files.mjs <files-manifest.json>');
    process.exit(1);
  }
  const manifest = /** @type {FilesManifest} */ (JSON.parse(readFileSync(manifestPath, 'utf8')));
  const { manifest: gate, sources } = readApprovedPublicationGate();
  const { enriched, linked } = enrichNisraSources(/** @type {GateRecord[]} */ (sources), manifest);
  const { sources: _s, items: _i, ...meta } = gate;
  const res = writeApprovedPublicationSources(meta, sources);
  console.log(`Enriched ${enriched.length} NISRA records with ${linked} direct download links; gate ${res.total} across ${res.shardCount} shards.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
