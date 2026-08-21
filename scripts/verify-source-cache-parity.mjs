#!/usr/bin/env node
/**
 * The source cache must hold the same bytes as the published download.
 *
 * THIS IS THE HOP THAT FAILED, and until now nothing checked it.
 *
 * On 2026-08-16 a contributor's corrected geometry was applied by replacing the
 * published download in R2 and nothing else. That file was verified sha256-identical to
 * what he submitted, three times, and he was told three times the fix was live.
 *
 * It was not. The map renders from PMTiles built from a THIRD copy of the geometry in
 * test/source-cache/vector-intake/, and that copy still held the pre-correction boundary
 * -- dated 29 May. The download was right, the catalogue was right, the cache tokens
 * were right, the tiles were faithfully built from the source they had, and the map drew
 * the old boundary for a day and a half. Antrim was 66087 vertices where it should have
 * been 66768.
 *
 * Every check added since guards a LATER hop. validate-tile-source-freshness compares
 * the source against the archive by mtime; validate-tile-content-hash compares them by
 * content. Both would have passed that day, because source and archive agreed with each
 * other. They were agreeing on the wrong thing.
 *
 * HOW THIS IS CHEAP ENOUGH TO RUN
 *
 * Not by downloading 671 archives. R2 returns the content MD5 as the ETag for any
 * single-part upload, so one HEAD request and one local md5sum settles a layer exactly.
 * Verified against two files before relying on it, including the corrected 1915 layer:
 *
 *   East and West of the Bann.fgb    ETag 843c2558…  local md5 843c2558…
 *   ROI_Local_Authorities_1915.fgb   ETag abc360d6…  local md5 abc360d6…
 *
 * A multipart upload produces "<md5>-<partcount>" instead, which cannot be compared this
 * way. Those are reported as unverifiable rather than passed, because "could not check"
 * and "matches" must never look the same in this file of all files.
 *
 * Network-dependent: verify:, never check:.
 *
 *   npm run verify:source-cache
 *   npm run verify:source-cache -- --ids <id,id>
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const CATALOGUE = 'data/database/maps.json';
const RENDER = 'test/metadata/maps-test.json';
const CONCURRENCY = 8;

const argv = process.argv.slice(2);
const idsAt = argv.indexOf('--ids');
const ONLY = new Set(idsAt === -1 ? [] : String(argv[idsAt + 1] || '').split(',').map((s) => s.trim()).filter(Boolean));
if (idsAt !== -1 && !ONLY.size) {
  console.error('FAIL: --ids was given with no map ids.');
  process.exit(2);
}

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const render = JSON.parse(readFileSync(RENDER, 'utf8'));

// sourceMapId is the join between the catalogue's published download and the render
// pipeline's local copy of the same geometry.
const sourceByMapId = new Map();
for (const layer of render.layers || []) {
  const mapId = layer.sourceMapId || layer.id;
  if (layer.sourceFile && !sourceByMapId.has(mapId)) sourceByMapId.set(mapId, layer.sourceFile);
}

const work = [];
const derived = [];
const differentFormat = [];
const relativePaths = [];
for (const map of catalogue.maps || []) {
  if (ONLY.size && !ONLY.has(map.id)) continue;
  const published = map.files?.fgb;
  if (!published) continue;
  const local = sourceByMapId.get(map.id);
  if (!local) continue;

  // A -lod0/-lod1 local file is a DERIVED simplification, not a copy of the download,
  // so it is supposed to differ and comparing them says nothing. Caught by this check
  // reporting habitat-deciduous-woodland and habitat-wetland-grouped as mismatched on
  // its first run, when both were correct.
  if (/-lod\d+\.fgb$/i.test(local)) { derived.push(map.id); continue; }

  // Only compare like with like. Several layers keep their local copy as GeoJSON while
  // the published download is FlatGeobuf; those bytes are supposed to differ, and this
  // check reported five such layers as mismatched before the guard existed. Comparing a
  // conversion against its input is not a staleness test, it is a format test.
  const localExt = (local.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
  const publishedExt = (String(published).split('?')[0].match(/\.([a-z0-9]+)$/i) || [])[1] || '';
  if (localExt.toLowerCase() !== publishedExt.toLowerCase()) { differentFormat.push(`${map.id} (${localExt} vs ${publishedExt})`); continue; }

  // 8 of 671 catalogue entries store a repo-relative path where the rest store a full
  // https URL. That is a real defect in data/database/maps.json rather than a quirk to
  // absorb quietly -- anything treating files.fgb as a URL breaks on those 8 -- so it is
  // resolved here AND reported.
  let url = published;
  if (!/^https?:\/\//i.test(published)) {
    relativePaths.push(map.id);
    url = `https://data.civgraph.net/${String(published).replace(/^\/+/, '')}`;
  }
  work.push({ id: map.id, published: url, local });
}

console.log(`Comparing ${work.length} published download(s) against the local source cache.\n`);

const mismatched = [];
const unverifiable = [];
const unreachable = [];
let matched = 0;
let noLocal = 0;
let done = 0;

async function check(item) {
  if (!existsSync(item.local)) { noLocal += 1; return; }
  let etag;
  try {
    const res = await fetch(item.published, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) { unreachable.push(`${item.id}: HTTP ${res.status}`); return; }
    etag = String(res.headers.get('etag') || '').replace(/^"|"$/g, '');
  } catch (error) {
    unreachable.push(`${item.id}: ${error.message}`);
    return;
  }
  if (!etag) { unverifiable.push(`${item.id}: no ETag returned`); return; }
  if (/-\d+$/.test(etag)) { unverifiable.push(`${item.id}: multipart ETag (${etag}), not a plain content md5`); return; }
  const localMd5 = createHash('md5').update(readFileSync(item.local)).digest('hex');
  if (localMd5 === etag) { matched += 1; return; }
  mismatched.push(`${item.id}\n      published ${etag}\n      local     ${localMd5}\n      local file: ${item.local}`);
}

for (let i = 0; i < work.length; i += CONCURRENCY) {
  await Promise.all(work.slice(i, i + CONCURRENCY).map(check));
  done = Math.min(i + CONCURRENCY, work.length);
  if (done % 80 === 0 || done === work.length) {
    console.log(`  ... ${done}/${work.length} checked, ${mismatched.length} mismatched`);
  }
}

if (relativePaths.length) {
  console.log(`
${relativePaths.length} catalogue entr(ies) store a relative path where the other ${work.length + derived.length - relativePaths.length} store a URL:`);
  for (const id of relativePaths.slice(0, 10)) console.log(`  - ${id}`);
  console.log('  Resolved against data.civgraph.net here, but data/database/maps.json should be fixed.');
}
if (differentFormat.length) {
  console.log(`
${differentFormat.length} skipped: local copy is a different format from the published download.`);
  for (const d of differentFormat.slice(0, 6)) console.log(`  - ${d}`);
}
if (derived.length) {
  console.log(`
${derived.length} skipped: local source is a derived -lod file, not a copy of the download.`);
}
if (unverifiable.length) {
  console.log(`\n${unverifiable.length} could not be verified this way:`);
  for (const u of unverifiable.slice(0, 10)) console.log(`  - ${u}`);
}
if (unreachable.length) {
  console.log(`\n${unreachable.length} unreachable:`);
  for (const u of unreachable.slice(0, 10)) console.log(`  - ${u}`);
}

console.log(`\nMatched ${matched}. Mismatched ${mismatched.length}. `
  + `No local copy ${noLocal}. Unverifiable ${unverifiable.length}. Unreachable ${unreachable.length}.`);

if (mismatched.length) {
  console.error(`\nFAIL: ${mismatched.length} published download(s) differ from the local source cache:`);
  for (const m of mismatched.slice(0, 20)) console.error(`  - ${m}`);
  if (mismatched.length > 20) console.error(`  ... and ${mismatched.length - 20} more`);
  console.error('');
  console.error('  The map renders from tiles built from the LOCAL copy. If the published');
  console.error('  download is the corrected one, the map is drawing the old geometry and');
  console.error('  every other check will pass. Copy the download over the source cache,');
  console.error('  rebuild the tiles, and upload:');
  console.error('    node scripts/build-test-pmtiles.mjs --force --ids <layer-id>');
  console.error('    node scripts/upload-test-pmtiles-r2.mjs --ids <layer-id>');
  process.exitCode = 1;
}
