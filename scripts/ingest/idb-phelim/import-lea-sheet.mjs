#!/usr/bin/env node
/**
 * Phelim Birch's Local Electoral Areas spreadsheet, brought into the repository as he wrote it.
 *
 * The sheet has two tabs. "By Council Area" is a grid of years (rows) by council (columns): each
 * arrangement of a council's electoral areas is one cell, merged down over the years it was in
 * force, and linked to the order or Act that made it. "List" lists those orders and Acts by the
 * census that followed them. The merges and the links are the substance, so both are kept, with
 * every cell's text exactly as he typed it, its fill colour and his comments.
 *
 *   node scripts/ingest/idb-phelim/import-lea-sheet.mjs <sheet.xlsx> [--link-check <tsv>] [--wire]
 *
 * Writes data/intake/2026-11-23-phelim-lea-sheet.json (the transcription, with provenance). With
 * --link-check, records each link's HTTP status and page title from a TSV of
 * "url <TAB> status <TAB> title" lines (a re-run without it keeps the recorded checks). With
 * --wire, sets the references of the Local Electoral Areas maps in data/database/maps.json to the
 * instruments his List tab gives for each edition (WIRING below); entries it wrote before are
 * replaced, every other reference is left alone. No text is written that is not his or the
 * instrument's own published title.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = path.join(ROOT, 'data', 'intake', '2026-11-23-phelim-lea-sheet.json');
const MAPS = path.join(ROOT, 'data', 'database', 'maps.json');
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1mNuNNYUzPLIUYcBN6NaGbYqVO4xIqPU-m5FZ-4B6grE';
/** The note every reference this script writes carries, so a re-run finds and replaces its own. */
const REF_NOTE = 'Listed by Phelim Birch in his Local Electoral Areas spreadsheet (List tab, following census year {year}).';

/**
 * Which maps take which of his List groups ("Following Census Year"), and, for one council's copy
 * of a national map, which council's instruments only (matched on his By Council Area heading).
 * @type {Array<{ map: string, census: string, council?: string }>}
 */
const WIRING = [
  { map: 'roi-lea-1998', census: '2002' },
  { map: 'roi-lea-2008', census: '2011' },
  { map: 'roi-lea-2014', census: '2016' },
  { map: 'roi-lea-2019', census: '2022' },
  { map: 'oda-map-00140-electoral-areas-roscommon', census: '2016', council: 'Roscommon' },
  { map: 'dlr-local-electoral-areas', census: '2022', council: 'Dún Laoghaire-Rathdown' },
  { map: 'oda-map-00153-local-election-areas', census: '2022', council: 'Galway County' },
];

/** @typedef {{ cell: string, row: number, col: string, text: string, link?: string, fill?: string, font?: string, comments?: Array<{ author: string, text: string }> }} CellOut */
/** @typedef {{ status: string, title?: string }} LinkCheck */
/** @typedef {{ label: string, url?: string, note?: string }} Reference */
/** @typedef {{ id: string, references?: Reference[], [k: string]: unknown }} MapRecord */

const args = process.argv.slice(2);
const xlsxPath = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--link-check');
const linkTsv = args.includes('--link-check') ? args[args.indexOf('--link-check') + 1] : null;
if (!xlsxPath || !existsSync(xlsxPath)) {
  console.error('Usage: node scripts/ingest/idb-phelim/import-lea-sheet.mjs <sheet.xlsx> [--link-check <tsv>] [--wire]');
  process.exit(1);
}

const bytes = readFileSync(xlsxPath);
const wb = XLSX.read(bytes, { cellStyles: true });

/**
 * Every cell with text, a link, a fill or a comment, as the sheet has it.
 * @param {XLSX.WorkSheet} ws
 * @returns {CellOut[]}
 */
function cellsOf(ws) {
  /** @type {CellOut[]} */
  const out = [];
  const range = XLSX.utils.decode_range(/** @type {string} */ (ws['!ref']));
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      /** @type {XLSX.CellObject & { s?: { fgColor?: { rgb?: string }, color?: { rgb?: string } } } | undefined} */
      const cell = ws[ref];
      if (!cell) continue;
      const text = cell.w ?? (cell.v == null ? '' : String(cell.v));
      const fill = cell.s?.fgColor?.rgb;
      const comments = (cell.c || []).map((x) => ({ author: String(x.a || ''), text: String(x.t || '').trim() }));
      if (!text && !cell.l && !fill && !comments.length) continue;
      /** @type {CellOut} */
      const o = { cell: ref, row: r + 1, col: XLSX.utils.encode_col(c), text };
      if (cell.l?.Target) o.link = cell.l.Target;
      if (fill) o.fill = `#${fill.toUpperCase()}`;
      if (comments.length) o.comments = comments;
      out.push(o);
    }
  }
  return out;
}

