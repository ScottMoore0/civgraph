/**
 * The semantic graph from D1 (records tables; data design phase 2). Replaces the hash-bucketed
 * lookup files, the statements-by-subject, reverse-value and source-statement shards on R2:
 * a record page asks one question and gets its facts.
 *
 *   GET /_api/graph?browse=<type>:<key>[&browse=...]  -> { entityId, summary, statements }
 *        the first key that names an entity wins (browse.js tries slug, id, key, title, name)
 *   GET /_api/graph?entity=<id>[&related=1]           -> { entityId, summary, statements[, reverse, sourceStatements] }
 *   GET /_api/graph?slug=<readable slug>              -> the same as ?entity= for that entity
 *   GET /_api/graph?q=<text>[&limit=]                 -> { items } entity-search entries (max 200)
 *   GET /_api/graph?view=manifest                     -> data/graph/manifest.json, its exports pointing at downloads
 *
 * Statements come in the order the graph build wrote them (ord). Each list is capped at
 * `limit` (default and maximum 2,000: the largest subject has under 1,000) with `total`.
 */
import { cachedJson, documentBody, jsonResponse, parseJson } from '../_records.js';
import { reportError } from '../_error.js';

const VERSION = 'graph-1';
const MAX = 2000;

export async function onRequestGet(context) {
  return cachedJson(context, VERSION, () => handle(context));
}

const fold = (value) => String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function entityPayload(db, entityId, { related, limit, offset }) {
  const ent = await db.prepare('SELECT entity_id, summary FROM graph_entities WHERE entity_id = ?1').bind(entityId).first();
  const [statements, total] = await Promise.all([
    db.prepare('SELECT statement FROM graph_statements WHERE subject_id = ?1 ORDER BY ord LIMIT ?2 OFFSET ?3').bind(entityId, limit, offset).all(),
    db.prepare('SELECT COUNT(*) AS n FROM graph_statements WHERE subject_id = ?1').bind(entityId).first(),
  ]);
  const out = {
    entityId,
    summary: parseJson(ent?.summary),
    statements: (statements.results || []).map((r) => parseJson(r.statement)),
    total: total?.n ?? 0,
  };
  if (related) {
    const [reverse, sources] = await Promise.all([
      db.prepare('SELECT item FROM graph_reverse WHERE entity_id = ?1 ORDER BY ord LIMIT ?2').bind(entityId, MAX).all(),
      db.prepare('SELECT item FROM graph_source_statements WHERE source_id = ?1 ORDER BY ord LIMIT ?2').bind(entityId, MAX).all(),
    ]);
    out.reverse = (reverse.results || []).map((r) => parseJson(r.item));
    out.sourceStatements = (sources.results || []).map((r) => parseJson(r.item));
  }
  return out;
}

async function handle(context) {
  const db = context.env.ELECTIONS_DB;
  const url = new URL(context.request.url);
  const p = (name) => (url.searchParams.get(name) || '').trim();
  const limit = Math.min(Math.max(1, Number(p('limit')) || MAX), MAX);
  const offset = Math.max(0, Number(p('offset')) || 0);
  const related = p('related') === '1';
  try {
    if (p('view') === 'manifest') {
      const doc = await documentBody(db, 'graph/manifest.json');
      if (!doc) return jsonResponse({ error: 'no graph loaded' }, 404);
      return jsonResponse({ ...doc, api: '/_api/graph', downloads: 'https://data.civgraph.net/downloads/manifest.json' });
    }
    if (p('q') || url.searchParams.has('q')) {
      const words = fold(p('q')).split(/\s+/).filter(Boolean).slice(0, 8);
      const binds = [];
      const where = ['search IS NOT NULL', ...words.map((w) => `(label_norm LIKE ?${binds.push(`%${w}%`)} OR lower(search) LIKE ?${binds.push(`%${w}%`)})`)];
      const { results } = await db.prepare(`SELECT search FROM graph_entities WHERE ${where.join(' AND ')} ORDER BY shard, ord LIMIT ${Math.min(limit, 200)}`).bind(...binds).all();
      return jsonResponse({ items: (results || []).map((r) => parseJson(r.search)) });
    }
    let entityId = p('entity');
    if (!entityId && p('slug')) {
      const row = await db.prepare('SELECT entity_id FROM graph_browse_keys WHERE browse_key = ?1').bind(`slug:${p('slug')}`).first();
      entityId = row?.entity_id || (/^cg:/.test(p('slug')) ? p('slug') : '');
    }
    if (!entityId) {
      const keys = url.searchParams.getAll('browse').map((k) => k.trim()).filter(Boolean).slice(0, 20);
      if (!keys.length) return jsonResponse({ error: 'give browse=, entity=, slug=, q= or view=manifest' }, 400);
      const { results } = await db.prepare(`SELECT browse_key, entity_id FROM graph_browse_keys WHERE browse_key IN (${keys.map((_, i) => `?${i + 1}`).join(', ')}) ORDER BY browse_key`).bind(...keys).all();
      const found = new Map((results || []).map((r) => [r.browse_key, r.entity_id]));
      entityId = keys.map((k) => found.get(k)).find(Boolean) || '';
      if (!entityId) return jsonResponse({ entityId: '', summary: null, statements: [], total: 0 });
    }
    return jsonResponse(await entityPayload(db, entityId, { related, limit, offset }));
  } catch (error) {
    return jsonResponse({ error: 'graph query failed', ...reportError(context.env, 'graph', error) }, 500);
  }
}
