/**
 * Pivot tables over the build-time extracts (scripts/build/elections-app/data.mjs: one Parquet
 * file per body, one row per candidacy): the state <-> URL mapping, the SQL DuckDB runs, and the
 * shaping of its answer into a table. Pure (no DOM, no DuckDB): tests/unit/elections-app-lib.test.mjs.
 * The dimensions and measures are whitelisted, and filter values are SQL string literals with
 * quotes doubled, so a URL cannot inject SQL.
 */

/** Dimensions: column -> label. `contest` marks a contest-level column (one value per contest). */
export const DIMENSIONS = Object.freeze({
  election: { label: 'Election', contest: true },
  body: { label: 'Body', contest: true },
  kind: { label: 'General or by-election', contest: true },
  voting_system: { label: 'Voting system', contest: true },
  year: { label: 'Year', contest: true },
  decade: { label: 'Decade', contest: true },
  area: { label: 'Constituency or area', contest: true },
  party: { label: 'Party (ballot label)', contest: false },
  candidate: { label: 'Candidate', contest: false },
  gender: { label: 'Gender (where recorded)', contest: false },
  incumbent: { label: 'Incumbent (derived)', contest: false },
  outcome: { label: 'Outcome', contest: false },
  unopposed: { label: 'Unopposed return', contest: true },
});

/** Measures: id -> label, SQL aggregate, number format, and whether it is a share of the column. */
export const MEASURES = Object.freeze({
  seats: { label: 'Seats won', sql: 'SUM(seats)', digits: 0 },
  votes: { label: 'Votes (first preferences)', sql: 'SUM(votes)', digits: 0 },
  share: { label: 'Share of the votes in the column (%)', sql: 'SUM(votes)', digits: 1, share: true },
  seat_share: { label: 'Share of the seats in the column (%)', sql: 'SUM(seats)', digits: 1, share: true },
  candidates: { label: 'Candidates', sql: 'COUNT(*)', digits: 0 },
  elected_rate: { label: 'Elected, % of candidates', sql: '100.0 * SUM(seats) / COUNT(*)', digits: 1 },
  avg_share: { label: 'Average candidate share (%)', sql: 'AVG(share)', digits: 1 },
  transfers: { label: 'Transfers received', sql: 'SUM(transfers_received)', digits: 0 },
  turnout: { label: 'Average turnout of contests (%)', sql: 'AVG(turnout_pct)', digits: 1, contest: true },
});

/** Filters the URL can carry: query name -> column. */
export const FILTERS = Object.freeze({ election: 'election_key', party: 'party', outcome: 'outcome', kind: 'kind', gender: 'gender', area: 'area' });

/**
 * @typedef {{ bodies: string[], rows: string, cols: string, measure: string, from: number | null, to: number | null,
 *   filters: Record<string, string[]> }} PivotState
 */

/** The default state: the NI Assembly, party by election, seats. */
export const DEFAULT_STATE = Object.freeze({ bodies: ['northern-ireland-assembly'], rows: 'party', cols: 'year', measure: 'seats', from: null, to: null, filters: {} });

/**
 * The state of a URL's query string (unknown names fall back to the defaults).
 * @param {URLSearchParams} q
 * @returns {PivotState}
 */
export function stateFromQuery(q) {
  const list = (/** @type {string} */ name) => (q.get(name) || '').split(',').map((s) => s.trim()).filter(Boolean);
  const dim = (/** @type {string} */ name, /** @type {string} */ dflt) => {
    const v = q.get(name) || '';
    return v === 'none' && name === 'cols' ? 'none' : Object.hasOwn(DIMENSIONS, v) ? v : dflt;
  };
  const year = (/** @type {string} */ name) => { const n = Number(q.get(name)); return q.get(name) && Number.isInteger(n) ? n : null; };
  /** @type {Record<string, string[]>} */
  const filters = {};
  for (const f of Object.keys(FILTERS)) { const v = q.getAll(`f.${f}`); if (v.length) filters[f] = v; }
  const bodies = list('body').filter((b) => /^[a-z0-9-]+$/.test(b));
  const measure = q.get('measure') || '';
  return {
    bodies: bodies.length ? bodies : [...DEFAULT_STATE.bodies],
    rows: dim('rows', DEFAULT_STATE.rows),
    cols: dim('cols', DEFAULT_STATE.cols),
    measure: Object.hasOwn(MEASURES, measure) ? measure : DEFAULT_STATE.measure,
    from: year('from'),
    to: year('to'),
    filters,
  };
}

