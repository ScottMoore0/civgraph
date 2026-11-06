/**
 * Northern Ireland council elections before 1973, grouped by year.
 *
 * Before the 1973 reorganisation each county council, county borough, borough, urban and rural
 * district and town commissioners held its own round, so the election lists carried one entry per
 * council per year (over 700 of them). They are listed instead as one entry a year, "1946 Northern
 * Ireland local elections", keyed `ni-local__1946`, which opens the year on the map at a choice of
 * levels: wards and DEDs, county electoral divisions, the town commissioners' towns, the districts
 * (rural and urban districts, boroughs, county boroughs) and the counties (county councils and the
 * county boroughs). Each council's round keeps its own key and address; the year's entry lists them.
 *
 * Before partition (years before 1921) the year is the whole island's: "1911 Irish local
 * elections", keyed `ireland-local__1911`, holding every council round of that year in Ireland
 * (owner's ruling, 7 Nov 2026). The Republic's own local elections (bodySlug ireland-local, keyed
 * ireland-local__YYYY-MM-DD, from 1974) are a different body and keep their entries.
 *
 * Shared by the map app (app/src), the catalogue and Browse builders and the tests, so the three
 * cannot disagree about which elections a year holds. No DOM, no Node APIs.
 */

export const NI_LOCAL_GROUP_PREFIX = 'ni-local__';
export const NI_LOCAL_GROUP_BODY = 'Northern Ireland local elections';
export const NI_LOCAL_GROUP_BODY_SLUG = 'ni-local-elections';
/** Before partition: the island's council elections of the year. */
export const IRELAND_LOCAL_GROUP_PREFIX = 'ireland-local__';
export const IRELAND_LOCAL_GROUP_BODY = 'Irish local elections';
export const IRELAND_LOCAL_GROUP_BODY_SLUG = 'irish-local-elections';
/** The first year titled for Northern Ireland (partition, 3 May 1921). */
export const NI_LOCAL_FIRST_YEAR = 1921;
/** The 1973 councils (the 26 districts) are elected under the 1972 Act and listed as before. */
export const NI_LOCAL_GROUP_BEFORE = '1973-01-01';

/**
 * The Northern Ireland councils of 1921-72 (their slugs; an aldermanic poll is its council's).
 * From 1921 only these are grouped, so a Free State council's round could never be filed as a
 * Northern Ireland local election. tests/elections/ni-local-grouped.test.mjs fails if a council
 * round of 1921-72 is added under a slug missing here.
 */
export const NI_COUNCIL_SLUGS = new Set([
  'aghalee-rural-district-council', 'antrim-county-council', 'antrim-rural-district-council', 'antrim-town-commissioners',
  'armagh-county-council', 'armagh-rural-district-council', 'armagh-urban-district-council', 'aughnacloy-town-commissioners',
  'ballycastle-rural-district-council', 'ballycastle-urban-district-council', 'ballyclare-urban-district-council',
  'ballymena-borough-council', 'ballymena-rural-district-council', 'ballymoney-rural-district-council',
  'ballymoney-urban-district-council', 'banbridge-rural-district-council', 'banbridge-urban-district-council',
  'bangor-borough-council', 'belfast-county-borough-council', 'belfast-rural-district-council', 'belleek-rural-district-council',
  'carrickfergus-borough-council', 'castleblayney-no-2-rural-district-council', 'castlederg-rural-district-council',
  'castlereagh-rural-district-council', 'clogher-rural-district-council', 'clones-no-2-rural-district-council',
  'coleraine-borough-council', 'coleraine-rural-district-council', 'cookstown-rural-district-council',
  'cookstown-urban-district-council', 'craigavon-urban-district-council', 'donaghadee-urban-district-council',
  'down-county-council', 'downpatrick-urban-district-council', 'dromore-urban-district-council',
  'dungannon-rural-district-council', 'dungannon-urban-district-council', 'east-down-rural-district-council',
  'enniskillen-borough-council', 'enniskillen-rural-district-council', 'fermanagh-county-council', 'gilford-town-commissioners',
  'hillsborough-rural-district-council', 'holywood-urban-district-council', 'irvinestown-rural-district-council',
  'keady-urban-district-council', 'kilkeel-urban-district-council', 'larne-borough-council', 'larne-rural-district-council',
  'limavady-rural-district-council', 'limavady-urban-district-council', 'lisburn-borough-council', 'lisburn-rural-district-council',
  'lisnaskea-rural-district-council', 'londonderry-county-borough-council', 'londonderry-county-council',
  'londonderry-rural-district-council', 'londonderry-urban-district-council', 'lurgan-borough-council',
  'lurgan-rural-district-council', 'magherafelt-rural-district-council', 'moira-rural-district-council',
  'newcastle-urban-district-council', 'newry-no-1-rural-district-council', 'newry-no-2-rural-district-council',
  'newry-urban-district-council', 'newtownabbey-urban-district-council', 'newtownards-borough-council',
  'north-down-rural-district-council', 'omagh-rural-district-council', 'omagh-urban-district-council',
  'portadown-borough-council', 'portrush-urban-district-council', 'portstewart-urban-district-council',
  'south-down-rural-district-council', 'strabane-rural-district-council', 'strabane-urban-district-council',
  'tandragee-rural-district-council', 'tandragee-urban-district-council', 'trillick-rural-district-council',
  'tyrone-county-council', 'warrenpoint-urban-district-council', 'whitehead-urban-district-council'
]);

