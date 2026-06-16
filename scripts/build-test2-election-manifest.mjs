#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import * as ElectionDomain from '../js/election-domain.mjs';
import { canonicalElectionTitle, isElectionByElectionScope } from '../js/election-names.mjs';
import { writeStableGeneratedJson } from './lib/stable-generated-json.mjs';

const ROOT = process.cwd();
const ELECTION_ROOT = path.join(ROOT, 'election-viewer-package', 'data', 'elections');
const ELECTION_INDEX = path.join(ROOT, 'election-viewer-package', 'data', 'elections_index.json');
const MAP_METADATA = path.join(ROOT, 'test', 'metadata', 'maps-test.json');
const FEATURE_INDEX_DIR = path.join(ROOT, 'test', 'metadata', 'feature-indexes');
const OUT_DIR = path.join(ROOT, 'test', 'metadata', 'elections-test2');
const OUT_ANCHOR_DIR = path.join(ROOT, 'test', 'metadata', 'election-anchors-test2');
const OUT_MANIFEST = path.join(ROOT, 'test', 'metadata', 'elections-test2.json');
const OUT_REPORT = path.join(ROOT, 'test', 'metadata', 'elections-test2-report.json');
const DAIL_WIKIPEDIA_COUNTS_ROOT = path.join(ROOT, 'data', 'elections', 'dail-wikipedia-counts');
const DAIL_OFFICIAL_RESULTS = path.join(ROOT, 'data', 'elections', 'dail-official-results.json');
const DAIL_APPROVED_CANDIDATE_ALIASES = path.join(ROOT, 'data', 'elections', 'dail-approved-candidate-aliases.json');
const dailOfficialResults = existsSync(DAIL_OFFICIAL_RESULTS)
  ? readJson(DAIL_OFFICIAL_RESULTS)
  : { elections: {} };
const dailApprovedCandidateAliases = existsSync(DAIL_APPROVED_CANDIDATE_ALIASES)
  ? readJson(DAIL_APPROVED_CANDIDATE_ALIASES)
  : { aliases: [] };
let dailApprovedCandidateAliasIndex = new Map();

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
  ['carlow kilkenny', 'carlow-kilkenny'],
  ['roscommon south leitrim', 'roscommon leitrim south'],
  ['wicklow wexford3', 'wicklow wexford'],
  ['ireland', 'republic of ireland'],
  ['derry area a', 'londonderry area a'],
  ['derry area b', 'londonderry area b'],
  ['derry area c', 'londonderry area c'],
  ['derry area d', 'londonderry area d']
]);

dailApprovedCandidateAliasIndex = buildDailApprovedCandidateAliasIndex(dailApprovedCandidateAliases);

const SOURCE_NAME_ALIASES = new Map([
  ['dail-2023', new Map([
    ['Limerick County (3)', 'Limerick']
  ])],
  ['dail-2017', new Map([
    ['Limerick County (3)', 'Limerick']
  ])],
  ['dail-2009', new Map([
    ['Kerry North-West Limerick', 'Kerry North Limerick West'],
    ['Laois-Offaly', 'Laoighis Offaly'],
    ['Roscommon-South Leitrim', 'Roscommon Leitrim South'],
    ['Sligo-North Leitrim', 'Sligo Leitrim North']
  ])],
  ['dail-2005', new Map([
    ['Cork North-Centrla', 'Cork North Central'],
    ['Laois-Offaly', 'Laoighis Offaly'],
    ['Roscommon-South Leitrim', 'Roscommon Leitrim South'],
    ['Sligo-North Leitrim', 'Sligo Leitrim North']
  ])],
  ['pc-1918-ireland', new Map([
    ['Connemara', 'Galway Connemara'],
    ['Pembroke', 'Dublin Pembroke'],
    ['Rathmines', 'Dublin Rathmines'],
    ['Dublin County N', 'Dublin North'],
    ['Dublin County S', 'Dublin South'],
    ["Dublin St Stephen's Green", "Dublin St Stephen's"],
    ['Cork City', 'Cork'],
    ['LimerickCity', 'Limerick'],
    ['Londonderry City', 'Londonderry'],
    ['Waterford City', 'Waterford'],
    ['Waterford', 'Waterford County'],
    ['Waterford E', 'Waterford County'],
    ['Leitrim S', 'Leitrim'],
    ['Longford S', 'Longford'],
    ['Louth S', 'Louth'],
    ['Westmeath S', 'Westmeath'],
    ['Birr', "King's County"],
    ['Leix', "Queen's County"]
  ])],
  ['mep-1979', new Map([
    ['CONNACHT-ULSTER', 'Connaught Ulster']
  ])],
  ['roi-local-authorities-1994', new Map([
    ['DUBLIN CORPORATION', 'Dublin City'],
    ['LAOIGHIS COUNTY COUNCIL', 'County Laois'],
    ['TIPPERARY (NORTH RIDING) COUNTY COUNCIL', 'Tipperary North'],
    ['TIPPERARY (SOUTH RIDING) COUNTY COUNCIL', 'Tipperary South']
  ])],
  ['roi-local-authorities-2002', new Map([
    ['NORTH TIPPERARY COUNTY COUNCIL', 'Tipperary North'],
    ['SOUTH TIPPERARY COUNTY COUNCIL', 'Tipperary South']
  ])],
  ['deas-1993', new Map([
    ['KNOCKIVEAGH', 'Knockveagh'],
    ['DUNMURRY CROSS', 'Dunmurray Cross']
  ])],
  ['deas-1984', new Map([
    ['BRAID VALLEY', 'Braid'],
    ['LAGANSIDE', 'Laganbank']
  ])]
]);

const OFFICIAL_DAIL_NAME_ALIASES = new Map([
  ['2016-02-26', new Map([
    ['limerick', 'limerick-county']
  ])],
  ['2020-02-08', new Map([
    ['limerick', 'limerick-county']
  ])],
  ['2024-11-29', new Map([
    ['limerick', 'limerick-county']
  ])]
]);

const LOCAL_GOVERNMENT_CODE_PREFIXES = new Map([
  ['Antrim', 'AnT'],
  ['Ards', 'ArD'],
  ['Armagh', 'ArM'],
  ['Ballymena', 'Bal'],
  ['Ballymoney', 'Bly'],
  ['Banbridge', 'Ban'],
  ['Belfast', 'Bel'],
  ['Carrickfergus', 'Car'],
  ['Castlereagh', 'Cas'],
  ['Coleraine', 'Col'],
  ['Cookstown', 'Ckt'],
  ['Craigavon', 'Crg'],
  ['Derry', 'Der'],
  ['Down', 'Dow'],
  ['Dungannon', 'Dun'],
  ['Fermanagh', 'Fer'],
  ['Larne', 'Lar'],
  ['Limavady', 'Lim'],
  ['Lisburn', 'Lis'],
  ['Magherafelt', 'Mag'],
  ['Moyle', 'Moy'],
  ['Newry and Mourne', 'NaM'],
  ['Newtownabbey', 'New'],
  ['North Down', 'NoD'],
  ['Omagh', 'Oma'],
  ['Strabane', 'Str']
]);

const PARTY_COLOURS = new Map([
  ['alliance', '#f6cb2f'],
  ['aontu', '#44532a'],
  ['conservative', '#0087dc'],
  ['dup', '#d46a4c'],
  ['fianna fail', '#66bb66'],
  ['fianna fail', '#66bb66'],
  ['fine gael', '#6699ff'],
  ['green', '#22ac6f'],
  ['green party', '#22ac6f'],
  ['independent', '#b8b8b8'],
  ['independent ireland', '#3bee56'],
  ['irish labour', '#cc0000'],
  ['labour', '#cc0000'],
  ['pbp', '#ff0090'],
  ['sdlp', '#2aa82c'],
  ['sinn fein', '#326760'],
  ['social democrats', '#752f8b'],
  ['solidarity pbp', '#8e2420'],
  ['solidarity-pbp', '#8e2420'],
  ['tuv', '#0c3a6a'],
  ['uup', '#48a5ee'],
  ['yes', '#2aa82c'],
  ['no', '#d46a4c']
]);

