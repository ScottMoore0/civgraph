#!/usr/bin/env node
/**
 * REVIEW SCRIPT -- reports only, changes nothing. Not wired into build or check.
 *
 * Finds entries in the browse persons index that are not people.
 *
 * WHY
 *
 * buildPersons() mints a person from every candidate name it sees. That is right for
 * candidates and wrong for anything else that lands in the name field, and two classes of
 * non-person had already reached the index:
 *
 *   - referendum options. "Yes" and "No" carried 1,207 elections each and were the only
 *     two records too large for a single D1 statement. Fixed 2026-08-25 by skipping
 *     referendums at the source.
 *   - PARTY-NAME FRAGMENTS. "Party", "Voice", "Féin" and "Ireland" are the tails of
 *     "...Labour Party", "Traditional Unionist Voice", "Sinn Féin" and
 *     "...of Northern Ireland". This is what the script reports.
 *
 * TRACED TO THE SOURCE, not guessed. In civgraph-elections:
 *
 *     name="Party"  party="SDLP"  local-government-...__2014-05-22   11 rows
 *     name="Party"  party="DUP"   local-government-...__2019-05-02   10 rows
 *     name="Voice"  party="TUV"   local-government-...__2014-05-22    4 rows
 *     name="Féin"   party="Sinn Féin"  local-government-...__2014-05-22  3 rows
 *
 * So the defect is in the CANDIDATE ROWS, not in buildPersons: the ingest that produced
 * those bundles put a fragment of the party name into the candidate name field. It is
 * confined to Northern Ireland local government, 2014 and 2019.
 *
 * That matters for where to fix it. Cleaning it in buildPersons would tidy the persons
 * index and leave the candidate rows wrong -- and those rows are what the election panes,
 * the semantic graph and any future analysis all read.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not delete anything, and it deliberately does not offer a blanket rule. A bare
 * surname can be a real person in older sources, and "stood for 4+ parties" is NOT an
 * artefact signal: 155 people match it, including Eamon de Valera, who genuinely stood
 * for four parties across his career. Any rule aggressive enough to catch the artefacts
 * automatically would delete real people.
 *
 *   node scripts/review/audit-person-name-artefacts.mjs
 *   node scripts/review/audit-person-name-artefacts.mjs --json
 */
import { readFileSync, existsSync } from 'node:fs';

const MANIFEST = 'data/browse/persons.json';
const PARTIES = 'data/browse/parties.json';
const asJson = process.argv.includes('--json');

function readIndex(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.indexLayout !== 'sharded' || !Array.isArray(manifest.shards)) {
    return Array.isArray(manifest.items) ? manifest.items : [];
  }
  const items = [];
  for (const shard of manifest.shards) {
    const file = String(shard.url || '').replace(/^\//, '');
    if (existsSync(file)) items.push(...(JSON.parse(readFileSync(file, 'utf8')).items || []));
  }
  return items;
}

const persons = readIndex(MANIFEST);

// Party names, so "is this name actually a party" is answered from the data rather than
// from a hardcoded list that would rot.
const partyNames = new Set();
if (existsSync(PARTIES)) {
  for (const party of JSON.parse(readFileSync(PARTIES, 'utf8')).items || []) {
    for (const value of [party.title, party.canonicalName, ...(party.observedNames || [])]) {
      if (value) partyNames.add(String(value).toLowerCase().trim());
    }
  }
}
// Every whitespace-separated word of a multi-word party name, which is what the ingest
// defect actually produced.
const partyWords = new Set();
for (const name of partyNames) {
  const words = name.split(/\s+/);
  if (words.length > 1) for (const word of words) if (word.length > 3) partyWords.add(word);
}

const findings = [];
const flag = (person, rule, note) => findings.push({
  slug: person.slug,
  name: person.name || person.title,
  elections: (person.elections || []).length,
  parties: (person.parties || []).length,
  rule,
  note,
});

for (const person of persons) {
  const name = String(person.name || person.title || '').trim();
  if (!name) continue;
  const lower = name.toLowerCase();

  if (partyNames.has(lower)) {
    flag(person, 'name-is-a-party', 'the name is exactly a known party name');
    continue;
  }
  if (!name.includes(' ') && partyWords.has(lower)) {
    flag(person, 'party-name-fragment', 'a single word that is part of a multi-word party name');
    continue;
  }
  if (/^\(.*\)$/.test(name)) {
    flag(person, 'bare-disambiguator', 'the whole name is a parenthesised qualifier');
    continue;
  }
  if (/\(.*\)/.test(name) && /\blist\b/i.test(name)) {
    flag(person, 'candidate-list', 'this is a list name, not a person');
    continue;
  }
  if (/\((politician|Northern Irish politician|Northern Ireland politician)\)/i.test(name)) {
    flag(person, 'wikipedia-disambiguator', 'a real person whose name kept a Wikipedia qualifier');
  }
}

if (asJson) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), total: persons.length, findings }, null, 2));
  process.exit(0);
}

const byRule = new Map();
for (const finding of findings) {
  if (!byRule.has(finding.rule)) byRule.set(finding.rule, []);
  byRule.get(finding.rule).push(finding);
}

console.log(`Persons index: ${persons.length} records. ${findings.length} flagged.\n`);
for (const [rule, rows] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${rule} (${rows.length}) -- ${rows[0].note}`);
  for (const row of rows.slice(0, 12)) {
    console.log(`    ${String(row.name).slice(0, 44).padEnd(46)} elections:${String(row.elections).padStart(4)}  [${row.slug}]`);
  }
  if (rows.length > 12) console.log(`    ... and ${rows.length - 12} more`);
  console.log('');
}
console.log('Nothing was changed. See docs/review/PERSON-NAME-ARTEFACTS.md for the options.');