/** Whether a year is grouped as the whole island's (before 1921) rather than Northern Ireland's. */
export function isIrelandLocalYear(year) {
  return Number(String(year).slice(0, 4)) < NI_LOCAL_FIRST_YEAR;
}

/** The year entry's body: "Irish local elections" before 1921, "Northern Ireland local elections" after. */
export function localGroupBody(year) {
  return isIrelandLocalYear(year) ? IRELAND_LOCAL_GROUP_BODY : NI_LOCAL_GROUP_BODY;
}

export function localGroupBodySlug(year) {
  return isIrelandLocalYear(year) ? IRELAND_LOCAL_GROUP_BODY_SLUG : NI_LOCAL_GROUP_BODY_SLUG;
}

/** Both year-entry bodies: the map's timeline runs through them as one series. */
export const LOCAL_GROUP_BODIES = Object.freeze([IRELAND_LOCAL_GROUP_BODY, NI_LOCAL_GROUP_BODY]);

/** The levels, in the order the control shows them. */
export const NI_LOCAL_LEVELS = Object.freeze([
  { id: 'ded', label: 'Ward/DED', long: 'wards and district electoral divisions' },
  { id: 'ced', label: 'CED', long: 'county electoral divisions' },
  { id: 'towns', label: 'Towns', long: 'towns with town commissioners' },
  { id: 'districts', label: 'Districts', long: 'rural and urban districts, boroughs and county boroughs' },
  { id: 'counties', label: 'Counties', long: 'county councils and county boroughs' }
]);
export const NI_LOCAL_LEVEL_IDS = NI_LOCAL_LEVELS.map((level) => level.id);

/** The kinds of council, and the levels each one's results are drawn at. */
export const NI_LOCAL_TIERS = Object.freeze({
  'county-council': { label: 'County council', levels: ['ced', 'counties'] },
  'county-borough': { label: 'County borough', levels: ['ded', 'districts', 'counties'] },
  borough: { label: 'Borough', levels: ['ded', 'districts'] },
  'urban-district': { label: 'Urban district', levels: ['ded', 'districts'] },
  'rural-district': { label: 'Rural district', levels: ['ded', 'districts'] },
  'town-commissioners': { label: 'Town commissioners', levels: ['towns'] }
});

/** The kind of council a body slug names, or null when it is not a council. */
export function councilTier(bodySlug) {
  const slug = String(bodySlug || '').toLowerCase().replace(/-aldermen$/, '');
  if (/-county-borough-council$/.test(slug)) return 'county-borough';
  if (/-county-council$/.test(slug)) return 'county-council';
  if (/-rural-district-council$/.test(slug)) return 'rural-district';
  if (/-urban-district-council$/.test(slug)) return 'urban-district';
  if (/-borough-council$/.test(slug)) return 'borough';
  if (/-town-commissioners$/.test(slug)) return 'town-commissioners';
  return null;
}

/** A county borough's separate aldermanic poll (Belfast, Londonderry). */
export function isAldermanicBody(bodySlug) {
  return /-aldermen$/.test(String(bodySlug || ''));
}

/** A contest for aldermen: its own body, or a borough contest whose seats are aldermen's. */
export function isAldermanicContest(bodySlug, seatType = '') {
  return isAldermanicBody(bodySlug) || /^alderm[ae]n$/i.test(String(seatType || '').trim());
}

/**
 * Whether a catalogue entry is a council round that a year groups: any council round on the
 * island before 1921, a Northern Ireland one from 1921 to 1972. (The rounds held are all of the
 * Local Government (Ireland) Act 1898's councils; the Republic's local elections, bodySlug
 * ireland-local, are not grouped.)
 */
