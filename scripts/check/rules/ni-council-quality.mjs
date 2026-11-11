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

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const FROM = option('--from', '1921');
const TO = option('--to', '1967');

// ---------------------------------------------------------------------------------------------
// Names

const fold = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Surname key: ascii, lower case, M'/Mac/Mc as "mc", letters only. */
export function surnameKey(value) {
  let s = fold(value).toLowerCase().replace(/[‘’`]/g, "'").trim();
  s = s.replace(/^m'\s*/, 'mc').replace(/^mac(?=[a-z]{3})/, 'mc');
  return s.replace(/[^a-z]/g, '');
}

function forenameInitial(candidate) {
  const first = fold(candidate.Firstname || '').replace(/^(rev|dr|sir|mrs?|miss|capt|major|col|lt|lieut)\.?\s+/i, '').trim();
  return (first.match(/[A-Za-z]/) || [''])[0].toLowerCase();
}

const NAME_CHARS = /[^A-Za-zÀ-ɏ'‘’. \-()]/;
// Shapes OCR leaves in names: a doubled "ll" after a consonant at the end ("Harndll"),
// three of one vowel, "ii" anywhere but a known Gaelic stem, and capitals inside a word.
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

function trigrams(key) {
  const s = `^${key}$`;
  const out = [];
  for (let i = 0; i + 3 <= s.length; i += 1) out.push(s.slice(i, i + 3));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Load

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

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

function loadContests(bodies) {
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
  const counts = new Map();
  for (const body of fs.readdirSync(BUNDLES)) {
    const dir = path.join(BUNDLES, body);
    if (!fs.statSync(dir).isDirectory()) continue;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
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

const findings = [];
function add(contest, type, severity, detail, candidate = '') {
  findings.push({ contest, type, severity, detail, candidate });
}

const isContested = (c) => c.cands.some((x) => x.votes > 0) || c.cands.some((x) => x.Status === 'Not Elected');

function detectStructure(contest) {
  const { cands, seats, info } = contest;
  const elected = cands.filter((c) => c.elected);
  const voted = cands.filter((c) => c.votes > 0);
  for (const c of cands) if (!c.Status) add(contest, 'status-blank', 'high', 'candidate row has no Status', c.candidateName);
  if (seats && elected.length !== seats) {
    add(contest, 'elected-vs-seats', 'high', `${elected.length} elected for ${seats} seat(s)`);
  }
  if (voted.length && voted.length < cands.length && cands.length > seats) {
    add(contest, 'partial-votes', 'medium', `${voted.length} of ${cands.length} candidates have votes`);
  }
  if (voted.length && cands.length <= seats) {
    add(contest, 'omitted-loser', 'high', `votes printed for ${voted.length} but only ${cands.length} candidate(s) for ${seats} seat(s): the defeated are probably missing`);
  }
  if (voted.length === cands.length && cands.length > seats && elected.length === seats) {
    const sorted = [...cands].sort((a, b) => b.votes - a.votes);
    const cut = sorted[seats - 1].votes;
    const wrong = cands.filter((c) => (c.elected && c.votes < cut) || (!c.elected && c.votes > cut));
    // A single-seat STV or an alderman/councillor split can legitimately break this; still a lead.
    if (wrong.length && !num(info.Quota)) {
      add(contest, 'elected-vs-seats', 'high', `elected are not the top ${seats} by votes: ${wrong.map((c) => `${c.candidateName} ${c.votes}${c.elected ? ' (elected)' : ''}`).join('; ')}`);
    }
  }
}

function detectArithmetic(contest) {
  const { cands, seats, info } = contest;
  if (!isContested(contest) || num(info.Quota)) return null;
  const voted = cands.filter((c) => c.votes !== null && c.votes > 0);
  if (voted.length !== cands.length || cands.length <= seats) return null;
  const sorted = [...cands].sort((a, b) => b.votes - a.votes);
  const sum = cands.reduce((t, c) => t + c.votes, 0);
  const results = [];
  const majority = num(info.Majority_Printed);
  if (majority !== null && seats >= 1) {
    // Papers print a multi-seat majority either over the last elected or over the top elected
    // (the Belfast Telegraph's tables): either reading reconciles.
    const diff = sorted[seats - 1].votes - sorted[seats].votes;
    const fromTop = sorted[0].votes - sorted[seats].votes;
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
    const ok = total >= sorted[0].votes && total * seats >= sum;
    results.push(['total poll', ok, `total poll ${total} for ${seats} seats, top vote ${sorted[0].votes}, votes sum to ${sum}`]);
  }
  const electorate = num(info.Total_Electorate);
  if (electorate && total !== null) results.push(['electorate', total <= electorate, `total poll ${total}, electorate ${electorate}`]);
  for (const [what, ok, detail] of results) if (!ok) add(contest, 'arithmetic', 'high', `${what}: ${detail}`);
  return results;
}

function detectRegisterVote(contest) {
  const note = contest.data.correctionNote || '';
  const re = /([^:;]+?)'s vote is ([\d,]+) as the register records it \(previously ([\d,]+)/g;
  for (const m of note.matchAll(re)) {
    const who = m[1].trim();
    const now = num(m[2]);
    const before = num(m[3]);
    const results = detectArithmeticQuiet(contest);
    if (!results.length) {
      add(contest, 'register-vote', 'medium', `register vote ${now} (was ${before}) has no printed majority or poll to test it; check a second source`, who);
      continue;
    }
    const failed = results.filter(([, ok]) => !ok);
    if (failed.length) {
      const reverted = contest.cands.map((c) => (c.votes === now && (c.candidateName || '').includes(who.split(' ').pop()) ? { ...c, votes: before } : c));
      const swapped = detectArithmeticQuiet({ ...contest, cands: reverted });
      const oldFits = swapped.length && swapped.every(([, ok]) => ok);
      add(contest, 'register-vote', 'high', `register vote ${now} (was ${before}) fails ${failed.map(([w, , d]) => `${w} (${d})`).join('; ')}${oldFits ? `; the previous ${before} fits every printed figure` : ''}`, who);
    }
  }
}

function detectArithmeticQuiet(contest) {
  const before = findings.length;
  const r = detectArithmetic(contest) || [];
  findings.length = before;
  return r;
}

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

function detectVariants(contests, corpus) {
  const byBody = new Map();
  for (const c of contests) {
    const body = c.body.replace(/-aldermen$/, '');
    if (!byBody.has(body)) byBody.set(body, []);
    byBody.get(body).push(c);
  }
  for (const list of byBody.values()) {
    const rounds = [...new Set(list.map((c) => c.round))].sort();
    const roundIndex = new Map(rounds.map((r, i) => [r, i]));
    const people = [];
    for (const contest of list) for (const cand of contest.cands) if (cand.surnameKey.length >= 4) people.push({ contest, cand, ri: roundIndex.get(contest.round) });
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

function detectRare(contest, corpus, bySkeleton) {
  for (const c of contest.cands) {
    const key = c.surnameKey;
    if (key.length < 5 || (corpus.get(key) || 0) > 1) continue;
    const near = [];
    for (let i = 0; i < key.length; i += 1) {
      for (const cand of bySkeleton.get(key.slice(0, i) + key.slice(i + 1)) || []) if (cand !== key && (corpus.get(cand) || 0) >= 5 && editDistance(cand, key) === 1) near.push(cand);
    }
    for (const cand of bySkeleton.get(key) || []) if (cand !== key && (corpus.get(cand) || 0) >= 5 && editDistance(cand, key) === 1) near.push(cand);
    const uniq = [...new Set(near)];
    if (uniq.length) add(contest, 'name-rare', 'low', `surname "${c.Surname}" appears once on Civgraph; near ${uniq.map((u) => `${u} (${corpus.get(u)})`).join(', ')}`, c.candidateName);
  }
}

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

export function citationParts(source) {
  const title = String(source?.title || '');
  const first = title.split(/;\s/)[0];
  const date = first.match(/(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/);
  const page = /\bpp?\.\s*\d/.test(first);
  const proni = /\bPRONI\b|\bLA\/\d|\bD\/\d/.test(title);
  const paper = first.split(',')[0].trim();
  return {
    paper,
    date: date ? `${date[3]}-${String(MONTHS[date[2].toLowerCase()]).padStart(2, '0')}-${date[1].padStart(2, '0')}` : '',
    page,
    proni,
    url: source?.url || (source?.urls || [])[0] || ''
  };
}

function detectCitation(contest) {
  const source = contest.data.source || {};
  const parts = citationParts(source);
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

function detectAreas(contests) {
  const completeness = readJson(COMPLETENESS).rounds || {};
  const layers = readJson(LAYERS).layers || {};
  const statusExpected = new Map();
  for (const r of readJson(STATUS).rounds || []) {
    if (r.expectedAreas) statusExpected.set(`${r.slug}__${r.workRound || r.round}`, r.expectedAreas);
  }
  const byRound = new Map();
  for (const c of contests) {
    const key = `${c.body}__${c.round}`;
    if (!byRound.has(key)) byRound.set(key, []);
    byRound.get(key).push(c);
  }
  for (const [key, list] of byRound) {
    const [body, round] = key.split('__');
    const expected = completeness[key]?.expected;
    const stated = statusExpected.get(key);
    if (expected && list.length > expected) add(list[0], 'areas-over', 'high', `${list.length} divisions in the round, round-completeness expects ${expected}`);
    if (stated && list.length > stated) add(list[0], 'areas-over', 'high', `${list.length} divisions in the round, the intake's round status expects ${stated}`);
    if (body.endsWith('-rural-district-council') && /^\d{4}-\d{2}-\d{2}$/.test(round)) {
      const edition = round < '1930-04-01' ? 'ded-1921-05-03' : 'ded-1930-04-01';
      const stems = authorityStems(body);
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
        add(list[0], 'areas-over', 'medium', `${list.length} divisions in the round; the DED boundary editions have at most ${most} for this district`);
      }
      if (deds.length) {
        const bare = (k) => k.replace(/^sorted:/, '').replace(/\b(the|rural|urban)\b/g, '').replace(/[^a-z0-9]/g, '');
        const known = [...new Set(deds.flatMap((f) => nameKeys(f.label)).map(bare))].filter(Boolean);
        const matches = (k) => known.some((d) => d === k || (k.length >= 5 && editDistance(d, k) <= (k.length >= 8 ? 2 : 1)) || (k.length >= 6 && (d.startsWith(k) || k.startsWith(d))));
        for (const c of list) {
          const keys = nameKeys(c.area).map(bare).filter(Boolean);
          if (!keys.some(matches)) {
            add(c, 'areas-over', 'low', `division "${c.area}" is not a DED of this district in ${edition} (misfiled, renamed or split?)`);
          }
        }
      }
    }
    const areaSeen = new Map();
    for (const c of list) {
      const k = `${nameKeys(c.area)[0]}|${c.info.Seat_Type || ''}`;
      if (areaSeen.has(k)) add(c, 'areas-over', 'high', `division filed twice in the round (also ${areaSeen.get(k)})`);
      else areaSeen.set(k, c.file);
    }
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
// OCR-cache detectors (local only)

function ocrIndex(rootsFile) {
  const roots = fs.readFileSync(rootsFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  const index = new Map();
  const put = (key, file) => {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(file);
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

export function pageKeys(source) {
  const urls = source?.urls || (source?.url ? [source.url] : []);
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
const STOP_TOKENS = new Set(['ward', 'wards', 'street', 'road', 'council', 'councillor', 'councillors', 'alderman', 'aldermen', 'division', 'majority',
  'total', 'poll', 'polled', 'electorate', 'electors', 'spoiled', 'spoilt', 'votes', 'vote', 'mr', 'mrs', 'miss', 'rev', 'dr', 'january', 'february',
  'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday', 'north', 'south', 'east', 'west', 'unionist', 'nationalist', 'labour', 'independent', 'the', 'and', 'for',
  'page', 'col', 'no', 'nos', 'number', 'district', 'rural', 'urban', 'county', 'borough', 'town', 'township', 'result', 'results', 'elected']);
let placeTokens = new Set();

const pageCache = new Map();
/** The cited pages' text with its token index (cached: one page serves a whole round). */
function pageData(files) {
  const key = files.join('|');
  if (pageCache.has(key)) return pageCache.get(key);
  let text = '';
  for (const f of files) {
    try {
      text += ` ${fs.readFileSync(f, 'utf8').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')}`;
    } catch { /* unreadable cache file */ }
  }
  const flat = fold(text);
  const toks = flat.replace(/[‘’`]/g, "'").split(/[^A-Za-z']+/).filter((t) => t.length >= 2).map((t) => surnameKey(t));
  const counts = new Map();
  for (const t of toks) counts.set(t, (counts.get(t) || 0) + 1);
  // Deletion neighbourhood: every token under itself and each one-letter deletion of it.
  const skeleton = new Map();
  for (const t of counts.keys()) {
    if (t.length < 4) continue;
    const put = (k) => { if (!skeleton.has(k)) skeleton.set(k, new Set()); skeleton.get(k).add(t); };
    put(t);
    for (let i = 0; i < t.length; i += 1) put(t.slice(0, i) + t.slice(i + 1));
  }
  const data = { flat, lower: flat.toLowerCase(), counts, skeleton };
  pageCache.set(key, data);
  if (pageCache.size > 200) pageCache.delete(pageCache.keys().next().value);
  return data;
}

function nearTokens(key, page) {
  const out = new Set();
  const probe = [key];
  for (let i = 0; i < key.length; i += 1) probe.push(key.slice(0, i) + key.slice(i + 1));
  for (const k of probe) for (const t of page.skeleton.get(k) || []) if (t !== key && editDistance(t, key) === 1) out.add(t);
  return [...out];
}

function detectOcr(contest, index, corpus, roundAreas) {
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
        const extra = [];
        for (const v of block.matchAll(/\b([A-Z][a-zA-Z']{2,})[,.]?\s*(?:\([^)]{1,30}\))?[\s.,:-]{0,6}(\d{1,2},?\d{3}|\d{2,4})\b/g)) {
          const s = surnameKey(v[1]);
          const n = Number(v[2].replace(/,/g, ''));
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

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function main() {
  const bodies = niBodies();
  const contests = loadContests(bodies);
  const corpus = corpusSurnames();
  const trigramCounts = new Map();
  for (const [key, n] of corpus) for (const t of new Set(trigrams(key))) trigramCounts.set(t, (trigramCounts.get(t) || 0) + n);
  const bySkeleton = new Map();
  for (const key of corpus.keys()) {
    const put = (k) => { if (!bySkeleton.has(k)) bySkeleton.set(k, []); bySkeleton.get(k).push(key); };
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

  const ocrRoots = option('--ocr-roots');
  let ocrChecked = 0;
  if (ocrRoots) {
    const index = ocrIndex(ocrRoots);
    placeTokens = new Set(Object.values(readJson(LAYERS).layers || {}).flatMap((l) => (l.features || []).flatMap((f) => String(f.label || '').split(/[^A-Za-z']+/))).map(surnameKey).filter((k) => k.length >= 4));
    const areasByRound = new Map();
    for (const c of contests) {
      const k = `${c.body}__${c.round}`;
      if (!areasByRound.has(k)) areasByRound.set(k, []);
      areasByRound.get(k).push(c.area);
    }
    for (const contest of contests) if (detectOcr(contest, index, corpus, areasByRound.get(`${contest.body}__${contest.round}`))) ocrChecked += 1;
  }

  const origin = new Set();
  const originCsv = option('--origin-csv');
  if (originCsv) {
    const lines = fs.readFileSync(originCsv, 'utf8').split(/\r?\n/);
    const header = lines[0].split(',');
    const col = header.indexOf('live_file');
    for (const line of lines.slice(1)) {
      const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((x) => x.replace(/,$/, '').replace(/^"|"$/g, '')) || [];
      if (cells[col]) origin.add(cells[col].replace(/\\/g, '/'));
    }
  }

  const flaggedContests = new Set(findings.map((f) => f.contest.file));
  const byType = new Map();
  for (const f of findings) byType.set(f.type, (byType.get(f.type) || 0) + 1);
  const contestsByType = new Map();
  for (const f of findings) {
    if (!contestsByType.has(f.type)) contestsByType.set(f.type, new Set());
    contestsByType.get(f.type).add(f.contest.file);
  }

  console.log(`ni-council-quality: ${contests.length} contests ${FROM}-${TO} in ${bodies.length} council bodies; ${findings.length} findings in ${flaggedContests.size} contests${ocrRoots ? `; ${ocrChecked} contests checked against a cached page` : ''} (report only)`);
  for (const [type, n] of [...byType].sort((a, b) => b[1] - a[1])) console.log(`  ${type.padEnd(18)} ${String(n).padStart(5)} findings in ${contestsByType.get(type).size} contests`);

  if (flag('--list')) for (const f of findings) console.log(`${f.contest.file}\t${f.type}\t${f.severity}\t${f.candidate}\t${f.detail}`);

  const csvDir = option('--csv-dir');
  if (csvDir) {
    fs.mkdirSync(csvDir, { recursive: true });
    const header = ['council', 'round', 'area', 'file', 'deepseek', 'type', 'severity', 'candidate', 'detail', 'source_title', 'source_url'];
    const byBody = new Map();
    for (const f of findings) {
      const b = f.contest.body.replace(/-aldermen$/, '');
      if (!byBody.has(b)) byBody.set(b, []);
      byBody.get(b).push(f);
    }
    for (const [body, list] of byBody) {
      const rows = [header.join(',')];
      for (const f of list) {
        const c = f.contest;
        const src = c.data.source || {};
        rows.push([c.body, c.round, c.area, c.file, originCsv ? (origin.has(c.file) ? 'yes' : 'no') : '', f.type, f.severity, f.candidate, f.detail, src.title, src.url || (src.urls || [])[0] || ''].map(csvCell).join(','));
      }
      fs.writeFileSync(path.join(csvDir, `${body}.csv`), `${rows.join('\n')}\n`);
    }
    console.log(`  wrote ${byBody.size} CSVs to ${csvDir}`);
  }
  if (flag('--strict') && findings.length) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) main();
