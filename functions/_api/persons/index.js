/**
 * Browse persons served from D1 (binding ELECTIONS_DB).
 *
 *   GET /_api/persons?slug=<slug>          -> { person }         one record
 *   GET /_api/persons?q=<text>&limit=N     -> { persons, total } name search
 *   GET /_api/persons?limit=N&offset=M     -> paged index
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

export const onRequestGet = browseIndexHandler({
  table: 'browse_persons',
  key: 'persons',
  version: 'persons-5',
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
      sql: `EXISTS (
        SELECT 1 FROM json_each(browse_persons.record, '$.parties')
        WHERE json_extract(value, '$.name') IN (${parties.map(bind).join(', ')})
      )`,
    }];
  },
});
