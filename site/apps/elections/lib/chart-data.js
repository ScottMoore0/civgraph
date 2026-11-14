/**
 * The data behind a chart, as a table and a CSV: one shared component for every chart and
 * diagram of the Elections app (stream el-tables, 14 Nov 2026). Under each chart a "View this
 * chart's data as a table" control opens a real table of the same figures (a caption, column
 * headers, a header cell for each row), and a link saves that table as a CSV made in the browser
 * from the same rows: no request, no file on the server.
 *
 * Use: build the rows the chart is drawn from once, draw the chart from them, and pass them here.
 *
 *   chartData({
 *     id: 'seats', caption: 'Seats won by party', file: 'seats-2022',
 *     columns: [{ label: 'Party' }, { label: 'Seats', num: true, format: fmtInt }],
 *     rows: parties.map((p) => [p.party, p.seats]),
 *   })
 *
 * The first column is the row's header cell. A column's `format` writes the cell on the page;
 * the CSV holds the raw value (no thousands separators, no % sign), with `csv` to write it
 * otherwise (e.g. rounded as the page shows it). Pure (no DOM): tests/unit/elections-app-chart-data.test.mjs.
 * Its words are keyed for translation in data/i18n/strings/elections.txt (R10).
 */
import { escapeHtml as esc } from '../../../pkg/core/src/html.js';

/** The control's fixed words (keys of data/i18n/strings/elections.txt). */
export const CHART_DATA_TEXT = Object.freeze({
  view: "View this chart's data as a table",
  download: 'Download this table (CSV)',
});

/**
 * Captions and column headings the app's chart tables share (keys of data/i18n/strings/elections.txt).
 * A caption with a value in it is a pattern there ("Transfers at count {n}").
 */
export const CHART_TEXT = Object.freeze({
  party: 'Party',
  seats: 'Seats',
  sharePct: 'Share (%)',
  candidate: 'Candidate',
  votes: 'Votes',
  quotaPct: 'Share of the quota (%)',
  receivedBy: 'Received by',
  area: 'Area',
  seatsByParty: 'Seats won by party',
  shareByParty: 'Share of the vote by party',
  quotaProgress: 'Votes at the last count against the quota',
  projectedSeats: 'Projected seats by party (estimate)',
  projected: 'Projected seats',
  notionalSeats: 'Notional seats by party (estimate)',
  notionalWinners: 'Notional seats by new constituency (estimate)',
  newConstituency: 'New constituency',
  notional: 'Notional seats',
  transfersAt: 'Transfers at count {n}',
  seatsOf: '{name}: seats won by party',
  mapFigures: '{name}: the figures on the map',
  winnersOf: '{name}: winners',
});

/**
 * A pattern of CHART_TEXT with its values put in ({n}, {name}).
 * @param {string} pattern @param {Record<string, string | number>} values
 */
export const fill = (pattern, values) => pattern.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(values, k) ? String(values[k]) : m));

/**
 * @typedef {string | number | null | undefined} Cell
 * @typedef {{ label: string, num?: boolean, format?: (value: Cell) => string, csv?: (value: Cell) => string | number }} DataColumn
 * @typedef {{ id: string, caption: string, columns: DataColumn[], rows: Cell[][], file?: string, open?: boolean }} ChartDataSpec
 *   id      unique on the page (the control's id is "data-<id>"; a chart's figure can point at it)
 *   caption the table's caption: what the chart shows
 *   file    the CSV's file name, without ".csv" (default civgraph-<id>)
 *   open    drawn open (a table that was on show before it had this control)
 */

/** A file name made safe: lower case, letters, digits and hyphens. @param {string} name */
export const csvFileName = (name) => `${String(name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'civgraph-chart'}.csv`;

/** One CSV field (RFC 4180: quoted when it holds a comma, quote or line break). @param {unknown} v */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The CSV of a chart's table: a header line of the column labels, then a line a row.
 * @param {Pick<ChartDataSpec, 'columns' | 'rows'>} spec
 */
export function chartCsv(spec) {
  const lines = [spec.columns.map((c) => csvCell(c.label)).join(',')];
  for (const row of spec.rows) lines.push(spec.columns.map((c, i) => csvCell(c.csv ? c.csv(row[i]) : row[i])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * A data: URL of CSV text, for a download link (UTF-8 with a byte-order mark, so a spreadsheet
 * reads names with accents rightly).
 * @param {string} csv
 */
export const csvHref = (csv) => `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${csv}`)}`;

/** A cell as the page shows it. @param {DataColumn} col @param {Cell} v */
function shown(col, v) {
  if (col.format) return col.format(v);
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

/**
 * The control: a disclosure with the table and its CSV link. Empty when there are no rows.
 * @param {ChartDataSpec} spec
 * @returns {string}
 */
export function chartData(spec) {
  if (!spec.rows.length) return '';
  const id = `data-${String(spec.id).replace(/[^A-Za-z0-9_-]+/g, '-')}`;
  const head = spec.columns.map((c) => `<th scope="col"${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('');
  const body = spec.rows.map((row) => `<tr>${spec.columns.map((c, i) => (i === 0
    ? `<th scope="row">${esc(shown(c, row[i]))}</th>`
    : `<td${c.num ? ' class="num"' : ''}>${esc(shown(c, row[i]))}</td>`)).join('')}</tr>`).join('');
  return `<details class="el-chart-data" id="${id}" data-chart-data="${esc(spec.id)}"${spec.open ? ' open' : ''}>`
    + `<summary>${esc(CHART_DATA_TEXT.view)}</summary>`
    + `<div class="cg-table-wrap el-chart-data__wrap" tabindex="0" role="region" aria-labelledby="${id}-caption">`
    + `<table class="cg-table cg-table--compact"><caption id="${id}-caption">${esc(spec.caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
    + `<p class="el-chart-data__csv"><a href="${esc(csvHref(chartCsv(spec)))}" download="${esc(csvFileName(spec.file || `civgraph-${spec.id}`))}">${esc(CHART_DATA_TEXT.download)}</a></p>`
    + '</details>';
}
