#!/usr/bin/env node
/**
 * ADVISORY ONLY. NOT WIRED INTO `npm run verify`, AND SHOULD NOT BE.
 *
 * This check cannot distinguish the thing it was built to find from a benign one, and
 * that was established the hard way. After rebuilding two layers from the exact source
 * on disk and republishing them, it still reported both stale. A staleness check that
 * fires on an archive built minutes earlier from the file it is compared against is not
 * measuring staleness.
 *
 * The cause is structural, not a bug to fix. GDAL's MVT writer omits a column that is
 * null across the features it writes, and the source sample here reads 300 features, so
 * a sparsely-populated column is indistinguishable from a dropped one. Successive
 * versions of this script reported 22, then 8, then 7 stale layers; of the final 7 at
 * least five were its own artefacts, and all seven were rebuilt and republished on the
 * strength of them. No harm done -- the rebuilds were faithful -- but the work was
 * spent on a false signal.
 *
 * It is kept because the reasoning is worth having and the tool is occasionally useful
 * for a hand-checked single layer. Treat every finding as a question, never a verdict,
 * and confirm by scanning the archive yourself before acting.
 *
 * THE REPLACEMENT is a source content hash: record sha256 of the source at build time
 * in generatedFrom, compare later. It has no false-positive mode, it is exact, and the
 * whole 2.9 GB source corpus hashes in 3.3 seconds. Build that instead of trusting
 * this.
 */
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
 * READ THE WHOLE ARCHIVE, LOCALLY. NOT A SAMPLE, NOT OVER HTTP.
 *
 * This was written three times against sampled tiles and produced false positives every
 * time, because a tile's key dictionary is a LOWER BOUND on the schema: MVT omits a
 * field from a feature whose value is null, so a field populated on 2 of 7 features
 * appears only in the tiles holding those 2. Sampling cannot recover the schema, and
 * probing more neighbours does not fix it -- it only moves the threshold at which the
 * wrong answer appears.
 *
 * Measured, britain-ireland-seas: the sampled probe reported six elevation columns
 * missing. Scanning all ten tiles at z5 found every one of them. Of the seven layers
 * reported stale on 2026-08-21, at least five were the audit's own artefacts -- and
 * they were rebuilt and republished before anyone noticed.
 *
 * So: union the keys across EVERY tile at a modest zoom, from the LOCAL archive. Local
 * reads make a full scan cheap where 1,024 ranged HTTP fetches per layer would not be.
 *
 * PRUNED LAYERS ARE SKIPPED, not sampled. Below their cutoff they carry only identity
 * and name fields by design; their high-zoom schema is known by construction.
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
import { readFileSync, writeFileSync, existsSync, openSync, readSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PMTiles } from 'pmtiles';
import { getTileProfile } from './test-tile-profiles.mjs';
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
/**
 * Fields present in the archive, read from a real tile near its deepest zoom.
 *
 * FINDING A TILE BY GUESSING DOES NOT WORK. The first version computed the tile
 * containing the centre of the archive's bounds and probed a dozen neighbours. That
 * failed on 45 of 521 layers -- 9% -- and it failed for a reason worth keeping: the
 * centre of a layer's bounding box is very often empty. A border-crossings layer is a
 * line along an edge, a seas layer is a ring around a coast, a potholes layer is
 * wherever the potholes are. None of them has anything in the middle.
 *
 * So descend the quadtree instead of guessing. Start at the root, and at each level
 * take the first of the four children that exists. That follows the data wherever it
 * actually is, costs four fetches per level, and cannot miss a populated archive.
 */
class FileSource {
  constructor(path) { this.path = path; this.fd = openSync(path, 'r'); }
  getKey() { return this.path; }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    readSync(this.fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + length) };
  }
}

/** Union of attribute keys across EVERY tile at a modest zoom. See the header. */
async function archiveFields(localPath) {
  const pm = new PMTiles(new FileSource(localPath));
  const header = await pm.getHeader();
  // z5 is 1,024 lookups at most and covers these islands at a useful density. Deeper
  // buys nothing here: a field either exists somewhere in the layer or it does not.
  const z = Math.min(header.maxZoom, Math.max(header.minZoom, 5));
  const n = 2 ** z;
  const keys = new Set();
  let tiles = 0;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      const tile = await pm.getZxy(z, x, y).catch(() => null);
      if (!tile) continue;
      tiles += 1;
      const vt = new VectorTile(new Pbf(Buffer.from(tile.data)));
      for (const name of Object.keys(vt.layers)) {
        const L = vt.layers[name];
        if (Array.isArray(L._keys)) for (const key of L._keys) keys.add(key);
        else for (let i = 0; i < Math.min(L.length, 200); i++) {
          for (const key of Object.keys(L.feature(i).properties)) keys.add(key);
        }
      }
    }
  }
  return tiles ? [...keys] : null;
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
let skippedPruned = 0;

for (const layer of layers) {
  if (done >= LIMIT) break;
  done += 1;
  const src = sourceFields(layer.sourceFile);
  if (!src) { unreadable.push({ id: layer.id, why: 'source unreadable' }); continue; }
  let arc;
  const cutoff = getTileProfile(layer.sourceMapId || layer.id).lowZoomAttributeCutoff;
  if (cutoff !== undefined) {
    skippedPruned += 1;
    continue;   // schema is known by construction -- see the header
  }
  const localArchive = `test/pmtiles/generated/${layer.id}.pmtiles`;
  if (!existsSync(localArchive)) {
    unreadable.push({ id: layer.id, why: 'no local archive to read; run the build first' });
    continue;
  }
  try { arc = await archiveFields(localArchive); } catch (e) { arc = null; var err = e.message; }
  if (!arc) { unreadable.push({ id: layer.id, why: `archive has no tiles at the scanned zoom${err ? `: ${err}` : ''}` }); continue; }
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
  // A --ids or --limit run writes this file too, and "checked: 4" from a spot check
  // sitting where a full corpus report is expected is exactly the kind of artefact
  // someone reads the wrong way a month later. Say which kind of run produced it.
  scope: (ONLY.size || LIMIT !== Infinity)
    ? `PARTIAL RUN -- ${ONLY.size ? `--ids (${ONLY.size} layer(s))` : `--limit ${LIMIT}`}. Not a corpus-wide result.`
    : 'full corpus',
  checked: done,
  clean,
  skippedPruned,
  stale,
  unreadable
}, null, 2)}\n`);

console.log(`\nChecked ${done}. Clean ${clean}. Stale ${stale.length}. Unreadable ${unreadable.length}.`);
console.log(`Report: ${REPORT}`);
console.log('\nA clean result means no SCHEMA drift. It does not mean the geometry is current --');
console.log('a re-cut source with identical columns looks identical to this audit.');
process.exitCode = stale.length ? 1 : 0;
