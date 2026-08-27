#!/usr/bin/env node
/**
 * REVIEW SCRIPT -- reports only, writes nothing. Not wired into build or check.
 *
 * Can the 822 candidate records extracted from Belfast newspaper Statements of Persons
 * Nominated be joined to Civgraph's existing election data?
 *
 * WHY THIS EXISTS
 *
 * archive/ocr/ holds LLM-extracted SPN data -- candidates with addresses, party
 * descriptions, PROPOSERS, SECONDERS and ELECTION AGENTS. Those last three are recorded
 * nowhere else in Civgraph. Publishing them means attaching each OCR candidate to a
 * candidate row in an existing contest, and the question that decides whether it is worth
 * doing is simply: how many of the 822 actually join?
 *
 * WHY MATCHING IS NOT DRIVEN BY THE EXTRACTED ELECTION NAME
 *
 * The obvious key -- the LLM's `election_name` -- is the least trustworthy field in the
 * file. Measured across the 70 records it carries 32 distinct values for perhaps a dozen
 * real elections ("Local Election 1985", "Local Elections 1985", "District Council Election
 * 1985" and "Local Elections (Northern Ireland) Order 1985" are one contest), 14 records
 * say "Unknown", and at least three are wrong outright:
 *
 *   - "Northern Ireland Parliamentary Election 1938" on a paper dated 1958-03-10
 *   - "Westminster General Election 1975" -- there was no 1975 Westminster general election
 *   - "Westminster General Election 1986" -- nor a 1986 one; that is the January by-elections
 *
 * Those are exactly the plausible-looking errors that make unverified LLM output dangerous,
 * and they would have propagated silently into a name-keyed join.
 *
 * So the join is proposed from EVIDENCE INSTEAD: the newspaper's own publication date
 * (encoded in the filename, and not LLM-derived) narrows the field to contests within a
 * window, and the winner is chosen by how many candidate SURNAMES the OCR record and the
 * Civgraph contest actually share. A mapping the candidate names agree with is a mapping
 * that has been tested; one asserted from dates alone is a mapping that has not.
 *
 * The hand-written overrides in data/database/spn-ocr-election-map.json are applied on top,
 * for records where the evidence is genuinely ambiguous, and this script reports where an
 * override disagrees with the evidence rather than silently preferring either.
 *
 *   node scripts/review/match-spn-ocr-candidates.mjs
 *   node scripts/review/match-spn-ocr-candidates.mjs --json
 *   node scripts/review/match-spn-ocr-candidates.mjs --sample 50   # verification worksheet
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const OCR_DIR = 'archive/ocr';
const BUNDLES = 'data/elections-source/data/elections';
const OVERRIDES = 'data/database/spn-ocr-election-map.json';
const WINDOW_DAYS = 120;

const asJson = process.argv.includes('--json');
const sampleAt = process.argv.indexOf('--sample');
const sampleSize = sampleAt >= 0 ? Number(process.argv[sampleAt + 1] || 50) : 0;

/* ------------------------------------------------------------------ helpers */

const COMBINING = /[̀-ͯ]/g;

