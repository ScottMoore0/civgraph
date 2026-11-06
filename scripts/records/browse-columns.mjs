/**
 * The Browse card columns of the D1 indexes: which fields of a person, source or
 * register-of-interests card are lifted into columns, how the search text and the client's
 * lookup key are made, and the facet options. Moved here unchanged from
 * scripts/build-browse-index-d1-import.mjs, which imports it until stage H deletes it, so the
 * records loader (scripts/records/ingest-browse.mjs) and the old import cannot drift apart.
 *
 * `index` and `out` name the legacy files; the records loader ignores them.
 */
/**
 * Flattened searchable text, mirroring searchableText() in browse/browse.js.
 *
 * browse.js filters a list with a substring match over ~32 fields, several of them
 * arrays. Server-side search has to match the SAME fields or the results change meaning
 * -- a search that silently stops looking at `knownAliases` finds fewer people and says
 * nothing about it. Kept as one list so the two can be diffed by eye.
 */
export const SEARCH_FIELDS = [
  'id', 'key', 'title', 'name', 'subtitle', 'description', 'category', 'group', 'provider',
  'body', 'date', 'status', 'canonicalName', 'observedNames', 'knownAliases', 'memberName',
  'memberType', 'electedBody', 'chamber', 'jurisdiction', 'constituency', 'constituencies',
  'categories', 'parties', 'sourceTitle', 'sourceTitles', 'sourceKind', 'sourceKinds',
  'interestSummary', 'interestText', 'keywords',
];

/** An array of {name} objects flattens to its names; a string stays a string. */
export const flattenValue = (value) => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(flattenValue);
  if (typeof value === 'object') return [value.name, value.title, value.label].filter(Boolean);
  return [String(value)];
};

// Accents are folded, as functions/_api/_browse-index.js folds the query: "Micheal Martin" and
// "fianna fail" must find the records spelt with fadas.
export const searchText = (item) => SEARCH_FIELDS
  .flatMap((field) => flattenValue(item[field]))
  .filter(Boolean)
  .join(' ')
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .slice(0, 4000);   // enough to match on; keeps the row from ballooning

/**
 * Per-entity spec. `search` is the field a human would type; `key` is what the CLIENT
 * looks the record up by, which is not always the stored slug -- see entityKey().
 */
