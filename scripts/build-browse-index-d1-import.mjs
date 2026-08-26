#!/usr/bin/env node
/**
 * Emit the SQL that loads a sharded browse index into the civgraph-elections D1.
 *
 * Generalised from build-persons-d1-import.mjs once the same treatment was wanted for two
 * more indexes. Writing it three times would have produced three places for the next
 * schema change to be forgotten -- which is the failure this whole exercise is about.
 *
 * WHY THESE INDEXES MOVE
 *
 * All three are sharded, and all three were sharded for the same reason: a single file
 * had breached Cloudflare Pages' 25 MB per-file limit. Sharding kept them deployable
 * without changing what they are -- blobs you scan.
 *
 *   persons             11,960 items    16 MB across 3 shards
 *   register-interests   5,064 items     6 MB across 2 shards
 *   sources             40,327 items    51 MB across 9 shards
 *
 * The cost lands on the commonest operation. browse.js resolves a deep link with
 * findItem(data.items, id) -- so opening ONE source at #/sources/<slug> requires the whole
 * 51 MB index first. For persons that failure was worse than slow: on 2026-08-23 the
 * reader in app/src/app.js still expected `payload.items` after the index became a
 * manifest, silently resolved to [], and every person link on the site stopped working
 * with no error. A point lookup against a scanned blob cannot tell a miss from an empty
 * index. A query can.
 *
 * SHAPE. Same convention as build-catalogue-d1-import.mjs, deliberately: the record
 * stored whole as JSON, only the fields actually queried by lifted into columns, and
 * `ord` preserving source order because ORDER BY slug would reshuffle the list browse
 * relies on. That makes the import provably lossless and lets columns be promoted out of
 * the blob later without another migration.
 *
 *   node scripts/build-browse-index-d1-import.mjs persons
 *   node scripts/build-browse-index-d1-import.mjs sources --check
 *   node scripts/build-browse-index-d1-import.mjs --all
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// D1 rejects very large single statements. The catalogue importer settled on 60 KB.
const MAX_STATEMENT_BYTES = 60 * 1024;

/**
 * Flattened searchable text, mirroring searchableText() in browse/browse.js.
 *
 * browse.js filters a list with a substring match over ~32 fields, several of them
 * arrays. Server-side search has to match the SAME fields or the results change meaning
 * -- a search that silently stops looking at `knownAliases` finds fewer people and says
 * nothing about it. Kept as one list so the two can be diffed by eye.
 */
const SEARCH_FIELDS = [
  'id', 'key', 'title', 'name', 'subtitle', 'description', 'category', 'group', 'provider',
  'body', 'date', 'status', 'canonicalName', 'observedNames', 'knownAliases', 'memberName',
  'memberType', 'electedBody', 'chamber', 'jurisdiction', 'constituency', 'constituencies',
  'categories', 'parties', 'sourceTitle', 'sourceTitles', 'sourceKind', 'sourceKinds',
  'interestSummary', 'interestText', 'keywords',
];

/** An array of {name} objects flattens to its names; a string stays a string. */
const flattenValue = (value) => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(flattenValue);
  if (typeof value === 'object') return [value.name, value.title, value.label].filter(Boolean);
  return [String(value)];
};

const searchText = (item) => SEARCH_FIELDS
  .flatMap((field) => flattenValue(item[field]))
  .filter(Boolean)
  .join(' ')
  .toLowerCase()
  .slice(0, 4000);   // enough to match on; keeps the row from ballooning

/**
 * Per-entity spec. `search` is the field a human would type; `key` is what the CLIENT
 * looks the record up by, which is not always the stored slug -- see entityKey().
 */
const ENTITIES = {
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
      date: (item) => text(item.date),
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
    },
    facets: {
      provider: (item) => arr(item.provider),
      category: (item) => [item.category],
      publicationStatus: (item) => [item.publicationStatus],
    },
  },
};

const q = (value) => (value === undefined || value === null
  ? 'NULL'
  : `'${String(value).replace(/'/g, "''")}'`);
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const text = (value) => (value === undefined || value === null ? null : String(value));
const lit = (value) => (value === null || value === undefined ? 'NULL'
  : typeof value === 'number' ? value : q(value));