// Apostrophes are DELETED, not turned into spaces. "M'DOWELL" and "O'NEILL" are single
// surnames; replacing the apostrophe with a space splits them into two words and the
// surname extracted from the tail is "DOWELL"/"NEILL", which matches nothing. Both spellings
// are common in 1950s nomination notices.
const strip = (value) => String(value || '')
  .normalize('NFD').replace(COMBINING, '')
  .toUpperCase().replace(/['‘’ʼ`]/g, '')
  .replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Mc / Mac / M' are the same prefix spelled three ways, and the two sides of this join do
// not agree on which: the SPNs print "M'DOWELL" and "McATEER", Civgraph carries "McDowell"
// and "MacAteer". Fold them all to MC before comparing surnames.
// The apostrophe must be read BEFORE strip() deletes it: "M'DOWELL" is a Mc name and
// "MINFORD" is not, and once the apostrophe is gone the two are indistinguishable. An
// earlier version folded any M followed by three letters, which turned MINFORD into
// MCINFORD and MULLAN into MCLLAN -- it silently broke every M surname in the corpus and
// showed up only as an implausible number of "absent" values in the verification pass.
const surnameKey = (value) => {
  const raw = String(value || '').normalize('NFD').replace(COMBINING, '').toUpperCase();
  const isApostropheMc = /^M['‘’ʼ`](?=[A-Z])/.test(raw.trim());
  const bare = strip(value).replace(/\s+/g, '');
  if (isApostropheMc) return `MC${bare.slice(1)}`;
  return bare.replace(/^MAC(?=[A-Z]{3})/, 'MC');
};

/**
 * Do two forenames agree?
 *
 * Older Civgraph rows carry INITIALS ONLY -- "W. J. McCracken" arrives as Firstname "W. J."
 * -- while the nomination notice prints "WILLIAM JOHN". Comparing those as strings fails,
 * so when either side is initials-only the comparison is made on the initials.
 */
function forenamesAgree(a, b) {
  if (!a || !b) return { agree: true, strong: false };
  if (a === b || a.startsWith(b) || b.startsWith(a)) return { agree: true, strong: true };
  const initials = (value) => value.split(' ').filter(Boolean).map((word) => word[0]).join('');
  const isInitialsOnly = (value) => value.split(' ').filter(Boolean).every((word) => word.length === 1);
  if (isInitialsOnly(a) || isInitialsOnly(b)) {
    const ia = initials(a);
    const ib = initials(b);
    if (ia === ib) return { agree: true, strong: true };
    if (ia.startsWith(ib) || ib.startsWith(ia)) return { agree: true, strong: true };
    return { agree: false, strong: false };
  }
  return { agree: a[0] === b[0], strong: false };
}

/** "ARMSTRONG, Christopher" -> {surname, forename}. Also handles "Christopher Armstrong". */
function splitName(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (value.includes(',')) {
    const [surname, rest] = value.split(',');
    return { surname: surnameKey(surname), forename: strip(rest) };
  }
  const parts = strip(value).split(' ').filter(Boolean);
  if (parts.length < 2) return { surname: surnameKey(parts[0] || ''), forename: '' };
  return { surname: surnameKey(parts[parts.length - 1]), forename: parts.slice(0, -1).join(' ') };
}

// Constituency names in the SPNs are prose, not identifiers: "SOUTH DOWN CONSTITUENCY",
// "Iveagh Division", "District of Newry and Mourne - District Electoral Area Crotlieve".
// Reduce both sides to the bare place name before comparing.
const NOISE = /\b(CONSTITUENCY|DIVISION|DISTRICT ELECTORAL AREA|ELECTORAL AREA|DISTRICT OF|BOROUGH OF|COUNTY OF|PARLIAMENTARY|DISTRICT|AREA|THE)\b/g;
const place = (value) => strip(value).replace(NOISE, ' ').replace(/\s+/g, ' ').trim();

const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

/* ------------------------------------------------------- load the OCR records */

const ocrRecords = [];
for (const file of readdirSync(OCR_DIR).sort()) {
  if (!file.endsWith('.json')) continue;
  const stem = file.replace(/\.json$/, '');
  const dateMatch = stem.match(/^BL_(\d+)_(\d{4})(\d{2})(\d{2})/);
  if (!dateMatch) continue;
  let payload;
  try { payload = JSON.parse(readFileSync(path.join(OCR_DIR, file), 'utf8')); } catch { continue; }

  const candidates = [];
  for (const constituency of payload.constituencies || []) {
    for (const candidate of constituency.candidates || []) {
      const parsed = splitName(candidate.name);
      if (!parsed || !parsed.surname) continue;
      candidates.push({
        constituency: constituency.constituency_name || '',
        raw: candidate.name,
        surname: parsed.surname,
        forename: parsed.forename,
        address: candidate.address || null,
        description: candidate.description || null,
        proposer: candidate.proposer || null,
        seconder: candidate.seconder || null,
        agent: candidate.agent_name || null,
        agentAddress: candidate.agent_address || null,
      });
    }
  }
  ocrRecords.push({
    file,
    stem,
    paper: dateMatch[1],
    paperDate: `${dateMatch[2]}-${dateMatch[3]}-${dateMatch[4]}`,
    electionName: payload.election_name || '',
    candidates,
  });
}

/* ------------------------------------------- load every Civgraph contest once */

const contests = [];
function loadContests(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { loadContests(full); continue; }
    if (!entry.name.endsWith('.json') || entry.name.startsWith('_')) continue;
    let payload;
    try { payload = JSON.parse(readFileSync(full, 'utf8')); } catch { continue; }
    const block = payload.Constituency;
    if (!block || !Array.isArray(block.countGroup)) continue;

    const rel = path.relative(BUNDLES, full).split(path.sep);
    if (rel.length < 3) continue;
    const body = rel[0];
    const date = rel[1];
    if (!/^\d{4}-\d{2}-\d{2}/.test(date)) continue;

    const seen = new Map();
    for (const row of block.countGroup) {
      const key = row.Candidate_Id || row.candidateName;
      if (!key || seen.has(key)) continue;
      const parsed = splitName(row.candidateName);
      const surname = surnameKey(row.Surname) || (parsed ? parsed.surname : '');
      if (!surname) continue;
      seen.set(key, {
        id: row.Candidate_Id || null,
        name: row.candidateName || `${row.Firstname || ''} ${row.Surname || ''}`.trim(),
        surname,
        forename: strip(row.Firstname),
        party: row.Party_Name || null,
      });
    }
    const people = [...seen.values()];
    contests.push({
      body,
      date: date.slice(0, 10),
      file: rel.join('/'),
      constituency: (block.countInfo && block.countInfo.Constituency_Name) || entry.name.replace(/\.json$/, ''),
      candidates: people,
      surnames: new Set(people.map((c) => c.surname)),
    });
  }
}
loadContests(BUNDLES);

/* ------------------------------------------------------ propose the election */

const overrides = existsSync(OVERRIDES)
  ? (JSON.parse(readFileSync(OVERRIDES, 'utf8')).mappings || {})
  : {};

const results = [];
for (const record of ocrRecords) {
  const surnames = new Set(record.candidates.map((c) => c.surname));
  const nearby = contests.filter((c) => days(c.date, record.paperDate) <= WINDOW_DAYS);

  // Score a whole election (body+date), not a single constituency: an SPN page usually
  // covers several constituencies of one contest.
  const byElection = new Map();
  for (const contest of nearby) {
    const key = `${contest.body}__${contest.date}`;
    if (!byElection.has(key)) {
      byElection.set(key, { key, body: contest.body, date: contest.date, hits: new Set() });
    }
    const bucket = byElection.get(key);
    for (const surname of contest.surnames) if (surnames.has(surname)) bucket.hits.add(surname);
  }
  const ranked = [...byElection.values()]
    .map((b) => ({ ...b, score: surnames.size ? b.hits.size / surnames.size : 0 }))
    .sort((a, b) => b.score - a.score || days(a.date, record.paperDate) - days(b.date, record.paperDate));

  const best = ranked[0] || null;
  const override = overrides[record.stem] || null;
  const chosen = (override && override.electionKey) || (best && best.score > 0 ? best.key : null);

  results.push({
    file: record.file,
    stem: record.stem,
    paperDate: record.paperDate,
    electionName: record.electionName,
    candidates: record.candidates,
    surnameCount: surnames.size,
    best: best ? { key: best.key, score: Number(best.score.toFixed(3)), hits: best.hits.size } : null,
    runnerUp: ranked[1] ? { key: ranked[1].key, score: Number(ranked[1].score.toFixed(3)) } : null,
    override,
    chosen,
    disagrees: !!(override && override.electionKey && best && best.score > 0 && override.electionKey !== best.key),
  });
}

/* --------------------------------------------------- match individual people */

const contestsByElection = new Map();
for (const contest of contests) {
  const key = `${contest.body}__${contest.date}`;
  if (!contestsByElection.has(key)) contestsByElection.set(key, []);
  contestsByElection.get(key).push(contest);
}

let totalCandidates = 0;
let matched = 0;
let ambiguous = 0;
let noElection = 0;
let noPerson = 0;
const matchedRows = [];

for (const result of results) {
  const pool = result.chosen ? (contestsByElection.get(result.chosen) || []) : [];
  for (const candidate of result.candidates) {
    totalCandidates++;
    if (!pool.length) { noElection++; continue; }

    // Prefer the contest whose constituency name matches; fall back to the whole election,
    // because SPN constituency prose does not always survive normalisation.
    const wanted = place(candidate.constituency);
    const scoped = wanted ? pool.filter((c) => {
      const has = place(c.constituency);
      return has && (has === wanted || has.includes(wanted) || wanted.includes(has));
    }) : [];

    const findHits = (search) => {
      const found = [];
      for (const contest of search) {
        for (const person of contest.candidates) {
          if (person.surname !== candidate.surname) continue;
          const verdict = forenamesAgree(candidate.forename, person.forename);
          found.push({ contest, person, exact: verdict.strong, initialsAgree: verdict.agree });
        }
      }
      return found;
    };

    // Scope to the matching constituency FIRST, but fall back to the whole election when
    // that finds nothing. The SPN constituency prose is not an identifier -- "District of
    // Newry and Mourne - District Electoral Area Crotlieve" against Civgraph's
    // "lg85-NaM-Crotlieve" -- so a scoped search that returns no hits means the
    // normalisation failed, not that the person is absent. Treating those as misses put
    // the match rate at 19.1% while whole elections were scoring 1.0, which is what
    // exposed this.
    let hits = scoped.length ? findHits(scoped) : [];
    let scopedHit = hits.length > 0;
    if (!hits.length) hits = findHits(pool);
    const exact = hits.filter((h) => h.exact);
    const loose = hits.filter((h) => h.initialsAgree);
    let pick = null;
    if (exact.length === 1) pick = exact[0];
    else if (exact.length === 0 && loose.length === 1) pick = loose[0];

    if (pick) {
      matched++;
      matchedRows.push({
        ocrFile: result.file,
        election: result.chosen,
        constituency: pick.contest.constituency,
        bundle: pick.contest.file,
        ocrName: candidate.raw,
        civgraphName: pick.person.name,
        candidateId: pick.person.id,
        party: pick.person.party,
        scoped: scopedHit,
        proposer: candidate.proposer,
        seconder: candidate.seconder,
        agent: candidate.agent,
        address: candidate.address,
      });
    } else if (hits.length > 1) ambiguous++;
    else noPerson++;
  }
}

/* ------------------------------------------------------------------- report */

if (asJson) {
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString().slice(0, 10),
    totals: { ocrFiles: ocrRecords.length, ocrCandidates: totalCandidates, matched, ambiguous, noElection, noPerson },
    matchRate: totalCandidates ? Number((matched / totalCandidates).toFixed(4)) : 0,
    elections: results.map(({ candidates, ...rest }) => rest),
    matches: matchedRows,
  }, null, 2));
  process.exit(0);
}

