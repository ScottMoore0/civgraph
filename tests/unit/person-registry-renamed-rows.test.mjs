// Rows imported with a placeholder for a name and named later (data/elections/persons/
// unnamed-candidacies.csv) bring no prior join with them (build_person_registry_v2.py,
// named_after_import). While they were all "Party", the merge pass joined rows of one seat and party
// at consecutive elections, and the registry kept those joins after the rows were named: Maurice
// Devenney (Faughan 2014) and Graham Warke (Faughan 2019) were one person, 104872, until 11 Nov 2026.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const REPO = new URL('../..', import.meta.url);
const PERSONS = new URL('data/elections/persons/', REPO);

function csvIds(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const col = head.split(',').indexOf('candidate_id');
  return lines.map((line) => line.split(',')[col].trim()).filter(Boolean);
}

test('named_after_import reads every candidate id of unnamed-candidacies.csv', (t) => {
  const python = process.env.CIVGRAPH_PYTHON || 'python';
  const code = [
    'import json, runpy, sys',
    "sys.path.insert(0, 'scripts/ingest/persons')",
    "m = runpy.run_path('scripts/ingest/persons/build_person_registry_v2.py', run_name='not_main')",
    "print(json.dumps(sorted(m['named_after_import']())))",
  ].join('\n');
  const res = spawnSync(python, ['-c', code], { encoding: 'utf8', cwd: REPO });
  if (res.error) return t.skip(`no python (${res.error.message})`);
  assert.equal(res.status, 0, res.stderr);
  const got = JSON.parse(res.stdout.trim().split('\n').pop());
  const want = [...new Set(csvIds(readFileSync(new URL('unnamed-candidacies.csv', PERSONS), 'utf8')))].sort();
  assert.deepEqual(got, want);
  for (const id of ['248745875', '2670978434', '3726074818', '2097177719', '4167042036', '647289425']) {
    assert.ok(got.includes(id), id);
  }
});

test('the three placeholder-name joins stay undone, and each id kept the name its page showed', () => {
  const reg = JSON.parse(readFileSync(new URL('person_registry.json', PERSONS), 'utf8'));
  const bySource = new Map();
  for (const e of reg.entities) for (const s of e.sourceIds || []) bySource.set(s, e);
  // [2014 row, 2019 row, the id the pair shared, the name that id keeps]
  const pairs = [
    ['248745875', '2670978434', 104872, 'Maurice Devenney'],
    ['3726074818', '2097177719', 104746, 'Carl McClean'],
    ['4167042036', '647289425', 115524, 'William McCandless'],
  ];
  for (const [a, b, shared, keeps] of pairs) {
    const ea = bySource.get(a);
    const eb = bySource.get(b);
    assert.ok(ea && eb, `${a} and ${b} are both stamped`);
    assert.notEqual(ea.personId, eb.personId, `${a} and ${b} are two people`);
    // The id either is still live with the person it named, or was merged into that person's
    // fuller career (a redirect to the same man).
    const holder = reg.entities.find((e) => e.personId === shared || (e.mergedFrom || []).includes(shared));
    assert.ok(holder, `${shared} is live or a redirect`);
    assert.ok((holder.matchKeys || []).includes(keeps.toLowerCase()), `${shared} stays with ${keeps}`);
    assert.ok(!(holder.aliases || []).some((n) => n !== keeps && [ea, eb].some((e) => e !== holder && (e.aliases || []).includes(n))),
      `${shared} no longer carries the other person's name`);
  }
});
