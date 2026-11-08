/**
 * Maps, layers and the catalogue into the records tables (data design phase 3, PHASE3.md).
 *
 * Read from the source files where they are, so an edit to maps.json or maps-test.json by any
 * workflow flows straight into the next build with nothing else to run:
 *   data/database/maps.json             -> maps, catalogue_parts
 *   render/metadata/maps-test.json      -> layers, layer_parts, layer_aliases
 *   render/metadata/feature-indexes/    -> layers.duplicates (the duplicate-feature-id sidecars)
 *   data/catalogue/{catalogue,places,people}.json, agent/maps-index.json -> document_parts (verbatim)
 *   <browse>/maps.json, details/maps/, features.json (the Browse build) -> map_cards, feature_groups
 *
 * Records are stored as JSON.stringify of the parsed value: the documents are written by
 * JSON.stringify(doc, null, 2) + "\n", so the Functions give them back byte for byte. The
 * catalogue-pane documents and the agent index are stored as their exact text, in parts.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { duplicateSidecar } from '../../core/src/layer-index.js';
import { legacyLayerId, renameLayerId } from '../../core/src/layer-renames.mjs';
import { LEGACY_LAYER_ID_PREFIXES } from '../../core/src/layer-renames.mjs';
import { TableWriter, bool, readJson, transaction, txt } from './db.mjs';
import { REPO_ROOT } from './paths.mjs';
import { PART_CHARS } from '../../schema/src/schema.mjs';

/** @typedef {import('../../types/index.js').MapEntry} MapEntry */
/** @typedef {import('../../types/index.js').LayerEntry} LayerEntry */
/** @typedef {import('./db.mjs').DocumentRow} DocumentRow */
/**
 * A card of a Browse list (data/browse/maps.json, features.json items[]): open JSON.
 * @typedef {{ slug?: string, id?: string, title?: string, [key: string]: unknown }} BrowseCard
 */

export const MAP_SOURCES = {
  maps: 'data/database/maps.json',
  layers: 'render/metadata/maps-test.json',
  documents: {
    'catalogue/catalogue.json': 'data/catalogue/catalogue.json',
    'catalogue/places.json': 'data/catalogue/places.json',
    'catalogue/people.json': 'data/catalogue/people.json',
    'agent/maps-index.json': 'site/agent/maps-index.json',
  },
};

/**
 * The kind a layer id names: vector, raster, alias, or other (3D, groups, data overlays).
 * @param {unknown} id
 */
export function layerKind(id) {
  const m = /-(vector|raster|alias)(?:-test)?$/.exec(String(id || ''));
  return m ? m[1] : 'other';
}

/**
 * A feature index URL (/render/metadata/feature-indexes/x.json) as a file in `root`, or null.
 * @param {string} root
 * @param {string | undefined} url
 */
function featureIndexFile(root, url) {
  if (!url || /^https?:\/\//i.test(url)) return null;
  const file = path.join(root, ...String(url).split('?')[0].replace(/^\/+/, '').split('/'));
  return existsSync(file) ? file : null;
}

/**
 * The other spellings of every live layer id, each pointing at it: the renames.csv suffix rule
 * in both directions (so -vector links work before and after the source ids flip), and the
 * renamed prefixes of url-compat.mjs. An alias never shadows a live id; the first claim wins.
 * @param {string[]} ids
 * @returns {{ alias: string, layer_id: string }[]}
 */
export function layerAliasRows(ids) {
  const live = new Set(ids);
  /** @type {Map<string, string>} */
  const out = new Map();
  const claim = (/** @type {string | null | undefined} */ alias, /** @type {string} */ id) => {
    if (alias && alias !== id && !live.has(alias) && !out.has(alias)) out.set(alias, id);
  };
  for (const id of ids) {
    claim(renameLayerId(id), id);
    claim(legacyLayerId(id), id);
  }
  // Renamed prefixes: old ids whose current spelling is a live id (or an alias of one).
  for (const [from, to] of LEGACY_LAYER_ID_PREFIXES) {
    for (const id of ids) {
      for (const spelling of new Set([id, renameLayerId(id), legacyLayerId(id)])) {
        if (spelling.startsWith(to)) claim(`${from}${spelling.slice(to.length)}`, id);
      }
    }
  }
  return [...out].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([alias, layer_id]) => ({ alias, layer_id }));
}

/**
 * A document's text in parts of at most PART_CHARS characters (never splitting a surrogate pair).
 * @param {string} text
 * @param {number} [size]
 */
export function splitParts(text, size = PART_CHARS) {
  /** @type {string[]} */
  const parts = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + size);
    const code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) end -= 1;
    parts.push(text.slice(at, end));
    at = end;
  }
  return parts.length ? parts : [''];
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ root?: string, browseDir?: string|null }} options  root: where the source files are
 *   (the repository); browseDir: the Browse build's directory (absent: the Browse map tables
 *   stay empty and the Function answers 404 for those files).
 */
