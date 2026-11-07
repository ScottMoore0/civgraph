// Batch 4c: a party label is the party, never the party with the candidate's occupation.
//
// Council ballot papers and nomination notices print the description and the occupation side
// by side ("UUP Farmer", "Shopkeeper, Ulster Unionist", "Housewife"); OCR adds slips ("Ulster
// Unionist Partv") and some sheets print the party twice ("UUP U.U.P."). Under the owner's two
// layers (5 November 2026) the printed text stays verbatim, shown by "Show labels as printed",
// and the interpreted label is the real party. These tests hold that:
//   - no interpreted label in the built results (render/metadata/elections-test2) has an
//     occupation, a misspelt party name or a party named twice;
//   - the printed text is kept exactly as printed;
//   - every such ballot-paper label in data/elections-source/data/party-ids.json is folded
//     into its party for Browse (data/registries/parties/label-folds.json), and when Browse has
//     been built, its party list has none of them and each old address opens the party,
//     through the in-app list and as a 301 from /browse/parties/<old-slug>;
//   - the Republic's and the Dail's labels are untouched.
//
//   node --test tests/elections/party-label-occupations.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPartyLabelInterpreter } from '../../scripts/lib/party-label-interpretations.mjs';
import { browsePageHandler } from '../../functions/_browse-page.js';
import { BROWSE_DIR, ELECTION_BUNDLE_DIR, RECORDS_DB } from '../../scripts/records/paths.mjs';
import { d1 } from '../records/d1-shim.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
// The built results: the records build's bundles (npm run records:build writes tmp/records).
const MANIFESTS = ELECTION_BUNDLE_DIR;
const ELECTIONS = path.join(root, 'data/elections-source/data/elections');
const config = read('data/elections/party-label-interpretations.json');
const folds = read('data/registries/parties/label-folds.json');
const partyIds = read('data/elections-source/data/party-ids.json');

// Occupations, offices and honours printed in a party field.
const OCCUPATION = new RegExp(`\\b(${[
  'farmer', 'farming', 'surgeon', 'house ?wife', 'retired', 'teacher', 'school ?master', 'lecturer', 'professor',
  'solicitor', 'barrister', 'director', 'directory', 'manager', 'clerk', 'nurse', 'engineer', 'business ?man',
  'businss ?man', 'merchant', 'shop ?keeper', 'publican', 'publiean', 'vintner', 'dealer', 'grocer', 'contractor', 'labourer',
  'agent', 'doctor', 'accountant', 'student', 'pensioner', 'postman', 'civil servant', 'officer', 'consultant',
  'head ?master', 'principal', 'principle', 'proprietor', 'salesman', 'driver', 'handyman', 'telephonist',
  'executive', 'secretary', 'technician', 'builder', 'bricklayer', 'plumber', 'electrician', 'mechanic',
  'self[- ]employed', 'chemist', 'pharmacist', 'journalist', 'veterinary', 'architect', 'archttect', 'exporter',
  'funeral', 'undertaker', 'joiner', 'fitter', 'machinist', 'dentist', 'optician', 'housekeeper', 'mill worker',
  'factory worker', 'process worker', 'postal worker', 'comm\\. worker', 'enterprise worker', 'spokesman',
  'jobclub', 'mayor', 'lord mayor', 'councillor', 'alderman', 'privy counsellor', 'm\\.?b\\.?e', 'o\\.?b\\.?e',
  'j\\.?p', 'district council', 'disct\\. council', 'local gov',
].join('|')})\\b`, 'i');

// Words of party names, for spotting a misspelling of one ("Unioinst", "Partv").
const PARTY_WORDS = ['unionist', 'democratic', 'progressive', 'traditional', 'alliance', 'labour', 'nationalist',
  'republican', 'independent', 'socialist', 'conservative', 'official', 'ulster', 'party', 'workers', 'coalition',
  'loyalist', 'united', 'northern', 'ireland', 'social', 'community', 'protestant', 'liberal', 'vanguard', 'popular'];
