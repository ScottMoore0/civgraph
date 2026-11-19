#!/usr/bin/env node
/**
 * Quality detectors over the Northern Ireland council contests of 1921-67 (report mode).
 *
 * WHY
 *
 * About 6,000 of these contests came from a machine transcription of newspaper OCR (the
 * DeepSeek staging of Nov 2026). A sample check of 43 (review-councils, 11 Nov 2026) found
 * the votes and outcomes clean but 16% of contests carrying a name or omission defect: OCR
 * garbles copied into names ("B. Harndll"), table/summary misreads (Hanvey for Harvey),
 * defeated candidates left out, and citations that do not name the page the names are on.
 * This rule finds the contests worth re-reading against the page image. It never edits data
 * and never fails: every finding is a lead for a person to check, not a verdict.
 *
 * DETECTORS (data only; these run anywhere)
 *
 *   omitted-loser      a poll was held (votes printed) but no candidate is "Not Elected"
 *   elected-vs-seats   elected members != seats, or the elected are not the top N by votes
 *   status-blank       a candidate row with no Status
 *   partial-votes      some candidates of a contested division have votes and others none
 *   arithmetic         printed majority, valid poll, total poll (votes + spoiled), poll over
 *                      the electorate
 *   register-vote      a vote changed from a register (correctionNote "... as the register
 *                      records it (previously N") that the contest's own arithmetic rejects,
 *                      or cannot test
 *   name-chars         a name holding digits or other non-name characters
 *   name-letters       a surname with a letter run seen in no other surname of the corpus
 *                      (OCR shapes such as "dll" at the end, "iii", four consonants)
 *   name-variant       a surname 1-2 letters from the same forename's surname in the same
 *                      council within two rounds, the rarer spelling flagged
 *   name-rare          a surname found once in every election on Civgraph, one letter from a
 *                      common surname
 *   citation           the source lacks a paper, a date or a page (or a PRONI reference), or
 *                      its date is far from the poll
 *   areas-over         a round holding more divisions than its council had (round-completeness
 *                      or the DED boundary edition), a division twice, or one person returned
 *                      for two divisions of the same round
 *   name-initials      a forename printed only as initials where the same council, within two
 *                      rounds, has the same surname with a written-out forename of those initials
 *   poll-date          a CC/RD round filed on another day than its county's (CC and RDs polled
 *                      together), a town round far from the towns' day, or a polled contest whose
 *                      every cited issue predates the poll
 *
 * DETECTORS (need the local OCR caches of the cited pages; --ocr-roots <file>)
 *
 *   name-not-on-page   a candidate's surname does not occur on the cited page (citation gap
 *                      or misread); "variant" when only a near spelling occurs
 *   table-summary      the surname occurs on the page, and so does a one-letter variant that
 *                      is itself a known surname (the Hanvey/Harvey pattern)
 *   omitted-loser-ocr  the division's block of the cited page has a surname with a vote
 *                      figure that is not among the contest's candidates
 *
 *   node scripts/check/rules/ni-council-quality.mjs                 summary
 *   node scripts/check/rules/ni-council-quality.mjs --list          every finding
 *   node scripts/check/rules/ni-council-quality.mjs --csv-dir DIR   one CSV per council
 *   node scripts/check/rules/ni-council-quality.mjs --ocr-roots F   F lists cache folders
 *   node scripts/check/rules/ni-council-quality.mjs --origin-csv F  mark contests listed in F
 *                                                                   (column live_file)
 *   node scripts/check/rules/ni-council-quality.mjs --ranked-csv F  one row per flagged contest,
 *        ranked by the chance a real defect is there, then by the people it touches; with
 *        --reviewed A.csv,B.csv (earlier fixers' ledgers: file, flag_types, action) a contest
 *        already passed on the image for the same flags sinks
 *   node scripts/check/rules/ni-council-quality.mjs --from 1921 --to 1967
 *   node scripts/check/rules/ni-council-quality.mjs --strict        exit 1 on any finding
 */
import fs from 'node:fs';
import path from 'node:path';
import { authorityStems, districtFeatureStem, editDistance, nameKeys } from '../../build/build-ni-local-grouped.mjs';

const BUNDLES = 'data/elections-source/data/elections';
const STATUS = 'data/elections/ni-local/round-status.json';
const COMPLETENESS = 'data/elections/round-completeness.json';
const LAYERS = 'data/elections/ni-local/layer-features.json';

/**
 * A candidate row of an election bundle, as far as this reads it.
 * @typedef {{ Firstname?: string, Surname?: string, Status?: string, Total_Votes?: unknown, candidateName?: string, [field: string]: unknown }} BundleCandidate
 */
/** @typedef {BundleCandidate & { votes: number | null, elected: boolean, surnameKey: string, initial: string }} Candidate a row with the values loadContests adds */
/** @typedef {Candidate & { votes: number }} VotedCandidate a candidate whose vote is printed */
/**
 * @typedef {{
 *   Constituency_Name?: string, Number_Of_Seats?: unknown, Quota?: unknown, Majority_Printed?: unknown,
 *   Valid_Poll?: unknown, Total_Poll?: unknown, Spoiled?: unknown, Total_Electorate?: unknown, Seat_Type?: string
 * }} CountInfo a bundle's countInfo
 */
/** @typedef {{ title?: string, url?: string, urls?: string[], kind?: string }} BundleSource a bundle's citation */
/** @typedef {{ Constituency?: { countInfo?: CountInfo, countGroup?: BundleCandidate[] }, correctionNote?: string, note?: string, source?: BundleSource }} Bundle an election bundle */
/** @typedef {{ body: string, round: string, year: string, file: string, data: Bundle, info: CountInfo, cands: Candidate[], area: string, seats: number }} Contest */
/** @typedef {{ contest: Contest, type: string, severity: string, detail: string, candidate: string }} Finding */
/** @typedef {{ district?: string, label?: string }} LayerFeature a boundary feature of layer-features.json */
/** @typedef {{ flat: string, lower: string, counts: Map<string, number>, skeleton: Map<string, Set<string>> }} PageData */

const args = process.argv.slice(2);
/** @param {string} name */
const flag = (name) => args.includes(name);
/**
 * @param {string} name
 * @param {string | null} [fallback]
 */
const option = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
// a fallback is given, so these are strings
const FROM = /** @type {string} */ (option('--from', '1921'));
const TO = /** @type {string} */ (option('--to', '1967'));

// ---------------------------------------------------------------------------------------------
// Names

/** @param {unknown} value */
const fold = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Surname key: ascii, lower case, M'/Mac/Mc as "mc", letters only.
 * @param {unknown} value
 */
