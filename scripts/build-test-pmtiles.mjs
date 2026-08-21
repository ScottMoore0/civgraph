#!/usr/bin/env node
/**
 * Build PMTiles archives for converted /test vector layers.
 *
 * The constrained path is GDAL's writable PMTiles driver. We deliberately keep
 * directory MVT as a fallback in metadata so a bad or oversized archive cannot
 * strand a layer.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getTileProfile } from './test-tile-profiles.mjs';
import { isPrimaryKey } from '../test/src/feature-details.js';

// Mean value length above which a field is treated as free text and dropped from
// low-zoom tiles. Sits above any realistic categorical value or code, well below prose.
// Declared here rather than beside its use: lowZoomColumns runs during the top-level
// build loop, so a `const` defined further down the file is still in its temporal dead
// zone when the first layer is processed.
const LOW_ZOOM_MAX_FIELD_CHARS = 40;

// Mean value length above which a field is not renderable data at all and is excluded
// from EVERY zoom, not just the low ones.
//
// historic-ringfort-cashel's DESCRIPTION averages ~900 characters -- an archaeological
// report per feature. Pruning it below z8 took that layer's low-zoom tiles from 4.9 MB
// to 312 KB and left its z8+ tiles at 5.0 MB, over the project's 4 MB hard budget,
// because the prose simply reappeared. A vector tile is a rendering payload; prose is
// never rendered from one. It stays available in the layer's FlatGeobuf download and on
// its Browse detail page, which is where a reader of it actually goes.
const TILE_MAX_FIELD_CHARS = 200;

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const REPORT_PATH = resolve(ROOT, 'test/metadata/pmtiles-build-report.json');
const OUTPUT_DIR = resolve(ROOT, 'test/pmtiles/generated');
const DECIDUOUS_LOD0_SOURCE = 'data/maps/biodiversity/habitat-deciduous-woodland-lod0.fgb';
const DECIDUOUS_LOD1_SOURCE = 'data/maps/biodiversity/habitat-deciduous-woodland-lod1.fgb';
const WGS84_UNKNOWN_SRS_IDS = new Set([
  'ireland-island',
  'ni-1921',
  'roi-1938',
  'historic-bullaun-stones',
  'historic-crannog',
  'historic-ringfort-cashel',
  'historic-ringfort-rath',
  'historic-ringfort-unclassified',
  'historic-rock-scribing',
  'historic-standing-stones',
  'historic-wedge-tomb',
  'transport-lines-road-rail',
  'dcc-dcc-public-cycle-parking-stands'
]);
const MAX_GITHUB_BYTES = readNumberArg('--max-github-mb', 95) * 1024 * 1024;
const EXECUTE = !process.argv.includes('--report-only');
const FORCE = process.argv.includes('--force');
const NO_METADATA = process.argv.includes('--no-metadata');
const IDS = readIds();

const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const layers = (metadata.layers || [])
  .filter((layer) => ['mvt', 'pmtiles'].includes(layer.sourceType))
  .filter((layer) => !layer.aliasOf)
  .filter((layer) => layer.sourceFile)
  .filter((layer) => !IDS.size || IDS.has(layer.id) || IDS.has(layer.sourceMapId));

const tools = {
  ogr2ogr: findCommand('ogr2ogr'),
  ogrinfo: findCommand('ogrinfo'),
  sqlite3: findCommand('sqlite3')
};
const pmtilesDriver = tools.ogr2ogr ? hasGdalPmtilesDriver(tools.ogr2ogr) : false;
const converted = [];
const skipped = [];
const failed = [];

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const layer of layers) {
  const outputPath = resolve(OUTPUT_DIR, `${layer.id}.pmtiles`);
  const sourcePath = resolve(ROOT, layer.sourceFile.replace(/^\//, ''));
  if (!existsSync(sourcePath)) {
    skipped.push(row(layer, 'missing-source', { sourceFile: layer.sourceFile }));
    continue;
  }
  if (!tools.ogr2ogr || !tools.ogrinfo || !pmtilesDriver) {
    skipped.push(row(layer, 'missing-gdal-pmtiles-driver', { sourceFile: layer.sourceFile }));
    continue;
  }
  if (existsSync(outputPath) && !FORCE) {
    converted.push(row(layer, 'already-exists', describeArchive(outputPath)));
    continue;
  }
  if (!EXECUTE) {
    skipped.push(row(layer, 'report-only', { output: relative(outputPath), sourceFile: layer.sourceFile }));
    continue;
  }

  rmSync(outputPath, { force: true });
  rmSync(`${outputPath}.tmp.mbtiles`, { force: true });
  rmSync(`${outputPath}.tmp.mbtiles.temp.db`, { force: true });
  const profile = getTileProfile(layer.sourceMapId || layer.id);
  const srsOptions = getSourceSrsOptions(layer.sourceMapId || layer.id);
  const result = buildArchive(layer, sourcePath, outputPath, profile, srsOptions);
  if (result.status !== 0 || !existsSync(outputPath)) {
    failed.push(row(layer, 'ogr2ogr-failed', {
      sourceFile: layer.sourceFile,
      output: relative(outputPath),
      stderr: trim(result.stderr),
      stdout: trim(result.stdout)
    }));
    continue;
  }
  const verify = spawnSync(tools.ogrinfo, [outputPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (verify.status !== 0) {
    failed.push(row(layer, 'ogrinfo-failed', {
      sourceFile: layer.sourceFile,
      output: relative(outputPath),
      stderr: trim(verify.stderr),
      stdout: trim(verify.stdout)
    }));
    continue;
  }
  converted.push(row(layer, 'converted', { profile, ...describeArchive(outputPath) }));
}

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  mode: EXECUTE ? 'execute' : 'report-only',
  tools,
  constrainedPath: 'GDAL PMTiles driver',
  pmtilesDriver,
  outputDirectory: relative(OUTPUT_DIR),
  maxGithubBytes: MAX_GITHUB_BYTES,
  totals: {
    candidates: layers.length,
    converted: converted.filter((item) => item.status === 'converted' || item.status === 'already-exists').length,
    skipped: skipped.length,
    failed: failed.length,
    metadataPreferred: 0,
    oversizedArchives: 0
  },
  converted,
  skipped,
  failed,
  notes: [
    'Archives at or above the configured GitHub size budget are generated but not preferred in maps-test.json.',
    'Each PMTiles metadata entry keeps tilesFallback and metadataUrl pointing at the directory MVT output.',
    'Use --force to rebuild existing archives and --ids <id,id> to constrain a rebuild.'
  ]
};

if (!NO_METADATA) {
  const sync = syncMetadata(report);
  report.totals.metadataPreferred = sync.preferred;
  report.totals.oversizedArchives = sync.oversized;
}

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log(`PMTiles candidates: ${report.totals.candidates}`);
console.log(`Converted/existing: ${report.totals.converted}`);
console.log(`Metadata preferred: ${report.totals.metadataPreferred}`);
console.log(`Skipped: ${report.totals.skipped}`);
console.log(`Failed: ${report.totals.failed}`);
console.log(`Wrote ${relative(REPORT_PATH)}`);

if (failed.length) process.exit(1);

/**
 * SHA-256 of the source this archive was built from, recorded at build time.
 *
 * WHY A HASH AND NOT A TIMESTAMP
 *
 * validate-tile-source-freshness.mjs compares modification times, so it fails when a
 * source is newer than its archive and cannot fail when the archive is newer and wrong.
 * That is not a theoretical hole: an archive pulled down from R2 gets a fresh mtime for
 * free, and niah-buildings sat published at 19 MB while its source yielded 204 MB, with
 * ten attribute columns against the source's twelve, passing that check every time.
 *
 * A hash cannot be fooled that way. Recorded here at the only moment the answer is
 * known for certain -- the moment the archive is written -- and compared later by
 * check:tile-content.
 *
 * WHY NOT A SCHEMA COMPARISON, which was tried first and abandoned: reading the
 * attribute names back out of the built tiles cannot distinguish a stale archive from a
 * column that is null everywhere, because MVT omits nulls. That audit reported 22, then
 * 8, then 7 stale layers across three attempts, and most were its own artefacts. A hash
 * has no such failure mode.
 *
 * THE COST IS 3.3 SECONDS for the entire 2.9 GB source corpus, measured at 876 MB/s. It
 * is not worth caching, pre-filtering on mtime, or being clever about.
 *
 * WHAT IT STILL DOES NOT COVER: whether the SOURCE is itself current. In August the
 * source cache was the stale copy and the archive was built from it faithfully -- source
 * and archive agreed, and this check would have passed. That hop is verify:source-cache.
 */