// Words a slip test must not take for a slip: real words near a party word.
const REAL_WORDS = new Set(['united', 'unity', 'union', 'unionism', 'unionists', 'labor', 'liberty', 'loyal', 'social',
  'society', 'popular', 'progress', 'protest', 'national', 'nation', 'parity', 'partner', 'parties', 'republic',
  'democrat', 'democrats', 'socialists', 'conservatives', 'liberals', 'loyalists', 'officially', 'officer',
  'communist', 'communities', 'nationalists', 'republicans', 'progressives', 'protestants', 'independents',
  'worker', 'workers', 'specialist', 'liberation', 'unite', 'unionist', 'independence', 'socialistic']);
// The party named twice: by name and initials, or by initials twice.
const NAMED = {
  UUP: [/\bu\.?\s?u\.?\s?p\b\.?/gi, /\bulster unionist(?! coalition)\b/gi, /\bofficial unionist\b/gi],
  DUP: [/\bd\.?\s?u\.?\s?p\b\.?/gi, /\bdemocratic unionist\b/gi],
  SDLP: [/\bs\.?\s?d\.?\s?l\.?\s?p\b\.?/gi, /\bsocial democratic (?:and |& )?labour\b/gi],
  PUP: [/\bp\.?\s?u\.?\s?p\b\.?/gi, /\bprogressive unionist\b/gi],
  TUV: [/\bt\.?\s?u\.?\s?v\b\.?/gi, /\btraditional unionist\b/gi],
  UDP: [/\bu\.?\s?d\.?\s?p\b\.?/gi, /\bulster democratic party\b/gi],
  UKUP: [/\bu\.?\s?k\.?\s?u\.?\s?p\b\.?/gi, /\bu\.?\s?k\.? unionist\b/gi],
  NILP: [/\bn\.?\s?i\.?\s?l\.?\s?p\b\.?/gi, /\bnorthern ireland labour\b/gi],
  Alliance: [/\balliance\b/gi],
};

function editDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

/** Why a label is not a party label as it stands: [] when it is one. */
export function labelFaults(label) {
  const text = String(label || '');
  const faults = [];
  const occupation = OCCUPATION.exec(text);
  if (occupation) faults.push(`occupation "${occupation[0]}"`);
  for (const word of text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/)) {
    if (word.length < 5 || REAL_WORDS.has(word) || PARTY_WORDS.includes(word)) continue;
    const near = PARTY_WORDS.find((target) => target[0] === word[0]
      && editDistance(word, target) <= (target.length >= 8 ? 2 : 1));
    if (near) faults.push(`"${word}" for "${near}"`);
  }
  for (const [party, patterns] of Object.entries(NAMED)) {
    const times = patterns.reduce((sum, pattern) => sum + (text.match(pattern) || []).length, 0);
    if (times > 1) faults.push(`${party} named ${times} times`);
  }
  return faults;
}

// Genuine party names the word list would take for an occupation, each a party of its own.
const GENUINE = new Map([
  ['Independent Farmer', 'Dail 1937-48: independents standing as farmers\' candidates, a label of the time'],
  ['Irish Worker League', 'Dail 1927: Jim Larkin\'s party'],
  ['Business Party', 'Dail 1924: a party of its own'],
]);
// Ballot-paper labels the word list flags that are descriptions, not occupations or slips, and
// so stay labels of their own.
const KEPT = new Map([
  ['Community Candidate', 'a description (independents), not an occupation'],
  ['Comm. Candidate', 'a description (independents), not an occupation'],
  ['Community Candidates', 'a description (independents), not an occupation'],
  ['Community Labour Candidate', 'a description, not an occupation'],
  ['Independent Community Candidate', 'a description, not an occupation'],
  ['Independent Nationalist Community Candidate', 'a description, not an occupation'],
  ['Unity Candidate', 'a description (the 1981 Unity banner), not an occupation'],
  ['The Environment Candidate', 'a description, not an occupation'],
  ["1990's Candidate", 'a description, not an occupation'],
  ['West Bank Unionist', 'a Derry description (the West Bank of the Foyle), not an occupation'],
  ["Independent Ballyclare & District Business & Ratepayers' Association", 'an association of its own'],
  ['Upper Ards Community Association', 'an association of its own'],
]);

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) walk(file, files);
    else if (name.endsWith('.json') && !name.startsWith('_')) files.push(file);
  }
  return files;
}

