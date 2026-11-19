// Two men the papers tell apart stay two (scripts/ingest/persons/kept_apart.py, stream w19-overmerge,
// owner decision 6 of 19 Nov 2026): a group or person holding one of a row's keys_a in
// data/elections/persons/person_id_kept_apart.csv is never joined to one holding one of its keys_b,
// by the registry's name join, a prior join, or any class of merge_person_ids.py.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const REPO = new URL('../..', import.meta.url);

function runPython(t, code) {
  const res = spawnSync(process.env.CIVGRAPH_PYTHON || 'python', ['-c', code], { encoding: 'utf8', cwd: REPO });
  if (res.error) {
    t.skip(`no python (${res.error.message})`);
    return null;
  }
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout.trim().split('\n').pop());
}

const PRELUDE = 'import sys, json; sys.path.insert(0, "scripts/ingest/persons"); import kept_apart as k';

test('PKA-01 a rule keeps apart a side holding a keys_a key and one holding a keys_b key, either way round, and nothing else', (t) => {
  const out = runPython(t, [
    PRELUDE,
    "rules = [(frozenset({'J. Sharkey|'}), frozenset({'60569'})), (frozenset({'W. Baird|UUP|Lurgan'}), frozenset({'William Baird|UUP', 'W. Baird|UUP'}))]",
    'print(json.dumps([',
    "  k.apart(rules, {'J. Sharkey|', 'John Sharkey|NI Labour'}, {'60569'}),",
    "  k.apart(rules, {'60569'}, {'J. Sharkey|'}),",
    "  k.apart(rules, {'William Baird|UUP'}, {'W. Baird|UUP|Lurgan'}),",
    "  k.apart(rules, {'William Baird|UUP'}, {'W. Baird|UUP'}),",
    "  k.apart(rules, {'J. Sharkey|'}, {'J. Sharkey||Omagh'}),",
    "  k.apart([], {'J. Sharkey|'}, {'60569'}),",
    "  k.apart(rules, set(), {'60569'}),",
    ']))',
  ].join('\n'));
  if (out) assert.deepEqual(out, [true, true, true, false, false, false, false]);
});

test('PKA-02 the file is read with each side split on " ; "; a missing file or a row with an empty side keeps nothing apart', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pka-'));
  try {
    const path = join(dir, 'kept.csv');
    writeFileSync(path, 'keys_a,keys_b,name,evidence\n'
      + 'W. Baird|UUP|Lurgan,William Baird|UUP ; W. Baird|UUP,William Baird,"same day, two councils"\n'
      + 'X|,,Nobody,empty side\n');
    const out = runPython(t, [
      PRELUDE,
      `rules = k.load(${JSON.stringify(path)})`,
      `none = k.load(${JSON.stringify(join(dir, 'absent.csv'))})`,
      'print(json.dumps([len(rules), sorted(rules[0][1]), none,',
      "  sorted(k.group_keys([{'id': 'A|', 'src': ''}, {'id': '', 'src': 'ei:1'}, {'id': 'A|', 'src': 'ei:1'}]))]))",
    ].join('\n'));
    if (out) assert.deepEqual(out, [1, ['W. Baird|UUP', 'William Baird|UUP'], [], ['A|', 'ei:1']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