export const ENTITIES = {
  persons: {
    index: 'data/browse/persons.json',
    table: 'browse_persons',
    out: 'data/database/persons-d1-import.sql',
    title: (item) => item.name || item.title,
    // app.js derives its entity key with slugifyEntityKey(), which strips a "name:"
    // prefix -- so it asks for "simon-harris" while the slug is "name-simon-harris".
    key: (item) => entityKey(item.name || item.title || item.slug),
    extra: {
      first_year: (item) => num(item.firstYear),
      last_year: (item) => num(item.lastYear),
      // Browse's People filters and sorts (functions/_api/persons). A multi-valued facet is
      // stored delimited, '|Dáil Éireann|Local Authorities of Ireland|', and matched with
      // LIKE '%|value|%', so a person who stood for two bodies is found under either.
      bodies: (item) => delimited(item.bodies),
      decades: (item) => delimited((item.elections || []).map((row) => decadeOf(row.year))),
      elected: (item) => (Number(item.totals?.elected) > 0 ? 'yes' : 'no'),
      contests: (item) => num(item.totals?.stood ?? (item.elections || []).length),
      elected_count: (item) => num(item.totals?.elected),
    },
  },
  'register-interests': {
    index: 'data/browse/register-interests.json',
    table: 'browse_register_interests',
    out: 'data/database/register-interests-d1-import.sql',
    title: (item) => item.title || item.memberName,
    key: (item) => entityKey(item.slug || item.id),
    extra: {
      member_name: (item) => text(item.memberName),
      elected_body: (item) => text(item.electedBody),
      category: (item) => text(item.category),
      // Only a date sorts as one: two entries carry the word "undated", which sorted above
      // every real date under Newest first. NULL goes last either way (_browse-index.js).
      date: (item) => (/^\d{4}(-\d{2}){0,2}$/.test(String(item.date || '')) ? item.date : null),
      // The six sort keys browse.js offers. Lifted into columns because ORDER BY cannot
      // reach into the JSON blob without a scan.
      constituency: (item) => text(normaliseOne(item.constituencies || item.constituency)),
      member_type: (item) => text(item.memberType),
      chamber: (item) => text(item.chamber),
      interest_count: (item) => num(item.interestCount),
      source_count: (item) => num(item.sourceCount),
      nil_status: (item) => (item.isNone === true ? 'nil-only'
        : Number(item.nonNilInterestCount || 0) > 0 ? 'has-registrable' : 'includes-nil'),
    },
    // Facet dropdowns. browse.js builds these by scanning the item list for distinct
    // values, which server-side would mean a SELECT DISTINCT per facet per request.
    // Precomputed at import instead: the values only change when the index is rebuilt.
    facets: {
      electedBody: (item) => [item.electedBody],
      memberType: (item) => [item.memberType],
      chamber: (item) => [item.chamber],
      constituency: (item) => arr(item.constituencies || item.constituency),
      categories: (item) => arr(item.categories || item.category),
      sourceKinds: (item) => arr(item.sourceKinds || item.sourceKind),
    },
  },
  sources: {
    index: 'data/browse/sources.json',
    table: 'browse_sources',
    out: 'data/database/sources-d1-import.sql',
    title: (item) => item.title,
    key: (item) => entityKey(item.slug || item.id),
    extra: {
      provider: (item) => text(item.provider),
      category: (item) => text(item.category),
      publication_status: (item) => text(item.publicationStatus),
      date: (item) => text(item.date),
      license: (item) => licenseLabel(item.license),
    },
    facets: {
      provider: (item) => arr(item.provider),
      category: (item) => [item.category],
      publicationStatus: (item) => [item.publicationStatus],
      // 79.4% of sources carry one. The gap is worth showing rather than hiding: an
      // unlicensed source is one that cannot be republished, which is a fact about the
      // catalogue, not a rendering problem.
      license: (item) => [licenseLabel(item.license)],
    },
  },
};

export const q = (value) => (value === undefined || value === null
  ? 'NULL'
  : `'${String(value).replace(/'/g, "''")}'`);
export const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
export const text = (value) => (value === undefined || value === null ? null : String(value));
/**
 * A source's licence is a string for 29,279 records and `{status, note}` for 2,928, where
 * the status is always something like "provider-specific" -- a real answer, not a missing
 * one. String(value) on the object form yields "[object Object]", which would have shipped
 * as a facet option.
 */
export const licenseLabel = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object' && value.status) return LICENCE_STATUS_LABELS[value.status] || String(value.status);
  return null;
};
// The {status, note} form says the licence is still to be confirmed; these read as that.
const LICENCE_STATUS_LABELS = {
  'provider-specific': 'Set by the provider (see the source)',
  'likely-open-but-confirm': 'Probably open, not confirmed',
  'licence-review-required': 'Not yet confirmed'
};
export const lit = (value) => (value === null || value === undefined ? 'NULL'
  : typeof value === 'number' ? value : q(value));

/** Distinct values as '|a|b|', for a LIKE '%|a|%' match; null when there are none. */
export const delimited = (values) => {
  const list = [...new Set(arr(values))].sort();
  return list.length ? `|${list.join('|')}|` : null;
};
const decadeOf = (year) => (Number(year) > 0 ? `${Math.floor(Number(year) / 10) * 10}s` : null);

/** A field that may be a string, an array, or an array of {name} objects -> string[]. */
export const arr = (value) => flattenValue(value).filter(Boolean);
/** The first value of such a field, for a sortable column. */
const normaliseOne = (value) => arr(value)[0] || null;

/**
 * Kept character-for-character identical to slugifyEntityKey in app/src/app.js. Stored
 * rather than reconstructed in SQL, so the two cannot drift into disagreeing.
 */
export const entityKey = (value) => String(value || '')
  .split('|')[0]
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/^(party|candidate|person|name):/, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

