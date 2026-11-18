/**
 * An electoral area in its census context (el-context, 14 Nov 2026): a few standard census
 * indicators for the area, each with its rank among the other areas of the same boundary set and
 * the Northern Ireland figure, the census table cited by its code, and the areas most like it.
 * Pure (no DOM): unit test elections-app-census-context.test.mjs.
 *
 * The figures are site/apps/elections/census/ni-areas.json, written by
 * scripts/build/elections-app/census-context.mjs from NISRA's tables (Open Government Licence):
 * a boundary set (its map layers), the censuses held for it (the census published at that
 * geography, or at one nesting in it exactly), and each area's counts. Which census an election
 * gets is the one nearest its date. An area of a layer with no set (the constituencies of 2023,
 * every Republic of Ireland area) is "not yet held".
 *
 * The labels are English and keyed for translation in data/i18n/strings/elections.txt (R10).
 */
import { appUrl } from './format.js';

/**
 * The data file's shape.
 * @typedef {Record<string, number[]>} AreaFigures   indicator id -> [value] or [numerator, denominator]
 * @typedef {{ code: string, title: string }} TableRef
 * @typedef {{ year: number, date: string, source: string, geography: string, tables: Record<string, TableRef>, areas: Record<string, AreaFigures> }} CensusBlock
 * @typedef {{ id: string, layers: string[], censuses: CensusBlock[] }} CensusSet
 * @typedef {{ schemaVersion: number, licence: string, licenceUrl: string, indicators: string[], sets: CensusSet[] }} CensusData
 */

/**
 * One indicator of one area, ready to show.
 * @typedef {{ id: string, label: string, base: string, kind: 'count' | 'pct', value: number, rank: number, of: number, ni: number | null, table: TableRef }} IndicatorRow
 * @typedef {{ name: string, distance: number }} SimilarArea
 * @typedef {{ status: 'shown', set: CensusSet, census: CensusBlock, area: string, rows: IndicatorRow[], similar: SimilarArea[], others: number[] }
 *   | { status: 'not-held' } | { status: 'no-area', set: CensusSet, census: CensusBlock }} AreaContext
 */

/** Each indicator's label (what is counted). */
export const INDICATOR_LABELS = Object.freeze(/** @type {Record<string, string>} */ ({
  residents: 'Usual residents',
  age65: 'Aged 65 and over',
  owner: 'Owner-occupied homes',
  social: 'Socially rented homes',
  nocar: 'Homes with no car or van',
  level4: 'Degree-level qualifications',
  unemployed: 'Unemployed',
}));

/** What each share is a share of; where a census counted another base, its own wording. */
const BASES = Object.freeze(/** @type {Record<string, string>} */ ({
  residents: 'people usually living in the area',
  age65: 'of usual residents',
  owner: 'of households',
  social: 'of households (Housing Executive and housing associations)',
  nocar: 'of households',
  level4: 'of residents aged 16 and over (level 4 or above)',
  unemployed: 'of economically active residents aged 16 and over',
}));
const BASES_16_74 = Object.freeze(/** @type {Record<string, string>} */ ({
  level4: 'of residents aged 16 to 74 (level 4 or above)',
  unemployed: 'of economically active residents aged 16 to 74',
}));

/** Every fixed text this module gives the view (for the key test). */
export const CONTEXT_TEXT = Object.freeze([...Object.values(INDICATOR_LABELS), ...Object.values(BASES), ...Object.values(BASES_16_74)]);

/**
 * What a share is of, in a census year (2001 counted qualifications and unemployment at 16 to 74;
 * 2011 unemployment too).
 * @param {string} id @param {number} year
 */
export function baseOf(id, year) {
  if (id === 'level4' && year === 2001) return BASES_16_74.level4;
  if (id === 'unemployed' && year <= 2011) return BASES_16_74.unemployed;
  return BASES[id] || '';
}

/** An area name's matching key: letters and digits only, upper case, "&" as AND (the build script's rule). @param {unknown} name */
export const areaKey = (name) => String(name || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]/g, '');

/** The boundary set of a map layer, or null. @param {CensusData} data @param {string | null | undefined} layerId */
export function setFor(data, layerId) {
  return (data.sets || []).find((s) => s.layers.includes(String(layerId || ''))) || null;
}

/**
 * The census nearest a date (an earlier one on a tie), or the latest when the date is unknown.
 * @param {CensusSet} set @param {string | null | undefined} date ISO date
 */
export function censusFor(set, date) {
  const list = [...set.censuses].sort((a, b) => a.year - b.year);
  const t = Date.parse(String(date || ''));
  if (!Number.isFinite(t)) return list[list.length - 1];
  let best = list[0];
  for (const c of list) if (Math.abs(Date.parse(c.date) - t) < Math.abs(Date.parse(best.date) - t)) best = c;
  return best;
}

/** An area's figure: the count, or the share (%) for a numerator and denominator. @param {number[] | undefined} f */
export function figure(f) {
  if (!f || !f.length) return null;
  if (f.length === 1) return f[0];
  return f[1] ? (100 * f[0]) / f[1] : null;
}

