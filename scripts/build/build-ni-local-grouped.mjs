#!/usr/bin/env node
/**
 * The grouped pre-1973 Northern Ireland local elections: one file a year for the map app, and a
 * coverage file.
 *
 *   node scripts/build/build-ni-local-grouped.mjs [--check]
 *
 * Reads only committed inputs:
 *   the election manifest and each council round's bundle (the published results), wherever the
 *     record build writes them (ELECTION_MANIFEST, localPathForUrl in packages/loader/src/paths.mjs);
 *   data/elections/ni-local/round-status.json (the intake's calendar and round status, imported by
 *     scripts/ingest/ni-local/import-intake-status.py);
 *   data/elections/round-completeness.json, where present (published rounds that hold only some of
 *     the council's divisions or wards, with the line that says so);
 *   data/elections/ni-local/layer-features.json (each boundary layer's features, written by
 *     scripts/ingest/ni-local/build-layer-features.py);
 *   data/database/maps.json and render/metadata/maps-test-index.json (which editions exist).
 * Writes:
 *   render/metadata/ni-local/<year>.json   the year's rounds, contests and, per level, the
 *     boundary edition and each feature's seats and votes by party and whether it is hatched;
 *   render/metadata/ni-local-coverage.json the year's figures: rounds published, partial, held
 *     back and missing, and each level's edition and how many areas it draws and hatches.
 *
 * A feature is hatched (results not available or incomplete) when the round that should fill it
 * is missing although the calendar says it was held, was held back in review, is partial or held,
 * or when the contest for that area was held back. An area whose council did not poll that year,
 * or whose seat was not due (councils elected by thirds), is left plain.
 *
 * --check: build in memory and fail if the committed files differ (for CI).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  NI_LOCAL_LEVEL_IDS,
  NI_LOCAL_TIERS,
  buildNiLocalGroupEntry,
  groupNiLocalRounds,
  isAldermanicBody,
  isAldermanicContest,
  niLocalGroupTitle,
  niLocalNameKey
} from '../../packages/map/src/ni-local-groups.mjs';
import { printedLabelText } from '../../packages/map/src/printed-labels.mjs';
import { ELECTION_MANIFEST, localPathForUrl } from '../../packages/loader/src/paths.mjs';
import { loadRegistry } from '../../packages/registries/src/index.mjs';
import { councilType } from '../../packages/registries/src/councils.mjs';
import { missingRoundReason, siteRoundStatus } from '../../packages/registries/src/statuses.mjs';
import { statusMachines } from '../../packages/registries/src/status-machines.mjs';

/**
 * A council round in the election manifest (each has these fields).
 * @typedef {import('../../packages/core/src/election-view-model.mjs').ElectionRecord & {
 *   key: string, body: string, bodySlug: string, date: string, resultUrl: string
 * }} ManifestRound
 */
/**
 * A row of data/elections/ni-local/round-status.json: a council's round, its calendar and its work status.
 * @typedef {{
 *   slug: string, round: string, workRound?: string, pollDate?: string, calendar?: string, work?: string,
 *   excluded?: unknown, heldAreas?: string[]
 * }} StatusRow
 */
/** A data/elections/round-completeness.json entry. @typedef {{ text?: string, complete?: boolean }} Completeness */
/** A boundary layer's feature (data/elections/ni-local/layer-features.json). @typedef {{ label: string, key?: string, county?: string, district?: string }} LayerFeature */
/** A boundary layer's features. @typedef {{ labelProperty?: string, keyProps?: unknown, features: LayerFeature[] }} Layer */
/** A feature with the key a contest is matched on. @typedef {LayerFeature & { matchKey: string }} GroupedFeature */
/** A feature and its index in the layer. @typedef {{ feature: GroupedFeature, fi: number }} FeatureRef */
/** A maps.json record, as far as the build reads it. @typedef {{ id: string, date?: string, name?: string }} MapEntry */
/** A startup-index layer, as far as the build reads it. @typedef {{ id: string, sourceMapId: string, name?: string }} RenderLayer */
/**
 * A candidate in a round's bundle, as far as the build reads it.
 * @typedef {{
 *   name?: string, party?: string, elected?: unknown, firstPrefs?: unknown, finalVotes?: unknown,
 *   ballotDescription?: unknown, partyAsPrinted?: unknown
 * }} BundleCandidate
 */
/**
 * A contest in a round's bundle, as far as the build reads it.
 * @typedef {{
 *   constituency?: string, seatsTotal?: unknown, contestStatus?: string, countInfo?: { Seat_Type?: unknown },
 *   candidates?: BundleCandidate[]
 * }} BundleResult
 */
/**
 * One contest, compact: area, seats, whether polled, 1 for aldermen, and each candidate as
 * [name, party, printed label, votes or null, 1 if elected].
 * @typedef {{
 *   area: string, seats: number, contested: boolean, aldermen: number,
 *   cands: [string, string, string, number | null, number][]
 * }} CompactContest
 */
/**
 * A published round in a year's file.
 * @typedef {{
 *   key: string, body: string, bodySlug: string, date: string, tier: string | null, county: string | null,
 *   aldermen: number, status: GroupedRoundStatus, note?: string, heldAreas: string[], contests: CompactContest[]
 * }} GroupedRound
 */
