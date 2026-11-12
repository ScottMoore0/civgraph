// Every person id merged away answers with its survivor: D1's person_merges (and so the
// /browse/persons/<id> redirects) is loaded from the two merge logs, so each id in a survivor's
// mergedFrom must be a drop in one of them. A group merged into two people at once joins those two
// as well (Tracy McElhinney, 2026-11-11: her 2024 row was merged into both her 2009-16 id 110892
// and her 2014-19 id 129522); merge_person_ids.py writes a row for the one so absorbed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const at = (file) => new URL(`../../data/elections/persons/${file}`, import.meta.url);

function drops(file) {
  const [header, ...lines] = readFileSync(at(file), 'utf8').split(/\r?\n/).filter(Boolean);
  const col = header.split(',').indexOf('drop');
  return lines.map((line) => line.split(',')[col]);
}

test('PML-01 every merged-away person id has a row in a merge log', () => {
  const logged = new Set([...drops('person_id_merges.csv'), ...drops('person_id_confirmed_merges.csv')]);
  const { entities } = JSON.parse(readFileSync(at('person_registry.json'), 'utf8'));
  const missing = entities.flatMap((e) => (e.mergedFrom || []).filter((id) => !logged.has(String(id))).map((id) => `${id} -> ${e.personId}`));
  assert.deepEqual(missing, []);
});

test('PML-02 merge_person_ids.py logs the ids a shared group joins', () => {
  const source = readFileSync(new URL('../../scripts/ingest/persons/merge_person_ids.py', import.meta.url), 'utf8');
  assert.match(source, /if side not in named_drops and final\.get\(side, side\) != side:/);
});

// A later pass of the merge loop rewrites the log: the rows of the first pass whose ids are still
// merged away stay in it, under the person who now holds them (w8-merges, 12 Nov 2026).
test('PML-03 a later merge pass keeps the earlier pass rows for ids still merged away', (t) => {
  const code = [
    'import sys, json; sys.path.insert(0, "scripts/ingest/persons")',
    'import merge_person_ids as m',
    "prior = [{'class': 'WIKIPEDIA-BIOGRAPHY', 'keep': '16260', 'drop': '153800', 'name': 'Mark Durkan'},",
    "         {'class': 'LGR-2014', 'keep': '5', 'drop': '6', 'name': 'live again'},",
    "         {'class': 'LGR-2014', 'keep': '5', 'drop': '7', 'name': 'logged this pass'},",
    "         {'class': 'LGR-2014', 'keep': '5', 'drop': '8', 'name': 'gone'}]",
    "ents = {16260: {'mergedFrom': [153800]}, 6: {}, 9: {'mergedFrom': [7]}}",
    "rows = m.carried_rows(prior, [{'class': 'SAME-SEAT-SEQUENCE', 'keep': 9, 'drop': 7}], ents)",
    "print(json.dumps([(r['keep'], r['drop'], r['class']) for r in rows]))",
  ].join('\n');
  const res = spawnSync(process.env.CIVGRAPH_PYTHON || 'python', ['-c', code], { encoding: 'utf8', cwd: new URL('../..', import.meta.url) });
  if (res.error) return t.skip(`no python (${res.error.message})`);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout.trim().split('\n').pop()), [[16260, 153800, 'WIKIPEDIA-BIOGRAPHY']]);
});
