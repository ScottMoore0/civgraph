#!/usr/bin/env node
/**
 * Verify CDN byte-range serving for /test PMTiles archives.
 *
 * SCOPED RUNS MERGE. `--ids` restricts what is fetched; it must not restrict what the
 * report describes. Until 2026-08-20 it did both: a five-layer run wrote a report
 * containing five rows and the other 814 verification results were gone. The report is
 * an input to write-test-cdn-upload-manifest.mjs, which reads it to learn which
 * archives exist remotely, so the truncation propagated -- 8 layers silently lost
 * their `remoteVerified` flag on the next manifest write.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeArtefactRecords, assertKnownFlags } from '../../packages/maps-pipeline/src/safe-artefact-write.mjs';
import { SITE } from '../../packages/config/src/node.mjs';

const ROOT = resolve(process.cwd());
const MANIFEST_PATH = resolve(ROOT, 'render/metadata/cdn-upload-manifest.json');
const REPORT_PATH = resolve(ROOT, 'render/metadata/cdn-range-report.json');
const APPLY = process.argv.includes('--apply');
const ORIGIN = process.env.TEST_CDN_VERIFY_ORIGIN || SITE.origin;
assertKnownFlags(['--ids', '--apply']);
const ONLY_IDS = new Set(readArgList('--ids'));

/**
 * One row of render/metadata/cdn-range-report.json `results`: written here, read by
 * r2-manifest.mjs (remoteVerified), r2-upload-pmtiles.mjs --failed-range-report and
 * switch-pmtiles-to-cdn.mjs. A failed fetch has `error` and none of the header fields.
 * @typedef {object} RangeCheck
 * @property {string} layerId
 * @property {string} cdnUrl
 * @property {boolean} ok
 * @property {number} [status]
 * @property {number} [bodyBytes]
 * @property {string | null} [acceptRanges]
 * @property {string | null} [contentLength]
 * @property {string | null} [contentRange]
 * @property {string | null} [accessControlAllowOrigin]
 * @property {string | null} [accessControlExposeHeaders]
 * @property {string | null} [cacheStatus]
 * @property {string} [error]
 * @property {string} [checkedAt]   when this layer was checked; r2-manifest.mjs copies it to remoteVerifiedAt
 */

/** @type {{ assets?: import('./r2-manifest.mjs').CdnUploadAsset[] }} */
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const assets = (manifest.assets || [])
  .filter((asset) => asset.kind === 'pmtiles')
  .filter((asset) => !ONLY_IDS.size || ONLY_IDS.has(asset.layerId));
/** @type {RangeCheck[]} */
const results = [];

for (const [index, asset] of assets.entries()) {
  console.log(`[${index + 1}/${assets.length}] ${asset.cdnUrl}`);
  // Recorded on every row, ok or not: r2-manifest.mjs reads it as remoteVerifiedAt, and without
  // it a newly verified archive never got that date.
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(asset.cdnUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-15', Origin: ORIGIN },
      cache: 'no-store'
    });
    const body = new Uint8Array(await response.arrayBuffer());
    const headers = Object.fromEntries(response.headers.entries());
    const ok = response.status === 206
      && body.length === 16
      && /bytes/i.test(headers['accept-ranges'] || '')
      && /^bytes 0-15\//i.test(headers['content-range'] || '')
      && Number(headers['content-length']) === 16
      && (!headers['access-control-allow-origin'] || headers['access-control-allow-origin'] === ORIGIN || headers['access-control-allow-origin'] === '*');
    results.push({
      layerId: asset.layerId,
      cdnUrl: asset.cdnUrl,
      ok,
      status: response.status,
      bodyBytes: body.length,
      acceptRanges: headers['accept-ranges'] || null,
      contentLength: headers['content-length'] || null,
      contentRange: headers['content-range'] || null,
      accessControlAllowOrigin: headers['access-control-allow-origin'] || null,
      accessControlExposeHeaders: headers['access-control-expose-headers'] || null,
      cacheStatus: headers['cf-cache-status'] || null,
      checkedAt
    });
  } catch (err) {
    results.push({ layerId: asset.layerId, cdnUrl: asset.cdnUrl, ok: false, error: String(err.message).slice(0, 1000), checkedAt });
  }
}

// Merge, never substitute -- see the header. `kept` rows were verified by an earlier
// run and are still true; dropping them would be this tool asserting they were never
// checked, which is a different and false claim.
const merged = mergeArtefactRecords(REPORT_PATH, results, { collection: 'results', idKey: 'layerId' });

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  rangeRequest: 'bytes=0-15',
  origin: ORIGIN,
  // Totals describe the FILE, not this run, because that is what a reader of the file
  // will take them to mean. What this run touched is reported on stdout instead.
  totals: {
    assets: merged.records.length,
    ok: merged.records.filter((item) => item.ok).length,
    failed: merged.records.filter((item) => !item.ok).length
  },
  scopedRun: ONLY_IDS.size ? { ids: [...ONLY_IDS], checked: results.length } : undefined,
  results: merged.records
};

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${REPORT_PATH.replace(`${ROOT}\\`, '').replaceAll('\\', '/')}`);
console.log(`This run: ${merged.updated} updated, ${merged.added} added, ${merged.kept} left untouched from earlier runs.`);
// Exit on what THIS run found. A pre-existing failure in an untouched row is not this
// run's result and must not fail it, or every scoped run inherits the backlog.
const failedNow = results.filter((item) => !item.ok).length;
if (failedNow) process.exit(1);

if (APPLY) {
  await import('./switch-pmtiles-to-cdn.mjs');
}

/**
 * The comma-separated values of every `name <list>` / `name=<list>` in argv.
 * @param {string} name
 * @returns {string[]}
 */
function readArgList(name) {
  /** @type {string[]} */
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === name && process.argv[index + 1]) {
      values.push(...process.argv[index + 1].split(','));
      index += 1;
    } else if (arg.startsWith(`${name}=`)) {
      values.push(...arg.slice(name.length + 1).split(','));
    }
  }
  return values.map((value) => value.trim()).filter(Boolean);
}
