// The Functions' named queries (REFACTOR-PLAN.md item 4, storage slice ST-6).
//
// Every SQL string the Functions run lives in functions/_lib/queries/, one module per table
// group, and reaches the database only through the RecordStore (functions/_lib/storage/). This
// file holds that in place:
//   1. the boundary: no Function file outside functions/_lib/storage/ calls an engine API
//      (`.prepare(`, `.batch(`, `.withSession(`) on a binding, apart from the pinned
//      list of files not yet moved (ST-5 moves them one route per commit and shrinks the list);
//   2. every named query, and every query builder over its sample arguments, prepares on the
//      local records build (tmp/records/civgraph-records.sqlite; skipped without one);
//   3. the dialect: the SQLite-only features the queries use are listed here, so a database swap
//      (plan ST-8) knows exactly what it would have to replace, and a new feature is a decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from '../../scripts/lib/config.mjs';

const FUNCTIONS = path.join(REPO_ROOT, 'functions');
const QUERIES = path.join(FUNCTIONS, '_lib', 'queries');
const DB = path.join(REPO_ROOT, 'tmp/records/civgraph-records.sqlite');

/** Function files that still call D1 directly (ST-5 empties this list). */
const NOT_YET_ON_THE_ADAPTER = [
  '_api/proni/count.js',
  '_api/proni/export.js',
  '_api/proni/node.js',
  '_api/proni/search.js',
  '_browse-page.js',
  '_templates/records/election.js',
];

/**
 * Sample arguments for each query builder (a named query that is a function), by
 * `<module>.<GROUP>.<name>`. A builder without samples fails the test: add them here.
 */
const BUILDER_SAMPLES = {
  'cards.CARDS.bySlug': [['person_cards', 'card AS record'], ['sources', 'card AS record'], ['register_entries', 'card AS record']],
  'cards.CARDS.byAlias': [['person_cards', 'card AS record', 'person_aliases'], ['sources', 'card AS record', 'source_aliases']],
  'cards.CARDS.facets': [['person_cards_facets'], ['sources_facets']],
  'cards.CARDS.page': [['person_cards', 'card AS record', '', 'ord', 0], ['person_cards', 'card AS record', 'WHERE elected = ?1', 'title_norm', 1]],
  'cards.CARDS.count': [['person_cards', ''], ['register_entries', 'WHERE elected_body = ?1']],
  'cards.PERSONS.partyFilter': [[['?1', '?2']]],
  'graph.GRAPH.search': [[0, 200], [2, 50]],
  'graph.GRAPH.browseKeys': [[1], [3]],
  'graph.GRAPH_FILES.valuesByKey': ['entity', 'summary', 'search', 'browse', 'slug', 'statements-by-subject', 'reverse-entity-value', 'source-statements'].map((name) => [name]),
  'cards.SHARDS.page': [['person_cards'], ['sources'], ['register_entries']],
  'maps.MAPS.headParts': [['catalogue_parts'], ['layer_parts']],
  'maps.MAPS.headOrds': [['catalogue_parts'], ['layer_parts']],
  'elections.ELECTION_CARDS.bodyFilter': [[['?1'], ['?2']]],
  'elections.ELECTION_CARDS.decadeFilter': [[['?1', '?2']]],
  'elections.ELECTION_CARDS.wordFilter': [['?1']],
  'elections.ELECTION_CARDS.list': [['WHERE list_card IS NOT NULL', ''], ['WHERE decade IN (?1) AND list_card IS NOT NULL', ' LIMIT 50 OFFSET 0']],
  'elections.ELECTION_CARDS.listCount': [['WHERE list_card IS NOT NULL']],
};

/** Builders that return a clause, not a statement: prepared inside this statement. */
const FRAGMENTS = {
  'elections.ELECTION_CARDS.bodyFilter': 'SELECT 1 FROM election_cards WHERE ',
  'elections.ELECTION_CARDS.decadeFilter': 'SELECT 1 FROM election_cards WHERE ',
  'elections.ELECTION_CARDS.wordFilter': 'SELECT 1 FROM election_cards WHERE ',
  'cards.PERSONS.partyFilter': 'SELECT 1 FROM person_cards WHERE ',
};