export function isNiLocalCouncilRound(entry = {}) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.niLocalGroup) return false;
  const date = String(entry.date || '');
  if (!/^\d{4}/.test(date) || date >= NI_LOCAL_GROUP_BEFORE) return false;
  if (entry.bodyGroup === 'local-government') return false;
  const slug = String(entry.bodySlug || '');
  if (!slug || slug.startsWith('ireland-')) return false;
  if (councilTier(slug) === null) return false;
  // From 1921, Northern Ireland's councils only.
  return isIrelandLocalYear(date) || NI_COUNCIL_SLUGS.has(slug.replace(/-aldermen$/, ''));
}

/** `ireland-local__1911` before 1921, `ni-local__1946` from 1921. */
export function niLocalGroupKey(year) {
  const y = String(year).slice(0, 4);
  return `${isIrelandLocalYear(y) ? IRELAND_LOCAL_GROUP_PREFIX : NI_LOCAL_GROUP_PREFIX}${y}`;
}

/** A year entry's key (either form). The Republic's ireland-local__YYYY-MM-DD keys are not. */
export function isNiLocalGroupKey(key) {
  return /^(ni-local|ireland-local)__\d{4}$/.test(String(key || ''));
}

export function niLocalGroupYear(key) {
  const match = String(key || '').match(/^(?:ni-local|ireland-local)__(\d{4})$/);
  return match ? Number(match[1]) : null;
}

/**
 * The key a year entry has now, given any it has had: a pre-1921 year briefly keyed
 * ni-local__YYYY (on the ni-local-grouped branch, never published) is ireland-local__YYYY.
 */
export function currentNiLocalGroupKey(key) {
  const year = niLocalGroupYear(key);
  return year === null ? null : niLocalGroupKey(year);
}

export function niLocalGroupTitle(year) {
  const y = String(year).slice(0, 4);
  return `${y} ${isIrelandLocalYear(y) ? 'Irish' : 'Northern Ireland'} local elections`;
}

/** Rounds by year: Map(year -> rounds sorted by date then body). */
export function groupNiLocalRounds(entries = []) {
  const byYear = new Map();
  for (const entry of entries || []) {
    if (!isNiLocalCouncilRound(entry)) continue;
    const year = Number(String(entry.date).slice(0, 4));
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(entry);
  }
  for (const rounds of byYear.values()) {
    rounds.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.body).localeCompare(String(b.body)));
  }
  return new Map([...byYear.entries()].sort((a, b) => a[0] - b[0]));
}

/**
 * The year entry that stands for a year's rounds in an election list: the fields every list reads
 * (key, body, bodySlug, date, displayTitle) and the rounds it holds.
 */
export function buildNiLocalGroupEntry(year, rounds = []) {
  const dates = [...new Set(rounds.map((round) => round.date).filter(Boolean))].sort();
  const councils = rounds.filter((round) => !isAldermanicBody(round.bodySlug));
  const aldermanic = rounds.some((round) => isAldermanicBody(round.bodySlug));
  return {
    key: niLocalGroupKey(year),
    body: localGroupBody(year),
    bodySlug: localGroupBodySlug(year),
    date: String(year),
    firstDate: dates[0] || '',
    lastDate: dates[dates.length - 1] || '',
    dates,
    year: Number(year),
    niLocalGroup: true,
    kind: 'general',
    isByElection: false,
    contestType: 'election',
    displayTitle: niLocalGroupTitle(year),
    displayProvider: localGroupBody(year),
    // The island's year carries the key it briefly had (old links resolve to it).
    ...(isIrelandLocalYear(year) ? { previousKeys: [`${NI_LOCAL_GROUP_PREFIX}${String(year).slice(0, 4)}`] } : {}),
    displaySubtitle: `${councils.length} council${councils.length === 1 ? '' : 's'}${aldermanic ? ', with aldermen' : ''}`,
    roundKeys: rounds.map((round) => round.key),
    councilCount: councils.length,
    hasAldermen: aldermanic
  };
}

/**
 * An election list with each year's pre-1973 council rounds replaced by the year's entry, placed
 * where the year's first round was. Everything else keeps its place.
 */
export function replaceNiLocalRoundsWithGroups(entries = [], { decorate = (group) => group } = {}) {
  const groups = groupNiLocalRounds(entries);
  const placed = new Set();
  const out = [];
  for (const entry of entries || []) {
    if (!isNiLocalCouncilRound(entry)) {
      out.push(entry);
      continue;
    }
    const year = Number(String(entry.date).slice(0, 4));
    if (placed.has(year)) continue;
    placed.add(year);
    out.push(decorate(buildNiLocalGroupEntry(year, groups.get(year) || []), groups.get(year) || []));
  }
  return out;
}

/** Normalise a place name for matching a result to a boundary: lower case, no punctuation. */
export function niLocalNameKey(value) {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bno\.?\s*(\d)/g, 'no $1')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