/**
 * A round the calendar says was held that is not published.
 * @typedef {{ bodySlug: string, date: string, tier: string | null, county: string | null, aldermen: number, reason: string }} MissingRound
 */
/**
 * A feature's results in one view (see buildLevel).
 * @typedef {{
 *   k: string, l: string, n: number, seats?: Record<string, number>, votes?: Record<string, number>, c?: number,
 *   r?: [number, number][], hatch?: number, why?: string
 * }} FeatureItem
 */
/**
 * One level of one year (see buildLevel).
 * @typedef {{
 *   available: boolean, reason: string | null, sourceMapId?: string, layerId?: string | null, labelProperty?: string,
 *   keyProps?: unknown, editionDate?: string, editionName?: string,
 *   features: { councillors: FeatureItem[], aldermen: FeatureItem[] }, unplaced: [number, number][]
 * }} GroupedLevel
 */
/**
 * A level's editions: one list for all years, or one before 1921 and one after.
 * @typedef {{ all: string[], before1921?: undefined, after1921?: undefined }
 *   | { all?: undefined, before1921: string[], after1921: string[] }} LevelSpec
 */

// The councils and statuses registries (data/registries; REG-1, RG-03): the type of each council,
// the names its district went by, and the round-status machine with its vocabularies.
const COUNCILS = loadRegistry('councils');
const STATUSES = loadRegistry('statuses');

/**
 * The type of council a body slug names (an aldermanic body's is its council's), or null.
 * @param {unknown} bodySlug
 */
export function councilTypeOf(bodySlug) {
  return councilType(COUNCILS, String(bodySlug || '').toLowerCase().replace(/-aldermen$/, ''));
}

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'render', 'metadata', 'ni-local');
const OUT_COVERAGE = path.join(ROOT, 'render', 'metadata', 'ni-local-coverage.json');
const CHECK = process.argv.includes('--check');
const NO_LABEL = 'No label';

/** @param {string} rel */
const readJson = (rel) => JSON.parse(fs.readFileSync(path.resolve(ROOT, rel), 'utf8'));

// The editions each level may draw on, oldest first. Only editions whose geometry is complete are
// used: the 1921-69 administrative-areas editions other than 1930 and 1966 leave out districts.
export const LEVEL_EDITIONS = Object.freeze({
  ded: { before1921: ['eds-ulster-1911', 'eds-ulster-1912', 'eds-ulster-1913', 'eds-ulster-1914', 'eds-ulster-1915', 'eds-ulster-1916'], after1921: ['ded-1921-05-03', 'ded-1930-04-01'] },
  // The 1898-99 divisions until 1920 (whose PR areas have no layer), then the scheme of December
  // 1923, first used in June 1924 and unchanged to 1967 (its edition is dated 20 June 1924).
  ced: { before1921: ['county-ed-1911'], after1921: ['county-ed-1924-06-20'] },
  towns: { all: ['tia-towns-ni-1921-05-03', 'tia-towns-ni-1925-04-01', 'tia-towns-ni-1927-04-01', 'tia-towns-ni-1934-08-01', 'tia-towns-ni-1937-04-01', 'tia-towns-ni-1959-05-29'] },
  districts: { before1921: ['rural-urban-districts-1901', 'rural-urban-districts-1911'], after1921: ['admin-areas-1930-04-01', 'admin-areas-1966-07-04'] },
  // Before 1921 the island's administrative counties and county boroughs of 1899; after, Northern
  // Ireland's six counties and two county boroughs.
  counties: { before1921: ['administrative-counties-1899'], after1921: ['counties-county-boroughs-1915'] }
});

// Counties of the councils the intake's authority list leaves out (the County Armagh pilot).
/** @type {Record<string, string>} */
const COUNTY_FALLBACK = {
  'armagh-county-council': 'Armagh', 'armagh-rural-district-council': 'Armagh', 'armagh-urban-district-council': 'Armagh',
  'keady-urban-district-council': 'Armagh', 'lurgan-borough-council': 'Armagh', 'lurgan-rural-district-council': 'Armagh',
  'portadown-borough-council': 'Armagh', 'tandragee-rural-district-council': 'Armagh', 'tandragee-urban-district-council': 'Armagh',
  'newry-no-2-rural-district-council': 'Armagh', 'castleblayney-no-2-rural-district-council': 'Armagh',
  'moira-rural-district-council': 'Down', 'aghalee-rural-district-council': 'Antrim',
  'belfast-county-borough-council': 'Antrim', 'londonderry-county-borough-council': 'Londonderry'
};

// Spellings that differ between the results and the boundary files.
const STEM_ALIASES = new Map([
  ['tanderagee', 'tandragee'],
  ['lisnakea', 'lisnaskea'],
  ['derry', 'londonderry']
]);

/** @param {unknown} value */
function stemKey(value) {
  const key = niLocalNameKey(value);
  return STEM_ALIASES.get(key) || key;
}

/**
 * "Newry No. 2 Rural District Council (aldermen)" -> "newry no 2".
 * @param {unknown} bodySlug
 */
export function authorityStem(bodySlug) {
  const slug = String(bodySlug || '').replace(/-aldermen$/, '')
    .replace(/-(county-borough-council|county-council|rural-district-council|urban-district-council|borough-council|town-commissioners)$/, '');
  return stemKey(slug.replace(/-/g, ' '));
}

