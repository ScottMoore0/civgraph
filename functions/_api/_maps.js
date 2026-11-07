/**
 * Maps, layers and the catalogue from the records database (data design phase 3, PHASE3.md):
 * shared by /_api/catalogue, /_api/layers and the compatibility routes for the files these
 * tables replaced (/data/database/maps.json, /agent/maps-index.json, /data/catalogue/*.json,
 * /data/browse/maps.json, features.json, details/maps/*).
 *
 * The records are stored as compact JSON text (scripts/records/ingest-maps.mjs), so most
 * answers are concatenations of stored text with no parse: a whole document is its head keys
 * in their stored order with the list spliced in at its own place.
 */
import { API_URLS, indexDocument, indexEntry } from '../_lib/layer-index.js';
import { parseJson } from './_records.js';

/**
 * The browser policy of every map document: revalidate each load (the ETag is the code and
 * dataset version, so an unchanged catalogue costs a 304), never a stale catalogue after a
 * publish (the old static maps.json's _headers rule, for the same reason).
 */
export const MAP_CACHE = { cacheControl: 'public, max-age=0, must-revalidate' };

/** The document's head rows (key, ord, value) and the list's place, as [key, valueText][] in order. */
async function headParts(db, table, listKey, listOrd) {
  const { results } = await db.prepare(`SELECT key, ord, value FROM ${table} ORDER BY ord, key`).all();
  const rows = (results || []).map((r) => ({ key: r.key, ord: Number(r.ord), value: r.value }));
  rows.push({ key: listKey, ord: listOrd, value: null });
  return rows.sort((a, b) => a.ord - b.ord || (a.key < b.key ? -1 : 1));
}

/** Where the list sits in a document: one past the last head key before it (its ord is the gap). */
async function listOrd(db, table) {
  // ingest-maps.mjs numbers every top-level key, the list included, and stores the others: the
  // list's ord is the one number in 0..n missing from the head rows.
  const { results } = await db.prepare(`SELECT ord FROM ${table} ORDER BY ord`).all();
  const taken = new Set((results || []).map((r) => Number(r.ord)));
  let i = 0;
  while (taken.has(i)) i += 1;
  return i;
}

/** Compact JSON text of a document whose list is the given texts (each already JSON). */
function compactDocument(parts, listTexts) {
  return `{${parts.map((p) => `${JSON.stringify(p.key)}:${p.value === null ? `[${listTexts.join(',')}]` : p.value}`).join(',')}}`;
}

