// IrelandElection.com person ids ("ie:") that are ElectionsIreland ones ("ei:"): the crosswalk
// data/elections/persons/ie-ei-crosswalk.csv (scripts/ingest/persons/build_ie_ei_crosswalk.py),
// joined by merge_person_ids.py (class IE-EI-CROSSWALK). Adam Wyse was 151252 for Waterford City
// East in 2019 and 118554 for the same seat in 2014 and 2024 until the crosswalk joined ie:5948 to
// ei:10134. Also the display-name overrides (data/elections/persons/display-names.csv).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const REPO = new URL('../..', import.meta.url);
const at = (file) => new URL(`../../data/elections/persons/${file}`, import.meta.url);

/** A small CSV reader: quoted fields, doubled quotes, no newlines inside a field. */
function parseCsv(text) {
  const [header, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const split = (line) => {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') quoted = false; else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const cols = split(header);
  return lines.map((line) => Object.fromEntries(split(line).map((v, i) => [cols[i], v])));
}

const crosswalk = parseCsv(readFileSync(at('ie-ei-crosswalk.csv'), 'utf8'));
// The four links build_ie_ei_crosswalk.py finds, and the pairs added by hand after both source
// pages were read (c10-merge-leads, owner-approved 12 Nov 2026): IrelandElection.com's person page
// and ElectionsIreland's list one candidacy with the same first preferences. `source-pages-med`
// rests on IrelandElection.com's page alone joining the two records.
const LINKS = new Set(['same-lea', 'successor-lea', 'shared-place', 'county-constituency', 'source-pages', 'source-pages-med']);
const REVIEWED = new Set(['source-pages', 'source-pages-med']);

test('IEX-01 every crosswalk row maps one IrelandElection.com id to one ElectionsIreland id, with its evidence', () => {
  assert.ok(crosswalk.length > 1000, `only ${crosswalk.length} rows`);
  const seen = new Map();
  for (const r of crosswalk) {
    assert.match(r.ie, /^ie:\d+$/, JSON.stringify(r));
    assert.match(r.ei, /^ei:\d+$/, JSON.stringify(r));
    assert.ok(LINKS.has(r.link), `${r.ie}: link ${r.link}`);
    assert.ok(r.ie_evidence && r.ei_evidence, `${r.ie}: evidence missing`);
    assert.match(r.found, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!seen.has(r.ie), `${r.ie} maps to ${seen.get(r.ie)} and ${r.ei}`);
    seen.set(r.ie, r.ei);
  }
});

// A pair found by rule never touches an id with relatives. A pair whose two source pages were read
// may (Enda Kenny, ei:3199, whose father Henry is ei:2525), and the merge pass's relatives veto
// still applies to it: no person ends up holding an id and one of its relatives.
test('IEX-02 no crosswalk pair found by rule touches an ElectionsIreland id its pages give relatives', () => {
  const { persons = {} } = JSON.parse(readFileSync(at('ei-candidate-relatives.json'), 'utf8'));
  const related = new Set(Object.entries(persons).flatMap(([id, p]) => [id, ...Object.keys(p.relatives || {})]));
  assert.deepEqual(crosswalk.filter((r) => !REVIEWED.has(r.link) && related.has(r.ei)).map((r) => `${r.ie} -> ${r.ei}`), []);
  const { entities } = JSON.parse(readFileSync(at('person_registry.json'), 'utf8'));
  const fused = entities.flatMap((e) => {
    const ids = new Set(e.sourcePersonIds || []);
    return [...ids].flatMap((id) => Object.keys(persons[id]?.relatives || {}).filter((rel) => ids.has(rel)).map((rel) => `${e.personId}: ${id} + ${rel}`));
  });
  assert.deepEqual(fused, []);
});

test('IEX-03 every crosswalk pair is one person in the registry, and every id it retired still redirects', () => {
  const { entities } = JSON.parse(readFileSync(at('person_registry.json'), 'utf8'));
  const holder = new Map();
  for (const e of entities) for (const s of e.sourcePersonIds || []) {
    if (!holder.has(s)) holder.set(s, new Set());
    holder.get(s).add(e.personId);
  }
  const apart = crosswalk.filter((r) => {
    const a = holder.get(r.ie);
    const b = holder.get(r.ei);
    return !a || !b || ![...a].some((p) => b.has(p));
  });
  assert.deepEqual(apart.map((r) => `${r.ie} ${r.ei} ${r.name}`), []);
  const live = new Set(entities.map((e) => String(e.personId)));
  const log = parseCsv(readFileSync(at('person_id_merges.csv'), 'utf8'));
  const dropped = new Set(log.map((r) => r.drop));
  const lost = crosswalk.filter((r) => r.drop && !live.has(r.drop) && !dropped.has(r.drop));
  assert.deepEqual(lost.map((r) => `${r.drop} (${r.name})`), []);
});

test('IEX-04 display-names.csv: every person exists and shows the recorded name', () => {
  const rows = parseCsv(readFileSync(at('display-names.csv'), 'utf8'));
  const { entities } = JSON.parse(readFileSync(at('person_registry.json'), 'utf8'));
  const byId = new Map(entities.map((e) => [String(e.personId), e]));
  for (const r of rows) {
    assert.ok(r.source, `${r.personId}: no source`);
    const e = byId.get(r.personId);
    assert.ok(e, `${r.personId} is not a live person`);
    assert.equal(e.displayName, r.displayName);
    assert.ok(e.aliases.includes(r.displayName));
  }
});

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

test('IEX-05 an ElectionsIreland id split into eras gives the ie person to the nearer era', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ie-ei-'));
  try {
    const csvPath = join(dir, 'x.csv');
    writeFileSync(csvPath, 'ie,ei,name,council_area,link,ie_evidence,ei_evidence,ie_years,ei_years,found,keep,drop\n'
      + 'ie:1,ei:9,John Quinn,limerick,same-lea,1985 Limerick No 1,1991 Limerick No 1,1985,1923 1991,2026-11-11,,\n');
    const out = runPython(t, [
      'import sys, json; sys.path.insert(0, "scripts/ingest/persons")',
      'import merge_person_ids as m',
      `m.IE_EI_CROSSWALK = ${JSON.stringify(csvPath)}`,
      "obs = {5: [{'src': 'ie:1', 'y': 1985}], 7: [{'src': 'ei:9', 'y': 1923}], 8: [{'src': 'ei:9', 'y': 1991}]}",
      'print(json.dumps(sorted(sorted(p) for p in m.crosswalk_pairs(obs))))',
    ].join('\n'));
    if (out) assert.deepEqual(out, [[5, 8]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('IEX-06 a retired id keeps its log row after a rebuild that joins the pair itself', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ie-ei-'));
  try {
    const csvPath = join(dir, 'x.csv');
    writeFileSync(csvPath, 'ie,ei,name,council_area,link,ie_evidence,ei_evidence,ie_years,ei_years,found,keep,drop\n'
      + 'ie:1,ei:9,Adam Wyse,waterford,same-lea,2019 Waterford City East,2014 Waterford City East,2019,2014 2024,2026-11-11,118554,151252\n');
    const out = runPython(t, [
      'import sys, json; sys.path.insert(0, "scripts/ingest/persons")',
      'import merge_person_ids as m',
      `m.IE_EI_CROSSWALK = ${JSON.stringify(csvPath)}`,
      "ents = {118554: {'displayName': 'Adam Wyse', 'firstYear': 2014, 'lastYear': 2024}, 2: {'displayName': 'X'}}",
      "rows = m.crosswalk_redirects({}, [{'class': 'SAME-SEAT-SEQUENCE', 'keep': 2, 'drop': 3}], {}, ents)",
      "print(json.dumps([(r['keep'], r['drop'], r['class']) for r in rows]))",
    ].join('\n'));
    if (out) assert.deepEqual(out, [[118554, 151252, 'IE-EI-CROSSWALK']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('IEX-07 display_names.apply sets the name and keeps it as an alias', (t) => {
  const out = runPython(t, [
    'import sys, json; sys.path.insert(0, "scripts/ingest/persons")',
    'import display_names as d',
    "e = {'personId': 103438, 'displayName': \"Kenneth O'Flynn\", 'aliases': [\"Kenneth O'Flynn\"]}",
    "d.apply(e, {103438: \"Ken O'Flynn\"}); d.apply({'personId': 1, 'displayName': 'A', 'aliases': []}, {})",
    'print(json.dumps(e))',
  ].join('\n'));
  if (out) {
    assert.equal(out.displayName, "Ken O'Flynn");
    assert.deepEqual(out.aliases, ["Kenneth O'Flynn", "Ken O'Flynn"]);
  }
});
