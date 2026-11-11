// New person ids start above every id ever issued (scripts/ingest/persons/person_id_issued.py).
// On 11 Nov 2026 the lifespans re-stamp gave 12 new people ids from 149598, the number after the
// highest live id, but 149598 and six more of those numbers were drop ids of earlier merges, served
// by D1's person_aliases as 301 redirects (149598 -> Roy Beggs, 68301). A new person must never
// take an address that used to mean someone else.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const REPO = new URL('../..', import.meta.url);

function runPython(t, code) {
  const python = process.env.CIVGRAPH_PYTHON || 'python';
  const res = spawnSync(python, ['-c', code], { encoding: 'utf8', cwd: REPO });
  if (res.error) {
    t.skip(`no python (${res.error.message})`);
    return null;
  }
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout.trim().split('\n').pop());
}

function highWater(t, registry, logs) {
  const dir = mkdtempSync(join(tmpdir(), 'person-id-issued-'));
  try {
    const regPath = join(dir, 'registry.json');
    writeFileSync(regPath, JSON.stringify(registry));
    const logPaths = Object.entries(logs).map(([name, text]) => {
      const p = join(dir, name);
      writeFileSync(p, text);
      return p;
    });
    logPaths.push(join(dir, 'missing.csv'));
    const code = [
      'import json, runpy',
      "m = runpy.run_path('scripts/ingest/persons/person_id_issued.py')",
      `reg = json.load(open(${JSON.stringify(regPath)}, encoding='utf-8'))`,
      `print(json.dumps(m['issued_high_water'](reg, ${JSON.stringify(logPaths)})))`,
    ].join('\n');
    return runPython(t, code);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the high-water mark counts live ids, mergedFrom, both merge logs and the recorded mark', (t) => {
  const entities = [
    { personId: 100, keyedBy: 'id' },
    { personId: 149597, keyedBy: 'src', mergedFrom: [149620] },
    { personId: 900081, keyedBy: 'registered' },
  ];
  // Live ids only.
  assert.equal(highWater(t, { entities: entities.slice(0, 1) }, {}), 100);
  // A survivor's mergedFrom counts.
  assert.equal(highWater(t, { entities }, {}), 149620);
  // A drop id in the merge log counts (the Roy Beggs case: 149598 was a redirect, 149714 the highest).
  const log = 'class,keep,drop,name\nWIKIPEDIA-BIOGRAPHY,68301,149598,Roy Beggs\nFORUM-DUPLICATE,149604,149714,Natural Law list\n';
  assert.equal(highWater(t, { entities }, { 'person_id_merges.csv': log }), 149714);
  // So does a keep id, and the confirmed-merges log.
  const confirmed = 'keep,drop,name\n149800,59262,X\n';
  assert.equal(highWater(t, { entities }, { 'person_id_merges.csv': log, 'person_id_confirmed_merges.csv': confirmed }), 149800);
  // The recorded mark outlives the merge log rows it came from.
  assert.equal(highWater(t, { idHighWater: 149900, entities }, {}), 149900);
  // Registered non-candidates (900001+) are a block of their own and never raise the mark.
  assert.equal(highWater(t, { entities: [{ personId: 900081, keyedBy: 'registered' }] }, {}), 0);
  assert.equal(highWater(t, { entities: [{ personId: 5, keyedBy: 'id', mergedFrom: [900005] }] }, { 'l.csv': 'keep,drop\n900001,900002\n,\n' }), 5);
  // Nothing at all.
  assert.equal(highWater(t, null, {}), 0);
});

test('the registry build allocates from the high-water mark and records it', () => {
  const src = readFileSync(new URL('scripts/ingest/persons/build_person_registry_v2.py', REPO), 'utf8');
  assert.match(src, /next_id = max\(next_id, prev_max \+ 1, issued \+ 1\)/);
  assert.match(src, /person_id_issued\.issued_high_water\(old_reg, \[/);
  assert.match(src, /'idHighWater': next_id - 1,/);
});

// person_id_confirmed_merges.csv is left out of the first check: its keep and drop columns are
// the ids when each pair was confirmed, and merge_person_ids.py re-finds the pair by keep_keys and
// drop_keys, so a few of its drop ids (47167, 25276, ...) are live people today.
test('the committed registry: no live person holds an id the merge log gave away, and the mark covers every id', (t) => {
  const pers = new URL('data/elections/persons/', REPO);
  const reg = JSON.parse(readFileSync(new URL('person_registry.json', pers), 'utf8'));
  const drops = new Set();
  for (const file of ['person_id_merges.csv']) {
    const lines = readFileSync(new URL(file, pers), 'utf8').split(/\r?\n/).filter(Boolean);
    const head = lines[0].split(',');
    const di = head.indexOf('drop');
    for (const line of lines.slice(1)) drops.add(line.split(',')[di]);
  }
  const live = reg.entities.filter((e) => e.keyedBy !== 'registered');
  const reused = live.filter((e) => drops.has(String(e.personId))).map((e) => e.personId);
  assert.deepEqual(reused, [], 'live person ids that are also merged-away ids');
  const hw = highWater(t, reg, {});
  if (hw === null) return;
  assert.ok(typeof reg.idHighWater === 'number', 'the registry records idHighWater');
  assert.equal(reg.idHighWater, hw, 'idHighWater is the highest id the registry knows');
});
