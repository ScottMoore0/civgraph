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
 * Shared by the map app (app/src), the catalogue and Browse builders and the tests, so the three
 * cannot disagree about which elections a year holds. No DOM, no Node APIs.
 */

export const NI_LOCAL_GROUP_PREFIX = 'ni-local__';
export const NI_LOCAL_GROUP_BODY = 'Northern Ireland local elections';
export const NI_LOCAL_GROUP_BODY_SLUG = 'ni-local-elections';
/** The 1973 councils (the 26 districts) are elected under the 1972 Act and listed as before. */
export const NI_LOCAL_GROUP_BEFORE = '1973-01-01';

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

/** Whether a catalogue entry is a pre-1973 Northern Ireland council round that the year groups. */
export function isNiLocalCouncilRound(entry = {}) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.niLocalGroup) return false;
  const date = String(entry.date || '');
  if (!/^\d{4}/.test(date) || date >= NI_LOCAL_GROUP_BEFORE) return false;
  if (entry.bodyGroup === 'local-government') return false;
  const slug = String(entry.bodySlug || '');
  if (!slug || slug.startsWith('ireland-')) return false;
  return councilTier(slug) !== null;
}

export function niLocalGroupKey(year) {
  return `${NI_LOCAL_GROUP_PREFIX}${String(year).slice(0, 4)}`;
}

export function isNiLocalGroupKey(key) {
  return /^ni-local__\d{4}$/.test(String(key || ''));
}

export function niLocalGroupYear(key) {
  const match = String(key || '').match(/^ni-local__(\d{4})$/);
  return match ? Number(match[1]) : null;
}

export function niLocalGroupTitle(year) {
  return `${String(year).slice(0, 4)} Northern Ireland local elections`;
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
    body: NI_LOCAL_GROUP_BODY,
    bodySlug: NI_LOCAL_GROUP_BODY_SLUG,
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
    displayProvider: NI_LOCAL_GROUP_BODY,
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
