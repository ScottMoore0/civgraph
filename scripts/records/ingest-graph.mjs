/**
 * The semantic graph as rows (phase 2: stored as built). Replaces ~10,300 files on R2, ~8,300
 * of them hash-bucketed indexes rewritten on nearly every build:
 *   graph_entities           entity-shards records + the lookup entry + the search entry
 *   graph_browse_keys        lookup/browse buckets ("persons:<slug>" -> entity) and the
 *                            lookup/slug buckets ("slug:<slug>" -> entity)
 *   graph_statements         statements-by-subject shards, in their order
 *   graph_reverse            reverse-entity-value shards
 *   graph_source_statements  source-statements shards
 * plus the small registries as documents. The bulk exports stay files (records:downloads).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TableWriter, readJson, transaction } from './db.mjs';

const fold = (value) => String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

function* jsonFiles(dir) {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    yield [file, JSON.parse(readFileSync(path.join(dir, file), 'utf8'))];
  }
}

function readParts(headFile, graphDir) {
  const head = readJson(headFile, null);
  if (!head) return [];
  const parts = Array.isArray(head.parts) ? head.parts : [];
  if (!parts.length) return head.items || [];
  return parts.flatMap((url) => readJson(path.join(graphDir, ...String(url).replace(/^\/data\/graph\//, '').split('/')), { items: [] }).items || []);
}

export function ingestGraph(db, { graphDir }) {
  const idx = path.join(graphDir, 'indexes');
  const lookupEntry = new Map();
  for (const [, bucket] of jsonFiles(path.join(idx, 'lookup', 'entity'))) {
    for (const [id, entry] of Object.entries(bucket.items || {})) {
      const { st: _st, rv: _rv, ss: _ss, ...summary } = entry;
      lookupEntry.set(id, summary);
    }
  }
  const searchEntry = new Map();
  for (const item of readParts(path.join(idx, 'entity-search.json'), graphDir)) {
    if (item?.entityId && !searchEntry.has(item.entityId)) searchEntry.set(item.entityId, item);
  }

  const out = transaction(db, () => {
    const ent = new TableWriter(db, 'graph_entities');
    for (const [file, shard] of jsonFiles(path.join(graphDir, 'entity-shards'))) {
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
    const st = new TableWriter(db, 'graph_statements');
    for (const [, shard] of jsonFiles(path.join(idx, 'statements-by-subject-shards'))) {
      for (const [subject, list] of Object.entries(shard.items || {})) {
        (list || []).forEach((s, ord) => st.add({
          subject_id: subject, ord, statement_id: s.id ?? null, property_id: s.propertyId ?? null, statement: JSON.stringify(s),
        }));
      }
    }
    const rv = new TableWriter(db, 'graph_reverse');
    for (const [, shard] of jsonFiles(path.join(idx, 'reverse-entity-value-shards'))) {
      for (const [entity, list] of Object.entries(shard.items || {})) {
        (list || []).forEach((item, ord) => rv.add({ entity_id: entity, ord, item: JSON.stringify(item) }));
      }
    }
    const ss = new TableWriter(db, 'graph_source_statements');
    for (const [, shard] of jsonFiles(path.join(idx, 'source-statements-shards'))) {
      for (const [source, list] of Object.entries(shard.items || {})) {
        (list || []).forEach((item, ord) => ss.add({ source_id: source, ord, item: JSON.stringify(item) }));
      }
    }
    return {
      graph_entities: ent.finish(), graph_browse_keys: keys.finish(), graph_statements: st.finish(),
      graph_reverse: rv.finish(), graph_source_statements: ss.finish(),
    };
  });

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
  return { counts: out, docs };
}
