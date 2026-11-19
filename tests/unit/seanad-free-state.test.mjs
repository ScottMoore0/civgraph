// The Seanad of the Irish Free State, 1922-1936 (stream seanad-3b): the contest files
// build_seanad.py writes from data/elections/seanad-free-state.json (scripts/ingest/seanad/free_state.py).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalElectionTitle } from '../../scripts/lib/election-names.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const DIR = path.join(REPO, 'data/elections-source/data/elections/seanad-eireann');
const contests = readdirSync(DIR).filter((d) => d < '1937').map((date) => ({
  date, doc: JSON.parse(readFileSync(path.join(DIR, date, 'irish-free-state.json'), 'utf8')),
}));
const GENERAL = ['1922-12-06', '1925-12-06', '1928-12-06', '1931-12-06', '1934-12-06'];
const title = (/** @type {string} */ date) => canonicalElectionTitle({ body: 'Seanad Éireann', bodySlug: 'seanad-eireann', date, constituencies: ['Irish Free State'] });

test('SFS-01 five general elections and nineteen by-elections, each one contest in the Irish Free State', () => {
  assert.equal(contests.length, 24);
  assert.deepEqual(contests.filter((c) => GENERAL.includes(c.date)).map((c) => c.date), GENERAL);
  for (const { date, doc } of contests) {
    assert.equal(doc.constituency, 'Irish Free State', date);
    assert.equal(Number(doc.Constituency.countInfo.Number_Of_Seats), doc.Constituency.countGroup.filter((/** @type {{ Status: string }} */ r) => r.Status === 'Elected').length, date);
  }
  for (const date of GENERAL) assert.equal(title(date), `${date.slice(0, 4)} Seanad election`);
  assert.equal(title('1929-06-20'), '1929 Seanad bye-election (Irish Free State)');
});

test('SFS-02 the 1925 popular election: 76 candidates, first preferences that add up to the valid poll, 19 elected', () => {
  const { doc } = /** @type {{ doc: any }} */ (contests.find((c) => c.date === '1925-12-06'));
  const rows = doc.Constituency.countGroup;
  const info = doc.Constituency.countInfo;
  assert.equal(rows.length, 76);
  assert.equal(rows.reduce((n, /** @type {{ Candidate_First_Pref_Votes: string }} */ r) => n + Number(r.Candidate_First_Pref_Votes), 0), Number(info.Valid_Poll));
  assert.equal(Number(info.Valid_Poll) + Number(info.Spoiled), Number(info.Total_Poll));
  assert.equal(Number(info.Quota), Math.floor(Number(info.Valid_Poll) / 20) + 1);
  assert.equal(info.Candidates_Recorded, undefined);
});

test('SFS-03 every other contest records the winners only, and every winner carries an Oireachtas member code', () => {
  const official = JSON.parse(readFileSync(path.join(REPO, 'data/elections/persons/official-person-ids.json'), 'utf8'));
  const linked = new Set(official.links.filter((/** @type {{ system: string }} */ l) => l.system === 'oireachtas')
    .map((/** @type {{ election: string, constituency: string, candidateId: string }} */ l) => `${l.election}|${l.constituency}|${l.candidateId}`));
  for (const { date, doc } of contests) {
    if (date !== '1925-12-06') assert.equal(doc.Constituency.countInfo.Candidates_Recorded, 'winners', date);
    for (const r of doc.Constituency.countGroup) {
      if (r.Status === 'Elected') assert.ok(linked.has(`seanad-eireann__${date}|Irish Free State|${r.Candidate_Id}`), `${date} ${r.candidateName}`);
    }
  }
});