/** Every candidate in the built results: {file, date, name, party, printed}. */
function builtCandidates() {
  const out = [];
  const visit = (node, file, date) => {
    if (Array.isArray(node)) { for (const item of node) visit(item, file, date); return; }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.candidates)) {
      for (const candidate of node.candidates) {
        if (candidate && typeof candidate === 'object' && candidate.name) {
          out.push({ file, date, constituency: String(node.constituency || ''), name: candidate.name, party: String(candidate.party ?? ''),
            // The label as printed: the paper's label, or the ballot paper's description when the
            // two are the same text (the manifest then keeps it once, as the description).
            printed: String(candidate.partyAsPrinted ?? ''), ballot: String(candidate.ballotDescription ?? '') });
        }
      }
    }
    for (const [key, value] of Object.entries(node)) if (key !== 'candidates' && value && typeof value === 'object') visit(value, file, date);
  };
  for (const name of readdirSync(MANIFESTS)) {
    if (!name.endsWith('.json')) continue;
    const manifest = JSON.parse(readFileSync(path.join(MANIFESTS, name), 'utf8'));
    visit(manifest.results, name, String(name.split('__')[1] || '').replace(/\.json$/, ''));
  }
  return out;
}
const candidates = builtCandidates();
const surname = (name) => String(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]+/g, ' ').trim().split(/\s+/).at(-1);

const foldedTo = new Map();
for (const [target, group] of Object.entries(folds.folds)) for (const label of group.labels) foldedTo.set(label, target);
const notNi = new Set(config.regions.notNi.bodies);
const isNotNi = (file) => [...notNi].some((body) => file.startsWith(`${body}__`) || file.startsWith(`${body}-`));

test('the detector finds what it is for', () => {
  for (const label of ['UUP Farmer', 'Ulster Unionist Partv', 'UUP U.U.P.', 'UUP - UUP', 'Businssman Ulster Unionist',
    '(Councillor) Off. Ulster Unionist', 'Housewife', 'Traditional Unionist Voice - TUV', 'Ulster Unioinst', 'Mayor U.U.P']) {
    assert.ok(labelFaults(label).length, `${label} is flagged`);
  }
  for (const label of ['UUP', 'Ulster Unionist Party', 'DUP', 'Democratic Unionist Party', 'Sinn Féin', 'SDLP', 'Alliance',
    'Independent', 'Independent Unionist', 'NI Labour', 'Workers Party Republican Clubs', 'United Unionist Coalition',
    'Social Democratic and Labour Party', 'Progressive Unionist Party', 'Farmers', "Ratepayers' Association"]) {
    assert.deepEqual(labelFaults(label), [], `${label} is a party label`);
  }
});

test('no interpreted party label in the results has an occupation, a misspelt party name or a party named twice', () => {
  assert.ok(candidates.length > 50000, `read the built results (${candidates.length} candidates)`);
  const bad = new Map();
  for (const candidate of candidates) {
    if (!candidate.party || GENUINE.has(candidate.party)) continue;
    const faults = labelFaults(candidate.party);
    if (faults.length) bad.set(candidate.party, `${candidate.file}: ${faults.join(', ')}`);
  }
  assert.deepEqual([...bad], [], 'every interpreted label is a party or independent label');
});

