/**
 * What a catalogue row shows, derived from the catalogue document alone (view-maps.js draws it):
 * which actions the row offers, its editions as a dated list, and the count on its second line.
 * Pure: no DOM, no controller (its unit test is catalogue-row-model.test.mjs).
 *
 * Phelim Birch's notes on map actions and layout, approved by the owner on 19 Nov 2026:
 *   - a row of several maps acts on the row (Copy link, Cite, Compare two of its editions); a row of
 *     one map acts on that map (Add, Zoom, Download, Details); every map inside a row has its chip
 *     and its own Zoom, Download and Details;
 *   - the opened row lists its editions by date (the map's own timeline is the slider under the map);
 *   - a row of dated editions of one map counts "N <unit> · M editions", from its latest edition, or
 *     from its latest complete one when the latest is incomplete.
 */

import { creditLine } from '../../../core/src/credits.mjs';

/** @typedef {import('./catalogue-types.d.ts').CatalogueRow} CatalogueRow */
/** @typedef {import('./catalogue-types.d.ts').CatalogueRowMember} CatalogueRowMember */
/** @typedef {import('./catalogue-types.d.ts').CatalogueMapRec} CatalogueMapRec */
/** @typedef {(id: string) => CatalogueMapRec} RecordOf */

/** A row's actions, by the shape of the row. @typedef {'row' | 'map' | 'none'} RowActionKind */

/**
 * The editions of a row: its members that are not another member's version.
 * @param {CatalogueRow} s
 * @returns {CatalogueRowMember[]}
 */
export function rowEditions(s) {
  return s.members.filter((m) => !m.of);
}

/**
 * Whether the row acts on itself (several maps), on its one map, or not at all (nothing drawn yet).
 * @param {CatalogueRow} s
 * @returns {RowActionKind}
 */
export function rowActionKind(s) {
  if (!s.members.length) return 'none';
  return rowEditions(s).length > 1 ? 'row' : 'map';
}

/**
 * A date as a sortable key ("1977-01-01", "1977"): '' when there is none.
 * @param {CatalogueMapRec | undefined} r
 */
const dateKey = (r) => {
  const d = String(r?.date || '');
  return /^\d{4}/.test(d) ? d : '';
};

/**
 * A row's maps as its opened row lists them: for a row of editions, the dated ones newest first;
 * for any other row, in the row's own order. Undated maps keep their place at the end.
 * @param {CatalogueRow} s
 * @param {RecordOf} rec
 * @returns {CatalogueRowMember[]}
 */
export function datedList(s, rec) {
  const editions = rowEditions(s);
  if (s.arrangement !== 'editions') return editions;
  const keyed = editions.map((m, i) => ({ m, i, k: dateKey(rec(m.id)) }));
  keyed.sort((a, b) => {
    if (a.k && b.k) return a.k === b.k ? a.i - b.i : (a.k < b.k ? 1 : -1);
    if (a.k || b.k) return a.k ? -1 : 1;
    return a.i - b.i;
  });
  return keyed.map((x) => x.m);
}

/**
 * Whether a map is drawn whole: neither marked incomplete nor still to be added.
 * @param {CatalogueMapRec | undefined} r
 */
export const isComplete = (r) => Boolean(r) && r?.status !== 'incomplete' && r?.status !== 'placeholder';

/**
 * The edition a row of editions takes its count from: the latest, or the latest complete one when
 * the latest is incomplete; null when none is complete.
 * @param {CatalogueRow} s
 * @param {RecordOf} rec
 * @returns {CatalogueRowMember | null}
 */
export function countEdition(s, rec) {
  const dated = datedList(s, rec).filter((m) => dateKey(rec(m.id)));
  return dated.find((m) => isComplete(rec(m.id))) || null;
}

/**
 * The count on a row of dated editions of one map: how many features its latest (complete)
 * edition has, in that edition's unit, and how many editions the row has. Null for any other row.
 * `features` is null when no complete edition has a count.
 * @param {CatalogueRow} s
 * @param {RecordOf} rec
 * @returns {{ features: number | null, unit: string, editions: number, from: string | null } | null}
 */
export function rowCount(s, rec) {
  const editions = rowEditions(s).filter((m) => rec(m.id)?.status !== 'placeholder');
  if (s.arrangement !== 'editions' || editions.length < 2) return null;
  const from = countEdition(s, rec);
  const r = from ? rec(from.id) : undefined;
  const n = r?.features;
  const features = Number.isFinite(n) && /** @type {number} */ (n) > 0 ? /** @type {number} */ (n) : null;
  return { features, unit: features ? (r?.unit || s.unit || '') : '', editions: editions.length, from: features && from ? from.id : null };
}

