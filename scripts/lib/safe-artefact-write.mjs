/**
 * Write a generated JSON artefact, refusing to silently drop records.
 *
 * WHY THIS EXISTS. On 2026-07-31 a scoped run of promote-test-converted-layers.mjs
 * (--ids limited to 19 new layers) rewrote test/metadata/maps-test.json wholesale from
 * its conversion report and deleted 15 unrelated, working layers: wards-1972,
 * wards-1984, wards-1993, wards-2001, wards-2012, lgd-1984, eds-1971, eds-1977,
 * eds-1980, eds-1983, baronies-all-ireland, pc-2023, stormont-1920,
 * assembly-areas-2023 and ni-townlands-1844.
 *
 * Their PMTiles archives were untouched and still returned 200, so nothing looked
 * broken from the data side: the tiles existed, the catalogue still listed the layers,
 * and only the renderer's index had lost them. The site degraded in ways that read as
 * unrelated bugs -- wards-2012 still worked because its variants survived, wards-1993
 * loaded raster scan sheets because only its raster variants remained resolvable, and
 * wards-1972 and wards-1984 did nothing at all. Several hours went into diagnosing a
 * regression that was minutes old.
 *
 * The generator reported success throughout. It had no idea it had deleted anything,
 * because "rewrite the file from what I was asked to process" is indistinguishable from
 * "delete everything I was not asked to process" unless something compares the two.
 *
 * THE RULE. A generator may add and update freely. Removing a record is a deliberate act
 * and must be requested explicitly, because the overwhelmingly common cause of a
 * disappearing record is a filtered run, not an intentional retirement.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * @param {string} path        artefact to write
 * @param {object} next        the new document
 * @param {object} opts
 * @param {string} opts.collection  key holding the array of records (e.g. 'layers')
 * @param {string} [opts.idKey]     record identity field (default 'id')
 * @param {boolean} [opts.allowDeletions]  set from an explicit --allow-deletions flag
 * @param {string} [opts.label]     name used in messages
 */
export function writeArtefactJson(path, next, opts) {
  const { collection, idKey = 'id', allowDeletions = false, label = path } = opts;
  const removed = existsSync(path) ? findRemoved(path, next, collection, idKey) : [];

  if (removed.length && !allowDeletions) {
    const shown = removed.slice(0, 20).map((id) => `    ${id}`).join('\n');
    const more = removed.length > 20 ? `\n    ... and ${removed.length - 20} more` : '';
    throw new Error(
      `REFUSING TO WRITE ${label}: it would remove ${removed.length} existing `
      + `record(s) from "${collection}".\n${shown}${more}\n\n`
      + `  This is almost always a filtered run rewriting the whole artefact from a\n`
      + `  partial input. If the removals are genuinely intended, re-run with\n`
      + `  --allow-deletions. If not, widen the run or merge instead of rewriting.`
    );
  }

  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return { removed: removed.length };
}

function findRemoved(path, next, collection, idKey) {
  let before;
  try {
    before = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];   // unreadable/absent: treat as a first write, nothing can be lost
  }
  const prevIds = idsOf(before?.[collection], idKey);
  const nextIds = idsOf(next?.[collection], idKey);
  return [...prevIds].filter((id) => !nextIds.has(id));
}

function idsOf(records, idKey) {
  if (!Array.isArray(records)) return new Set();
  return new Set(records.map((r) => r?.[idKey]).filter((id) => id != null && id !== ''));
}

/** Read an --allow-deletions flag from argv, for callers to pass through. */
export function allowDeletionsFlag(argv = process.argv) {
  return argv.includes('--allow-deletions');
}

/**
 * Merge freshly-computed records over the existing ones, keyed by id.
 *
 * writeArtefactJson above is the right tool when a generator produces the WHOLE
 * collection every time: anything missing is a bug, so refusing is correct. It is the
 * wrong tool for a deliberately scoped run, which produces a partial collection on
 * purpose and would simply be refused every time -- and a check that always fires gets
 * bypassed, which is worse than not having it.
 *
 * This is the other half. `--ids` runs describe the rows they touched and nothing else,
 * so their output must be merged into the artefact rather than substituted for it.
 *
 * WHY BOTH HALVES ARE NEEDED. On 2026-08-19 a five-layer `verify-test-pmtiles-cdn
 * --ids` run replaced all 819 rows of cdn-range-report.json with 5. The next
 * write-test-cdn-upload-manifest run read that truncated report, could no longer see
 * that 814 archives had been verified remotely, and dropped their `remoteVerified`
 * flags. One scoped run, two corrupted artefacts, no error from either tool. The
 * absence of a merge path is why the July rule did not cover this.
 *
 * Existing order is preserved and new records are appended, so a scoped run produces a
 * minimal diff instead of reshuffling the file.
 *
 * @param {string} path       artefact being written
 * @param {Array}  fresh      records produced by this run
 * @param {object} opts
 * @param {string} [opts.idKey]  record identity field (default 'id')
 * @returns {{records: Array, updated: number, added: number, kept: number}}
 */
export function mergeArtefactRecords(path, fresh, opts = {}) {
  const { idKey = 'id', collection } = opts;
  if (!collection) throw new Error('mergeArtefactRecords: opts.collection is required');
  const freshList = Array.isArray(fresh) ? fresh : [];
  const byId = new Map(freshList.filter((r) => r?.[idKey] != null).map((r) => [r[idKey], r]));

  let existing = [];
  if (existsSync(path)) {
    try {
      const doc = JSON.parse(readFileSync(path, 'utf8'));
      if (Array.isArray(doc?.[collection])) existing = doc[collection];
    } catch {
      existing = [];   // unreadable: treat as a first write
    }
  }

  const seen = new Set();
  const records = [];
  let updated = 0;
  let kept = 0;
  for (const record of existing) {
    const id = record?.[idKey];
    if (id != null && byId.has(id)) {
      records.push(byId.get(id));
      seen.add(id);
      updated += 1;
    } else {
      records.push(record);
      kept += 1;
    }
  }
  let added = 0;
  for (const record of freshList) {
    const id = record?.[idKey];
    if (id != null && seen.has(id)) continue;
    records.push(record);
    added += 1;
  }
  return { records, updated, added, kept };
}

/**
 * Exit non-zero on a flag this script does not implement.
 *
 * The third tool in the 2026-08-19 incident, switch-test-pmtiles-to-cdn.mjs, had no
 * `--ids` support at all. Passed one, it did not error -- it ignored the flag and
 * restamped all 809 layers, while its operator believed five were in scope. An
 * unimplemented flag that is silently discarded is worse than an unknown one, because
 * the caller's intent is inverted rather than rejected: they asked for less and got
 * everything.
 *
 * @param {string[]} allowed  flags this script implements, e.g. ['--ids', '--apply']
 */
export function assertKnownFlags(allowed, argv = process.argv.slice(2)) {
  const known = new Set(allowed);
  // A value following a known value-taking flag is not itself a flag.
  const unknown = argv.filter((arg, i) => arg.startsWith('--')
    && !known.has(arg)
    && !known.has(String(arg).split('=')[0])
    && !(i > 0 && known.has(argv[i - 1]) && !arg.startsWith('--')));
  if (!unknown.length) return;
  console.error(`FAIL: unrecognised flag(s): ${unknown.join(', ')}`);
  console.error(`  This script implements: ${allowed.join(', ') || '(none)'}`);
  console.error('  Refusing to run rather than ignoring the flag and doing more than asked.');
  process.exit(2);
}
