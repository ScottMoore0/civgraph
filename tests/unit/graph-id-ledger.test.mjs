// The ledger of published graph ids (scripts/lib/graph-id-ledger.mjs): it only grows; an id the
// graph no longer has answers with the entity it became (a contest or election through the
// retired-slug tables, a person through the person-id merges); the check names every id that
// stops answering; and /_api/graph?entity=<retired id> answers with the entity, naming the id
// asked for. The committed ledger is compared with main's: no entry may leave it or change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GRAPH_LEDGER_FILE, LEDGER_TYPES, emptyGraphLedger, graphEntityAliases, graphLedgerFailures, graphLedgerText, growGraphLedger,
  ledgerEntries, ledgerType, personNumber, publishedGraphFromRows, readGraphLedger, retiredSlugPairs,
} from '../../scripts/lib/graph-id-ledger.mjs';
import { makeEntityId } from '../../scripts/lib/graph-entity-id.mjs';
import { RETIRED_CONTEST_SLUGS, resolveElectionSlugAlias } from '../../packages/core/src/election-slug-aliases.js';
import { openSqlite } from '../../packages/storage/src/sqlite.mjs';
import { toD1 } from '../../packages/storage/src/store.js';
import { context, installCaches } from '../records/d1-shim.mjs';
import { resetDatasetMemo } from '../../packages/api/src/handlers/_records.js';
import * as graphApi from '../../packages/api/src/handlers/graph/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REL = path.relative(ROOT, GRAPH_LEDGER_FILE).split(path.sep).join('/');

const CLUE = 'castlederg-rural-district-council-1936-06-03-clue';
const CLARE = 'castlederg-rural-district-council-1936-06-03-clare';
const KEY = 'castlederg-rural-district-council__1936-06-03';
const contestId = (/** @type {string} */ slug) => makeEntityId('contest', `${KEY}::${slug}`);

/** A small built graph: the renamed division (Clare), a person kept, a person renamed. */
const LIVE = [
  { id: contestId(CLARE), browseSlug: CLARE, electionKey: KEY },
  { id: `cg:election:${CLARE}`, browseSlug: CLARE },
  { id: 'cg:election:castlederg-rural-district-council-1936-06-03', browseSlug: 'castlederg-rural-district-council-1936-06-03' },
  { id: 'cg:person:dawson-bates-104451', browseSlug: 'dawson-bates-104451' },
  { id: 'cg:person:hon-c-lowry-corry-153159', browseSlug: 'hon-c-lowry-corry-153159' },
  { id: 'cg:party:uup' },
];
const KEEP_OF = new Map([['104999', '104451']]);

test('ledger types and person numbers', () => {
  assert.deepEqual([...LEDGER_TYPES], ['contest', 'election', 'person']);
  assert.equal(ledgerType('cg:contest:x'), 'contest');
  assert.equal(ledgerType('cg:party:uup'), null);
  assert.equal(ledgerType('cg:candidature:x'), null);
  assert.equal(personNumber('dawson-bates-104451'), '104451');
  assert.equal(personNumber('brownfield'), null);
});

test('the ledger only grows: tracked types only, a slug equal to the id stored as "=", nothing changed', () => {
  const first = growGraphLedger(emptyGraphLedger(), LIVE);
  assert.equal(first.added, 5);
  assert.equal(first.ledger.ids.person['dawson-bates-104451'], '=');
  assert.equal(first.ledger.ids.contest[contestId(CLARE).slice('cg:contest:'.length)], CLARE);
  const again = growGraphLedger(first.ledger, [{ id: 'cg:person:dawson-bates-104451', browseSlug: 'other' }, { id: 'cg:person:x-1' }]);
  assert.equal(again.added, 1);
  assert.equal(again.ledger.ids.person['dawson-bates-104451'], '=');
  assert.equal(again.ledger.ids.person['x-1'], '');
  assert.equal(first.ledger.ids.person['x-1'], undefined, 'the ledger passed in is not changed');
  assert.deepEqual(ledgerEntries(again.ledger).find(([id]) => id === 'cg:person:dawson-bates-104451'), ['cg:person:dawson-bates-104451', 'dawson-bates-104451']);
});

