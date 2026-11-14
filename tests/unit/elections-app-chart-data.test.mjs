/**
 * The data behind the Elections app's charts (site/apps/elections/lib/chart-data.js, stream
 * el-tables): a real table of the chart's figures behind a "View this chart's data as a table"
 * control, and a CSV of the same rows made in the browser. Every word is keyed for translation.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CHART_DATA_TEXT, CHART_TEXT, chartCsv, chartData, csvFileName, csvHref, fill,
} from '../../site/apps/elections/lib/chart-data.js';
import { fmtInt, fmtPct } from '../../site/apps/elections/lib/format.js';

const SPEC = {
  id: 'seats',
  caption: 'Seats won by party',
  file: 'Dáil Éireann 2024 seats',
  columns: [{ label: 'Party' }, { label: 'Seats', num: true, format: fmtInt }, { label: 'Share (%)', num: true, format: (v) => fmtPct(v) }],
  rows: [['Sinn Féin', 1234, 27.04], ['A "quoted", party', 2, null]],
};

test('the control is a disclosure holding a captioned table with header cells for columns and rows', () => {
  const html = chartData(SPEC);
  assert.match(html, /^<details class="el-chart-data" id="data-seats" data-chart-data="seats">/);
  assert.ok(html.includes(`<summary>${CHART_DATA_TEXT.view.replace("'", '&#39;')}</summary>`) || html.includes(`<summary>${CHART_DATA_TEXT.view}</summary>`));
  assert.match(html, /<caption id="data-seats-caption">Seats won by party<\/caption>/);
  // The scrolling wrap can take focus and is named by the caption (keyboard users can scroll it).
  assert.match(html, /<div class="cg-table-wrap el-chart-data__wrap" tabindex="0" role="region" aria-labelledby="data-seats-caption">/);
  assert.match(html, /<th scope="col">Party<\/th><th scope="col" class="num">Seats<\/th>/);
  // The page shows the figures formatted; the first cell of a row is its header.
  assert.match(html, /<tr><th scope="row">Sinn Féin<\/th><td class="num">1,234<\/td><td class="num">27\.0%<\/td><\/tr>/);
  // Escaped, and a missing figure reads as a dash.
  assert.match(html, /<th scope="row">A &quot;quoted&quot;, party<\/th><td class="num">2<\/td><td class="num">—<\/td>/);
  assert.match(html, /download="dail-eireann-2024-seats\.csv"/);
  assert.ok(!html.includes(' open>'), 'closed unless asked');
  assert.match(chartData({ ...SPEC, open: true }), /^<details[^>]* open>/);
  assert.equal(chartData({ ...SPEC, rows: [] }), '', 'no rows, no control');
});

test('the CSV holds the same rows, raw, quoted where it must be', () => {
  const csv = chartCsv(SPEC);
  assert.equal(csv, 'Party,Seats,Share (%)\r\nSinn Féin,1234,27.04\r\n"A ""quoted"", party",2,\r\n');
  // A column can write its CSV value its own way (e.g. rounded as shown).
  const rounded = chartCsv({ columns: [{ label: 'x' }, { label: 'y', csv: (v) => Math.round(Number(v)) }], rows: [['a', 2.6]] });
  assert.equal(rounded, 'x,y\r\na,3\r\n');
  // The link carries it as a data: URL, with a byte-order mark for spreadsheets.
  const href = csvHref(csv);
  assert.ok(href.startsWith('data:text/csv;charset=utf-8,'));
  assert.equal(decodeURIComponent(href.slice('data:text/csv;charset=utf-8,'.length)), `﻿${csv}`);
  const html = chartData(SPEC);
  const linked = /href="([^"]+)" download=/.exec(html)?.[1].replace(/&amp;/g, '&');
  assert.equal(linked, href, 'the page links the CSV of its own table');
});

test('file names and patterns', () => {
  assert.equal(csvFileName('Northern Ireland Assembly 2022: seats!'), 'northern-ireland-assembly-2022-seats.csv');
  assert.equal(csvFileName('***'), 'civgraph-chart.csv');
  assert.equal(fill(CHART_TEXT.transfersAt, { n: 3 }), 'Transfers at count 3');
  assert.equal(fill(CHART_TEXT.seatsOf, { name: 'X' }), 'X: seats won by party');
  assert.equal(fill('{a} {b}', { a: 1 }), '1 {b}');
});

test('every word of the control and of the chart tables is keyed for translation in en.json (R10)', () => {
  const en = JSON.parse(readFileSync(new URL('../../site/assets/i18n/en.json', import.meta.url), 'utf8')).strings;
  const english = new Set(Object.values(en));
  for (const s of [...Object.values(CHART_DATA_TEXT), ...Object.values(CHART_TEXT)]) assert.ok(english.has(s), `not keyed: ${s}`);
});