async function main() {
  const electionIndex = readJson(ELECTION_INDEX);
  const mapMetadata = readJson(MAP_METADATA);
  const layers = Array.isArray(mapMetadata.layers) ? mapMetadata.layers : [];
  const layerBySource = buildLayerLookup(layers);
  const featureIndexes = loadFeatureIndexes(layers);
  const entries = buildUniqueElectionEntries(electionIndex);
  const previousKeyByKey = buildPreviousElectionKeyLookup(entries);

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_ANCHOR_DIR, { recursive: true });

  const manifestEntries = [];
  const reportEntries = [];
  let totalMatched = 0;
  let totalUnmatched = 0;

  for (const entry of entries) {
    const geography = resolveElectionGeography(entry);
    const councilGeography = resolveLocalGovernmentCouncilGeography(entry);
    const layer = geography?.sourceMapId ? layerBySource.get(geography.sourceMapId) : null;
    const councilLayer = councilGeography?.sourceMapId ? layerBySource.get(councilGeography.sourceMapId) : null;
    const featureIndex = layer ? featureIndexes.get(layer.id) || featureIndexes.get(layer.sourceMapId) : null;
    const bundle = await buildElectionBundle(entry, geography, layer, featureIndex, previousKeyByKey.get(electionKey(entry)) || null, {
      councilGeography,
      councilLayer
    });
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
      displayTitle: bundle.displayTitle,
      displaySubtitle: bundle.displaySubtitle,
      displayProvider: bundle.displayProvider,
      contestType: bundle.contestType,
      kind: bundle.kind,
      votingSystem: bundle.votingSystem,
      contestStatus: bundle.contestStatus,
      candidateRowsExpected: bundle.candidateRowsExpected,
      transferDataExpected: bundle.transferDataExpected,
      votesPerElector: bundle.votesPerElector,
      localBodies: bundle.localBodies,
      constituencies: bundle.constituencies,
      isByElection: bundle.isByElection,
      sourceMapId: bundle.sourceMapId,
      layerId: bundle.layerId,
      labelProperty: bundle.labelProperty,
      councilSourceMapId: bundle.councilSourceMapId,
      councilLayerId: bundle.councilLayerId,
      councilLabelProperty: bundle.councilLabelProperty,
      loadable: bundle.loadable,
      placeholder: !bundle.loadable,
      matchedCount: bundle.matchedCount,
      unmatchedCount: bundle.unmatchedCount,
      totalConstituencies: bundle.totalConstituencies,
      unmatchedConstituencySample: bundle.unmatchedConstituencies.slice(0, 30),
      unmatchedConstituencySampleLimit: 30,
      unmatchedConstituencies: bundle.unmatchedConstituencies.length <= 30 ? bundle.unmatchedConstituencies : undefined,
      resultUrl: `/test/metadata/elections-test2/${bundle.key}.json`,
      anchorUrl: bundle.anchorUrl,
      previousKey: bundle.previousKey,
      previousDate: bundle.previousDate,
      stylingModes: bundle.availableStyleModes
    };
    manifestEntries.push(manifestEntry);
    if (!bundle.loadable || bundle.unmatchedCount > 0) {
      const unmatchedDetails = buildUnmatchedDetails(bundle);
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
        unmatchedConstituencies: bundle.unmatchedConstituencies,
        unmatchedDetails,
        residualSummary: summarizeResiduals(unmatchedDetails)
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
    elections: preserveExistingSummaryUrls(manifestEntries).sort(compareElectionEntries)
  };

  const report = {
    schemaVersion: 1,
    generatedAt: manifest.generatedAt,
    totals: manifest.totals,
    unmatchedElections: reportEntries.length,
    residualSummary: summarizeResiduals(reportEntries.flatMap((entry) => entry.unmatchedDetails || [])),
    closureSummary: summarizeClosure(reportEntries.flatMap((entry) => entry.unmatchedDetails || [])),
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
  const localByDate = new Map();
  for (const [bodyIndex, body] of (index.bodies || []).entries()) {
    for (const dateEntry of body.dates || []) {
      const bodyGroup = body.slug === 'local-government' || LOCAL_GOVERNMENT_BODIES.has(body.name) ? 'local-government' : null;
      if (bodyGroup === 'local-government') {
        const dateKey = dateEntry.date;
        if (!localByDate.has(dateKey)) {
          localByDate.set(dateKey, {
            body: 'Local Government Districts',
            bodySlug: 'local-government',
            bodyGroup,
            date: dateEntry.date,
            bodyIndexes: [],
            bodies: [],
            constituencies: [],
            localBodyByConstituency: {}
          });
        }
        const group = localByDate.get(dateKey);
        group.bodyIndexes.push(bodyIndex);
        if (!group.bodies.includes(body.name)) group.bodies.push(body.name);
        for (const constituency of dateEntry.constituencies || []) {
          if (!group.constituencies.includes(constituency)) group.constituencies.push(constituency);
          if (constituency && !group.localBodyByConstituency[constituency]) {
            group.localBodyByConstituency[constituency] = body.name;
          }
        }
        continue;
      }
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
        bodyGroup,
        date: dateEntry.date,
        bodyIndexes: [bodyIndex],
        constituencies: unique(dateEntry.constituencies || [])
      });
    }
  }
  for (const group of localByDate.values()) {
    if (group.bodies.length > 1) {
      group.displayTitle = canonicalElectionTitle(group);
      group.displayProvider = 'Local Government Districts';
      byKey.set(`${group.body}|${group.date}`, {
        ...group,
        constituencies: unique(group.constituencies),
        bodies: [...group.bodies].sort((a, b) => a.localeCompare(b)),
        bodyIndexes: unique(group.bodyIndexes)
      });
    } else {
      const body = group.bodies[0] || group.body;
      byKey.set(`${body}|${group.date}`, {
        ...group,
        body,
        displayTitle: canonicalElectionTitle({ ...group, body }),
        displayProvider: `Local government: ${body}`,
        constituencies: unique(group.constituencies),
        bodies: [body],
        bodyIndexes: unique(group.bodyIndexes)
      });
    }
  }
  return [...byKey.values()].map((entry) => ({
    ...entry,
    displayTitle: entry.displayTitle || canonicalElectionTitle(entry)
  }));
}

function preserveExistingSummaryUrls(entries) {
  if (!existsSync(OUT_MANIFEST)) return entries;
  let existing;
  try {
    existing = readJson(OUT_MANIFEST);
  } catch {
    return entries;
  }
  const summaryUrls = new Map((existing.elections || [])
    .filter((entry) => entry?.key && entry?.summaryUrl)
    .map((entry) => [entry.key, entry.summaryUrl]));
  return entries.map((entry) => {
    const summaryUrl = summaryUrls.get(entry.key);
    return summaryUrl && !entry.summaryUrl ? { ...entry, summaryUrl } : entry;
  });
}

function buildPreviousElectionKeyLookup(entries) {
  const previousByKey = new Map();
  const ordered = [...entries].sort((a, b) => String(a.date).localeCompare(String(b.date)) || electionKey(a).localeCompare(electionKey(b)));
  for (const entry of ordered) {
    const previous = findPreviousComparableElection(entry, ordered);
    if (previous) previousByKey.set(electionKey(entry), electionKey(previous));
  }
  return previousByKey;
}

function findPreviousComparableElection(entry, orderedEntries) {
  const metadata = classifyElection(entry);
  const group = comparableElectionGroup(entry);
  if (!group || metadata.contestType !== 'election') return null;

  const entryDate = String(entry.date || '');
  const entryKey = electionKey(entry);
  const previousEntries = orderedEntries.filter((candidate) => {
    const candidateMetadata = classifyElection(candidate);
    if (candidateMetadata.contestType !== 'election') return false;
    const candidateKey = electionKey(candidate);
    if (candidateKey === entryKey) return false;
    if (String(candidate.date || '') >= entryDate) return false;
    return comparableElectionGroup(candidate) === group;
  });

  if (metadata.kind === 'by-election') {
    const matchingArea = previousEntries
      .filter((candidate) => electionsOverlapByArea(entry, candidate))
      .sort(compareElectionEntriesAsc);
    return matchingArea.at(-1) || null;
  }

  const previousGeneral = previousEntries
    .filter((candidate) => classifyElection(candidate).kind === 'general')
    .sort(compareElectionEntriesAsc)
    .at(-1);
  if (previousGeneral) return previousGeneral;

  if (group === 'dail') {
    return orderedEntries
      .filter((candidate) => {
        const candidateMetadata = classifyElection(candidate);
        return candidateMetadata.contestType === 'election'
          && candidateMetadata.kind === 'general'
          && comparableElectionGroup(candidate) === 'westminster'
          && String(candidate.date || '') < entryDate;
      })
      .sort(compareElectionEntriesAsc)
      .at(-1) || null;
  }

  return null;
}

function comparableElectionGroup(entry) {
  const bodySlug = String(entry?.bodySlug || '');
  if (bodySlug === 'house-of-commons-of-the-united-kingdom') return 'westminster';
  if (bodySlug === 'dail-eireann') return 'dail';
  if (bodySlug === 'ireland-president' || bodySlug === 'president-of-ireland') return 'ireland-president';
  if (bodySlug === 'ireland-european') return 'european-roi';
  if (bodySlug === 'european-parliament') return 'european-ni';
  if (bodySlug === 'local-government') return 'ni-local';
  if (bodySlug === 'ireland-local') return 'roi-local';
  if ([
    'northern-ireland-assembly',
    'northern-ireland-constitutional-convention',
    'northern-ireland-forum-for-political-dialogue',
    'parliament-of-northern-ireland'
  ].includes(bodySlug)) {
    return 'ni-devolved';
  }
  return null;
}

function electionsOverlapByArea(entry, candidate) {
  const current = normalizedElectionAreas(entry);
  if (!current.size) return true;
  const previous = normalizedElectionAreas(candidate);
  if (!previous.size) return true;
  for (const key of current) {
    if (previous.has(key)) return true;
  }
  return false;
}

function normalizedElectionAreas(entry) {
  const names = new Set();
  for (const name of entry?.constituencies || []) {
    const normalized = normalizeName(name);
    if (normalized) names.add(normalized);
  }
  for (const name of entry?.localBodies || []) {
    const normalized = normalizeName(name);
    if (normalized) names.add(normalized);
  }
  return names;
}

function compareElectionEntriesAsc(a, b) {
  return String(a.date || '').localeCompare(String(b.date || '')) || electionKey(a).localeCompare(electionKey(b));
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
    const date = String(entry.date || '');
    if (date >= '2024-11-29') return { sourceMapId: 'dail-2023' };
    if (date >= '2020-02-08') return { sourceMapId: 'dail-2017' };
    if (date >= '2016-02-26') return { sourceMapId: 'dail-2013' };
    if (date >= '2011-02-25') return { sourceMapId: 'dail-2009' };
    if (date >= '2007-05-24') return { sourceMapId: 'dail-2005' };
    if (date >= '1997-06-06') return { sourceMapId: 'dail-1998' };
    if (date >= '1992-11-25') return { sourceMapId: 'dail-1990' };
    if (date >= '1987-02-17') return { sourceMapId: 'dail-1983' };
    if (date >= '1981-06-11') return { sourceMapId: 'dail-1980' };
    if (date >= '1977-06-16') return { sourceMapId: 'dail-1974' };
    return { sourceMapId: null };
  }
  if (body === 'President of Ireland') return { sourceMapId: 'roi-1938', singleConstituency: true };
  if (body === 'Referendum (Ireland)') {
    if (isNationalAggregateElection(entry)) return { sourceMapId: 'roi-1938', singleConstituency: true };
    if (looksLikeRoiLocalAuthorityResults(entry)) {
      if (year >= 2019) return { sourceMapId: 'roi-local-authorities-2024' };
      if (year >= 2002) return { sourceMapId: 'roi-local-authorities-2002' };
      if (year >= 1992) return { sourceMapId: 'roi-local-authorities-1994' };
    }
    if (String(entry.date || '') >= '2024-11-29') return { sourceMapId: 'dail-2023' };
    if (year === 2019) return { sourceMapId: 'roi-local-authorities-2024' };
    if (year >= 2017) return { sourceMapId: 'dail-2017' };
    if (year >= 2013) return { sourceMapId: 'dail-2013' };
    if (year >= 2011) return { sourceMapId: 'dail-2009' };
    if (year >= 2002) return { sourceMapId: 'dail-2005' };
    if (year >= 1992) return { sourceMapId: 'dail-1998' };
    return { sourceMapId: 'roi-counties-2011' };
  }
  if (body === 'European Parliament (Ireland)') {
    return sourceByYear(year, [
      [2024, 'mep-2024'],
      [2019, 'mep-2019'],
      [2014, 'mep-2014'],
      [2004, 'mep-2004'],
      [-Infinity, 'mep-1979']
    ]);
  }
  return { sourceMapId: null };
}