/** @param {XLSX.WorkSheet} ws */
const mergesOf = (ws) => (ws['!merges'] || []).map((m) => XLSX.utils.encode_range(m)).sort();

// ------------------------------------------------------------------ By Council Area
const grid = wb.Sheets['By Council Area'];
const list = wb.Sheets['List'];
if (!grid || !list) throw new Error(`expected tabs "By Council Area" and "List", found ${wb.SheetNames.join(', ')}`);
const gridCells = cellsOf(grid);
const at = new Map(gridCells.map((c) => [c.cell, c]));
/** @type {Map<number, string>} */
const yearOfRow = new Map(gridCells.filter((c) => c.col === 'A' && c.row > 1).map((c) => [c.row, c.text]));
const councils = gridCells.filter((c) => c.row === 1 && c.col !== 'A').map((c) => ({ col: c.col, council: c.text }));
const gridMerges = mergesOf(grid);

// One arrangement per top-left cell with text: its years are those of the rows its merge covers
// (one row when it is not merged), and a merge across columns is shared by those councils.
/** @type {Map<string, XLSX.Range>} */
const mergeAt = new Map((grid['!merges'] || []).map((m) => [XLSX.utils.encode_cell(m.s), m]));
const arrangements = [];
for (const c of gridCells) {
  if (c.row === 1 || c.col === 'A' || !c.text) continue;
  const m = mergeAt.get(c.cell);
  const lastRow = m ? m.e.r + 1 : c.row;
  const cols = m ? Array.from({ length: m.e.c - m.s.c + 1 }, (_, i) => XLSX.utils.encode_col(m.s.c + i)) : [c.col];
  arrangements.push({
    councils: cols.map((col) => councils.find((x) => x.col === col)?.council || col),
    text: c.text,
    from: yearOfRow.get(c.row) || '',
    to: yearOfRow.get(lastRow) || '',
    cells: m ? XLSX.utils.encode_range(m) : c.cell,
    ...(c.link ? { link: c.link } : {}),
    ...(c.fill ? { fill: c.fill } : {}),
    ...(c.comments ? { comments: c.comments } : {}),
  });
}

// ------------------------------------------------------------------ List
const listCells = cellsOf(list);
/** @type {Map<number, Map<string, CellOut>>} */
const listRows = new Map();
for (const c of listCells) {
  if (!listRows.has(c.row)) listRows.set(c.row, new Map());
  /** @type {Map<string, CellOut>} */ (listRows.get(c.row)).set(c.col, c);
}
// The census year sits in column A merged down over its group.
/** @type {Map<number, string>} */
const censusOfRow = new Map();
for (const m of list['!merges'] || []) {
  if (m.s.c !== 0 || m.e.c !== 0) continue;
  const v = listRows.get(m.s.r + 1)?.get('A')?.text || '';
  for (let r = m.s.r; r <= m.e.r; r++) censusOfRow.set(r + 1, v);
}
const instruments = [];
for (const [row, cols] of [...listRows].sort((a, b) => a[0] - b[0])) {
  if (row <= 2) continue;
  const a = cols.get('A'), b = cols.get('B'), c = cols.get('C');
  const census = censusOfRow.get(row) || a?.text || '';
  instruments.push({
    row,
    census,
    instrument: b?.text || '',
    councilArea: c?.text || '',
    ...(c?.link ? { link: c.link } : {}),
    ...(c?.fill || b?.fill || a?.fill ? { fill: c?.fill || b?.fill || a?.fill } : {}),
    ...(c?.comments || b?.comments ? { comments: [...(b?.comments || []), ...(c?.comments || [])] } : {}),
  });
}

// ------------------------------------------------------------------ link checks
/** @type {Record<string, LinkCheck>} */
let linkChecks = {};
let linkCheckedAt = '';
if (existsSync(OUT)) {
  const prev = JSON.parse(readFileSync(OUT, 'utf8'));
  linkChecks = prev.linkCheck?.results || {};
  linkCheckedAt = prev.linkCheck?.checkedAt || '';
}
if (linkTsv) {
  linkChecks = {};
  for (const line of readFileSync(linkTsv, 'utf8').split(/\r?\n/)) {
    const [url, status, title] = line.split('\t');
    if (!url) continue;
    linkChecks[url] = { status: status || '', ...(title?.trim() ? { title: decodeEntities(title.trim()) } : {}) };
  }
  linkCheckedAt = new Date().toISOString().slice(0, 10);
}
/** @param {string} s */
function decodeEntities(s) {
  return s.replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}
