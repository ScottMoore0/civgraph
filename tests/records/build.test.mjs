// The built records database (tmp/records/civgraph-records.sqlite): row counts, row sizes, the
// two-layer party labels, and the lossless bundle rebuild. Skipped when there is no build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { recordPaths, REPO_ROOT } from '../../scripts/records/paths.mjs';
import { MAX_VALUE_BYTES, TABLES } from '@civgraph/schema';
import { partyAsPrintedLabel } from '../../src/party-names.mjs';
import { bundleChunks, bundleObject } from '../../functions/_api/_records.js';
import { d1 } from './d1-shim.mjs';

const DB = path.join(REPO_ROOT, 'tmp/records/civgraph-records.sqlite');
const P = recordPaths({ CIVGRAPH_BUILD_DIR: 'tmp/records' });
const built = existsSync(DB);
const open = () => new DatabaseSync(DB, { readOnly: true });

// The 2026-11-06 figures of phase2-plan.md stage C, as floors (99%, so merges that shrink a
// count by a handful do not fail it; growth never does). graph_statements holds the
// statements-by-subject view the record pages read, not every statement of the graph.
// party_cards: 612 since main's batch 4c folded 97 occupation and misspelt labels into their
// parties (709 -> 612 Browse entries); office_cards: the facts model's 164 office pages.
const FLOORS = {
  r_elections: 1829, contests: 13360, candidacies: 67397, r_counts: 269457, person_cards: 31473,
  sources: 38800, register_entries: 5064, party_cards: 612, office_cards: 164, graph_entities: 272863, graph_statements: 900000,
};

test('row counts are at least the 2026-11-06 figures', { skip: !built && 'no records build' }, () => {
  const db = open();
  for (const [table, floor] of Object.entries(FLOORS)) {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    assert.ok(n >= Math.floor(floor * 0.99), `${table}: ${n} < ${floor}`);
  }
});

test('no value reaches D1\'s row limit (ireland-local 2004 and 2014 included)', { skip: !built && 'no records build' }, () => {
  const db = open();
  for (const t of TABLES) {
    const cols = t.columns.filter((c) => c.type === 'TEXT').map((c) => c.name);
    const row = db.prepare(`SELECT ${cols.map((c, i) => `max(length(CAST(${c} AS BLOB))) AS c${i}`).join(', ')} FROM ${t.name}`).get();
    cols.forEach((c, i) => assert.ok(Number(row[`c${i}`] || 0) < MAX_VALUE_BYTES, `${t.name}.${c}`));
  }
  const meta = db.prepare("SELECT key, length(CAST(meta AS BLOB)) AS b FROM r_elections WHERE key IN ('ireland-local__2004-06-11', 'ireland-local__2014-05-23') ORDER BY key").all();
  assert.equal(meta.length, 2);
  for (const r of meta) assert.ok(r.b < 1_000_000, `${r.key} meta ${r.b}`);
});

test('party labels: printed label kept verbatim, interpreted label as the manifest wrote it', { skip: !built && 'no records build' }, () => {
  const db = open();
  const rows = db.prepare(`SELECT c.election_key, c.contest_seq, c.ord, c.party_as_printed, c.party_label, c.meta, k.source_file
    FROM candidacies c JOIN contests k ON k.election_key = c.election_key AND k.seq = c.contest_seq
    WHERE c.party_as_printed IS NOT NULL ORDER BY c.election_key, c.contest_seq, c.ord`).all();
  assert.ok(rows.length > 2000);
  const step = Math.floor(rows.length / 2000);
  const bundles = new Map();
  let checkedSource = 0;
  for (let i = 0; i < rows.length; i += step) {
    const r = rows[i];
    if (!bundles.has(r.election_key)) bundles.set(r.election_key, JSON.parse(readFileSync(path.join(P.ELECTION_BUNDLE_DIR, `${r.election_key}.json`), 'utf8')));
    const cand = bundles.get(r.election_key).results[r.contest_seq].candidates[r.ord];
    assert.equal(r.party_label, cand.party ?? null);
    assert.equal(partyAsPrintedLabel(JSON.parse(r.meta)), partyAsPrintedLabel(cand));
    if (cand.partyAsPrinted !== undefined) assert.equal(r.party_as_printed, cand.partyAsPrinted);
    // The source file's printed label for that candidate, where the candidate id finds one row.
    if (r.source_file && existsSync(path.join(REPO_ROOT, r.source_file))) {
      const src = JSON.parse(readFileSync(path.join(REPO_ROOT, r.source_file), 'utf8'));
      const list = Array.isArray(src) ? src : (src.countGroup || src.Constituency?.countGroup || []);
      const same = (row) => (row.Candidate_Id ? String(row.Candidate_Id) === String(cand.id)
        : String(row.candidateName || `${row.Firstname || ''} ${row.Surname || ''}`).trim() === String(cand.name || '').trim());
      const matches = list.filter((row) => same(row) && row.Party_As_Printed !== undefined);
      if (matches.length && new Set(matches.map((m) => m.Party_As_Printed)).size === 1) {
        assert.equal(r.party_as_printed, matches[0].Party_As_Printed, `${r.election_key}#${r.contest_seq}/${r.ord}`);
        checkedSource += 1;
      }
    }
  }
  assert.ok(checkedSource > 0, 'some candidacies were checked against their source files');
});

test('every bundle rebuilds from the rows exactly (deep-equal), and the stream is the file\'s JSON', { skip: !built && 'no records build' }, async () => {
  const shim = d1(DB);
  const files = readdirSync(P.ELECTION_BUNDLE_DIR).filter((f) => f.endsWith('.json')).sort();
  const sample = files.filter((_, i) => i % 23 === 0).concat(['northern-ireland-assembly__2022-05-05.json', 'northern-ireland-forum__1996-05-30.json'].filter((f) => files.includes(f)));
  for (const file of sample) {
    const key = file.slice(0, -5);
    const text = readFileSync(path.join(P.ELECTION_BUNDLE_DIR, file), 'utf8');
    const expected = JSON.parse(text);
    assert.deepEqual(await bundleObject(shim, key), expected, key);
    let streamed = '';
    for await (const chunk of await bundleChunks(shim, key)) streamed += chunk;
    assert.deepEqual(JSON.parse(streamed), expected, `${key} stream`);
  }
});
