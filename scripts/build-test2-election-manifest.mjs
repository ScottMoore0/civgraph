#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ELECTION_ROOT = path.join(ROOT, 'election-viewer-package', 'data', 'elections');
const ELECTION_INDEX = path.join(ROOT, 'election-viewer-package', 'data', 'elections_index.json');
const MAP_METADATA = path.join(ROOT, 'test', 'metadata', 'maps-test.json');
const FEATURE_INDEX_DIR = path.join(ROOT, 'test', 'metadata', 'feature-indexes');
const OUT_DIR = path.join(ROOT, 'test', 'metadata', 'elections-test2');
const OUT_MANIFEST = path.join(ROOT, 'test', 'metadata', 'elections-test2.json');
const OUT_REPORT = path.join(ROOT, 'test', 'metadata', 'elections-test2-report.json');

const STYLE_MODES = ['winner', 'leadingParty', 'voteShare', 'turnout', 'majority', 'seats', 'quota'];
const LOCAL_GOVERNMENT_BODIES = new Set([
  'Antrim and Newtownabbey',
  'Ards and North Down',
  'Armagh, Banbridge and Craigavon',
  'Causeway Coast and Glens',
  'Fermanagh and Omagh',
  'Lisburn and Castlereagh',
  'Mid Ulster',
  'Mid and East Antrim',
  'Newry, Mourne and Down',
  'Belfast',
  'Antrim',
  'Ards',
  'Armagh',
  'Ballymena',
  'Ballymoney',
  'Banbridge',
  'Carrickfergus',
  'Castlereagh',
  'Coleraine',
  'Cookstown',
  'Craigavon',
  'Derry',
  'Down',
  'Dungannon',
  'Fermanagh',
  'Larne',
  'Limavady',
  'Lisburn',
  'Magherafelt',
  'Moyle',
  'Newry and Mourne',
  'Newtownabbey',
  'North Down',
  'Omagh',
  'Strabane',
  'Derry City and Strabane'
]);

const NAME_ALIASES = new Map([
  ['laoighis offaly', 'laois offaly'],
  ['dun laoghaire', 'dun laoghaire'],
  ['dunlaoghaire', 'dun laoghaire'],
  ['connaught ulster', 'connacht ulster'],
  ['midlands north west', 'midlands north-west'],
  ['cavan monaghan', 'cavan-monaghan'],
  ['carlow kilkenny', 'carlow-kilkenny']
]);

const PARTY_COLOURS = new Map([
  ['alliance', '#f6cb2f'],
  ['aontu', '#44532a'],
  ['conservative', '#0087dc'],
  ['dup', '#d46a4c'],
  ['fianna fail', '#66bb66'],
  ['fianna fail', '#66bb66'],
  ['fine gael', '#6699ff'],
  ['green', '#8dc63f'],
  ['independent', '#b8b8b8'],
  ['irish labour', '#cc0000'],
  ['labour', '#cc0000'],
  ['pbp', '#e91d50'],
  ['sdlp', '#2aa82c'],
  ['sinn fein', '#326760'],
  ['social democrats', '#752f8a'],
  ['solidarity pbp', '#e91d50'],
  ['solidarity-pbp', '#e91d50'],
  ['tuv', '#0c3a6a'],
  ['uup', '#48a5ee'],
  ['yes', '#2aa82c'],
  ['no', '#d46a4c']
]);

