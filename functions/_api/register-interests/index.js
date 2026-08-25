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

export const onRequestGet = browseIndexHandler({
  table: 'browse_register_interests',
  key: 'register-interests',
  version: 'register-interests-1',
  filters: {
    memberName: 'member_name',
    electedBody: 'elected_body',
    category: 'category',
  },
});
