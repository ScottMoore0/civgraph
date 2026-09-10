#!/usr/bin/env node
/**
 * The candidacies whose candidate name was lost before Civgraph ever saw the data.
 *
 * WHY THIS FILE EXISTS
 *
 * Something upstream split a "Name, Party" string in the wrong place and wrote the tail
 * of the party into the name field. The vendored source rows already carry
 * `"Firstname": ""` with the fragment sitting in `Surname`, so the real name is absent
 * rather than mangled and nothing held locally can recover it.
 *
 * These are not bad rows to be deleted. They are real candidacies with real votes, and
 * most of them were won. What is missing is only the name. The persons index suppresses
 * them so the site does not claim a person called "Party" exists, which is correct and
 * also makes them easy to forget, because nothing user-facing shows the gap any more.
 *
 * So the gap is written down. Every row keeps its EONI `Candidate_Id`, which did survive,
 * and that is the key an external lookup against EONI or the original returns would use.
 * The point is to turn an open-ended "someone should chase this" into a bounded worklist
 * with identifiers, a row count and a clear finish line, which is a far better thing to
 * hand a volunteer than an unscoped request.
 *
 * The output is a CSV rather than JSON because the people most likely to fill it in work
 * in spreadsheets.
 *
 * Usage:
 *   node scripts/build-unnamed-candidacies.mjs [--check]
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { buildPartyVocabulary, classifyPersonName, NOT_A_PERSON } from './lib/person-name-artefacts.mjs';

const ROOT = process.cwd();
const META = path.join(ROOT, 'render/metadata/elections-test2');
const PARTIES = path.join(ROOT, 'data/browse/parties.json');
const OUT = path.join(ROOT, 'data/elections/persons/unnamed-candidacies.csv');
const check = process.argv.includes('--check');

if (!existsSync(META)) {
  console.error(`FAIL: ${path.relative(ROOT, META)} does not exist.`);
  process.exit(1);
}
if (!existsSync(PARTIES)) {
  console.error('FAIL: data/browse/parties.json does not exist; run scripts/build-browse-indexes.mjs first.');
  process.exit(1);
}

const vocabulary = buildPartyVocabulary(JSON.parse(readFileSync(PARTIES, 'utf8')).items || []);

const rows = [];
for (const file of readdirSync(META).filter((f) => f.endsWith('.json')).sort()) {
  const doc = JSON.parse(readFileSync(path.join(META, file), 'utf8'));
  // Referendums have OPTIONS, not candidates, so "Yes" and "No" are not lost names.
  // Detected the way buildPersons and the runtime detect it, so the three agree.
  const key = doc.key || file.replace(/\.json$/, '');
  const isReferendum = [doc.contestType, doc.type, doc.body, key]
    .some((v) => String(v || '').toLowerCase().includes('referendum'));
  if (isReferendum) continue;
  for (const result of doc.results || []) {
    for (const candidate of result.candidates || []) {
      const name = String(candidate.name || '').trim();
      if (!NOT_A_PERSON.has(classifyPersonName(name, vocabulary))) continue;
      rows.push({
        candidate_id: candidate.id ?? '',
        election_key: key,
        date: doc.date || '',
        constituency: result.constituency || result.featureName || '',
        party: candidate.party || '',
        first_prefs: candidate.firstPrefs ?? '',
        elected: candidate.elected ? 'yes' : 'no',
        recorded_name: name,
        recovered_name: '',
      });
    }
  }
}

rows.sort((a, b) => (a.date.localeCompare(b.date))
  || a.constituency.localeCompare(b.constituency)
  || String(a.candidate_id).localeCompare(String(b.candidate_id)));

const COLUMNS = ['candidate_id', 'election_key', 'date', 'constituency', 'party',
  'first_prefs', 'elected', 'recorded_name', 'recovered_name'];
const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = `${[COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(','))].join('\n')}\n`;

const existing = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
const elected = rows.filter((r) => r.elected === 'yes').length;

console.log('Unnamed candidacies');
console.log(`  rows            ${rows.length}`);
console.log(`  of which won    ${elected}`);
console.log(`  elections       ${new Set(rows.map((r) => r.election_key)).size}`);
console.log(`  recorded names  ${[...new Set(rows.map((r) => r.recorded_name))].join(', ')}`);

if (check) {
  if (existing !== csv) {
    console.error(`\nFAIL: ${path.relative(ROOT, OUT)} is out of date. Re-run without --check.`);
    process.exit(1);
  }
  console.log('\nPASS: the worklist matches the data.');
} else if (existing === csv) {
  console.log(`\nUnchanged; ${path.relative(ROOT, OUT)} left as it is.`);
} else {
  // `recovered_name` is preserved deliberately: regenerating must never wipe work someone
  // has already done in the sheet. If any is present, refuse rather than overwrite.
  if (existing && /,[^,\n]+\n?$/m.test(existing) && existing.split('\n').some((line) => line.trim().endsWith(',') === false && line.split(',').length === COLUMNS.length && line.split(',').pop().trim() !== '' && !line.startsWith('candidate_id'))) {
    console.error(`\nFAIL: ${path.relative(ROOT, OUT)} already has recovered names in it. Merge by hand rather than regenerating.`);
    process.exit(1);
  }
  writeFileSync(OUT, csv);
  console.log(`\nWrote ${path.relative(ROOT, OUT)}`);
}
