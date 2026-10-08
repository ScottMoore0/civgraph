#!/usr/bin/env node
/**
 * Compare the rebuilt catalogue with today's, from the CSV export of today's pane
 * (the "entries" CSV: one row per map or election as the live pane shows it).
 *
 *   node scripts/catalogue/parity-report.mjs <entries.csv> [--out report.md]
 *
 * Answers: is every map and election reachable in today's pane still reachable in the new one,
 * and what does the new one add (maps today's pane does not show)? Exits 1 if anything today's
 * pane shows is missing from the new catalogue.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadRecords } from './records.mjs';

const [csvPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const outIdx = process.argv.indexOf('--out');
if (!csvPath) { console.error('usage: parity-report.mjs <entries.csv> [--out report.md]'); process.exit(2); }

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const rows = parseCsv(readFileSync(csvPath, 'utf8').replace(/^﻿/, ''));
const head = rows.shift();
const col = (name) => head.indexOf(name);
const ID = col('Map or election id');
const catalogue = JSON.parse(readFileSync('data/catalogue/catalogue.json', 'utf8'));
const source = JSON.parse(readFileSync('data/catalogue/catalogue.source.json', 'utf8'));

const { records } = loadRecords();
const inSeries = new Map();
for (const s of catalogue.series) for (const m of [...s.members, ...(s.local || [])]) inSeries.set(m.id, s.id);
const toBeAdded = new Set([...source.subjects.flatMap((s) => s.toBeAdded || []), ...source.series.flatMap((s) => s.toBeAdded || [])]);
const electionIds = new Set(catalogue.elections.map((e) => `${e.body} ${e.date}`));

const todayMaps = new Set();
const todayElections = new Set();
for (const r of rows) {
  const id = (r[ID] || '').trim();
  if (!id) continue;
  if (id.startsWith('election: ')) todayElections.add(id.slice('election: '.length));
  else todayMaps.add(id);
}
// A part (a county sheet, a river-basin tile) is reached through its parent's series.
const asPart = [...todayMaps].filter((id) => !inSeries.has(id) && !toBeAdded.has(id) && inSeries.has(records.get(id)?.partOf));
// A map hidden on purpose (source.hidden) whose parts the rebuilt catalogue places itself.
const hiddenIds = new Set((source.hidden || []).map((h) => h.id));
const viaParts = [...todayMaps].filter((id) => !inSeries.has(id) && hiddenIds.has(id)
  && [...records.values()].some((r) => r.partOf === id && inSeries.has(r.id)));
const missingMaps = [...todayMaps].filter((id) => !inSeries.has(id) && !toBeAdded.has(id) && !asPart.includes(id) && !viaParts.includes(id));
const nowToBeAdded = [...todayMaps].filter((id) => !inSeries.has(id) && toBeAdded.has(id));
const missingElections = [...todayElections].filter((k) => !electionIds.has(k));
const added = [...inSeries.keys()].filter((id) => !todayMaps.has(id));

const lines = [
  '# Catalogue parity: today\'s pane against the rebuilt catalogue',
  '',
  `Today's pane (from ${csvPath.split(/[\\/]/).pop()}): ${todayMaps.size} maps, ${todayElections.size} elections.`,
  `Rebuilt: ${catalogue.series.length} series holding ${inSeries.size} maps, ${toBeAdded.size} maps listed as to be added, ${catalogue.elections.length} elections.`,
  '',
  `- Maps shown today that the rebuilt catalogue places in a series: ${todayMaps.size - missingMaps.length - nowToBeAdded.length - asPart.length}`,
  `- Maps shown today that the rebuilt catalogue shows as parts of a map in a series: ${asPart.length}`,
  `- Maps shown today that the rebuilt catalogue lists as to be added: ${nowToBeAdded.length}`,
  `- Maps shown today that the rebuilt catalogue hides and shows through their parts instead: ${viaParts.length}`,
  `- Maps shown today that the rebuilt catalogue does not have: **${missingMaps.length}**`,
  `- Elections shown today that the rebuilt catalogue does not have: **${missingElections.length}**`,
  `- Maps in the rebuilt catalogue's series that today's pane does not show: ${added.length}`,
  '',
];
const list = (title, ids, fmt = (x) => x) => { if (ids.length) lines.push(`## ${title}`, '', ...ids.map((x) => `- ${fmt(x)}`), ''); };
list('Missing maps', missingMaps);
list('Missing elections', missingElections);
list('Shown today, now listed as to be added', nowToBeAdded, (id) => `${id} — ${catalogue.maps[id]?.name || ''} (${catalogue.maps[id]?.status || ''})`);
list('New to the pane', added, (id) => `${id} — ${catalogue.maps[id]?.name || ''} (in ${inSeries.get(id)})`);
const report = lines.join('\n');
if (outIdx > 0) writeFileSync(process.argv[outIdx + 1], report);
console.log(lines.slice(0, 12).join('\n'));
process.exit(missingMaps.length || missingElections.length ? 1 : 0);
