/**
 * Maps, layers and the catalogue from the records database (data design phase 3, PHASE3.md):
 * shared by /_api/catalogue, /_api/layers and the compatibility routes for the files these
 * tables replaced (/data/database/maps.json, /agent/maps-index.json, /data/catalogue/*.json,
 * /data/browse/maps.json, features.json, details/maps/*).
 *
 * The records are stored as compact JSON text (packages/loader/src/ingest-maps.mjs), so most
 * answers are concatenations of stored text with no parse: a whole document is its head keys
 * in their stored order with the list spliced in at its own place.
 */
import { API_URLS, indexDocument, indexEntry } from '../../../core/src/layer-index.js';
import { parseJson } from './_records.js';
import { asStore } from '../../../storage/src/d1.js';
import { LAYERS, MAPS, MAP_CARDS } from '../queries/maps.js';

/** @typedef {import('../../../storage/src/store.js').RecordStore | D1Database} StoreOrBinding a store or a D1 binding (asStore) */
/** @typedef {import('../../../storage/src/store.js').RecordStore} RecordStore */
/** @typedef {import('../../../types/index.js').RecordsDb.CataloguePartsRow} CataloguePartsRow the head rows of catalogue_parts and layer_parts have the same shape */
/** @typedef {import('../../../types/index.js').RecordsDb.MapsRow} MapsRow */
/** @typedef {import('../../../types/index.js').RecordsDb.LayersRow} LayersRow */
/** @typedef {import('../../../types/index.js').RecordsDb.MapCardsRow} MapCardsRow */
/** @typedef {import('../../../types/index.js').RecordsDb.FeatureGroupsRow} FeatureGroupsRow */
/** @typedef {import('../../../types/index.js').RecordsDb.DocumentPartsRow} DocumentPartsRow */
/**
 * One top-level key of a stored document, in order: its JSON text, or null for the list's place.
 * @typedef {{ key: string, ord: number, value: string | null }} HeadPart
 */
/** @typedef {{ detail: (id: string) => string, duplicates: (id: string) => string }} LayerUrls where an index entry points (API_URLS or FILE_URLS) */

/**
 * The browser policy of every map document: revalidate each load (the ETag is the code and
 * dataset version, so an unchanged catalogue costs a 304), never a stale catalogue after a
 * publish (the old static maps.json's _headers rule, for the same reason).
 */
export const MAP_CACHE = { cacheControl: 'public, max-age=0, must-revalidate' };

/**
 * The document's head rows (key, ord, value) and the list's place, as [key, valueText][] in order.
 * @param {RecordStore} db
 * @param {'catalogue_parts' | 'layer_parts'} table
 * @param {string} listKey
 * @param {number} listOrd
 * @returns {Promise<HeadPart[]>}
 */
async function headParts(db, table, listKey, listOrd) {
  const results = /** @type {Pick<CataloguePartsRow, 'key' | 'ord' | 'value'>[]} */ (await db.all(MAPS.headParts(table)));
  /** @type {HeadPart[]} */
  const rows = results.map((r) => ({ key: r.key, ord: Number(r.ord), value: r.value }));
  rows.push({ key: listKey, ord: listOrd, value: null });
  return rows.sort((a, b) => a.ord - b.ord || (a.key < b.key ? -1 : 1));
}

/**
 * Where the list sits in a document: one past the last head key before it (its ord is the gap).
 * @param {RecordStore} db
 * @param {'catalogue_parts' | 'layer_parts'} table
 */
async function listOrd(db, table) {
  // ingest-maps.mjs numbers every top-level key, the list included, and stores the others: the
  // list's ord is the one number in 0..n missing from the head rows.
  const results = await db.all(MAPS.headOrds(table));
  const taken = new Set(results.map((r) => Number(r.ord)));
  let i = 0;
  while (taken.has(i)) i += 1;
  return i;
}

/**
 * Compact JSON text of a document whose list is the given texts (each already JSON).
 * @param {HeadPart[]} parts
 * @param {string[]} listTexts
 */
function compactDocument(parts, listTexts) {
  return `{${parts.map((p) => `${JSON.stringify(p.key)}:${p.value === null ? `[${listTexts.join(',')}]` : p.value}`).join(',')}}`;
}

