/**
 * How the semantic graph mints entity ids: `cg:<type>:<slug of the key>`, a long slug cut to 72
 * characters and a hash of the whole. build-semantic-graph.mjs mints every id with it, and the
 * ledger of published graph ids (graph-id-ledger.mjs) works out the ids a retired
 * contest slug had with the same function.
 */
import crypto from 'node:crypto';
import { slugify } from '../../packages/core/src/format.js';

// The graph's slug of a text is the site's (accents dropped, lower case, runs of anything else one hyphen).
export { slugify };

/**
 * @param {unknown} value
 * @param {number} [length]
 * @returns {string} the first `length` hex digits of the value's SHA-256
 */
export function shortHash(value, length = 16) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

/**
 * The entity id of a key: `cg:<prefix>:<slug>`, a slug over 96 characters cut to 72 and hashed.
 * @param {string} prefix  the entity type's id prefix (person, election, contest, ...)
 * @param {unknown} key
 * @returns {string}
 */
export function makeEntityId(prefix, key) {
  const slug = slugify(key || prefix);
  const stableSlug = slug.length > 96 ? `${slug.slice(0, 72)}-${shortHash(slug, 12)}` : slug;
  return `cg:${prefix}:${stableSlug}`;
}
