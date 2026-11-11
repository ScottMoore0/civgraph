/**
 * GET /_api/parties?slug=<slug>&view=members[&limit=N&offset=M]: the people who stood for a
 * party, compact, for the party page's candidate list (11 Nov 2026).
 *
 * The page read them through /_api/persons?party=<each alias>, which answers whole Browse cards
 * and finds them by reading every card's parties (json_each over person_cards): Fianna Fáil's
 * list was seventeen requests of about 860 KB, each of which read all 37,000 cards. This view
 * finds the same people -- every card listing one of the party's names (its canonical name,
 * title, short name, observed names and known aliases, as the page sends them) -- through
 * person_card_parties' primary key, reads only the cards of the page it answers, and sends the
 * few fields the page reads (packages/core/src/party-members.mjs has the format).
 *
 * Pages (of up to MAX_LIMIT) are cut in slug order, the cheap order of the index; each person
 * carries their place in the Browse people list, and the page puts them in that order.
 */
import { MEMBER_COLUMNS, MEMBERS_SCHEMA_VERSION, memberEncoder } from '../../../../core/src/party-members.mjs';
import { parseJson } from '../_records.js';
import { PARTIES } from '../../queries/parties.js';

/** @typedef {import('../../../../storage/src/store.js').RecordStore} RecordStore */

export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 1000;
/** The most names one request matches (the persons list's cap on ?party=). */
const MAX_NAMES = 200;

/**
 * The names a party is known by, as the party page sends them to find its people.
 * @param {Record<string, unknown> | null} item the party's Browse detail
 * @returns {string[]}
 */
export function partyNames(item) {
  if (!item) return [];
  const list = (/** @type {unknown} */ value) => (Array.isArray(value) ? value : []);
  return [...new Set([item.canonicalName, item.title, item.shortName, ...list(item.observedNames), ...list(item.knownAliases)]
    .filter((name) => typeof name === 'string' && name.trim() !== '')
    .map((name) => /** @type {string} */ (name).trim()))].slice(0, MAX_NAMES);
}

const clamp = (/** @type {string | null} */ raw) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(value), MAX_LIMIT);
};

/**
 * @param {RecordStore} db
 * @param {URL} url
 * @param {string} slug the party's live slug
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export async function partyMembers(db, url, slug) {
  const row = /** @type {{ card: string, detail: string | null } | null} */ (await db.first(PARTIES.record, [slug]));
  const item = /** @type {Record<string, unknown> | null} */ (parseJson(row?.detail) || parseJson(row?.card));
  if (!item) return { status: 404, body: { error: 'not found', slug } };
  const names = partyNames(item);
  const limit = clamp(url.searchParams.get('limit'));
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
  const head = { schemaVersion: MEMBERS_SCHEMA_VERSION, slug, names, limit, offset, columns: MEMBER_COLUMNS };
  if (!names.length) return { status: 200, body: { ...head, total: 0, count: 0, dictionaries: memberEncoder().dictionaries, members: [] } };
  const [rows, total] = /** @type {[{ slug: string, ord: number, card: string }[], { n: number } | null]} */ (await Promise.all([
    db.all(PARTIES.membersPage(names.length), [...names, limit, offset]),
    db.first(PARTIES.membersCount(names.length), names),
  ]));
  const encoder = memberEncoder();
  const members = rows.map((r) => encoder.member({ slug: r.slug, ...(parseJson(r.card) || {}) }, r.ord));
  return { status: 200, body: { ...head, total: total?.n ?? members.length, count: members.length, dictionaries: encoder.dictionaries, members } };
}