test('the printed label is kept verbatim beside the interpreted one', () => {
  // Ballymoney Town 1989, returned unopposed: the notice printed the occupation beside the party.
  const ballymoney = candidates.filter((c) => c.file === 'local-government-local-government-districts__1989-05-17.json');
  const row = (name) => ballymoney.find((c) => c.name === name && c.constituency === 'Ballymoney Town');
  assert.deepEqual([row('James Johnston McKeown')?.party, row('James Johnston McKeown')?.printed], ['UUP', 'Shopkeeper, Ulster Unionist']);
  assert.deepEqual([row('James Simpson')?.party, row('James Simpson')?.printed], ['UUP', 'Businssman Ulster Unionist']);
  assert.deepEqual([row('Samuel McConaghie')?.party, row('Samuel McConaghie')?.printed], ['DUP', 'DUP Civil Servant (Retired)']);
  assert.deepEqual([row('Robert McComb')?.party, row('Robert McComb')?.printed], ['Independent', 'Pensioner']);

  // Every printed label a source-checked fix records reaches the results unchanged.
  const fixes = read('data/elections/corrections/source-checked-fixes.json').records || [];
  const printedByDate = new Set(candidates.flatMap((c) => [c.printed, c.ballot].filter(Boolean)
    .map((text) => `${c.date}|${surname(c.name)}|${text}`)));
  let checked = 0;
  const lost = [];
  for (const record of fixes) {
    const date = String(record.sourceFile || '').split('/').find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part));
    if (!date) continue;
    for (const op of record.operations || []) {
      const printed = op.set?.Party_As_Printed;
      if (op.op !== 'candidate' || typeof printed !== 'string' || !printed.trim()) continue;
      checked += 1;
      if (!printedByDate.has(`${date}|${surname(op.name)}|${printed}`)) lost.push(`${record.sourceFile}: ${op.name} "${printed}"`);
    }
  }
  assert.ok(checked > 100, `checked the fixes' printed labels (${checked})`);
  assert.deepEqual(lost, [], 'no printed label is lost or changed');

  // The interpretation rules never touch the printed label, in any source contest.
  const interpreter = createPartyLabelInterpreter(config);
  let rows = 0;
  for (const body of readdirSync(ELECTIONS)) {
    const dir = path.join(ELECTIONS, body);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of walk(dir)) {
      let raw;
      try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
      const list = () => [...(raw?.Constituency?.countGroup || []), ...(Array.isArray(raw?.candidates) ? raw.candidates : [])];
      const before = list().map((r) => r?.Party_As_Printed ?? r?.partyAsPrinted ?? null);
      interpreter.apply({ body, date: path.relative(dir, file).split(path.sep)[0] }, raw);
      const after = list().map((r) => r?.Party_As_Printed ?? r?.partyAsPrinted ?? null);
      rows += before.length;
      assert.deepEqual(after, before, `the printed labels of ${path.relative(ELECTIONS, file)} are unchanged`);
    }
  }
  assert.ok(rows > 50000, `read every source contest (${rows} rows)`);
});

test('every ballot-paper label with an occupation, a slip or a doubled party is folded into its party', () => {
  const ids = new Set(partyIds.party_ids.map((party) => (party.party_id || '').replace(/^party:/, '')));
  const unfolded = [];
  for (const party of partyIds.party_ids) {
    const label = party.canonical_name;
    if (foldedTo.has(label) || GENUINE.has(label) || KEPT.has(label)) continue;
    if (Number(party.occurrence_count) >= 50) continue;   // an established party, never folded
    const faults = labelFaults(label);
    if (faults.length) unfolded.push(`${label}: ${faults.join(', ')}`);
  }
  assert.deepEqual(unfolded, [], 'each is in data/registries/parties/label-folds.json, or GENUINE/KEPT here with a reason');

  // The build also folds a label that is a registry alias of another party; a target must not be one.
  const registry = read('data/elections/parties/party_registry.json').entities || [];
  const aliasOf = new Map();
  for (const entity of registry) {
    if (!ids.has(entity.id)) continue;
    for (const alias of [entity.name, entity.shortName, ...(entity.aliases || []).map((a) => (typeof a === 'string' ? a : a?.string))]) {
      if (alias) aliasOf.set(String(alias).toLowerCase(), entity.id);
    }
  }
  for (const [label, target] of foldedTo) {
    assert.ok(ids.has(target), `the fold target ${target} (for ${label}) is a party-ids label`);
    const targetLabel = partyIds.party_ids.find((party) => party.party_id === `party:${target}`)?.canonical_name;
    assert.ok(!foldedTo.has(targetLabel), `the fold target ${target} is not itself folded`);
    const owner = aliasOf.get(String(targetLabel).toLowerCase());
    assert.ok(!owner || owner === target, `the fold target ${target} is not a registry name of ${owner}`);
    assert.ok(!folds.neverFold.includes(label), `${label} is not also on neverFold`);
    assert.deepEqual(labelFaults(targetLabel).filter((fault) => !GENUINE.has(targetLabel)), [], `the target ${targetLabel} is a clean label`);
  }
});

