// The 2024 Limerick mayoral election (data/elections-source/data/elections/limerick-mayor), from the
// council's State of the Poll sheets for counts 1-12. The non-transferable papers are count rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = path.join(ROOT, 'data', 'elections-source', 'data', 'elections', 'limerick-mayor', '2024-06-07', 'limerick-city-and-county.json');
const { Constituency: { countInfo, countGroup: rows } } = JSON.parse(readFileSync(FILE, 'utf8'));
const isNonTransferable = (r) => r.candidateName === 'Non-transferable';
const countGroup = rows.filter((r) => !isNonTransferable(r));
const nonTransferable = Array.from({ length: 12 }, (_, i) => Number(rows.find((r) => isNonTransferable(r) && r.Count_Number === String(i + 1))?.Total_Votes ?? NaN));

test('first preferences plus invalid papers make the total poll', () => {
  const firsts = countGroup.filter((r) => r.Count_Number === '1').reduce((s, r) => s + Number(r.Total_Votes), 0);
  assert.equal(firsts, Number(countInfo.Valid_Poll));
  assert.equal(firsts + Number(countInfo.Spoiled), Number(countInfo.Total_Poll));
  assert.equal(Number(countInfo.Quota), Math.floor(Number(countInfo.Valid_Poll) / 2) + 1);
});

test('every count: continuing candidates plus non-transferable papers make the valid poll', () => {
  for (let n = 2; n <= 12; n++) {
    const live = countGroup.filter((r) => r.Count_Number === String(n)).reduce((s, r) => s + Number(r.Total_Votes), 0);
    assert.equal(live + nonTransferable[n - 1], Number(countInfo.Valid_Poll), `count ${n}`);
  }
});

test('John Moran is elected at the final count, with 15 candidates', () => {
  assert.equal(new Set(countGroup.map((r) => r.candidateName)).size, 15);
  const elected = countGroup.filter((r) => r.Status === 'Elected' && r.Count_Number === '12');
  assert.deepEqual(elected.map((r) => [r.candidateName, r.Total_Votes]), [['John Moran', '28451']]);
});

test('each candidate has one candidate id, and the non-transferable rows add up count by count', () => {
  const ids = new Map();
  for (const r of countGroup) {
    assert.ok(/^\d+$/.test(r.Candidate_Id), `${r.candidateName} has an id`);
    assert.equal(ids.get(r.candidateName) ?? r.Candidate_Id, r.Candidate_Id);
    ids.set(r.candidateName, r.Candidate_Id);
  }
  assert.equal(new Set(ids.values()).size, 15);
  let total = 0;
  for (const r of rows.filter(isNonTransferable)) {
    total += Number(r.Transfers);
    assert.equal(Number(r.Total_Votes), total, `count ${r.Count_Number}`);
  }
});
