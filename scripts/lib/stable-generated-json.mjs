import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 24 MiB: a margin under Cloudflare Pages' 25 MiB per-file limit.
const PAGES_SAFE_BYTES = 24 * 1024 * 1024;

/**
 * @template T
 * @param {T} value  JSON-serialisable
 * @returns {T}
 */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/** @param {string} pathExpression  dot-separated, e.g. 'meta.generatedAt' */
function pathParts(pathExpression) {
  return String(pathExpression).split('.').filter(Boolean);
}

/**
 * @param {unknown} value
 * @param {string} pathExpression
 * @returns {unknown}
 */
function getPath(value, pathExpression) {
  let current = value;
  for (const part of pathParts(pathExpression)) {
    if (!current || typeof current !== 'object' || !(part in current)) return undefined;
    current = /** @type {Record<string, unknown>} */ (current)[part];
  }
  return current;
}

/**
 * @param {Record<string, unknown>} value
 * @param {string} pathExpression
 * @param {unknown} nextValue
 */
function setPath(value, pathExpression, nextValue) {
  const parts = pathParts(pathExpression);
  let current = value;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') current[part] = {};
    current = /** @type {Record<string, unknown>} */ (current[part]);
  }
  if (parts.length) current[parts[parts.length - 1]] = nextValue;
}

/**
 * @param {unknown} value
 * @param {string} pathExpression
 */
function deletePath(value, pathExpression) {
  const parts = pathParts(pathExpression);
  let current = value;
  for (const part of parts.slice(0, -1)) {
    if (!current || typeof current !== 'object') return;
    current = /** @type {Record<string, unknown>} */ (current)[part];
  }
  if (current && typeof current === 'object' && parts.length) delete /** @type {Record<string, unknown>} */ (current)[parts[parts.length - 1]];
}

/**
 * @param {unknown} value
 * @param {string[]} volatilePaths
 */
function normalizeForComparison(value, volatilePaths) {
  const copy = cloneJson(value);
  for (const volatilePath of volatilePaths) deletePath(copy, volatilePath);
  return copy;
}

/**
 * @param {string} file
 * @returns {unknown} the parsed file, or null when it is missing or not JSON
 */
function readExistingJson(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * `data`, with the volatile fields' values taken from `file` when nothing else differs.
 * @template T
 * @param {string} file
 * @param {T} data  JSON-serialisable
 * @param {string[]} [volatilePaths]
 * @returns {T}
 */
export function preserveVolatileFields(file, data, volatilePaths = ['generatedAt']) {
  const existing = readExistingJson(file);
  if (!existing) return data;

  const normalizedExisting = normalizeForComparison(existing, volatilePaths);
  const normalizedNext = normalizeForComparison(data, volatilePaths);
  if (JSON.stringify(normalizedExisting) !== JSON.stringify(normalizedNext)) return data;

  const preserved = cloneJson(data);
  for (const volatilePath of volatilePaths) {
    const existingValue = getPath(existing, volatilePath);
    if (existingValue !== undefined) setPath(/** @type {Record<string, unknown>} */ (preserved), volatilePath, existingValue);
  }
  return preserved;
}

/**
 * @template T
 * @param {string} file
 * @param {T} data  JSON-serialisable
 * @param {{ volatilePaths?: string[] }} [options]
 * @returns {T}
 */
export function writeStableGeneratedJson(file, data, options = {}) {
  const volatilePaths = options.volatilePaths || ['generatedAt'];
  const nextData = preserveVolatileFields(file, data, volatilePaths);
  // Indented for readable diffs, unless that would pass Cloudflare Pages' 25 MiB per-file
  // limit: clean-for-pages.sh deletes such files from the deploy, so an oversized election
  // bundle would silently stop being served. scripts/ingest/persons/generated_json.py applies the same rule.
  const indented = `${JSON.stringify(nextData, null, 2)}\n`;
  const nextText = Buffer.byteLength(indented, 'utf8') > PAGES_SAFE_BYTES
    ? `${JSON.stringify(nextData)}\n`
    : indented;
  const currentText = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (currentText !== nextText) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeWithLockRetry(file, nextText);
  }
  return nextData;
}

// Windows Defender and the search indexer briefly lock a large file just written or read, and
// the write then fails with UNKNOWN / EBUSY / EPERM. The lock clears within seconds, so wait and
// retry rather than fail a long build on one file. scripts/ingest/persons/generated_json.py does the same.
/**
 * @param {string} file
 * @param {string} text
 */
function writeWithLockRetry(file, text) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      writeFileSync(file, text, 'utf8');
      return;
    } catch (error) {
      if (!['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES'].includes(/** @type {string} */ (/** @type {NodeJS.ErrnoException} */ (error).code)) || attempt >= 7) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000 * (attempt + 1));
    }
  }
}