function resolveLocalGovernmentCouncilGeography(entry) {
  if (entry?.bodyGroup !== 'local-government') return null;
  const year = Number(String(entry.date).slice(0, 4));
  return sourceByYear(year, [
    [2014, 'lgd-2012'],
    [1993, 'lgd-1993'],
    [1984, 'lgd-1984'],
    [-Infinity, 'lgd-1972']
  ]);
}

function isNationalAggregateElection(entry) {
  const constituencies = entry.constituencies || [];
  return constituencies.length === 1 && ['ireland', 'republic of ireland'].includes(normalizeName(constituencies[0]));
}

function looksLikeRoiLocalAuthorityResults(entry) {
  const constituencies = entry.constituencies || [];
  const localAuthorityLikeCount = constituencies.filter((name) => {
    const normalized = normalizeName(name);
    return /\b(city|county|borough)\b/.test(normalized)
      || /\bfingal\b/.test(normalized)
      || /\bdun laoghaire\b/.test(normalized)
      || /\bsouth dublin\b/.test(normalized);
  }).length;
  return localAuthorityLikeCount >= 10 && localAuthorityLikeCount / Math.max(constituencies.length, 1) >= 0.5;
}

function classifyElection(entry) {
  const contestType = contestTypeForElection(entry);
  const votingSystem = votingSystemForElection(entry);
  const kind = contestType === 'election' ? (isElectionByElectionScope({ ...entry, specialType: contestType }) ? 'by-election' : 'general') : null;
  const candidateRowsExpected = contestType === 'election';
  const transferDataExpected = transferDataExpectedForElection(entry, { votingSystem, contestType, contestStatus: 'contested' });
  const votesPerElector = votingSystem === 'block-vote' ? 2 : null;
  return compactObject({
    contestType,
    kind,
    votingSystem,
    contestStatus: 'contested',
    candidateRowsExpected,
    transferDataExpected,
    votesPerElector
  });
}

function classifyElectionResult(entry, result, parentMetadata = classifyElection(entry)) {
  const contestType = parentMetadata.contestType || contestTypeForElection(entry);
  const votingSystem = votingSystemForElection(entry, result) || parentMetadata.votingSystem;
  const contestStatus = contestStatusForResult(result);
  const candidateRowsExpected = contestType === 'election' && contestStatus !== 'uncontested';
  const transferDataExpected = transferDataExpectedForElection(entry, {
    result,
    votingSystem,
    contestType,
    contestStatus
  });
  const votesPerElector = votingSystem === 'block-vote'
    ? Math.max(2, parseNumber(result?.seatsTotal) || parseNumber(result?.seatsWon) || 2)
    : null;
  return compactObject({
    contestType,
    kind: parentMetadata.kind,
    votingSystem,
    contestStatus,
    candidateRowsExpected,
    transferDataExpected,
    votesPerElector
  });
}

function contestTypeForElection(entry) {
  const bodySlug = String(entry?.bodySlug || '');
  const text = normalizeName(`${entry?.body || ''} ${entry?.displayTitle || canonicalElectionTitle(entry || {}) || ''} ${entry?.date || ''}`);
  if (bodySlug === 'ireland-referendum' || /\breferendum\b/.test(text)) return 'referendum';
  if (/\brecall petition\b/.test(text)) return 'recall-petition';
  if (bodySlug === 'house-of-commons-of-the-united-kingdom' && String(entry?.date || '').slice(0, 10) === '2018-08-29') return 'recall-petition';
  return 'election';
}

function votingSystemForElection(entry, result = null) {
  const contestType = contestTypeForElection(entry);
  if (contestType === 'referendum' || contestType === 'recall-petition') return 'ordinal';
  const bodySlug = String(entry?.bodySlug || '');
  const year = Number(String(entry?.date || '').slice(0, 4));
  const resultName = normalizeName(result?.constituency || result?.featureName || result?.matchName || '');
  if (bodySlug === 'dail-eireann') return 'stv-hare';
  if (bodySlug === 'president-of-ireland' || bodySlug === 'ireland-president') return 'stv-hare';
  if (bodySlug === 'ireland-local') return 'stv-hare';
  if (bodySlug === 'ireland-european') return 'stv-hare';
  if (bodySlug === 'european-parliament') return 'stv-gregory';
  if (bodySlug === 'local-government') return 'stv-gregory';
  if (bodySlug === 'northern-ireland-assembly') return 'stv-gregory';
  if (bodySlug === 'northern-ireland-constitutional-convention') return 'stv-gregory';
  if (bodySlug === 'northern-ireland-forum-for-political-dialogue') {
    return resultName === 'northern ireland' ? 'ordinal' : 'party-list-dhondt';
  }
  if (bodySlug === 'parliament-of-northern-ireland') return year > 0 && year < 1929 ? 'stv-gregory' : 'fptp';
  if (bodySlug === 'house-of-commons-of-the-united-kingdom') {
    const seats = parseNumber(result?.seatsTotal) || parseNumber(result?.seatsWon);
    return seats && seats > 1 ? 'block-vote' : 'fptp';
  }
  return 'fptp';
}

function contestStatusForResult(result) {
  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  if (!candidates.length) return 'contested';
  const elected = candidates.filter((candidate) => candidate?.elected).length;
  const seatsTotal = parseNumber(result?.seatsTotal) || parseNumber(result?.seatsWon);
  const hasAnyVotes = candidates.some((candidate) => parseNumber(candidate?.firstPrefs) > 0);
  if (seatsTotal && elected >= seatsTotal && candidates.length <= seatsTotal && !hasAnyVotes) return 'uncontested';
  return 'contested';
}

function transferDataExpectedForElection(entry, { result = null, votingSystem = null, contestType = null, contestStatus = 'contested' } = {}) {
  const type = contestType || contestTypeForElection(entry);
  if (type !== 'election' || contestStatus === 'uncontested') return false;
  const system = votingSystem || votingSystemForElection(entry, result);
  if (!['stv-hare', 'stv-gregory'].includes(system)) return false;
  const seats = parseNumber(result?.seatsTotal) || parseNumber(result?.seatsWon);
  if (seats !== null && seats <= 1) return false;
  return true;
}