/** The query string of a state (stable order, defaults included so a saved view is complete). */
export function queryFromState(/** @type {PivotState} */ s) {
  const q = new URLSearchParams();
  q.set('body', s.bodies.join(','));
  q.set('rows', s.rows);
  q.set('cols', s.cols);
  q.set('measure', s.measure);
  if (s.from !== null) q.set('from', String(s.from));
  if (s.to !== null) q.set('to', String(s.to));
  for (const f of Object.keys(FILTERS)) for (const v of s.filters[f] || []) q.append(`f.${f}`, v);
  return q.toString();
}

/** A SQL string literal. */
export const lit = (/** @type {unknown} */ v) => `'${String(v).replace(/'/g, "''")}'`;

/** The column expression of a dimension (booleans and nulls made readable). */
export function dimSql(/** @type {string} */ d) {
  if (!Object.hasOwn(DIMENSIONS, d)) throw new Error(`unknown dimension ${d}`);
  if (d === 'gender') return "COALESCE(gender, 'not recorded')";
  if (d === 'incumbent') return "CASE WHEN incumbent IS NULL THEN 'unknown' WHEN incumbent THEN 'incumbent' ELSE 'not incumbent' END";
  if (d === 'unopposed') return "CASE WHEN unopposed THEN 'unopposed' ELSE 'contested' END";
  if (d === 'year') return 'CAST(year AS VARCHAR)';
  return `COALESCE(CAST(${d} AS VARCHAR), '')`;
}

