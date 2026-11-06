/**
 * Browse register-of-interests entries served from D1 (binding ELECTIONS_DB).
 *
 *   GET /_api/register-interests?slug=<slug>          -> { register-interest }
 *   GET /_api/register-interests?q=<text>&limit=N     -> { register-interests, total }
 *   GET /_api/register-interests?memberName=&electedBody=&category=
 *
 * 5,064 records, 6 MB across two shards. Same reasoning as the other two: a deep link to
 * one entry should not cost the whole index.
 */
import { browseIndexHandler } from '../_browse-index.js';
import { parseJson } from '../_records.js';

/** ?slug=&view=detail: the entry with its interests (was data/database/ni-register-browse-records). */
async function detail({ db, slug, record, json }) {
  const row = await db.prepare('SELECT detail FROM register_entries WHERE slug = ?1').bind(slug).first();
  const match = parseJson(row?.detail);
  if (!match) return json({ error: 'no detail', slug }, 404);
  return json({ schemaVersion: 1, item: { ...record, ...match } });
}

export const onRequestGet = browseIndexHandler({
  table: 'register_entries',
  recordColumn: 'card',
  key: 'register-interests',
  version: 'register-interests-2',
  views: { detail },
  filters: {
    memberName: 'member_name',
    electedBody: 'elected_body',
    category: 'category',
    memberType: 'member_type',
    chamber: 'chamber',
    constituency: 'constituency',
    nilStatus: 'nil_status',
  },
  // The six sort options browse.js offers, mapped to real columns. An unknown ?sort=
  // falls back to `ord` rather than erroring -- a bad sort key should not blank the page.
  sorts: {
    date: 'date',
    memberName: 'member_name',
    electedBody: 'elected_body',
    constituency: 'constituency',
    interestCount: 'interest_count',
    sourceCount: 'source_count',
  },
  facets: true,
});
