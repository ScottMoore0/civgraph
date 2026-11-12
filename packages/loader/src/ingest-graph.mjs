/**
 * The semantic graph as rows (phase 2: stored as built). Replaces ~10,300 files on R2, ~8,300
 * of them hash-bucketed indexes rewritten on nearly every build:
 *   graph_entities           entity-shards records + the lookup entry + the search entry
 *   graph_browse_keys        lookup/browse buckets ("persons:<slug>" -> entity) and the
 *                            lookup/slug buckets ("slug:<slug>" -> entity), and the published
 *                            ids and slugs the graph no longer has (indexes/entity-aliases.json:
 *                            "alias:<old id>" and "slug:<old slug>" -> the entity it became)
 *   graph_statements        statements-by-subject shards, in their order
 *   graph_reverse            reverse-entity-value shards
 *   graph_source_statements  source-statements shards
 * plus the small registries and the index heads as documents. The bulk exports stay files
 * (records:downloads); so do the full statement shards, which no table holds.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TableWriter, readJson, transaction } from './db.mjs';
import { foldSearchText } from '../../core/src/format.js';

/** @typedef {import('./db.mjs').DocumentRow} DocumentRow */
/** An entity-search item: the entity's id and its search fields. @typedef {{ entityId?: string, [key: string]: unknown }} SearchItem */

const fold = (/** @type {unknown} */ value) => foldSearchText(value || '');

/**
 * Each JSON file of `dir`, by name, parsed (the graph build's shards: open JSON).
 * @param {string} dir
 */
function* jsonFiles(dir) {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    yield [file, JSON.parse(readFileSync(path.join(dir, file), 'utf8'))];
  }
}

