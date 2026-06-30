/**
 * Build per-map feature-attribute pages for the Browse "Features in this layer"
 * table. For each map layer with an .fgb download, the source file is fetched to
 * the OS temp directory, parsed in a streaming fashion, and written out as a
 * sharded set under data/browse/map-features/<id>/:
 *   - meta.json : { mapId, mapTitle, total, pageSize, pageCount, propertyKeys }
 *   - <n>.json  : an array of up to pageSize features { name, bbox, properties }
 *
 * Geometry is never stored (only attributes + bbox), and pages are written as
 * they fill so memory stays bounded even for 100k+ feature layers. The temp
 * .fgb is deleted immediately after parsing so nothing accumulates on disk.
 *
 * These files are uploaded to R2 (data.civgraph.net) and fetched lazily,
 * page-by-page, by the Browse map detail page only — never by the homepage.
 *
 * Usage:
 *   node scripts/build-map-feature-attributes.mjs            # all maps with an .fgb
 *   node scripts/build-map-feature-attributes.mjs --map <id> # a single map
 *   node scripts/build-map-feature-attributes.mjs --limit 20 # first N maps
 */
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAPS_JSON = join(ROOT, 'data', 'browse', 'maps.json');
const OUT_DIR = join(ROOT, 'data', 'browse', 'map-features');
const PAGE_SIZE = Number(process.env.MAP_FEATURE_PAGE_SIZE || 1000);
const DATA_BASE = process.env.MAP_DATA_BASE || 'https://data.civgraph.net/';

const args = process.argv.slice(2);
const onlyMap = args.includes('--map') ? args[args.indexOf('--map') + 1] : null;
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : null;

function fgbUrl(item) {
  for (const link of [...(item.downloads || []), ...(item.sourceFiles || [])]) {
    const url = link && link.url;
    if (typeof url === 'string' && url.toLowerCase().endsWith('.fgb')) {
      return /^https?:\/\//i.test(url) ? url : DATA_BASE + url.replace(/^\/+/, '');
    }
  }
  return null;
}

function eachCoord(geometry, visit) {
  if (!geometry || !geometry.coordinates) return;
  const walk = (coords) => {
    if (typeof coords[0] === 'number') { visit(coords[0], coords[1]); return; }
    for (const part of coords) walk(part);
  };
  walk(geometry.coordinates);
}

function computeBbox(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  eachCoord(geometry, (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  });
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

function pickName(properties, labelProperty) {
  if (labelProperty && properties[labelProperty] != null) return String(properties[labelProperty]).trim();
  for (const key of ['Name', 'NAME', 'name']) if (properties[key] != null) return String(properties[key]).trim();
  for (const value of Object.values(properties)) if (typeof value === 'string' && value.trim()) return value.trim();
  return '';
}

async function processMap(item) {
  const url = fgbUrl(item);
  if (!url) return { skipped: 'no-fgb' };
  const dir = join(OUT_DIR, item.id);
  if (existsSync(join(dir, 'meta.json'))) return { skipped: 'exists' };
  const tmpPath = join(tmpdir(), `cg-fgb-${item.id}-${process.pid}.fgb`);
  try {
    const response = await fetch(url);
    if (!response.ok) return { skipped: `http-${response.status}` };
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(tmpPath, buffer);
    mkdirSync(dir, { recursive: true });

    const propertyKeys = [];
    let total = 0;
    let pageIndex = 0;
    let page = [];
    const flush = () => {
      if (!page.length) return;
      writeFileSync(join(dir, `${pageIndex}.json`), JSON.stringify(page));
      pageIndex += 1;
      page = [];
    };
    for await (const feature of deserialize(new Uint8Array(buffer))) {
      total += 1;
      const properties = feature.properties || {};
      if (total <= 200) for (const key of Object.keys(properties)) if (!propertyKeys.includes(key)) propertyKeys.push(key);
      page.push({
        name: pickName(properties, item.labelProperty),
        bbox: feature.bbox || computeBbox(feature.geometry),
        properties
      });
      if (page.length >= PAGE_SIZE) flush();
    }
    flush();
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({
      mapId: item.id,
      mapTitle: item.title,
      total,
      pageSize: PAGE_SIZE,
      pageCount: pageIndex,
      propertyKeys
    }));
    return { ok: true, total, pageCount: pageIndex };
  } catch (error) {
    return { skipped: `error:${error.message}` };
  } finally {
    if (existsSync(tmpPath)) rmSync(tmpPath, { force: true });
  }
}

async function main() {
  const maps = JSON.parse(readFileSync(MAPS_JSON, 'utf8'));
  const items = (Array.isArray(maps) ? maps : maps.items || []).filter(fgbUrl);
  let pool = onlyMap ? items.filter((item) => item.id === onlyMap || item.slug === onlyMap) : items;
  if (limit) pool = pool.slice(0, limit);
  console.log(`Processing ${pool.length} map layer(s) (page size ${PAGE_SIZE})...`);
  let ok = 0, skipped = 0;
  for (const item of pool) {
    const result = await processMap(item);
    if (result.ok) {
      ok += 1;
      console.log(`  ✓ ${item.id}: ${result.total} features in ${result.pageCount} page(s)`);
    } else {
      skipped += 1;
      if (result.skipped !== 'exists') console.warn(`  ⚠ ${item.id}: ${result.skipped}`);
    }
  }
  console.log(`Done. ${ok} written, ${skipped} skipped.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