/** The WHERE clause of a state's filters. */
export function whereSql(/** @type {PivotState} */ s) {
  const where = [];
  if (s.from !== null) where.push(`year >= ${Number(s.from)}`);
  if (s.to !== null) where.push(`year <= ${Number(s.to)}`);
  for (const [f, col] of Object.entries(FILTERS)) {
    const vals = s.filters[f] || [];
    if (vals.length) where.push(`${col} IN (${vals.map(lit).join(', ')})`);
  }
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

/**
 * The pivot query: one row per (r, c) with the measure, over the `rows` relation (a view over
 * the loaded Parquet files). A contest-level measure (turnout) is taken over distinct contests.
 * @param {PivotState} s
 */
export function pivotSql(s) {
  const m = MEASURES[/** @type {keyof typeof MEASURES} */ (s.measure)];
  const r = dimSql(s.rows);
  const c = s.cols === 'none' ? "'all'" : dimSql(s.cols);
  const where = whereSql(s);
  if (/** @type {any} */ (m).contest) {
    return `SELECT r, c, AVG(turnout_pct) AS v FROM (SELECT DISTINCT election_key, contest_seq, ${r} AS r, ${c} AS c, turnout_pct FROM rows ${where}) GROUP BY r, c`;
  }
  return `SELECT ${r} AS r, ${c} AS c, ${m.sql} AS v FROM rows ${where} GROUP BY r, c`;
}

/**
 * The pivot table of the query's answer: rows and columns sorted (columns by value order when
 * numeric-like, rows by their total), share measures as percentages of their column, totals.
 * At most maxCols columns (the largest; the rest summed into "other").
 * @param {Array<{ r: string, c: string, v: number | null }>} data
 * @param {PivotState} s
 * @param {{ maxCols?: number, maxRows?: number }} [opts]
 */
export function pivotTable(data, s, opts = {}) {
  const maxCols = opts.maxCols ?? 40;
  const maxRows = opts.maxRows ?? 500;
  const m = MEASURES[/** @type {keyof typeof MEASURES} */ (s.measure)];
  const additive = !['elected_rate', 'avg_share', 'turnout'].includes(s.measure);
  /** @type {Map<string, number>} */
  const colTotals = new Map();
  /** @type {Map<string, number>} */
  const rowTotals = new Map();
  for (const d of data) {
    const v = Number(d.v) || 0;
    colTotals.set(d.c, (colTotals.get(d.c) || 0) + v);
    rowTotals.set(d.r, (rowTotals.get(d.r) || 0) + v);
  }
  const numeric = [...colTotals.keys()].every((k) => /^\d{3,4}(s)?$/.test(k));
  let cols = [...colTotals.keys()].sort(numeric ? (a, b) => a.localeCompare(b) : (a, b) => (colTotals.get(b) || 0) - (colTotals.get(a) || 0));
  let other = false;
  if (cols.length > maxCols && !numeric) { cols = cols.slice(0, maxCols - 1); other = true; }
  const rowKeys = [...rowTotals.keys()].sort((a, b) => (rowTotals.get(b) || 0) - (rowTotals.get(a) || 0) || a.localeCompare(b));
  const rowsCut = rowKeys.length > maxRows;
  /** @type {Map<string, Map<string, number | null>>} */
  const cells = new Map();
  const keep = new Set(cols);
  for (const d of data) {
    const col = keep.has(d.c) ? d.c : (other ? 'other' : null);
    if (col === null) continue;
    if (!cells.has(d.r)) cells.set(d.r, new Map());
    const row = /** @type {Map<string, number | null>} */ (cells.get(d.r));
    const v = d.v === null ? null : Number(d.v);
    row.set(col, col === 'other' ? (Number(row.get(col)) || 0) + (v || 0) : v);
  }
  if (other) cols.push('other');
  const value = (/** @type {string} */ r, /** @type {string} */ c) => {
    const v = cells.get(r)?.get(c);
    if (v === null || v === undefined) return null;
    if (/** @type {any} */ (m).share) {
      const t = c === 'other' ? [...colTotals].filter(([k]) => !keep.has(k)).reduce((s2, [, x]) => s2 + x, 0) : colTotals.get(c) || 0;
      return t ? (100 * v) / t : null;
    }
    return v;
  };
  const rowsOut = rowKeys.slice(0, maxRows).map((r) => ({
    key: r,
    values: cols.map((c) => value(r, c)),
    total: /** @type {any} */ (m).share ? null : additive ? rowTotals.get(r) ?? null : null,
  }));
  const totals = cols.map((c) => (/** @type {any} */ (m).share ? 100 : additive ? (c === 'other' ? [...colTotals].filter(([k]) => !keep.has(k)).reduce((s2, [, x]) => s2 + x, 0) : colTotals.get(c) ?? null) : null));
  return { cols, rows: rowsOut, totals, digits: m.digits, additive, rowsCut, rowCount: rowKeys.length };
}

/** CSV text of a pivot table. */
export function pivotCsv(/** @type {ReturnType<typeof pivotTable>} */ t, /** @type {PivotState} */ s) {
  const cell = (/** @type {unknown} */ v) => {
    const x = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
  };
  const head = [DIMENSIONS[/** @type {keyof typeof DIMENSIONS} */ (s.rows)].label, ...t.cols, ...(t.additive && !(/** @type {any} */ (MEASURES[/** @type {keyof typeof MEASURES} */ (s.measure)]).share) ? ['Total'] : [])];
  const lines = [head.map(cell).join(',')];
  for (const r of t.rows) {
    const vals = r.values.map((v) => (v === null ? '' : Number(v.toFixed(t.digits))));
    if (t.additive && !(/** @type {any} */ (MEASURES[/** @type {keyof typeof MEASURES} */ (s.measure)]).share)) vals.push(r.total === null ? '' : Number(r.total.toFixed(t.digits)));
    lines.push([r.key, ...vals].map(cell).join(','));
  }
  return `${lines.join('\n')}\n`;
}