test('a renamed contest, a merged person and a renamed person answer with the entity they became', () => {
  const ledger = growGraphLedger(emptyGraphLedger(), [
    ...LIVE,
    { id: contestId(CLUE), browseSlug: CLUE, electionKey: KEY },
    { id: `cg:election:${CLUE}`, browseSlug: CLUE },
    { id: 'cg:person:sir-dawson-bates-104999', browseSlug: 'sir-dawson-bates-104999' },
    { id: 'cg:person:hon-c-l-corry-153159', browseSlug: 'hon-c-l-corry-153159' },
    { id: 'cg:person:gone-140362', browseSlug: 'gone-140362' },
  ]).ledger;
  const aliases = graphEntityAliases(ledger, LIVE, { keepOf: KEEP_OF });
  assert.equal(aliases.ids[contestId(CLUE)], contestId(CLARE));
  assert.equal(aliases.ids[`cg:election:${CLUE}`], `cg:election:${CLARE}`);
  assert.equal(aliases.ids['cg:person:sir-dawson-bates-104999'], 'cg:person:dawson-bates-104451');
  assert.equal(aliases.ids['cg:person:hon-c-l-corry-153159'], 'cg:person:hon-c-lowry-corry-153159');
  assert.equal(aliases.slugs[CLUE], contestId(CLARE), 'the old readable slug answers too');
  assert.equal(aliases.slugs['sir-dawson-bates-104999'], 'cg:person:dawson-bates-104451');
  assert.deepEqual(aliases.unresolved, ['cg:person:gone-140362']);
  assert.equal(aliases.ids['cg:person:dawson-bates-104451'], undefined, 'a live id is never aliased');

  const liveIds = new Set(LIVE.map((e) => e.id));
  assert.deepEqual(graphLedgerFailures(ledger, { liveIds, aliasOf: new Map(Object.entries(aliases.ids)) }), [
    'cg:person:gone-140362: no longer in the graph and no alias answers it',
  ]);
  const broken = new Map([[contestId(CLUE), 'cg:contest:nowhere']]);
  assert.ok(graphLedgerFailures(ledger, { liveIds, aliasOf: broken }).includes(`${contestId(CLUE)}: its alias cg:contest:nowhere is not in the graph`));
});

test('a retired contest that is now its round\'s page answers with the round', () => {
  const old = 'castlederg-rural-district-council-1936-06-03-gone';
  const ledger = growGraphLedger(emptyGraphLedger(), [{ id: contestId(old), browseSlug: old, electionKey: KEY }]).ledger;
  const aliases = graphEntityAliases(ledger, LIVE, { keepOf: KEEP_OF, resolveSlug: (s) => (s === old ? 'castlederg-rural-district-council-1936-06-03' : s), retiredContestSlugs: [] });
  assert.equal(aliases.ids[contestId(old)], 'cg:election:castlederg-rural-district-council-1936-06-03');
});

test('ids a retired slug had before the ledger began are worked out from the slug tables', () => {
  const aliases = graphEntityAliases(emptyGraphLedger(), LIVE, { keepOf: KEEP_OF });
  assert.equal(aliases.ids[`cg:election:${CLUE}`], `cg:election:${CLARE}`, 'the election id of the old slug');
  assert.equal(aliases.ids[contestId(CLUE)], contestId(CLARE), 'the contest id of the old slug, with the live contest\'s election key');
  assert.deepEqual(aliases.unresolved, []);
  // A renamed body's prefix rule: every live slug it continues has its old form.
  const pairs = retiredSlugPairs(['bangor-borough-council-1920-01-15-ward-1', 'other'], { retiredContestSlugs: [] });
  assert.deepEqual(pairs.filter(([from]) => from.startsWith('bangor-urban')), [['bangor-urban-district-council-1920-01-15-ward-1', 'bangor-borough-council-1920-01-15-ward-1']]);
  // Every retired contest slug of the table names its live entity (graph-side, the same resolution as Browse).
  for (const [from, to] of RETIRED_CONTEST_SLUGS) assert.equal(resolveElectionSlugAlias(from), to);
  assert.equal(resolveElectionSlugAlias('north-down-rural-district-council-1964-06-04-ards-peninsula'), 'north-down-rural-district-council-1964-06-04-quintin');
});

test('a records build\'s rows read back as the graph the check needs', () => {
  const read = publishedGraphFromRows(
    [{ entity_id: 'cg:contest:a', entity: JSON.stringify({ id: 'cg:contest:a', browseSlug: 'a-b', attributes: { electionKey: 'k' } }) }],
    [{ browse_key: 'alias:cg:contest:old', entity_id: 'cg:contest:a' }],
  );
  assert.deepEqual(read.entities, [{ id: 'cg:contest:a', browseSlug: 'a-b', electionKey: 'k' }]);
  assert.deepEqual([...read.aliasOf], [['cg:contest:old', 'cg:contest:a']]);
  assert.ok(read.liveIds.has('cg:contest:a'));
});

