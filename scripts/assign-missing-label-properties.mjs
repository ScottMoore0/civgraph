#!/usr/bin/env node
/**
 * Give published polygon layers a labelProperty chosen from their own tiles.
 *
 * WHAT IS WRONG
 *
 * 82 of 404 published polygon vector layers have no `labelProperty` at all, so hovering
 * or selecting a feature shows no name -- on a fifth of the polygon catalogue. The
 * tech-debt audit scored this at FOUR layers; measured on 2026-08-23 it is 82.
 *
 * THE TILE IS THE AUTHORITY, NOT THE CATALOGUE
 *
 * labelProperty is not a display string: it adds a symbol layer that draws text from that
 * attribute. Naming an attribute the tiles do not carry renders NOTHING and complains
 * about nothing, so a wrong value is invisible and looks like a broken layer rather than
 * broken metadata. sync-label-properties.mjs already learned this the hard way --
 * hed-listed-buildings labelled by `OWNER`, which is not in its tiles at all.
 *
 * So this reads each layer's actual tiles (local archive when present, otherwise range
 * requests against the published PMTiles on the CDN) and only ever proposes an attribute
 * that is really there.
 *
 * HOW A CANDIDATE IS CHOSEN
 *
 * Ranked patterns, most specific first, and a field must also LOOK like a label when
 * sampled: a string, not empty, and not identical across every sampled feature (a column
 * holding one repeated value is a category, not a name).
 *
 * Anything ambiguous is REPORTED, NOT GUESSED. A layer with no name-like attribute keeps
 * no labelProperty, because "no label" is honest and a wrong label is not.
 *
 *   node scripts/assign-missing-label-properties.mjs            # report only
 *   node scripts/assign-missing-label-properties.mjs --write    # apply to maps.json
 */
import { readFileSync, writeFileSync, existsSync, openSync, readSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';

const CATALOGUE = 'data/database/maps.json';
const RENDER = 'render/metadata/maps-test.json';
const WRITE = process.argv.includes('--write');

// Most specific first. Case-insensitive, matched against the whole attribute name.
const EXACT = [
  'name', 'fullname', 'full_name', 'label', 'title',
  'townland', 'parish', 'barony', 'county', 'province', 'ward', 'dea', 'lgd',
  'constituency', 'english', 'unitname', 'area_name', 'areaname',
  // Place-name columns that are not called "name". `settlement` holds the actual
  // settlement name on the settlement-boundary layers, so omitting it left a layer whose
  // every feature IS a named place with no label at all.
  'settlement', 'town', 'village', 'locality',
];
// Then a name-bearing word as a whole segment: ED_NAME, CP_NAME, LGD_NAME, and also
// TD_ENGLISH and `nametext`. `english` earns a place because the Irish-language layers
// pair an ENGLISH column with an IRISH one and the English name is the label -- the
// eds-* layers already use exactly that convention.
const SUFFIXED = /(^|_)(name(text)?|nm|label|title|english)(_|$)/i;
// Never a label, whatever else matches.
const NEVER = /^(civ_fid|fid|objectid|gid|id|uid|uuid|shape_|st_|geom)/i;

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const render = JSON.parse(readFileSync(RENDER, 'utf8'));

const layerByMapId = new Map();
for (const layer of render.layers || []) {
  const geometry = String(layer.geometryType || '').toLowerCase();
  if (layer.sourceType !== 'pmtiles') continue;
  if (geometry !== 'polygon' && geometry !== 'multipolygon') continue;
  if (!layerByMapId.has(layer.sourceMapId)) layerByMapId.set(layer.sourceMapId, layer);
}

// TARGET THE RENDER RECORD, NOT THE CATALOGUE.
//
// I first measured this against maps.json and reported "82 published polygon layers show
// no name". That was wrong by roughly three times. The RENDERER reads
// render/metadata/maps-test.json, and 54 of those 82 already carried a labelProperty
// there -- the two files were simply out of sync, in the direction that does not hurt.
// The user-visible gap was 28.
//
// A layer is a target if the render record has no labelProperty. The catalogue is filled
// in alongside it so the two stop drifting.
const targets = (catalogue.maps || []).filter((map) =>
  !map.hidden && !map.placeholder && layerByMapId.has(map.id)
  && !layerByMapId.get(map.id).labelProperty);

class FileSource {
  constructor(path) { this.path = path; this.fd = openSync(path, 'r'); }
  getKey() { return this.path; }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    readSync(this.fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + length) };
  }
}

