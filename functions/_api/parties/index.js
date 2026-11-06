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

const VERSION = 'parties-1';

export async function onRequestGet(context) {
  return cachedJson(context, VERSION, () => handle(context));
}

/** The live slug for a slug or a retired one, and whether it was retired. */
export async function resolvePartySlug(db, slug) {
  const live = await db.prepare('SELECT slug FROM party_cards WHERE slug = ?1').bind(slug).first();
  if (live) return { slug: live.slug, redirect: null };
  const alias = await db.prepare('SELECT slug FROM party_aliases WHERE alias = ?1').bind(slug).first();
  return alias ? { slug: alias.slug, redirect: alias.slug } : null;
}

async function handle(context) {
  const db = context.env.ELECTIONS_DB;
  const url = new URL(context.request.url);
  const slugParam = (url.searchParams.get('slug') || '').trim().toLowerCase();
  const view = (url.searchParams.get('view') || '').trim();
  try {
    if (view === 'names') {
      const head = (await documentBody(db, 'browse/party-names.json')) || {};
      const { results } = await db.prepare('SELECT label, party_slug FROM party_label_map ORDER BY ord, label').all();
      return jsonResponse({ ...head, items: Object.fromEntries((results || []).map((r) => [r.label, r.party_slug])) });
    }
    if (view === 'folds') {
      const doc = await documentBody(db, 'browse/party-label-folds.json');
      return doc ? jsonResponse(doc) : jsonResponse({ error: 'not found' }, 404);
    }
    if (slugParam) {
      const resolved = await resolvePartySlug(db, slugParam);
      if (!resolved) return jsonResponse({ error: 'not found', slug: slugParam }, 404);
      const row = await db.prepare('SELECT card, detail, profile FROM party_cards WHERE slug = ?1').bind(resolved.slug).first();
      if (view === 'profile') {
        return row?.profile ? jsonResponse(row.profile) : jsonResponse({ error: 'no profile', slug: resolved.slug }, 404);
      }
      if (view) return jsonResponse({ error: `unknown view ${view}` }, 400);
      const item = parseJson(row?.detail) || parseJson(row?.card);
      return jsonResponse({ schemaVersion: 1, item, ...(resolved.redirect ? { redirect: resolved.redirect } : {}) });
    }
    if (view) return jsonResponse({ error: `unknown view ${view}` }, 400);
    const head = (await documentBody(db, 'browse/parties.json')) || {};
    const { results } = await db.prepare('SELECT card FROM party_cards ORDER BY ord, slug').all();
    return jsonResponse({ ...head, items: (results || []).map((r) => parseJson(r.card)) });
  } catch (error) {
    return jsonResponse({ error: 'parties query failed', ...reportError(context.env, 'parties', error) }, 500);
  }
}
