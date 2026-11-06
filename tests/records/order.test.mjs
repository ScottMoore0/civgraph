// Row order never depends on rowids (data design 4.3). A delta load reorders rowids, and SQLite
// promises no order without ORDER BY, so:
//   1. a second database is built with every table's rows inserted in REVERSE primary-key order,
//      and every list route must answer byte-identically from both;
//   2. no Function issues a multi-row read without ORDER BY, unless the line says why
//      (an "order-free:" comment: a keyed read into a Map).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REPO_ROOT } from '../../scripts/records/paths.mjs';
import { createDatabase } from '../../scripts/records/db.mjs';
import { TABLES } from '../../scripts/records/schema.mjs';
import { buildHasVotes, context, d1, installCaches } from './d1-shim.mjs';
import { resetDatasetMemo } from '../../functions/_api/_records.js';
import * as elections from '../../functions/_api/elections/index.js';
import * as persons from '../../functions/_api/persons/index.js';
import * as sources from '../../functions/_api/sources/index.js';
import * as register from '../../functions/_api/register-interests/index.js';
import * as parties from '../../functions/_api/parties/index.js';
import * as votes from '../../functions/_api/votes/index.js';
import * as graph from '../../functions/_api/graph/index.js';
import * as renderMetadata from '../../functions/render/metadata/[[path]].js';
import * as dataBrowse from '../../functions/data/browse/[[path]].js';
import * as browsePage from '../../functions/_browse-page.js';

const DB = path.join(REPO_ROOT, 'tmp/records/civgraph-records.sqlite');
const REVERSED = path.join(REPO_ROOT, 'tmp/records/civgraph-records.reversed.sqlite');

/** The same rows, inserted last primary key first. Rebuilt when the build is newer. */
function reversedCopy() {
  if (existsSync(REVERSED) && statSync(REVERSED).mtimeMs > statSync(DB).mtimeMs) return REVERSED;
  const db = createDatabase(REVERSED);
  db.exec(`ATTACH DATABASE '${DB.replace(/'/g, "''")}' AS src`);
  db.exec('BEGIN');
  for (const t of TABLES) {
    db.exec(`INSERT INTO ${t.name} SELECT * FROM src.${t.name} ORDER BY ${t.pk.map((c) => `${c} DESC`).join(', ')}`);
  }
  db.exec('COMMIT');
  db.exec('DETACH DATABASE src');
  db.close();
  return REVERSED;
}

const LIST_ROUTES = [
  [elections, '/_api/elections'],
  [elections, '/_api/elections?body=local-government'],
  [elections, '/_api/elections?key=northern-ireland-assembly__2022-05-05'],
  [elections, '/_api/elections?key=northern-ireland-assembly__2022-05-05&format=bundle&lite=1'],
  [elections, '/_api/elections?key=dail-eireann__2024-11-29&format=bundle'],
  [elections, '/_api/elections?key=northern-ireland-assembly__2022-05-05&constituency=3'],
  [elections, '/_api/elections?key=strabane-urban-district-council__1961&constituency=0'],
  [elections, '/_api/elections?view=manifest'],
  [elections, '/_api/elections?view=list'],
  [elections, '/_api/elections?view=list&decade=1920s&limit=40&offset=20'],
  [elections, '/_api/elections?view=record&slug=dail-eireann-2024-11-29-cork-north-central'],
  [persons, '/_api/persons?limit=50'],
  [persons, '/_api/persons?q=martin&limit=50'],
  [persons, '/_api/persons?sort=contests&limit=50'],
  [persons, '/_api/persons?slug=ian-paisley-48601&view=candidacies'],
  [persons, '/_api/persons?slug=48601'],
  [sources, '/_api/sources?limit=60&sort=date'],
  [sources, '/_api/sources?q=gazette&limit=60'],
  [register, '/_api/register-interests?limit=60&sort=memberName'],
  [parties, '/_api/parties'],
  [parties, '/_api/parties?view=names'],
  [votes, '/_api/votes?shard=7'],
  [graph, '/_api/graph?entity=cg:party:uup&related=1'],
  [graph, '/_api/graph?q=belfast'],
];

const BROWSE_FILES = ['parties.json', 'party-names.json', 'elections-list.json', 'election-contest-parents.json', 'person-shards/persons-001.json', 'source-merges.json', 'votes/divisions/011.json'];

async function body(mod, url, env, params = {}) {
  const res = await mod.onRequestGet(context(url, env, params));
  return `${res.status}\n${await res.text()}`;
}

