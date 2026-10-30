/**
 * Remembers the SQL last loaded into each D1 database, so a publish skips loads whose SQL
 * has not changed.
 *
 * Every publish used to reload all three databases whatever had changed: a minute or more
 * each, and the browse-index load in particular could fail ("Currently processing a
 * long-running import") and cost a 90-second wait before its retry. The deploy scripts
 * still run their own verification against the live database after a skip, so a skipped
 * load is checked exactly as a performed one is; only the upload is avoided.
 *
 * The record lives in tmp/ (gitignored) and is written only after a load and its
 * verification both succeed. --force on any deploy script ignores it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const RECORD_DIR = 'tmp/d1-deployed';
export const FORCE = process.argv.includes('--force');

function recordPath(key) {
  return `${RECORD_DIR}/${key.replace(/[^a-z0-9._-]+/gi, '_')}.sha256`;
}

export function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** True when this SQL file is byte-identical to the one last loaded under `key`. */
export function alreadyDeployed(key, sqlPath) {
  if (FORCE || !existsSync(sqlPath)) return false;
  const record = recordPath(key);
  if (!existsSync(record)) return false;
  return readFileSync(record, 'utf8').trim() === fileHash(sqlPath);
}

/** Record a load that has been verified. */
export function markDeployed(key, sqlPath) {
  const record = recordPath(key);
  mkdirSync(dirname(record), { recursive: true });
  writeFileSync(record, `${fileHash(sqlPath)}\n`);
}