export function surnameKey(value) {
  let s = fold(value).toLowerCase().replace(/[‘’`]/g, "'").trim();
  s = s.replace(/^m'\s*/, 'mc').replace(/^mac(?=[a-z]{3})/, 'mc');
  return s.replace(/[^a-z]/g, '');
}

/** @param {BundleCandidate} candidate */
function forenameInitial(candidate) {
  const first = fold(candidate.Firstname || '').replace(/^(rev|dr|sir|mrs?|miss|capt|major|col|lt|lieut)\.?\s+/i, '').trim();
  return (first.match(/[A-Za-z]/) || [''])[0].toLowerCase();
}

const NAME_CHARS = /[^A-Za-zÀ-ɏ'‘’. \-()]/;
// Shapes OCR leaves in names: a doubled "ll" after a consonant at the end ("Harndll"),
// three of one vowel, "ii" anywhere but a known Gaelic stem, and capitals inside a word.
/** @type {[RegExp, string][]} */
const OCR_SHAPES = [
  [/[bcdfghjkmnpqrstvwxz]ll$/i, 'consonant + "ll" at the end'],
  [/([aeiou])\1\1/i, 'tripled vowel'],
  [/(?<!^)ii/i, '"ii"'],
  [/[bcdfghjklmnpqrstvwxz]{6}/i, 'six consonants in a row'],
  [/^[a-z]/, 'starts lower case'],
  [/[a-z][A-Z]/, 'capital inside a word'],
  [/[lI]{3}/, '"lll"/"III"']
];
const SURNAME_PREFIX_OK = /^(mc|mac|o'|d'|de |van |le |la |st\.? )/i;

/** @param {string} key */
function trigrams(key) {
  const s = `^${key}$`;
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i + 3 <= s.length; i += 1) out.push(s.slice(i, i + 3));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Load

/** @param {string} file */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** @param {unknown} value */
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// The pre-1973 Northern Ireland councils: the intake's authorities, plus the County Armagh and
// Strabane councils staged before it, each with its aldermen body where it has one.
const NI_COUNCIL_DIR = /-(county-borough-council|county-council|rural-district-council|urban-district-council|borough-council|town-commissioners)(-aldermen)?$/;

function niBodies() {
  const authorities = new Set(Object.keys(readJson(STATUS).authorities || {}));
  return fs.readdirSync(BUNDLES)
    .filter((slug) => NI_COUNCIL_DIR.test(slug) || authorities.has(slug.replace(/-aldermen$/, '')))
    .sort();
}

/**
 * @param {string[]} bodies
 * @returns {Contest[]}
 */
function loadContests(bodies) {
  /** @type {Contest[]} */
  const contests = [];
  for (const body of bodies) {
    const dir = path.join(BUNDLES, body);
    for (const round of fs.readdirSync(dir).sort()) {
      const roundDir = path.join(dir, round);
      if (!fs.statSync(roundDir).isDirectory()) continue;
      const year = round.slice(0, 4);
      if (year < FROM || year > TO) continue;
      for (const file of fs.readdirSync(roundDir).sort()) {
        if (!file.endsWith('.json') || file.startsWith('_')) continue;
        const rel = `${body}/${round}/${file}`;
        /** @type {Bundle} */
        let data;
        try { data = readJson(path.join(roundDir, file)); } catch { continue; }
        if (!data.Constituency) continue;
        const info = data.Constituency.countInfo || {};
        const cands = (data.Constituency.countGroup || []).map((c) => ({
          ...c,
          votes: num(c.Total_Votes),
          elected: c.Status === 'Elected',
          surnameKey: surnameKey(c.Surname),
          initial: forenameInitial(c)
        }));
        contests.push({ body, round, year, file: rel, data, info, cands, area: info.Constituency_Name || file.replace(/\.json$/, ''), seats: num(info.Number_Of_Seats) || 0 });
      }
    }
  }
  return contests;
}

/** Surnames across every election bundle on Civgraph, for rarity and the letter model. */
function corpusSurnames() {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const body of fs.readdirSync(BUNDLES)) {
    const dir = path.join(BUNDLES, body);
    if (!fs.statSync(dir).isDirectory()) continue;
    const stack = [dir];
    while (stack.length) {
      // the loop runs only while the stack is non-empty
      const d = /** @type {string} */ (stack.pop());
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) { stack.push(p); continue; }
        if (!entry.name.endsWith('.json') || entry.name.startsWith('_')) continue;
        let text;
        try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
        if (!text.includes('"Surname"')) continue;
        for (const m of text.matchAll(/"Surname":\s*"((?:[^"\\]|\\.)*)"/g)) {
          const key = surnameKey(m[1]);
          if (key.length >= 2) counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------------------------
// Findings

/** @type {Finding[]} */
const findings = [];
/**
 * @param {Contest} contest
 * @param {string} type
 * @param {string} severity
 * @param {string} detail
 * @param {string} [candidate]
 */
function add(contest, type, severity, detail, candidate = '') {
  findings.push({ contest, type, severity, detail, candidate });
}

// (A missing vote is null, and null > 0 is false: "has a vote" below.)
/** @param {Contest} c */
const isContested = (c) => c.cands.some((x) => /** @type {number} */ (x.votes) > 0) || c.cands.some((x) => x.Status === 'Not Elected');

/** @param {Contest} contest */
function detectStructure(contest) {
  const { cands, seats, info } = contest;
  const elected = cands.filter((c) => c.elected);
  const voted = cands.filter((c) => /** @type {number} */ (c.votes) > 0);
  for (const c of cands) if (!c.Status) add(contest, 'status-blank', 'high', 'candidate row has no Status', c.candidateName);
  if (seats && elected.length !== seats) {
    add(contest, 'elected-vs-seats', 'high', `${elected.length} elected for ${seats} seat(s)`);
  }
  if (voted.length && voted.length < cands.length && cands.length > seats) {
    // Defeated candidates a paper names without their votes are entered without them: a lead
    // only when an ELECTED row lacks its vote.
    const electedBlank = cands.some((c) => c.elected && !(/** @type {number} */ (c.votes) > 0));
    add(contest, 'partial-votes', electedBlank ? 'medium' : 'low', `${voted.length} of ${cands.length} candidates have votes${electedBlank ? '' : ' (the rest are defeated candidates printed without votes)'}`);
  }
  if (voted.length && cands.length <= seats) {
    add(contest, 'omitted-loser', 'high', `votes printed for ${voted.length} but only ${cands.length} candidate(s) for ${seats} seat(s): the defeated are probably missing`);
  } else if (!voted.length && cands.length <= seats && (num(info.Total_Poll) || num(info.Valid_Poll) || num(info.Majority_Printed))) {
    add(contest, 'omitted-loser', 'high', `a poll or majority is recorded but only ${cands.length} candidate(s) for ${seats} seat(s) and no votes: the defeated and the votes are probably missing`);
  }
  if (voted.length === cands.length && cands.length > seats && elected.length === seats) {
    // every candidate has a vote here (voted.length === cands.length)
    const sorted = /** @type {VotedCandidate[]} */ ([...cands]).sort((a, b) => b.votes - a.votes);
    const cut = /** @type {VotedCandidate} */ (sorted[seats - 1]).votes;
    const wrong = /** @type {VotedCandidate[]} */ (cands).filter((c) => (c.elected && c.votes < cut) || (!c.elected && c.votes > cut));
    // A single-seat STV or an alderman/councillor split can legitimately break this; still a lead.
    if (wrong.length && !num(info.Quota)) {
      add(contest, 'elected-vs-seats', 'high', `elected are not the top ${seats} by votes: ${wrong.map((c) => `${c.candidateName} ${c.votes}${c.elected ? ' (elected)' : ''}`).join('; ')}`);
    }
  }
}

/**
 * @param {Contest} contest
 * @returns {[string, boolean, string][] | null}
 */
function detectArithmetic(contest) {
  const { cands, seats, info } = contest;
  if (!isContested(contest) || num(info.Quota)) return null;
  const voted = cands.filter((c) => c.votes !== null && c.votes > 0);
  if (voted.length !== cands.length || cands.length <= seats) return null;
  // every candidate has a vote from here on (the return above)
  const sorted = /** @type {VotedCandidate[]} */ ([...cands]).sort((a, b) => b.votes - a.votes);
  const sum = /** @type {VotedCandidate[]} */ (cands).reduce((t, c) => t + c.votes, 0);
  /** @type {[string, boolean, string][]} */
  const results = [];
  const majority = num(info.Majority_Printed);
  if (majority !== null && seats >= 1) {
    // Papers print a multi-seat majority either over the last elected or over the top elected
    // (the Belfast Telegraph's tables): either reading reconciles.
    const diff = /** @type {VotedCandidate} */ (sorted[seats - 1]).votes - /** @type {VotedCandidate} */ (sorted[seats]).votes;
    const fromTop = /** @type {VotedCandidate} */ (sorted[0]).votes - /** @type {VotedCandidate} */ (sorted[seats]).votes;
    results.push(['majority', diff === majority || fromTop === majority, `printed majority ${majority}, votes give ${diff}${seats > 1 ? ` (or ${fromTop} from the top)` : ''}`]);
  }
  const valid = num(info.Valid_Poll);
  if (valid !== null && seats === 1) results.push(['valid poll', valid === sum, `valid poll ${valid}, votes sum to ${sum}`]);
  const total = num(info.Total_Poll);
  const spoiled = num(info.Spoiled);
  if (total !== null && seats === 1) {
    if (spoiled !== null) results.push(['total poll', total === sum + spoiled, `total poll ${total}, votes ${sum} + spoiled ${spoiled} = ${sum + spoiled}`]);
    else if (valid === null) results.push(['total poll', total >= sum && total - sum <= Math.max(60, sum * 0.03), `total poll ${total}, votes sum to ${sum} (no spoiled papers printed)`]);
  }
  if (total !== null && seats > 1) {
    // Each voter has up to `seats` votes: the poll lies between the top vote and the sum/seats.
    const ok = total >= /** @type {VotedCandidate} */ (sorted[0]).votes && total * seats >= sum;
    results.push(['total poll', ok, `total poll ${total} for ${seats} seats, top vote ${/** @type {VotedCandidate} */ (sorted[0]).votes}, votes sum to ${sum}`]);
  }
  const electorate = num(info.Total_Electorate);
  if (electorate && total !== null) results.push(['electorate', total <= electorate, `total poll ${total}, electorate ${electorate}`]);
  for (const [what, ok, detail] of results) if (!ok) add(contest, 'arithmetic', 'high', `${what}: ${detail}`);
  return results;
}

/** @param {Contest} contest */
function detectRegisterVote(contest) {
  const note = contest.data.correctionNote || '';
  const re = /([^:;]+?)'s vote is ([\d,]+) as the register records it \(previously ([\d,]+)/g;
  for (const m of note.matchAll(re)) {
    const who = /** @type {string} */ (m[1]).trim();
    const now = num(m[2]);
    const before = num(m[3]);
    const results = detectArithmeticQuiet(contest);
    if (!results.length) {
      add(contest, 'register-vote', 'medium', `register vote ${now} (was ${before}) has no printed majority or poll to test it; check a second source`, who);
      continue;
    }
    const failed = results.filter(([, ok]) => !ok);
    if (failed.length) {
      // split always returns at least one part
      const reverted = contest.cands.map((c) => (c.votes === now && (c.candidateName || '').includes(/** @type {string} */ (who.split(' ').pop())) ? { ...c, votes: before } : c));
      const swapped = detectArithmeticQuiet({ ...contest, cands: reverted });
      const oldFits = swapped.length && swapped.every(([, ok]) => ok);
      add(contest, 'register-vote', 'high', `register vote ${now} (was ${before}) fails ${failed.map(([w, , d]) => `${w} (${d})`).join('; ')}${oldFits ? `; the previous ${before} fits every printed figure` : ''}`, who);
    }
  }
}

/** @param {Contest} contest */
function detectArithmeticQuiet(contest) {
  const before = findings.length;
  const r = detectArithmetic(contest) || [];
  findings.length = before;
  return r;
}

/**
 * @param {Contest} contest
 * @param {Map<string, number>} corpus
 * @param {Map<string, number>} trigramCounts
 */
function detectNameChars(contest, corpus, trigramCounts) {
  for (const c of contest.cands) {
    const name = `${c.Firstname || ''} ${c.Surname || ''}`.trim();
    if (NAME_CHARS.test(name)) add(contest, 'name-chars', 'high', `non-name character in "${name}"`, c.candidateName);
    const surname = fold(c.Surname || '').trim();
    if (!surname) { add(contest, 'name-chars', 'high', 'empty surname', c.candidateName); continue; }
    for (const [re, why] of OCR_SHAPES) {
      if (why === 'starts lower case' && SURNAME_PREFIX_OK.test(surname)) continue;
      if (why === 'capital inside a word' && /^(mc|mac|o'|fitz|de|van|la|le)/i.test(surname.replace(/[^A-Za-z']/g, ''))) continue;
      if (re.test(surname)) add(contest, 'name-letters', 'medium', `surname "${c.Surname}": ${why}`, c.candidateName);
    }
    const key = c.surnameKey;
    if (key.length >= 4 && (corpus.get(key) || 0) <= 2) {
      const rare = trigrams(key).filter((t) => (trigramCounts.get(t) || 0) <= (corpus.get(key) || 1));
      if (rare.length) add(contest, 'name-letters', 'medium', `surname "${c.Surname}" has letter runs no other surname on Civgraph has (${rare.join(', ')})`, c.candidateName);
    }
  }
}

/**
 * @param {Contest[]} contests
 * @param {Map<string, number>} corpus
 */
function detectVariants(contests, corpus) {
  /** @type {Map<string, Contest[]>} */
  const byBody = new Map();
  for (const c of contests) {
    const body = c.body.replace(/-aldermen$/, '');
    if (!byBody.has(body)) byBody.set(body, []);
    // set on the line before when absent
    /** @type {Contest[]} */ (byBody.get(body)).push(c);
  }
  for (const list of byBody.values()) {
    const rounds = [...new Set(list.map((c) => c.round))].sort();
    const roundIndex = new Map(rounds.map((r, i) => [r, i]));
    /** @type {{ contest: Contest, cand: Candidate, ri: number }[]} */
    const people = [];
    // every round of the list is in the index
    for (const contest of list) for (const cand of contest.cands) if (cand.surnameKey.length >= 4) people.push({ contest, cand, ri: /** @type {number} */ (roundIndex.get(contest.round)) });
    /** @type {Set<string>} */
    const seen = new Set();
    for (const a of people) {
      for (const b of people) {
        if (a === b || a.cand.surnameKey === b.cand.surnameKey) continue;
        if (Math.abs(a.ri - b.ri) > 2) continue;
        if (a.cand.initial && b.cand.initial && a.cand.initial !== b.cand.initial) continue;
        const d = editDistance(a.cand.surnameKey, b.cand.surnameKey);
        if (d === 0 || d > 2) continue;
        if (d === 2 && Math.min(a.cand.surnameKey.length, b.cand.surnameKey.length) < 6) continue;
        const ca = corpus.get(a.cand.surnameKey) || 0;
        const cb = corpus.get(b.cand.surnameKey) || 0;
        // Flag the rarer spelling, and only when it is rare: two common surnames a letter apart
        // (Brown/Browne, Reid/Reed) are usually two families.
        if (ca > cb || ca > 3) continue;
        const sameArea = nameKeys(a.contest.area)[0] === nameKeys(b.contest.area)[0];
        if (!sameArea && d === 2) continue;
        const key = `${a.contest.file}|${a.cand.candidateName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        add(a.contest, 'name-variant', sameArea ? 'high' : 'medium',
          `"${a.cand.Surname}" (${ca} on Civgraph) vs "${b.cand.Surname}" (${cb}) for ${b.cand.candidateName}, ${b.contest.round} ${b.contest.area}${sameArea ? ' (same division)' : ''}`,
          a.cand.candidateName);
      }
    }
  }
}