test('every list route answers byte-identically from a reverse-loaded database', { skip: !existsSync(DB) && 'no records build', timeout: 1_800_000 }, async () => {
  const a = { ELECTIONS_DB: d1(DB) };
  const b = { ELECTIONS_DB: d1(reversedCopy()) };
  const votesBuilt = buildHasVotes(DB);
  for (const [mod, url] of LIST_ROUTES.filter(([mod]) => votesBuilt || mod !== votes)) {
    installCaches();
    resetDatasetMemo();
    const x = await body(mod, url, a);
    installCaches();
    resetDatasetMemo();
    const y = await body(mod, url, b);
    assert.ok(x.startsWith('200'), `${url}: ${x.slice(0, 200)}`);
    assert.ok(x === y, `${url} differs between the two load orders`);
  }
  for (const rel of BROWSE_FILES.filter((f) => votesBuilt || !f.startsWith('votes/'))) {
    const params = { path: rel.split('/') };
    installCaches();
    resetDatasetMemo();
    const x = await body(dataBrowse, `/data/browse/${rel}`, a, params);
    installCaches();
    resetDatasetMemo();
    const y = await body(dataBrowse, `/data/browse/${rel}`, b, params);
    assert.ok(x.startsWith('200'), rel);
    assert.ok(x === y, `/data/browse/${rel} differs between the two load orders`);
  }
  for (const rel of ['elections-test2.json', 'elections-test2/dail-eireann__2024-11-29.json']) {
    const params = { path: rel.split('/') };
    installCaches();
    resetDatasetMemo();
    const x = await body(renderMetadata, `/render/metadata/${rel}`, a, params);
    installCaches();
    resetDatasetMemo();
    const y = await body(renderMetadata, `/render/metadata/${rel}`, b, params);
    assert.ok(x === y, `/render/metadata/${rel} differs`);
  }
  for (const [type, slug] of [['elections', 'dail-eireann-2024-11-29-cork-north-central'], ['persons', '48601'], ['parties', 'uup']]) {
    const x = await browsePage.lookupBrowseRecord(a, type, slug);
    const y = await browsePage.lookupBrowseRecord(b, type, slug);
    assert.deepEqual(x, y, `${type}/${slug}`);
  }
});

function functionFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...functionFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no records Function reads several rows without ORDER BY', () => {
  const offenders = [];
  const roots = ['_api/_records.js', '_api/_browse-index.js', '_api/elections', '_api/persons', '_api/sources', '_api/register-interests',
    '_api/parties', '_api/votes', '_api/graph', '_api/stats', '_api/catalogue', '_api/proni', 'render', 'data/browse', 'data/graph', '_browse-page.js', '_templates']
    .map((p) => path.join(REPO_ROOT, 'functions', p));
  const files = roots.flatMap((p) => (existsSync(p) ? (statSync(p).isDirectory() ? functionFiles(p) : [p]) : []));
  // A statement is fine if it orders, returns one row (LIMIT 1, or COUNT without GROUP BY), or
  // carries an "order-free:" comment. A prepare(<identifier>) is judged by every assignment to
  // that identifier in the same file.
  const fine = (sql) => /ORDER BY/i.test(sql) || /LIMIT 1\b/i.test(sql) || (/COUNT\(\*\)/i.test(sql) && !/GROUP BY/i.test(sql));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const re = /\.all\(\)/g;
    let m;
    while ((m = re.exec(text))) {
      const before = text.slice(0, m.index);
      const at = before.lastIndexOf('prepare(');
      if (at < 0) continue;
      const stmt = text.slice(at, m.index);
      const lineNo = before.split('\n').length;
      const context3 = text.slice(Math.max(0, text.lastIndexOf('\n', at - 1) - 400), at);
      if (/order-free:/.test(context3.split('\n').slice(-4).join('\n'))) continue;
      const ident = stmt.match(/^prepare\(\s*([A-Za-z_$][\w$]*)\s*\)/);
      if (ident) {
        const assigns = [...text.matchAll(new RegExp(`\\b${ident[1]}\\s*=\\s*([\\s\\S]{0,700}?);\\s*\\n`, 'g'))].map((a) => a[1]);
        const defs = [...text.matchAll(new RegExp(`const ${ident[1]}\\s*=\\s*([\\s\\S]{0,700}?);\\s*\\n`, 'g'))].map((a) => a[1]);
        const all = [...assigns, ...defs];
        if (all.length && all.every(fine)) continue;
      } else if (fine(stmt)) continue;
      offenders.push(`${path.relative(REPO_ROOT, file)}:${lineNo}`);
    }
  }
  assert.deepEqual(offenders, []);
});