/**
 * The SQLite-only features the named queries use, each with a pattern. The test computes the set
 * from the queries and compares it with this list both ways.
 */
const DIALECT = {
  'numbered parameters (?1)': /\?\d/,
  'json_each()': /\bjson_each\s*\(/i,
  'json_extract()': /\bjson_extract\s*\(/i,
  'json_group_array()': /\bjson_group_array\s*\(/i,
  'json_object()': /\bjson_object\s*\(/i,
  'COLLATE NOCASE': /\bCOLLATE\s+NOCASE\b/i,
  'GLOB': /\bGLOB\b/,
  'instr()': /\binstr\s*\(/i,
  'printf()': /\bprintf\s*\(/i,
  'group_concat()': /\bgroup_concat\s*\(/i,
  'rowid': /\browid\b/i,
  'FTS MATCH': /\bMATCH\b/,
  'INSERT OR': /\bINSERT\s+OR\b/i,
  'LIMIT/OFFSET': /\bOFFSET\b/i,
};
/** What the queries use today (keep sorted). */
const DIALECT_USED = [
  'LIMIT/OFFSET',
  'json_each()',
  'json_extract()',
  'numbered parameters (?1)',
];

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
};
const rel = (file) => path.relative(FUNCTIONS, file).split(path.sep).join('/');

async function namedQueries() {
  /** @type {{ name: string, sql: string }[]} */
  const queries = [];
  const missingSamples = [];
  // tables.js holds table names, not queries
  for (const file of readdirSync(QUERIES).filter((f) => f.endsWith('.js') && f !== 'tables.js').sort()) {
    const mod = await import(pathToFileURL(path.join(QUERIES, file)).href);
    const base = file.replace(/\.js$/, '');
    for (const [group, value] of Object.entries(mod)) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.isFrozen(value)) continue;
      for (const [name, query] of Object.entries(value)) {
        const id = `${base}.${group}.${name}`;
        if (typeof query === 'string') queries.push({ name: id, sql: query });
        else if (typeof query === 'function') {
          const samples = BUILDER_SAMPLES[id];
          if (!samples) { missingSamples.push(id); continue; }
          samples.forEach((args, i) => queries.push({ name: `${id}#${i}`, sql: (FRAGMENTS[id] || '') + query(...args) }));
        }
      }
    }
  }
  return { queries, missingSamples };
}

test('only functions/_lib/storage/ calls the D1 engine API (the files not yet moved are pinned)', () => {
  const engine = /\.(prepare|batch|withSession)\s*\(/;
  const calling = walk(FUNCTIONS)
    .filter((f) => !rel(f).startsWith('_lib/storage/'))
    .filter((f) => engine.test(readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')))
    .map(rel)
    .sort();
  assert.deepEqual(calling, [...NOT_YET_ON_THE_ADAPTER].sort(),
    'a file left the list (remove it from NOT_YET_ON_THE_ADAPTER) or a new one calls D1 directly (use the RecordStore and a named query)');
});

test('every query builder has sample arguments', async () => {
  const { missingSamples } = await namedQueries();
  assert.deepEqual(missingSamples, [], 'add samples to BUILDER_SAMPLES');
});

test('the named queries use exactly the listed SQLite-only features', async () => {
  const { queries } = await namedQueries();
  assert.ok(queries.length > 0);
  const used = Object.entries(DIALECT).filter(([, re]) => queries.some((q) => re.test(q.sql))).map(([name]) => name).sort();
  assert.deepEqual(used, [...DIALECT_USED].sort());
});

test('every named query prepares on the records build', { skip: !existsSync(DB) && 'no records build (npm run records:build)' }, async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const { queries } = await namedQueries();
    const failures = [];
    for (const q of queries) {
      try { db.prepare(q.sql); } catch (error) { failures.push(`${q.name}: ${error.message}`); }
    }
    assert.deepEqual(failures, []);
  } finally {
    db.close();
  }
});
