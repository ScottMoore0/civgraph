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
  // Killultagh's 1999 by-election was filed under its count date (1 July) until 13 Nov 2026; it is
  // filed by its poll date, 30 June 1999, as the Electoral Office's result sheet gives it.
  ['local-government-lisburn-1999-07-01', 'local-government-lisburn-1999-06-30'],
];

// Contest slugs that were published and answered 404 after: the contest files the
// council-election rounds of November 2026 deleted, renamed or refiled (12cd5ac496 partial
// rounds, 22c749eecb round 2; each was in sitemaps/browse-elections.xml), and the district
// electoral areas of 1973-2011 published under ARK's import code.
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
  // Bangor 1938 was one seven-member contest until the borough's register of elections (PRONI
  // LA/20/1/DA/1, 11 Nov 2026) showed it ward by ward: the round's own page holds the ten wards' contests.
  ['bangor-borough-council-1938-05-16-bangor-7-seats', 'bangor-borough-council-1938-05-16'],
  // Belfast's 1961 triennial round (councillors and aldermen) was filed under the year alone
  // until the Corporation's register of members (PRONI LA/7/1/CA/1/3) gave its poll date,
  // 17 May 1961 (11 Nov 2026): its election, overall results and ward contests, each exactly
  // (a prefix rule would also catch the round's own new slugs and the 1961-06-29 by-election).
  ['belfast-county-borough-council-1961', 'belfast-county-borough-council-1961-05-17'],
  ['belfast-county-borough-council-1961-overall-results', 'belfast-county-borough-council-1961-05-17-overall-results'],
  ['belfast-county-borough-council-1961-clifton', 'belfast-county-borough-council-1961-05-17-clifton'],
  ['belfast-county-borough-council-1961-court', 'belfast-county-borough-council-1961-05-17-court'],
  ['belfast-county-borough-council-1961-cromac', 'belfast-county-borough-council-1961-05-17-cromac'],
  ['belfast-county-borough-council-1961-dock', 'belfast-county-borough-council-1961-05-17-dock'],
  ['belfast-county-borough-council-1961-duncairn', 'belfast-county-borough-council-1961-05-17-duncairn'],
  ['belfast-county-borough-council-1961-falls', 'belfast-county-borough-council-1961-05-17-falls'],
  ['belfast-county-borough-council-1961-ormeau', 'belfast-county-borough-council-1961-05-17-ormeau'],
  ['belfast-county-borough-council-1961-pottinger', 'belfast-county-borough-council-1961-05-17-pottinger'],
  ['belfast-county-borough-council-1961-shankill', 'belfast-county-borough-council-1961-05-17-shankill'],
  ['belfast-county-borough-council-1961-smithfield', 'belfast-county-borough-council-1961-05-17-smithfield'],
  ['belfast-county-borough-council-1961-st-anne-s', 'belfast-county-borough-council-1961-05-17-st-anne-s'],
  ['belfast-county-borough-council-1961-st-george-s', 'belfast-county-borough-council-1961-05-17-st-george-s'],
  ['belfast-county-borough-council-1961-victoria', 'belfast-county-borough-council-1961-05-17-victoria'],
  ['belfast-county-borough-council-1961-windsor', 'belfast-county-borough-council-1961-05-17-windsor'],
  ['belfast-county-borough-council-1961-woodvale', 'belfast-county-borough-council-1961-05-17-woodvale'],
  ['belfast-county-borough-council-aldermen-1961', 'belfast-county-borough-council-aldermen-1961-05-17'],
  ['belfast-county-borough-council-aldermen-1961-overall-results', 'belfast-county-borough-council-aldermen-1961-05-17-overall-results'],
  ['belfast-county-borough-council-aldermen-1961-clifton', 'belfast-county-borough-council-aldermen-1961-05-17-clifton'],
  ['belfast-county-borough-council-aldermen-1961-dock', 'belfast-county-borough-council-aldermen-1961-05-17-dock'],
  ['belfast-county-borough-council-aldermen-1961-duncairn', 'belfast-county-borough-council-aldermen-1961-05-17-duncairn'],
  ['belfast-county-borough-council-aldermen-1961-falls', 'belfast-county-borough-council-aldermen-1961-05-17-falls'],
  ['belfast-county-borough-council-aldermen-1961-shankill', 'belfast-county-borough-council-aldermen-1961-05-17-shankill'],
  ['belfast-county-borough-council-aldermen-1961-st-anne-s', 'belfast-county-borough-council-aldermen-1961-05-17-st-anne-s'],
  ['belfast-county-borough-council-aldermen-1961-woodvale', 'belfast-county-borough-council-aldermen-1961-05-17-woodvale'],
  // Council divisions filed under a misprint or a garbled reading in one round, renamed on
  // 12 Nov 2026 (w8-redirects) to the name the cited page prints and the other rounds file:
  // Castlereagh Rural 1964 Holywood Rural, Ballymena Rural 1946 Ballyscullion, South Down
  // Rural 1936 Lisnacree and Maghera (the paper's 'Maghereagh'), Coleraine Rural 1967 Slaght,
  // Limavady Rural 1964 Bellarena, Castlederg Rural 1936 Clare and Lisnacloon and 1967
  // Lisnacloon, Omagh Rural 1933 Greenan and Moyle.
  ['castlereagh-rural-district-council-1964-06-04-holywood', 'castlereagh-rural-district-council-1964-06-04-holywood-rural'],
  ['ballymena-rural-district-council-1946-10-03-ballykullion', 'ballymena-rural-district-council-1946-10-03-ballyscullion'],
  ['south-down-rural-district-council-1936-06-04-lismore', 'south-down-rural-district-council-1936-06-04-lisnacree'],
  ['south-down-rural-district-council-1936-06-04-maghereagh', 'south-down-rural-district-council-1936-06-04-maghera'],
  ['coleraine-rural-district-council-1967-06-01-slaughtneil', 'coleraine-rural-district-council-1967-06-01-slaght'],
  ['limavady-rural-district-council-1964-06-04-ballyrena', 'limavady-rural-district-council-1964-06-04-bellarena'],
  ['castlederg-rural-district-council-1936-06-03-clue', 'castlederg-rural-district-council-1936-06-03-clare'],
  ['castlederg-rural-district-council-1936-06-03-lisnacicon', 'castlederg-rural-district-council-1936-06-03-lisnacloon'],
  ['castlederg-rural-district-council-1967-06-01-lisnagloch', 'castlederg-rural-district-council-1967-06-01-lisnacloon'],
  ['omagh-rural-district-council-1933-05-31-groenan', 'omagh-rural-district-council-1933-05-31-greenan'],
  ['omagh-rural-district-council-1933-05-31-moyroe', 'omagh-rural-district-council-1933-05-31-moyle'],
  // North Down Rural 1964's division was filed as Ards Peninsula until dc67fd1eb3 (12 Nov 2026)
  // recorded it as Quintin, the name the Belfast Telegraph prints ('the Ards Peninsula division of
  // Quintin'); the Browse sitemap listed the old address until 6b1783deb6.
  ['north-down-rural-district-council-1964-06-04-ards-peninsula', 'north-down-rural-district-council-1964-06-04-quintin'],
  // Divisions spelt two or three ways across rounds take one name each (13 Nov 2026, the owner's
  // rule: the official or DED-map name where there is one, otherwise the spelling most rounds use):
  // Dungannon Rural Bernagh, Crossdernot and Aghnahoe (the 1948 order naming its divisions),
  // North Down Rural 1946 Quintin, and the Coleraine, Limavady and Londonderry Rural families.
  ['north-down-rural-district-council-1946-10-03-quinton', 'north-down-rural-district-council-1946-10-03-quintin'],
  ['dungannon-rural-district-council-1930-06-04-beragh', 'dungannon-rural-district-council-1930-06-04-bernagh'],
  ['dungannon-rural-district-council-1924-05-28-crossdernott', 'dungannon-rural-district-council-1924-05-28-crossdernot'],
  ['dungannon-rural-district-council-1927-06-01-crossdernott', 'dungannon-rural-district-council-1927-06-01-crossdernot'],
  ['dungannon-rural-district-council-1930-06-04-crowdernott', 'dungannon-rural-district-council-1930-06-04-crossdernot'],
  ['dungannon-rural-district-council-1933-05-31-crossdernott', 'dungannon-rural-district-council-1933-05-31-crossdernot'],
  ['dungannon-rural-district-council-1936-06-03-crossdernott', 'dungannon-rural-district-council-1936-06-03-crossdernot'],
  ['dungannon-rural-district-council-1939-05-31-crossdernott', 'dungannon-rural-district-council-1939-05-31-crossdernot'],
  ['dungannon-rural-district-council-1949-06-02-crossdernott', 'dungannon-rural-district-council-1949-06-02-crossdernot'],
  ['dungannon-rural-district-council-1952-06-05-crossdernott', 'dungannon-rural-district-council-1952-06-05-crossdernot'],
  ['dungannon-rural-district-council-1964-06-04-crossdernott', 'dungannon-rural-district-council-1964-06-04-crossdernot'],
  ['dungannon-rural-district-council-1967-06-01-crossdernott', 'dungannon-rural-district-council-1967-06-01-crossdernot'],
  ['dungannon-rural-district-council-1924-05-28-anahoe', 'dungannon-rural-district-council-1924-05-28-aghnahoe'],
  ['dungannon-rural-district-council-1930-06-04-anahoe', 'dungannon-rural-district-council-1930-06-04-aghnahoe'],
  ['dungannon-rural-district-council-1933-05-31-anahoe', 'dungannon-rural-district-council-1933-05-31-aghnahoe'],
  ['dungannon-rural-district-council-1936-06-03-anahoe', 'dungannon-rural-district-council-1936-06-03-aghnahoe'],
  ['dungannon-rural-district-council-1946-10-03-anahoe', 'dungannon-rural-district-council-1946-10-03-aghnahoe'],
  ['dungannon-rural-district-council-1949-06-02-anahoe', 'dungannon-rural-district-council-1949-06-02-aghnahoe'],
  ['dungannon-rural-district-council-1961-06-01-anahoe', 'dungannon-rural-district-council-1961-06-01-aghnahoe'],
  ['dungannon-rural-district-council-1964-06-04-anahoe', 'dungannon-rural-district-council-1964-06-04-aghnahoe'],
  ['dungannon-rural-district-council-1967-06-01-anahoe', 'dungannon-rural-district-council-1967-06-01-aghnahoe'],
  ['coleraine-rural-district-council-1949-06-02-lislen', 'coleraine-rural-district-council-1949-06-02-lislea'],
  ['coleraine-rural-district-council-1924-05-30-ballylaggan', 'coleraine-rural-district-council-1924-05-30-ballylagan'],
  ['coleraine-rural-district-council-1927-05-27-ballylaggan', 'coleraine-rural-district-council-1927-05-27-ballylagan'],
  ['coleraine-rural-district-council-1930-06-05-ballylaggan', 'coleraine-rural-district-council-1930-06-05-ballylagan'],
  ['coleraine-rural-district-council-1933-06-02-ballylaggan', 'coleraine-rural-district-council-1933-06-02-ballylagan'],
  ['coleraine-rural-district-council-1939-06-02-ballylaggan', 'coleraine-rural-district-council-1939-06-02-ballylagan'],
  ['coleraine-rural-district-council-1946-10-31-ballylaggan', 'coleraine-rural-district-council-1946-10-31-ballylagan'],
  ['coleraine-rural-district-council-1949-06-02-ballylaggan', 'coleraine-rural-district-council-1949-06-02-ballylagan'],
  ['coleraine-rural-district-council-1952-06-05-ballylaggan', 'coleraine-rural-district-council-1952-06-05-ballylagan'],
  ['coleraine-rural-district-council-1955-06-02-ballylaggan', 'coleraine-rural-district-council-1955-06-02-ballylagan'],
  ['coleraine-rural-district-council-1958-06-05-ballylaggan', 'coleraine-rural-district-council-1958-06-05-ballylagan'],
  ['coleraine-rural-district-council-1946-10-31-boveagh', 'coleraine-rural-district-council-1946-10-31-bovagh'],
  ['coleraine-rural-district-council-1946-10-31-drumacroon', 'coleraine-rural-district-council-1946-10-31-drumcroon'],
  ['coleraine-rural-district-council-1961-06-01-drumcrow', 'coleraine-rural-district-council-1961-06-01-drumcroon'],
  ['coleraine-rural-district-council-1958-06-05-slaught', 'coleraine-rural-district-council-1958-06-05-slaght'],
  ['coleraine-rural-district-council-1961-06-01-slight', 'coleraine-rural-district-council-1961-06-01-slaght'],
  ['coleraine-rural-district-council-1924-05-30-grove', 'coleraine-rural-district-council-1924-05-30-the-grove'],
  ['coleraine-rural-district-council-1933-06-02-grove', 'coleraine-rural-district-council-1933-06-02-the-grove'],
  ['coleraine-rural-district-council-1939-06-02-grove', 'coleraine-rural-district-council-1939-06-02-the-grove'],
  ['coleraine-rural-district-council-1949-06-02-grove', 'coleraine-rural-district-council-1949-06-02-the-grove'],
  ['coleraine-rural-district-council-1924-05-30-portstewart', 'coleraine-rural-district-council-1924-05-30-portstewart-rural'],
  ['coleraine-rural-district-council-1949-06-02-portstewart', 'coleraine-rural-district-council-1949-06-02-portstewart-rural'],
  ['limavady-rural-district-council-1924-05-30-ballyhargan', 'limavady-rural-district-council-1924-05-30-ballyharigan'],
  ['limavady-rural-district-council-1927-05-27-ballyhargan', 'limavady-rural-district-council-1927-05-27-ballyharigan'],
  ['limavady-rural-district-council-1933-06-02-ballyhargan', 'limavady-rural-district-council-1933-06-02-ballyharigan'],
  ['limavady-rural-district-council-1939-06-02-ballyharrigan', 'limavady-rural-district-council-1939-06-02-ballyharigan'],
  ['limavady-rural-district-council-1946-10-31-ballyharrigan', 'limavady-rural-district-council-1946-10-31-ballyharigan'],
  ['limavady-rural-district-council-1949-06-02-ballyharrigan', 'limavady-rural-district-council-1949-06-02-ballyharigan'],
  ['limavady-rural-district-council-1952-06-05-ballyharrigan', 'limavady-rural-district-council-1952-06-05-ballyharigan'],
  ['limavady-rural-district-council-1955-06-02-ballyharrigan', 'limavady-rural-district-council-1955-06-02-ballyharigan'],
  ['limavady-rural-district-council-1924-05-30-drumreighland', 'limavady-rural-district-council-1924-05-30-drumraighland'],
  ['limavady-rural-district-council-1927-05-27-drumreighland', 'limavady-rural-district-council-1927-05-27-drumraighland'],
  ['limavady-rural-district-council-1930-06-05-drumreighland', 'limavady-rural-district-council-1930-06-05-drumraighland'],
  ['limavady-rural-district-council-1933-06-02-drumreighland', 'limavady-rural-district-council-1933-06-02-drumraighland'],
  ['limavady-rural-district-council-1936-06-02-drumreighland', 'limavady-rural-district-council-1936-06-02-drumraighland'],
  ['limavady-rural-district-council-1939-06-02-drumreighland', 'limavady-rural-district-council-1939-06-02-drumraighland'],
  ['limavady-rural-district-council-1946-10-31-drumreighland', 'limavady-rural-district-council-1946-10-31-drumraighland'],
  ['limavady-rural-district-council-1952-06-05-drumreighland', 'limavady-rural-district-council-1952-06-05-drumraighland'],
  ['limavady-rural-district-council-1961-06-01-drumreighland', 'limavady-rural-district-council-1961-06-01-drumraighland'],
  ['limavady-rural-district-council-1924-05-30-galvin', 'limavady-rural-district-council-1924-05-30-gelvin'],
  ['limavady-rural-district-council-1939-06-02-highlands', 'limavady-rural-district-council-1939-06-02-the-highlands'],
  ['londonderry-rural-district-council-1927-05-27-lower-liberties', 'londonderry-rural-district-council-1927-05-27-liberties-lower'],
  ['londonderry-rural-district-council-1930-06-05-lower-liberties', 'londonderry-rural-district-council-1930-06-05-liberties-lower'],
  ['londonderry-rural-district-council-1933-06-02-lower-liberties', 'londonderry-rural-district-council-1933-06-02-liberties-lower'],
  ['londonderry-rural-district-council-1936-06-02-lower-liberties', 'londonderry-rural-district-council-1936-06-02-liberties-lower'],
  ['londonderry-rural-district-council-1946-10-31-lower-liberties', 'londonderry-rural-district-council-1946-10-31-liberties-lower'],
  ['londonderry-rural-district-council-1949-06-02-lower-liberties', 'londonderry-rural-district-council-1949-06-02-liberties-lower'],
  ['londonderry-rural-district-council-1952-06-05-lower-liberties', 'londonderry-rural-district-council-1952-06-05-liberties-lower'],
  ['londonderry-rural-district-council-1958-06-05-lower-liberties', 'londonderry-rural-district-council-1958-06-05-liberties-lower'],
  ['londonderry-rural-district-council-1961-06-01-lower-liberties', 'londonderry-rural-district-council-1961-06-01-liberties-lower'],
  ['londonderry-rural-district-council-1964-06-04-lower-liberties', 'londonderry-rural-district-council-1964-06-04-liberties-lower'],
  ['londonderry-rural-district-council-1927-05-27-middle-liberties', 'londonderry-rural-district-council-1927-05-27-liberties-middle'],
  ['londonderry-rural-district-council-1930-06-05-middle-liberties', 'londonderry-rural-district-council-1930-06-05-liberties-middle'],
  ['londonderry-rural-district-council-1933-06-02-middle-liberties', 'londonderry-rural-district-council-1933-06-02-liberties-middle'],
  ['londonderry-rural-district-council-1936-06-02-middle-liberties', 'londonderry-rural-district-council-1936-06-02-liberties-middle'],
  ['londonderry-rural-district-council-1946-10-31-middle-liberties', 'londonderry-rural-district-council-1946-10-31-liberties-middle'],
  ['londonderry-rural-district-council-1949-06-02-middle-liberties', 'londonderry-rural-district-council-1949-06-02-liberties-middle'],
  ['londonderry-rural-district-council-1952-06-05-middle-liberties', 'londonderry-rural-district-council-1952-06-05-liberties-middle'],
  ['londonderry-rural-district-council-1958-06-05-middle-liberties', 'londonderry-rural-district-council-1958-06-05-liberties-middle'],
  ['londonderry-rural-district-council-1961-06-01-middle-liberties', 'londonderry-rural-district-council-1961-06-01-liberties-middle'],
  ['londonderry-rural-district-council-1964-06-04-middle-liberties', 'londonderry-rural-district-council-1964-06-04-liberties-middle'],
  ['londonderry-rural-district-council-1967-06-01-middle-liberties', 'londonderry-rural-district-council-1967-06-01-liberties-middle'],
  ['londonderry-rural-district-council-1927-05-27-upper-liberties', 'londonderry-rural-district-council-1927-05-27-liberties-upper'],
  ['londonderry-rural-district-council-1930-06-05-upper-liberties', 'londonderry-rural-district-council-1930-06-05-liberties-upper'],
  ['londonderry-rural-district-council-1933-06-02-upper-liberties', 'londonderry-rural-district-council-1933-06-02-liberties-upper'],
  ['londonderry-rural-district-council-1936-06-02-upper-liberties', 'londonderry-rural-district-council-1936-06-02-liberties-upper'],
  ['londonderry-rural-district-council-1946-10-31-upper-liberties', 'londonderry-rural-district-council-1946-10-31-liberties-upper'],
  ['londonderry-rural-district-council-1949-06-02-upper-liberties', 'londonderry-rural-district-council-1949-06-02-liberties-upper'],
  ['londonderry-rural-district-council-1952-06-05-upper-liberties', 'londonderry-rural-district-council-1952-06-05-liberties-upper'],
  ['londonderry-rural-district-council-1958-06-05-upper-liberties', 'londonderry-rural-district-council-1958-06-05-liberties-upper'],
  ['londonderry-rural-district-council-1961-06-01-upper-liberties', 'londonderry-rural-district-council-1961-06-01-liberties-upper'],
  ['londonderry-rural-district-council-1964-06-04-upper-liberties', 'londonderry-rural-district-council-1964-06-04-liberties-upper'],
  ['londonderry-rural-district-council-1927-05-27-ballymullan', 'londonderry-rural-district-council-1927-05-27-ballymullins'],
  ['londonderry-rural-district-council-1930-06-05-ballymullan', 'londonderry-rural-district-council-1930-06-05-ballymullins'],
  ['londonderry-rural-district-council-1933-06-02-ballymullan', 'londonderry-rural-district-council-1933-06-02-ballymullins'],
  ['londonderry-rural-district-council-1939-06-02-ballymullan', 'londonderry-rural-district-council-1939-06-02-ballymullins'],
  ['londonderry-rural-district-council-1952-06-05-ballymullan', 'londonderry-rural-district-council-1952-06-05-ballymullins'],
  ['londonderry-rural-district-council-1961-06-01-ballymullan', 'londonderry-rural-district-council-1961-06-01-ballymullins'],
  ['londonderry-rural-district-council-1964-06-04-ballymullan', 'londonderry-rural-district-council-1964-06-04-ballymullins'],
  ['londonderry-rural-district-council-1961-06-01-waterside-rural', 'londonderry-rural-district-council-1961-06-01-waterside'],
  // Two 1979 Dublin Corporation contests filed under ElectionsIreland's later area names take the
  // names of the areas of the time (S.I. No. 41/1979), 13 Nov 2026.
  ['ireland-local-1979-06-07-north-inner-city', 'ireland-local-1979-06-07-area-no-6-ballybough-drumcondra-south-north-dock'],
  ['ireland-local-1979-06-07-pembroke', 'ireland-local-1979-06-07-area-no-10-mansion-house-pembroke'],
  // The district electoral areas of the general local elections of 1973-2011 that ARK's
  // import code named ("lg85-NoD-Holywood", "lg73-NaM-Area-A"): Browse published them under
  // those names (data/browse/details/elections, June 2026) and they took the area's own name
  // before the first sitemap (31 Oct 2026). Holywood and the rest of North Down (Abbey, Bangor
  // West, Ballyholme and Groomsport), Newry and Mourne's five DEAs, Antrim Line, Coleraine's
  // Bann and Skerries, Limavady Town, and the lettered areas of 1973-81. Lg77-ANT-Area-B never
  // took a new name, so its address stands.
  ['local-government-local-government-districts-1973-05-30-lg73-nam-area-a', 'local-government-local-government-districts-1973-05-30-newry-and-mourne-area-a'],
  ['local-government-local-government-districts-1973-05-30-lg73-nam-area-b', 'local-government-local-government-districts-1973-05-30-newry-and-mourne-area-b'],
  ['local-government-local-government-districts-1973-05-30-lg73-nam-area-c', 'local-government-local-government-districts-1973-05-30-newry-and-mourne-area-c'],
  ['local-government-local-government-districts-1973-05-30-lg73-nam-area-d', 'local-government-local-government-districts-1973-05-30-newry-and-mourne-area-d'],
  ['local-government-local-government-districts-1973-05-30-lg73-nam-area-e', 'local-government-local-government-districts-1973-05-30-newry-and-mourne-area-e'],
  ['local-government-local-government-districts-1973-05-30-lg73-nam-area-f', 'local-government-local-government-districts-1973-05-30-newry-and-mourne-area-f'],
  ['local-government-local-government-districts-1973-05-30-lg73-nod-area-a', 'local-government-local-government-districts-1973-05-30-north-down-area-a'],
  ['local-government-local-government-districts-1973-05-30-lg73-nod-area-b', 'local-government-local-government-districts-1973-05-30-north-down-area-b'],
  ['local-government-local-government-districts-1973-05-30-lg73-nod-area-c', 'local-government-local-government-districts-1973-05-30-north-down-area-c'],
  ['local-government-local-government-districts-1973-05-30-lg73-nod-area-d', 'local-government-local-government-districts-1973-05-30-north-down-area-d'],
  ['local-government-local-government-districts-1977-05-18-lg77-nam-area-a', 'local-government-local-government-districts-1977-05-18-newry-and-mourne-area-a'],
  ['local-government-local-government-districts-1977-05-18-lg77-nam-area-b', 'local-government-local-government-districts-1977-05-18-newry-and-mourne-area-b'],
  ['local-government-local-government-districts-1977-05-18-lg77-nam-area-c', 'local-government-local-government-districts-1977-05-18-newry-and-mourne-area-c'],
  ['local-government-local-government-districts-1977-05-18-lg77-nam-area-d', 'local-government-local-government-districts-1977-05-18-newry-and-mourne-area-d'],
  ['local-government-local-government-districts-1977-05-18-lg77-nam-area-e', 'local-government-local-government-districts-1977-05-18-newry-and-mourne-area-e'],
  ['local-government-local-government-districts-1977-05-18-lg77-nam-area-f', 'local-government-local-government-districts-1977-05-18-newry-and-mourne-area-f'],
  ['local-government-local-government-districts-1977-05-18-lg77-nod-area-a', 'local-government-local-government-districts-1977-05-18-north-down-area-a'],
  ['local-government-local-government-districts-1977-05-18-lg77-nod-area-b', 'local-government-local-government-districts-1977-05-18-north-down-area-b'],
  ['local-government-local-government-districts-1977-05-18-lg77-nod-area-c', 'local-government-local-government-districts-1977-05-18-north-down-area-c'],
  ['local-government-local-government-districts-1977-05-18-lg77-nod-area-d', 'local-government-local-government-districts-1977-05-18-north-down-area-d'],
  ['local-government-local-government-districts-1981-05-20-lg81-nam-area-a', 'local-government-local-government-districts-1981-05-20-newry-and-mourne-area-a'],
  ['local-government-local-government-districts-1981-05-20-lg81-nam-area-b', 'local-government-local-government-districts-1981-05-20-newry-and-mourne-area-b'],
  ['local-government-local-government-districts-1981-05-20-lg81-nam-area-c', 'local-government-local-government-districts-1981-05-20-newry-and-mourne-area-c'],
  ['local-government-local-government-districts-1981-05-20-lg81-nam-area-d', 'local-government-local-government-districts-1981-05-20-newry-and-mourne-area-d'],
  ['local-government-local-government-districts-1981-05-20-lg81-nam-area-e', 'local-government-local-government-districts-1981-05-20-newry-and-mourne-area-e'],
  ['local-government-local-government-districts-1981-05-20-lg81-nam-area-f', 'local-government-local-government-districts-1981-05-20-newry-and-mourne-area-f'],
  ['local-government-local-government-districts-1981-05-20-lg81-nod-area-a', 'local-government-local-government-districts-1981-05-20-north-down-area-a'],
  ['local-government-local-government-districts-1981-05-20-lg81-nod-area-b', 'local-government-local-government-districts-1981-05-20-north-down-area-b'],
  ['local-government-local-government-districts-1981-05-20-lg81-nod-area-c', 'local-government-local-government-districts-1981-05-20-north-down-area-c'],
  ['local-government-local-government-districts-1981-05-20-lg81-nod-area-d', 'local-government-local-government-districts-1981-05-20-north-down-area-d'],
  ['local-government-local-government-districts-1985-05-15-lg85-nam-crotlieve', 'local-government-local-government-districts-1985-05-15-crotlieve'],
  ['local-government-local-government-districts-1985-05-15-lg85-nam-fews', 'local-government-local-government-districts-1985-05-15-the-fews'],
  ['local-government-local-government-districts-1985-05-15-lg85-nam-mournes', 'local-government-local-government-districts-1985-05-15-the-mournes'],
  ['local-government-local-government-districts-1985-05-15-lg85-nam-newry-town', 'local-government-local-government-districts-1985-05-15-newry-town'],
  ['local-government-local-government-districts-1985-05-15-lg85-nam-slieve-gullion', 'local-government-local-government-districts-1985-05-15-slieve-gullion'],
  ['local-government-local-government-districts-1985-05-15-lg85-new-antrim-line', 'local-government-local-government-districts-1985-05-15-antrim-line'],
  ['local-government-local-government-districts-1985-05-15-lg85-nod-abbey', 'local-government-local-government-districts-1985-05-15-abbey'],
  ['local-government-local-government-districts-1985-05-15-lg85-nod-ballyholme-and-groomsport', 'local-government-local-government-districts-1985-05-15-ballyholme-and-groomsport'],
  ['local-government-local-government-districts-1985-05-15-lg85-nod-bangor-west', 'local-government-local-government-districts-1985-05-15-bangor-west'],
  ['local-government-local-government-districts-1985-05-15-lg85-nod-holywood', 'local-government-local-government-districts-1985-05-15-holywood'],
  ['local-government-local-government-districts-1989-05-17-lg89-col-bann', 'local-government-local-government-districts-1989-05-17-bann'],
  ['local-government-local-government-districts-1989-05-17-lg89-col-skerries', 'local-government-local-government-districts-1989-05-17-skerries'],
  ['local-government-local-government-districts-1989-05-17-lg89-lim-town', 'local-government-local-government-districts-1989-05-17-limavady-town'],
  ['local-government-local-government-districts-1989-05-17-lg89-nam-crotlieve', 'local-government-local-government-districts-1989-05-17-crotlieve'],
  ['local-government-local-government-districts-1989-05-17-lg89-nam-fews', 'local-government-local-government-districts-1989-05-17-the-fews'],
  ['local-government-local-government-districts-1989-05-17-lg89-nam-mournes', 'local-government-local-government-districts-1989-05-17-the-mournes'],
  ['local-government-local-government-districts-1989-05-17-lg89-nam-newry-town', 'local-government-local-government-districts-1989-05-17-newry-town'],
  ['local-government-local-government-districts-1989-05-17-lg89-nam-slieve-gullion', 'local-government-local-government-districts-1989-05-17-slieve-gullion'],
  ['local-government-local-government-districts-1989-05-17-lg89-nod-abbey', 'local-government-local-government-districts-1989-05-17-abbey'],
  ['local-government-local-government-districts-1989-05-17-lg89-nod-ballyholme-and-groomsport', 'local-government-local-government-districts-1989-05-17-ballyholme-and-groomsport'],
  ['local-government-local-government-districts-1989-05-17-lg89-nod-bangor-west', 'local-government-local-government-districts-1989-05-17-bangor-west'],
  ['local-government-local-government-districts-1989-05-17-lg89-nod-holywood', 'local-government-local-government-districts-1989-05-17-holywood'],
  ['local-government-local-government-districts-1993-05-19-lg93-nam-crotlieve', 'local-government-local-government-districts-1993-05-19-crotlieve'],
  ['local-government-local-government-districts-1993-05-19-lg93-nam-fews', 'local-government-local-government-districts-1993-05-19-the-fews'],
  ['local-government-local-government-districts-1993-05-19-lg93-nam-mournes', 'local-government-local-government-districts-1993-05-19-the-mournes'],
  ['local-government-local-government-districts-1993-05-19-lg93-nam-newry-town', 'local-government-local-government-districts-1993-05-19-newry-town'],
  ['local-government-local-government-districts-1993-05-19-lg93-nam-slieve-gullion', 'local-government-local-government-districts-1993-05-19-slieve-gullion'],
  ['local-government-local-government-districts-1993-05-19-lg93-nod-abbey', 'local-government-local-government-districts-1993-05-19-abbey'],
  ['local-government-local-government-districts-1993-05-19-lg93-nod-ballyholme-and-groomsport', 'local-government-local-government-districts-1993-05-19-ballyholme-and-groomsport'],
  ['local-government-local-government-districts-1993-05-19-lg93-nod-bangor-west', 'local-government-local-government-districts-1993-05-19-bangor-west'],
  ['local-government-local-government-districts-1993-05-19-lg93-nod-holywood', 'local-government-local-government-districts-1993-05-19-holywood'],
  ['local-government-local-government-districts-1997-05-21-lg97-nam-crotlieve', 'local-government-local-government-districts-1997-05-21-crotlieve'],
  ['local-government-local-government-districts-1997-05-21-lg97-nam-fews', 'local-government-local-government-districts-1997-05-21-the-fews'],
  ['local-government-local-government-districts-1997-05-21-lg97-nam-mournes', 'local-government-local-government-districts-1997-05-21-the-mournes'],
  ['local-government-local-government-districts-1997-05-21-lg97-nam-newry-town', 'local-government-local-government-districts-1997-05-21-newry-town'],
  ['local-government-local-government-districts-1997-05-21-lg97-nam-slieve-gullion', 'local-government-local-government-districts-1997-05-21-slieve-gullion'],
  ['local-government-local-government-districts-1997-05-21-lg97-nod-abbey', 'local-government-local-government-districts-1997-05-21-abbey'],
  ['local-government-local-government-districts-1997-05-21-lg97-nod-ballyholme-and-groomsport', 'local-government-local-government-districts-1997-05-21-ballyholme-and-groomsport'],
  ['local-government-local-government-districts-1997-05-21-lg97-nod-bangor-west', 'local-government-local-government-districts-1997-05-21-bangor-west'],
  ['local-government-local-government-districts-1997-05-21-lg97-nod-holywood', 'local-government-local-government-districts-1997-05-21-holywood'],
  ['local-government-local-government-districts-2001-06-07-lg01-nam-crotlieve', 'local-government-local-government-districts-2001-06-07-crotlieve'],
  ['local-government-local-government-districts-2001-06-07-lg01-nam-fews', 'local-government-local-government-districts-2001-06-07-the-fews'],
  ['local-government-local-government-districts-2001-06-07-lg01-nam-mournes', 'local-government-local-government-districts-2001-06-07-the-mournes'],
  ['local-government-local-government-districts-2001-06-07-lg01-nam-newry-town', 'local-government-local-government-districts-2001-06-07-newry-town'],
  ['local-government-local-government-districts-2001-06-07-lg01-nam-slieve-gullion', 'local-government-local-government-districts-2001-06-07-slieve-gullion'],
  ['local-government-local-government-districts-2001-06-07-lg01-nod-abbey', 'local-government-local-government-districts-2001-06-07-abbey'],
  ['local-government-local-government-districts-2001-06-07-lg01-nod-ballyholme-and-groomsport', 'local-government-local-government-districts-2001-06-07-ballyholme-and-groomsport'],
  ['local-government-local-government-districts-2001-06-07-lg01-nod-bangor-west', 'local-government-local-government-districts-2001-06-07-bangor-west'],
  ['local-government-local-government-districts-2001-06-07-lg01-nod-holywood', 'local-government-local-government-districts-2001-06-07-holywood'],
  ['local-government-local-government-districts-2005-05-05-lg05-nam-crotlieve', 'local-government-local-government-districts-2005-05-05-crotlieve'],
  ['local-government-local-government-districts-2005-05-05-lg05-nam-fews', 'local-government-local-government-districts-2005-05-05-the-fews'],
  ['local-government-local-government-districts-2005-05-05-lg05-nam-mournes', 'local-government-local-government-districts-2005-05-05-the-mournes'],
  ['local-government-local-government-districts-2005-05-05-lg05-nam-newry-town', 'local-government-local-government-districts-2005-05-05-newry-town'],
  ['local-government-local-government-districts-2005-05-05-lg05-nam-slieve-gullion', 'local-government-local-government-districts-2005-05-05-slieve-gullion'],
  ['local-government-local-government-districts-2005-05-05-lg05-nod-abbey', 'local-government-local-government-districts-2005-05-05-abbey'],
  ['local-government-local-government-districts-2005-05-05-lg05-nod-ballyholme-and-groomsport', 'local-government-local-government-districts-2005-05-05-ballyholme-and-groomsport'],
  ['local-government-local-government-districts-2005-05-05-lg05-nod-bangor-west', 'local-government-local-government-districts-2005-05-05-bangor-west'],
  ['local-government-local-government-districts-2005-05-05-lg05-nod-holywood', 'local-government-local-government-districts-2005-05-05-holywood'],
  ['local-government-local-government-districts-2011-05-05-lg11-nam-crotlieve', 'local-government-local-government-districts-2011-05-05-crotlieve'],
  ['local-government-local-government-districts-2011-05-05-lg11-nam-fews', 'local-government-local-government-districts-2011-05-05-the-fews'],
  ['local-government-local-government-districts-2011-05-05-lg11-nam-mournes', 'local-government-local-government-districts-2011-05-05-the-mournes'],
  ['local-government-local-government-districts-2011-05-05-lg11-nam-newry-town', 'local-government-local-government-districts-2011-05-05-newry-town'],
  ['local-government-local-government-districts-2011-05-05-lg11-nam-slieve-gullion', 'local-government-local-government-districts-2011-05-05-slieve-gullion'],
  ['local-government-local-government-districts-2011-05-05-lg11-nod-abbey', 'local-government-local-government-districts-2011-05-05-abbey'],
  ['local-government-local-government-districts-2011-05-05-lg11-nod-ballyholme-and-groomsport', 'local-government-local-government-districts-2011-05-05-ballyholme-and-groomsport'],
  ['local-government-local-government-districts-2011-05-05-lg11-nod-bangor-west', 'local-government-local-government-districts-2011-05-05-bangor-west'],
  ['local-government-local-government-districts-2011-05-05-lg11-nod-holywood', 'local-government-local-government-districts-2011-05-05-holywood'],
];

/**
 * The current slug for a retired one (lower-cased); any other slug comes back lower-cased.
 * @param {string | null | undefined} slug
 * @returns {string}
 */
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