/**
 * A district feature's label -> { stem, rural, countyBorough }.
 * @param {unknown} label
 */
export function districtFeatureStem(label) {
  let key = niLocalNameKey(label);
  const countyBorough = /\bcounty borough\b/.test(key);
  const rural = /\brural\b/.test(key);
  key = key
    .replace(/^county borough of /, '')
    .replace(/ (rural|urban) distr(ict)?$/, '')
    .replace(/ (municipal|county) borough$/, '')
    .replace(/ (rural|urban)$/, '')
    .trim();
  return { stem: STEM_ALIASES.get(key) || key, rural, countyBorough };
}

// Rural districts renamed in their lifetime (the intake files each under its last name): the
// councils registry's formerStems, by the stem of the council's last name.
const AUTHORITY_STEM_ALIASES = new Map(COUNCILS.councils
  .filter((c) => c.formerStems?.length && c.bodySlug)
  // The filter kept only the councils with former stems.
  .map((c) => [authorityStem(c.bodySlug), [.../** @type {string[]} */ (c.formerStems)]]));

/**
 * Every name a council's district went by.
 * @param {unknown} bodySlug
 */
export function authorityStems(bodySlug) {
  const stem = authorityStem(bodySlug);
  return [stem, ...(AUTHORITY_STEM_ALIASES.get(stem) || [])];
}

/**
 * @param {string | undefined} districtLabel
 * @param {string} bodySlug
 */
function districtMatchesAuthority(districtLabel, bodySlug) {
  if (!districtLabel) return false;
  const tier = councilTypeOf(bodySlug);
  const { stem, rural } = districtFeatureStem(districtLabel);
  if (!authorityStems(bodySlug).includes(stem)) return false;
  return tier === 'rural-district' ? rural : !rural;
}

// Words spelt differently in the papers and the boundary files.
const WORD_ALIASES = new Map([['tanderagee', 'tandragee'], ['lisnakea', 'lisnaskea'], ['aughentaine', 'aghintain']]);
const SEAT_WORDS = /\b(alderm[ae]n(ship)?|councillors?|commissioners?)\b/g;

/** @param {string} key */
function aliasWords(key) {
  return key.split(' ').map((word) => WORD_ALIASES.get(word) || word).join(' ');
}

/** @param {unknown} value */
export function nameKeys(value) {
  // "Castle Ward (Alderman)", "Glen Ward Aldermanship", "Portadown (councillors)": the seat, not the place.
  const key = aliasWords(niLocalNameKey(String(value || '').replace(/\((alderm[ae]n|councillors?)\)/gi, ' ')).replace(SEAT_WORDS, ' ').replace(/\s+/g, ' ').trim());
  const keys = new Set([key, key.replace(/ /g, '')]);
  const bare = key.replace(/\b(ward|division|d e d|ded|electoral division)\b/g, '').replace(/\s+/g, ' ').trim();
  if (bare) keys.add(bare).add(bare.replace(/ /g, ''));
  // Word order: "Lower Creggan" is the boundary file's "CREGGAN LOWER".
  if (bare.includes(' ')) keys.add(`sorted:${bare.split(' ').sort().join(' ')}`);
  return [...keys].filter(Boolean);
}

/**
 * Restricted Damerau-Levenshtein distance (a transposition counts once).
 * @param {unknown} a
 * @param {unknown} b
 */
export function editDistance(a, b) {
  const s = String(a);
  const t = String(b);
  const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
  for (let j = 1; j <= t.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[s.length][t.length];
}

/**
 * Keys a DED or CED label answers to; for a town's urban DED, also its ward names.
 * @param {string} label
 * @param {string} [stem]
 */
function featureKeys(label, stem = '') {
  const keys = new Set(nameKeys(label));
  const key = niLocalNameKey(label);
  const paren = String(label).match(/\(([^)]+)\)/);
  if (paren) for (const k of nameKeys(paren[1])) keys.add(k);
  const noParen = niLocalNameKey(String(label).replace(/\([^)]*\)/g, ' '));
  for (const variant of [noParen, key]) {
    const trimmed = variant.replace(/ (rural|urban)$/, '').trim();
    for (const k of nameKeys(trimmed)) keys.add(k);
    if (stem && trimmed.startsWith(`${stem} `)) {
      const ward = trimmed.slice(stem.length + 1).replace(/^no \d+\s*/, '').trim();
      if (ward) for (const k of nameKeys(ward)) keys.add(k);
    }
  }
  return keys;
}

/**
 * @param {string} level
 * @param {string} date
 * @param {Map<string, MapEntry>} mapsById
 * @param {Record<string, Layer>} layerFeatures
 * @returns {{ id: string, date: string } | null}
 */
