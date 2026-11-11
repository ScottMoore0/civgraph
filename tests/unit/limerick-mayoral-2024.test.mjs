// The 2024 Limerick mayoral election (data/elections/limerick-mayoral), from the council's State of
// the Poll sheets for counts 1-12. Staged data: no build reads it yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = path.join(ROOT, 'data', 'elections', 'limerick-mayoral', '2024-06-07', 'limerick-city-and-county.json');
const { Constituency: { countInfo, countGroup, nonTransferable } } = JSON.parse(readFileSync(FILE, 'utf8'));

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