/** A field that may be a string, an array, or an array of {name} objects -> string[]. */
const arr = (value) => flattenValue(value).filter(Boolean);
/** The first value of such a field, for a sortable column. */
const normaliseOne = (value) => arr(value)[0] || null;

/**
 * Kept character-for-character identical to slugifyEntityKey in app/src/app.js. Stored
 * rather than reconstructed in SQL, so the two cannot drift into disagreeing.
 */
const entityKey = (value) => String(value || '')
  .split('|')[0]
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/^(party|candidate|person|name):/, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

/** Read a sharded index the same way browse.js does, so this cannot drift from it. */
function readIndex(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.indexLayout !== 'sharded' || !Array.isArray(manifest.shards)) {
    return Array.isArray(manifest.items) ? manifest.items : [];
  }
  const items = [];
  for (const shard of manifest.shards) {
    // shard.url is site-absolute; on disk it is repo-relative.
    const file = String(shard.url || '').replace(/^\//, '');
    if (!existsSync(file)) throw new Error(`shard missing on disk: ${shard.url}`);
    items.push(...(JSON.parse(readFileSync(file, 'utf8')).items || []));
  }
  return items;
}

function buildSql(name, spec) {
  const items = readIndex(spec.index);
  if (!items.length) throw new Error(`no records read from ${spec.index}`);

  const extraCols = Object.keys(spec.extra || {});
  const columns = ['slug', 'id', 'title', 'title_norm', 'key_norm', 'search_norm', ...extraCols, 'ord', 'record'];

  const lines = [];
  lines.push(`-- GENERATED by scripts/build-browse-index-d1-import.mjs ${name}. Do not edit by hand.`);
  lines.push(`-- Source: ${spec.index}. Target: civgraph-elections.`);
  lines.push('PRAGMA foreign_keys=OFF;');
  lines.push(`DROP TABLE IF EXISTS ${spec.table};`);
  lines.push('');
  lines.push(`CREATE TABLE ${spec.table} (
  slug       TEXT PRIMARY KEY,
  id         TEXT,
  title      TEXT,
  -- Lower-cased title. SQLite's LIKE folds case for ASCII only, and these carry fadas.
  title_norm TEXT,
  -- The key the CLIENT looks up by. NOT always the slug; see entityKey().
  key_norm   TEXT,
  -- Every field browse.js's substring filter looks at, flattened and lower-cased.
  -- Searching only the title would quietly return fewer results than the client did.
  search_norm TEXT,
${extraCols.map((c) => `  ${c.padEnd(10)} TEXT,`).join('\n')}
  ord        INTEGER NOT NULL,
  record     TEXT NOT NULL
);`);
  lines.push(`CREATE INDEX idx_${spec.table}_title_norm ON ${spec.table}(title_norm);`);
  // No index on search_norm: it is matched with LIKE '%...%', which cannot use one.
  // A LIKE scan over 40k rows is acceptable; FTS5 is the upgrade if it stops being so.
  lines.push(`CREATE INDEX idx_${spec.table}_key_norm ON ${spec.table}(key_norm);`);
  lines.push(`CREATE INDEX idx_${spec.table}_id ON ${spec.table}(id);`);
  for (const col of extraCols) lines.push(`CREATE INDEX idx_${spec.table}_${col} ON ${spec.table}(${col});`);
  lines.push('');

  const cols = `(${columns.join(', ')})`;
  const rowSql = (item, ord) => {
    const title = spec.title(item);
    return `(${[
      q(item.slug), q(item.id), q(title),
      q(String(title || '').toLowerCase()),
      q(spec.key(item)),
      q(searchText(item)),
      ...extraCols.map((c) => lit(spec.extra[c](item))),
      ord, q(JSON.stringify(item)),
    ].join(', ')})`;
  };

  let batch = [];
  let batchBytes = 0;
  let chunked = 0;
  const flush = () => {
    if (!batch.length) return;
    lines.push(`INSERT INTO ${spec.table} ${cols} VALUES\n${batch.join(',\n')};`);
    batch = [];
    batchBytes = 0;
  };

  /**
   * A record whose SQL exceeds one statement is APPENDED in chunks, never truncated.
   * Dropping the tail would make the import lossy, which is the exact failure the
   * store-the-whole-record convention exists to prevent.
   *
   * No record currently needs this. Two did until 2026-08-25: the referendum
   * pseudo-people "Yes" and "No", 437 KB each, which build-browse-indexes.mjs now
   * excludes because a referendum has options rather than candidates. The path stays
   * because the next oversized record should not be a deploy failure.
   */
  const writeChunked = (item, ord) => {
    chunked += 1;
    const json = JSON.stringify(item);
    const size = 40 * 1024;
    const parts = [];
    for (let at = 0; at < json.length; at += size) parts.push(json.slice(at, at + size));
    const title = spec.title(item);
    lines.push(`INSERT INTO ${spec.table} ${cols} VALUES (${[
      q(item.slug), q(item.id), q(title),
      q(String(title || '').toLowerCase()),
      q(spec.key(item)),
      q(searchText(item)),
      ...extraCols.map((c) => lit(spec.extra[c](item))),
      ord, q(parts[0]),
    ].join(', ')});`);
    for (let part = 1; part < parts.length; part += 1) {
      lines.push(`UPDATE ${spec.table} SET record = record || ${q(parts[part])} WHERE slug = ${q(item.slug)};`);
    }
  };

  // Facet options, precomputed. browse.js derives these by scanning the loaded list;
  // server-side that would be a SELECT DISTINCT per facet per request. They change only
  // when the index is rebuilt, so they are computed here and read as one row.
  if (spec.facets) {
    const facets = {};
    for (const [facetKey, extract] of Object.entries(spec.facets)) {
      const values = new Set();
      for (const item of items) for (const value of extract(item) || []) if (value) values.add(String(value));
      facets[facetKey] = [...values].sort((a, b) => a.localeCompare(b));
    }
    lines.push(`DROP TABLE IF EXISTS ${spec.table}_facets;`);
    lines.push(`CREATE TABLE ${spec.table}_facets (facets TEXT NOT NULL);`);
    lines.push(`INSERT INTO ${spec.table}_facets (facets) VALUES (${q(JSON.stringify(facets))});`);
    lines.push('');
  }

  for (let i = 0; i < items.length; i += 1) {
    const row = rowSql(items[i], i);
    if (row.length > MAX_STATEMENT_BYTES) { flush(); writeChunked(items[i], i); continue; }
    if (batch.length && batchBytes + row.length > MAX_STATEMENT_BYTES) flush();
    batch.push(row);
    batchBytes += row.length;
  }
  flush();
  lines.push('');

  return { sql: `${lines.join('\n')}\n`, count: items.length, chunked };
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const all = args.includes('--all');
const names = all ? Object.keys(ENTITIES) : args.filter((a) => !a.startsWith('--'));

if (!names.length) {
  console.error('Usage: build-browse-index-d1-import.mjs <persons|register-interests|sources|--all> [--check]');
  process.exit(1);
}

let failed = false;
for (const name of names) {
  const spec = ENTITIES[name];
  if (!spec) { console.error(`FAIL: unknown entity "${name}".`); process.exit(1); }
  const { sql, count, chunked } = buildSql(name, spec);
  if (check) {
    if (!existsSync(spec.out) || readFileSync(spec.out, 'utf8') !== sql) {
      console.error(`FAIL: ${spec.out} is stale -- it does not match ${spec.index}.`);
      console.error('  Deploying a stale import silently reinstates the old records.');
      console.error(`  Regenerate: node scripts/build-browse-index-d1-import.mjs ${name}`);
      failed = true;
      continue;
    }
    console.log(`PASS: ${spec.out} matches ${spec.index} (${count} records).`);
    continue;
  }
  writeFileSync(spec.out, sql);
  const largest = Math.max(...sql.split(';\n').map((s) => s.length));
  console.log(`${name}: ${count} records -> ${spec.out} (${(sql.length / 1024 / 1024).toFixed(2)} MB, `
    + `largest stmt ${(largest / 1024).toFixed(1)} KB${chunked ? `, ${chunked} chunked` : ''})`);
}
if (failed) process.exit(1);
