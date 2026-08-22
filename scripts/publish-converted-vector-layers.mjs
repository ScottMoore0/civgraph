#!/usr/bin/env node
/**
 * Publish net-new open-data vector datasets as rendered /test map layers.
 *
 * For each convert-ready row from the Track-B conversion worklist:
 *   fetch provider download URL -> GeoJSON -> FGB (source-cache) + PMTiles
 *   -> author a maps.json catalogue entry + a maps-test.json render twin
 *   -> (optionally) upload the PMTiles to R2 and mark serving:cdn.
 *
 * The heavy build (build:test2 index) + gate run separately after this writes
 * maps.json / maps-test.json. Idempotent by layer id.
 *
 * Usage:
 *   node scripts/publish-converted-vector-layers.mjs --ids row1,row2 [--no-upload]
 *   node scripts/publish-converted-vector-layers.mjs --limit 8 [--no-upload]
 * R2 upload reads R2_* from the main-checkout .env.local (source it first, or it
 * is auto-read from ../../.. up to the repo that holds it).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(process.cwd());
const WORKLIST = resolve(ROOT, 'data/review-inputs/medium-priority-resolution-2026-07-08/conversion-resolution-worklist.json');
const MAPS_PATH = resolve(ROOT, 'data/database/maps.json');
const TEST_PATH = resolve(ROOT, 'render/metadata/maps-test.json');
const INTAKE = resolve(ROOT, 'render/source-cache/vector-intake');
const PMTILES_DIR = resolve(ROOT, 'render/pmtiles/generated');
const TMP = resolve(process.env.CLAUDE_JOB_DIR || ROOT, 'tmp/conv-pub');
const DATA_HOST = 'https://data.civgraph.net';
const NO_UPLOAD = process.argv.includes('--no-upload');

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const wantIds = (arg('--ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
const limit = Number(arg('--limit') || 0);

for (const d of [INTAKE, PMTILES_DIR, TMP]) mkdirSync(d, { recursive: true });

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
const worklist = JSON.parse(readFileSync(WORKLIST, 'utf8')).items;
let convertible = worklist.filter((o) => o.decision === 'convert' && o.convertClass === 'vector-direct' && o.downloadUrl);
if (wantIds.length) convertible = convertible.filter((o) => wantIds.includes(o.rowId));
// --from-cache: process only rows whose FGB is already on disk (skip all downloads);
// used to author the already-converted set fast, without re-fetching known-bad URLs.
if (process.argv.includes('--from-cache')) {
  convertible = convertible.filter((o) => existsSync(resolve(INTAKE, ('oda-map-' + slugify(o.rowId.split(':').pop() + '-' + o.title)) + '.fgb')));
}
if (limit) convertible = convertible.slice(0, limit);

const LICENCE_KW = { 'CC BY 4.0': 'CC-BY-4.0', 'CC BY-SA 4.0': 'CC-BY-SA-4.0', 'CC0 1.0': 'CC0-1.0', 'OGL v3.0': 'OGL-v3.0' };
const ATTR = {
  'CC BY 4.0': 'Contains Irish Public Sector Data licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence.',
  'CC BY-SA 4.0': 'Contains Irish Public Sector Data licensed under a Creative Commons Attribution Share-Alike 4.0 International (CC BY-SA 4.0) licence.',
  'CC0 1.0': 'Released under a Creative Commons CC0 1.0 Public Domain Dedication.',
  'OGL v3.0': 'Contains public sector information licensed under the Open Government Licence v3.0.'
};
const PALETTE = ['#2E86C1', '#8E44AD', '#16A085', '#C0392B', '#D35400', '#27AE60', '#2980B9', '#7E5109'];

function sh(cmd, args) { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

function ogrInspect(fgb) {
  const out = sh('ogrinfo', ['-so', '-al', fgb]);
  const geom = (out.match(/Geometry:\s*(\w+)/) || [])[1] || 'Unknown';
  const ext = out.match(/Extent:\s*\(([-\d.]+),\s*([-\d.]+)\)\s*-\s*\(([-\d.]+),\s*([-\d.]+)\)/);
  const layer = (out.match(/Layer name:\s*(.+)/) || [])[1]?.trim();
  const fields = [];
  for (const m of out.matchAll(/^([A-Za-z_][\w]*):\s*(String|Integer|Integer64|Real|Date|DateTime)\b/gm)) fields.push({ name: m[1], type: m[2] });
  const geometryType = /polygon|multipolygon/i.test(geom) ? 'polygon' : /point/i.test(geom) ? 'point' : /line/i.test(geom) ? 'line' : 'polygon';
  // bounds as [[minLat,minLon],[maxLat,maxLon]] (extent is lon,lat)
  const bounds = ext ? [[Number(ext[2]), Number(ext[1])], [Number(ext[4]), Number(ext[3])]] : null;
  const stringFields = fields.filter((f) => f.type === 'String').map((f) => f.name);
  const numericFields = fields.filter((f) => /Real|Integer/.test(f.type)).map((f) => f.name);
  const labelField = stringFields.find((n) => /^(name|title|label)$/i.test(n)) || stringFields.find((n) => /name|title|desc|area|ward|div|const/i.test(n)) || stringFields[0] || null;
  return { geometryType, sourceLayer: layer, bounds, stringFields, numericFields, labelField, fieldNames: fields.map((f) => f.name) };
}

const results = [];
let idx = 0;
for (const row of convertible) {
  idx++;
  const base = 'oda-map-' + slugify(row.rowId.split(':').pop() + '-' + row.title);
  const layerId = base + '-vector-test';
  const geojson = resolve(TMP, base + '.geojson');
  const fgb = resolve(INTAKE, base + '.fgb');
  const pmtiles = resolve(PMTILES_DIR, layerId + '.pmtiles');
  const srcLayer = base.replace(/-/g, '_'); // deterministic MVT layer name == entry.sourceLayer
  try {
    let featureCount = null;
    if (existsSync(fgb) && statSync(fgb).size > 0) {
      // Reuse the fetched geometry; skip re-download. (FGB is source-only, unaffected by tiling.)
      featureCount = Number(sh('ogrinfo', ['-so', '-al', fgb]).match(/Feature Count:\s*(\d+)/)?.[1] || 0);
    } else {
      sh('curl', ['-sL', '--fail', '--retry', '3', '--retry-delay', '2', '--retry-all-errors', '--max-time', '300', row.downloadUrl, '-o', geojson]);
      const gj = JSON.parse(readFileSync(geojson, 'utf8'));
      featureCount = (gj.features || []).length;
      if (!featureCount) throw new Error('no features');
      sh('ogr2ogr', ['-f', 'FlatGeobuf', fgb, geojson, '-t_srs', 'EPSG:4326']);
    }
    // Always (re)generate PMTiles with an explicit zoom range + named MVT layer so the
    // archive max_zoom matches the entry maxzoom (MapLibre overzooms correctly) and
    // source-layer resolves. GDAL otherwise auto-picks a low max_zoom -> blank on zoom-in.
    rmSync(pmtiles, { force: true });
    sh('ogr2ogr', ['-f', 'PMTiles', pmtiles, fgb, '-t_srs', 'EPSG:4326',
      '-dsco', 'MINZOOM=0', '-dsco', 'MAXZOOM=12', '-lco', `NAME=${srcLayer}`, '-nln', srcLayer]);
    const meta = ogrInspect(fgb);
    meta.sourceLayer = srcLayer;
    const bytes = statSync(pmtiles).size;
    results.push({ row, base, layerId, fgb, pmtiles, bytes, featureCount, meta });
    console.log(`[${idx}/${convertible.length}] ${base}: ${meta.geometryType} ${featureCount}f ${(bytes / 1024).toFixed(0)}KB label=${meta.labelField}`);
  } catch (e) {
    results.push({ row, base, error: String(e.message || e).slice(0, 140) });
    console.log(`[${idx}/${convertible.length}] ${base}: SKIP ${String(e.message || e).slice(0, 80)}`);
    for (const f of [geojson, fgb, pmtiles]) { try { rmSync(f); } catch {} }
  }
}

const ok = results.filter((r) => !r.error);
console.log(`\nconverted ${ok.length}/${results.length}`);
if (!ok.length) process.exit(0);

// ---- R2 upload ----
if (!NO_UPLOAD) {
  // read main-checkout .env.local
  // The last entry used to be an absolute path into one developer's checkout,
  // which only ever resolved on that machine and published their username in a
  // public repo. Deriving it from this module's own location covers the same
  // case -- the main checkout's .env.local -- from any cwd, on any OS.
  const REPO_ENV = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
  for (const p of ['.env.local', '../../../.env.local', '../../../../.env.local', REPO_ENV]) {
    try { for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } break; } catch {}
  }
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: 'auto', endpoint: process.env.R2_S3_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  const BUCKET = process.env.R2_BUCKET || 'boundaries-data';
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  for (const r of ok) {
    r.r2Key = `data/maps/test/pmtiles/generated/${r.layerId}.pmtiles`;
    const body = readFileSync(r.pmtiles);
    let uploaded = false;
    for (let attempt = 1; attempt <= 4 && !uploaded; attempt++) {
      try {
        await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: r.r2Key, Body: body, ContentType: 'application/octet-stream' }));
        uploaded = true;
      } catch (e) {
        if (attempt === 4) { r.uploadError = String(e.message || e).slice(0, 100); console.log(`R2 FAIL (skip): ${r.r2Key} — ${r.uploadError}`); }
        else await sleep(1500 * attempt);
      }
    }
    if (uploaded) console.log(`R2 up: ${r.r2Key}`);
  }
}
// Drop any layer whose PMTiles failed to upload — don't author a broken CDN entry.
const authorable = ok.filter((r) => !r.uploadError);

// ---- author entries ----
const maps = JSON.parse(readFileSync(MAPS_PATH, 'utf8'));
const test = JSON.parse(readFileSync(TEST_PATH, 'utf8'));
const mapIds = new Set((maps.maps || []).map((m) => m.id));
const layerIds = new Set((test.layers || []).map((l) => l.id));
let added = 0;
for (const [i, r] of (typeof authorable !== 'undefined' ? authorable : ok).entries()) {
  const lic = r.row.license; const colour = PALETTE[i % PALETTE.length];
  const localUrl = `/render/pmtiles/generated/${r.layerId}.pmtiles`;
  const r2Key = r.r2Key || `data/maps/test/pmtiles/generated/${r.layerId}.pmtiles`;
  const cdnUrl = `${DATA_HOST}/${r2Key}`;
  const cat = r.meta.geometryType === 'point' ? 'Points of Interest' : 'Boundaries';
  if (!mapIds.has(r.base)) {
    maps.maps.push({ id: r.base, name: r.row.title, slug: r.base, category: cat, provider: [r.row.provider],
      dateAdded: null, license: lic, licence: lic, attribution: ATTR[lic],
      files: { source: r.row.providerUrl }, keywords: ['open-data', LICENCE_KW[lic] || 'open', slugify(r.row.provider)],
      references: [{ label: `${r.row.provider} — ${r.row.title}`, url: r.row.providerUrl, note: lic }] });
  }
  const paint = r.meta.geometryType === 'point'
    ? { color: colour, fillColor: colour, fillOpacity: 0.7, weight: 1 }
    : { color: colour, fillColor: colour, fillOpacity: 0.18, weight: 2 };
  const layerEntry = {
    id: r.layerId, sourceMapId: r.base, name: r.row.title, category: cat, group: cat === 'Points of Interest' ? 'Built Environment' : 'Built Environment',
    date: null, dateAdded: null, dateEffective: null, provider: [r.row.provider],
    description: `${r.row.title} — open-data layer from ${r.row.provider} (${lic}). ${ATTR[lic]}`,
    renderer: 'maplibre', sourceType: 'pmtiles', geometryType: r.meta.geometryType,
    sourceLayer: r.meta.sourceLayer, minzoom: 0, maxzoom: 12, bounds: r.meta.bounds,
    style: paint, references: [{ label: `${r.row.provider} — ${r.row.title}`, url: r.row.providerUrl, note: lic }],
    sourceDownloads: [{ label: 'Source file used for /test conversion', file: `render/source-cache/vector-intake/${r.base}.fgb` }],
    sourceCredits: [r.row.provider], keywords: ['open-data', LICENCE_KW[lic] || 'open', cat, 'maplibre', 'vector tiles'],
    labelProperty: r.meta.labelField, labelPropertyFallbacks: [], labelMinZoom: 0, labelMaxZoom: null,
    labelStyle: { color: colour, hoverColor: '#ff7a1a', selectedColor: '#111827', haloColor: '#ffffff', haloWidth: 1.2, haloBlur: 0, fontSize: 12, fontWeight: 'bold', maxWidth: 14, lineHeight: 1.25 },
    sourceFile: `render/source-cache/vector-intake/${r.base}.fgb`, sourceDatasetLayer: r.base,
    tileUrl: NO_UPLOAD ? localUrl : cdnUrl,
    tilePackage: { preferred: true, localPath: `render/pmtiles/generated/${r.layerId}.pmtiles`, url: localUrl, bytes: r.bytes,
      maxGithubBytes: 99614720, generatedAt: '2026-07-08T00:00:00.000Z', serving: NO_UPLOAD ? 'local' : 'cdn',
      cdnUrl, r2Key, localUrl },
    popupProperties: r.meta.stringFields.slice(0, 6), numericProperties: r.meta.numericFields.slice(0, 6), categoricalProperties: []
  };
  const existingIdx = test.layers.findIndex((l) => l.id === r.layerId);
  if (existingIdx >= 0) test.layers[existingIdx] = layerEntry; else test.layers.push(layerEntry);
  added++;
}
writeFileSync(MAPS_PATH, JSON.stringify(maps, null, 2) + '\n');
writeFileSync(TEST_PATH, JSON.stringify(test, null, 2) + '\n');
writeFileSync(resolve(TMP, 'publish-report.json'), JSON.stringify({ converted: ok.length, added, skipped: results.filter((r) => r.error).map((r) => ({ base: r.base, error: r.error })) }, null, 2));
console.log(`authored ${added} layers into maps.json + maps-test.json (upload=${!NO_UPLOAD})`);
