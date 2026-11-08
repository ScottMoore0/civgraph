#!/usr/bin/env node
/**
 * Irish place-name crosswalk keyed to Civgraph features, built from data the site already holds.
 *
 * For every layer in assets/i18n/place-name-fields.json whose source FlatGeobuf is in the local
 * source cache (render/source-cache/vector-intake, gitignored; in a worktree the main checkout's
 * copy is used read-only), read each feature's English label and Irish name and write
 *
 *   <cache>/place-name-crosswalk.tsv   layer_id, feature_id, english, irish, logainm_id, field
 *   data/i18n/place-names/summary.json counts by kind and layer (committed)
 *   data/i18n/place-names/sample.tsv   the first 25 rows per kind (committed, for review)
 *
 * The full crosswalk stays out of the repository (tens of thousands of townlands) in the cache
 * directory: CIVGRAPH_I18N_CACHE or --cache <dir> (default tmp/i18n-cache).
 *
 * Sources and terms (recorded 2026-11-01; see data/i18n/README.md):
 *   Tailte Éireann / CSO boundary data, CC BY 4.0, "© Tailte Éireann"; the Irish forms come
 *   from Logainm ("Irish-language placename data by Logainm © Government of Ireland and licensed
 *   under CC BY 4.0"). OpenStreetMap name:ga, ODbL. Nothing is fetched from any website here.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';

const arg = (/** @type {string} */ name, /** @type {string} */ fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
// Large cache: outside the repository. Set CIVGRAPH_I18N_CACHE (the owner's machine keeps it on a
// data drive) or pass --cache; the default is the gitignored tmp/ folder.
const CACHE = arg('--cache', process.env.CIVGRAPH_I18N_CACHE || path.join('tmp', 'i18n-cache'));
const SAMPLE_PER_KIND = 25;

/** @typedef {import('../../packages/types/index.js').LayerEntry & { sourceFile?: string }} IndexLayer  a maps-test-index.json layer */

/** @type {Record<string, string>} layer id -> the property holding its Irish names */
const fields = JSON.parse(readFileSync('assets/i18n/place-name-fields.json', 'utf8')).layers;
/** @type {IndexLayer[]} */
const index = JSON.parse(readFileSync('render/metadata/maps-test-index.json', 'utf8')).layers;
const review = readFileSync('data/i18n/review/place-name-fields.tsv', 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).slice(1).map((l) => l.split('\t'));
const kindById = Object.fromEntries(review.map((r) => [r[0], r[2]]));

/**
 * @param {string | undefined} sourceFile
 */
function locate(sourceFile) {
  if (!sourceFile) return null;
  const candidates = [sourceFile, path.join('..', '..', '..', sourceFile)];
  return candidates.find((p) => existsSync(p)) || null;
}

mkdirSync(CACHE, { recursive: true });
const out = createWriteStream(path.join(CACHE, 'place-name-crosswalk.tsv'));
out.write('layer_id\tfeature_id\tenglish\tirish\tlogainm_id\tirish_field\n');

/** @type {{ generatedFrom: string, byKind: Record<string, any>, layers: Record<string, any>, missingSource: string[] }} */
const summary = { generatedFrom: 'local source cache (render/source-cache/vector-intake)', byKind: {}, layers: {}, missingSource: [] };
/** @type {Record<string, string[][]>} up to SAMPLE_PER_KIND crosswalk rows per kind */
const sample = {};
const seenSources = new Set();
for (const layer of index) {
  const field = fields[layer.id];
  if (!field) continue;
  const file = locate(layer.sourceFile);
  if (!file) { summary.missingSource.push(layer.id); continue; }
  // Alias layers share a source with their parent: count each source once.
  const sourceKey = `${file}|${field}`;
  if (seenSources.has(sourceKey)) continue;
  seenSources.add(sourceKey);
  const kind = kindById[layer.id] || 'other';
  let features = 0;
  let withIrish = 0;
  const buf = readFileSync(file);
  for await (const feature of deserialize(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))) {
    const p = feature.properties || {};
    // A layer is in place-name-fields.json only through its label property, so it has one.
    const english = String(p[/** @type {string} */ (layer.labelProperty)] ?? '').trim();
    const irish = String(p[field] ?? '').trim();
    features += 1;
    if (!irish || !english) continue;
    withIrish += 1;
    const id = p[layer.promoteId || 'id'] ?? feature.id ?? '';
    const logainm = p.LOGAINM_ID ?? p.LOGAINM_RE ?? p['logainm:ref'] ?? '';
    const row = [layer.id, id, english, irish, logainm, field].map((v) => String(v).replace(/[\t\n]/g, ' '));
    out.write(`${row.join('\t')}\n`);
    (sample[kind] ||= []);
    if (sample[kind].length < SAMPLE_PER_KIND) sample[kind].push(row);
  }
  summary.layers[layer.id] = { kind, field, features, withIrish };
  const k = (summary.byKind[kind] ||= { layers: 0, features: 0, withIrish: 0 });
  k.layers += 1;
  k.features += features;
  k.withIrish += withIrish;
  process.stdout.write('.');
}
out.end();
mkdirSync('data/i18n/place-names', { recursive: true });
writeFileSync('data/i18n/place-names/summary.json', `${JSON.stringify(summary, null, 1)}\n`);
const rows = [['layer_id', 'feature_id', 'english', 'irish', 'logainm_id', 'irish_field']];
for (const list of Object.values(sample)) rows.push(...list);
writeFileSync('data/i18n/place-names/sample.tsv', `${rows.map((r) => r.join('\t')).join('\n')}\n`);
console.log(`\nCrosswalk: ${path.join(CACHE, 'place-name-crosswalk.tsv')}`);
console.log(JSON.stringify(summary.byKind, null, 1));
if (summary.missingSource.length) console.log(`${summary.missingSource.length} paired layers have no local source file (their tiles still carry the Irish names).`);
