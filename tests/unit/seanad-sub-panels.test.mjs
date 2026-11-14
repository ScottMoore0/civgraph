// The Seanad panel candidates' sub-panels (stream seanad-3b): the data file
// (data/elections/seanad-sub-panels.json), the pure join that writes Sub_Panel on the count rows
// (scripts/lib/candidate-sub-panels.mjs), and the core summary that carries it as subPanel.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { applySubPanels, subPanelIndex } from '../../scripts/lib/candidate-sub-panels.mjs';
import { summarizeCandidateRows } from '../../packages/core/src/election-domain.mjs';

const ROOT = new URL('../..', import.meta.url);
const doc = JSON.parse(readFileSync(new URL('data/elections/seanad-sub-panels.json', ROOT), 'utf8'));
const SUB_PANELS = ['Oireachtas', 'Nominating Bodies'];
const key = (/** @type {string} */ name) => name.toLowerCase().replace(/\s+/g, ' ').trim();

test('SP-01 every contest of the file exists, cites a listed source, and names its own candidates', () => {
  for (const [file, contest] of Object.entries(doc.contests)) {
    assert.ok(existsSync(new URL(file, ROOT)), `${file} is not on file`);
    assert.ok(doc.sources[contest.source], `${file}: source ${contest.source} is not listed`);
    const result = JSON.parse(readFileSync(new URL(file, ROOT), 'utf8'));
    const names = new Set(result.Constituency.countGroup.map((/** @type {{ candidateName: string }} */ r) => r.candidateName));
    for (const [name, sub] of Object.entries(contest.candidates)) {
      assert.ok(names.has(name), `${file}: ${name} is not a candidate of the contest`);
      assert.ok(SUB_PANELS.includes(sub), `${file}: ${name} has sub-panel ${sub}`);
    }
  }
});

test('SP-02 a panel of a full list names every candidate; a winners-only list names exactly the winners', () => {
  for (const [file, contest] of Object.entries(doc.contests)) {
    const rows = JSON.parse(readFileSync(new URL(file, ROOT), 'utf8')).Constituency.countGroup;
    const all = new Set(rows.map((/** @type {{ candidateName: string }} */ r) => r.candidateName));
    const won = new Set(rows.filter((/** @type {{ Status: string }} */ r) => r.Status === 'Elected').map((/** @type {{ candidateName: string }} */ r) => r.candidateName));
    const named = new Set(Object.keys(contest.candidates));
    const expected = contest.coverage === 'winners' ? won : all;
    // the one contest whose note says a sub-panel is left out
    const missing = [...expected].filter((n) => !named.has(n));
    assert.equal(missing.length, contest.note ? 1 : 0, `${file}: not named: ${missing.join(', ')}`);
  }
});

test('SP-03 the winners of each sub-panel meet the statutory minimum of the panel', () => {
  // Seanad Electoral (Panel Members) Act 1947, as amended: seats and the minimum from each sub-panel
  const MIN = { 'cultural-and-educational-panel': 2, 'agricultural-panel': 4, 'labour-panel': 4, 'industrial-and-commercial-panel': 3, 'administrative-panel': 3 };
  for (const [file, contest] of Object.entries(doc.contests)) {
    if (contest.note) continue;
    const panel = /** @type {keyof typeof MIN} */ (file.split('/').pop()?.replace('.json', ''));
    const rows = JSON.parse(readFileSync(new URL(file, ROOT), 'utf8')).Constituency.countGroup;
    const won = new Set(rows.filter((/** @type {{ Status: string }} */ r) => r.Status === 'Elected').map((/** @type {{ candidateName: string }} */ r) => r.candidateName));
    for (const sub of SUB_PANELS) {
      const n = [...won].filter((name) => contest.candidates[name] === sub).length;
      assert.ok(n >= MIN[panel], `${file}: ${n} elected from the ${sub} sub-panel, fewer than ${MIN[panel]}`);
    }
  }
});

test('SP-04 the join writes Sub_Panel on the named candidates rows only, and leaves other contests alone', () => {
  const index = subPanelIndex({ contests: { 'data\\x\\panel.json': { candidates: { 'Ann  Ormonde': 'Nominating Bodies' } } } }, key);
  const raw = { Constituency: { countGroup: [
    { candidateName: 'Ann Ormonde', Count_Number: '1' }, { candidateName: 'Ann Ormonde', Count_Number: '2' },
    { candidateName: 'Alex White', Count_Number: '1' },
  ] } };
  applySubPanels(index, 'data/x/panel.json', raw, key);
  assert.deepEqual(raw.Constituency.countGroup.map((r) => /** @type {{ Sub_Panel?: string }} */ (r).Sub_Panel), ['Nominating Bodies', 'Nominating Bodies', undefined]);
  const other = { Constituency: { countGroup: [{ candidateName: 'Ann Ormonde' }] } };
  applySubPanels(index, 'data/x/other.json', other, key);
  assert.equal(/** @type {{ Sub_Panel?: string }} */ (other.Constituency.countGroup[0]).Sub_Panel, undefined);
  assert.equal(applySubPanels(index, null, null, key), null);
});

test('SP-05 the candidate summary carries subPanel where a row has one, and nothing where none does', () => {
  const [a, b] = summarizeCandidateRows([
    { Candidate_Id: '1', candidateName: 'Ann Ormonde', Count_Number: '1', Candidate_First_Pref_Votes: '90000', Total_Votes: '90000', Sub_Panel: 'Nominating Bodies' },
    { Candidate_Id: '2', candidateName: 'Alex White', Count_Number: '1', Candidate_First_Pref_Votes: '80000', Total_Votes: '80000' },
  ]);
  assert.equal(a.subPanel, 'Nominating Bodies');
  assert.equal('subPanel' in b, false);
});
