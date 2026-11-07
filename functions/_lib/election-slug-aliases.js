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
 * ELECTION_SLUG_ALIASES maps an old slug, or an old prefix of slugs, to the new: an entry
 * matches the slug itself and any slug that continues it after a hyphen (an election's
 * contests, its overall results). RETIRED_CONTEST_SLUGS maps one contest's old slug to where
 * its content lives now and matches that slug only, since another contest of the round may
 * continue it (Bangor 1952's castle-ward is now castle-ward-councillors, beside
 * castle-ward-alderman); a contest whose division no longer stands in the round goes to the
 * round's own page.
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

// Contest files that the council-election rounds of November 2026 deleted, renamed or refiled
// (12cd5ac496 partial rounds, 22c749eecb round 2): every slug here was in the published
// sitemap (sitemaps/browse-elections.xml) and answered 404 after.
export const RETIRED_CONTEST_SLUGS = [
  // A Castlereagh Rural division misprinted under the Belfast Rural heading (12cd5ac496).
  ['belfast-rural-district-council-1936-06-04-dundonald', 'castlereagh-rural-district-council-1936-06-04-dundonald'],
  // Staging's names for divisions refiled under their own (12cd5ac496): Dungannon Rural 1952
  // 'Aughnacloy' is Clonaneese; Newry No. 1 Rural 1949 'Dromore' is Damolly and 'Glenn' is Glen.
  ['dungannon-rural-district-council-1952-06-05-aughnacloy', 'dungannon-rural-district-council-1952-06-05-clonaneese'],
  ['newry-no-1-rural-district-council-1949-06-02-dromore', 'newry-no-1-rural-district-council-1949-06-02-damolly'],
  ['newry-no-1-rural-district-council-1949-06-02-glenn', 'newry-no-1-rural-district-council-1949-06-02-glen'],
  // Round 2 (22c749eecb): Bangor 1952's Castle Ward councillors' contest is titled
  // "Castle Ward (Councillors)" beside its aldermanic one; Larne 1964's 'Gardenmore Ward
  // (aldermanship)' is gardenmore-ward-alderman with the notice's names; Lisnaskea Rural 1927
  // Springfield is Springtown; Dungannon Rural 1936 Bernagh is held (the Mid-Ulster Mail
  // reports a possible contest the cited list does not show), so it goes to the round.
  ['bangor-borough-council-1952-05-21-castle-ward', 'bangor-borough-council-1952-05-21-castle-ward-councillors'],
  ['larne-borough-council-1964-05-20-gardenmore-ward-aldermanship', 'larne-borough-council-1964-05-20-gardenmore-ward-alderman'],
  ['lisnaskea-rural-district-council-1927-05-25-springfield', 'lisnaskea-rural-district-council-1927-05-25-springtown'],
  ['dungannon-rural-district-council-1936-06-03-bernagh', 'dungannon-rural-district-council-1936-06-03'],
];

/** The current slug for a retired one (lower-cased); any other slug comes back lower-cased. */
export function resolveElectionSlugAlias(slug) {
  const lower = String(slug || '').toLowerCase();
  for (const [from, to] of RETIRED_CONTEST_SLUGS) {
    if (lower === from) return to;
  }
  for (const [from, to] of ELECTION_SLUG_ALIASES) {
    if (lower === from || lower.startsWith(`${from}-`)) return to + lower.slice(from.length);
  }
  return lower;
}
