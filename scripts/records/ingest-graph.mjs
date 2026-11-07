/**
 * The semantic graph as rows (phase 2: stored as built). Replaces ~10,300 files on R2, ~8,300
 * of them hash-bucketed indexes rewritten on nearly every build:
 *   graph_entities           entity-shards records + the lookup entry + the search entry
 *   graph_browse_keys        lookup/browse buckets ("persons:<slug>" -> entity) and the
 *                            lookup/slug buckets ("slug:<slug>" -> entity)
 *   graph_statements         statements-by-subject shards, in their order
 *   graph_reverse            reverse-entity-value shards
 *   graph_source_statements  source-statements shards
 *   graph_files              data phase 4: the keys each old index and shard file held, in
 *                            order, so functions/data/graph rebuilds those file URLs from the
 *                            rows above for the owner's 90 days (see schema.mjs). Frozen: with
 *                            `frozenFrom` the table is copied from that database as it is, and
 *                            the rows worked out here only measure the drift
 *                            (graph-files-freeze.mjs)
 * plus the small registries and the index heads as documents. The bulk exports stay files
 * (records:downloads); so do the full statement shards, which no table holds.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TableWriter, readJson, transaction } from './db.mjs';
import { carryGraphFiles } from './graph-files-freeze.mjs';
import { GRAPH_FILE_PART_KEYS } from './schema.mjs';

const fold = (value) => String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

function* jsonFiles(dir) {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    yield [file, JSON.parse(readFileSync(path.join(dir, file), 'utf8'))];
  }
}

const graphRel = (url) => String(url).replace(/^\/data\/graph\//, '');

/** The items of a head file's parts, each part also passed to onPart(relativeFile, partDoc). */
/**
 * @param {string} headFile
 * @param {string} graphDir
 * @param {(rel: string, doc: any) => void} [onPart]
 */
function readParts(headFile, graphDir, onPart = () => {}) {
  const head = readJson(headFile, null);
  if (!head) return [];
  const parts = Array.isArray(head.parts) ? head.parts : [];
  if (!parts.length) return head.items || [];
  return parts.flatMap((url) => {
    const doc = readJson(path.join(graphDir, ...graphRel(url).split('/')), { items: [] });
    onPart(graphRel(url), doc);
    return doc.items || [];
  });
}

const withoutGeneratedAt = ({ generatedAt: _g, ...rest }) => rest;