/**
 * The pairs a row's Compare offers: every drawable edition (or version) of the row, the first
 * choice and then the other. Fewer than two: no Compare.
 * @param {CatalogueRow} s
 * @param {RecordOf} rec
 * @returns {CatalogueRowMember[]}
 */
export function comparable(s, rec) {
  return datedList(s, rec).concat(s.members.filter((m) => m.of)).filter((m) => rec(m.id)?.status !== 'placeholder');
}

/**
 * A row's citation, as Cite copies it: whom to credit (packages/core/src/credits.mjs), the row's
 * name and years, what it is, and where.
 * @param {CatalogueRow} s
 * @param {string} url  the row's address
 * @param {string} accessed  the day, as the site writes dates
 * @returns {string}
 */
export function rowCitation(s, url, accessed) {
  const who = creditLine(s.provider || [], s.derivedFrom || []) || 'Civgraph';
  const years = s.years ? (s.years[0] === s.years[1] ? String(s.years[0]) : `${s.years[0]}–${s.years[1]}`) : '';
  return `${who}. ${s.name}${years && !s.name.includes(years) ? ` (${years})` : ''} [map series]. Civgraph, ${url} (accessed ${accessed}).`;
}

/** A provider of the catalogue (the providers registry's browser slice): id, full name, short name, the strings it stands for. @typedef {[string, string, string, string[]]} ProviderEntry */

/**
 * The provider registry as lookups: a provider string's entry id, and an id's entry.
 * @param {ProviderEntry[]} entries
 */
export function providerIndex(entries) {
  /** @type {Map<string, string>} */
  const idOf = new Map();
  /** @type {Map<string, { id: string, full: string, short: string }>} */
  const byId = new Map();
  for (const [id, full, short, names] of entries) {
    byId.set(id, { id, full, short });
    for (const n of names) idOf.set(n, id);
  }
  return { idOf, byId };
}

/**
 * The providers a row credits, as registry ids: the row's own and its maps' (council maps
 * included). A string the registry does not know stands for itself.
 * @param {CatalogueRow} s
 * @param {RecordOf} rec
 * @param {Map<string, string>} idOf
 * @returns {Set<string>}
 */
export function rowProviderIds(s, rec, idOf) {
  /** @type {Set<string>} */
  const out = new Set();
  const add = (/** @type {string[] | undefined} */ names) => { for (const n of names || []) out.add(idOf.get(n) || n); };
  add(/** @type {string[] | undefined} */ (s.provider));
  for (const m of [...s.members, ...(s.local || [])]) add(rec(m.id)?.provider);
  return out;
}

/**
 * How many of the rows each provider is credited on.
 * @param {Iterable<Set<string>>} rowsProviders  each row's provider ids
 * @returns {Map<string, number>}
 */
export function providerCounts(rowsProviders) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const ids of rowsProviders) for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  return counts;
}

/**
 * Whether a row passes the provider filter: no provider chosen, or one of the chosen is credited.
 * @param {Set<string>} ids  the row's provider ids
 * @param {string[] | undefined} chosen
 */
export const passesProviders = (ids, chosen) => !chosen?.length || chosen.some((id) => ids.has(id));

/**
 * A map's name as the catalogue gives it, in the legend, the loaded-layers panel, messages and its
 * Details page: its row's name, with the map's own label when the row lists several maps or the map
 * is one of the row's council maps ("Counties, 1922"; "Townlands" for a row of one map); '' for a
 * map the row does not list.
 * @param {CatalogueRow | undefined} s  the map's row
 * @param {string} id
 * @returns {string}
 */
export function mapTitle(s, id) {
  if (!s) return '';
  const member = [...(s.members || []), ...(s.local || [])].find((m) => m.id === id);
  if (member && (s.members.length > 1 || s.local?.some((m) => m.id === id))) return `${s.name}, ${member.label}`;
  return s.name;
}

/**
 * How many maps a row holds: its maps and versions, and its council maps (not the maps still to
 * be added, nor a map's parts).
 * @param {CatalogueRow} s
 * @returns {number}
 */
export function rowMapCount(s) {
  return s.members.length + (s.local?.length || 0);
}

/** A heading /maps shows above a row. @typedef {{ name: string, flat?: boolean | undefined }} TrailHeading */

