#!/usr/bin/env node
/**
 * A candidate whose whole name is a word of their own party's name is always wrong.
 *
 * WHAT THIS CATCHES
 *
 * Something in the ingest that produced the 2014 and 2019 Northern Ireland local government
 * bundles split a "Name, Party" string in the wrong place and put the TAIL OF THE PARTY into
 * the candidate name field:
 *
 *     name="Party"    party="SDLP"        <- ...Social Democratic and Labour PARTY
 *     name="Voice"    party="TUV"         <- Traditional Unionist VOICE
 *     name="Ireland"  party="Alliance"    <- Alliance Party of Northern IRELAND
 *     name="Féin"     party="Sinn Féin"   <- Sinn FÉIN
 *
 * 62 candidate rows across 19,199. They reached the persons index as four "people" --
 * name-party with 47 elections, name-ireland with 7, name-voice with 5, name-fein with 3 --
 * and from there into the election panes and the semantic graph.
 *
 * WHY THE RULE IS SHAPED THIS WAY
 *
 * The whole name must be a SINGLE WORD, and that word must belong to THAT CANDIDATE'S OWN
 * party. Both halves of that are load-bearing, and the reason is Denis Ireland.
 *
 * Denis Ireland was a real Northern Ireland senator and writer. Boyd Ireland is likewise a
 * real candidate. A rule that flagged any name CONTAINING a party word would delete them
 * both. A rule that flagged single-word names generally would delete legitimate bare
 * surnames, which are common in older sources. A rule that compared against ALL party names
 * rather than the candidate's own would flag anyone surnamed Green, Alliance or Unionist.
 *
 * Measured before this was written: the rule as implemented flags 62 rows, all four of the
 * known artefacts and nothing else. "Denis Ireland" and "Boyd Ireland" are untouched because
 * their names are two words.
 *
 * THE ABBREVIATION TABLE
 *
 * data/browse/parties.json cannot answer "what is SDLP short for" -- every entry has an
 * empty observedNames, and the file is polluted with occupation strings ("SDLP (Teacher)",
 * "Farmer SDLP"). So the expansions live here, explicitly, where they can be read and
 * argued with. Only parties that actually appear in the defect are needed; adding more is
 * safe but pointless.
 *
 * Offline, so this belongs to `check:` rather than `verify:`.
 *
 *   node scripts/validate-candidate-name-party.mjs
 *   node scripts/validate-candidate-name-party.mjs --list
 *   node scripts/validate-candidate-name-party.mjs --update-baseline
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const BUNDLES = 'data/elections-source/data/elections';
const BASELINE = 'data/database/candidate-name-party-baseline.json';
const LIST = process.argv.includes('--list');
const UPDATE = process.argv.includes('--update-baseline');

const norm = (value) => String(value || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Abbreviation -> the full party name whose words are forbidden as a whole candidate name.
const EXPANSIONS = {
  sdlp: 'social democratic and labour party',
  dup: 'democratic unionist party',
  uup: 'ulster unionist party',
  tuv: 'traditional unionist voice',
  sf: 'sinn fein',
  apni: 'alliance party of northern ireland',
  alliance: 'alliance party of northern ireland',
  ukip: 'uk independence party',
  pup: 'progressive unionist party',
  nilp: 'northern ireland labour party',
  wp: 'workers party',
  pbp: 'people before profit',
  pbpa: 'people before profit alliance',
  green: 'green party northern ireland',
};

/** Words of a party's full name that are long enough to be a plausible surname. */
function forbiddenWords(party) {
  const key = norm(party);
  const expanded = EXPANSIONS[key] || key;
  const words = new Set();
  for (const word of expanded.split(' ')) if (word.length > 3) words.add(word);
  // A spelled-out party contributes its own words too, so "Sinn Féin" catches "Féin"
  // whether the row says "SF" or "Sinn Féin".
  for (const word of key.split(' ')) if (word.length > 3) words.add(word);
  return words;
}