export function ingestMaps(db, { root = REPO_ROOT, browseDir = null } = {}) {
  const at = (/** @type {string} */ rel) => path.join(root, ...rel.split('/'));
  /** @type {Record<string, number>} */
  const counts = {};
  /** @type {DocumentRow[]} */
  const docs = [];

  transaction(db, () => {
    // ---- maps.json
    /** @type {{ maps?: MapEntry[], [key: string]: unknown }} */
    const catalogue = readJson(at(MAP_SOURCES.maps));
    const maps = new TableWriter(db, 'maps');
    (catalogue.maps || []).forEach((m, ord) => {
      maps.add({
        map_id: String(m.id), slug: txt(m.slug), name: txt(m.name), category: txt(m.category), date: txt(m.date),
        hidden: bool(!!m.hidden), featured: bool(!!m.featured), is_group: bool(!!m.isGroup), parent_id: txt(m.parentId),
        ord, record: JSON.stringify(m),
      });
    });
    counts.maps = maps.finish();
    const parts = new TableWriter(db, 'catalogue_parts');
    Object.keys(catalogue).forEach((key, ord) => {
      if (key !== 'maps') parts.add({ key, ord, value: JSON.stringify(catalogue[key]) });
    });
    counts.catalogue_parts = parts.finish();

    // ---- maps-test.json
    /** @type {{ layers?: LayerEntry[], [key: string]: unknown }} */
    const render = readJson(at(MAP_SOURCES.layers));
    const layers = new TableWriter(db, 'layers');
    /** @type {string[]} */
    const ids = [];
    (render.layers || []).forEach((layer, ord) => {
      const file = featureIndexFile(root, layer.featureIndexUrl);
      const duplicates = file ? duplicateSidecar(layer, JSON.parse(readFileSync(file, 'utf8'))) : null;
      ids.push(String(layer.id));
      layers.add({
        layer_id: String(layer.id), map_id: txt(layer.sourceMapId), kind: layerKind(layer.id),
        alias_of: txt(layer.aliasTargetLayerId || layer.aliasOf || null), ord,
        record: JSON.stringify(layer), duplicates: duplicates ? JSON.stringify(duplicates) : null,
      });
    });
    counts.layers = layers.finish();
    const lparts = new TableWriter(db, 'layer_parts');
    Object.keys(render).forEach((key, ord) => {
      if (key !== 'layers') lparts.add({ key, ord, value: JSON.stringify(render[key]) });
    });
    counts.layer_parts = lparts.finish();
    const aliases = new TableWriter(db, 'layer_aliases');
    for (const row of layerAliasRows(ids)) aliases.add(row);
    counts.layer_aliases = aliases.finish();

    // ---- whole documents, verbatim
    const dp = new TableWriter(db, 'document_parts');
    for (const [name, rel] of Object.entries(MAP_SOURCES.documents)) {
      const file = at(rel);
      if (!existsSync(file)) continue;
      splitParts(readFileSync(file, 'utf8')).forEach((body, part) => dp.add({ name, part, body }));
    }
    counts.document_parts = dp.finish();

    // ---- the Browse build's map list, map pages and feature groups
    if (browseDir && existsSync(path.join(browseDir, 'maps.json'))) {
      /** @type {{ items?: BrowseCard[], [key: string]: unknown }} */
      const list = readJson(path.join(browseDir, 'maps.json'));
      const detailDir = path.join(browseDir, 'details', 'maps');
      const cards = new TableWriter(db, 'map_cards');
      (list.items || []).forEach((item, ord) => {
        const file = path.join(detailDir, `${item.slug}.json`);
        const detail = existsSync(file) ? readJson(file).item ?? null : null;
        cards.add({ slug: String(item.slug), id: txt(item.id), title: txt(item.title), ord, card: JSON.stringify(item), detail: detail ? JSON.stringify(detail) : null });
      });
      counts.map_cards = cards.finish();
      const { items: _m, generatedAt: _g, ...head } = list;
      docs.push({ name: 'browse/maps.json', body: JSON.stringify(head) });
      // A detail file no card names (none today) would be unreachable: say so.
      if (existsSync(detailDir)) {
        const slugs = new Set((list.items || []).map((i) => i.slug));
        const orphans = readdirSync(detailDir).filter((f) => f.endsWith('.json') && !slugs.has(f.slice(0, -5)));
        if (orphans.length) counts.map_details_without_card = orphans.length;
      }
    }
    if (browseDir && existsSync(path.join(browseDir, 'features.json'))) {
      /** @type {{ items?: BrowseCard[], [key: string]: unknown }} */
      const features = readJson(path.join(browseDir, 'features.json'));
      const fg = new TableWriter(db, 'feature_groups');
      (features.items || []).forEach((item, ord) => fg.add({ ord, id: txt(item.id), card: JSON.stringify(item) }));
      counts.feature_groups = fg.finish();
      const { items: _f, generatedAt: _g, ...head } = features;
      docs.push({ name: 'browse/features.json', body: JSON.stringify(head) });
    }
  });
  return { counts, docs };
}