/**
 * JSON.stringify(doc, null, 2) + "\n", written from the parts without building the object.
 * @param {HeadPart[]} parts
 * @param {unknown[]} listValues
 */
function prettyDocument(parts, listValues) {
  const indent = (/** @type {string} */ text, /** @type {string} */ pad) => text.replace(/\n/g, `\n${pad}`);
  const lines = parts.map((p) => {
    let value;
    if (p.value === null) {
      value = listValues.length
        ? `[\n${listValues.map((v) => `    ${indent(JSON.stringify(v, null, 2), '    ')}`).join(',\n')}\n  ]`
        : '[]';
    } else value = indent(JSON.stringify(parseJson(p.value), null, 2), '  ');
    return `  ${JSON.stringify(p.key)}: ${value}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

// ---------------------------------------------------------------- maps.json

/**
 * The catalogue document (maps.json) as text: compact for the API, or the file's own bytes.
 * @param {StoreOrBinding} source
 * @param {{ visibleOnly?: boolean, pretty?: boolean }} [options]
 * @returns {Promise<string | null>}
 */
export async function mapsDocumentText(source, { visibleOnly = false, pretty = false } = {}) {
  const db = asStore(source);
  const [ord, maps] = await Promise.all([
    listOrd(db, 'catalogue_parts'),
    /** @type {Promise<Pick<MapsRow, 'record'>[]>} */ (db.all(visibleOnly ? MAPS.visible : MAPS.all)),
  ]);
  const parts = await headParts(db, 'catalogue_parts', 'maps', ord);
  const records = maps.map((r) => r.record);
  if (!records.length && parts.length === 1) return null;
  return pretty ? prettyDocument(parts, records.map((t) => parseJson(t))) : compactDocument(parts, records);
}

/**
 * One catalogue record's JSON text, by id or else by slug; null when there is none.
 * @param {StoreOrBinding} source
 * @param {{ id?: string | null, slug?: string | null }} key
 * @returns {Promise<string | null>}
 */
export async function mapRecord(source, { id = null, slug = null }) {
  const db = asStore(source);
  const row = /** @type {Pick<MapsRow, 'record'> | null} */ (id
    ? await db.first(MAPS.byId, [id])
    : await db.first(MAPS.bySlug, [slug]));
  return row ? row.record : null;
}

/**
 * The catalogue records of one category, as `{"maps":[...]}` text.
 * @param {StoreOrBinding} source
 * @param {string} category
 * @param {boolean} visibleOnly
 */
export async function mapsInCategory(source, category, visibleOnly) {
  const db = asStore(source);
  const results = /** @type {Pick<MapsRow, 'record'>[]} */ (await db.all(visibleOnly ? MAPS.categoryVisible : MAPS.category, [category]));
  return `{"maps":[${results.map((r) => r.record).join(',')}]}`;
}

// ---------------------------------------------------------------- layers (maps-test.json)

/**
 * The live id for an id or one of its other spellings (layer_aliases), or null.
 * @param {StoreOrBinding} source
 * @param {string} id
 * @returns {Promise<{ id: string, alias: boolean } | null>}
 */
export async function resolveLayerId(source, id) {
  const db = asStore(source);
  const live = await db.first(LAYERS.live, [id]);
  if (live) return { id: String(live.layer_id), alias: false };
  const alias = await db.first(LAYERS.alias, [id]);
  return alias ? { id: String(alias.layer_id), alias: true } : null;
}

/**
 * The full render metadata (maps-test.json), compact.
 * @param {StoreOrBinding} source
 * @returns {Promise<string | null>}
 */
export async function layersDocumentText(source) {
  const db = asStore(source);
  const [ord, layers] = await Promise.all([
    listOrd(db, 'layer_parts'),
    /** @type {Promise<Pick<LayersRow, 'record'>[]>} */ (db.all(LAYERS.records)),
  ]);
  const parts = await headParts(db, 'layer_parts', 'layers', ord);
  const records = layers.map((r) => r.record);
  if (!records.length && parts.length === 1) return null;
  return compactDocument(parts, records);
}

/**
 * The startup index (maps-test-index.json's shape), its entries pointing at this API.
 * @param {StoreOrBinding} source
 * @param {LayerUrls} [urls]
 */
export async function layerIndexDocument(source, urls = API_URLS) {
  const db = asStore(source);
  const [ord, layers, head] = await Promise.all([
    listOrd(db, 'layer_parts'),
    /** @type {Promise<Pick<LayersRow, 'record' | 'duplicates'>[]>} */ (db.all(LAYERS.index)),
    db.all(LAYERS.head),
  ]);
  const rows = layers;
  if (!rows.length && !head.length) return null;
  const parts = await headParts(db, 'layer_parts', 'layers', ord);
  /** @type {Record<string, unknown>} */
  const headObject = {};
  for (const p of parts) headObject[p.key] = p.value === null ? [] : parseJson(p.value);
  const entries = rows.map((r) => indexEntry(parseJson(r.record, {}), parseJson(r.duplicates), urls));
  return indexDocument(headObject, entries);
}

/**
 * One layer's row (its record and duplicate-id sidecar, as JSON text).
 * @param {StoreOrBinding} source
 * @param {string} id
 * @returns {Promise<Pick<LayersRow, 'record' | 'duplicates'> | null>}
 */
export async function layerRow(source, id) {
  const db = asStore(source);
  return /** @type {Promise<Pick<LayersRow, 'record' | 'duplicates'> | null>} */ (db.first(LAYERS.row, [id]));
}

// ---------------------------------------------------------------- verbatim documents

/**
 * A document stored in parts (document_parts), as its exact text, or null.
 * @param {StoreOrBinding} source
 * @param {string} name
 * @returns {Promise<string | null>}
 */
export async function storedDocumentText(source, name) {
  const db = asStore(source);
  const results = /** @type {Pick<DocumentPartsRow, 'body'>[]} */ (await db.all(MAPS.documentParts, [name]));
  return results.length ? results.map((r) => r.body).join('') : null;
}

/**
 * The catalogue-pane documents by their API view name.
 * @type {Readonly<Record<string, string>>}
 */
export const CATALOGUE_VIEWS = {
  pane: 'catalogue/catalogue.json',
  places: 'catalogue/places.json',
  people: 'catalogue/people.json',
  agent: 'agent/maps-index.json',
};

// ---------------------------------------------------------------- Browse map files

/**
 * The Browse maps list (/data/browse/maps.json) as compact text; null when not loaded.
 * @param {StoreOrBinding} source
 * @returns {Promise<string | null>}
 */
export async function browseMapsText(source) {
  const db = asStore(source);
  const [headRow, cards] = await Promise.all([
    db.first(MAP_CARDS.head, ['browse/maps.json']),
    /** @type {Promise<Pick<MapCardsRow, 'card'>[]>} */ (db.all(MAP_CARDS.cards)),
  ]);
  if (!headRow) return null;
  const head = parseJson(headRow.body, {});
  return compactDocument(/** @type {Array<{ key: string, ord: number, value: string | null }>} */ (Object.entries(head).map(([key, v], i) => ({ key, ord: i, value: JSON.stringify(v) })))
    .concat([{ key: 'items', ord: 1e9, value: null }]), cards.map((r) => r.card));
}

/**
 * The Browse features list (/data/browse/features.json) as compact text; null when not loaded.
 * @param {StoreOrBinding} source
 * @returns {Promise<string | null>}
 */
export async function browseFeaturesText(source) {
  const db = asStore(source);
  const [headRow, groups] = await Promise.all([
    db.first(MAP_CARDS.head, ['browse/features.json']),
    /** @type {Promise<Pick<FeatureGroupsRow, 'card'>[]>} */ (db.all(MAP_CARDS.featureGroups)),
  ]);
  if (!headRow) return null;
  const head = parseJson(headRow.body, {});
  return compactDocument(/** @type {Array<{ key: string, ord: number, value: string | null }>} */ (Object.entries(head).map(([key, v], i) => ({ key, ord: i, value: JSON.stringify(v) })))
    .concat([{ key: 'items', ord: 1e9, value: null }]), groups.map((r) => r.card));
}

/**
 * A Browse map record (its page's item) by slug, or by map id when no slug matches.
 * @param {StoreOrBinding} source
 * @param {string} slugOrId
 */
export async function browseMapRecord(source, slugOrId) {
  const db = asStore(source);
  const bySlug = await db.first(MAP_CARDS.bySlug, [slugOrId]);
  const row = bySlug || await db.first(MAP_CARDS.byId, [slugOrId]);
  return row || null;
}