function chooseEdition(level, date, mapsById, layerFeatures) {
  // The level is one of NI_LOCAL_LEVEL_IDS, each a key here.
  /** @type {LevelSpec} */
  const spec = /** @type {Readonly<Record<string, LevelSpec>>} */ (LEVEL_EDITIONS)[level];
  const pool = spec.all || (date < '1921-05-03' ? spec.before1921 : spec.after1921);
  const editions = pool
    .filter((id) => layerFeatures[id])
    .map((id) => ({ id, date: String(mapsById.get(id)?.date || id.match(/\d{4}(-\d{2}-\d{2})?/)?.[0] || '') }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!editions.length) return null;
  const before = editions.filter((edition) => edition.date <= date);
  return before.length ? before[before.length - 1] : editions[0];
}

/** @param {BundleCandidate} candidate */
function partyOf(candidate) {
  const party = String(candidate?.party || '').trim();
  return party || NO_LABEL;
}

/** @param {unknown} value */
function numberOrNull(value) {
  const n = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(n) ? null : n;
}

/**
 * One contest, compact: what the map and the pane need, nothing more.
 * @param {BundleResult} result
 * @param {string} bodySlug
 * @returns {CompactContest}
 */
function compactContest(result, bodySlug) {
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const seats = Number(result.seatsTotal) || candidates.filter((c) => c.elected).length || 1;
  const contested = result.contestStatus === 'contested'
    && candidates.some((c) => numberOrNull(c.firstPrefs ?? c.finalVotes) !== null);
  const seatType = String(result.countInfo?.Seat_Type || '').trim();
  return {
    area: String(result.constituency || '').trim(),
    seats,
    contested,
    aldermen: isAldermanicContest(bodySlug, seatType) ? 1 : 0,
    cands: candidates.map((c) => [
      String(c.name || '').trim(),
      partyOf(c),
      printedLabelText(c),
      numberOrNull(c.firstPrefs ?? c.finalVotes),
      c.elected ? 1 : 0
    ])
  };
}

/**
 * @param {Record<string, number>} map
 * @param {string} key
 * @param {number} n
 */
function addTo(map, key, n) {
  map[key] = (map[key] || 0) + n;
}

/**
 * A published round's status, made explicit (state-machine catalogue PL-04). A round starts
 * `complete` and may only be marked down, never back up:
 *
 *   complete -> partial   intake work 'partial', a round held back in review (excluded), or a
 *                         round-completeness line saying it lacks divisions
 *   complete -> held      intake work 'held'
 *   partial, held         final
 *
 * The table, the intake's closed list of work statuses and the rules are the statuses registry's
 * election-round entry (data/registries/statuses.json, RG-03); siteRoundStatus walks them. Any
 * other work value (a typo, a new status) still reads as complete, as it always did, but the build
 * names it.
 */
// The election-round machine lists its work statuses among its vocabularies (statuses.json).
const ROUND = /** @type {(typeof STATUSES.machines)[string] & { vocabularies: { work: { values: string[] } } }} */ (STATUSES.machines['election-round']);

export const ROUND_WORK_STATUSES = Object.freeze([...ROUND.vocabularies.work.values]);

/** @typedef {'complete' | 'partial' | 'held'} GroupedRoundStatus */

/** The election-round machine of the registry, on the shared helper. */
export const groupedRoundStatusMachine = statusMachines(STATUSES)['election-round'];

/**
 * True for no work status (a round the intake never tracked) or one on the closed list.
 * @param {string | null | undefined} work
 */
export function isKnownRoundWork(work) {
  return work === undefined || work === null || work === '' || ROUND_WORK_STATUSES.includes(work);
}

/**
 * The site status of a published round from its round-status.json row and its round-completeness
 * entry (packages/registries/src/statuses.mjs siteRoundStatus).
 * @param {{ work?: string, excluded?: unknown } | null | undefined} row
 * @param {{ text?: string, complete?: boolean } | undefined} completeness
 * @returns {GroupedRoundStatus}
 */
export function roundSiteStatus(row, completeness) {
  // siteRoundStatus reads an undefined row (row?.) as it reads null.
  return /** @type {GroupedRoundStatus} */ (siteRoundStatus(STATUSES, /** @type {{ work?: string, excluded?: unknown } | null} */ (row), completeness).status);
}

/**
 * The same, from the three facts (kept for the tests of PL-04).
 * @param {{ work?: string, excluded?: boolean, incomplete?: boolean }} facts
 * @returns {GroupedRoundStatus}
 */
export function groupedRoundStatus({ work, excluded = false, incomplete = false }) {
  return roundSiteStatus({ work, excluded }, incomplete ? { text: 'incomplete', complete: false } : undefined);
}

function main() {
  /** @type {{ elections?: ManifestRound[] }} */
  const manifest = readJson(ELECTION_MANIFEST);
  /** @type {{ importedAt?: string, authorities?: Record<string, { county?: string }>, rounds?: StatusRow[] }} */
  const status = readJson('data/elections/ni-local/round-status.json');
  /** @type {Record<string, Completeness>} */
  const roundCompleteness = fs.existsSync(path.join(ROOT, 'data/elections/round-completeness.json'))
    ? readJson('data/elections/round-completeness.json').rounds || {}
    : {};
  /** @type {Record<string, Layer>} */
  const layerFeatures = readJson('data/elections/ni-local/layer-features.json').layers;
  const mapsRaw = readJson('data/database/maps.json');
  /** @type {MapEntry[]} */
  const mapsList = Array.isArray(mapsRaw) ? mapsRaw : (mapsRaw.maps || Object.values(mapsRaw));
  const mapsById = new Map(mapsList.map((map) => [map.id, map]));
  /** @type {{ layers?: RenderLayer[] }} */
  const renderIndex = readJson('render/metadata/maps-test-index.json');
  const renderBySource = new Map((renderIndex.layers || []).map((layer) => [layer.sourceMapId, layer]));

  const authorities = status.authorities || {};
  /** @param {string} slug */
  const countyOf = (slug) => {
    const base = String(slug).replace(/-aldermen$/, '');
    const known = authorities[slug]?.county || authorities[base]?.county || COUNTY_FALLBACK[base];
    if (known) return known;
    // A county council anywhere on the island (before 1921): its county is its name.
    if (councilTypeOf(base) === 'county-council') {
      return authorityStem(base).replace(/\b[a-z]/g, (c) => c.toUpperCase());
    }
    return null;
  };
  /** @type {Map<number, StatusRow[]>} */
  const statusByYear = new Map();
  for (const row of status.rounds || []) {
    const year = Number(String(row.workRound || row.round).slice(0, 4));
    if (!statusByYear.has(year)) statusByYear.set(year, []);
    // The key was set on the line before if it was missing.
    /** @type {StatusRow[]} */ (statusByYear.get(year)).push(row);
  }

  const groups = groupNiLocalRounds(manifest.elections || []);
  /** @type {Map<number, object>} */
  const outputs = new Map();
  const coverageYears = [];
  const totals = { years: 0, rounds: 0, contests: 0, partialRounds: 0, missingRounds: 0, heldBackRounds: 0 };
  /** Intake work statuses the derivation does not know (they count as complete, as before). */
  const unknownWork = new Set();

  for (const [year, entries] of groups) {
    const statusRows = statusByYear.get(year) || [];
    /** @param {ManifestRound} entry */
    const statusFor = (entry) => {
      const folder = String(entry.date);
      return statusRows.find((row) => row.slug === entry.bodySlug && (row.round === folder || row.workRound === folder))
        || statusRows.find((row) => row.slug === entry.bodySlug)
        || null;
    };
    /** @type {GroupedRound[]} */
    const rounds = entries.map((entry) => {
      // A round's resultUrl is a local /render/ URL, never null.
      /** @type {{ results?: BundleResult[] }} */
      const bundle = readJson(/** @type {string} */ (localPathForUrl(entry.resultUrl)));
      const row = statusFor(entry);
      const tier = councilTypeOf(entry.bodySlug);
      // A published round holding fewer divisions or wards than the council elected
      // (data/elections/round-completeness.json): its line says how many, and why where known.
      // A round marked complete there lacks only divisions the law left vacant: it keeps its line
      // (which names them) and still counts as complete.
      const completeness = roundCompleteness[entry.key];
      if (!isKnownRoundWork(row?.work)) unknownWork.add(String(row?.work));
      const roundStatus = roundSiteStatus(row, completeness);
      const contests = (bundle.results || []).map((result) => compactContest(result, entry.bodySlug));
      return {
        key: entry.key,
        body: entry.body,
        bodySlug: entry.bodySlug,
        date: entry.date,
        tier,
        county: countyOf(entry.bodySlug),
        aldermen: isAldermanicBody(entry.bodySlug) ? 1 : 0,
        status: roundStatus,
        ...(completeness?.text ? { note: String(completeness.text) } : {}),
        heldAreas: row?.heldAreas || [],
        contests
      };
    });

    // Rounds the calendar says were held that are not published (not transcribed, or held back).
    const published = new Set(rounds.map((round) => round.bodySlug));
    /** @type {MissingRound[]} */
    const missing = [];
    for (const row of statusRows) {
      if (published.has(row.slug)) continue;
      if (row.calendar !== 'held' || row.work === 'no-election') continue;
      if (!councilTypeOf(row.slug)) continue;
      if (missing.some((item) => item.bodySlug === row.slug)) continue;
      missing.push({
        bodySlug: row.slug,
        date: row.pollDate || row.round,
        tier: councilTypeOf(row.slug),
        county: countyOf(row.slug),
        aldermen: isAldermanicBody(row.slug) ? 1 : 0,
        reason: missingRoundReason(STATUSES, row).reason
      });
    }

    const firstDate = rounds.map((round) => round.date).sort()[0];
    /** @type {Record<string, GroupedLevel>} */
    const levels = {};
    for (const level of NI_LOCAL_LEVEL_IDS) {
      levels[level] = buildLevel(level, { year, firstDate, rounds, missing, mapsById, renderBySource, layerFeatures });
    }

    const group = buildNiLocalGroupEntry(year, entries);
    const file = {
      schemaVersion: 1,
      key: group.key,
      year,
      title: niLocalGroupTitle(year),
      dates: group.dates,
      hasAldermen: rounds.some((round) => round.aldermen || round.contests.some((c) => c.aldermen)),
      rounds,
      missing,
      levels
    };
    outputs.set(year, file);

    const contests = rounds.reduce((n, round) => n + round.contests.length, 0);
    const partial = rounds.filter((round) => round.status !== 'complete').length;
    const heldBack = missing.filter((item) => item.reason === 'held back in review').length;
    totals.years += 1;
    totals.rounds += rounds.length;
    totals.contests += contests;
    totals.partialRounds += partial;
    totals.missingRounds += missing.length - heldBack;
    totals.heldBackRounds += heldBack;
    coverageYears.push({
      year,
      key: group.key,
      rounds: rounds.length,
      contests,
      partialRounds: partial,
      missingRounds: missing.length - heldBack,
      heldBackRounds: heldBack,
      hasAldermen: file.hasAldermen,
      levels: Object.fromEntries(Object.entries(levels).map(([id, level]) => [id, {
        available: level.available,
        edition: level.sourceMapId || null,
        editionDate: level.editionDate || null,
        areas: level.features.councillors.filter((f) => f.n).length,
        hatched: level.features.councillors.filter((f) => f.hatch).length,
        unplacedContests: level.unplaced.length
      }]))
    });
  }

  const coverage = {
    schemaVersion: 1,
    about: 'Coverage of the grouped pre-1973 Northern Ireland local elections, by year and level. Written by scripts/build/build-ni-local-grouped.mjs from the published rounds and data/elections/ni-local/round-status.json.',
    statusImportedAt: status.importedAt || null,
    totals,
    years: coverageYears
  };

  const writes = new Map();
  for (const [year, file] of outputs) writes.set(path.join(OUT_DIR, `${year}.json`), `${JSON.stringify(file)}\n`);
  writes.set(OUT_COVERAGE, `${JSON.stringify(coverage, null, 1)}\n`);

  if (CHECK) {
    // Line endings aside (a Windows checkout may hold CRLF).
    const stale = [...writes].filter(([file, text]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== text);
    const expected = new Set([...writes.keys()].map((file) => path.basename(file)));
    const extra = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter((name) => !expected.has(name)) : [];
    if (stale.length || extra.length) {
      console.error(`ni-local grouped files are stale: ${stale.map(([f]) => path.relative(ROOT, f)).concat(extra).join(', ')}. Run node scripts/build/build-ni-local-grouped.mjs`);
      process.exit(1);
    }
    console.log(`ni-local grouped files up to date (${outputs.size} years)`);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (!writes.has(path.join(OUT_DIR, name))) fs.rmSync(path.join(OUT_DIR, name));
  }
  for (const [file, text] of writes) fs.writeFileSync(file, text);
  if (unknownWork.size) {
    console.warn(`WARNING: unknown intake work status(es) ${[...unknownWork].join(', ')} in round-status.json were read as complete (known: ${ROUND_WORK_STATUSES.join(', ')})`);
  }
  console.log(`ni-local: ${totals.years} years, ${totals.rounds} rounds, ${totals.contests} contests; ${totals.partialRounds} partial, ${totals.missingRounds} missing, ${totals.heldBackRounds} held back`);
}

/**
 * One level of one year: the edition it is drawn on, and each feature's results, in two views
 * (councillors, aldermen). A feature item: { k: match key, l: label, n: contests placed,
 * seats: {party: n}, votes: {party: n} (contested polls only), c: 1 if any poll was contested,
 * hatch: 1 if results are missing or incomplete, why: the reason, r: [[round, contest], ...] }.
 * @param {string} level
 * @param {{
 *   year: number, firstDate: string, rounds: GroupedRound[], missing: MissingRound[], mapsById: Map<string, MapEntry>,
 *   renderBySource: Map<string, RenderLayer>, layerFeatures: Record<string, Layer>
 * }} context
 * @returns {GroupedLevel}
 */
function buildLevel(level, { firstDate, rounds, missing, mapsById, renderBySource, layerFeatures }) {
  // A round's tier is null where its body names no council type; it is on no level's list.
  /** @type {(string | null)[]} */
  const tiersAtLevel = Object.entries(NI_LOCAL_TIERS).filter(([, tier]) => tier.levels.includes(level)).map(([id]) => id);
  const relevant = rounds.map((round, index) => ({ round, index })).filter(({ round }) => tiersAtLevel.includes(round.tier));
  const relevantMissing = missing.filter((item) => tiersAtLevel.includes(item.tier));
  // The edition in force when this level's councils polled (a county council's June poll, not the
  // January borough polls of the same year).
  const levelDate = [...relevant.map(({ round }) => round.date), ...relevantMissing.map((item) => item.date)].sort()[0] || firstDate;
  let edition = chooseEdition(level, levelDate, mapsById, layerFeatures);
  if (level === 'ded' && edition && levelDate >= '1921-05-03') {
    // The rural DEDs were redrawn in 1923 (Tyrone, Fermanagh, Londonderry): the 1930 edition
    // carries the divisions the 1924-30 polls were fought on, the 1921 one those before. Of the
    // two, the one whose names answer more of this year's contests, the one in force when they tie.
    /** @param {string} id */
    const answered = (id) => {
      const keys = new Set((layerFeatures[id]?.features || []).flatMap((f) => [...featureKeys(f.label)]));
      let n = 0;
      for (const { round } of relevant) for (const contest of round.contests) if (nameKeys(contest.area).some((k) => keys.has(k))) n += 1;
      return n;
    };
    const best = LEVEL_EDITIONS.ded.after1921.filter((id) => layerFeatures[id])
      .map((id) => ({ id, n: answered(id) }))
      .sort((a, b) => b.n - a.n)[0];
    if (best && best.n > answered(edition.id)) edition = { id: best.id, date: String(mapsById.get(best.id)?.date || '') };
  }
  if (level === 'districts' && edition) {
    // Districts came and went (Newtownabbey 1958, Kilkeel 1935): of the complete editions, the
    // one that draws the most of this year's councils, the one in force when they tie.
    const spec = LEVEL_EDITIONS.districts;
    const pool = levelDate < '1921-05-03' ? spec.before1921 : spec.after1921;
    /** @param {string} id */
    const drawn = (id) => {
      const labels = (layerFeatures[id]?.features || []).map((f) => f.label);
      return new Set(relevant.map(({ round }) => round.bodySlug)
        .filter((slug) => labels.some((label) => districtMatchesAuthority(label, slug)))).size;
    };
    const best = pool.filter((id) => layerFeatures[id])
      .map((id) => ({ id, n: drawn(id) }))
      .sort((a, b) => b.n - a.n)[0];
    if (best && best.n > drawn(edition.id)) {
      edition = { id: best.id, date: String(mapsById.get(best.id)?.date || '') };
    }
  }
  const empty = { councillors: [], aldermen: [] };
  if (!relevant.length && !relevantMissing.length) {
    return { available: false, reason: 'No elections at this level this year', features: empty, unplaced: [] };
  }
  if (!edition) {
    return { available: false, reason: 'No boundary layer for this level', features: empty, unplaced: [] };
  }
  const layer = layerFeatures[edition.id];
  const render = renderBySource.get(edition.id);
  const features = layer.features.map((feature) => ({ ...feature, matchKey: feature.key || feature.label }));

  // contest placements: feature index -> [[roundIndex, contestIndex]]
  /** @type {Map<number, [number, number][]>} */
  const placements = new Map();
  /**
   * @param {number} fi
   * @param {number} ri
   * @param {number} ci
   */
  const place = (fi, ri, ci) => {
    if (!placements.has(fi)) placements.set(fi, []);
    // The key was set on the line before if it was missing.
    /** @type {[number, number][]} */ (placements.get(fi)).push([ri, ci]);
  };
  /** @type {[number, number][]} */
  const unplaced = [];
  /** @param {string} bodySlug */
  const featuresOfAuthority = (bodySlug) => features
    .map((feature, fi) => ({ feature, fi }))
    .filter(({ feature }) => districtMatchesAuthority(feature.district, bodySlug));
  /** @param {string | null} county */
  const featuresOfCounty = (county) => features
    .map((feature, fi) => ({ feature, fi }))
    .filter(({ feature }) => county && feature.county === county);

  /**
   * @param {FeatureRef[]} pool
   * @param {string} area
   * @param {string} stem
   * @returns {number | null}
   */
  const matchIn = (pool, area, stem) => {
    const keys = nameKeys(area);
    for (const { feature, fi } of pool) {
      const fk = featureKeys(feature.label, stem);
      if (keys.some((k) => fk.has(k))) return fi;
    }
    // Spelling: Killeavy and KILLEVY, Ballyshiel and BALLYSHEIL, within the council's own areas
    // only, and only where one name is clearly closest.
    const target = keys[0] || '';
    if (target.length < 5) return null;
    const scored = pool.map(({ feature, fi }) => {
      const best = Math.min(...[...featureKeys(feature.label, stem)].filter((k) => !k.startsWith('sorted:')).map((k) => editDistance(target, k)));
      return { fi, best };
    }).sort((a, b) => a.best - b.best);
    const limit = target.length >= 8 ? 2 : 1;
    if (scored.length && scored[0].best <= limit && (scored.length === 1 || scored[1].best > scored[0].best)) return scored[0].fi;
    return null;
  };

  // Which features an authority covers at this level (for hatching a missing or partial round).
  /**
   * @param {string} bodySlug
   * @param {string | null} county
   * @returns {number[]}
   */
  const authorityFeatures = (bodySlug, county) => {
    const tier = councilTypeOf(bodySlug);
    const stem = authorityStem(bodySlug);
    if (level === 'ded') return featuresOfAuthority(bodySlug).map(({ fi }) => fi);
    if (level === 'ced') return tier === 'county-council' ? featuresOfCounty(county).map(({ fi }) => fi) : [];
    if (level === 'towns') return features.map((f, fi) => ({ f, fi })).filter(({ f }) => stemKey(f.label) === stem).map(({ fi }) => fi);
    if (level === 'districts') {
      return features.map((f, fi) => ({ f, fi })).filter(({ f }) => districtMatchesAuthority(f.label, bodySlug)).map(({ fi }) => fi);
    }
    if (level === 'counties') {
      return features.map((f, fi) => ({ f, fi })).filter(({ f }) => {
        const label = niLocalNameKey(f.label);
        if (tier === 'county-borough') return label === `county borough of ${stem}`;
        return !label.startsWith('county borough') && f.county === county;
      }).map(({ fi }) => fi);
    }
    return [];
  };

  for (const { round, index: ri } of relevant) {
    const stem = authorityStem(round.bodySlug);
    const tier = round.tier;
    if (level === 'ded') {
      const own = featuresOfAuthority(round.bodySlug);
      const county = featuresOfCounty(round.county);
      const urban = tier !== 'rural-district';
      round.contests.forEach((contest, ci) => {
        let fi = matchIn(own, contest.area, urban ? stem : '');
        if (fi === null && !urban) fi = matchIn(county.filter(({ feature }) => !/\burban\b/i.test(feature.label)), contest.area, '');
        if (fi === null && urban) {
          // A whole-town poll: the town's name, or the council's only contest. It fills every DED
          // of the town.
          const areaKey = nameKeys(contest.area)[0] || '';
          const whole = areaKey === stem || areaKey === '' || stemKey(areaKey) === stem || round.contests.length === 1;
          if (whole && own.length) {
            for (const { fi: each } of own) place(each, ri, ci);
            return;
          }
          // The town's urban DEDs by name, where the overlay put them in another district.
          const townDeds = county.filter(({ feature }) => {
            const key = niLocalNameKey(feature.label);
            return /\burban\b/.test(key) && (key === stem || key.startsWith(`${stem} `));
          });
          fi = matchIn(townDeds, contest.area, stem);
        }
        if (fi === null) unplaced.push([ri, ci]);
        else place(fi, ri, ci);
      });
    } else if (level === 'ced') {
      const pool = featuresOfCounty(round.county);
      round.contests.forEach((contest, ci) => {
        const fi = matchIn(pool, contest.area, '');
        if (fi === null) unplaced.push([ri, ci]);
        else place(fi, ri, ci);
      });
    } else {
      const targets = authorityFeatures(round.bodySlug, round.county);
      round.contests.forEach((contest, ci) => {
        if (!targets.length) unplaced.push([ri, ci]);
        else for (const fi of targets) place(fi, ri, ci);
      });
    }
  }

  // Hatching: a partial round's areas with no contest, held-back areas, and missing rounds.
  /** @type {Map<string, string>} */
  const hatchReason = new Map();
  /**
   * @param {number} fi
   * @param {string} why
   * @param {string} view
   */
  const hatch = (fi, why, view) => {
    const key = `${view}:${fi}`;
    if (!hatchReason.has(key)) hatchReason.set(key, why);
  };
  const aggregate = level === 'districts' || level === 'counties' || level === 'towns';
  for (const { round, index: ri } of relevant) {
    const view = round.aldermen ? 'aldermen' : 'councillors';
    const targets = authorityFeatures(round.bodySlug, round.county);
    if (round.status !== 'complete') {
      const why = round.status === 'held'
        ? 'Results held back: not yet confirmed from a source'
        : (round.note ? `Results incomplete: ${round.note}` : 'Results incomplete: some contests are not yet confirmed');
      for (const fi of targets) {
        const placed = (placements.get(fi) || []).some(([r]) => r === ri);
        if (aggregate || !placed) hatch(fi, why, view);
      }
    }
    for (const area of round.heldAreas || []) {
      const pool = level === 'ced' ? featuresOfCounty(round.county) : (level === 'ded' ? featuresOfAuthority(round.bodySlug) : null);
      if (pool) {
        const fi = matchIn(pool, area, level === 'ded' && round.tier !== 'rural-district' ? authorityStem(round.bodySlug) : '');
        if (fi !== null) hatch(fi, `Result for ${area} held back: no source yet names the member`, view);
      } else {
        for (const fi of targets) hatch(fi, `Incomplete: the result for ${area} is held back`, view);
      }
    }
  }
  for (const item of relevantMissing) {
    const view = item.aldermen ? 'aldermen' : 'councillors';
    const why = item.reason === 'held back in review'
      ? 'Results held back in review'
      : 'No results yet, though an election was held';
    for (const fi of authorityFeatures(item.bodySlug, item.county)) {
      if (!(placements.get(fi) || []).some(([r]) => Boolean(rounds[r].aldermen) === Boolean(item.aldermen))) hatch(fi, why, view);
      else if (aggregate) hatch(fi, why, view);
    }
  }

  /** @param {string} view */
  const buildView = (view) => {
    const wantAldermen = view === 'aldermen';
    return features.map((feature, fi) => {
      const refs = (placements.get(fi) || []).filter(([ri, ci]) => Boolean(rounds[ri].contests[ci].aldermen || rounds[ri].aldermen) === wantAldermen);
      /** @type {Record<string, number>} */
      const seats = {};
      /** @type {Record<string, number>} */
      const votes = {};
      let contested = 0;
      for (const [ri, ci] of refs) {
        const contest = rounds[ri].contests[ci];
        for (const [, party, , vote, elected] of contest.cands) {
          if (elected) addTo(seats, party, 1);
          if (contest.contested && vote !== null) addTo(votes, party, vote);
        }
        if (contest.contested) contested = 1;
      }
      /** @type {FeatureItem} */
      const item = { k: feature.matchKey, l: feature.label, n: refs.length };
      if (refs.length) {
        item.seats = seats;
        if (contested) item.votes = votes;
        item.c = contested;
        item.r = refs;
      }
      const why = hatchReason.get(`${view}:${fi}`);
      if (why) {
        item.hatch = 1;
        item.why = why;
      }
      return item;
    }).filter((item) => item.n || item.hatch);
  };

  const councillors = buildView('councillors');
  const aldermen = buildView('aldermen');
  const available = councillors.some((f) => f.n) || aldermen.some((f) => f.n) || councillors.some((f) => f.hatch);
  /** @type {Partial<MapEntry>} */
  const mapEntry = mapsById.get(edition.id) || {};
  return {
    available,
    reason: available ? null : 'No boundary layer matches these results',
    sourceMapId: edition.id,
    layerId: render?.id || null,
    labelProperty: layer.labelProperty,
    keyProps: layer.keyProps || null,
    editionDate: edition.date,
    editionName: mapEntry.name || render?.name || edition.id,
    features: { councillors, aldermen },
    unplaced
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) main();