const graphRel = (/** @type {unknown} */ url) => String(url).replace(/^\/data\/graph\//, '');

/**
 * The items of a head file's parts, each part also passed to onPart(relativeFile, partDoc).
 * @template [T=unknown]
 * @param {string} headFile
 * @param {string} graphDir
 * @param {(rel: string, doc: { items?: T[], bySlug?: Record<string, unknown> }) => void} [onPart]
 * @returns {T[]}
 */
function readParts(headFile, graphDir, onPart = () => {}) {
  const head = /** @type {{ parts?: unknown, items?: T[] } | null} */ (readJson(headFile, null));
  if (!head) return [];
  const parts = Array.isArray(head.parts) ? head.parts : [];
  if (!parts.length) return head.items || [];
  return parts.flatMap((/** @type {unknown} */ url) => {
    const doc = /** @type {{ items?: T[], bySlug?: Record<string, unknown> }} */ (readJson(path.join(graphDir, ...graphRel(url).split('/')), { items: [] }));
    onPart(graphRel(url), doc);
    return doc.items || [];
  });
}

const withoutGeneratedAt = (/** @type {Record<string, unknown>} */ { generatedAt: _g, ...rest }) => rest;

/**
 * @param {import('../../storage/src/sqlite.mjs').SqliteHandle} db
 * @param {{ graphDir: string }} options
 */
export function ingestGraph(db, { graphDir }) {
  const idx = path.join(graphDir, 'indexes');
  /** @type {Map<string, { slug?: string, label?: string, [key: string]: unknown }>} */
  const lookupEntry = new Map();
  for (const [, bucket] of jsonFiles(path.join(idx, 'lookup', 'entity'))) {
    for (const [id, entry] of Object.entries(bucket.items || {})) {
      const { st: _st, rv: _rv, ss: _ss, ...summary } = entry;
      lookupEntry.set(id, summary);
    }
  }
  /** @type {Map<string, SearchItem>} */
  const searchEntry = new Map();
  for (const item of /** @type {(SearchItem | null)[]} */ (readParts(path.join(idx, 'entity-search.json'), graphDir))) {
    if (item?.entityId && !searchEntry.has(item.entityId)) searchEntry.set(item.entityId, item);
  }

  const out = transaction(db, () => {
    const ent = new TableWriter(db, 'graph_entities');
    for (const [file, shard] of jsonFiles(path.join(graphDir, 'entity-shards'))) {
      const shardNo = Number(shard.shard ?? file.match(/(\d+)/)?.[1] ?? 0);
      (shard.items || []).forEach((/** @type {{ id: string, label?: string }} */ entity, /** @type {number} */ ord) => {
        const summary = lookupEntry.get(entity.id);
        const search = searchEntry.get(entity.id);
        ent.add({
          entity_id: entity.id, shard: shardNo, ord, slug: summary?.slug ?? null,
          label: entity.label ?? summary?.label ?? null, label_norm: fold(entity.label ?? summary?.label),
          entity: JSON.stringify(entity), summary: summary ? JSON.stringify(summary) : null,
          search: search ? JSON.stringify(search) : null,
        });
      });
    }
    const keys = new TableWriter(db, 'graph_browse_keys');
    const seenKeys = new Set();
    for (const [, bucket] of jsonFiles(path.join(idx, 'lookup', 'browse'))) {
      for (const [key, id] of Object.entries(bucket.items || {})) {
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        keys.add({ browse_key: key, entity_id: String(id) });
      }
    }
    // Readable entity slugs (lookup/slug buckets), as "slug:<slug>" keys beside the Browse ones.
    for (const [, bucket] of jsonFiles(path.join(idx, 'lookup', 'slug'))) {
      for (const [slug, id] of Object.entries(bucket.items || {})) {
        const key = `slug:${slug}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        keys.add({ browse_key: key, entity_id: String(id) });
      }
    }
    // Published ids the graph no longer has (indexes/entity-aliases.json, scripts/lib/
    // graph-id-ledger.mjs): "alias:<old id>" -> the entity it became, which /_api/graph?entity=
    // answers with; and the old readable slugs, after every live one.
    const aliases = /** @type {{ ids?: Record<string, string>, slugs?: Record<string, string> } | null} */ (readJson(path.join(idx, 'entity-aliases.json'), null));
    for (const [prefix, map] of /** @type {[string, Record<string, string> | undefined][]} */ ([['alias:', aliases?.ids], ['slug:', aliases?.slugs]])) {
      for (const [old, id] of Object.entries(map || {})) {
        const key = `${prefix}${old}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        keys.add({ browse_key: key, entity_id: String(id) });
      }
    }
    const st = new TableWriter(db, 'graph_statements');
    for (const [, shard] of jsonFiles(path.join(idx, 'statements-by-subject-shards'))) {
      for (const [subject, list] of Object.entries(shard.items || {})) {
        (list || []).forEach((/** @type {{ id?: string, propertyId?: string }} */ s, /** @type {number} */ ord) => st.add({
          subject_id: subject, ord, statement_id: s.id ?? null, property_id: s.propertyId ?? null, statement: JSON.stringify(s),
        }));
      }
    }
    const rv = new TableWriter(db, 'graph_reverse');
    for (const [, shard] of jsonFiles(path.join(idx, 'reverse-entity-value-shards'))) {
      for (const [entity, list] of Object.entries(shard.items || {})) {
        (list || []).forEach((/** @type {unknown} */ item, /** @type {number} */ ord) => rv.add({ entity_id: entity, ord, item: JSON.stringify(item) }));
      }
    }
    const ss = new TableWriter(db, 'graph_source_statements');
    for (const [, shard] of jsonFiles(path.join(idx, 'source-statements-shards'))) {
      for (const [source, list] of Object.entries(shard.items || {})) {
        (list || []).forEach((/** @type {unknown} */ item, /** @type {number} */ ord) => ss.add({ source_id: source, ord, item: JSON.stringify(item) }));
      }
    }
    return {
      graph_entities: ent.finish(), graph_browse_keys: keys.finish(), graph_statements: st.finish(),
      graph_reverse: rv.finish(), graph_source_statements: ss.finish(),
    };
  });

  /** @type {DocumentRow[]} */
  const docs = [];
  for (const [name, file] of [
    ['graph/manifest.json', path.join(graphDir, 'manifest.json')],
    ['graph/entity-types.json', path.join(graphDir, 'entity-types.json')],
    ['graph/properties.json', path.join(graphDir, 'properties.json')],
    ['graph/indexes/property-summary.json', path.join(idx, 'property-summary.json')],
    ['graph/quality/validation-summary.json', path.join(graphDir, 'quality', 'validation-summary.json')],
  ]) {
    const value = readJson(file, null);
    if (value) docs.push({ name, body: JSON.stringify(value) });
  }
  // The index heads (data phase 4), without generatedAt so an unchanged graph loads no row.
  for (const file of ['lookup.json', 'browse-record-to-entity.json', 'entity-slugs.json', 'entity-search.json']) {
    const value = /** @type {Record<string, unknown> | null} */ (readJson(path.join(idx, file), null));
    if (value) docs.push({ name: `graph/indexes/${file}`, body: JSON.stringify(withoutGeneratedAt(value)) });
  }
  return { counts: out, docs };
}
