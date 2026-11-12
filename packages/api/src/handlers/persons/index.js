/**
 * Browse persons served from D1 (binding ELECTIONS_DB).
 *
 *   GET /_api/persons?slug=<slug>          -> { person }         one record
 *   GET /_api/persons?q=<text>&limit=N     -> { persons, total } name search
 *   GET /_api/persons?limit=N&offset=M     -> paged index
 *   GET /_api/persons?facets=1             -> the People filter options (persons-facets.json)
 *   GET /_api/persons?slug=<slug>&view=candidacies  -> every candidacy, in date order
 *   GET /_api/persons?slug=<slug>&view=votes        -> the votes/persons/<id>.json document
 *
 * 11,960 records. This is the endpoint that replaced a 24 MB shard scan: on 2026-08-23
 * the client still expected `payload.items` after the index became a manifest, silently
 * resolved to [], and every person link on the site stopped working with no error.
 *
 * Browse's People list filters and sorts (2026-10-31): ?body=, ?decade= (several values each,
 * ORed), ?elected=yes|no and ?party=; ?sort=name|contests|elected|firstYear|lastYear.
 * The response's `applied` names the filters and sort it used.
 *
 * Party filtering is not a column here: a person stands for several parties, and the client
 * sends every name a party is known by (?party= repeated, ORed). Since 11 Nov 2026 it reads
 * person_card_parties, one (party, slug) row per party name a card lists (migration 0006), so
 * the filter is an index range per name instead of a json_each over every card; it combines
 * with the other filters, the search and the sort as before. A database without that table
 * (a deployment ahead of its records load) gets the old json_each filter, with the same people.
 */
import { browseIndexHandler } from '../_browse-index.js';
import { parseJson } from '../_records.js';
import { PERSONS } from '../../queries/cards.js';

/** @typedef {import('../_browse-index.js').ViewContext} ViewContext */

/**
 * A person's candidacies from the records tables, in date order (data design stage D.3).
 * @param {ViewContext} view
 */
async function candidacies({ db, slug, record, json }) {
  const personId = String(record['id'] || '').replace(/^person:/, '');
  const results = await db.all(PERSONS.candidacies, [personId]);
  const items = results.map((r) => ({ ...r, elected: r['elected'] === 1, unopposed: r['unopposed'] === 1 }));
  return json({ slug, personId, total: items.length, candidacies: items });
}

/**
 * The votes/persons/<id>.json document for this person, or 404 when they cast none.
 * @param {ViewContext} view
 */
async function votes({ db, record, json }) {
  const personId = String(record['id'] || '').replace(/^person:/, '');
  const row = /** @type {{ record: string } | null} */ (await db.first(PERSONS.votes, [personId]));
  if (!row) return json({ error: 'no votes', personId }, 404);
  return json(parseJson(row.record));
}

export const onRequestGet = browseIndexHandler({
  table: 'person_cards',
  recordColumn: 'card',
  aliasTable: 'person_aliases',
  key: 'persons',
  version: 'persons-6',
  facets: true,
  views: { candidacies, votes },
  filters: {
    elected: 'elected',
  },
  listFilters: {
    body: 'bodies',
    decade: 'decades',
  },
  sorts: {
    name: 'title_norm',
    contests: { column: 'contests', dir: 'desc' },
    elected: { column: 'elected_count', dir: 'desc' },
    firstYear: 'first_year',
    lastYear: { column: 'last_year', dir: 'desc' },
  },
  where: (/** @type {URL} */ url, /** @type {(v: unknown) => string} */ bind, { fallback } = { fallback: false }) => {
    const parties = url.searchParams.getAll('party').map((v) => v.trim()).filter(Boolean).slice(0, 200);
    if (!parties.length) return [];
    return [{
      param: 'party',
      sql: (fallback ? PERSONS.partyFilterFromCards : PERSONS.partyFilter)(parties.map(bind)),
    }];
  },
});
