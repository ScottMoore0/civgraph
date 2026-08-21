#!/usr/bin/env node
/**
 * Was each PUBLISHED archive built from the source that is on disk today?
 *
 * WHY check:tile-freshness IS NOT ENOUGH
 *
 * That check compares modification times: it fails when a source is newer than its
 * archive. It cannot fail when the archive is newer and WRONG, and that is the case
 * that actually occurred. niah-buildings' published archive was 19 MB where its source
 * yields 204 MB, and carried ten attribute columns where the source has twelve. The
 * freshness check passed the whole time, because an archive fetched from R2 gets a
 * fresh mtime for free. An mtime is evidence about a filesystem operation. It is not
 * evidence about content.
 *
 * WHAT THIS COMPARES, AND WHY NOT A REBUILD
 *
 * The attribute SCHEMA. Every field in the source should appear in the archive's
 * highest-zoom tile; a field present in the source and absent from the archive means
 * the archive was built from a different version of that source. That is the exact
 * symptom niah showed, it is cheap -- one local ogrinfo and one ranged fetch per layer
 * -- and it needs no rebuild.
 *
 * It is a ONE-WAY test and says so. A schema that matches does not prove the geometry
 * matches; a source can be re-cut with corrected boundaries and identical columns, which
 * is precisely what happened to the ROI local-authority layers in August. Read a PASS
 * here as "no schema drift detected", never as "the archive is current".
 *
 * Fields this build injects or removes deliberately are excluded: civ_fid is added by
 * the builder, and free-text columns are dropped from tiles on purpose.
 *
 * Network-dependent. verify:, not check:.
 *
 *   node scripts/audit-tile-source-staleness.mjs [--limit N] [--ids a,b]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const METADATA = 'test/metadata/maps-test.json';
const REPORT = 'test/metadata/tile-staleness-report.json';
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const LIMIT = Number(arg('--limit')) || Infinity;
const ONLY = new Set(String(arg('--ids') || '').split(',').map((s) => s.trim()).filter(Boolean));
if (argv.includes('--ids') && !ONLY.size) {
  console.error('FAIL: --ids was given with no layer ids.');
  process.exit(2);
}

// Injected by the builder. Its absence from a source is not drift.
const BUILDER_ADDED = new Set(['civ_fid']);
// Must match TILE_MAX_FIELD_CHARS in build-test-pmtiles.mjs: fields this long are
// dropped from tiles deliberately, so their absence is expected, not drift.
const PROSE_CHARS = 200;

/**
 * Mean value length per source field, over a sample.
 *
 * Two kinds of field are legitimately absent from a tile and must not be reported:
 * prose, which the builder drops on purpose, and columns that are null on every
 * feature, which never reach the tile's key dictionary because MVT has nothing to
 * write. Both are indistinguishable from a dropped column at the tile end, so they have
 * to be identified from the source.
 */