/**
 * The rank of `value` among `values`, the highest first (1 = highest); equal values share a rank.
 * @param {number} value @param {readonly (number | null)[]} values
 */
export function rankOf(value, values) {
  return 1 + values.filter((v) => v !== null && v > value).length;
}

/** The figure for all the areas together (Northern Ireland when the set covers it). @param {CensusBlock} census @param {string} id */
export function totalOf(census, id) {
  let n = 0;
  let d = 0;
  for (const a of Object.values(census.areas)) {
    const f = a[id];
    if (!f) continue;
    n += f[0];
    if (f.length > 1) d += f[1];
  }
  return d ? (100 * n) / d : n;
}

/** The share indicators (similarity uses these, not the size of the area). @param {CensusData} data */
const shareIds = (data) => data.indicators.filter((id) => id !== 'residents');

/**
 * The areas most like one area: the smallest distance over the share indicators, each scaled by
 * its spread across the set (z-scores), so no one indicator dominates.
 * @param {CensusData} data @param {CensusBlock} census @param {string} area @param {number} [k]
 * @returns {SimilarArea[]}
 */
export function similarAreas(data, census, area, k = 5) {
  const ids = shareIds(data);
  const names = Object.keys(census.areas);
  /** @type {Record<string, { mean: number, sd: number }>} */
  const scale = {};
  for (const id of ids) {
    const xs = names.map((n) => figure(census.areas[n][id])).filter((v) => v !== null).map(Number);
    const mean = xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (xs.length || 1)) || 1;
    scale[id] = { mean, sd };
  }
  const z = (/** @type {string} */ n, /** @type {string} */ id) => ((figure(census.areas[n][id]) ?? scale[id].mean) - scale[id].mean) / scale[id].sd;
  return names.filter((n) => n !== area)
    .map((n) => ({ name: n, distance: Math.sqrt(ids.reduce((s, id) => s + (z(n, id) - z(area, id)) ** 2, 0)) }))
    .sort((a, b) => a.distance - b.distance || (a.name < b.name ? -1 : 1))
    .slice(0, k);
}

/**
 * An area's census context, or why there is none.
 * @param {CensusData} data
 * @param {{ layerId?: string | null | undefined, area?: string | null, date?: string | null }} where the election's layer, the
 *   contest's feature (or contest) name, and the election's date
 * @returns {AreaContext}
 */
export function areaContext(data, { layerId, area, date }) {
  const set = setFor(data, layerId);
  if (!set) return { status: 'not-held' };
  const census = censusFor(set, date);
  const key = areaKey(area);
  const name = Object.keys(census.areas).find((n) => areaKey(n) === key);
  if (!name) return { status: 'no-area', set, census };
  const names = Object.keys(census.areas);
  const rows = data.indicators.map((id) => {
    const value = /** @type {number} */ (figure(census.areas[name][id]));
    const values = names.map((n) => figure(census.areas[n][id]));
    return {
      id,
      label: INDICATOR_LABELS[id] || id,
      base: baseOf(id, census.year),
      kind: /** @type {'count' | 'pct'} */ (census.areas[name][id].length === 1 ? 'count' : 'pct'),
      value,
      rank: rankOf(value, values),
      of: names.length,
      ni: totalOf(census, id),
      table: census.tables[id],
    };
  });
  const others = set.censuses.map((c) => c.year).filter((y) => y !== census.year);
  return { status: 'shown', set, census, area: name, rows, similar: similarAreas(data, census, name), others };
}

/**
 * An area's name as a reader sees it: the layers of 1995 and 2008 name their features in capitals
 * (BELFAST EAST), so those read in title case (Belfast East), with "and" and "of" kept small.
 * @param {string} name
 */
export function displayName(name) {
  const s = String(name || '');
  if (s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase())
    .replace(/(?<=\s)(And|Of|The)(?=\s)/g, (w) => w.toLowerCase());
}

/** The boundary sets' names, for the heading ("among the 80 District Electoral Areas of 2014"). */
export const SET_NAMES = Object.freeze(/** @type {Record<string, string>} */ ({
  'dea-2014': 'District Electoral Areas of 2014',
  'dea-1993': 'District Electoral Areas of 1993',
  'pc-2008': 'constituencies of 2008',
  'pc-1995': 'constituencies of 1995',
}));

/**
 * Links from an area's name to its contest in the same election (until area pages exist): the
 * election's result entries matched by name (letters and digits only, as the census areas are).
 * @param {string} key the election's key
 * @param {ReadonlyArray<{ key?: string, resultName?: string, resultKind?: string }>} entries the election detail's resultEntries
 * @returns {(area: string) => string | null}
 */
export function contestLinker(key, entries) {
  /** @type {Map<string, string>} */
  const slugs = new Map();
  for (const e of entries) {
    if (e.resultKind && e.resultKind !== 'constituency-result') continue;
    const slug = String(e.key || '').split('::')[1];
    const k = areaKey(e.resultName);
    if (slug && k && !slugs.has(k)) slugs.set(k, slug);
  }
  return (area) => {
    const slug = slugs.get(areaKey(area));
    return slug ? appUrl.contest(key, slug) : null;
  };
}
