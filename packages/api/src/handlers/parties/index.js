/**
 * Parties served from D1 (the records tables; data design phase 2). Small (about 700), so not a
 * _browse-index wrapper: the list is answered whole.
 *
 *   GET /_api/parties                       -> data/browse/parties.json ({ items } in source order)
 *   GET /_api/parties?slug=<slug>           -> data/browse/details/parties/<slug>.json ({ item });
 *                                              a retired slug answers its party with `redirect`
 *   GET /_api/parties?slug=<slug>&view=profile -> data/browse/party-profiles/<slug>.json
 *   GET /_api/parties?slug=<slug>&view=members[&limit=&offset=] -> the people who stood for it,
 *                                              compact, a page at a time (./members.js)
 *   GET /_api/parties?view=names            -> data/browse/party-names.json (ballot label -> party)
 *   GET /_api/parties?view=folds            -> data/browse/party-label-folds.json
 */
import { cachedJson, documentBody, jsonResponse, parseJson } from '../_records.js';
import { reportError } from '../_error.js';
import { binding } from '../../../../config/src/config.js';
import { asStore } from '../../../../storage/src/d1.js';
import { PARTIES } from '../../queries/parties.js';
import { partyMembers } from './members.js';

const VERSION = 'parties-1';

/** @param {import('../../types.js').ApiContext} context */
export async function onRequestGet(context) {
  return cachedJson(context, VERSION, () => handle(context));
}

/**
 * The live slug for a slug or a retired one, and whether it was retired.
 * @param {import('../../../../storage/src/store.js').RecordStore | D1Database} source a store or a D1 binding
 * @param {string} slug
 * @returns {Promise<{ slug: string, redirect: string | null } | null>}
 */
export async function resolvePartySlug(source, slug) {
  const db = asStore(source);
  const live = /** @type {{ slug: string } | null} */ (await db.first(PARTIES.live, [slug]));
  if (live) return { slug: live.slug, redirect: null };
  const alias = /** @type {{ slug: string } | null} */ (await db.first(PARTIES.alias, [slug]));
  return alias ? { slug: alias.slug, redirect: alias.slug } : null;
}

/** @param {import('../../types.js').ApiContext} context */
async function handle(context) {
  const bound = binding(context.env, 'ELECTIONS_DB');
  // through the storage adapter (packages/storage/); the SQL is named in queries/parties.js
  // (cachedJson calls this only when the binding is there)
  const db = /** @type {import('../../../../storage/src/store.js').RecordStore} */ (bound && asStore(bound));
  const url = new URL(context.request.url);
  const slugParam = (url.searchParams.get('slug') || '').trim().toLowerCase();
  const view = (url.searchParams.get('view') || '').trim();
  try {
    if (view === 'names') {
      const head = (await documentBody(db, 'browse/party-names.json')) || {};
      const results = /** @type {Array<{ label: string, party_slug: string }>} */ (await db.all(PARTIES.labelMap));
      return jsonResponse({ ...head, items: Object.fromEntries(results.map((r) => [r.label, r.party_slug])) });
    }
    if (view === 'folds') {
      const doc = await documentBody(db, 'browse/party-label-folds.json');
      return doc ? jsonResponse(doc) : jsonResponse({ error: 'not found' }, 404);
    }
    if (slugParam) {
      const resolved = await resolvePartySlug(db, slugParam);
      if (!resolved) return jsonResponse({ error: 'not found', slug: slugParam }, 404);
      if (view === 'members') {
        try {
          const { status, body } = await partyMembers(db, url, resolved.slug);
          return jsonResponse(body, status);
        } catch (error) {
          // Code deployed before the load that adds person_card_parties (migration 0006): the
          // page falls back to /_api/persons?party=, so say so rather than report a failure.
          if (/no such table/i.test(String(/** @type {Error} */ (error)?.message || error))) {
            return jsonResponse({ error: 'members not loaded yet', slug: resolved.slug }, 503);
          }
          throw error;
        }
      }
      const row = /** @type {{ profile: string | null, detail: string | null, card: string } | null} */ (await db.first(PARTIES.detail, [resolved.slug]));
      if (view === 'profile') {
        return row?.profile ? jsonResponse(row.profile) : jsonResponse({ error: 'no profile', slug: resolved.slug }, 404);
      }
      if (view) return jsonResponse({ error: `unknown view ${view}` }, 400);
      const item = parseJson(row?.detail) || parseJson(row?.card);
      return jsonResponse({ schemaVersion: 1, item, ...(resolved.redirect ? { redirect: resolved.redirect } : {}) });
    }
    if (view) return jsonResponse({ error: `unknown view ${view}` }, 400);
    const head = (await documentBody(db, 'browse/parties.json')) || {};
    const results = /** @type {Array<{ card: string }>} */ (await db.all(PARTIES.cards));
    return jsonResponse({ ...head, items: results.map((r) => parseJson(r.card)) });
  } catch (error) {
    return jsonResponse({ error: 'parties query failed', ...reportError(context.env, 'parties', error) }, 500);
  }
}