/**
 * @param {Contest} contest
 * @param {Map<string, number>} corpus
 * @param {Map<string, string[]>} bySkeleton
 */
function detectRare(contest, corpus, bySkeleton) {
  for (const c of contest.cands) {
    const key = c.surnameKey;
    if (key.length < 5 || (corpus.get(key) || 0) > 1) continue;
    /** @type {string[]} */
    const near = [];
    for (let i = 0; i < key.length; i += 1) {
      for (const cand of bySkeleton.get(key.slice(0, i) + key.slice(i + 1)) || []) if (cand !== key && (corpus.get(cand) || 0) >= 5 && editDistance(cand, key) === 1) near.push(cand);
    }
    for (const cand of bySkeleton.get(key) || []) if (cand !== key && (corpus.get(cand) || 0) >= 5 && editDistance(cand, key) === 1) near.push(cand);
    const uniq = [...new Set(near)];
    if (uniq.length) add(contest, 'name-rare', 'low', `surname "${c.Surname}" appears once on Civgraph; near ${uniq.map((u) => `${u} (${corpus.get(u)})`).join(', ')}`, c.candidateName);
  }
}

/** @type {Record<string, number>} */
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** @param {BundleSource | undefined} source */
export function citationParts(source) {
  const title = String(source?.title || '');
  const first = /** @type {string} */ (title.split(/;\s/)[0]);
  const date = first.match(/(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/);
  const page = /\bpp?\.\s*\d/.test(first);
  const proni = /\bPRONI\b|\bLA\/\d|\bD\/\d/.test(title);
  const paper = /** @type {string} */ (first.split(',')[0]).trim();
  return {
    paper,
    date: date ? `${date[3]}-${String(MONTHS[/** @type {string} */ (date[2]).toLowerCase()]).padStart(2, '0')}-${/** @type {string} */ (date[1]).padStart(2, '0')}` : '',
    page,
    proni,
    url: source?.url || (source?.urls || [])[0] || ''
  };
}

/** @param {Contest} contest */
function detectCitation(contest) {
  /** @type {BundleSource} */
  const source = contest.data.source || {};
  const parts = citationParts(source);
  /** @type {string[]} */
  const missing = [];
  if (!parts.proni) {
    if (!parts.paper || /^\d/.test(parts.paper)) missing.push('paper');
    if (!parts.date) missing.push('date');
    if (!parts.page) missing.push('page');
    if (!parts.url && source.kind === 'news') missing.push('url');
  }
  const core = missing.filter((m) => m !== 'url');
  if (missing.length) add(contest, 'citation', core.length ? 'medium' : 'low', `citation lacks ${missing.join(', ')}: "${String(source.title || '').slice(0, 120)}"`);
  if (parts.date && /^\d{4}-\d{2}-\d{2}$/.test(contest.round)) {
    const days = (Date.parse(parts.date) - Date.parse(contest.round)) / 86400000;
    if (days < -75 || days > 75) add(contest, 'citation', 'medium', `first cited issue ${parts.date} is ${Math.round(days)} days from the poll`);
  }
  const titles = String(source.title || '').split(/;\s/).length;
  const urls = (source.urls || (source.url ? [source.url] : [])).length;
  if (source.kind === 'news' && urls && titles !== urls && !source.urls) {
    add(contest, 'citation', 'low', `${titles} cited items but ${urls} link(s)`);
  }
}

/** @param {Contest[]} contests */
function detectAreas(contests) {
  /** @type {Record<string, { expected?: number }>} */
  const completeness = readJson(COMPLETENESS).rounds || {};
  /** @type {Record<string, { features?: LayerFeature[] }>} */
  const layers = readJson(LAYERS).layers || {};
  /** @type {Map<string, number>} */
  const statusExpected = new Map();
  for (const r of readJson(STATUS).rounds || []) {
    if (r.expectedAreas) statusExpected.set(`${r.slug}__${r.workRound || r.round}`, r.expectedAreas);
  }
  /** @type {Map<string, Contest[]>} */
  const byRound = new Map();
  for (const c of contests) {
    const key = `${c.body}__${c.round}`;
    if (!byRound.has(key)) byRound.set(key, []);
    // set on the line before when absent
    /** @type {Contest[]} */ (byRound.get(key)).push(c);
  }
  for (const [key, list] of byRound) {
    const [body, round] = /** @type {[string, string]} */ (key.split('__'));
    const expected = completeness[key]?.expected;
    const stated = statusExpected.get(key);
    if (expected && list.length > expected) add(/** @type {Contest} */ (list[0]), 'areas-over', 'high', `${list.length} divisions in the round, round-completeness expects ${expected}`);
    if (stated && list.length > stated) add(/** @type {Contest} */ (list[0]), 'areas-over', 'high', `${list.length} divisions in the round, the intake's round status expects ${stated}`);
    if (body.endsWith('-rural-district-council') && /^\d{4}-\d{2}-\d{2}$/.test(round)) {
      const edition = round < '1930-04-01' ? 'ded-1921-05-03' : 'ded-1930-04-01';
      const stems = authorityStems(body);
      /** @param {string} id */
      const ofDistrict = (id) => (layers[id]?.features || []).filter((f) => {
        if (!f.district) return false;
        const { stem, rural } = districtFeatureStem(f.district);
        return rural && stems.includes(stem);
      });
      const deds = ofDistrict(edition);
      // The boundary editions are snapshots (1921, 1930): a round between them can hold more
      // divisions than either. Only a count above both editions and any stated count is a lead.
      const most = Math.max(deds.length, ofDistrict('ded-1921-05-03').length, ofDistrict('ded-1930-04-01').length);
      if (most && list.length > most && !(stated && list.length <= stated) && !(expected && list.length <= expected)) {
        add(/** @type {Contest} */ (list[0]), 'areas-over', 'medium', `${list.length} divisions in the round; the DED boundary editions have at most ${most} for this district`);
      }
      if (deds.length) {
        /** @param {string} k */
        const bare = (k) => k.replace(/^sorted:/, '').replace(/\b(the|rural|urban)\b/g, '').replace(/[^a-z0-9]/g, '');
        const known = [...new Set(deds.flatMap((f) => nameKeys(f.label)).map(bare))].filter(Boolean);
        /** @param {string} k */
        const matches = (k) => known.some((d) => d === k || (k.length >= 5 && editDistance(d, k) <= (k.length >= 8 ? 2 : 1)) || (k.length >= 6 && (d.startsWith(k) || k.startsWith(d))));
        for (const c of list) {
          const keys = nameKeys(c.area).map(bare).filter(Boolean);
          if (!keys.some(matches)) {
            add(c, 'areas-over', 'low', `division "${c.area}" is not a DED of this district in ${edition} (misfiled, renamed or split?)`);
          }
        }
      }
    }
    /** @type {Map<string, string>} */
    const areaSeen = new Map();
    for (const c of list) {
      const k = `${nameKeys(c.area)[0]}|${c.info.Seat_Type || ''}`;
      if (areaSeen.has(k)) add(c, 'areas-over', 'high', `division filed twice in the round (also ${areaSeen.get(k)})`);
      else areaSeen.set(k, c.file);
    }
    /** @type {Map<string, string>} */
    const personSeen = new Map();
    for (const c of list) {
      for (const cand of c.cands.filter((x) => x.elected)) {
        const k = `${cand.initial}|${cand.surnameKey}|${fold(cand.Firstname || '').toLowerCase().replace(/[^a-z]/g, '')}`;
        if (personSeen.has(k) && personSeen.get(k) !== c.file) add(c, 'areas-over', 'medium', `${cand.candidateName} is also returned in ${personSeen.get(k)}`, cand.candidateName);
        else personSeen.set(k, c.file);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Forenames printed as initials, polling days (pure: each returns its findings)

/** @typedef {{ contest: Contest, type: string, severity: string, detail: string, candidate?: string | undefined }} NewFinding */

const TITLES = /^(rev|dr|sir|mrs?|miss|capt|major|col|lt|lieut|prof|very rev)\.?\s+/i;

/**
 * The initials of a forename printed only as initials ("W. J.", "J", "W.J."), lower case; "" when
 * any word is longer than a letter (a name, or an abbreviation such as "Wm." or "Jas.").
 * @param {unknown} firstname
 */
export function initialsOf(firstname) {
  const s = fold(firstname).replace(TITLES, '').trim();
  if (!s) return '';
  const words = s.split(/[\s.]+/).filter(Boolean);
  return words.every((w) => /^[A-Za-z]$/.test(w)) ? words.join('').toLowerCase() : '';
}

/**
 * The initials of a full forename ("William James" -> "wj"), or "" for an initials-only one.
 * @param {unknown} firstname
 */
function fullInitials(firstname) {
  const s = fold(firstname).replace(TITLES, '').trim();
  if (!s || initialsOf(s)) return '';
  const words = s.split(/[\s.]+/).filter(Boolean);
  if (!words.some((w) => w.length >= 3 && !/^(wm|jas|thos|geo|chas|robt|jno|saml|edw|hy|alex|benj|danl|richd|wal|fras|patk|michl|jos)$/i.test(w))) return '';
  return words.map((w) => /** @type {string} */ (w[0]).toLowerCase()).join('');
}

/**
 * Candidates whose forename is printed only as initials while a candidate of the same council,
 * within two rounds, with the same surname and matching initials, has a written-out forename:
 * the page may print the full name, and the person registry may hold the two as two people.
 * With `personOf` (the stamped person ids of a records build), a pair the registry already holds
 * as one person is no lead; a pair it holds as two is medium; without it, every pair is low.
 * @param {Contest[]} contests
 * @param {(contest: Contest, cand: Candidate) => number | null} [personOf]
 * @returns {NewFinding[]}
 */
export function initialsOnlyFindings(contests, personOf) {
  /** @type {NewFinding[]} */
  const out = [];
  /** @type {Map<string, Contest[]>} */
  const byBody = new Map();
  for (const c of contests) {
    const body = c.body.replace(/-aldermen$/, '');
    const list = byBody.get(body) || [];
    list.push(c);
    byBody.set(body, list);
  }
  for (const list of byBody.values()) {
    const rounds = [...new Set(list.map((c) => c.round))].sort();
    const roundIndex = new Map(rounds.map((r, i) => [r, i]));
    /** @type {Map<string, { contest: Contest, cand: Candidate, ri: number, full: string }[]>} */
    const fullBySurname = new Map();
    for (const contest of list) {
      for (const cand of contest.cands) {
        const full = fullInitials(cand.Firstname);
        if (!full || cand.surnameKey.length < 3) continue;
        const rows = fullBySurname.get(cand.surnameKey) || [];
        rows.push({ contest, cand, ri: roundIndex.get(contest.round) ?? 0, full });
        fullBySurname.set(cand.surnameKey, rows);
      }
    }
    for (const contest of list) {
      const ri = roundIndex.get(contest.round) ?? 0;
      for (const cand of contest.cands) {
        const ini = initialsOf(cand.Firstname);
        if (!ini) continue;
        let near = (fullBySurname.get(cand.surnameKey) || []).filter((r) => Math.abs(r.ri - ri) <= 2
          && (ini.length > 1 ? r.full === ini : r.full[0] === ini));
        if (!near.length) continue;
        const area = nameKeys(contest.area)[0];
        const same = near.filter((r) => nameKeys(r.contest.area)[0] === area);
        const forms = [...new Set(near.map((r) => r.cand.Firstname))];
        let split = '';
        if (personOf) {
          const mine = personOf(contest, cand);
          const theirs = (same.length ? same : near).map((r) => personOf(r.contest, r.cand));
          if (mine !== null && theirs.includes(mine)) continue;
          const other = theirs.find((p) => p !== null);
          if (mine !== null && other !== null && other !== undefined) split = `; the registry holds them as two people (${mine}, ${other})`;
        }
        near = same.length ? same : near;
        const best = /** @type {(typeof near)[number]} */ (near[0]);
        // Two different written-out forenames for the same initials are two men, or a guess: a lead only.
        out.push({ contest, type: 'name-initials', severity: split && same.length && forms.length === 1 ? 'medium' : 'low',
          detail: `printed "${cand.Firstname} ${cand.Surname}"; ${best.cand.candidateName} in ${best.contest.round} ${best.contest.area}${same.length ? ' (same division)' : ''}${forms.length > 1 ? `; also ${forms.slice(1, 3).join(', ')}` : ''}${split}`,
          candidate: cand.candidateName });
      }
    }
  }
  return out;
}

const CC_RD = /-(county-council|rural-district-council)$/;
const ANNUAL = /-(urban-district-council|borough-council|town-commissioners|county-borough-council)$/;

/**
 * The cited issue dates of a citation ("Paper, 6 June 1936, p. 7; Paper, 9 June 1936, p. 3").
 * @param {BundleSource | undefined} source
 */
export function citedDates(source) {
  /** @type {string[]} */
  const out = [];
  for (const m of String(source?.title || '').matchAll(/(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/g)) {
    out.push(`${m[3]}-${String(MONTHS[/** @type {string} */ (m[2]).toLowerCase()]).padStart(2, '0')}-${/** @type {string} */ (m[1]).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Polling-day checks.
 * - poll-date (round): a county council and its rural districts polled on one day; a CC/RD round
 *   filed on another day than its county's (the CC's day, or the day most of its districts have).
 *   A town (urban district, borough, town commissioners) round more than a week from the day most
 *   towns polled that year is a low-severity lead (several towns had their own days).
 * - poll-date (contest): a polled contest whose every cited issue is dated before the poll.
 * Only each body's largest round of a year is compared (the others are by-elections).
 * @param {Contest[]} contests
 * @param {(body: string) => string} countyOf
 * @returns {NewFinding[]}
 */
export function pollDateFindings(contests, countyOf) {
  /** @type {NewFinding[]} */
  const out = [];
  /** @type {Map<string, Contest[]>} */
  const rounds = new Map();
  for (const c of contests) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.round)) continue;
    const k = `${c.body}__${c.round}`;
    const list = rounds.get(k) || [];
    list.push(c);
    rounds.set(k, list);
  }
  /** @type {Map<string, Contest[]>} largest round per body and year */
  const main = new Map();
  for (const list of rounds.values()) {
    const k = `${/** @type {Contest} */ (list[0]).body}__${/** @type {Contest} */ (list[0]).year}`;
    const have = main.get(k);
    if (!have || list.length > have.length) main.set(k, list);
  }
  /** @type {Map<string, { body: string, date: string, list: Contest[] }[]>} */
  const groups = new Map();
  for (const list of main.values()) {
    const { body, year, round } = /** @type {Contest} */ (list[0]);
    let g = '';
    if (CC_RD.test(body)) g = `ccrd|${countyOf(body) || '?'}|${year}`;
    else if (ANNUAL.test(body.replace(/-aldermen$/, ''))) g = `town|${year}`;
    if (!g || g.includes('|?|')) continue;
    const arr = groups.get(g) || [];
    arr.push({ body, date: round, list });
    groups.set(g, arr);
  }
  for (const [g, arr] of groups) {
    const dates = new Set(arr.map((x) => x.date));
    if (dates.size < 2) continue;
    /** @type {Map<string, number>} */
    const tally = new Map();
    for (const x of arr) tally.set(x.date, (tally.get(x.date) || 0) + 1);
    const modal = /** @type {[string, number]} */ ([...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0])[0];
    if (g.startsWith('ccrd|')) {
      const cc = arr.find((x) => x.body.endsWith('-county-council'));
      const ref = cc ? cc.date : modal;
      for (const x of arr) {
        if (x.date === ref) continue;
        out.push({ contest: /** @type {Contest} */ (x.list[0]), type: 'poll-date', severity: 'medium',
          detail: `round filed on ${x.date}; the county's ${cc ? 'county council' : 'other districts'} polled ${ref} (CC and RDs polled the same day)` });
      }
    } else {
      if ((tally.get(modal) || 0) < 3) continue;
      for (const x of arr) {
        const days = Math.abs(Date.parse(x.date) - Date.parse(modal)) / 86400000;
        if (days > 7 && !x.list.some((c) => /by-?election|casual vacancy|first election|incorporat|postpone|\(not \d{1,2} \w+ \d{4}\)/i.test(String(c.data.note || '')))) {
          out.push({ contest: /** @type {Contest} */ (x.list[0]), type: 'poll-date', severity: 'low', detail: `town round filed on ${x.date}; ${tally.get(modal)} towns polled ${modal} that year` });
        }
      }
    }
  }
  for (const c of contests) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.round) || !isContested(c)) continue;
    const dates = citedDates(c.data.source);
    if (dates.length && dates.every((d) => d < c.round)) {
      out.push({ contest: c, type: 'poll-date', severity: 'high', detail: `polled contest, but every cited issue (${dates.join(', ')}) is dated before the poll ${c.round}: wrong poll date or a nominations notice cited for the result` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ranking: one row per contest, with a confidence that a real defect is there

/**
 * Share of flags of each type that the November 2026 fixers found to be a real defect when they
 * read the page image (council-audit ledgers: fixed / (fixed + confirmed-ok)); types they did
 * not see are estimates. By severity where the severity changes the odds. name-initials is kept
 * low: the page prints the initials, so the lead is a person-registry join, not a misreading.
 * @type {Record<string, Record<string, number>>}
 */
export const DEFECT_ODDS = {
  'omitted-loser': { high: 0.8 },
  'name-chars': { high: 0.9 },
  'status-blank': { high: 0.9 },
  'name-variant': { high: 0.6, medium: 0.45 },
  'omitted-loser-ocr': { high: 0.42 },
  'poll-date': { high: 0.5, medium: 0.5, low: 0.1 },
  'partial-votes': { medium: 0.33, low: 0.1 },
  arithmetic: { high: 0.29 },
  'register-vote': { high: 0.3, medium: 0.15 },
  'name-letters': { medium: 0.24 },
  'name-initials': { medium: 0.05, low: 0.02 },
  'elected-vs-seats': { high: 0.15 },
  'name-not-on-page': { high: 0.12, medium: 0.15 },
  'name-rare': { low: 0.1 },
  'areas-over': { high: 0.1, medium: 0.09, low: 0.03 },
  citation: { medium: 0.1, low: 0.02 },
  'table-summary': { low: 0.04 }
};

/**
 * @param {string} type
 * @param {string} severity
 */
function odds(type, severity) {
  const t = DEFECT_ODDS[type];
  if (!t) return 0.05;
  return t[severity] ?? Math.max(...Object.values(t));
}

/** Reason codes for the CSV: short, stable. @type {Record<string, string>} */
export const REASON = {
  'omitted-loser': 'OMIT', 'omitted-loser-ocr': 'OMIT-OCR', 'elected-vs-seats': 'SEATS', 'status-blank': 'STATUS',
  'partial-votes': 'PARTVOTE', arithmetic: 'ARITH', 'register-vote': 'REGVOTE', 'name-chars': 'NAME-CHARS',
  'name-letters': 'NAME-OCR', 'name-variant': 'NAME-VAR', 'name-rare': 'NAME-RARE', 'name-initials': 'NAME-INIT',
  'name-not-on-page': 'NOT-ON-PAGE', 'table-summary': 'TABLE-SUMMARY', citation: 'CITE', 'areas-over': 'AREAS', 'poll-date': 'DATE'
};

/** Flag types a fixer settles by reading the contest's names on the page image. */
const PAGE_READ = new Set(['name-not-on-page', 'table-summary', 'name-rare', 'name-letters', 'name-variant', 'name-chars', 'citation']);

/**
 * @typedef {{ file: string, action: string, types: Set<string> }} Reviewed a contest an earlier fixer read on the image
 * @typedef {{ file: string, body: string, round: string, area: string, candidates: number, reasons: string[], types: string[],
 *   confidence: number, people: number, prior: string, details: string[] }} RankedContest
 */

/**
 * One row per flagged contest: the chance at least one flag is a real defect (independent odds),
 * and how many people the defects touch (each named candidate once, plus each defeated candidate
 * the page shows and the contest lacks, plus each seat without a member). Where an earlier fixer
 * passed the contest (fixed or confirmed-ok), each flag type that fixer saw keeps a tenth of its
 * odds, so the contest sinks unless it has a flag that fixer did not see.
 * @param {NewFinding[]} list
 * @param {Map<string, Reviewed>} [reviewed]
 * @returns {RankedContest[]}
 */
export function rankContests(list, reviewed = new Map()) {
  /** @type {Map<string, NewFinding[]>} */
  const byFile = new Map();
  for (const f of list) {
    const arr = byFile.get(f.contest.file) || [];
    arr.push(f);
    byFile.set(f.contest.file, arr);
  }
  /** @type {RankedContest[]} */
  const rows = [];
  for (const [file, fs_] of byFile) {
    const c = /** @type {NewFinding} */ (fs_[0]).contest;
    /** @type {Map<string, number>} best odds per type */
    const best = new Map();
    for (const f of fs_) best.set(f.type, Math.max(best.get(f.type) || 0, odds(f.type, f.severity)));
    const prior = reviewed.get(file);
    const passed = !!prior && (prior.action === 'confirmed-ok' || prior.action === 'fixed');
    // A flag type the earlier fixer saw and passed on the image keeps a tenth of its odds; so does
    // any name or citation flag, since that fixer read every name of the contest on the page.
    const confidence = 1 - [...best].reduce((p, [t, o]) => p * (1 - (passed && (prior?.types.has(t) || PAGE_READ.has(t)) ? o / 10 : o)), 1);
    /** @type {Set<string>} */
    const named = new Set();
    let extra = 0;
    for (const f of fs_) {
      if (f.candidate) named.add(f.candidate);
      if (f.type === 'omitted-loser-ocr') extra = Math.max(extra, (f.detail.split(': ').slice(1).join(': ').match(/;/g) || []).length + 1);
      else if (f.type === 'omitted-loser') extra = Math.max(extra, 1);
      else if (f.type === 'elected-vs-seats') {
        const m = f.detail.match(/^(\d+) elected for (\d+) seat/);
        if (m) extra = Math.max(extra, Math.abs(Number(m[2]) - Number(m[1])));
      } else if (['poll-date', 'citation', 'areas-over', 'arithmetic', 'partial-votes'].includes(f.type) && !f.candidate && f.severity !== 'low') {
        for (const x of c.cands) named.add(String(x.candidateName || ''));
      }
    }
    const types = [...best.keys()];
    let priorNote = '';
    if (prior) {
      const fresh = types.filter((t) => !prior.types.has(t));
      priorNote = `${prior.action}${fresh.length ? ` (not then: ${fresh.map((t) => REASON[t] || t).join(';')})` : ''}`;
    }
    rows.push({
      file, body: c.body, round: c.round, area: c.area, candidates: c.cands.length,
      reasons: [...new Set(types.map((t) => REASON[t] || t))], types,
      confidence: Math.round(confidence * 1000) / 1000, people: named.size + extra, prior: priorNote,
      details: fs_.map((f) => `${REASON[f.type] || f.type}${f.candidate ? ` [${f.candidate}]` : ''}: ${f.detail}`)
    });
  }
  return rows.sort((a, b) => b.confidence - a.confidence || b.people - a.people || (a.file < b.file ? -1 : 1));
}

/**
 * Earlier fixers' ledgers (CSV with columns file, flag_types, action).
 * @param {string[]} files
 * @returns {Map<string, Reviewed>}
 */
function readReviewed(files) {
  /** @type {Map<string, Reviewed>} */
  const out = new Map();
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const header = /** @type {string} */ (lines[0]).split(',');
    const iFile = header.indexOf('file');
    const iTypes = header.indexOf('flag_types');
    const iAction = header.indexOf('action');
    for (const line of lines.slice(1)) {
      const cells = (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map((x) => x.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
      const f = (cells[iFile] || '').replace(/\\/g, '/');
      if (!f) continue;
      const have = out.get(f);
      const types = new Set((cells[iTypes] || '').split(';').map((t) => t.trim()).filter(Boolean));
      if (have) for (const t of have.types) types.add(t);
      // A later decision (fixed, confirmed-ok) outranks an earlier not-reached.
      const action = have && (have.action === 'fixed' || have.action === 'confirmed-ok') && !(cells[iAction] === 'fixed' || cells[iAction] === 'confirmed-ok') ? have.action : cells[iAction] || '';
      out.set(f, { file: f, action, types });
    }
  }
  return out;
}

// The County Armagh councils were staged before the intake's authority list.
const COUNTY_FALLBACK = /** @type {[RegExp, string][]} */ ([[/^(armagh|lurgan|tandragee|castleblayney-no-2|newry-no-2)-/, 'Armagh']]);

// ---------------------------------------------------------------------------------------------
// OCR-cache detectors (local only)

/** @param {string} rootsFile */
function ocrIndex(rootsFile) {
  const roots = fs.readFileSync(rootsFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  /** @type {Map<string, string[]>} */
  const index = new Map();
  /**
   * @param {string} key
   * @param {string} file
   */
  const put = (key, file) => {
    if (!index.has(key)) index.set(key, []);
    // set on the line before when absent
    /** @type {string[]} */ (index.get(key)).push(file);
  };
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      const file = path.join(root, name);
      let m = name.match(/^(?:page_|x_|xml_|full_)?([A-Z]{3})(\d{8})\.1\.(\d+)(?:\.txt|\.xml)?$/);
      if (m) { put(`ina|${m[1]}|${m[2]}|${Number(m[3])}`, file); continue; }
      m = name.match(/^(?:bnatxt|bt|po|bocr)_(\d{7})_(\d{8})(?:_(\d{3}))?_(\d{4})/);
      if (m) { put(`bna|${m[1]}|${m[2]}|${Number(m[4])}`, file); continue; }
      m = name.match(/^(\d{7})_(\d{8})_(\d{4})\.txt$/);
      if (m) put(`bna|${m[1]}|${m[2]}|${Number(m[3])}`, file);
    }
  }
  return index;
}

/** @param {BundleSource | undefined} source */
export function pageKeys(source) {
  const urls = source?.urls || (source?.url ? [source.url] : []);
  /** @type {string[]} */
  const keys = [];
  for (const url of urls) {
    let m = String(url).match(/d=([A-Z]{3})(\d{8})\.1\.(\d+)/);
    if (m) { keys.push(`ina|${m[1]}|${m[2]}|${Number(m[3])}`); continue; }
    m = String(url).match(/\/viewer\/bl\/(?:BL\/)?(\d{7})\/(\d{8})\/\d+\/(\d{4})/i);
    if (m) { keys.push(`bna|${m[1]}|${m[2]}|${Number(m[3])}`); continue; }
    m = String(url).match(/issue=BL[%2F/]+(\d{7})[%2F/]+(\d{8})&page=(\d+)/i);
    if (m) keys.push(`bna|${m[1]}|${m[2]}|${Number(m[3])}`);
  }
  return keys;
}

const GENERIC_AREA = /^(north|south|east|west|central|centre|middle|upper|lower|urban|rural|no\.? ?\d+)( (east|west|north|south))?( ward)?$/i;
// arch-ok R6: OCR stop words for matching names on a page, the detector's own vocabulary, not registry values
const STOP_TOKENS = new Set(['ward', 'wards', 'street', 'road', 'council', 'councillor', 'councillors', 'alderman', 'aldermen', 'division', 'majority',
  'total', 'poll', 'polled', 'electorate', 'electors', 'spoiled', 'spoilt', 'votes', 'vote', 'mr', 'mrs', 'miss', 'rev', 'dr', 'january', 'february',
  'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday', 'north', 'south', 'east', 'west', 'unionist', 'nationalist', 'labour', 'independent', 'the', 'and', 'for',
  'page', 'col', 'no', 'nos', 'number', 'district', 'rural', 'urban', 'county', 'borough', 'town', 'township', 'result', 'results', 'elected']);
/** @type {Set<string>} */
let placeTokens = new Set();

/** @type {Map<string, PageData>} */
const pageCache = new Map();
/**
 * The cited pages' text with its token index (cached: one page serves a whole round).
 * @param {string[]} files
 * @returns {PageData}
 */
function pageData(files) {
  const key = files.join('|');
  // has() has just seen it
  if (pageCache.has(key)) return /** @type {PageData} */ (pageCache.get(key));
  let text = '';
  for (const f of files) {
    try {
      text += ` ${fs.readFileSync(f, 'utf8').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')}`;
    } catch { /* unreadable cache file */ }
  }
  const flat = fold(text);
  const toks = flat.replace(/[‘’`]/g, "'").split(/[^A-Za-z']+/).filter((t) => t.length >= 2).map((t) => surnameKey(t));
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const t of toks) counts.set(t, (counts.get(t) || 0) + 1);
  // Deletion neighbourhood: every token under itself and each one-letter deletion of it.
  /** @type {Map<string, Set<string>>} */
  const skeleton = new Map();
  for (const t of counts.keys()) {
    if (t.length < 4) continue;
    // the set is made just before it is read when absent
    /** @param {string} k */
    const put = (k) => { if (!skeleton.has(k)) skeleton.set(k, new Set()); /** @type {Set<string>} */ (skeleton.get(k)).add(t); };
    put(t);
    for (let i = 0; i < t.length; i += 1) put(t.slice(0, i) + t.slice(i + 1));
  }
  const data = { flat, lower: flat.toLowerCase(), counts, skeleton };
  pageCache.set(key, data);
  // the cache holds over 200 pages here, so it has a first key
  if (pageCache.size > 200) pageCache.delete(/** @type {string} */ (pageCache.keys().next().value));
  return data;
}

/**
 * @param {string} key
 * @param {PageData} page
 */
function nearTokens(key, page) {
  /** @type {Set<string>} */
  const out = new Set();
  const probe = [key];
  for (let i = 0; i < key.length; i += 1) probe.push(key.slice(0, i) + key.slice(i + 1));
  for (const k of probe) for (const t of page.skeleton.get(k) || []) if (t !== key && editDistance(t, key) === 1) out.add(t);
  return [...out];
}

/**
 * @param {Contest} contest
 * @param {Map<string, string[]>} index
 * @param {Map<string, number>} corpus
 * @param {string[]} roundAreas
 */
function detectOcr(contest, index, corpus, roundAreas) {
  /** @type {BundleSource} */
  const source = contest.data.source || {};
  const keys = pageKeys(source);
  const files = keys.flatMap((k) => index.get(k) || []);
  if (!files.length) return false;
  const page = pageData(files);
  const { counts, flat, lower } = page;
  for (const c of contest.cands) {
    const key = c.surnameKey;
    if (key.length < 3) continue;
    const variants = key.length >= 5 ? nearTokens(key, page) : [];
    if (!counts.has(key)) {
      add(contest, 'name-not-on-page', variants.length ? 'medium' : 'high',
        variants.length ? `"${c.Surname}" not on the cited page; near: ${variants.slice(0, 4).join(', ')}` : `"${c.Surname}" not on the cited page${keys.length > 1 ? 's' : ''} (${keys.length} cited)`,
        c.candidateName);
    } else {
      const known = variants.filter((v) => (corpus.get(v) || 0) >= 2 && !/^(mc|o)$/.test(v));
      if (known.length) add(contest, 'table-summary', 'low', `page has "${c.Surname}" and also ${known.map((v) => `"${v}" (${counts.get(v)}x)`).join(', ')}`, c.candidateName);
    }
  }
  // Omitted defeated candidates: the division's block, from its name to the next division's,
  // when it names a person with a vote figure who is not among the contest's candidates.
  if (contest.cands.length <= contest.seats || !contest.cands.some((x) => x.Status === 'Not Elected')) {
    /** @param {string} a */
    const phrase = (a) => fold(a).replace(/\(.*?\)/g, ' ').replace(/\b(d\.?e\.?d\.?|division|electoral|councillors?|aldermen|aldermanship|alderman|seats?)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const areaPhrase = phrase(contest.area);
    if (areaPhrase.length >= 4 && !GENERIC_AREA.test(areaPhrase)) {
      const others = roundAreas.filter((a) => a !== contest.area).map(phrase).filter((a) => a.length >= 4);
      const have = new Set(contest.cands.map((x) => x.surnameKey));
      const re = new RegExp(`\\b${areaPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b`, 'gi');
      for (const m of flat.matchAll(re)) {
        let end = Math.min(flat.length, m.index + 700);
        for (const o of others) {
          const j = lower.indexOf(o.toLowerCase(), m.index + areaPhrase.length + 1);
          if (j > 0 && j < end) end = j;
        }
        const block = flat.slice(m.index, end);
        const blockKeys = new Set(block.split(/[^A-Za-z']+/).map(surnameKey));
        if (have.size && ![...have].some((h) => blockKeys.has(h))) continue;
        if (!/\b(majority|polled|votes|poll|elected|defeated|unsuccessful)\b/i.test(block)) continue;
        /** @type {string[]} */
        const extra = [];
        for (const v of block.matchAll(/\b([A-Z][a-zA-Z']{2,})[,.]?\s*(?:\([^)]{1,30}\))?[\s.,:-]{0,6}(\d{1,2},?\d{3}|\d{2,4})\b/g)) {
          const s = surnameKey(v[1]);
          const n = Number(/** @type {string} */ (v[2]).replace(/,/g, ''));
          if (n < 10 || (n >= 1880 && n <= 1975) || have.has(s) || STOP_TOKENS.has(s) || placeTokens.has(s) || (corpus.get(s) || 0) < 2) continue;
          if ([...have].some((h) => editDistance(h, s) <= 1)) continue;
          extra.push(`${v[1]} ${v[2]}`);
        }
        if (extra.length) {
          add(contest, 'omitted-loser-ocr', 'high', `the "${areaPhrase}" block of the cited page also has: ${[...new Set(extra)].slice(0, 5).join('; ')}`);
          break;
        }
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------

/** @param {unknown} value */
function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The person ids a records build stamped on each candidacy (its election bundles), as a lookup by
 * contest and candidate name; null where the build has no such row.
 * @returns {Promise<(contest: Contest, cand: Candidate) => number | null>}
 */
async function stampedPersons() {
  const { recordPaths } = await import('@civgraph/config/node');
  const dir = recordPaths(process.env).ELECTION_BUNDLE_DIR;
  /** @type {Map<string, Map<string, number>>} */
  const byRound = new Map();
  /** @param {string} key */
  const load = (key) => {
    const have = byRound.get(key);
    if (have) return have;
    /** @type {Map<string, number>} */
    const m = new Map();
    try {
      /** @type {{ results?: { constituency?: string, candidates?: { name?: string, personId?: number }[] }[] }} */
      const d = readJson(path.join(dir, `${key}.json`));
      for (const r of d.results || []) for (const c of r.candidates || []) if (c.personId) m.set(`${r.constituency}|${c.name}`, c.personId);
    } catch { /* no bundle for this round in the build */ }
    byRound.set(key, m);
    return m;
  };
  return (contest, cand) => load(`${contest.body}__${contest.round}`).get(`${contest.area}|${cand.candidateName}`) ?? null;
}

async function main() {
  const bodies = niBodies();
  const contests = loadContests(bodies);
  const corpus = corpusSurnames();
  /** @type {Map<string, number>} */
  const trigramCounts = new Map();
  for (const [key, n] of corpus) for (const t of new Set(trigrams(key))) trigramCounts.set(t, (trigramCounts.get(t) || 0) + n);
  /** @type {Map<string, string[]>} */
  const bySkeleton = new Map();
  for (const key of corpus.keys()) {
    // the list is made just before it is read when absent
    /** @param {string} k */
    const put = (k) => { if (!bySkeleton.has(k)) bySkeleton.set(k, []); /** @type {string[]} */ (bySkeleton.get(k)).push(key); };
    put(key);
    for (let i = 0; i < key.length; i += 1) put(key.slice(0, i) + key.slice(i + 1));
  }

  for (const contest of contests) {
    detectStructure(contest);
    detectArithmetic(contest);
    detectRegisterVote(contest);
    detectNameChars(contest, corpus, trigramCounts);
    detectRare(contest, corpus, bySkeleton);
    detectCitation(contest);
  }
  detectVariants(contests, corpus);
  detectAreas(contests);
  /** @type {Record<string, { county?: string }>} */
  const authorities = readJson(STATUS).authorities || {};
  /** @param {string} body */
  const countyOf = (body) => authorities[body]?.county || (COUNTY_FALLBACK.find(([re]) => re.test(body)) || [null, ''])[1];
  const personOf = flag('--persons') ? await stampedPersons() : undefined;
  for (const f of [...initialsOnlyFindings(contests, personOf), ...pollDateFindings(contests, countyOf)]) add(f.contest, f.type, f.severity, f.detail, f.candidate);

  const ocrRoots = option('--ocr-roots');
  let ocrChecked = 0;
  if (ocrRoots) {
    const index = ocrIndex(ocrRoots);
    placeTokens = new Set(Object.values(readJson(LAYERS).layers || {}).flatMap((l) => (l.features || []).flatMap((/** @type {LayerFeature} */ f) => String(f.label || '').split(/[^A-Za-z']+/))).map(surnameKey).filter((k) => k.length >= 4));
    /** @type {Map<string, string[]>} */
    const areasByRound = new Map();
    for (const c of contests) {
      const k = `${c.body}__${c.round}`;
      if (!areasByRound.has(k)) areasByRound.set(k, []);
      // set on the line before when absent
      /** @type {string[]} */ (areasByRound.get(k)).push(c.area);
    }
    // every contest's round was listed just above
    for (const contest of contests) if (detectOcr(contest, index, corpus, /** @type {string[]} */ (areasByRound.get(`${contest.body}__${contest.round}`)))) ocrChecked += 1;
  }

  /** @type {Set<string>} */
  const origin = new Set();
  const originCsv = option('--origin-csv');
  if (originCsv) {
    const lines = fs.readFileSync(originCsv, 'utf8').split(/\r?\n/);
    const header = /** @type {string} */ (lines[0]).split(',');
    const col = header.indexOf('live_file');
    for (const line of lines.slice(1)) {
      const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((x) => x.replace(/,$/, '').replace(/^"|"$/g, '')) || [];
      if (cells[col]) origin.add(cells[col].replace(/\\/g, '/'));
    }
  }

  const flaggedContests = new Set(findings.map((f) => f.contest.file));
  /** @type {Map<string, number>} */
  const byType = new Map();
  for (const f of findings) byType.set(f.type, (byType.get(f.type) || 0) + 1);
  /** @type {Map<string, Set<string>>} */
  const contestsByType = new Map();
  for (const f of findings) {
    if (!contestsByType.has(f.type)) contestsByType.set(f.type, new Set());
    // set on the line before when absent
    /** @type {Set<string>} */ (contestsByType.get(f.type)).add(f.contest.file);
  }

  console.log(`ni-council-quality: ${contests.length} contests ${FROM}-${TO} in ${bodies.length} council bodies; ${findings.length} findings in ${flaggedContests.size} contests${ocrRoots ? `; ${ocrChecked} contests checked against a cached page` : ''} (report only)`);
  // every type counted in byType has its contests in contestsByType
  for (const [type, n] of [...byType].sort((a, b) => b[1] - a[1])) console.log(`  ${type.padEnd(18)} ${String(n).padStart(5)} findings in ${/** @type {Set<string>} */ (contestsByType.get(type)).size} contests`);

  if (flag('--list')) for (const f of findings) console.log(`${f.contest.file}\t${f.type}\t${f.severity}\t${f.candidate}\t${f.detail}`);

  const csvDir = option('--csv-dir');
  if (csvDir) {
    fs.mkdirSync(csvDir, { recursive: true });
    const header = ['council', 'round', 'area', 'file', 'deepseek', 'type', 'severity', 'candidate', 'detail', 'source_title', 'source_url'];
    /** @type {Map<string, Finding[]>} */
    const byBody = new Map();
    for (const f of findings) {
      const b = f.contest.body.replace(/-aldermen$/, '');
      if (!byBody.has(b)) byBody.set(b, []);
      // set on the line before when absent
      /** @type {Finding[]} */ (byBody.get(b)).push(f);
    }
    for (const [body, list] of byBody) {
      const rows = [header.join(',')];
      for (const f of list) {
        const c = f.contest;
        /** @type {BundleSource} */
        const src = c.data.source || {};
        rows.push([c.body, c.round, c.area, c.file, originCsv ? (origin.has(c.file) ? 'yes' : 'no') : '', f.type, f.severity, f.candidate, f.detail, src.title, src.url || (src.urls || [])[0] || ''].map(csvCell).join(','));
      }
      fs.writeFileSync(path.join(csvDir, `${body}.csv`), `${rows.join('\n')}\n`);
    }
    console.log(`  wrote ${byBody.size} CSVs to ${csvDir}`);
  }

  const rankedCsv = option('--ranked-csv');
  if (rankedCsv) {
    const reviewed = readReviewed((option('--reviewed') || '').split(',').filter(Boolean));
    const ranked = rankContests(findings, reviewed);
    const header = ['rank', 'confidence', 'people', 'reasons', 'file', 'council', 'round', 'area', 'candidates', 'deepseek', 'prior_review', 'details'];
    const rows = [header.join(',')];
    ranked.forEach((r, i) => rows.push([i + 1, r.confidence.toFixed(3), r.people, r.reasons.join(';'), r.file, r.body, r.round, r.area, r.candidates,
      originCsv ? (origin.has(r.file) ? 'yes' : 'no') : '', r.prior, r.details.join(' | ')].map(csvCell).join(',')));
    fs.mkdirSync(path.dirname(rankedCsv), { recursive: true });
    fs.writeFileSync(rankedCsv, `${rows.join('\n')}\n`);
    const band = (/** @type {number} */ lo, /** @type {number} */ hi) => ranked.filter((r) => r.confidence >= lo && r.confidence < hi).length;
    console.log(`  ranked ${ranked.length} contests to ${rankedCsv}: confidence >=0.5 ${band(0.5, 2)}, 0.25-0.5 ${band(0.25, 0.5)}, 0.1-0.25 ${band(0.1, 0.25)}, <0.1 ${band(0, 0.1)}; ${ranked.filter((r) => r.prior).length} seen by an earlier fixer`);
  }
  if (flag('--strict') && findings.length) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) main();
