/**
 * Publication gate for the public R2 bucket.
 *
 * Objects written to boundaries-data are served at https://data.civgraph.net
 * with no auth — writing one publishes it to the open internet the moment the
 * PUT completes. Until now nothing checked that: every uploader in scripts/
 * could push any local directory to any key prefix, and the project's
 * approval machinery (validate-approved-publication-path.mjs) only ever saw
 * what was in the repo.
 *
 * That gap matters much more once data moves OUT of the repo, because then the
 * repo-scoped gate stops covering the data entirely. This module keeps git
 * authoritative over what may be published while the bytes live elsewhere: the
 * allowlist is a tracked, reviewable file, and uploads outside it fail closed.
 *
 * Deliberately a separate namespace from the Category-3 Browse approval flow.
 * That governs whether a *source record* may appear in Browse; this governs
 * whether an *object* may exist at a public URL. Different questions.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ALLOWLIST_PATH = path.join(process.cwd(), 'data', 'database', 'r2-publication-allowlist.json');

export function loadAllowlist(file = ALLOWLIST_PATH) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (parsed.schemaVersion !== 1) throw new Error(`Unsupported allowlist schemaVersion: ${parsed.schemaVersion}`);
  if (!Array.isArray(parsed.prefixes)) throw new Error('Allowlist must contain a prefixes array.');
  return parsed;
}

const normalise = (key) => String(key).replace(/^\/+/, '');

export function isPublishable(key, allowlist) {
  const k = normalise(key);
  return allowlist.prefixes.some((entry) => k.startsWith(normalise(entry.prefix)));
}

/**
 * Throws unless every key is covered. Returns the matched prefixes for logging.
 */
export function assertPublishable(keys, { file = ALLOWLIST_PATH, override = false } = {}) {
  const allowlist = loadAllowlist(file);
  const unlisted = [...new Set(keys.map(normalise).filter((k) => !isPublishable(k, allowlist)))];

  if (!unlisted.length) {
    return { ok: true, checked: keys.length, allowlist };
  }

  const sample = unlisted.slice(0, 10).map((k) => `    ${k}`).join('\n');
  const more = unlisted.length > 10 ? `\n    ... and ${unlisted.length - 10} more` : '';
  const message =
    `R2 publication gate: ${unlisted.length} key(s) are NOT covered by ` +
    `data/database/r2-publication-allowlist.json:\n${sample}${more}\n\n` +
    `  Writing these would publish them at https://data.civgraph.net with no auth.\n` +
    `  If that is intended, add a reviewed prefix entry to the allowlist in the\n` +
    `  same commit as the upload. Do not bypass this to "test" an upload —\n` +
    `  there is no unpublish.`;

  if (override) {
    console.warn(`\n!!! PUBLICATION GATE OVERRIDDEN !!!\n${message}\n`);
    return { ok: false, overridden: true, unlisted, allowlist };
  }

  throw new Error(message);
}