export function ingestGraph(db, { graphDir, frozenFrom = null }) {
  const idx = path.join(graphDir, 'indexes');
  // What each old file (path under data/graph/) held, in order: graph_files.
  const files = [];
  const fileKeys = (file, keys, extra = null) => files.push({ file, keys, extra });
  const lookupEntry = new Map();
  for (const [file, bucket] of jsonFiles(path.join(idx, 'lookup', 'entity'))) {
    const keys = [];
    const extra = [];
    for (const [id, entry] of Object.entries(bucket.items || {})) {
      const { st, rv, ss, ...summary } = entry;
      lookupEntry.set(id, summary);
      keys.push(id);
      extra.push([st ?? null, rv ?? null, ss ?? null]);
    }
    fileKeys(`indexes/lookup/entity/${file}`, keys, extra);
  }
  const searchEntry = new Map();
  const searchPart = (rel, doc) => fileKeys(rel, (doc.items || []).map((item) => item?.entityId ?? null));
  for (const item of readParts(path.join(idx, 'entity-search.json'), graphDir, searchPart)) {
    if (item?.entityId && !searchEntry.has(item.entityId)) searchEntry.set(item.entityId, item);
  }

  const freshFiles = [];
  const out = transaction(db, () => {
    const ent = new TableWriter(db, 'graph_entities');
    for (const [file, shard] of jsonFiles(path.join(graphDir, 'entity-shards'))) {
      fileKeys(`entity-shards/${file}`, (shard.items || []).map((entity) => entity.id));
      const shardNo = Number(shard.shard ?? file.match(/(\d+)/)?.[1] ?? 0);
      (shard.items || []).forEach((entity, ord) => {
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
    for (const [file, bucket] of jsonFiles(path.join(idx, 'lookup', 'browse'))) {
      fileKeys(`indexes/lookup/browse/${file}`, Object.keys(bucket.items || {}));
      for (const [key, id] of Object.entries(bucket.items || {})) {
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        keys.add({ browse_key: key, entity_id: String(id) });
      }
    }
    // Readable entity slugs (lookup/slug buckets), as "slug:<slug>" keys beside the Browse ones.
    for (const [file, bucket] of jsonFiles(path.join(idx, 'lookup', 'slug'))) {
      fileKeys(`indexes/lookup/slug/${file}`, Object.keys(bucket.items || {}));
      for (const [slug, id] of Object.entries(bucket.items || {})) {
        const key = `slug:${slug}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        keys.add({ browse_key: key, entity_id: String(id) });
      }
    }
    const st = new TableWriter(db, 'graph_statements');
    for (const [file, shard] of jsonFiles(path.join(idx, 'statements-by-subject-shards'))) {
      fileKeys(`indexes/statements-by-subject-shards/${file}`, Object.keys(shard.items || {}));
      for (const [subject, list] of Object.entries(shard.items || {})) {
        (list || []).forEach((s, ord) => st.add({
          subject_id: subject, ord, statement_id: s.id ?? null, property_id: s.propertyId ?? null, statement: JSON.stringify(s),
        }));
      }
    }
    const rv = new TableWriter(db, 'graph_reverse');
    for (const [file, shard] of jsonFiles(path.join(idx, 'reverse-entity-value-shards'))) {
      fileKeys(`indexes/reverse-entity-value-shards/${file}`, Object.keys(shard.items || {}));
      for (const [entity, list] of Object.entries(shard.items || {})) {
        (list || []).forEach((item, ord) => rv.add({ entity_id: entity, ord, item: JSON.stringify(item) }));
      }
    }
    const ss = new TableWriter(db, 'graph_source_statements');
    for (const [file, shard] of jsonFiles(path.join(idx, 'source-statements-shards'))) {
      fileKeys(`indexes/source-statements-shards/${file}`, Object.keys(shard.items || {}));
      for (const [source, list] of Object.entries(shard.items || {})) {
        (list || []).forEach((item, ord) => ss.add({ source_id: source, ord, item: JSON.stringify(item) }));
      }
    }
    // The files the loops above did not read: the entity summaries, the slug index's parts (their
    // bySlug order; byIdShard follows the summary files) and the per-type Browse-record maps.
    for (const [file, shard] of jsonFiles(path.join(idx, 'entity-summary-shards'))) {
      fileKeys(`indexes/entity-summary-shards/${file}`, Object.keys(shard.items || {}));
    }
    readParts(path.join(idx, 'entity-slugs.json'), graphDir, (rel, doc) => fileKeys(rel, Object.keys(doc.bySlug || {})));
    for (const file of existsSync(idx) ? readdirSync(idx).filter((f) => /^browse-record-to-entity-.+\.json$/.test(f)).sort() : []) {
      fileKeys(`indexes/${file}`, Object.keys(readJson(path.join(idx, file), { items: {} }).items || {}));
    }
    const gf = frozenFrom ? null : new TableWriter(db, 'graph_files');
    for (const { file, keys: list, extra } of files) {
      for (let part = 0, at = 0; part === 0 || at < list.length; part += 1, at += GRAPH_FILE_PART_KEYS) {
        const row = {
          file, part, keys: JSON.stringify(list.slice(at, at + GRAPH_FILE_PART_KEYS)),
          extra: extra ? JSON.stringify(extra.slice(at, at + GRAPH_FILE_PART_KEYS)) : null,
        };
        if (gf) gf.add(row);
        else freshFiles.push(row);
      }
    }
    return {
      graph_entities: ent.finish(), graph_browse_keys: keys.finish(), graph_statements: st.finish(),
      graph_reverse: rv.finish(), graph_source_statements: ss.finish(), graph_files: gf ? gf.finish() : 0,
    };
  });
  let graphFiles = { frozenFrom: null, drifted: [], retired: 0 };
  if (frozenFrom) {
    const carried = carryGraphFiles(db, frozenFrom, freshFiles);
    out.graph_files = carried.rows;
    graphFiles = { frozenFrom, drifted: carried.drifted, retired: carried.retired };
  }

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
    const value = readJson(path.join(idx, file), null);
    if (value) docs.push({ name: `graph/indexes/${file}`, body: JSON.stringify(withoutGeneratedAt(value)) });
  }
  return { counts: out, docs, graphFiles };
}
