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
import { binding } from '../../_lib/config.js';
import { asStore } from '../../_lib/storage/d1.js';
import { GRAPH } from '../../_lib/queries/graph.js';

const VERSION = 'graph-1';
const MAX = 2000;

export async function onRequestGet(context) {
  return cachedJson(context, VERSION, () => handle(context));
}

const fold = (value) => String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function entityPayload(db, entityId, { related, limit, offset }) {
  const ent = await db.first(GRAPH.entity, [entityId]);
  const [statements, total] = await Promise.all([
    db.all(GRAPH.statements, [entityId, limit, offset]),
    db.first(GRAPH.statementCount, [entityId]),
  ]);
  const out = {
    entityId,
    summary: parseJson(ent?.summary),
    statements: statements.map((r) => parseJson(r.statement)),
    total: total?.n ?? 0,
  };
  if (related) {
    const [reverse, sources] = await Promise.all([
      db.all(GRAPH.reverse, [entityId, MAX]),
      db.all(GRAPH.sourceStatements, [entityId, MAX]),
    ]);
    out.reverse = reverse.map((r) => parseJson(r.item));
    out.sourceStatements = sources.map((r) => parseJson(r.item));
  }
  return out;
}

async function handle(context) {
  const bound = binding(context.env, 'ELECTIONS_DB');
  // through the storage adapter (functions/_lib/storage/); the SQL is named in queries/graph.js
  const db = bound && asStore(bound);
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
      const binds = words.flatMap((w) => [`%${w}%`, `%${w}%`]);
      const results = await db.all(GRAPH.search(words.length, Math.min(limit, 200)), binds);
      return jsonResponse({ items: results.map((r) => parseJson(r.search)) });
    }
    let entityId = p('entity');
    if (!entityId && p('slug')) {
      const row = await db.first(GRAPH.browseKey, [`slug:${p('slug')}`]);
      entityId = row?.entity_id || (/^cg:/.test(p('slug')) ? p('slug') : '');
    }
    if (!entityId) {
      const keys = url.searchParams.getAll('browse').map((k) => k.trim()).filter(Boolean).slice(0, 20);
      if (!keys.length) return jsonResponse({ error: 'give browse=, entity=, slug=, q= or view=manifest' }, 400);
      const results = await db.all(GRAPH.browseKeys(keys.length), keys);
      const found = new Map(results.map((r) => [r.browse_key, r.entity_id]));
      entityId = keys.map((k) => found.get(k)).find(Boolean) || '';
      if (!entityId) return jsonResponse({ entityId: '', summary: null, statements: [], total: 0 });
    }
    return jsonResponse(await entityPayload(db, entityId, { related, limit, offset }));
  } catch (error) {
    return jsonResponse({ error: 'graph query failed', ...reportError(context.env, 'graph', error) }, 500);
  }
}