class HttpSource {
  constructor(url) { this.url = url; }
  getKey() { return this.url; }
  async getBytes(offset, length) {
    const response = await fetch(this.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
    return { data: await response.arrayBuffer() };
  }
}

/** Sample feature properties from the first non-empty tile we can find. */
async function sampleProperties(source) {
  const archive = new PMTiles(source);
  const header = await archive.getHeader();
  const zoom = Math.min(header.maxZoom, Math.max(header.minZoom, 5));
  const side = 2 ** zoom;
  const samples = [];
  for (let x = 0; x < side && samples.length < 40; x += 1) {
    for (let y = 0; y < side && samples.length < 40; y += 1) {
      const tile = await archive.getZxy(zoom, x, y);
      if (!tile?.data) continue;
      let buf = Buffer.from(tile.data);
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
      const parsed = new VectorTile(new Protobuf(buf));
      for (const name of Object.keys(parsed.layers)) {
        const layer = parsed.layers[name];
        for (let i = 0; i < Math.min(layer.length, 40) && samples.length < 40; i += 1) {
          samples.push(layer.feature(i).properties);
        }
      }
    }
  }
  return samples;
}

/** Rank the attributes present in the samples and return the best label, or null. */
function chooseLabel(samples) {
  if (!samples.length) return { field: null, reason: 'no features sampled' };
  const fields = new Set();
  for (const properties of samples) for (const key of Object.keys(properties)) fields.add(key);

  const usable = (field) => {
    const values = samples.map((properties) => properties[field]).filter((value) => value !== undefined && value !== null);
    if (!values.length) return false;
    if (!values.every((value) => typeof value === 'string')) return false;
    if (values.some((value) => !value.trim())) return false;
    // A column holding one repeated value is a category, not a name.
    return new Set(values).size > 1;
  };

  const candidates = [...fields].filter((field) => !NEVER.test(field));
  for (const wanted of EXACT) {
    const hit = candidates.find((field) => field.toLowerCase() === wanted);
    if (hit && usable(hit)) return { field: hit, reason: 'exact' };
  }
  const suffixed = candidates.filter((field) => SUFFIXED.test(field) && usable(field));
  if (suffixed.length === 1) return { field: suffixed[0], reason: 'suffix' };
  if (suffixed.length > 1) return { field: null, reason: `ambiguous: ${suffixed.join(', ')}` };
  return { field: null, reason: `no name-like attribute (${[...fields].slice(0, 8).join(', ')})` };
}

const chosen = [];
const skipped = [];
let index = 0;
for (const map of targets) {
  index += 1;
  const layer = layerByMapId.get(map.id);
  const localPath = `render/pmtiles/generated/${layer.id}.pmtiles`;
  let source = null;
  if (existsSync(localPath)) source = new FileSource(localPath);
  else if (layer.tileUrl) source = new HttpSource(layer.tileUrl);
  if (!source) { skipped.push({ id: map.id, reason: 'no local archive and no tileUrl' }); continue; }

  try {
    const samples = await sampleProperties(source);
    const { field, reason } = chooseLabel(samples);
    if (field) chosen.push({ id: map.id, field, reason });
    else skipped.push({ id: map.id, reason });
  } catch (error) {
    skipped.push({ id: map.id, reason: `read failed: ${error.message}` });
  }
  if (index % 10 === 0) console.error(`  ...${index}/${targets.length}`);
}

console.log(`\n${targets.length} published polygon layer(s) without a labelProperty.`);
console.log(`  chosen from their own tiles : ${chosen.length}`);
console.log(`  left unset, reported below  : ${skipped.length}\n`);
for (const row of chosen) console.log(`  SET  ${row.id.padEnd(52)} -> ${row.field}`);
console.log('');
for (const row of skipped) console.log(`  SKIP ${row.id.padEnd(52)} ${row.reason}`);

if (WRITE && chosen.length) {
  const byId = new Map((catalogue.maps || []).map((map) => [map.id, map]));
  for (const row of chosen) byId.get(row.id).labelProperty = row.field;
  writeFileSync(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`);

  // Write the RENDER record too. The renderer reads that, not the catalogue, so a value
  // set only in maps.json draws no labels. sync-label-properties.mjs would normally
  // propagate it, but it can only adopt a value it can verify against a LOCAL archive,
  // and 69 of these 82 layers have none. This script has already verified every value
  // against the layer's real tiles -- reading the published PMTiles over HTTP where there
  // is no local copy -- which is the same authority, obtained a different way.
  for (const row of chosen) {
    const layer = layerByMapId.get(row.id);
    if (layer) layer.labelProperty = row.field;
  }
  writeFileSync(RENDER, `${JSON.stringify(render, null, 2)}\n`);
  console.log(`\nWrote ${chosen.length} labelProperty value(s) into ${CATALOGUE} and ${RENDER}.`);
} else if (chosen.length) {
  console.log('\n(dry run -- pass --write to apply)');
}