/* ------------------------------------------------------------------- verify */

// Does each extracted field actually APPEAR in the raw OCR text it was extracted from?
//
// This is not a substitute for reading the newspaper scans -- a name can be present in the
// text and still attached to the wrong candidate, and this cannot see that. What it does
// catch is the failure that matters most and is otherwise invisible: a field the model
// produced that has no basis in the text at all. Every value it reports as ABSENT is either
// an OCR misread or an invention, and both need an eye on the scan.
if (process.argv.includes('--verify')) {
  // Check the extraction against the text it was ACTUALLY MADE FROM, which is text/ --
  // the original OCR. text-v2/ is the better re-OCR, but pointing this at it answers a
  // different and misleading question: it scores the old extraction against text the model
  // never saw, and the rates drop (proposers 95.3% rather than 100%) purely because the
  // newer pass renders some names differently. That would read as the extraction being
  // less faithful than it is. Pass --against-v2 deliberately to compare the two passes.
  const TEXT_DIRS = process.argv.includes('--against-v2')
    ? ['archive/ocr/text-v2', 'archive/ocr/text']
    : ['archive/ocr/text', 'archive/ocr/text-v2'];
  const textFor = (ocrFile) => {
    const stem = ocrFile.replace(/\.json$/, '');
    for (const dir of TEXT_DIRS) {
      const candidate = path.join(dir, `${stem}.txt`);
      if (existsSync(candidate)) return strip(readFileSync(candidate, 'utf8'));
    }
    return null;
  };

  // A STRICT substring test is the wrong instrument here, and measuring it that way first
  // produced a badly misleading answer -- 187 "absent" values that looked like invention.
  // Checked against the scan text for BL_0000038_19541123: the page prints the candidate as
  // "Arms|trong" across a COLUMN BREAK and the agent as "Falrley" (an l read for an i). The
  // name is on the page; the exact string is not. Reporting that as absent would have
  // accused the extraction of fabricating a record it read correctly.
  //
  // So two tests are reported. STRICT is exact presence. TRACE asks the weaker and more
  // honest question -- is there any run of four or more characters of this surname in the
  // text? -- which survives a hyphenation break or a single misread letter. A value absent
  // under TRACE has no support in the source at all and is the one worth an eye.
  const trace = (surname, text) => {
    if (text.includes(surname)) return true;
    for (let len = surname.length; len >= 4; len--) {
      for (let start = 0; start + len <= surname.length; start++) {
        if (text.includes(surname.slice(start, start + len))) return true;
      }
    }
    return false;
  };

  const cache = new Map();
  const tally = { name: [0, 0, 0], proposer: [0, 0, 0], seconder: [0, 0, 0], agent: [0, 0, 0] };
  const absent = [];
  let noText = 0;

  for (const row of matchedRows) {
    if (!cache.has(row.ocrFile)) cache.set(row.ocrFile, textFor(row.ocrFile));
    const text = cache.get(row.ocrFile);
    if (!text) { noText++; continue; }
    for (const field of ['name', 'proposer', 'seconder', 'agent']) {
      const raw = field === 'name' ? row.ocrName : row[field];
      if (!raw) continue;
      // Check the SURNAME only. Forenames are abbreviated and re-ordered constantly in
      // nomination notices ("Wm.", "Robt. J."), so a full-string test would report
      // absences that are just typesetting.
      const parsed = splitName(raw);
      const surname = parsed && parsed.surname ? parsed.surname : '';
      if (surname.length < 3) continue;
      const flat = text.replace(/\s+/g, '');
      tally[field][2]++;
      if (flat.includes(surname)) tally[field][0]++;
      if (trace(surname, flat)) tally[field][1]++;
      else absent.push({ file: row.ocrFile, field, value: raw, surname, election: row.election });
    }
  }

  console.log('Verification of extracted fields against the raw OCR text');
  console.log('');
  console.log('  STRICT = the surname appears exactly.  TRACE = a run of 4+ of its');
  console.log('  characters appears, which survives a column break or one misread letter.');
  console.log('');
  console.log('  field        STRICT            TRACE');
  for (const field of ['name', 'proposer', 'seconder', 'agent']) {
    const [strictHit, traceHit, total] = tally[field];
    const pctOf = (n) => (total ? `${((n / total) * 100).toFixed(1)}%` : '  -  ');
    console.log(`  ${field.padEnd(10)} ${String(strictHit).padStart(4)}/${String(total).padStart(4)} ${pctOf(strictHit).padStart(7)}`
      + `    ${String(traceHit).padStart(4)}/${String(total).padStart(4)} ${pctOf(traceHit).padStart(7)}`);
  }
  if (noText) console.log(`\n  ${noText} matched row(s) had no raw OCR text available.`);
  console.log(`\n${absent.length} value(s) NOT found in the source text -- each needs an eye on the scan:`);
  for (const row of absent.slice(0, 25)) {
    console.log(`  ${row.field.padEnd(9)} ${JSON.stringify(row.value).padEnd(30)} ${row.file}`);
  }
  if (absent.length > 25) console.log(`  ... and ${absent.length - 25} more`);
  process.exit(0);
}

