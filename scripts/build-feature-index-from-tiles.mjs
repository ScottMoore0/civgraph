#!/usr/bin/env node
/**
 * Build a layer's feature index from its published tiles, for layers whose source file is
 * not on this machine.
 *
 * build-test-feature-indexes.mjs reads the source file, and skips a layer without one. A
 * layer drawn with promoteId=civ_fid (the source row number build-test-pmtiles injects)
 * then kept an older index keyed on a name -- and ED names repeat across counties
 * (MEELICK is in Galway and in Mayo), so search results and whole-feature areas could not
 * be matched to the feature the map draws. Read from the tiles, the index is keyed on the
 * same civ_fid the map uses: each feature's tile pieces are unioned back into one shape
 * for its centre and its geodesic area and perimeter.
 *
 *   node scripts/build-feature-index-from-tiles.mjs --ids a,b   rebuild these layers' indexes
 *   node scripts/build-feature-index-from-tiles.mjs --missing   every civ_fid layer with no local source
 *
 * Layers sharing one tileset (province aliases) share one index file, built once.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const METADATA = join(ROOT, 'render/metadata/maps-test.json');
const MAX_INDEX_ITEMS = 20000;
const env = { ...process.env, MSYS_NO_PATHCONV: '1', GDAL_HTTP_USERAGENT: 'civgraph-research (+https://civgraph.net)' };

const args = process.argv.slice(2);
const idsAt = args.indexOf('--ids');
const onlyIds = idsAt >= 0 ? new Set(args[idsAt + 1].split(',').map((s) => s.trim()).filter(Boolean)) : null;
const missing = args.includes('--missing');
if (!onlyIds && !missing) {
  console.error('Pass --ids a,b or --missing.');
  process.exit(2);
}

const metadata = JSON.parse(readFileSync(METADATA, 'utf8'));
const layers = Array.isArray(metadata) ? metadata : (metadata.layers || metadata.maps || Object.values(metadata).find(Array.isArray));
const targets = layers.filter((layer) => layer.promoteId === 'civ_fid' && layer.featureIndexUrl && layer.tileUrl
  && (onlyIds ? onlyIds.has(layer.id) : !(layer.sourceFile && existsSync(join(ROOT, layer.sourceFile)))));

const run = (cmd, cmdArgs) => spawnSync(cmd, cmdArgs, { encoding: 'utf8', env, maxBuffer: 512 * 1024 * 1024 });
const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') inQuotes = false; else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0]);
}

// The same name fields build-test-feature-indexes.mjs uses, so results read the same.
function nameProperties(layer, fields) {
  const guessed = (layer.popupProperties || [])
    .filter((key) => /name|label|title|english|gaeilge|irish|county|sett|lea|district|division|region/i.test(key));
  return [...new Set([layer.labelProperty, ...(layer.labelPropertyFallbacks || []), ...guessed])]
    .filter((key) => key && fields.has(key));
}

const done = new Set();
let built = 0;
for (const layer of targets) {
  if (done.has(layer.featureIndexUrl)) continue;
  done.add(layer.featureIndexUrl);
  const tilePath = `/vsicurl/${layer.tileUrl}`;
  const info = run('ogrinfo', ['-ro', '-so', '-al', tilePath, '-oo', 'ZOOM_LEVEL=0']);
  const tileLayer = (info.stdout.match(/^Layer name: (.+)$/m) || [])[1]?.trim();
  if (!tileLayer) { console.error(`${layer.id}: could not open ${layer.tileUrl}`); process.exitCode = 1; continue; }
  const fields = new Set([...info.stdout.matchAll(/^(\S[^:]*): (?:String|Integer|Integer64|Real)/gm)].map((m) => m[1]));
  if (!fields.has('civ_fid')) { console.error(`${layer.id}: the tiles carry no civ_fid`); process.exitCode = 1; continue; }
  const names = nameProperties(layer, fields);
  if (!names.length) { console.error(`${layer.id}: no name field in the tiles`); process.exitCode = 1; continue; }

  // Deepest zoom: the pieces there are the least simplified, so the union measures best.
  const zoom = Number.isFinite(layer.maxzoom) ? layer.maxzoom : 12;
  const work = join(tmpdir(), `civgraph-tile-index-${process.pid}.gpkg`);
  rmSync(work, { force: true });
  const fetched = run('ogr2ogr', ['-f', 'GPKG', work, tilePath, tileLayer, '-oo', `ZOOM_LEVEL=${zoom}`,
    '-t_srs', 'EPSG:4326', '-nln', 'pieces', '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures',
    '-select', ['civ_fid', ...names].join(',')]);
  if (!existsSync(work)) { console.error(`${layer.id}: ${fetched.stderr.slice(0, 300)}`); process.exitCode = 1; continue; }

  // Neighbouring tile pieces meet along quantised edges, so a plain union keeps hairline
  // seams that add to the perimeter (the 95th percentile read 36% long against the source).
  // Growing and shrinking by ~3 m -- about one z12 tile unit -- closes them; area moves by
  // well under 0.1%.
  const closed = 'ST_Buffer(ST_Buffer(whole, 0.00003), -0.00003)';
  const columns = [
    'civ_fid',
    ...names.map((name) => quote(name)),
    'ST_X(ST_PointOnSurface(whole)) AS lon',
    'ST_Y(ST_PointOnSurface(whole)) AS lat',
    'ST_Area(whole, 1) AS area_m2',
    `ST_Perimeter(${closed}, 1) AS perimeter_m`
  ];
  const merged = `SELECT civ_fid, ${names.map((name) => `MAX(${quote(name)}) AS ${quote(name)}`).join(', ')}, `
    + 'ST_Union(ST_MakeValid(geom)) AS whole FROM pieces GROUP BY civ_fid';
  const result = run('ogr2ogr', ['-f', 'CSV', '/vsistdout/', work, '-dialect', 'SQLite',
    '-sql', `SELECT ${columns.join(', ')} FROM (${merged}) ORDER BY civ_fid`]);
  rmSync(work, { force: true });
  if (result.status !== 0) { console.error(`${layer.id}: ${result.stderr.slice(0, 300)}`); process.exitCode = 1; continue; }

  const [header, ...rows] = parseCsv(result.stdout);
  const items = rows.map((row) => Object.fromEntries(header.map((key, i) => [key, row[i]]))).map((props) => {
    const aliases = names.map((key) => String(props[key] ?? '').trim()).filter(Boolean);
    const lon = Number(props.lon);
    const lat = Number(props.lat);
    const areaM2 = Number(props.area_m2);
    const perimeterM = Number(props.perimeter_m);
    return {
      id: Number(props.civ_fid),
      name: aliases[0],
      aliases,
      center: Number.isFinite(lon) && Number.isFinite(lat) && props.lon !== '' ? [Number(lon.toFixed(6)), Number(lat.toFixed(6))] : null,
      ...(areaM2 > 0 ? { areaM2: Math.round(areaM2) } : {}),
      ...(perimeterM > 0 ? { perimeterM: Math.round(perimeterM) } : {})
    };
  }).filter((item) => Number.isFinite(item.id) && item.name);

  const indexPath = join(ROOT, layer.featureIndexUrl.replace(/^\//, ''));
  mkdirSync(dirname(indexPath), { recursive: true });
  const capped = items.slice(0, MAX_INDEX_ITEMS);
  writeFileSync(indexPath, `${JSON.stringify({
    layerId: layer.id,
    itemLimit: MAX_INDEX_ITEMS,
    totalItems: items.length,
    truncated: items.length > capped.length,
    items: capped
  })}\n`);
  console.log(`${layer.id}: ${capped.length} features from tiles (z${zoom})`);
  built += 1;
}
console.log(`Built ${built} feature index(es) from tiles.`);
