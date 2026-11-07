/**
 * Retired election and contest slugs, and the slugs that replaced them.
 *
 * An election or contest whose slug changed after it was published keeps its old address:
 * the Browse page Function (functions/_browse-page.js) and the elections API
 * (functions/_api/elections/index.js) answer the old one with a 301 to the new. _redirects
 * cannot do this, because Pages does not apply redirects to routes a Function serves. In-app
 * #/ links never reach the server; browse.js (RENAMED_RECORD_PREFIXES) keeps the same list
 * for those, and tests/functions/election-slug-aliases.test.mjs holds the two lists together.
 *
 * Each entry maps an old slug, or an old prefix of slugs, to the new: an entry matches the
 * slug itself and any slug that continues it after a hyphen (an election's contests, its
 * overall results).
 */
export const ELECTION_SLUG_ALIASES = [
  // Bodies that were renamed: an urban district merged into the borough slug that holds its
  // later rounds.
  ['bangor-urban-district-council-1920-01-15', 'bangor-borough-council-1920-01-15'],
  ['lisburn-urban-district-council-1920-01-15', 'lisburn-borough-council-1920-01-15'],
  // Carrickfergus 1955's East Central and West aldermanic contests were built from the
  // councillor files until 6 Nov 2026, and the sitemap listed them as "-2" of the councillor
  // contests' slugs; they are the "-alderman" contests now.
  ['carrickfergus-borough-council-1955-05-18-east-central-ward-2', 'carrickfergus-borough-council-1955-05-18-east-central-ward-alderman'],
  ['carrickfergus-borough-council-1955-05-18-west-ward-2', 'carrickfergus-borough-council-1955-05-18-west-ward-alderman'],
  // Two North Down council by-elections were named by ARK's import code until 7 Nov 2026
  // ("lg93-NoD-Holywood", "lg73-NoD-Area-B"); they carry the electoral area's own name now,
  // as the general rounds of 1973 and 1993 already did.
  ['local-government-north-down-1993-10-20-lg93-nod-holywood', 'local-government-north-down-1993-10-20-holywood'],
  ['local-government-local-government-districts-1975-05-29-lg73-nod-area-b', 'local-government-local-government-districts-1975-05-29-north-down-area-b'],
];

/** The current slug for a retired one (lower-cased); any other slug comes back lower-cased. */
export function resolveElectionSlugAlias(slug) {
  const lower = String(slug || '').toLowerCase();
  for (const [from, to] of ELECTION_SLUG_ALIASES) {
    if (lower === from || lower.startsWith(`${from}-`)) return to + lower.slice(from.length);
  }
  return lower;
}