if (sampleSize) {
  // Deterministic spread across the whole set, so the worksheet is not all one election.
  const step = Math.max(1, Math.floor(matchedRows.length / sampleSize));
  console.log(`# SPN verification worksheet -- ${Math.min(sampleSize, matchedRows.length)} of ${matchedRows.length} matches`);
  console.log('#');
  console.log('# Check each row against the newspaper scan named in `ocr file`; the raw OCR text is');
  console.log('# the same stem under archive/ocr/text/ (or ocr_output/ if it has not moved yet).');
  console.log('# Mark each: OK / WRONG-PERSON / WRONG-ROLE / ILLEGIBLE.');
  console.log('');
  let shown = 0;
  for (let i = 0; i < matchedRows.length && shown < sampleSize; i += step, shown++) {
    const row = matchedRows[i];
    console.log(`[ ] ${row.election}  ${row.constituency}`);
    console.log(`      ocr file   ${row.ocrFile}`);
    console.log(`      name       ${row.ocrName}   ->   ${row.civgraphName}  (${row.party || 'no party'})`);
    console.log(`      proposer   ${row.proposer || '-'}`);
    console.log(`      seconder   ${row.seconder || '-'}`);
    console.log(`      agent      ${row.agent || '-'}`);
    console.log('');
  }
  process.exit(0);
}

