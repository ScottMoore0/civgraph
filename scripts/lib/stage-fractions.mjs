/**
 * Stage totals an import cut to whole votes (arith-audit, 11 Nov 2026).
 *
 * The Northern Ireland council files of 2014, 2019 and 2023 kept each transfer's fraction
 * (114.95) but cut every stage total to whole votes (975 + 114.95 shown as 1089, not 1089.95),
 * where the Electoral Office's result sheets print the fractions. The source-checked fix
 * `restoreStageFractions` rebuilds them: down each candidate's rows in count order, a total that
 * is the whole part of the last total plus the transfer becomes that sum, to two decimals. A
 * total that is anything else (a surplus brought down to the quota, a figure the source gives
 * differently) is left alone.
 *
 * @param {Array<Record<string, unknown>>} rows  count rows in the file's own format
 *   (candidateName or Firstname/Surname, Count_Number, Total_Votes, Transfers)
 * @returns {number} how many totals were rebuilt
 */
export function restoreStageFractions(rows) {
  const num = (/** @type {unknown} */ v) => {
    const n = Number(v);
    return v === '' || v === null || v === undefined || !Number.isFinite(n) ? null : n;
  };
  /** @type {Map<string, Array<Record<string, unknown>>>} */
  const byCandidate = new Map();
  for (const row of rows) {
    const name = String(row.candidateName || `${row.Firstname || ''} ${row.Surname || ''}`).trim();
    if (!byCandidate.has(name)) byCandidate.set(name, []);
    /** @type {Array<Record<string, unknown>>} */ (byCandidate.get(name)).push(row);
  }
  let restored = 0;
  for (const list of byCandidate.values()) {
    list.sort((a, b) => Number(a.Count_Number) - Number(b.Count_Number));
    let run = num(list[0]?.Total_Votes);
    for (const row of list.slice(1)) {
      const total = num(row.Total_Votes);
      const transfer = num(row.Transfers);
      if (run === null || total === null || transfer === null) { run = total; continue; }
      const sum = Math.round((run + transfer) * 100) / 100;
      if (Math.abs(sum - total) > 0.005 && total === Math.floor(sum + 1e-9)) {
        row.Total_Votes = sum.toFixed(2);
        restored += 1;
        run = sum;
      } else {
        run = total;
      }
    }
  }
  return restored;
}
