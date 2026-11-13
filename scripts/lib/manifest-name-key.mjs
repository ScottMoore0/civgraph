/**
 * The election manifest builder's name key (scripts/build/build-test2-election-manifest.mjs
 * normalizeName): the form in which it compares candidate names (with the ElectionsIreland roster,
 * the official person ids, the lifespan evidence, a contest's own count rows and the local
 * candidate lists) and constituency names (with the boundary layers' features and result files).
 *
 * It reads ’ ‘ and ` as the straight apostrophe and drops all four, as core's normalizeName
 * (packages/core/src/election-domain.mjs) has since 12 Nov 2026 (w11-code): "O’Neill" and "O'Neill"
 * are one key, "oneill". Before, the curly forms stayed in the key ("o’neill"), so a row printed
 * with one form did not meet an id, lifespan or count row recorded under the other.
 *
 * It differs from core's on purpose, as it always has: it repairs Latin-1 mojibake first, reads
 * every dash (U+2010 to U+2015) as a space, and drops the word "constituency".
 */

/**
 * The text with UTF-8 read as Latin-1 repaired ("Ã¡" back to "á"); other text as it is.
 * @param {unknown} value
 * @returns {string}
 */
export function fixText(value) {
  const text = String(value ?? '');
  if (!/[ÃÂ]/.test(text)) return text;
  try {
    return Buffer.from(text, 'latin1').toString('utf8');
  } catch {
    return text;
  }
}

/**
 * The manifest builder's name key: mojibake repaired, accents and bracketed text dropped, "&" read
 * as "and", apostrophes (straight, curly and the backtick) dropped, dashes and other separators
 * read as spaces, the word "constituency" dropped, spaces collapsed, lower case.
 * @param {unknown} value
 * @returns {string}
 */
export function manifestNameKey(value) {
  return fixText(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/['‘’`]/g, '')
    .replace(/[‐-―\-_/.,()]/g, ' ')
    .replace(/\bconstituency\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
