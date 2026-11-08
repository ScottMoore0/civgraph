/**
 * Named queries: maps, layers, the catalogue's documents and the Browse map files (data design
 * phase 3; storage slice ST-6). Used by packages/api/src/handlers/_maps.js for /_api/catalogue, /_api/layers
 * and the compatibility routes.
 */
import { DOCUMENTS } from './documents.js';

export const MAPS = Object.freeze({
  /** A head table (catalogue_parts or layer_parts): [] -> { key, ord, value } */
  headParts: (/** @type {string} */ table) => `SELECT key, ord, value FROM ${table} ORDER BY ord, key`,
  /** A head table's numbers: [] -> { ord } */
  headOrds: (/** @type {string} */ table) => `SELECT ord FROM ${table} ORDER BY ord`,
  /** [] -> { record } */
  all: 'SELECT record FROM maps ORDER BY ord, map_id',
  /** [] -> { record } the maps not hidden */
  visible: 'SELECT record FROM maps WHERE COALESCE(hidden, 0) = 0 ORDER BY ord, map_id',
  /** [category] -> { record } */
  category: 'SELECT record FROM maps WHERE category = ?1 ORDER BY ord, map_id',
  /** [category] -> { record } */
  categoryVisible: 'SELECT record FROM maps WHERE category = ?1 AND COALESCE(hidden, 0) = 0 ORDER BY ord, map_id',
  /** [mapId] -> { record } */
  byId: 'SELECT record FROM maps WHERE map_id = ?1',
  /** [slug] -> { record } */
  bySlug: 'SELECT record FROM maps WHERE slug = ?1 ORDER BY ord LIMIT 1',
  /** [name] -> { body } in part order: a document stored in parts */
  documentParts: 'SELECT body FROM document_parts WHERE name = ?1 ORDER BY part',
});

export const LAYERS = Object.freeze({
  /** [layerId] -> { layer_id } a live layer */
  live: 'SELECT layer_id FROM layers WHERE layer_id = ?1',
  /** [alias] -> { layer_id } the layer an old id now belongs to */
  alias: 'SELECT layer_id FROM layer_aliases WHERE alias = ?1',
  /** [] -> { record } */
  records: 'SELECT record FROM layers ORDER BY ord, layer_id',
  /** [] -> { record, duplicates } */
  index: 'SELECT record, duplicates FROM layers ORDER BY ord, layer_id',
  /** [] -> { key, value } */
  head: 'SELECT key, value FROM layer_parts ORDER BY ord, key',
  /** [layerId] -> { layer_id, record, duplicates } */
  row: 'SELECT layer_id, record, duplicates FROM layers WHERE layer_id = ?1',
});

export const MAP_CARDS = Object.freeze({
  /** [name] -> { body }: the head of browse/maps.json or browse/features.json */
  head: DOCUMENTS.body,
  /** [] -> { card } */
  cards: 'SELECT card FROM map_cards ORDER BY ord, slug',
  /** [] -> { card } */
  featureGroups: 'SELECT card FROM feature_groups ORDER BY ord',
  /** [slug] -> { detail } */
  detail: 'SELECT detail FROM map_cards WHERE slug = ?1',
  /** [slug] -> { slug, detail, card } */
  bySlug: 'SELECT slug, detail, card FROM map_cards WHERE slug = ?1',
  /** [mapId] -> { slug, detail, card } */
  byId: 'SELECT slug, detail, card FROM map_cards WHERE id = ?1 ORDER BY ord LIMIT 1',
});