function sourceContentHash(sourceFile) {
  if (!sourceFile || !existsSync(sourceFile)) return undefined;
  try {
    return createHash('sha256').update(readFileSync(sourceFile)).digest('hex');
  } catch {
    return undefined;
  }
}

function syncMetadata(report) {
  let preferred = 0;
  let oversized = 0;
  const successfulLayerIds = new Set(report.converted
    .filter((item) => item.status === 'converted' || item.status === 'already-exists')
    .map((item) => item.layerId));
  const failedLayerIds = new Set(report.failed.map((item) => item.layerId));
  const nextLayers = (metadata.layers || []).map((layer) => {
    if (!['mvt', 'pmtiles'].includes(layer.sourceType)) return layer;
    if (IDS.size && failedLayerIds.has(layer.id)) {
      return {
        ...layer,
        sourceType: 'mvt',
        tiles: layer.tilesFallback || layer.tiles,
        tileUrl: undefined,
        tilesFallback: undefined,
        tilePackage: undefined,
        warning: unique([...(layer.warning ? [layer.warning] : []), 'PMTiles archive failed validation; directory MVT remains preferred.']).join(' ')
      };
    }
    if (IDS.size && !successfulLayerIds.has(layer.id)) return layer;
    const archivePath = resolve(OUTPUT_DIR, `${layer.id}.pmtiles`);
    if (!existsSync(archivePath)) return layer;
    const size = statSync(archivePath).size;
    const pmtilesUrl = `/test/pmtiles/generated/${layer.id}.pmtiles`;
    const archive = {
      preferred: size < MAX_GITHUB_BYTES,
      localPath: relative(archivePath),
      url: pmtilesUrl,
      bytes: size,
      maxGithubBytes: MAX_GITHUB_BYTES,
      generatedAt: report.generatedAt,
      fallback: layer.tilesFallback || layer.tiles || null,
      // WHICH BYTES THIS WAS BUILT FROM. See sourceContentHash().
      sourceSha256: sourceContentHash(layer.sourceFile)
    };
    if (!archive.preferred) {
      oversized += 1;
      return {
        ...layer,
        tilePackage: archive,
        warning: unique([...(layer.warning ? [layer.warning] : []), 'PMTiles archive exceeds Git hosting budget; directory MVT remains preferred.']).join(' ')
      };
    }
    preferred += 1;
    return {
      ...layer,
      sourceType: 'pmtiles',
      tileUrl: pmtilesUrl,
      tilesFallback: layer.tilesFallback || layer.tiles || null,
      tilePackage: archive
    };
  });
  writeFileSync(METADATA_PATH, `${JSON.stringify({ ...metadata, layers: nextLayers }, null, 2)}\n`);
  return { preferred, oversized };
}