test('the Republic and the Dail keep their labels', () => {
  // Sinn Féin Workers' was folded into the Workers' Party before batch 4c, by the owner's ruling
  // of 2 November 2026 (one party under its names of the time), Dail candidacies with it.
  const earlier = new Set(["Sinn Féin Workers'"]);
  const touched = candidates.filter((c) => isNotNi(c.file)
    && ((foldedTo.has(c.party) && !earlier.has(c.party)) || (foldedTo.has(c.printed) && !earlier.has(c.printed))));
  assert.deepEqual(touched.map((c) => `${c.file}: ${c.name} ${c.party}`), [], 'no Dail or Republic candidacy reads or prints a folded label');
  const dail = candidates.filter((c) => c.file.startsWith('dail-eireann__'));
  assert.ok(dail.length > 10000, `read the Dail (${dail.length} candidates)`);
  for (const label of GENUINE.keys()) {
    assert.ok(dail.some((c) => c.party === label), `${label} still reads as itself in the Dail`);
    assert.ok(!foldedTo.has(label), `${label} is not folded`);
  }
});

// The checks below read Browse as the records build wrote it, and the page Function answers
// from the records database (party_cards, party_aliases), as in production.
const PARTIES = path.join(BROWSE_DIR, 'parties.json');
const built = existsSync(PARTIES) && existsSync(RECORDS_DB);

test('Browse lists no such label as a party, and each old address opens its party', { skip: !built && 'Browse is not built' }, async () => {
  const list = JSON.parse(readFileSync(PARTIES, 'utf8')).items;
  const listed = list.filter((item) => !GENUINE.has(item.title) && !KEPT.has(item.title) && labelFaults(item.title).length);
  assert.deepEqual(listed.map((item) => `${item.slug}: ${item.title}`), [], 'the party list');
  const bySlug = new Map(list.map((item) => [item.slug, item]));
  for (const label of GENUINE.keys()) assert.ok(list.some((item) => item.title === label), `${label} is still a party of its own`);

  const handler = browsePageHandler('parties');
  const env = {
    ELECTIONS_DB: d1(RECORDS_DB),
    ASSETS: { async fetch() { return new Response('<html><head><title>Browse</title></head><body><div id="browseHero" class="browse-hero"></div></body></html>', { status: 200 }); } },
  };
  let redirects = 0;
  for (const [label, target] of foldedTo) {
    const party = partyIds.party_ids.find((entry) => entry.canonical_name === label);
    if (!party) continue;
    const oldSlug = party.party_id.replace(/^party:/, '');
    // The in-app address: the target lists the old slug, which browse.js findItem matches.
    assert.ok((bySlug.get(target)?.previousSlugs || []).includes(oldSlug), `#/parties/${oldSlug} opens ${target}`);
    // The path address: its detail file holds the party, and the page answers 301.
    const detailPath = path.join(BROWSE_DIR, 'details', 'parties', `${oldSlug}.json`);
    assert.ok(existsSync(detailPath), `details/parties/${oldSlug}.json is written`);
    const response = await handler({ request: new Request(`https://civgraph.net/browse/parties/${oldSlug}`), env });
    assert.equal(response.status, 301, `/browse/parties/${oldSlug} redirects`);
    assert.equal(response.headers.get('Location'), `https://civgraph.net/browse/parties/${target}`, `/browse/parties/${oldSlug} goes to ${target}`);
    redirects += 1;
  }
  assert.ok(redirects > 100, `checked the folded labels' addresses (${redirects})`);
});