function sourceFieldLengths(path) {
  const r = spawnSync('ogr2ogr', ['-f', 'GeoJSON', '/vsistdout/', path, '-limit', '300', '-lco', 'WRITE_BBOX=NO'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return null;
  let features;
  try { features = JSON.parse(r.stdout).features || []; } catch { return null; }
  const total = new Map();
  const count = new Map();
  for (const f of features) {
    for (const [k, v] of Object.entries(f.properties || {})) {
      total.set(k, (total.get(k) || 0) + String(v ?? '').length);
      count.set(k, (count.get(k) || 0) + 1);
    }
  }
  const means = new Map();
  for (const [k, t] of total) means.set(k, t / (count.get(k) || 1));
  return means;
}

class HttpSource {
  constructor(url) { this.url = url; }
  getKey() { return this.url; }
  async getBytes(offset, length) {
    const res = await fetch(this.url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      cache: 'no-store'
    });
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
    return { data: await res.arrayBuffer() };
  }
}

function sourceFields(path) {
  const r = spawnSync('ogrinfo', ['-so', '-al', '-json', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return null;
  try {
    return ((JSON.parse(r.stdout).layers || [])[0]?.fields || []).map((f) => f.name);
  } catch { return null; }
}

/** Fields in the archive, read from the densest tile at the archive's max zoom. */
async function archiveFields(url) {
  const pm = new PMTiles(new HttpSource(url));
  const header = await pm.getHeader();
  const z = header.maxZoom;
  // Walk out from the centre of the archive's own bounds rather than scanning 4^z tiles.
  const lon = (header.minLon + header.maxLon) / 2;
  const lat = (header.minLat + header.maxLat) / 2;
  const n = 2 ** z;
  const cx = Math.floor(((lon + 180) / 360) * n);
  const cy = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  // UNION ACROSS SEVERAL TILES, not the first one found. A tile's key dictionary lists
  // only the fields something in that tile populates, so a single rural tile reports
  // STREET1 and TOWN as absent from an urban buildings layer -- which this audit read as
  // drift on its first run. Several tiles spread across the archive is still cheap and
  // is far closer to the layer's real schema.
  const seen = new Set();
  let found = false;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2], [4, 4], [-4, -4], [8, 0], [0, 8]]) {
    const tile = await pm.getZxy(z, cx + dx, cy + dy).catch(() => null);
    if (!tile) continue;
    const vt = new VectorTile(new Pbf(Buffer.from(tile.data)));
    const name = Object.keys(vt.layers)[0];
    if (!name || !vt.layers[name].length) continue;
    const L = vt.layers[name];
    // The TILE'S KEY DICTIONARY, not one feature's properties. MVT omits a field from a
    // feature when its value is null, so reading feature(0) reports the fields that
    // happen to be populated on whichever feature came first -- which made this audit
    // report six healthy layers as stale on its first run. The key table is the schema.
    found = true;
    if (Array.isArray(L._keys) && L._keys.length) {
      for (const key of L._keys) seen.add(key);
    } else {
      for (let i = 0; i < Math.min(L.length, 500); i++) {
        for (const key of Object.keys(L.feature(i).properties)) seen.add(key);
      }
    }
  }
  return found ? [...seen] : null;
}

const doc = JSON.parse(readFileSync(METADATA, 'utf8'));
const layers = (doc.layers || []).filter((l) => l.sourceType === 'pmtiles'
  && l.sourceFile && existsSync(l.sourceFile)
  && /^https:\/\/data\.civgraph\.net\//i.test(l.tileUrl || '')
  && (!ONLY.size || ONLY.has(l.id)));

console.log(`Auditing ${Math.min(layers.length, LIMIT)} of ${layers.length} published layer(s) with a local source.\n`);

const stale = [];
const unreadable = [];
let clean = 0;
let done = 0;

for (const layer of layers) {
  if (done >= LIMIT) break;
  done += 1;
  const src = sourceFields(layer.sourceFile);
  if (!src) { unreadable.push({ id: layer.id, why: 'source unreadable' }); continue; }
  let arc;
  try { arc = await archiveFields(layer.tileUrl); } catch (e) { arc = null; var err = e.message; }
  if (!arc) { unreadable.push({ id: layer.id, why: `archive unreadable${err ? `: ${err}` : ''}` }); continue; }
  const have = new Set(arc);
  const lengths = sourceFieldLengths(layer.sourceFile) || new Map();
  const expectedAbsent = (f) => {
    const mean = lengths.get(f);
    if (mean === undefined) return false;      // not sampled: judge it normally
    return mean === 0 || mean > PROSE_CHARS;   // never populated, or dropped as prose
  };
  const missing = src.filter((f) => !have.has(f) && !BUILDER_ADDED.has(f) && !expectedAbsent(f));
  if (missing.length) {
    stale.push({ id: layer.id, sourceFields: src.length, archiveFields: arc.length, missing });
    console.log(`  STALE  ${layer.id}`);
    console.log(`         source has ${src.length} field(s), archive has ${arc.length}; missing: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ` (+${missing.length - 6})` : ''}`);
  } else {
    clean += 1;
  }
  if (done % 25 === 0) console.log(`  ... ${done}/${Math.min(layers.length, LIMIT)} checked, ${stale.length} stale so far`);
}

writeFileSync(REPORT, `${JSON.stringify({
  schemaVersion: 1,
  note: 'Schema-drift audit. A clean result does NOT prove geometry is current.',
  checked: done,
  clean,
  stale,
  unreadable
}, null, 2)}\n`);

console.log(`\nChecked ${done}. Clean ${clean}. Stale ${stale.length}. Unreadable ${unreadable.length}.`);
console.log(`Report: ${REPORT}`);
console.log('\nA clean result means no SCHEMA drift. It does not mean the geometry is current --');
console.log('a re-cut source with identical columns looks identical to this audit.');
process.exitCode = stale.length ? 1 : 0;