/** The check of a link: an Internet Archive page is checked by its item. @param {string} url */
function checkOf(url) {
  const ia = url.match(/^https:\/\/archive\.org\/details\/([^/]+)/);
  return linkChecks[url] || (ia ? linkChecks[`https://archive.org/details/${ia[1]}`] : undefined);
}

const out = {
  schemaVersion: 1,
  title: 'Local Electoral Areas spreadsheet (Phelim Birch)',
  author: 'Phelim Birch',
  licence: 'Provided by the author for Civgraph',
  credit: 'Phelim Birch',
  received: '2026-11-21: linked in his answer 2.2 in the catalogue-review response document',
  approvedForImport: '2026-11-23 (owner)',
  source: {
    url: SHEET_URL,
    sharing: 'Shared with named accounts only: the sheet itself is not public. Its content is published here, credited to him; the original is not linked from the site.',
    exported: '2026-11-23 13:36, as .xlsx through the owner\'s browser',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  },
  transcription: 'Every cell with text, a link, a fill or a comment, verbatim, with the merged ranges; written by scripts/ingest/idb-phelim/import-lea-sheet.mjs. `arrangements` and `instruments` restate the two tabs one entry per cell or row and add nothing: an arrangement\'s from/to are the years of the first and last rows its merge covers.',
  legend: {
    List: listRows.get(2)?.get('A')?.text || '',
  },
  linkCheck: {
    checkedAt: linkCheckedAt,
    about: 'Each distinct link fetched once, one at a time (an Internet Archive page by its item\'s metadata), for its HTTP status and page title. "SKIPPED-subscription": a subscription site, not fetched and not linked from the site.',
    results: linkChecks,
  },
  tabs: {
    'By Council Area': {
      dimensions: grid['!ref'],
      councils,
      arrangements,
      merges: gridMerges,
      cells: gridCells,
    },
    List: {
      dimensions: list['!ref'],
      instruments,
      merges: mergesOf(list),
      cells: listCells,
    },
  },
};

writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
console.log(`wrote ${path.relative(ROOT, OUT)}: ${arrangements.length} arrangements, ${instruments.length} List rows, ${Object.keys(linkChecks).length} links checked`);

// ------------------------------------------------------------------ wiring
if (args.includes('--wire')) {
  const db = JSON.parse(readFileSync(MAPS, 'utf8'));
  /** @type {Map<string, MapRecord>} */
  const byId = new Map(db.maps.map((/** @type {MapRecord} */ m) => [m.id, m]));
  // The council a grid link belongs to, by his By Council Area headings (one URL, one or more councils).
  /** @type {Map<string, string[]>} */
  const councilsOfLink = new Map();
  for (const a of arrangements) if (a.link) councilsOfLink.set(a.link, [...new Set([...(councilsOfLink.get(a.link) || []), ...a.councils])]);
  for (const w of WIRING) {
    const rec = byId.get(w.map);
    if (!rec) { console.warn(`skip ${w.map}: not in maps.json`); continue; }
    const rows = instruments.filter((i) => i.census === w.census && i.link)
      .filter((i) => !w.council || (councilsOfLink.get(/** @type {string} */ (i.link)) || []).includes(w.council));
    /** @type {Reference[]} */
    const refs = [];
    for (const i of rows) {
      const url = /** @type {string} */ (i.link);
      const check = checkOf(url);
      if (!check || check.status !== '200') { console.warn(`skip ${url} (${w.map}): link not checked as public`); continue; }
      // The instrument's title as the Irish Statute Book publishes it, when that page is his
      // instrument's; else his own text.
      const title = /irishstatutebook\.ie/.test(url) && check.title?.startsWith(`${i.instrument} - `) ? check.title : '';
      const label = title || `${i.instrument} (${i.councilArea})`;
      refs.push({ label: label.replace(/\s+/g, ' ').trim(), url, note: REF_NOTE.replace('{year}', w.census) });
    }
    const mine = (/** @type {Reference} */ r) => typeof r.note === 'string' && r.note.startsWith('Listed by Phelim Birch in his Local Electoral Areas spreadsheet');
    rec.references = [...(rec.references || []).filter((r) => !mine(r)), ...refs];
    console.log(`${w.map}: ${refs.length} instrument reference(s)`);
  }
  writeFileSync(MAPS, `${JSON.stringify(db, null, 2)}\n`);
}