test('the ledger file text: one entry per line, sorted, read back the same', () => {
  const ledger = growGraphLedger({ ...emptyGraphLedger(), description: 'd' }, [{ id: 'cg:person:b-2', browseSlug: 'b-2' }, { id: 'cg:contest:z', browseSlug: 'y' }]).ledger;
  const text = graphLedgerText(ledger);
  assert.deepEqual(JSON.parse(text), { schemaVersion: 1, description: 'd', ids: { contest: { z: 'y' }, election: {}, person: { 'b-2': '=' } } });
  assert.match(text, /\n {6}"b-2": "="\n/);
});

test('/_api/graph?entity=<retired id> answers with the entity it became and names the id asked for', async () => {
  const store = openSqlite(':memory:');
  await store.exec(`CREATE TABLE graph_entities (entity_id TEXT PRIMARY KEY, summary TEXT);
    CREATE TABLE graph_statements (subject_id TEXT, ord INTEGER, statement TEXT);
    CREATE TABLE graph_reverse (entity_id TEXT, ord INTEGER, item TEXT);
    CREATE TABLE graph_source_statements (source_id TEXT, ord INTEGER, item TEXT);
    CREATE TABLE graph_browse_keys (browse_key TEXT PRIMARY KEY, entity_id TEXT);
    INSERT INTO graph_entities VALUES ('${contestId(CLARE)}', '{"label":"Clare"}');
    INSERT INTO graph_statements VALUES ('${contestId(CLARE)}', 0, '{"id":"s1","propertyId":"p","propertyLabel":"P","valueType":"string"}');
    INSERT INTO graph_browse_keys VALUES ('alias:${contestId(CLUE)}', '${contestId(CLARE)}'), ('slug:${CLUE}', '${contestId(CLARE)}');`);
  const env = { ELECTIONS_DB: toD1(store) };
  const ask = async (/** @type {string} */ query) => {
    installCaches();
    resetDatasetMemo();
    const res = await graphApi.onRequestGet(context(`/_api/graph?${query}`, env));
    assert.equal(res.status, 200, query);
    return JSON.parse(await res.text());
  };
  try {
    const live = await ask(`entity=${encodeURIComponent(contestId(CLARE))}`);
    assert.deepEqual({ ...live, statements: live.statements.length }, { entityId: contestId(CLARE), summary: { label: 'Clare' }, statements: 1, total: 1 });
    const retired = await ask(`entity=${encodeURIComponent(contestId(CLUE))}&related=1`);
    assert.equal(retired.entityId, contestId(CLARE));
    assert.equal(retired.retiredId, contestId(CLUE));
    assert.deepEqual(retired.summary, { label: 'Clare' });
    assert.equal(retired.total, 1);
    assert.deepEqual([retired.reverse, retired.sourceStatements], [[], []]);
    const bySlug = await ask(`slug=${CLUE}`);
    assert.equal(bySlug.entityId, contestId(CLARE));
    const unknown = await ask('entity=cg:contest:never');
    assert.deepEqual(unknown, { entityId: 'cg:contest:never', summary: null, statements: [], total: 0 });
  } finally {
    await store.close();
  }
});

/** @returns {import('../../scripts/lib/graph-id-ledger.mjs').GraphLedger | null} */
function ledgerOnMain() {
  for (const ref of [process.env.ARCH_BASELINE_REF, 'main', 'origin/main'].filter(Boolean)) {
    try {
      return JSON.parse(execFileSync('git', ['show', `${ref}:${REL}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 }));
    } catch { /* next ref */ }
  }
  return null;
}

test('the committed ledger: well formed, and nothing of main\'s ledger left or changed', (t) => {
  const ledger = readGraphLedger();
  assert.equal(ledger.schemaVersion, 1);
  for (const type of LEDGER_TYPES) {
    const keys = Object.keys(ledger.ids[type]);
    assert.ok(keys.length > 0, `${type} ids`);
    assert.deepEqual(keys, [...keys].sort(), `${type} ids sorted`);
    for (const [rest, slug] of Object.entries(ledger.ids[type])) {
      assert.match(rest, /^[a-z0-9][a-z0-9-]*$/, `cg:${type}:${rest}`);
      assert.equal(typeof slug, 'string');
    }
  }
  const main = ledgerOnMain();
  if (!main) { t.diagnostic(`no committed ${REL} on main: nothing to compare with yet`); return; }
  for (const type of LEDGER_TYPES) {
    for (const [rest, slug] of Object.entries(main.ids?.[type] || {})) assert.equal(ledger.ids[type][rest], slug, `cg:${type}:${rest} stays in the ledger`);
  }
});
