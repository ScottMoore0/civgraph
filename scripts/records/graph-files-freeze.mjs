/**
 * graph_files is frozen (owner, 7 Nov 2026). It maps each old /data/graph file to the keys it
 * held (9,020 rows, about 121 MB) only so functions/data/graph answers those URLs until they
 * retire on 6 Feb 2027; rebuilt from each build's graph it changed on nearly every publish, tens
 * of MB of delta each time. So records:build carries the table forward unchanged from the first
 * of FROZEN_SOURCES that holds it (what D1 holds, else the previous build, itself carried) and
 * builds it from the graph tree only when neither does (a clean checkout, CI) or with
 * --fresh-graph-files. Records added since go-live are not in the old files, which is intended.
 *
 * The build still works out the table it would have built and writes where the two differ to
 * tmp/records/graph-files-drift.json, so the checks that compare the old URLs with the build's
 * graph tree (tests/records/legacy-files.test.mjs, legacy-files-crawl.mjs) skip those files
 * (driftedFile).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REPO_ROOT } from './paths.mjs';
import { transaction } from './db.mjs';

export const LAST_LOADED = path.join(REPO_ROOT, '.claude', 'publish', 'work', 'last-loaded.sqlite');
export const DRIFT_FILE = path.join(REPO_ROOT, 'tmp', 'records', 'graph-files-drift.json');
const COLUMNS = 'file, part, keys, extra, row_hash, row_hash_n';

/** The rows a database's graph_files holds, or 0 (no file, no table). */
export function graphFilesRows(file) {
  if (!file || !existsSync(file)) return 0;
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return Number(db.prepare('SELECT count(*) AS n FROM graph_files').get().n) || 0;
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

/** The first of `candidates` whose graph_files has rows, or null. */
export function frozenSource(candidates) {
  return candidates.find((file) => graphFilesRows(file) > 0) || null;
}

/**
 * Copy graph_files from `source` into `db` (outside any transaction: ATTACH needs that) and
 * compare it with `fresh`, the rows this build would have written ({ file, part, keys, extra }).
 * Returns { rows, drifted: files whose rows differ or are new, retired: files only frozen }.
 */
export function carryGraphFiles(db, source, fresh) {
  db.exec(`ATTACH DATABASE '${source.replace(/'/g, "''")}' AS frozen`);
  try {
    transaction(db, () => db.exec(`INSERT INTO graph_files (${COLUMNS}) SELECT ${COLUMNS} FROM frozen.graph_files`));
    const want = new Map();
    for (const r of fresh) {
      if (!want.has(r.file)) want.set(r.file, []);
      want.get(r.file).push(`${r.keys}\u0001${r.extra ?? ''}`);
    }
    const have = new Map();
    for (const r of db.prepare('SELECT file, keys, extra FROM frozen.graph_files ORDER BY file, part').iterate()) {
      if (!have.has(r.file)) have.set(r.file, []);
      have.get(r.file).push(`${r.keys}\u0001${r.extra ?? ''}`);
    }
    const drifted = [];
    for (const [file, parts] of want) {
      const old = have.get(file);
      if (!old || old.length !== parts.length || old.some((v, i) => v !== parts[i])) drifted.push(file);
    }
    const retired = [...have.keys()].filter((file) => !want.has(file)).length;
    const rows = Number(db.prepare('SELECT count(*) AS n FROM graph_files').get().n);
    return { rows, drifted: drifted.sort(), retired };
  } finally {
    db.exec('DETACH DATABASE frozen');
  }
}

/** The drift the last build recorded: a Set of graph file paths, empty when none or unknown. */
export function readDrift(file = DRIFT_FILE) {
  try {
    return new Set(JSON.parse(readFileSync(file, 'utf8')).drifted || []);
  } catch {
    return new Set();
  }
}

/**
 * Whether an old graph URL (path under data/graph/) may differ from the build's file because
 * graph_files is frozen: its own keys drifted, or it is assembled from files that did (the
 * -map.json files from their shard directory; the entity-slugs parts' byIdShard from the
 * entity summaries).
 */
export function driftedFile(rel, drifted) {
  if (!drifted.size) return false;
  if (drifted.has(rel)) return true;
  const under = (dir) => [...drifted].some((f) => f.startsWith(`${dir}/`));
  const map = /^indexes\/(statements-by-subject|reverse-entity-value|source-statements)-map\.json$/.exec(rel);
  if (map) return under(`indexes/${map[1]}-shards`);
  if (/^indexes\/entity-slugs-part-\d+\.json$/.test(rel)) return under('indexes/entity-summary-shards');
  return false;
}