function main() {
  const electionIndex = readJson(ELECTION_INDEX);
  const mapMetadata = readJson(MAP_METADATA);
  const layers = Array.isArray(mapMetadata.layers) ? mapMetadata.layers : [];
  const layerBySource = buildLayerLookup(layers);
  const featureIndexes = loadFeatureIndexes(layers);
  const entries = buildUniqueElectionEntries(electionIndex);

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const manifestEntries = [];
  const reportEntries = [];
  let totalMatched = 0;
  let totalUnmatched = 0;

  for (const entry of entries) {
    const geography = resolveElectionGeography(entry);
    const layer = geography?.sourceMapId ? layerBySource.get(geography.sourceMapId) : null;
    const featureIndex = layer ? featureIndexes.get(layer.id) || featureIndexes.get(layer.sourceMapId) : null;
    const bundle = buildElectionBundle(entry, geography, layer, featureIndex);
    const bundlePath = path.join(OUT_DIR, `${bundle.key}.json`);
    writeJson(bundlePath, bundle);

    totalMatched += bundle.matchedCount;
    totalUnmatched += bundle.unmatchedCount;
    const manifestEntry = {
      key: bundle.key,
      body: bundle.body,
      date: bundle.date,
      bodySlug: bundle.bodySlug,
      bodyGroup: bundle.bodyGroup,
      displaySubtitle: bundle.displaySubtitle,
      displayProvider: bundle.displayProvider,
      constituencies: bundle.constituencies,
      isByElection: bundle.isByElection,
      sourceMapId: bundle.sourceMapId,
      layerId: bundle.layerId,
      labelProperty: bundle.labelProperty,
      loadable: bundle.loadable,
      placeholder: !bundle.loadable,
      matchedCount: bundle.matchedCount,
      unmatchedCount: bundle.unmatchedCount,
      totalConstituencies: bundle.totalConstituencies,
      unmatchedConstituencies: bundle.unmatchedConstituencies.slice(0, 30),
      resultUrl: `/test/metadata/elections-test2/${bundle.key}.json`,
      stylingModes: bundle.availableStyleModes
    };
    manifestEntries.push(manifestEntry);
    if (!bundle.loadable || bundle.unmatchedCount > 0) {
      reportEntries.push({
        key: bundle.key,
        body: bundle.body,
        date: bundle.date,
        bodyGroup: bundle.bodyGroup,
        sourceMapId: bundle.sourceMapId,
        layerId: bundle.layerId,
        loadable: bundle.loadable,
        matchedCount: bundle.matchedCount,
        unmatchedCount: bundle.unmatchedCount,
        unmatchedConstituencies: bundle.unmatchedConstituencies
      });
    }
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'election-viewer-package/data/elections',
    totals: {
      elections: manifestEntries.length,
      loadable: manifestEntries.filter((entry) => entry.loadable).length,
      placeholders: manifestEntries.filter((entry) => entry.placeholder).length,
      matchedConstituencies: totalMatched,
      unmatchedConstituencies: totalUnmatched
    },
    elections: manifestEntries.sort(compareElectionEntries)
  };

  const report = {
    schemaVersion: 1,
    generatedAt: manifest.generatedAt,
    totals: manifest.totals,
    unmatchedElections: reportEntries.length,
    entries: reportEntries.sort(compareElectionEntries)
  };

  writeJson(OUT_MANIFEST, manifest);
  writeJson(OUT_REPORT, report);

  console.log('Test2 election manifest');
  console.log(`- elections: ${manifest.totals.elections}`);
  console.log(`- loadable: ${manifest.totals.loadable}`);
  console.log(`- placeholders: ${manifest.totals.placeholders}`);
  console.log(`- matched constituencies: ${manifest.totals.matchedConstituencies}`);
  console.log(`- unmatched constituencies: ${manifest.totals.unmatchedConstituencies}`);
  console.log(`- report: ${path.relative(ROOT, OUT_REPORT)}`);
}