async function buildElectionBundle(entry, geography, layer, featureIndex, previousKey = null, options = {}) {
  const key = electionKey(entry);
  const publicDisplayTitle = entry.displayTitle || canonicalElectionTitle({ ...entry, key });
  const electionMetadata = classifyElection(entry);
  const featureLookup = buildFeatureLookup(featureIndex, geography?.sourceMapId);
  const dateDir = path.join(ELECTION_ROOT, entry.bodySlug, entry.date);
  const dirExists = existsSync(dateDir);
  const singleFeature = geography?.singleConstituency ? firstFeature(featureIndex) : null;
  const anchorIndex = layer ? await loadOrBuildAnchorIndex(layer, featureIndex) : null;
  const results = [];
  const rawEntries = [];
  const unmatched = [];
  const syntheticAnchorState = { count: 0 };

  for (const constituency of entry.constituencies || []) {
    const resultPath = findResultFile(dateDir, constituency);
    const rawResult = resultPath ? readJson(resultPath) : null;
    const officialRawResult = enrichDailResultWithOfficialData(entry, rawResult, constituency);
    const enrichedRawResult = enrichDailResultWithWikipediaCounts(entry, resultPath, officialRawResult, constituency);
    if (officialRawResult) rawEntries.push({ constituency, raw: officialRawResult });
    const result = ElectionDomain.summarizeResult(enrichedRawResult, constituency);
    const resultMetadata = classifyElectionResult(entry, result, electionMetadata);
    const matchEntry = matchEntryForConstituency(entry, result.constituency || constituency);
    const localBody = entry.bodyGroup === 'local-government' ? matchEntry.body : null;
    if (localBody && Array.isArray(result.candidates)) {
      result.candidates = result.candidates.map((candidate) => ({
        ...candidate,
        localBody,
        district: localBody,
        dea: result.constituency || constituency
      }));
    }
    const matchSet = matchFeaturesForResult(featureLookup, entry, geography, result, matchEntry, singleFeature);
    const match = matchSet[0] || null;
    const syntheticRegion = !match && isSyntheticNonGeographicResult(entry, result.constituency || constituency)
      ? syntheticNonGeographicMatch(anchorIndex, layer, result.constituency || constituency, syntheticAnchorState)
      : null;
    if (!match && !syntheticRegion && !geography?.singleConstituency) unmatched.push(result.constituency || constituency);
    const featureMatches = syntheticRegion
      ? [normalizeFeatureMatch(syntheticRegion)]
      : matchSet.map(normalizeFeatureMatch).filter(Boolean);
    const featureMatchFields = buildFeatureMatchFields(featureMatches, match, syntheticRegion);
    results.push({
      ...result,
      ...resultMetadata,
      localBody,
      sourceFile: resultPath ? slash(path.relative(ROOT, resultPath)) : null,
      featureId: match?.id ?? syntheticRegion?.id ?? null,
      featureName: match?.name ?? syntheticRegion?.name ?? null,
      featureAliases: featureMatchFields.featureAliases,
      ...featureMatchFields.extra,
      matchName: match?.name ?? syntheticRegion?.name ?? null,
      anchor: syntheticRegion?.anchor || (anchorIndex ? findAnchorForMatch(anchorIndex, match, result) : null),
      syntheticRegion: syntheticRegion?.syntheticRegion || null,
      ...(syntheticRegion?.syntheticNonGeographic ? { syntheticNonGeographic: true } : {}),
      matched: Boolean(match || syntheticRegion)
    });
  }

  if (entry.constituencies.length === 0 && dirExists) {
    for (const file of readdirSync(dateDir).filter((name) => name.endsWith('.json') && name !== '_index.json')) {
      const resultPath = path.join(dateDir, file);
      const rawResult = readJson(resultPath);
      const constituency = file.replace(/\.json$/, '');
      const officialRawResult = enrichDailResultWithOfficialData(entry, rawResult, constituency);
      const enrichedRawResult = enrichDailResultWithWikipediaCounts(entry, resultPath, officialRawResult, constituency);
      rawEntries.push({ constituency, raw: officialRawResult });
      const result = ElectionDomain.summarizeResult(enrichedRawResult, constituency);
      const resultMetadata = classifyElectionResult(entry, result, electionMetadata);
      const matchEntry = matchEntryForConstituency(entry, result.constituency);
      const localBody = entry.bodyGroup === 'local-government' ? matchEntry.body : null;
      if (localBody && Array.isArray(result.candidates)) {
        result.candidates = result.candidates.map((candidate) => ({
          ...candidate,
          localBody,
          district: localBody,
          dea: result.constituency || constituency
        }));
      }
      const matchSet = matchFeaturesForResult(featureLookup, entry, geography, result, matchEntry, singleFeature);
      const match = matchSet[0] || null;
      const syntheticRegion = !match && isSyntheticNonGeographicResult(entry, result.constituency)
        ? syntheticNonGeographicMatch(anchorIndex, layer, result.constituency, syntheticAnchorState)
        : null;
      if (!match && !syntheticRegion && !geography?.singleConstituency) unmatched.push(result.constituency);
      const featureMatches = syntheticRegion
        ? [normalizeFeatureMatch(syntheticRegion)]
        : matchSet.map(normalizeFeatureMatch).filter(Boolean);
      const featureMatchFields = buildFeatureMatchFields(featureMatches, match, syntheticRegion);
      results.push({
        ...result,
        ...resultMetadata,
        localBody,
        sourceFile: slash(path.relative(ROOT, resultPath)),
        featureId: match?.id ?? syntheticRegion?.id ?? null,
        featureName: match?.name ?? syntheticRegion?.name ?? null,
        featureAliases: featureMatchFields.featureAliases,
        ...featureMatchFields.extra,
        matchName: match?.name ?? syntheticRegion?.name ?? null,
        anchor: syntheticRegion?.anchor || (anchorIndex ? findAnchorForMatch(anchorIndex, match, result) : null),
        syntheticRegion: syntheticRegion?.syntheticRegion || null,
        ...(syntheticRegion?.syntheticNonGeographic ? { syntheticNonGeographic: true } : {}),
        matched: Boolean(match || syntheticRegion)
      });
    }
  }

  const matchedCount = results.filter((result) => result.matched).length;
  const unmatchedCount = results.length - matchedCount;
  const availableStyleModes = STYLE_MODES.filter((mode) => modeAvailable(mode, results));
  const year = Number(String(entry.date).slice(0, 4));
  const previousDate = previousKey ? previousKey.split('__').pop()?.replace(/-/g, '-') : null;
  const mainLikePartySummary = ElectionDomain.buildMainLikePartySummaryFromRawResults(rawEntries);
  const mainLikeCandidateSummary = ElectionDomain.buildMainLikeCandidateSummaryFromRawResults(rawEntries);
  const partySummary = entry.bodySlug === 'dail-eireann'
    ? mainLikePartySummary.rows
    : ElectionDomain.buildPartySummary(results);
  const entityIndex = ElectionDomain.buildEntityIndex(results);
  return {
    schemaVersion: 1,
    key,
    body: entry.body,
    bodySlug: entry.bodySlug,
    bodyGroup: entry.bodyGroup,
    displayTitle: publicDisplayTitle,
    ...electionMetadata,
    localBodies: entry.bodies || null,
    localBodyByConstituency: entry.localBodyByConstituency || null,
    date: entry.date,
    year,
    sourceMapId: geography?.sourceMapId || null,
    layerId: layer?.id || null,
    labelProperty: layer?.labelProperty || null,
    councilSourceMapId: options.councilGeography?.sourceMapId || null,
    councilLayerId: options.councilLayer?.id || null,
    councilLabelProperty: options.councilLayer?.labelProperty || null,
    councilGeometryType: options.councilLayer?.geometryType || null,
    geometryType: layer?.geometryType || null,
    anchorUrl: anchorIndex?.url || null,
    previousKey,
    previousDate,
    loadable: Boolean(layer && geography?.sourceMapId && results.length > 0 && matchedCount > 0),
    displaySubtitle: formatElectionSubtitle(entry, results, unmatchedCount),
    displayProvider: entry.displayProvider || (entry.bodyGroup === 'local-government' ? `Local government: ${entry.body}` : entry.body),
    constituencies: entry.constituencies,
    isByElection: electionMetadata.kind === 'by-election',
    totalConstituencies: results.length,
    matchedCount,
    unmatchedCount,
    unmatchedConstituencies: unique(unmatched),
    availableStyleModes,
    partySummary,
    mainLikePartySummary: mainLikePartySummary.rows,
    mainLikeTotals: mainLikePartySummary.totals,
    mainLikeCandidateSummary: mainLikeCandidateSummary.rows,
    mainLikeCandidateTotals: mainLikeCandidateSummary.totals,
    entityIndex,
    results: results.sort((a, b) => String(a.constituency).localeCompare(String(b.constituency)))
  };
}

function matchEntryForConstituency(entry, constituency) {
  if (entry?.bodyGroup !== 'local-government') return entry;
  const localBody = entry.localBodyByConstituency?.[constituency]
    || entry.localBodyByConstituency?.[fixText(constituency || '').trim()];
  if (!localBody || localBody === entry.body) return entry;
  return {
    ...entry,
    body: localBody
  };
}

const REFERENDUM_RESULT_FEATURE_SPLITS = Object.freeze({
  'dail-2023': {
    'dublin fingal': ['Dublin Fingal East', 'Dublin Fingal West'],
    'laois offaly': ['Laois', 'Offaly'],
    'tipperary': ['Tipperary North', 'Tipperary South']
  },
  'dail-2013': {
    'laois offaly': ['Laois', 'Offaly']
  },
  'dail-2005': {
    'meath': ['Meath East', 'Meath West']
  },
  'dail-1998': {
    'kildare': ['Kildare North', 'Kildare South']
  }
});

function matchFeaturesForResult(featureLookup, entry, geography, result, matchEntry, singleFeature = null) {
  if (singleFeature) return [singleFeature];
  const direct = matchFeature(featureLookup, result.constituency, matchEntry);
  if (direct) return [direct];
  const splitTargets = referendumSplitTargets(entry, geography, result);
  if (!splitTargets.length) return [];
  const matches = [];
  for (const target of splitTargets) {
    const match = matchFeature(featureLookup, target, matchEntry);
    if (!match) return [];
    matches.push(match);
  }
  return matches;
}

function referendumSplitTargets(entry, geography, result) {
  if (entry?.body !== 'Referendum (Ireland)') return [];
  const sourceMapId = geography?.sourceMapId || '';
  const targets = REFERENDUM_RESULT_FEATURE_SPLITS[sourceMapId]?.[normalizeName(result?.constituency)];
  return Array.isArray(targets) ? targets : [];
}

function normalizeFeatureMatch(match) {
  if (!match) return null;
  return {
    id: match.id ?? null,
    name: match.name || '',
    aliases: unique([match.name, ...(match.aliases || [])].filter(Boolean))
  };
}

function buildFeatureMatchFields(featureMatches, match, syntheticRegion) {
  if (featureMatches.length <= 1) {
    return {
      featureAliases: match?.aliases || syntheticRegion?.aliases || [],
      extra: {}
    };
  }
  return {
    featureAliases: unique(featureMatches.flatMap((item) => [item.name, ...(item.aliases || [])]).filter(Boolean)),
    extra: {
      featureIds: unique(featureMatches.map((item) => item.id).filter((value) => value !== null && value !== undefined)),
      featureNames: unique(featureMatches.map((item) => item.name).filter(Boolean)),
      featureMatches
    }
  };
}

function buildLayerLookup(layers) {
  const lookup = new Map();
  const defaultVariantByParent = new Map();
  for (const layer of layers) {
    if (layer.id) lookup.set(layer.id, layer);
    if (layer.sourceMapId) {
      lookup.set(layer.sourceMapId, layer);
      const parentSourceMapId = parentMapIdForVariant(layer.sourceMapId);
      if (parentSourceMapId && !defaultVariantByParent.has(parentSourceMapId)) {
        defaultVariantByParent.set(parentSourceMapId, layer);
      }
    }
  }
  for (const [sourceMapId, layer] of defaultVariantByParent) {
    if (!lookup.has(sourceMapId)) lookup.set(sourceMapId, layer);
  }
  return lookup;
}

