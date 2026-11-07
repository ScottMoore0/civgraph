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
 * NOTE: party filtering is NOT a column here. A person's parties live in a nested array
 * inside the record, and the client matches them against a party's aliases; that query
 * stays a json_each match rather than being flattened into a column, because the alias set
 * is the party's property, not the person's. It now combines with the other filters, the
 * search and the sort, which the separate party branch it replaced ignored.
 */
import { browseIndexHandler } from '../_browse-index.js';
import { parseJson } from '../_records.js';
import { PERSONS } from '../../_lib/queries/cards.js';

/** A person's candidacies from the records tables, in date order (data design stage D.3). */
async function candidacies({ db, slug, record, json }) {
  const personId = String(record.id || '').replace(/^person:/, '');
  const results = await db.all(PERSONS.candidacies, [personId]);
  const items = results.map((r) => ({ ...r, elected: r.elected === 1, unopposed: r.unopposed === 1 }));
  return json({ slug, personId, total: items.length, candidacies: items });
}

/** The votes/persons/<id>.json document for this person, or 404 when they cast none. */
async function votes({ db, record, json }) {
  const personId = String(record.id || '').replace(/^person:/, '');
  const row = await db.first(PERSONS.votes, [personId]);
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
  where: (url, bind) => {
    const parties = url.searchParams.getAll('party').map((v) => v.trim()).filter(Boolean).slice(0, 200);
    if (!parties.length) return [];
    return [{
      param: 'party',
      sql: PERSONS.partyFilter(parties.map(bind)),
    }];
  },
});
