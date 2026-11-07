/**
 * Parties served from D1 (the records tables; data design phase 2). Small (about 700), so not a
 * _browse-index wrapper: the list is answered whole.
 *
 *   GET /_api/parties                       -> data/browse/parties.json ({ items } in source order)
 *   GET /_api/parties?slug=<slug>           -> data/browse/details/parties/<slug>.json ({ item });
 *                                              a retired slug answers its party with `redirect`
 *   GET /_api/parties?slug=<slug>&view=profile -> data/browse/party-profiles/<slug>.json
 *   GET /_api/parties?view=names            -> data/browse/party-names.json (ballot label -> party)
 *   GET /_api/parties?view=folds            -> data/browse/party-label-folds.json
 */
import { cachedJson, documentBody, jsonResponse, parseJson } from '../_records.js';
import { reportError } from '../_error.js';
import { binding } from '../../_lib/config.js';
import { asStore } from '../../../packages/storage/src/d1.js';
import { PARTIES } from '../../../packages/api/src/queries/parties.js';

const VERSION = 'parties-1';

export async function onRequestGet(context) {
  return cachedJson(context, VERSION, () => handle(context));
}

/**
 * The live slug for a slug or a retired one, and whether it was retired.
 * @param {import('../../../packages/storage/src/store.js').RecordStore | D1Database} source a store or a D1 binding
 * @param {string} slug
 */
export async function resolvePartySlug(source, slug) {
  const db = asStore(source);
  const live = await db.first(PARTIES.live, [slug]);
  if (live) return { slug: live.slug, redirect: null };
  const alias = await db.first(PARTIES.alias, [slug]);
  return alias ? { slug: alias.slug, redirect: alias.slug } : null;
}

async function handle(context) {
  const bound = binding(context.env, 'ELECTIONS_DB');
  // through the storage adapter (packages/storage/); the SQL is named in queries/parties.js
  const db = bound && asStore(bound);
  const url = new URL(context.request.url);
  const slugParam = (url.searchParams.get('slug') || '').trim().toLowerCase();
  const view = (url.searchParams.get('view') || '').trim();
  try {
    if (view === 'names') {
      const head = (await documentBody(db, 'browse/party-names.json')) || {};
      const results = await db.all(PARTIES.labelMap);
      return jsonResponse({ ...head, items: Object.fromEntries(results.map((r) => [r.label, r.party_slug])) });
    }
    if (view === 'folds') {
      const doc = await documentBody(db, 'browse/party-label-folds.json');
      return doc ? jsonResponse(doc) : jsonResponse({ error: 'not found' }, 404);
    }
    if (slugParam) {
      const resolved = await resolvePartySlug(db, slugParam);
      if (!resolved) return jsonResponse({ error: 'not found', slug: slugParam }, 404);
      const row = await db.first(PARTIES.detail, [resolved.slug]);
      if (view === 'profile') {
        return row?.profile ? jsonResponse(row.profile) : jsonResponse({ error: 'no profile', slug: resolved.slug }, 404);
      }
      if (view) return jsonResponse({ error: `unknown view ${view}` }, 400);
      const item = parseJson(row?.detail) || parseJson(row?.card);
      return jsonResponse({ schemaVersion: 1, item, ...(resolved.redirect ? { redirect: resolved.redirect } : {}) });
    }
    if (view) return jsonResponse({ error: `unknown view ${view}` }, 400);
    const head = (await documentBody(db, 'browse/parties.json')) || {};
    const results = await db.all(PARTIES.cards);
    return jsonResponse({ ...head, items: results.map((r) => parseJson(r.card)) });
  } catch (error) {
    return jsonResponse({ error: 'parties query failed', ...reportError(context.env, 'parties', error) }, 500);
  }
}