const findings = [];
let scanned = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!entry.name.endsWith('.json') || entry.name.startsWith('_')) continue;
    let payload;
    try { payload = JSON.parse(readFileSync(full, 'utf8')); } catch { continue; }
    const block = payload.Constituency;
    if (!block || !Array.isArray(block.countGroup)) continue;

    const seen = new Set();
    for (const row of block.countGroup) {
      const key = row.Candidate_Id || row.candidateName;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      scanned++;

      const name = norm(row.candidateName || `${row.Firstname || ''} ${row.Surname || ''}`);
      if (!name || !row.Party_Name) continue;
      const parts = name.split(' ').filter(Boolean);
      // ONE word only. "Denis Ireland" is two, and is a real person.
      if (parts.length !== 1) continue;
      if (!forbiddenWords(row.Party_Name).has(parts[0])) continue;

      findings.push({
        name: row.candidateName || parts[0],
        party: row.Party_Name,
        file: path.relative(BUNDLES, full).split(path.sep).join('/'),
      });
    }
  }
}
walk(BUNDLES);

if (LIST) {
  for (const finding of findings) {
    console.log(`${finding.name}\t${finding.party}\t${finding.file}`);
  }
  process.exit(0);
}

// BASELINED, NOT IGNORED.
//
// The existing rows cannot be repaired from the data. In Braid 2014 the Sinn Fein row is
// ` Féin` with an EMPTY forename: the candidate's real name was consumed by the split and
// is not recoverable from the bundle. Guessing at it would invent a person, which is exactly
// the failure this file exists to catch.
//
// So they are pinned, the way check:local-paths pins its known offenders. The gate stays
// green, every existing case stays visible and counted, and a NEW one fails the build. The
// pinned rows are incomplete data and should be marked as such at the source, once whoever
// holds the original candidate lists can supply the names.
// The baseline stores a COUNT per identity, not a set of identities.
//
// One constituency file can legitimately contain the same artefact twice -- Newry and Mourne
// 2014 has two "Party | SDLP" rows -- so file|name|party is not unique. Stored as a set, 63
// rows collapsed to 60 keys, and a genuinely new third occurrence in an already-pinned file
// would have passed silently. That is the same false-green shape as a check that verifies
// something other than what it just did, so it is counted instead.
const identity = (finding) => `${finding.file}|${finding.name}|${finding.party}`;
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { known: {} };
const known = baseline.known || {};

const tally = (list) => {
  const counts = {};
  for (const finding of list) counts[identity(finding)] = (counts[identity(finding)] || 0) + 1;
  return counts;
};
const current = tally(findings);

if (UPDATE) {
  writeFileSync(BASELINE, `${JSON.stringify({
    note: 'Candidate rows whose whole name is one word of their own party name. Known, not '
      + 'repairable from the bundles, and pinned so a NEW occurrence fails the gate. See '
      + 'scripts/validate-candidate-name-party.mjs for why they cannot be fixed here. '
      + 'Values are row counts: one file can carry the same artefact more than once.',
    updated: '2026-08-28',
    rows: findings.length,
    known: Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b))),
  }, null, 2)}\n`);
  console.log(`Baseline updated: ${findings.length} row(s) across ${Object.keys(current).length} key(s).`);
  process.exit(0);
}

const fresh = [];
for (const [entry, count] of Object.entries(current)) {
  const allowed = known[entry] || 0;
  if (count > allowed) fresh.push({ entry, count, allowed });
}
const stale = Object.keys(known).filter((entry) => !current[entry]);
if (stale.length) {
  console.log(`${stale.length} baselined row(s) are now clean. Re-pin with --update-baseline.`);
}

if (fresh.length) {
  console.error(`FAIL: ${fresh.length} candidate row group(s) exceed the pinned baseline.`);
  for (const item of fresh.slice(0, 20)) {
    console.error(`    ${item.entry}   found ${item.count}, pinned ${item.allowed}`);
  }
  console.error('  A candidate whose entire name is one word of their own party name is a');
  console.error('  split "Name, Party" string, not a person. These reach the persons index');
  console.error('  as people and from there into the election panes and the graph.');
  console.error('  Fix the ingest that produced the bundle, not the persons index.');
  console.error('  Full list:  node scripts/validate-candidate-name-party.mjs --list');
  process.exit(1);
}

console.log(`PASS: ${scanned} candidate rows; ${findings.length} known artefact(s) pinned across ${Object.keys(known).length} key(s), no new ones.`);