function buildUniqueElectionEntries(index) {
  const byKey = new Map();
  for (const [bodyIndex, body] of (index.bodies || []).entries()) {
    for (const dateEntry of body.dates || []) {
      const key = `${body.name}|${dateEntry.date}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.constituencies = unique([...existing.constituencies, ...(dateEntry.constituencies || [])]);
        existing.bodyIndexes.push(bodyIndex);
        continue;
      }
      byKey.set(key, {
        body: body.name,
        bodySlug: body.slug,
        bodyGroup: body.slug === 'local-government' || LOCAL_GOVERNMENT_BODIES.has(body.name) ? 'local-government' : null,
        date: dateEntry.date,
        bodyIndexes: [bodyIndex],
        constituencies: unique(dateEntry.constituencies || [])
      });
    }
  }
  return [...byKey.values()];
}

function resolveElectionGeography(entry) {
  const year = Number(String(entry.date).slice(0, 4));
  const body = entry.body;
  if (entry.bodyGroup === 'local-government') {
    return sourceByYear(year, [
      [2014, 'deas-2012'],
      [1993, 'deas-1993'],
      [1984, 'deas-1984'],
      [-Infinity, 'deas-1972']
    ]);
  }
  if (body === 'House of Commons of the United Kingdom') {
    return sourceByYear(year, [
      [2024, 'pc-2023'],
      [2005, 'pc-2008'],
      [1995, 'pc-1995'],
      [1983, 'pc-1982'],
      [1970, 'pc-1970'],
      [1950, 'pc-1948'],
      [1922, 'pc-1920'],
      [1918, 'pc-1918-ireland'],
      [-Infinity, 'pc-1885-ireland']
    ]);
  }
  if (body === 'Northern Ireland Assembly') {
    if (year >= 2007) return { sourceMapId: 'assembly-areas-2008' };
    if (year >= 1998) return { sourceMapId: 'assembly-areas-1995' };
    if (year === 1982) return { sourceMapId: 'assembly-areas-1982' };
    return { sourceMapId: 'assembly-areas-1970' };
  }
  if (body === 'Northern Ireland Constitutional Convention') return { sourceMapId: 'constitutional-convention-1975' };
  if (body === 'Northern Ireland Forum for Political Dialogue') return { sourceMapId: 'forum-1995' };
  if (body === 'Parliament of Northern Ireland') return { sourceMapId: year >= 1929 ? 'stormont-1929' : 'stormont-1920' };
  if (body === 'European Parliament') return { sourceMapId: 'ni-1921', singleConstituency: true };
  if (body === 'D\u00e1il \u00c9ireann') {
    if (String(entry.date).startsWith('1918-12-14')) return { sourceMapId: 'pc-1918-ireland' };
    return sourceByYear(year, [
      [2024, 'dail-2023'],
      [2017, 'dail-2017'],
      [2013, 'dail-2013'],
      [2011, 'dail-2009'],
      [2007, 'dail-2005'],
      [1997, 'dail-1998'],
      [1992, 'dail-1990'],
      [1987, 'dail-1983'],
      [1981, 'dail-1980'],
      [1977, 'dail-1974'],
      [-Infinity, null]
    ]);
  }
  if (body === 'President of Ireland') return { sourceMapId: 'roi-counties-2011', singleConstituency: true };
  if (body === 'Referendum (Ireland)') {
    if (year >= 2024) return { sourceMapId: 'dail-2023' };
    if (year === 2019) return { sourceMapId: 'roi-local-authorities-2024' };
    if (year >= 2017) return { sourceMapId: 'dail-2017' };
    if (year >= 2013) return { sourceMapId: 'dail-2013' };
    if (year >= 2011) return { sourceMapId: 'dail-2009' };
    if (year >= 2002) return { sourceMapId: 'dail-2005' };
    if (year >= 1992) return { sourceMapId: 'dail-1998' };
    return { sourceMapId: 'roi-counties-2011', singleConstituency: true };
  }
  if (body === 'European Parliament (Ireland)') {
    return sourceByYear(year, [
      [2024, 'mep-2024'],
      [2019, 'mep-2019'],
      [2014, 'mep-2014'],
      [2009, 'mep-2009'],
      [2004, 'mep-2004'],
      [-Infinity, 'mep-1979']
    ]);
  }
  return { sourceMapId: null };
}

function buildElectionBundle(entry, geography, layer, featureIndex) {
  const key = electionKey(entry);
  const featureLookup = buildFeatureLookup(featureIndex);
  const dateDir = path.join(ELECTION_ROOT, entry.bodySlug, entry.date);
  const dirExists = existsSync(dateDir);
  const singleFeature = geography?.singleConstituency ? firstFeature(featureIndex) : null;
  const results = [];
  const unmatched = [];

  for (const constituency of entry.constituencies || []) {
    const resultPath = findResultFile(dateDir, constituency);
    const rawResult = resultPath ? readJson(resultPath) : null;
    const result = summarizeResult(rawResult, constituency);
    const match = singleFeature || matchFeature(featureLookup, result.constituency || constituency);
    if (!match && !geography?.singleConstituency) unmatched.push(result.constituency || constituency);
    results.push({
      ...result,
      sourceFile: resultPath ? slash(path.relative(ROOT, resultPath)) : null,
      featureId: match?.id ?? null,
      featureName: match?.name ?? null,
      featureAliases: match?.aliases || [],
      matchName: match?.name ?? null,
      matched: Boolean(match)
    });
  }

  if (entry.constituencies.length === 0 && dirExists) {
    for (const file of readdirSync(dateDir).filter((name) => name.endsWith('.json') && name !== '_index.json')) {
      const resultPath = path.join(dateDir, file);
      const rawResult = readJson(resultPath);
      const result = summarizeResult(rawResult, file.replace(/\.json$/, ''));
      const match = singleFeature || matchFeature(featureLookup, result.constituency);
      if (!match && !geography?.singleConstituency) unmatched.push(result.constituency);
      results.push({
        ...result,
        sourceFile: slash(path.relative(ROOT, resultPath)),
        featureId: match?.id ?? null,
        featureName: match?.name ?? null,
        featureAliases: match?.aliases || [],
        matchName: match?.name ?? null,
        matched: Boolean(match)
      });
    }
  }

  const matchedCount = results.filter((result) => result.matched).length;
  const unmatchedCount = results.length - matchedCount;
  const availableStyleModes = STYLE_MODES.filter((mode) => modeAvailable(mode, results));
  const year = Number(String(entry.date).slice(0, 4));
  return {
    schemaVersion: 1,
    key,
    body: entry.body,
    bodySlug: entry.bodySlug,
    bodyGroup: entry.bodyGroup,
    date: entry.date,
    year,
    sourceMapId: geography?.sourceMapId || null,
    layerId: layer?.id || null,
    labelProperty: layer?.labelProperty || null,
    geometryType: layer?.geometryType || null,
    loadable: Boolean(layer && geography?.sourceMapId && results.length > 0 && matchedCount > 0),
    displaySubtitle: formatElectionSubtitle(entry, results, unmatchedCount),
    displayProvider: entry.bodyGroup === 'local-government' ? `Local government: ${entry.body}` : entry.body,
    constituencies: entry.constituencies,
    isByElection: (entry.constituencies || []).length > 0 && (entry.constituencies || []).length < 3,
    totalConstituencies: results.length,
    matchedCount,
    unmatchedCount,
    unmatchedConstituencies: unique(unmatched),
    availableStyleModes,
    results: results.sort((a, b) => String(a.constituency).localeCompare(String(b.constituency)))
  };
}

function summarizeResult(raw, fallbackConstituency) {
  const source = raw?.Constituency || raw || {};
  const info = source.countInfo || raw?.meta || raw?.metaData || {};
  const forumRows = Array.isArray(source.forum?.rows) ? source.forum.rows : null;
  const rows = forumRows || source.countGroup || raw?.candidates || [];
  const constituency = fixText(source.constituency || raw?.constituency || info.Constituency_Name || fallbackConstituency);
  const candidates = forumRows ? summarizeForumRows(forumRows) : summarizeCandidateRows(rows);
  const ranked = [...candidates].sort((a, b) => numberOrZero(b.firstPrefs) - numberOrZero(a.firstPrefs));
  const elected = candidates.filter((candidate) => candidate.elected);
  const leading = ranked[0] || null;
  const runnerUp = ranked[1] || null;
  const seatsTotal = parseNumber(info.Number_Of_Seats ?? raw?.meta?.seats ?? raw?.seats);
  const validPoll = parseNumber(info.Valid_Poll ?? raw?.meta?.valid_poll ?? raw?.meta?.validPoll);
  const totalPoll = parseNumber(info.Total_Poll ?? raw?.meta?.total_poll ?? raw?.meta?.totalPoll);
  const electorate = parseNumber(info.Total_Electorate ?? raw?.meta?.electorate ?? raw?.electorate);
  const totalVotes = validPoll || candidates.reduce((sum, candidate) => sum + numberOrZero(candidate.firstPrefs), 0);
  const turnoutPct = parseNumber(raw?.turnout_pct ?? raw?.meta?.turnout_pct ?? raw?.meta?.turnoutPct)
    || (electorate && totalPoll ? round((totalPoll / electorate) * 100, 2) : null);
  const majority = leading && runnerUp ? numberOrZero(leading.firstPrefs) - numberOrZero(runnerUp.firstPrefs) : null;
  const majorityPct = majority !== null && totalVotes ? round((majority / totalVotes) * 100, 2) : null;
  const electedByParty = countBy(elected, (candidate) => candidate.party || 'Independent');
  const topElectedParty = topCount(electedByParty);
  const winnerParty = topElectedParty?.key || leading?.party || null;
  const winnerName = elected.length === 1 ? elected[0].name : elected.length ? `${elected.length} elected` : leading?.name || null;
  const leadingPct = leading && totalVotes ? round((numberOrZero(leading.firstPrefs) / totalVotes) * 100, 2) : null;
  const quota = parseNumber(info.Quota ?? raw?.meta?.quota ?? raw?.quota);

  return {
    constituency,
    winnerParty,
    winnerName,
    leadingParty: leading?.party || null,
    leadingName: leading?.name || null,
    leadingVotes: leading?.firstPrefs ?? null,
    leadingPct,
    turnoutPct,
    majority,
    majorityPct,
    seatsWon: elected.length || topElectedParty?.count || null,
    seatsTotal: seatsTotal || null,
    quota: quota || null,
    electorate: electorate || null,
    totalPoll: totalPoll || null,
    validPoll: validPoll || totalVotes || null,
    totalVotes: totalVotes || null,
    colour: partyColour(winnerParty || leading?.party),
    leadingColour: partyColour(leading?.party),
    candidates: candidates.slice(0, 20)
  };
}

function summarizeForumRows(rows) {
  return rows.map((row) => ({
    name: row.party ? `${fixText(row.party)} list` : 'List',
    party: normalizeParty(row.party),
    firstPrefs: parseNumber(row.votes),
    voteShare: parseNumber(row.vote_share),
    elected: Number(row.allocated_seats || 0) > 0,
    seats: parseNumber(row.allocated_seats)
  }));
}

function summarizeCandidateRows(rows) {
  const byCandidate = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = fixText(row.candidateName || row.name || [row.Firstname, row.Surname].filter(Boolean).join(' '));
    const party = normalizeParty(row.Party_Name || row.party || row.party_name);
    const key = row.Candidate_Id || row.person_id || `${name}|${party}`;
    const existing = byCandidate.get(key) || {
      name,
      party,
      firstPrefs: null,
      finalVotes: null,
      elected: false,
      status: '',
      colour: partyColour(party)
    };
    const countNo = parseNumber(row.Count_Number);
    const firstPref = parseNumber(row.Candidate_First_Pref_Votes ?? row.first_pref ?? row.firstPreferenceVotes ?? row.votes);
    const totalVotes = parseNumber(row.Total_Votes ?? row.final_votes ?? row.finalVote);
    if ((countNo === 1 || existing.firstPrefs === null) && firstPref !== null) existing.firstPrefs = firstPref;
    if (totalVotes !== null) existing.finalVotes = Math.max(existing.finalVotes || 0, totalVotes);
    const status = fixText(row.Status || row.status || row.outcome || '');
    existing.status = existing.status || status;
    existing.elected = existing.elected || /elected|made quota|counted_as_elected/i.test(status) || row.counted_as_elected === true;
    byCandidate.set(key, existing);
  }
  return [...byCandidate.values()].sort((a, b) => numberOrZero(b.firstPrefs) - numberOrZero(a.firstPrefs));
}

function buildLayerLookup(layers) {
  const lookup = new Map();
  for (const layer of layers) {
    if (layer.id) lookup.set(layer.id, layer);
    if (layer.sourceMapId) lookup.set(layer.sourceMapId, layer);
  }
  return lookup;
}

function loadFeatureIndexes(layers) {
  const indexes = new Map();
  for (const layer of layers) {
    const file = path.join(FEATURE_INDEX_DIR, `${layer.id}.json`);
    const aliasFile = layer.aliasOf ? path.join(FEATURE_INDEX_DIR, `${layer.aliasOf}-vector-test.json`) : null;
    const indexFile = existsSync(file) ? file : aliasFile && existsSync(aliasFile) ? aliasFile : null;
    if (!indexFile) continue;
    const index = readJson(indexFile);
    indexes.set(layer.id, index);
    if (layer.sourceMapId) indexes.set(layer.sourceMapId, index);
  }
  return indexes;
}

function buildFeatureLookup(index) {
  const byName = new Map();
  for (const item of index?.items || []) {
    const names = unique([item.name, ...(item.aliases || [])]);
    for (const name of names) {
      for (const key of nameKeys(name)) {
        if (!byName.has(key)) byName.set(key, item);
      }
    }
  }
  return byName;
}

function matchFeature(lookup, name) {
  for (const key of nameKeys(name)) {
    if (lookup.has(key)) return lookup.get(key);
  }
  return null;
}

function firstFeature(index) {
  return index?.items?.[0] || null;
}

function nameKeys(value) {
  const normalized = normalizeName(value);
  const alias = NAME_ALIASES.get(normalized);
  return unique([
    normalized,
    alias ? normalizeName(alias) : null,
    normalized.replace(/\band\b/g, ''),
    normalized.replace(/\bnorth west\b/g, 'northwest'),
    normalized.replace(/\bsouth west\b/g, 'southwest'),
    normalized.replace(/\bnorth east\b/g, 'northeast'),
    normalized.replace(/\bsouth east\b/g, 'southeast')
  ].filter(Boolean));
}

function findResultFile(dateDir, constituency) {
  if (!existsSync(dateDir)) return null;
  const direct = path.join(dateDir, `${slugify(constituency)}.json`);
  if (existsSync(direct)) return direct;
  const files = readdirSync(dateDir).filter((name) => name.endsWith('.json') && name !== '_index.json');
  const target = normalizeName(constituency);
  for (const file of files) {
    const base = file.replace(/\.json$/, '');
    if (normalizeName(base) === target || nameKeys(base).includes(target)) return path.join(dateDir, file);
  }
  return null;
}

function sourceByYear(year, rows) {
  for (const [fromYear, sourceMapId] of rows) {
    if (year >= fromYear) return { sourceMapId };
  }
  return { sourceMapId: null };
}

function formatElectionSubtitle(entry, results, unmatchedCount) {
  const total = results.length || entry.constituencies.length;
  const prefix = entry.bodyGroup === 'local-government' ? entry.body : `${total} constituencies`;
  return unmatchedCount > 0 ? `${prefix}; ${unmatchedCount} unmatched` : prefix;
}

function modeAvailable(mode, results) {
  const field = {
    winner: 'winnerParty',
    leadingParty: 'leadingParty',
    voteShare: 'leadingPct',
    turnout: 'turnoutPct',
    majority: 'majorityPct',
    seats: 'seatsWon',
    quota: 'quota'
  }[mode];
  return results.some((result) => result.matched && result[field] !== null && result[field] !== undefined && result[field] !== '');
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function topCount(counts) {
  let best = null;
  for (const [key, count] of counts) {
    if (!best || count > best.count) best = { key, count };
  }
  return best;
}

function normalizeParty(value) {
  const text = fixText(value || '').trim();
  if (!text) return '';
  return text
    .replace(/^Sinn Fein$/i, 'Sinn F\u00e9in')
    .replace(/^Fianna Fail$/i, 'Fianna F\u00e1il')
    .replace(/^Labour$/i, 'Irish Labour')
    .replace(/^People Before Profit(?: Alliance)?$/i, 'PBP');
}

function partyColour(value) {
  const key = normalizeName(value);
  return PARTY_COLOURS.get(key) || '#6b7280';
}

function electionKey(entry) {
  const bodyKey = entry.bodySlug === 'local-government'
    ? `local-government-${slugify(entry.body)}`
    : (entry.bodySlug || slugify(entry.body));
  return `${bodyKey}__${slugify(entry.date)}`;
}

function compareElectionEntries(a, b) {
  const dateCompare = String(b.date).localeCompare(String(a.date));
  if (dateCompare !== 0) return dateCompare;
  return String(a.body).localeCompare(String(b.body));
}

function normalizeName(value) {
  return fixText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[''`]/g, '')
    .replace(/[-_/.,()]/g, ' ')
    .replace(/\bconstituency\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function slugify(value) {
  return normalizeName(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function fixText(value) {
  const text = String(value ?? '');
  if (!/[ÃÂ]/.test(text)) return text;
  try {
    return Buffer.from(text, 'latin1').toString('utf8');
  } catch {
    return text;
  }
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && String(value).trim() !== ''))];
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

main();
