// restoreStageFractions (scripts/lib/stage-fractions.mjs): stage totals the 2014-2023 NI council
// imports cut to whole votes, rebuilt from the transfers (Airport DEA, 2014, as imported).
import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreStageFractions } from '../../scripts/lib/stage-fractions.mjs';

const row = (candidateName, Count_Number, Total_Votes, Transfers) => ({ candidateName, Count_Number: String(Count_Number), Total_Votes, Transfers });

test('whole-vote totals get their fractions back; exact and quota totals stay', () => {
  const rows = [
    row('Anne-Marie Logue', 1, '1212.00', '0.00'), row('Anne-Marie Logue', 2, '1032.00', '-180.00'),
    row('Thomas Burns', 1, '975.00', '0.00'), row('Thomas Burns', 2, '1089.00', '114.95'), row('Thomas Burns', 3, '1089.00', '0.00'),
    row('Matthew Magill', 1, '923.00', '0.00'), row('Matthew Magill', 2, '923.00', '0.38'), row('Matthew Magill', 3, '963.00', '40.19'),
    row('Matthew Magill', 4, '1365.00', '402.00'), row('Matthew Magill', 5, '1032.00', '-333.57'),
    row('Roy Thompson', 1, '609.00', '0.00'), row('Roy Thompson', 2, '609.00', '0.19'), row('Roy Thompson', 3, '618.00', '9.00'), row('Roy Thompson', 4, '0.00', '-618.19'),
  ];
  const n = restoreStageFractions(rows);
  const totals = (name) => rows.filter((r) => r.candidateName === name).map((r) => r.Total_Votes);
  assert.deepEqual(totals('Anne-Marie Logue'), ['1212.00', '1032.00']);
  assert.deepEqual(totals('Thomas Burns'), ['975.00', '1089.95', '1089.95']);
  assert.deepEqual(totals('Matthew Magill'), ['923.00', '923.38', '963.57', '1365.57', '1032.00']);
  assert.deepEqual(totals('Roy Thompson'), ['609.00', '609.19', '618.19', '0.00']);
  assert.equal(n, 7);
});

test('a total the transfers do not explain is left as it is', () => {
  const rows = [row('A', 1, '500.00', '0.00'), row('A', 2, '480.00', '12.50')];
  assert.equal(restoreStageFractions(rows), 0);
  assert.equal(rows[1].Total_Votes, '480.00');
});