/** JSON.stringify(doc, null, 2) + "\n", written from the parts without building the object. */
function prettyDocument(parts, listValues) {
  const indent = (text, pad) => text.replace(/\n/g, `\n${pad}`);
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

const MAP_SQL = {
  all: 'SELECT record FROM maps ORDER BY ord, map_id',
  visible: 'SELECT record FROM maps WHERE COALESCE(hidden, 0) = 0 ORDER BY ord, map_id',
  category: 'SELECT record FROM maps WHERE category = ?1 ORDER BY ord, map_id',
  categoryVisible: 'SELECT record FROM maps WHERE category = ?1 AND COALESCE(hidden, 0) = 0 ORDER BY ord, map_id',
};

/** The catalogue document (maps.json) as text: compact for the API, or the file's own bytes. */
export async function mapsDocumentText(db, { visibleOnly = false, pretty = false } = {}) {
  const [ord, maps] = await Promise.all([
    listOrd(db, 'catalogue_parts'),
    db.prepare(visibleOnly ? MAP_SQL.visible : MAP_SQL.all).all(),
  ]);
  const parts = await headParts(db, 'catalogue_parts', 'maps', ord);
  const records = (maps.results || []).map((r) => r.record);
  if (!records.length && parts.length === 1) return null;
  return pretty ? prettyDocument(parts, records.map((t) => parseJson(t))) : compactDocument(parts, records);
}

export async function mapRecord(db, { id = null, slug = null }) {
  const row = id
    ? await db.prepare('SELECT record FROM maps WHERE map_id = ?1').bind(id).first()
    : await db.prepare('SELECT record FROM maps WHERE slug = ?1 ORDER BY ord LIMIT 1').bind(slug).first();
  return row ? row.record : null;
}

export async function mapsInCategory(db, category, visibleOnly) {
  const { results } = await db.prepare(visibleOnly ? MAP_SQL.categoryVisible : MAP_SQL.category).bind(category).all();
  return `{"maps":[${(results || []).map((r) => r.record).join(',')}]}`;
}

// ---------------------------------------------------------------- layers (maps-test.json)

/** The live id for an id or one of its other spellings (layer_aliases), or null. */
export async function resolveLayerId(db, id) {
  const live = await db.prepare('SELECT layer_id FROM layers WHERE layer_id = ?1').bind(id).first();
  if (live) return { id: live.layer_id, alias: false };
  const alias = await db.prepare('SELECT layer_id FROM layer_aliases WHERE alias = ?1').bind(id).first();
  return alias ? { id: alias.layer_id, alias: true } : null;
}

/** The full render metadata (maps-test.json), compact. */
export async function layersDocumentText(db) {
  const [ord, layers] = await Promise.all([
    listOrd(db, 'layer_parts'),
    db.prepare('SELECT record FROM layers ORDER BY ord, layer_id').all(),
  ]);
  const parts = await headParts(db, 'layer_parts', 'layers', ord);
  const records = (layers.results || []).map((r) => r.record);
  if (!records.length && parts.length === 1) return null;
  return compactDocument(parts, records);
}

/** The startup index (maps-test-index.json's shape), its entries pointing at this API. */
export async function layerIndexDocument(db, urls = API_URLS) {
  const [ord, layers, head] = await Promise.all([
    listOrd(db, 'layer_parts'),
    db.prepare('SELECT record, duplicates FROM layers ORDER BY ord, layer_id').all(),
    db.prepare('SELECT key, value FROM layer_parts ORDER BY ord, key').all(),
  ]);
  const rows = layers.results || [];
  if (!rows.length && !(head.results || []).length) return null;
  const parts = await headParts(db, 'layer_parts', 'layers', ord);
  const headObject = {};
  for (const p of parts) headObject[p.key] = p.value === null ? [] : parseJson(p.value);
  const entries = rows.map((r) => indexEntry(parseJson(r.record, {}), parseJson(r.duplicates), urls));
  return indexDocument(headObject, entries);
}

export async function layerRow(db, id) {
  return db.prepare('SELECT layer_id, record, duplicates FROM layers WHERE layer_id = ?1').bind(id).first();
}

// ---------------------------------------------------------------- verbatim documents

/** A document stored in parts (document_parts), as its exact text, or null. */
export async function storedDocumentText(db, name) {
  const { results } = await db.prepare('SELECT body FROM document_parts WHERE name = ?1 ORDER BY part').bind(name).all();
  return results && results.length ? results.map((r) => r.body).join('') : null;
}

/** The catalogue-pane documents by their API view name. */
export const CATALOGUE_VIEWS = {
  pane: 'catalogue/catalogue.json',
  places: 'catalogue/places.json',
  people: 'catalogue/people.json',
  agent: 'agent/maps-index.json',
};

// ---------------------------------------------------------------- Browse map files

export async function browseMapsText(db) {
  const [headRow, cards] = await Promise.all([
    db.prepare("SELECT body FROM documents WHERE name = 'browse/maps.json'").first(),
    db.prepare('SELECT card FROM map_cards ORDER BY ord, slug').all(),
  ]);
  if (!headRow) return null;
  const head = parseJson(headRow.body, {});
  return compactDocument(Object.entries(head).map(([key, v], i) => ({ key, ord: i, value: JSON.stringify(v) }))
    .concat([{ key: 'items', ord: 1e9, value: null }]), (cards.results || []).map((r) => r.card));
}

export async function browseFeaturesText(db) {
  const [headRow, groups] = await Promise.all([
    db.prepare("SELECT body FROM documents WHERE name = 'browse/features.json'").first(),
    db.prepare('SELECT card FROM feature_groups ORDER BY ord').all(),
  ]);
  if (!headRow) return null;
  const head = parseJson(headRow.body, {});
  return compactDocument(Object.entries(head).map(([key, v], i) => ({ key, ord: i, value: JSON.stringify(v) }))
    .concat([{ key: 'items', ord: 1e9, value: null }]), (groups.results || []).map((r) => r.card));
}

/** A Browse map record (its page's item) by slug, or by map id when no slug matches. */
export async function browseMapRecord(db, slugOrId) {
  const bySlug = await db.prepare('SELECT slug, detail, card FROM map_cards WHERE slug = ?1').bind(slugOrId).first();
  const row = bySlug || await db.prepare('SELECT slug, detail, card FROM map_cards WHERE id = ?1 ORDER BY ord LIMIT 1').bind(slugOrId).first();
  return row || null;
}