function parentMapIdForVariant(sourceMapId) {
  const match = String(sourceMapId || '').match(/^(.*)-v\d+$/);
  return match ? match[1] : null;
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

const anchorCache = new Map();

async function loadOrBuildAnchorIndex(layer, featureIndex) {
  if (!layer?.id) return null;
  if (anchorCache.has(layer.id)) return anchorCache.get(layer.id);
  const outputPath = path.join(OUT_ANCHOR_DIR, `${layer.id}.json`);
  const sourceFile = layer.sourceFile ? path.join(ROOT, layer.sourceFile) : null;
  if (existsSync(outputPath) && (!sourceFile || !existsSync(sourceFile))) {
    const persisted = readJson(outputPath);
    const anchorIndex = hydrateAnchorIndex(layer, persisted);
    anchorCache.set(layer.id, anchorIndex);
    return anchorIndex;
  }
  const items = [];

  let generatedFromSourceGeometry = false;
  if (sourceFile && existsSync(sourceFile) && /\.fgb$/i.test(sourceFile)) {
    try {
      const sourceBytes = new Uint8Array(readFileSync(sourceFile));
      for await (const feature of deserialize(sourceBytes)) {
        const props = feature.properties || {};
        const name = fixText(props[layer.labelProperty] || props.NAME || props.Name || props.name || props.label_name || '');
        const anchor = geometryAnchor(feature.geometry);
        if (!anchor) continue;
        items.push({
          id: props[layer.promoteId || 'id'] ?? props.id ?? props.OBJECTID ?? null,
          name,
          aliases: name ? [name] : [],
          anchor,
          center: anchor.center,
          area: anchor.area
        });
      }
      generatedFromSourceGeometry = items.length > 0;
    } catch (error) {
      console.warn(`[test2 elections] Falling back to feature-index anchors for ${layer.id}: ${error.message}`);
    }
  }

  if (!items.length) {
    for (const item of featureIndex?.items || []) {
      if (!Array.isArray(item.center)) continue;
      items.push({
        id: item.id ?? null,
        name: item.name || '',
        aliases: item.aliases || [],
        anchor: { center: item.center, method: 'feature-index-center', area: null },
        center: item.center,
        area: null
      });
    }
  }

  const byName = new Map();
  for (const item of items) {
    for (const key of [item.name, ...(item.aliases || [])].flatMap((name) => nameKeys(name))) {
      if (key && !byName.has(key)) byName.set(key, item);
    }
  }

  const anchorIndex = {
    schemaVersion: 1,
    layerId: layer.id,
    sourceMapId: layer.sourceMapId || null,
    generatedFrom: layer.sourceFile || layer.featureIndexUrl || null,
    generatedFromSourceGeometry,
    url: `/test/metadata/election-anchors-test2/${layer.id}.json`,
    items,
    byName
  };
  writeJson(outputPath, {
    schemaVersion: anchorIndex.schemaVersion,
    layerId: anchorIndex.layerId,
    sourceMapId: anchorIndex.sourceMapId,
    generatedFrom: anchorIndex.generatedFrom,
    generatedFromSourceGeometry: anchorIndex.generatedFromSourceGeometry,
    items
  });
  anchorCache.set(layer.id, anchorIndex);
  return anchorIndex;
}

function hydrateAnchorIndex(layer, persisted) {
  const items = Array.isArray(persisted?.items) ? persisted.items : [];
  const byName = new Map();
  for (const item of items) {
    for (const key of [item.name, ...(item.aliases || [])].flatMap((name) => nameKeys(name))) {
      if (key && !byName.has(key)) byName.set(key, item);
    }
  }
  return {
    schemaVersion: persisted?.schemaVersion || 1,
    layerId: persisted?.layerId || layer.id,
    sourceMapId: persisted?.sourceMapId || layer.sourceMapId || null,
    generatedFrom: persisted?.generatedFrom || layer.sourceFile || layer.featureIndexUrl || null,
    generatedFromSourceGeometry: Boolean(persisted?.generatedFromSourceGeometry),
    url: `/test/metadata/election-anchors-test2/${layer.id}.json`,
    items,
    byName
  };
}

function findAnchorForMatch(anchorIndex, match, result) {
  if (!anchorIndex) return null;
  for (const value of [match?.name, ...(match?.aliases || []), result?.matchName, result?.constituency]) {
    for (const key of nameKeys(value)) {
      const hit = anchorIndex.byName.get(key);
      if (hit?.anchor?.center) return hit.anchor;
    }
  }
  return null;
}

function isSyntheticNonGeographicResult(entry, constituency) {
  const name = normalizeName(constituency);
  if (!name) return false;
  if (entry?.body === 'Northern Ireland Forum for Political Dialogue' && name === 'northern ireland') return true;
  return /\buniversity\b|\buniveristy\b|\btrinity college\b/.test(name);
}

function syntheticNonGeographicMatch(anchorIndex, layer, name, state = { count: 0 }) {
  const bounds = unionAnchorBounds(anchorIndex?.items || []) || layerBounds(layer?.bounds);
  if (!bounds) return null;
  const anchor = northEastSyntheticAnchor(anchorIndex?.items || [], bounds, state.count || 0);
  state.count = (state.count || 0) + 1;
  const center = anchor?.center || boundsCenter(bounds);
  const area = (bounds.east - bounds.west) * (bounds.north - bounds.south);
  const label = syntheticNonGeographicLabel(name);
  return {
    id: `synthetic:non-geographic:${normalizeName(name).replace(/\s+/g, '-')}`,
    name: label,
    aliases: unique([name, label]),
    syntheticRegion: normalizeName(name),
    syntheticNonGeographic: true,
    anchor: {
      center,
      bounds: anchor?.bounds || pointBounds(center) || bounds,
      method: 'synthetic-northeast-non-geographic',
      area: Math.abs(area)
    }
  };
}

function syntheticNonGeographicLabel(name) {
  const normalized = normalizeName(name);
  if (normalized === 'northern ireland') return 'Regional List';
  return fixText(name || '').trim() || 'Non-geographical constituency';
}

function northEastSyntheticAnchor(items = [], unionBounds, index = 0) {
  const bounds = normalizeBounds(unionBounds);
  if (!bounds) return null;
  const width = Math.max(0.01, bounds.east - bounds.west);
  const height = Math.max(0.01, bounds.north - bounds.south);
  const padLng = width * 0.035;
  const padLat = height * 0.04;
  const stepLat = height * 0.055;
  const stepLng = width * 0.02;
  const neFeature = northEastAnchorItem(items, bounds);
  const featureBounds = normalizeBounds(neFeature?.anchor?.bounds || neFeature?.bounds) || bounds;
  const lng = clamp(featureBounds.east - padLng - (index % 2) * stepLng, bounds.west + padLng, bounds.east - padLng);
  const lat = clamp(featureBounds.north - padLat - Math.floor(index / 2) * stepLat, bounds.south + padLat, bounds.north - padLat);
  const center = [round(lng, 6), round(lat, 6)];
  return {
    center,
    bounds: pointBounds(center)
  };
}

function northEastAnchorItem(items = [], bounds) {
  const normalizedBounds = normalizeBounds(bounds);
  if (!normalizedBounds) return null;
  let best = null;
  for (const item of items || []) {
    const itemBounds = normalizeBounds(item?.anchor?.bounds || item?.bounds);
    if (!itemBounds) continue;
    const score = Math.hypot(
      itemBounds.east - normalizedBounds.east,
      itemBounds.north - normalizedBounds.north
    );
    if (!best || score < best.score || (score === best.score && itemBounds.east > best.bounds.east)) {
      best = { item, bounds: itemBounds, score };
    }
  }
  return best?.item || null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function unionAnchorBounds(items = []) {
  let union = null;
  for (const item of items) {
    const bounds = item?.anchor?.bounds || item?.bounds || null;
    union = mergeBounds(union, bounds);
  }
  return union;
}

function layerBounds(bounds) {
  if (!Array.isArray(bounds) || !Array.isArray(bounds[0]) || !Array.isArray(bounds[1])) return null;
  const [[south, west], [north, east]] = bounds;
  return normalizeBounds({ west, south, east, north });
}

function geometryAnchor(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    const bounds = pointBounds(geometry.coordinates);
    return { center: geometry.coordinates, bounds, method: 'point', area: null };
  }
  if (geometry.type === 'MultiPoint' && Array.isArray(geometry.coordinates?.[0])) {
    const bounds = coordinateBounds(geometry.coordinates)?.bounds || pointBounds(geometry.coordinates[0]);
    return { center: geometry.coordinates[0], bounds, method: 'multipoint-first', area: null };
  }
  const rings = [];
  if (geometry.type === 'Polygon') rings.push(geometry.coordinates?.[0]);
  if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates || []) rings.push(polygon?.[0]);
  }
  let best = null;
  for (const ring of rings) {
    const stats = ringStats(ring);
    if (!stats) continue;
    if (!best || stats.area > best.area) best = stats;
  }
  if (best) return { center: best.center, bounds: best.bounds, method: 'largest-ring-bounds-center', area: best.area };
  const bbox = coordinateBounds(flatCoordinates(geometry.coordinates));
  return bbox ? { center: bbox.center, bounds: bbox.bounds, method: 'geometry-bounds-center', area: null } : null;
}

function ringStats(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let area = 0;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [lng1, lat1] = ring[j];
    const [lng2, lat2] = ring[i];
    area += (lng1 + lng2) * (lat1 - lat2);
    minLng = Math.min(minLng, lng2);
    maxLng = Math.max(maxLng, lng2);
    minLat = Math.min(minLat, lat2);
    maxLat = Math.max(maxLat, lat2);
  }
  return {
    area: Math.abs(area) * 0.5,
    center: [round((minLng + maxLng) / 2, 6), round((minLat + maxLat) / 2, 6)],
    bounds: normalizeBounds({ west: minLng, south: minLat, east: maxLng, north: maxLat })
  };
}