const pct = (n) => `${((n / (totalCandidates || 1)) * 100).toFixed(1)}%`;
console.log('SPN OCR -> Civgraph candidate match report');
console.log(`  OCR files                 ${ocrRecords.length}`);
console.log(`  Civgraph contests loaded  ${contests.length}`);
console.log('');
console.log(`  OCR candidate records     ${totalCandidates}`);
console.log(`  MATCHED to a candidate    ${matched}  (${pct(matched)})`);
console.log(`  no election resolved      ${noElection}  (${pct(noElection)})`);
console.log(`  election ok, no person    ${noPerson}  (${pct(noPerson)})`);
console.log(`  ambiguous (>1 candidate)  ${ambiguous}  (${pct(ambiguous)})`);
console.log('');

// The single headline rate is misleading, because the corpus is bimodal rather than
// uniformly mediocre. Stratifying by how confidently the ELECTION resolved separates
// "pages that were read cleanly" from "pages whose columns the OCR interleaved", and those
// two populations want different decisions.
const perFileMatched = new Map();
for (const row of matchedRows) perFileMatched.set(row.ocrFile, (perFileMatched.get(row.ocrFile) || 0) + 1);
const band = (lo, hi) => {
  const files = results.filter((r) => r.candidates.length && (r.best ? r.best.score : 0) >= lo && (r.best ? r.best.score : 0) < hi);
  const total = files.reduce((sum, r) => sum + r.candidates.length, 0);
  const hit = files.reduce((sum, r) => sum + (perFileMatched.get(r.file) || 0), 0);
  return `files ${String(files.length).padStart(2)}   candidates ${String(total).padStart(3)}   matched ${String(hit).padStart(3)}   ${total ? ((hit / total) * 100).toFixed(1) : '0.0'}%`;
};
console.log('Stratified by how confidently the election resolved:');
console.log(`  score >= 0.75    ${band(0.75, 1.01)}`);
console.log(`  0.40 - 0.74      ${band(0.40, 0.75)}`);
console.log(`  0.01 - 0.39      ${band(0.01, 0.40)}`);
console.log(`  score = 0        ${band(-1, 0.01)}`);
console.log('');

console.log('Per-file election resolution (score = share of OCR surnames found in that contest):');
for (const r of [...results].sort((a, b) => a.paperDate.localeCompare(b.paperDate))) {
  const flag = r.disagrees ? '  OVERRIDE-DISAGREES' : (r.override ? '  (override)' : '');
  const best = r.best ? `${r.best.key} ${r.best.score}` : '-- none --';
  console.log(`  ${r.paperDate}  n=${String(r.candidates.length).padStart(3)}  ${best.padEnd(50)}${flag}`);
  if (r.disagrees) console.log(`      override says ${r.override.electionKey}: ${r.override.note || 'no note'}`);
}

const unresolved = results.filter((r) => !r.chosen && r.candidates.length);
if (unresolved.length) {
  console.log('');
  console.log(`${unresolved.length} file(s) with candidates but NO election resolved:`);
  for (const r of unresolved) {
    console.log(`  ${r.paperDate}  n=${r.candidates.length}  "${r.electionName}"  ${r.file}`);
  }
}

console.log('');
console.log('Nothing was written. See docs/review/SPN-OCR-PROVENANCE.md.');