/**
 * Where a row sits in the catalogue, by the headings /maps shows above it: its section's tab
 * ("Boundaries", "Places", "Historic"), its shelf (a section listed flat shows no shelves), its
 * subject when the shelf heads its rows by subject and the subject is not named as the row is, and
 * the row's own name when the row holds more than one map ("Boundaries › Historic Geographies ›
 * Townlands": Phelim Birch, 20 Nov 2026). A row of one map is named by the map's own name
 * (mapTitle), so the line does not repeat it; nor does it for the row's one main map when its
 * council maps make the row more than one ("Municipal Districts" ends "› Current", while its
 * council map "Municipal Districts, Westmeath (2019)" ends "› Municipal Districts", the map it is
 * a copy of: Phelim Birch, 26 Nov 2026).
 * @param {{ section: string, flatSection?: boolean, shelf?: TrailHeading | undefined, subject?: TrailHeading | undefined, row: { name: string, maps?: number, title?: string } }} where
 *   row.maps: how many maps the row holds (rowMapCount); row.title: the page's title (mapTitle)
 * @returns {string[]}
 */
export function catalogueTrail({ section, flatSection = false, shelf, subject, row }) {
  /** @type {string[]} */
  const out = section ? [section] : [];
  if (!flatSection && shelf?.name) {
    out.push(shelf.name);
    if (!shelf.flat && subject?.name && subject.name !== row.name && subject.name !== shelf.name) out.push(subject.name);
  }
  if ((row.maps || 0) > 1 && row.name && out[out.length - 1] !== row.name && row.title !== row.name) out.push(row.name);
  return out;
}

/**
 * The name the catalogue gives one of a map's parts or county maps (the opened row's chips), or ''
 * when it lists none by that id.
 * @param {CatalogueMapRec | undefined} r  the map's record in the catalogue
 * @param {string} partId
 * @returns {string}
 */
export function partLabel(r, partId) {
  return [...(r?.parts || []), ...(r?.counties || [])].find((p) => p.id === partId)?.label || '';
}

/** The catalogue document as detailHolders reads it. @typedef {Pick<import('./catalogue-types.d.ts').CatalogueDoc, 'series' | 'maps' | 'mapLinks' | 'ownDetails'>} HolderDoc */

/**
 * The map whose Details page opens for a map that has no page of its own in the catalogue
 * (data-service.js detailPageId): a part or county map opens the map the catalogue lists it under
 * (Phelim Birch's review, owner-approved 20 Nov 2026); a map in no row that the catalogue links to
 * one of its maps (mapLinks: Townlands 1844, whose county maps Townlands lists) opens that map,
 * when it is another copy, version or part of that map. One that shows another subject on that
 * map's areas (ownDetails: the referendums counted by Westminster constituency, which link to the
 * constituency map) keeps its own page (owner, 21 Nov 2026). A map a row lists keeps its own page.
 * @param {HolderDoc} doc
 * @returns {Map<string, string>}  map id -> the id whose page opens
 */
export function detailHolders(doc) {
  /** @type {Set<string>} */
  const inRow = new Set();
  for (const s of doc.series) for (const m of [...s.members, ...(s.local || [])]) inRow.add(m.id);
  /** @type {Map<string, string>} */
  const holders = new Map();
  for (const s of doc.series) {
    for (const m of s.members) {
      const r = doc.maps[m.id];
      for (const p of [...(r?.parts || []), ...(r?.counties || [])]) if (!inRow.has(p.id) && !holders.has(p.id)) holders.set(p.id, m.id);
    }
  }
  const own = new Set(doc.ownDetails || []);
  for (const [id, link] of Object.entries(doc.mapLinks || {})) {
    if (link.map && link.map !== id && inRow.has(link.map) && !inRow.has(id) && !own.has(id) && !holders.has(id)) holders.set(id, link.map);
  }
  return holders;
}

/**
 * A map's own description, where the catalogue shows one: a census statistic's says what it
 * measures and over which areas. Other maps are described by their row (descriptions.json); their
 * records' own texts are not shown in the catalogue. The text is the record's, unchanged; '' when
 * it has none. Shown on the map's Details page and in its row (Phelim Birch, 20 Nov 2026).
 * @param {{ isDataEntry?: boolean, description?: string | null } | null | undefined} record  the map as the map app reads it (dataService.getMapById)
 * @returns {string}
 */
export function ownDescription(record) {
  return record?.isDataEntry && typeof record.description === 'string' ? record.description.trim() : '';
}