function flatCoordinates(value, out = []) {
  if (!Array.isArray(value)) return out;
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    out.push(value);
    return out;
  }
  value.forEach((child) => flatCoordinates(child, out));
  return out;
}

function coordinateBounds(coords) {
  if (!coords.length) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const bounds = normalizeBounds({ west: minLng, south: minLat, east: maxLng, north: maxLat });
  return { center: boundsCenter(bounds), bounds };
}

function pointBounds(point) {
  const lng = Number(point?.[0]);
  const lat = Number(point?.[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return normalizeBounds({ west: lng, south: lat, east: lng, north: lat });
}

function normalizeBounds(bounds) {
  const west = Number(bounds?.west);
  const south = Number(bounds?.south);
  const east = Number(bounds?.east);
  const north = Number(bounds?.north);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  return {
    west: round(Math.min(west, east), 6),
    south: round(Math.min(south, north), 6),
    east: round(Math.max(west, east), 6),
    north: round(Math.max(south, north), 6)
  };
}

function mergeBounds(a, b) {
  const right = normalizeBounds(b);
  if (!right) return a ? normalizeBounds(a) : null;
  const left = normalizeBounds(a);
  if (!left) return right;
  return normalizeBounds({
    west: Math.min(left.west, right.west),
    south: Math.min(left.south, right.south),
    east: Math.max(left.east, right.east),
    north: Math.max(left.north, right.north)
  });
}

function boundsCenter(bounds) {
  const normalized = normalizeBounds(bounds);
  return normalized
    ? [round((normalized.west + normalized.east) / 2, 6), round((normalized.south + normalized.north) / 2, 6)]
    : null;
}

function buildFeatureLookup(index, sourceMapId) {
  const byName = new Map();
  const sourceAliases = SOURCE_NAME_ALIASES.get(sourceMapId) || new Map();
  for (const item of index?.items || []) {
    const explicitAliases = [];
    for (const name of [item.name, ...(item.aliases || [])]) {
      const alias = sourceAliases.get(name);
      if (alias) explicitAliases.push(alias);
    }
    const names = unique([item.name, ...(item.aliases || []), ...explicitAliases]);
    for (const name of names) {
      for (const key of nameKeys(name)) {
        if (!byName.has(key)) byName.set(key, item);
      }
    }
    for (const alias of explicitAliases) {
      for (const key of nameKeys(alias)) {
        byName.set(key, item);
      }
    }
  }
  return byName;
}

function matchFeature(lookup, name, entry = null) {
  for (const key of matchNameKeys(name, entry)) {
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
    normalized.replace(/\bthe\b/g, ''),
    normalized.replace(/\band\b/g, ''),
    normalized.replace(/\bcouncil\b/g, ''),
    normalized.replace(/\bdistrict council\b/g, ''),
    normalized.replace(/\bborough council\b/g, ''),
    normalized.replace(/\bcity council\b/g, ''),
    normalized.replace(/\bcity and district council\b/g, ''),
    normalized.replace(/\bcity and county council\b/g, ''),
    normalized.replace(/\bcounty council\b/g, ''),
    normalized.replace(/\bcounty\b/g, ''),
    normalized.replace(/\bcity\b/g, ''),
    normalized.replace(/\bnorth west\b/g, 'northwest'),
    normalized.replace(/\bsouth west\b/g, 'southwest'),
    normalized.replace(/\bnorth east\b/g, 'northeast'),
    normalized.replace(/\bsouth east\b/g, 'southeast'),
    expandCompassTokens(normalized)
  ].map(compactNameKey).filter(Boolean));
}

function compactNameKey(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function matchNameKeys(value, entry = null) {
  const candidates = candidateMatchNames(value, entry);
  return unique(candidates.flatMap((candidate) => nameKeys(candidate)));
}

function candidateMatchNames(value, entry = null) {
  const raw = fixText(value || '').trim();
  const candidates = new Set([raw]);
  const normalized = normalizeName(raw);
  if (!raw) return [];

  const strippedLocalCode = raw.replace(/^lg\d{2}-[A-Za-z]{3}-/i, '').trim();
  if (strippedLocalCode && strippedLocalCode !== raw) candidates.add(strippedLocalCode);
  if (strippedLocalCode) {
    candidates.add(strippedLocalCode.replace(/\bcorrected\b/ig, '').trim());
    candidates.add(`The ${strippedLocalCode}`);
  }

  const body = entry?.body || '';
  if (entry?.bodyGroup === 'local-government' && body) {
    candidates.add(`${body} ${strippedLocalCode || raw}`);
    const bodyPrefix = new RegExp(`^${escapeRegExp(body)}\\s+`, 'i');
    if (bodyPrefix.test(strippedLocalCode || raw)) candidates.add((strippedLocalCode || raw).replace(bodyPrefix, '').trim());
  }
  const bodyCode = LOCAL_GOVERNMENT_CODE_PREFIXES.get(body);
  const codedArea = raw.match(/^lg\d{2}-([A-Za-z]{3})-Area-([A-Z])$/i);
  if (codedArea && bodyCode && codedArea[1].toLowerCase() === bodyCode.toLowerCase()) {
    candidates.add(`${body} Area ${codedArea[2].toUpperCase()}`);
  }

  const councilArea = raw.match(/^(.+?)\s+Area\s+([A-Z])$/i);
  if (councilArea) {
    candidates.add(`${councilArea[1]} Area ${councilArea[2].toUpperCase()}`);
    if (/^Derry$/i.test(councilArea[1])) candidates.add(`Londonderry Area ${councilArea[2].toUpperCase()}`);
  }

  if (/^derry\b/i.test(raw)) candidates.add(raw.replace(/^Derry\b/i, 'Londonderry'));
  if (/^londonderry\b/i.test(raw)) candidates.add(raw.replace(/^Londonderry\b/i, 'Derry'));
  if (/\bcorrected\b/i.test(raw)) {
    const corrected = raw.replace(/[-\s]*corrected\b/ig, '').trim();
    candidates.add(corrected);
    if (entry?.bodyGroup === 'local-government' && body) candidates.add(`${body} ${corrected}`);
  }
  if (/\bcounty borough\b/.test(normalized)) candidates.add(raw.replace(/\bCounty Borough\b/ig, 'City'));

  return [...candidates].filter(Boolean);
}

function expandCompassTokens(value) {
  const compassMap = {
    n: 'north',
    s: 'south',
    e: 'east',
    w: 'west',
    ne: 'north east',
    nw: 'north west',
    se: 'south east',
    sw: 'south west'
  };
  return normalizeName(value).replace(/\b(ne|nw|se|sw|n|s|e|w)\b/g, (match) => compassMap[match] || match);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function buildDailApprovedCandidateAliasIndex(data) {
  const byElectionDate = new Map();
  for (const alias of Array.isArray(data?.aliases) ? data.aliases : []) {
    const electionDate = alias.electionDate || String(alias.electionId || '').split('__').at(1);
    if (!electionDate) continue;
    if (!byElectionDate.has(electionDate)) byElectionDate.set(electionDate, []);
    byElectionDate.get(electionDate).push({
      ...alias,
      sourceNameKeys: new Set(nameKeys(alias.sourceCandidateName || '')),
      canonicalNameKeys: new Set(nameKeys(alias.canonicalCandidateName || '')),
      constituencyKeys: new Set([
        ...nameKeys(alias.sourceConstituency || ''),
        ...nameKeys(alias.canonicalConstituency || ''),
        ...nameKeys(alias.canonicalConstituencyId || '')
      ].filter(Boolean))
    });
  }
  return byElectionDate;
}

function approvedDailOfficialCandidateFor(entryDate, official, candidate, byCandidateId, byName) {
  const aliases = dailApprovedCandidateAliasIndex.get(entryDate) || [];
  if (!aliases.length) return null;
  const candidateNameKeys = new Set(nameKeys(candidate?.name || candidate?.candidateName || ''));
  const constituencyKeys = new Set([
    ...nameKeys(official?.constituency || ''),
    ...nameKeys(official?.constituencyId || '')
  ].filter(Boolean));
  for (const alias of aliases) {
    if (!setIntersects(alias.constituencyKeys, constituencyKeys)) continue;
    if (!setIntersects(alias.sourceNameKeys, candidateNameKeys) && !setIntersects(alias.canonicalNameKeys, candidateNameKeys)) continue;
    const byId = alias.canonicalCandidateId !== undefined && alias.canonicalCandidateId !== null
      ? byCandidateId.get(String(alias.canonicalCandidateId))
      : null;
    if (byId) return byId;
    for (const key of alias.canonicalNameKeys) {
      const byCanonicalName = byName.get(key);
      if (byCanonicalName) return byCanonicalName;
    }
  }
  return null;
}

function setIntersects(a, b) {
  if (!a?.size || !b?.size) return false;
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

function officialDailRecordFor(entry, rawResult, fallbackConstituency = '') {
  if (entry?.bodySlug !== 'dail-eireann') return null;
  const election = dailOfficialResults?.elections?.[entry.date];
  if (!election?.constituencies) return null;
  const candidates = [
    fallbackConstituency,
    rawResult?.constituency,
    rawResult?.Constituency?.countInfo?.Constituency_Name,
    rawResult?.meta?.Constituency_Name
  ].filter(Boolean);
  const datedAliases = OFFICIAL_DAIL_NAME_ALIASES.get(entry.date) || new Map();
  for (const name of candidates) {
    const aliasKey = datedAliases.get(normalizeName(name));
    if (aliasKey && election.constituencies[aliasKey]) return election.constituencies[aliasKey];
  }
  for (const name of candidates) {
    const direct = election.constituencies[slugify(name)];
    if (direct) return direct;
  }
  const targetKeys = new Set(candidates.flatMap((name) => nameKeys(name)));
  for (const record of Object.values(election.constituencies)) {
    if (nameKeys(record?.constituency).some((key) => targetKeys.has(key))) return record;
  }
  return null;
}

function enrichDailResultWithOfficialData(entry, rawResult, fallbackConstituency = '') {
  if (!rawResult || entry?.bodySlug !== 'dail-eireann') return rawResult;
  const official = officialDailRecordFor(entry, rawResult, fallbackConstituency);
  if (!official) return rawResult;
  const officialDail = compactObject({
    constituencyId: official.constituencyId,
    constituencyNumber: official.constituencyNumber,
    constituencyIrish: official.constituencyIrish,
    sourceFiles: official.sourceFiles || [],
    electorate: official.electorate,
    totalPoll: official.totalPoll,
    spoiled: official.spoiled,
    validPoll: official.validPoll,
    turnoutPct: official.turnoutPct,
    seats: official.seats,
    quota: official.quota,
    countCount: official.countCount,
    candidateCount: official.candidateCount
  });
  const meta = compactObject({
    ...(rawResult.meta || {}),
    Constituency_Number: official.constituencyNumber || rawResult.meta?.Constituency_Number,
    Total_Electorate: official.electorate ?? rawResult.meta?.Total_Electorate,
    Total_Poll: official.totalPoll ?? rawResult.meta?.Total_Poll,
    Spoiled: official.spoiled ?? rawResult.meta?.Spoiled,
    Valid_Poll: official.validPoll ?? rawResult.meta?.Valid_Poll,
    Turnout_Pct: official.turnoutPct ?? rawResult.meta?.Turnout_Pct,
    Number_Of_Seats: official.seats ?? rawResult.meta?.Number_Of_Seats,
    Quota: official.quota ?? rawResult.meta?.Quota
  });
  return {
    ...rawResult,
    meta,
    officialDail,
    constituencyId: official.constituencyId || rawResult.constituencyId || null,
    constituencyNumber: official.constituencyNumber || rawResult.constituencyNumber || null,
    electorate: official.electorate ?? rawResult.electorate ?? null,
    totalPoll: official.totalPoll ?? rawResult.totalPoll ?? null,
    spoiled: official.spoiled ?? rawResult.spoiled ?? null,
    validPoll: official.validPoll ?? rawResult.validPoll ?? null,
    turnoutPct: official.turnoutPct ?? rawResult.turnoutPct ?? null,
    candidates: mergeOfficialDailCandidates(rawResult.candidates || [], official, entry.date)
  };
}

function mergeOfficialDailCandidates(candidates, official, entryDate = null) {
  if (!Array.isArray(candidates) || !official?.candidates) return candidates;
  const byName = new Map();
  const byNameParty = new Map();
  const byCandidateId = new Map();
  const byFirstPref = new Map();
  for (const candidate of Object.values(official.candidates)) {
    if (candidate?.candidateId !== undefined && candidate?.candidateId !== null) byCandidateId.set(String(candidate.candidateId), candidate);
    const nameKey = normalizeName(candidate?.name || '');
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, candidate);
    const namePartyKey = `${nameKey}|${normalizeName(candidate?.party || '')}`;
    if (nameKey && !byNameParty.has(namePartyKey)) byNameParty.set(namePartyKey, candidate);
    const firstPref = parseNumber(candidate?.firstPref);
    if (firstPref !== null) {
      if (!byFirstPref.has(firstPref)) byFirstPref.set(firstPref, []);
      byFirstPref.get(firstPref).push(candidate);
    }
  }
  return candidates.map((candidate) => {
    const nameKey = normalizeName(candidate?.name || candidate?.candidateName || '');
    const partyKey = normalizeName(candidate?.party || candidate?.Party || '');
    const firstPref = parseNumber(candidate?.first_pref ?? candidate?.firstPrefs ?? candidate?.counts?.[0]);
    const officialCandidate = approvedDailOfficialCandidateFor(entryDate, official, candidate, byCandidateId, byName)
      || byNameParty.get(`${nameKey}|${partyKey}`)
      || byName.get(nameKey)
      || ((byFirstPref.get(firstPref) || []).length === 1 ? byFirstPref.get(firstPref)[0] : null);
    if (!officialCandidate) return candidate;
    return compactObject({
      ...candidate,
      gender: candidate.gender || officialCandidate.gender,
      dailAbbreviation: candidate.dailAbbreviation || officialCandidate.dailAbbreviation,
      partyAbbreviation: candidate.partyAbbreviation || officialCandidate.dailAbbreviation,
      officialCandidateId: candidate.officialCandidateId || officialCandidate.candidateId,
      officialStatus: candidate.officialStatus || officialCandidate.officialStatus,
      party: candidate.party || officialCandidate.party
    });
  });
}

function enrichDailResultWithWikipediaCounts(entry, resultPath, rawResult, fallbackConstituency = '') {
  if (!rawResult || entry?.bodySlug !== 'dail-eireann' || !resultPath) return rawResult;
  const sidecarPath = path.join(DAIL_WIKIPEDIA_COUNTS_ROOT, entry.date, path.basename(resultPath));
  if (!existsSync(sidecarPath)) return rawResult;
  const sidecar = readJson(sidecarPath);
  if (!Array.isArray(sidecar?.candidates) || !sidecar.candidates.length || Number(sidecar.numCounts || 0) < 2) return rawResult;
  return buildDailWikipediaCountPayload(rawResult, sidecar, fallbackConstituency);
}

function buildDailWikipediaCountPayload(rawResult, sidecar, fallbackConstituency = '') {
  const localCandidates = new Map();
  const localCandidatesByFirstPref = new Map();
  for (const candidate of rawResult?.candidates || []) {
    localCandidates.set(normalizeName(candidate?.name || ''), candidate);
    const firstPref = parseNumber(candidate?.first_pref ?? candidate?.counts?.[0]);
    if (firstPref !== null) {
      if (!localCandidatesByFirstPref.has(firstPref)) localCandidatesByFirstPref.set(firstPref, []);
      localCandidatesByFirstPref.get(firstPref).push(candidate);
    }
  }
  const numCounts = Number(sidecar.numCounts || 0) || Math.max(1, ...sidecar.candidates.flatMap((candidate) => candidate.counts?.map((value, index) => value !== null && value !== undefined ? index + 1 : 0) || []));
  const countGroup = sidecar.candidates.flatMap((candidate, index) => {
    const localCandidate = localCandidateForWikipediaCount(candidate, localCandidates, localCandidatesByFirstPref);
    const party = canonicalDailWikipediaParty(candidate.party, localCandidate);
    const name = fixText(localCandidate?.name || candidate.name || '').trim();
    const nameParts = candidateNameParts(name);
    const firstPref = parseNumber(candidate.counts?.[0]) ?? parseNumber(localCandidate?.first_pref) ?? parseNumber(localCandidate?.counts?.[0]) ?? 0;
    const occurrenceCount = candidate.electedAt || candidate.lastCount || '';
    const rows = [];
    let previousTotal = null;
    for (let countIndex = 0; countIndex < numCounts; countIndex += 1) {
      const countNumber = countIndex + 1;
      const total = parseNumber(candidate.counts?.[countIndex]);
      if (total === null) continue;
      const transfers = countNumber === 1 || previousTotal === null ? 0 : total - previousTotal;
      previousTotal = total;
      rows.push({
        Candidate_Id: String(candidate.id || index + 1),
        Candidate_First_Pref_Votes: String(firstPref),
        Constituency_Number: String(rawResult?.officialDail?.constituencyNumber || rawResult?.constituencyNumber || ''),
        Count_Number: String(countNumber),
        Dail_Abbreviation: localCandidate?.dailAbbreviation || localCandidate?.partyAbbreviation || '',
        Firstname: nameParts.firstname,
        Gender: localCandidate?.gender || '',
        Official_Candidate_Id: localCandidate?.officialCandidateId || '',
        Official_Status: localCandidate?.officialStatus || '',
        Party_Abbreviation: localCandidate?.partyAbbreviation || localCandidate?.dailAbbreviation || '',
        Surname: nameParts.surname,
        Occurred_On_Count: String(occurrenceCount),
        Party_Colour: partyColour(party),
        Party_Name: party,
        Status: dailWikipediaCountStatus(candidate, localCandidate, countNumber, numCounts),
        Total_Votes: String(total),
        Transfers: String(transfers),
        Wikipedia_Count_Row: '1',
        Wikipedia_Count_Source: sidecar.pageUrl || '',
        candidateName: name,
        id: index
      });
    }
    return rows;
  });
  if (!countGroup.length) return rawResult;
  const meta = {
    ...(rawResult?.meta || {}),
    ...(sidecar?.meta || {}),
    ...(sidecar?.metadata || {})
  };
  const parseMetaNumber = (...values) => {
    for (const value of values) {
      const parsed = parseNumber(value);
      if (parsed !== null) return parsed;
    }
    return null;
  };
  const validPoll = parseNumber(meta.Valid_Poll ?? meta.valid_poll ?? meta.validPoll)
    || countGroup
      .filter((row) => Number(row.Count_Number) === 1)
      .reduce((sum, row) => sum + numberOrZero(row.Total_Votes), 0);
  const sourceTurnoutPct = parseMetaNumber(meta.Turnout_Pct, meta.turnoutPct, meta.turnout_pct, meta.turnout);
  const totalPoll = parseMetaNumber(meta.Total_Poll, meta.total_poll, meta.totalPoll, meta.poll, meta.total_votes);
  const spoiled = parseMetaNumber(meta.Spoiled, meta.spoiled, meta.Spoilt, meta.spoilt, meta.invalid_votes);
  const electorate = parseMetaNumber(meta.Total_Electorate, meta.total_electorate, meta.electorate, meta.electorate_total);
  const inferredTotalPoll = totalPoll !== null
    ? totalPoll
    : (electorate !== null && sourceTurnoutPct !== null ? Math.round(electorate * sourceTurnoutPct / 100) : null);
  const inferredSpoiled = spoiled !== null
    ? spoiled
    : (inferredTotalPoll !== null && validPoll !== null && inferredTotalPoll >= validPoll ? inferredTotalPoll - validPoll : null);
  const turnoutPct = sourceTurnoutPct !== null
    ? sourceTurnoutPct
    : (inferredTotalPoll !== null && electorate !== null && electorate > 0 ? inferredTotalPoll / electorate * 100 : null);
  const electedCount = sidecar.candidates.filter((candidate) => Number(candidate.electedAt || 0) > 0).length;
  const seatCount = parseNumber(rawResult?.seats ?? meta.Number_Of_Seats ?? meta.seats) || electedCount;
  return {
    ...rawResult,
    validPoll: validPoll || rawResult?.validPoll || null,
    totalPoll: inferredTotalPoll ?? rawResult?.totalPoll ?? null,
    spoiled: inferredSpoiled ?? rawResult?.spoiled ?? null,
    electorate: electorate ?? rawResult?.electorate ?? null,
    turnoutPct: turnoutPct ?? rawResult?.turnoutPct ?? null,
    Constituency: {
      __wikipediaCountGroup: true,
      countInfo: {
        Constituency_Name: rawResult?.constituency || sidecar.constituency || fallbackConstituency || '',
        Constituency_Number: String(rawResult?.officialDail?.constituencyNumber || rawResult?.constituencyNumber || meta.Constituency_Number || ''),
        Number_Of_Seats: seatCount ? String(seatCount) : '',
        Quota: meta.Quota != null || meta.quota != null ? String(meta.Quota ?? meta.quota) : '',
        Spoiled: inferredSpoiled != null ? String(inferredSpoiled) : '',
        Total_Electorate: electorate != null ? String(electorate) : '',
        Total_Poll: inferredTotalPoll != null ? String(inferredTotalPoll) : '',
        Turnout_Pct: turnoutPct != null ? String(turnoutPct) : '',
        Valid_Poll: validPoll ? String(validPoll) : ''
      },
      countGroup
    },
    officialDail: rawResult?.officialDail || null,
    constituencyId: rawResult?.constituencyId || rawResult?.officialDail?.constituencyId || null,
    constituencyNumber: rawResult?.constituencyNumber || rawResult?.officialDail?.constituencyNumber || null,
    wikipediaCountSource: {
      pageTitle: sidecar.pageTitle || '',
      pageUrl: sidecar.pageUrl || '',
      sectionTitle: sidecar.sectionTitle || '',
      importedAt: sidecar.importedAt || ''
    }
  };
}

function localCandidateForWikipediaCount(candidate, localCandidates, localCandidatesByFirstPref) {
  const direct = localCandidates.get(normalizeName(candidate.name || ''));
  if (direct) return direct;
  const firstPref = parseNumber(candidate.counts?.[0]);
  const byVote = firstPref !== null ? localCandidatesByFirstPref.get(firstPref) || [] : [];
  if (byVote.length === 1) return byVote[0];
  const party = normalizeName(candidate.party || '');
  return byVote.find((localCandidate) => {
    const localParty = normalizeName(localCandidate?.party || '');
    return localParty && (party.includes(localParty) || localParty.includes(party));
  }) || null;
}

function canonicalDailWikipediaParty(wikipediaParty, localCandidate = null) {
  const localParty = normalizeParty(String(localCandidate?.party || '').replace(/\s*Lozenge\s*$/i, '').trim());
  if (localParty && !/ceann comhairle/i.test(localParty)) return localParty;
  const normalized = normalizeName(wikipediaParty);
  if (!normalized || /\bindependent politician\b/.test(normalized)) return 'Independent';
  if (/\blabour party ireland\b/.test(normalized)) return 'Irish Labour';
  if (/\bpeople before profit\b/.test(normalized)) return 'PBP';
  if (normalized === 'social democrats ireland') return 'Social Democrats';
  if (normalized === 'workers party ireland') return "Workers' Party";
  if (normalized === 'the irish people party') return 'The Irish People';
  if (normalized === 'irish freedom party') return 'Irish Freedom Party';
  if (normalized === 'national party ireland') return 'National Party';
  return normalizeParty(wikipediaParty || 'Independent') || 'Independent';
}

function dailWikipediaCountStatus(candidate, localCandidate, countNumber, numCounts) {
  if (Number(candidate.electedAt || 0) === countNumber) {
    const localStatus = fixText(localCandidate?.status || '');
    return localStatus || 'Elected';
  }
  if (!candidate.electedAt && Number(candidate.lastCount || 0) === countNumber && countNumber < numCounts) return 'Excluded';
  if (!candidate.electedAt && Number(candidate.lastCount || 0) === countNumber && countNumber >= numCounts) return 'Not Elected';
  return '';
}

function candidateNameParts(name) {
  const clean = fixText(name || '').trim();
  const space = clean.indexOf(' ');
  return {
    firstname: space > 0 ? clean.slice(0, space) : clean,
    surname: space > 0 ? clean.slice(space + 1) : ''
  };
}

function sourceByYear(year, rows) {
  for (const [fromYear, sourceMapId] of rows) {
    if (year >= fromYear) return { sourceMapId };
  }
  return { sourceMapId: null };
}

function formatElectionSubtitle(entry, results, unmatchedCount) {
  const total = results.length || entry.constituencies.length;
  const prefix = entry.bodyGroup === 'local-government'
    ? (entry.bodies?.length > 1 ? `${total} DEAs` : entry.body)
    : `${total} constituencies`;
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

function buildUnmatchedDetails(bundle) {
  return (bundle.unmatchedConstituencies || []).map((constituency) => ({
    constituency,
    ...classifyUnmatchedConstituency(bundle, constituency)
  }));
}

function summarizeResiduals(details) {
  const counts = {};
  for (const detail of details || []) {
    counts[detail.code || 'unclassified-needs-review'] = (counts[detail.code || 'unclassified-needs-review'] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function summarizeClosure(details) {
  const byStatus = {};
  const feasibleNow = [];
  for (const detail of details || []) {
    const status = detail.parityStatus || 'unclassified-needs-review';
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (!/^blocked-on-/.test(status)) feasibleNow.push(detail);
  }
  return {
    byStatus: Object.fromEntries(Object.entries(byStatus).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    feasibleUnmatchedRemaining: feasibleNow.length,
    feasibleExamples: feasibleNow.slice(0, 20)
  };
}

function classifyUnmatchedConstituency(bundle, constituency) {
  const name = normalizeName(constituency);
  const sourceMapId = bundle.sourceMapId || null;
  const body = bundle.body || '';

  if (!sourceMapId) {
    return {
      code: 'main-geography-unsourced',
      parityStatus: 'blocked-on-data',
      reason: 'The main-site geography rules do not identify a sourced boundary file for this election date/body, so /test2 cannot produce faithful MapLibre geometry yet.'
    };
  }

  if (/\buniversity\b|\buniveristy\b|\btrinity college\b/.test(name)) {
    return {
      code: 'university-seat-no-polygon',
      parityStatus: 'blocked-on-data',
      reason: 'The selected main-site geography source does not contain a polygon for this university seat.'
    };
  }

  if (body === 'Northern Ireland Forum for Political Dialogue' && name === 'northern ireland') {
    return {
      code: 'regional-list-seat-no-layer',
      parityStatus: 'blocked-on-implementation',
      reason: 'The main-site geography uses Westminster constituencies for the territorial Forum seats; the separate NI-wide top-up/list result needs a synthetic or secondary region layer.'
    };
  }

  if (body === 'Parliament of Northern Ireland') {
    return {
      code: 'stormont-seat-not-in-source',
      parityStatus: 'blocked-on-data',
      reason: 'This historical Stormont result name is absent from the selected Stormont boundary source; it is not safe to alias it to a different constituency.'
    };
  }

  if (body === 'House of Commons of the United Kingdom' && sourceMapId === 'pc-1920') {
    return {
      code: 'westminster-seat-not-in-source',
      parityStatus: 'blocked-on-data',
      reason: 'This result name is absent from the selected Westminster boundary source; it is not safe to alias it to a different constituency.'
    };
  }

  if (body === 'Referendum (Ireland)' && (sourceMapId?.startsWith('dail-') || sourceMapId === 'roi-counties-2011')) {
    return {
      code: 'referendum-boundary-split-merge',
      parityStatus: 'blocked-on-aggregation',
      reason: 'The result row is reported on a constituency scheme that is split from, merged into, or otherwise different from the selected referendum display boundary layer. This needs aggregation/splitting logic or a more exact boundary source, not a one-to-one alias.'
    };
  }

  if (body === 'D\u00e1il \u00c9ireann' && sourceMapId === 'dail-2023' && /wexford3/.test(name)) {
    return {
      code: 'source-result-name-error',
      parityStatus: 'blocked-on-data-cleanup',
      reason: 'The result constituency name appears to contain a source-data typo and should be cleaned upstream before map matching.'
    };
  }

  if (bundle.bodyGroup === 'local-government' && sourceMapId?.startsWith('deas-')) {
    return {
      code: 'historic-dea-not-in-source',
      parityStatus: 'blocked-on-data',
      reason: 'This local-government DEA result name is absent from the selected DEA boundary source; it is not safe to alias it without a documented one-to-one boundary equivalence.'
    };
  }

  if (sourceMapId === 'pc-1918-ireland') {
    return {
      code: 'historic-seat-not-in-source',
      parityStatus: 'blocked-on-data',
      reason: 'This 1918 result name is absent from the selected all-Ireland Westminster boundary source.'
    };
  }

  return {
    code: 'unclassified-needs-review',
    parityStatus: 'needs-review',
    reason: 'No safe deterministic mapping has been identified yet.'
  };
}

function normalizeName(value) {
  return fixText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[''`]/g, '')
    .replace(/[\u2010-\u2015-_/.,()]/g, ' ')
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

function compactObject(object) {
  const output = {};
  for (const [key, value] of Object.entries(object || {})) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    output[key] = value;
  }
  return output;
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
  return writeStableGeneratedJson(file, data);
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
