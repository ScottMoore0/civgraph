/**
 * A count-by-count rebuild in the source-checked fixes (data/elections/corrections/
 * source-checked-fixes.json, op replaceCountRows) adds up stage by stage.
 *
 * A rebuilt STV count is rows per candidate per stage. An elected candidate's rows stop at the
 * stage they were elected on; they hold that total until their surplus is transferred (the first
 * later stage that excludes nobody) and the quota after. An excluded candidate holds nothing
 * after their exclusion. What the candidates hold at a stage, plus the votes that could not be
 * transferred by then, is the valid poll at every stage.
 *
 * North Down Area B, 1973 is checked against ARK's result spreadsheet figure for figure: its
 * non-transferable votes at each stage, and the five elected (Braniff, not McMullan).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ElectionDomain from '../../src/election-domain.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const FIXES = read('data/elections/corrections/source-checked-fixes.json').records;
const num = (v) => (v === '' || v === null || v === undefined || v === '-' ? null : Number(v));
const NORTH_DOWN_B = 'data/elections-source/data/elections/local-government/1973-05-30/lg73-nod-area-b.json';

/** What the candidates hold at each stage of a set of count rows, with the stages in order. */
function stageHoldings(rows, quota) {
  const stages = [...new Set(rows.map((r) => Number(r.Count_Number)))].sort((a, b) => a - b);
  const byCandidate = new Map();
  for (const row of rows) {
    const name = row.candidateName || `${row.Firstname || ''} ${row.Surname || ''}`.trim();
    if (!byCandidate.has(name)) byCandidate.set(name, new Map());
    byCandidate.get(name).set(Number(row.Count_Number), row);
  }
  // A stage excludes someone when a candidate's total there falls to nothing.
  const excludes = new Set(rows.filter((r) => Number(r.Count_Number) > 1 && num(r.Total_Votes) === 0).map((r) => Number(r.Count_Number)));
  return stages.map((stage) => {
    let held = 0;
    for (const counts of byCandidate.values()) {
      if (counts.has(stage)) { held += num(counts.get(stage).Total_Votes) || 0; continue; }
      const last = Math.max(...[...counts.keys()].filter((s) => s < stage));
      if (!Number.isFinite(last)) continue;
      const row = counts.get(last);
      if (!/^elected/i.test(String(row.Status || ''))) continue;
      const transferredAt = stages.find((s) => s > last && !excludes.has(s));
      const total = num(row.Total_Votes) || 0;
      held += transferredAt !== undefined && stage >= transferredAt ? Math.min(total, quota) : total;
    }
    return { stage, held: Math.round(held * 100) / 100 };
  });
}

/** The file as the build reads it, with a record's structural operations laid over it. */
function withFix(record) {
  const raw = read(record.sourceFile);
  for (const op of record.operations) {
    if (op.op === 'replaceCountRows') raw.Constituency.countGroup = op.rows.map((row) => ({ ...row }));
    else if (op.op === 'set') {
      const keys = op.path.split('.');
      let target = raw;
      for (const key of keys.slice(0, -1)) target = target[key] ??= {};
      target[keys.at(-1)] = op.value;
    } else if (op.op === 'candidate') {
      for (const row of raw.Constituency.countGroup) {
        const name = row.candidateName || `${row.Firstname || ''} ${row.Surname || ''}`.trim();
        if (name === op.name) Object.assign(row, op.set);
      }
    } else {
      throw new Error(`${record.sourceFile}: operation ${op.op} is not read here`);
    }
  }
  return raw;
}

test('North Down Area B, 1973: every stage of the rebuilt count comes to the valid poll of 6,631', () => {
  const record = FIXES.find((r) => r.sourceFile === NORTH_DOWN_B);
  assert.ok(record, 'the fix record is there');
  assert.deepEqual(record.operations.map((op) => op.op), ['replaceCountRows', 'set']);
  const raw = withFix(record);
  const info = raw.Constituency.countInfo;
  assert.equal(info.Constituency_Name, 'North Down Area B');
  assert.equal(num(info.Valid_Poll), 6631);
  assert.equal(num(info.Quota), 1106);
  const rows = raw.Constituency.countGroup;
  assert.equal(rows.length, 67, '67 count rows over 9 stages');
  const firsts = rows.filter((r) => r.Count_Number === '1');
  assert.equal(firsts.length, 11, 'eleven candidates, the four Loyalists among them');
  assert.equal(firsts.reduce((sum, r) => sum + num(r.Candidate_First_Pref_Votes), 0), 6631, 'first preferences add up to the valid poll');

  // ARK's spreadsheet (lg73-NoD-Area-B.xls): the non-transferable votes after each stage.
  const nonTransferable = [0, 0, 5.03, 5.03, 5.42, 14.59, 16.04, 26.95, 29.51];
  const holdings = stageHoldings(rows, 1106);
  assert.deepEqual(holdings.map((h) => h.stage), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  holdings.forEach(({ stage, held }, i) => {
    assert.equal(Math.round((held + nonTransferable[i]) * 100) / 100, 6631, `stage ${stage}: ${held} held + ${nonTransferable[i]} non-transferable`);
  });

  // The result follows the counts: Braniff elected on the ninth, McMullan excluded on it.
  const result = ElectionDomain.summarizeResult(raw, 'North Down Area B');
  const elected = result.candidates.filter((c) => c.elected).map((c) => c.name).sort();
  assert.deepEqual(elected, ['Amy Corry', 'George Green', 'James Magee', 'John Preston', 'Thomas Braniff']);
  const byName = Object.fromEntries(result.candidates.map((c) => [c.name, c]));
  assert.equal(byName['Arminella McMullan'].elected, false);
  assert.equal(byName['Clifford Creighton'].elected, false);
  assert.equal(result.seatsWon, 5);
});