// Wrap the real build so a layer is never lost to a source-layer naming quirk. The
// civ_fid injection has to name the source layer in SQL, and some names defeat that:
// "1920 06 19" broke on a regex that stopped at the first space, and
// "2018 PC Review Provisional Proposal Plan " carries a trailing space that any sane
// parser trims off, after which the identifier no longer matches. When ogr2ogr reports
// the table is missing, retry once without the injection -- the layer converts and only
// loses promoteId, which is far better than not existing.
function buildArchive(layer, sourcePath, outputPath, profile, srsOptions) {
  const first = buildArchiveOnce(layer, sourcePath, outputPath, profile, srsOptions);
  if (first.status === 0) return first;
  if (!/no such table|featureclass/i.test(String(first.stderr || ''))) return first;
  rmSync(outputPath, { force: true });
  const retry = buildArchiveOnce(layer, sourcePath, outputPath, profile, srsOptions, { noSourceQuery: true });
  if (retry.status === 0) {
    console.warn(`  ${layer.id}: source-layer name defeated the civ_fid query; built without it (no promoteId).`);
  }
  return retry;
}

function buildArchiveOnce(layer, sourcePath, outputPath, profile, srsOptions, opts = {}) {
  if ((layer.sourceMapId || layer.id) === 'habitat-deciduous-woodland'
    && existsSync(resolve(ROOT, DECIDUOUS_LOD0_SOURCE))
    && existsSync(resolve(ROOT, DECIDUOUS_LOD1_SOURCE))) {
    return buildDeciduousMultiZoomArchive(layer, outputPath, profile);
  }
  // Attribute pruning is opt-in per layer, via the profile, because the cost is real:
  // below the cutoff a feature shows its name rather than its full record. Only layers
  // measured to be attribute-bound should carry it.
  const cutoff = Number(profile.lowZoomAttributeCutoff);
  if (Number.isFinite(cutoff) && cutoff >= Number(layer.minzoom ?? 0) && cutoff < Number(layer.maxzoom ?? 12)) {
    const columns = lowZoomColumns(layer, sourcePath);
    if (columns) {
      if (columns.dropped.length) {
        console.warn(`  ${layer.id}: excluding free-text field(s) from all tiles: ${columns.dropped.join(', ')}`);
      }
      return buildAttributePrunedArchive(layer, sourcePath, outputPath, profile, columns, cutoff);
    }
    console.warn(`  ${layer.id}: attribute pruning requested but no useful column subset found; building normally.`);
  }

  if (usesMbtilesIntermediate(layer)) {
    const mbtilesPath = outputPath.replace(/\.pmtiles$/i, '.mbtiles');
    rmSync(mbtilesPath, { force: true });
    const mbtilesResult = spawnSync(tools.ogr2ogr, [
      '-f', 'MBTiles',
      mbtilesPath,
      sourcePath,
      ...getFailureOptions(layer.sourceMapId || layer.id),
      ...srsOptions,
      ...(opts.noSourceQuery ? [] : sourceQueryOptions(layer, sourcePath)),
      '-dsco', `MINZOOM=${Number(layer.minzoom ?? 0)}`,
      '-dsco', `MAXZOOM=${Number(layer.maxzoom ?? 12)}`,
      '-dsco', `MAX_SIZE=${profile.maxSize}`,
      '-dsco', `MAX_FEATURES=${profile.maxFeatures}`,
      '-dsco', `SIMPLIFICATION=${profile.simplification}`,
      '-dsco', `SIMPLIFICATION_MAX_ZOOM=${profile.simplificationMaxZoom}`,
      '-lco', `NAME=${layer.sourceLayer || safeLayerName(layer.id)}`,
      '-nln', layer.sourceLayer || safeLayerName(layer.id)
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    if (mbtilesResult.status !== 0 || !existsSync(mbtilesPath)) return mbtilesResult;
    const layerName = layer.sourceLayer || safeLayerName(layer.id);
    const metadataResult = ensureMbtilesVectorMetadata(mbtilesPath, layerName);
    if (metadataResult.status !== 0) return metadataResult;
    const pmtilesResult = spawnSync(tools.ogr2ogr, [
      '-f', 'PMTiles',
      outputPath,
      mbtilesPath
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    rmSync(mbtilesPath, { force: true });
    return pmtilesResult;
  }

  return spawnSync(tools.ogr2ogr, [
    '-f', 'PMTiles',
    outputPath,
    sourcePath,
    ...getFailureOptions(layer.sourceMapId || layer.id),
    ...srsOptions,
    ...(opts.noSourceQuery ? [] : sourceQueryOptions(layer, sourcePath)),
    '-dsco', `MINZOOM=${Number(layer.minzoom ?? 0)}`,
    '-dsco', `MAXZOOM=${Number(layer.maxzoom ?? 12)}`,
    '-dsco', `MAX_SIZE=${profile.maxSize}`,
    '-dsco', `MAX_FEATURES=${profile.maxFeatures}`,
    '-dsco', `SIMPLIFICATION=${profile.simplification}`,
    '-dsco', `SIMPLIFICATION_MAX_ZOOM=${profile.simplificationMaxZoom}`,
    '-lco', `NAME=${layer.sourceLayer || safeLayerName(layer.id)}`,
    '-nln', layer.sourceLayer || safeLayerName(layer.id)
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
}

/**
 * Attributes, not geometry, are what makes a low-zoom tile enormous.
 *
 * MEASURED 2026-08-20, worst tile per archive, decompressed:
 *
 *   dobih-v18-4        z0   10.65 MB   21,572 features   1.0 vertex/feature   45 keys
 *   niah-buildings     z0    7.25 MB   48,327 features   1.0 vertex/feature   10 keys
 *   corine-land-cover  z5    3.00 MB   21,663 features  16.2 vertices/feature
 *   antrim-townlands   z0    0.01 MB       86 features   4.0 vertices/feature
 *
 * Read the vertex counts. dobih and niah are point layers: one vertex each, so there is
 * no level of detail to reduce -- a point cannot be simplified. antrim is already at 4.0
 * vertices per feature at z0, which is the floor for a closed ring; GDAL has simplified
 * it as far as geometry allows. In dobih's 10.65 MB tile the geometry is roughly 0.2 MB.
 * The other 98% is 45 attribute columns per feature. It is a spreadsheet with
 * coordinates attached.
 *
 * So the obvious remedies are both wrong. Reducing LOD has nothing left to remove, and
 * a feature budget would drop real features to save a payload they are not responsible
 * for. Dropping ATTRIBUTES at low zoom keeps every feature on screen and removes the
 * part that is actually large.
 *
 * WHAT IS KEPT is derived, not listed. isPrimaryKey is the predicate the feature detail
 * panel uses to decide which fields to show first; the build imports it so the two
 * cannot disagree. promoteId is kept unconditionally -- it is MapLibre's feature
 * identity, and losing it breaks hover, selection and feature state rather than just
 * the panel.
 *
 * THE COST, STATED PLAINLY: clicking a feature below the cutoff shows its name and not
 * its full record. At z0 a click among 21,572 overlapping points is a lottery rather
 * than a choice, which is why this is the right trade -- but it is a real one.
 */
function lowZoomColumns(layer, sourcePath) {
  const fields = readSourceFields(sourcePath);
  if (!fields.length) return null;   // cannot tell: build normally rather than guess
  // Anything the layer is STYLED by must survive, or the map draws the wrong colours
  // below the cutoff and the right ones above it -- a bug that looks like a rendering
  // glitch and would never be traced to a build flag. None of the layers enabled today
  // has such a reference; this is here so that enabling one later fails safe rather
  // than silently.
  const styled = styleFieldReferences(layer);
  let keep = fields.filter((field) => isPrimaryKey(layer, field)
    || field === layer.promoteId
    || field === 'civ_fid'
    || styled.has(field));

  // FALLBACK for layers with no name-like field at all. historic-ringfort-cashel has
  // five: LATITUDE, LONGITUDE, CLASSIFICATION, DESCRIPTION, PERIOD. None is a name, so
  // the rule above keeps nothing and pruning would be abandoned -- while DESCRIPTION
  // holds a 900-character archaeological essay per feature and is, on its own, the
  // reason that layer's worst tile is 4.9 MB.
  //
  // So: keep everything SHORT. It is derived from the data rather than a hand-written
  // per-layer list, it needs no maintenance as sources change, and it targets the actual
  // cost. A categorical value stays; a paragraph does not.
  const lengths = sampleFieldLengths(sourcePath);
  const isProse = (field) => (lengths.get(field) ?? 0) > TILE_MAX_FIELD_CHARS;
  if (!keep.length) {
    if (!lengths.size) return null;
    keep = fields.filter((field) => (lengths.get(field) ?? Infinity) <= LOW_ZOOM_MAX_FIELD_CHARS);
    if (!keep.length) return null;
  }

  // Bail out on PAYLOAD, not on field count. historic-ringfort-cashel has five fields
  // and the rule above keeps four of them, which by any count-based measure looks like
  // pruning nothing -- but the one dropped field is a 900-character description holding
  // roughly 95% of the bytes. Counting fields would have abandoned the largest win
  // available because that win was concentrated in a single column.
  if (lengths.size) {
    const weight = (field) => (lengths.get(field) ?? 0) + field.length;
    const total = fields.reduce((sum, field) => sum + weight(field), 0);
    const kept = keep.reduce((sum, field) => sum + weight(field), 0);
    if (total > 0 && kept > total * 0.6 && !fields.some(isProse)) return null;
  }

  // `high` is everything except prose. Returning both halves here keeps the decision in
  // one place: the builder should not be re-deriving which columns matter.
  const high = fields.filter((field) => !isProse(field));
  return { low: keep.filter((field) => !isProse(field)), high, dropped: fields.filter(isProse) };
}

/**
 * Mean character length of each field's value, over a sample of features.
 *
 * 40 is chosen to sit above any realistic categorical value or code and well below
 * free text. It is a threshold on the data, not on the schema, so a field that happens
 * to be short in one source and long in another is treated correctly in each.
 */
function sampleFieldLengths(sourcePath, sampleSize = 300) {
  const result = spawnSync(tools.ogr2ogr, [
    '-f', 'GeoJSON', '/vsistdout/', sourcePath,
    '-limit', String(sampleSize), '-lco', 'WRITE_BBOX=NO'
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0 || !result.stdout) return new Map();
  let features;
  try {
    features = JSON.parse(result.stdout).features || [];
  } catch {
    return new Map();
  }
  const totals = new Map();
  const counts = new Map();
  for (const feature of features) {
    for (const [key, value] of Object.entries(feature.properties || {})) {
      totals.set(key, (totals.get(key) || 0) + String(value ?? '').length);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const means = new Map();
  for (const [key, total] of totals) means.set(key, total / (counts.get(key) || 1));
  return means;
}

/** Every attribute name this layer's styling configuration mentions. */
function styleFieldReferences(layer) {
  const blob = JSON.stringify({
    style: layer.style,
    conditionalStyling: layer.conditionalStyling,
    classification: layer.classification,
    legend: layer.legend,
    paint: layer.paint,
    labelProperty: layer.labelProperty,
    labelProperties: layer.labelProperties
  } ?? {});
  const names = new Set();
  for (const match of blob.matchAll(/"(?:property|field|attribute|column|labelProperty)"\s*:\s*"([^"]+)"/g)) {
    names.add(match[1]);
  }
  // MapLibre's own ["get", "FIELD"] form, which a hand-written paint expression uses.
  for (const match of blob.matchAll(/\["get","([^"]+)"\]/g)) names.add(match[1]);
  if (layer.labelProperty) names.add(layer.labelProperty);
  for (const name of layer.labelProperties || []) names.add(name);
  return names;
}

function readSourceFields(sourcePath) {
  const result = spawnSync(tools.ogrinfo, ['-so', '-al', '-json', sourcePath], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0 || !result.stdout) return [];
  try {
    const doc = JSON.parse(result.stdout);
    const fields = (doc.layers || [])[0]?.fields || [];
    return fields.map((field) => field.name).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Build one archive whose low zooms carry only the kept columns and whose high zooms
 * carry the full record, then merge them.
 *
 * The merge is the same ATTACH that buildDeciduousMultiZoomArchive already uses for its
 * two geometry LODs -- this varies the column list instead of the source file, so the
 * mechanism is reused rather than reinvented.
 */
function buildAttributePrunedArchive(layer, sourcePath, outputPath, profile, columns, cutoff) {
  const { low: lowColumns, high: highColumns } = columns;
  if (!tools.sqlite3) {
    return { status: 1, stderr: 'sqlite3 is required to merge pruned/full zoom ranges.', stdout: '' };
  }
  const srcLayer = resolveSourceLayerName(sourcePath);
  if (!srcLayer) return { status: 1, stderr: 'could not resolve the source layer name', stdout: '' };
  const quoted = srcLayer.replace(/"/g, '""');
  const lowMbtiles = outputPath.replace(/\.pmtiles$/i, '.lowattr.mbtiles');
  const highMbtiles = outputPath.replace(/\.pmtiles$/i, '.fullattr.mbtiles');
  rmSync(lowMbtiles, { force: true });
  rmSync(highMbtiles, { force: true });
  const layerName = layer.sourceLayer || safeLayerName(layer.id);
  const maxzoom = Number(layer.maxzoom ?? 12);
  const minzoom = Number(layer.minzoom ?? 0);

  // -sql rather than -select, because the polygon/line path already needs -sql to inject
  // civ_fid and the two options cannot be combined. One shape for both keeps this from
  // silently doing something different per geometry type.
  const columnList = (names) => names
    .filter((name) => name !== 'civ_fid')
    .map((name) => `"${name.replace(/"/g, '""')}"`)
    .join(', ');
  const lowSelected = columnList(lowColumns);
  const highSelected = columnList(highColumns);
  const lowSql = `SELECT FID AS civ_fid${lowSelected ? `, ${lowSelected}` : ''} FROM "${quoted}"`;
  const highSql = `SELECT FID AS civ_fid${highSelected ? `, ${highSelected}` : ''} FROM "${quoted}"`;

  const low = spawnSync(tools.ogr2ogr, [
    ...mbtilesArgs({ outputPath: lowMbtiles, sourcePath, minzoom, maxzoom: cutoff, profile, layerName }),
    '-sql', lowSql
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (low.status !== 0 || !existsSync(lowMbtiles)) {
    rmSync(lowMbtiles, { force: true });
    return low;
  }

  const high = spawnSync(tools.ogr2ogr, [
    ...mbtilesArgs({ outputPath: highMbtiles, sourcePath, minzoom: cutoff + 1, maxzoom, profile, layerName }),
    '-sql', highSql
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (high.status !== 0 || !existsSync(highMbtiles)) {
    rmSync(lowMbtiles, { force: true });
    rmSync(highMbtiles, { force: true });
    return high;
  }

  const merge = spawnSync(tools.sqlite3, [
    lowMbtiles,
    `ATTACH '${escapeSqlitePath(highMbtiles)}' AS high; INSERT OR REPLACE INTO tiles SELECT * FROM high.tiles; `
    + `UPDATE metadata SET value='${minzoom}' WHERE name='minzoom'; `
    + `UPDATE metadata SET value='${maxzoom}' WHERE name='maxzoom'; `
    + `UPDATE metadata SET value='${escapeSqliteValue(layer.name || layer.id)}' WHERE name='name'; DETACH high;`
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (merge.status !== 0) {
    rmSync(lowMbtiles, { force: true });
    rmSync(highMbtiles, { force: true });
    return merge;
  }

  const metadataResult = ensureMbtilesVectorMetadata(lowMbtiles, layerName);
  if (metadataResult.status !== 0) {
    rmSync(lowMbtiles, { force: true });
    rmSync(highMbtiles, { force: true });
    return metadataResult;
  }

  const pmtiles = spawnSync(tools.ogr2ogr, ['-f', 'PMTiles', outputPath, lowMbtiles], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
  rmSync(lowMbtiles, { force: true });
  rmSync(highMbtiles, { force: true });
  return pmtiles;
}

function buildDeciduousMultiZoomArchive(layer, outputPath, profile) {
  if (!tools.sqlite3) {
    return { status: 1, stderr: 'sqlite3 is required to merge low/high zoom MBTiles before PMTiles packaging.', stdout: '' };
  }
  const lowMbtiles = outputPath.replace(/\.pmtiles$/i, '.lod0.mbtiles');
  const highMbtiles = outputPath.replace(/\.pmtiles$/i, '.lod1.mbtiles');
  rmSync(lowMbtiles, { force: true });
  rmSync(highMbtiles, { force: true });
  const layerName = layer.sourceLayer || safeLayerName(layer.id);
  const low = spawnSync(tools.ogr2ogr, mbtilesArgs({
    outputPath: lowMbtiles,
    sourcePath: resolve(ROOT, DECIDUOUS_LOD0_SOURCE),
    minzoom: 0,
    maxzoom: 7,
    profile,
    layerName
  }), { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (low.status !== 0 || !existsSync(lowMbtiles)) {
    rmSync(lowMbtiles, { force: true });
    rmSync(highMbtiles, { force: true });
    return low;
  }
  const high = spawnSync(tools.ogr2ogr, mbtilesArgs({
    outputPath: highMbtiles,
    sourcePath: resolve(ROOT, DECIDUOUS_LOD1_SOURCE),
    minzoom: 8,
    maxzoom: 12,
    profile,
    layerName
  }), { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (high.status !== 0 || !existsSync(highMbtiles)) {
    rmSync(lowMbtiles, { force: true });
    rmSync(highMbtiles, { force: true });
    return high;
  }
  const merge = spawnSync(tools.sqlite3, [
    lowMbtiles,
    `ATTACH '${escapeSqlitePath(highMbtiles)}' AS high; INSERT OR REPLACE INTO tiles SELECT * FROM high.tiles; UPDATE metadata SET value='0' WHERE name='minzoom'; UPDATE metadata SET value='12' WHERE name='maxzoom'; UPDATE metadata SET value='${escapeSqliteValue(layer.name || layer.id)}' WHERE name='name'; DETACH high;`
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (merge.status !== 0) {
    rmSync(lowMbtiles, { force: true });
    rmSync(highMbtiles, { force: true });
    return merge;
  }
  const pmtiles = spawnSync(tools.ogr2ogr, [
    '-f', 'PMTiles',
    outputPath,
    lowMbtiles
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  rmSync(lowMbtiles, { force: true });
  rmSync(highMbtiles, { force: true });
  return pmtiles;
}

function mbtilesArgs({ outputPath, sourcePath, minzoom, maxzoom, profile, layerName }) {
  return [
    '-f', 'MBTiles',
    outputPath,
    sourcePath,
    '-dsco', `MINZOOM=${minzoom}`,
    '-dsco', `MAXZOOM=${maxzoom}`,
    '-dsco', `MAX_SIZE=${profile.maxSize}`,
    '-dsco', `MAX_FEATURES=${profile.maxFeatures}`,
    '-dsco', `SIMPLIFICATION=${profile.simplification}`,
    '-dsco', `SIMPLIFICATION_MAX_ZOOM=${profile.simplificationMaxZoom}`,
    '-lco', `NAME=${layerName}`,
    '-nln', layerName
  ];
}

function usesMbtilesIntermediate(layer) {
  return new Set([
    'habitat-wetland-grouped',
    'habitat-wetland-grouped-vector-test'
  ]).has(layer.sourceMapId || layer.id);
}

function describeArchive(outputPath) {
  const bytes = statSync(outputPath).size;
  return {
    output: relative(outputPath),
    bytes,
    exceedsGithubBudget: bytes >= MAX_GITHUB_BYTES
  };
}

function row(layer, status, extra = {}) {
  return {
    layerId: layer.id,
    sourceMapId: layer.sourceMapId,
    name: layer.name,
    sourceType: layer.sourceType,
    status,
    ...extra
  };
}

function findCommand(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.status !== 0) return '';
  return result.stdout.split(/\r?\n/).find(Boolean) || '';
}

function hasGdalPmtilesDriver(ogr2ogr) {
  const result = spawnSync(ogr2ogr, ['--formats'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
  return result.status === 0 && /\bPMTiles\b.*\(rw\+?v?\)/i.test(result.stdout);
}

function readIds() {
  const index = process.argv.indexOf('--ids');
  if (index < 0) return new Set();
  return new Set(String(process.argv[index + 1] || '').split(',').map((item) => item.trim()).filter(Boolean));
}

function readNumberArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function relative(path) {
  return path.replace(`${ROOT}\\`, '').replaceAll('\\', '/');
}

function trim(value) {
  const text = String(value || '').trim();
  return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
}

function safeLayerName(value) {
  return String(value || 'layer').replace(/[^a-z0-9_]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'layer';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function getSourceSrsOptions(sourceMapId) {
  const id = String(sourceMapId || '').toLowerCase();
  if (id === 'pc-1995' || id === 'ni-townlands-1844' || WGS84_UNKNOWN_SRS_IDS.has(id)) {
    return ['-a_srs', 'EPSG:4326'];
  }
  if (id.startsWith('wq-rwq-')) {
    return ['-a_srs', 'EPSG:29903'];
  }
  return [];
}

function getSourceQueryOptions(sourceMapId) {
  const id = String(sourceMapId || '').toLowerCase();
  if (id === 'dcc-dcc-public-cycle-parking-stands') {
    return [
      '-dialect', 'SQLite',
      '-sql', 'SELECT id, Name, description, Latitude, Longitude, MakePoint(Latitude, Longitude) AS geometry FROM Map_Coordinates WHERE Latitude BETWEEN -11 AND -4 AND Longitude BETWEEN 51 AND 56'
    ];
  }
  return [];
}

// Resolve the first (usually only) layer name inside a vector source datasource.
function resolveSourceLayerName(sourcePath) {
  try {
    const r = spawnSync(tools.ogrinfo, ['-q', sourcePath], { cwd: ROOT, encoding: 'utf8' });
    // `ogrinfo -q` prints "1: <layer name> (<Geometry Type>)". The name can contain
    // spaces -- the ROI local-authority sources are literally named "1920 06 19" -- so
    // capturing \S+ stopped at the first space and produced the layer name "1920".
    // sourceQueryOptions() then emitted SELECT ... FROM "1920", and ogr2ogr failed with
    // `no such table/featureclass`, silently costing three layers in a 19-layer run.
    // Take everything up to the trailing parenthesised geometry type instead.
    const out = r.stdout || '';
    const withGeom = /^\s*\d+:\s*(.+?)\s+\([^)]*\)\s*$/m.exec(out);
    if (withGeom) return withGeom[1].trim();
    const bare = /^\s*\d+:\s*(.+?)\s*$/m.exec(out);
    return bare ? bare[1].trim() : null;
  } catch {
    return null;
  }
}

// GDAL's MVT/PMTiles writer does not emit a usable per-feature id, so a polygon
// or line feature clipped across tiles renders as separate features with
// per-fragment stats. Inject the stable source FID as a `civ_fid` attribute
// (unique per feature) so the layer can set promoteId=civ_fid and MapLibre
// unifies every fragment. Layers with a bespoke source query keep it as-is.
function sourceQueryOptions(layer, sourcePath) {
  const custom = getSourceQueryOptions(layer.sourceMapId || layer.id);
  if (custom.length) return custom;
  const geom = String(layer.geometryType || '').toLowerCase();
  if (!['polygon', 'line', 'multipolygon', 'multilinestring'].includes(geom)) return [];
  const srcLayer = resolveSourceLayerName(sourcePath);
  if (!srcLayer) return [];
  return ['-sql', `SELECT FID AS civ_fid, * FROM "${srcLayer.replace(/"/g, '""')}"`];
}

function getFailureOptions(sourceMapId) {
  if (String(sourceMapId || '').toLowerCase() === 'roi-national-planning-applications') {
    return ['-skipfailures'];
  }
  return [];
}

function ensureMbtilesVectorMetadata(mbtilesPath, layerName) {
  if (!tools.sqlite3) return { status: 0, stderr: '', stdout: '' };
  const vectorLayers = JSON.stringify({
    vector_layers: [{
      id: layerName,
      fields: {}
    }]
  });
  return spawnSync(tools.sqlite3, [
    mbtilesPath,
    [
      "CREATE TABLE IF NOT EXISTS metadata (name text, value text);",
      `INSERT OR REPLACE INTO metadata(name, value) VALUES('json', '${escapeSqliteValue(vectorLayers)}');`
    ].join('')
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

function escapeSqlitePath(value) {
  return String(value || '').replaceAll('\\', '/').replaceAll("'", "''");
}

function escapeSqliteValue(value) {
  return String(value || '').replaceAll("'", "''");
}
