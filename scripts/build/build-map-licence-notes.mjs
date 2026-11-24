#!/usr/bin/env node
/**
 * A licence note beside each map file a reader can download (citations review S15, owner-approved
 * 24 Nov 2026): a FlatGeobuf downloaded on its own carries no credit, so a CC BY or OGL layer
 * would leave the site with none. For every map in data/database/maps.json with a FlatGeobuf on
 * data.civgraph.net (its own, and its variants'), this writes `<file>.LICENCE.txt` under
 * tmp/records/map-licences/, at the file's own path on the bucket: the map, who made it, its
 * licence and licence note, the attribution its licence asks for, its source credits and
 * references, and Civgraph's page for it. The statements are the catalogue's, read through
 * scripts/lib/map-licence.mjs as the Browse map page reads them.
 *
 * It uploads nothing. The notes reach the bucket only through an approved upload, beside the
 * files they describe (for example scripts/publish/r2-upload-tree.mjs on the folder).
 *
 *   node scripts/build/build-map-licence-notes.mjs            write the notes
 *   node scripts/build/build-map-licence-notes.mjs --check    count them; write nothing
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SITE } from '@civgraph/config/node';
import { mapRights } from '../lib/map-licence.mjs';

const CATALOGUE = 'data/database/maps.json';
const OUT = path.join('tmp', 'records', 'map-licences');
const BUCKET = /^https:\/\/data\.civgraph\.net\//;
const CHECK = process.argv.includes('--check');

/**
 * @typedef {{ label?: unknown, url?: unknown, note?: unknown }} Reference
 * @typedef {{ fgb?: unknown }} MapFiles
 * @typedef {import('../lib/map-licence.mjs').MapRightsFields & { id: string, name?: unknown, slug?: unknown, hidden?: unknown, provider?: unknown, references?: Reference[], files?: MapFiles, variants?: Array<{ id?: unknown, label?: unknown, files?: MapFiles }> }} CatalogueMap
 */

/** @param {unknown} value @returns {string} */
const text = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/**
 * The note for one map file.
 * @param {CatalogueMap} map
 * @param {string} title  the map's name, or the variant's
 * @returns {string}
 */
export function licenceNote(map, title) {
  const rights = mapRights(map);
  const providers = (Array.isArray(map.provider) ? map.provider : []).map(text).filter(Boolean);
  const page = `${SITE.origin}/browse/maps/${encodeURIComponent(text(map.slug) || map.id)}`;
  const lines = [`${title}`, `Civgraph map: ${page}`, ''];
  if (providers.length) lines.push(`Credit: ${providers.join(', ')}`);
  lines.push(rights.licence ? `Licence: ${rights.licence.name}${rights.licence.url ? ` (${rights.licence.url})` : ''}`
    : `Licence: not recorded for this map; see ${SITE.origin}/pages/licence`);
  if (rights.licenceNote) lines.push(`Licence note: ${rights.licenceNote}`);
  if (rights.attribution) lines.push(`Attribution: ${rights.attribution}`);
  if (rights.sourceCredits.length) lines.push(`Sources: ${rights.sourceCredits.join('; ')}`);
  const refs = (map.references || []).filter((r) => text(r.label) || text(r.url));
  if (refs.length) {
    lines.push('', 'References:');
    for (const r of refs) lines.push(`- ${[text(r.label), text(r.url)].filter(Boolean).join(': ')}`);
  }
  lines.push('', `How to credit Civgraph and each source: ${SITE.origin}/pages/licence`, '');
  return lines.join('\n');
}

/**
 * Every downloadable FlatGeobuf of the catalogue's visible maps, with its note.
 * @param {CatalogueMap[]} maps
 * @returns {Map<string, string>}  bucket key of the note -> its text
 */
export function licenceNotes(maps) {
  /** @type {Map<string, string>} */
  const notes = new Map();
  const add = (/** @type {unknown} */ url, /** @type {CatalogueMap} */ map, /** @type {string} */ title) => {
    const href = text(url);
    if (!BUCKET.test(href)) return;
    const key = `${decodeURIComponent(href.replace(BUCKET, '').split(/[?#]/)[0] || '')}.LICENCE.txt`;
    if (!notes.has(key)) notes.set(key, licenceNote(map, title));
  };
  for (const map of maps) {
    if (map.hidden === true) continue;
    const name = text(map.name) || map.id;
    add(map.files?.fgb, map, name);
    for (const v of map.variants || []) add(v.files?.fgb, map, `${name}: ${text(v.label) || text(v.id)}`);
  }
  return notes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  /** @type {{ maps: CatalogueMap[] }} */
  const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
  const notes = licenceNotes(catalogue.maps || []);
  if (!CHECK) {
    rmSync(OUT, { recursive: true, force: true });
    for (const [key, body] of notes) {
      const file = path.join(OUT, ...key.split('/'));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, body);
    }
  }
  console.log(`map licence notes: ${notes.size}${CHECK ? ' (checked, nothing written)' : ` -> ${OUT}; nothing uploaded`}`);
}
