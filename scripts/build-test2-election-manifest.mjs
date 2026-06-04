#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import * as ElectionDomain from '../js/election-domain.mjs';
import { canonicalElectionTitle, isElectionByElectionScope } from '../js/election-names.mjs';

const ROOT = process.cwd();
const ELECTION_ROOT = path.join(ROOT, 'election-viewer-package', 'data', 'elections');
const ELECTION_INDEX = path.join(ROOT, 'election-viewer-package', 'data', 'elections_index.json');
const MAP_METADATA = path.join(ROOT, 'test', 'metadata', 'maps-test.json');
const FEATURE_INDEX_DIR = path.join(ROOT, 'test', 'metadata', 'feature-indexes');
const OUT_DIR = path.join(ROOT, 'test', 'metadata', 'elections-test2');
const OUT_ANCHOR_DIR = path.join(ROOT, 'test', 'metadata', 'election-anchors-test2');
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
  ['carlow kilkenny', 'carlow-kilkenny'],
  ['wicklow wexford3', 'wicklow wexford'],
  ['ireland', 'republic of ireland'],
  ['derry area a', 'londonderry area a'],
  ['derry area b', 'londonderry area b'],
  ['derry area c', 'londonderry area c'],
  ['derry area d', 'londonderry area d']
]);

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
  rmSync(OUT_ANCHOR_DIR, { recursive: true, force: true });
  mkdirSync(OUT_ANCHOR_DIR, { recursive: true });

  const manifestEntries = [];
  const reportEntries = [];
  let totalMatched = 0;
  let totalUnmatched = 0;

  for (const entry of entries) {
    const geography = resolveElectionGeography(entry);
    const layer = geography?.sourceMapId ? layerBySource.get(geography.sourceMapId) : null;
    const featureIndex = layer ? featureIndexes.get(layer.id) || featureIndexes.get(layer.sourceMapId) : null;
    const bundle = await buildElectionBundle(entry, geography, layer, featureIndex, previousKeyByKey.get(electionKey(entry)) || null);
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
      localBodies: bundle.localBodies,
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
    elections: manifestEntries.sort(compareElectionEntries)
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

function buildPreviousElectionKeyLookup(entries) {
  const byBody = new Map();
  for (const entry of entries) {
    if (!byBody.has(entry.body)) byBody.set(entry.body, []);
    byBody.get(entry.body).push(entry);
  }
  const previousByKey = new Map();
  for (const bodyEntries of byBody.values()) {
    bodyEntries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (let i = 1; i < bodyEntries.length; i += 1) {
      previousByKey.set(electionKey(bodyEntries[i]), electionKey(bodyEntries[i - 1]));
    }
  }
  return previousByKey;
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
  if (body === 'President of Ireland') return { sourceMapId: 'roi-1938', singleConstituency: true };
  if (body === 'Referendum (Ireland)') {
    if (isNationalAggregateElection(entry)) return { sourceMapId: 'roi-1938', singleConstituency: true };
    if (looksLikeRoiLocalAuthorityResults(entry)) {
      if (year >= 2019) return { sourceMapId: 'roi-local-authorities-2024' };
      if (year >= 2002) return { sourceMapId: 'roi-local-authorities-2002' };
      if (year >= 1992) return { sourceMapId: 'roi-local-authorities-1994' };
    }
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
      [2004, 'mep-2004'],
      [-Infinity, 'mep-1979']
    ]);
  }
  return { sourceMapId: null };
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

async function buildElectionBundle(entry, geography, layer, featureIndex, previousKey = null) {
  const key = electionKey(entry);
  const featureLookup = buildFeatureLookup(featureIndex, geography?.sourceMapId);
  const dateDir = path.join(ELECTION_ROOT, entry.bodySlug, entry.date);
  const dirExists = existsSync(dateDir);
  const singleFeature = geography?.singleConstituency ? firstFeature(featureIndex) : null;
  const anchorIndex = layer ? await loadOrBuildAnchorIndex(layer, featureIndex) : null;
  const results = [];
  const rawEntries = [];
  const unmatched = [];

  for (const constituency of entry.constituencies || []) {
    const resultPath = findResultFile(dateDir, constituency);
    const rawResult = resultPath ? readJson(resultPath) : null;
    if (rawResult) rawEntries.push({ constituency, raw: rawResult });
    const result = ElectionDomain.summarizeResult(rawResult, constituency);
    const matchEntry = matchEntryForConstituency(entry, result.constituency || constituency);
    const match = singleFeature || matchFeature(featureLookup, result.constituency || constituency, matchEntry);
    const syntheticRegion = !match && isForumRegionalListResult(entry, result.constituency || constituency)
      ? syntheticRegionMatch(anchorIndex, layer, 'Northern Ireland')
      : null;
    if (!match && !syntheticRegion && !geography?.singleConstituency) unmatched.push(result.constituency || constituency);
    results.push({
      ...result,
      localBody: entry.bodyGroup === 'local-government' ? matchEntry.body : null,
      sourceFile: resultPath ? slash(path.relative(ROOT, resultPath)) : null,
      featureId: match?.id ?? syntheticRegion?.id ?? null,
      featureName: match?.name ?? syntheticRegion?.name ?? null,
      featureAliases: match?.aliases || syntheticRegion?.aliases || [],
      matchName: match?.name ?? syntheticRegion?.name ?? null,
      anchor: syntheticRegion?.anchor || (anchorIndex ? findAnchorForMatch(anchorIndex, match, result) : null),
      syntheticRegion: syntheticRegion?.syntheticRegion || null,
      matched: Boolean(match || syntheticRegion)
    });
  }

  if (entry.constituencies.length === 0 && dirExists) {
    for (const file of readdirSync(dateDir).filter((name) => name.endsWith('.json') && name !== '_index.json')) {
      const resultPath = path.join(dateDir, file);
      const rawResult = readJson(resultPath);
      rawEntries.push({ constituency: file.replace(/\.json$/, ''), raw: rawResult });
      const result = ElectionDomain.summarizeResult(rawResult, file.replace(/\.json$/, ''));
      const matchEntry = matchEntryForConstituency(entry, result.constituency);
      const match = singleFeature || matchFeature(featureLookup, result.constituency, matchEntry);
      const syntheticRegion = !match && isForumRegionalListResult(entry, result.constituency)
        ? syntheticRegionMatch(anchorIndex, layer, 'Northern Ireland')
        : null;
      if (!match && !syntheticRegion && !geography?.singleConstituency) unmatched.push(result.constituency);
      results.push({
        ...result,
        localBody: entry.bodyGroup === 'local-government' ? matchEntry.body : null,
        sourceFile: slash(path.relative(ROOT, resultPath)),
        featureId: match?.id ?? syntheticRegion?.id ?? null,
        featureName: match?.name ?? syntheticRegion?.name ?? null,
        featureAliases: match?.aliases || syntheticRegion?.aliases || [],
        matchName: match?.name ?? syntheticRegion?.name ?? null,
        anchor: syntheticRegion?.anchor || (anchorIndex ? findAnchorForMatch(anchorIndex, match, result) : null),
        syntheticRegion: syntheticRegion?.syntheticRegion || null,
        matched: Boolean(match || syntheticRegion)
      });
    }
  }

  const matchedCount = results.filter((result) => result.matched).length;
  const unmatchedCount = results.length - matchedCount;
  const availableStyleModes = STYLE_MODES.filter((mode) => modeAvailable(mode, results));
  const year = Number(String(entry.date).slice(0, 4));
  const previousDate = previousKey ? previousKey.split('__').pop()?.replace(/-/g, '-') : null;
  const partySummary = ElectionDomain.buildPartySummary(results);
  const mainLikePartySummary = ElectionDomain.buildMainLikePartySummaryFromRawResults(rawEntries);
  const mainLikeCandidateSummary = ElectionDomain.buildMainLikeCandidateSummaryFromRawResults(rawEntries);
  const entityIndex = ElectionDomain.buildEntityIndex(results);
  return {
    schemaVersion: 1,
    key,
    body: entry.body,
    bodySlug: entry.bodySlug,
    bodyGroup: entry.bodyGroup,
    displayTitle: entry.displayTitle || canonicalElectionTitle(entry),
    localBodies: entry.bodies || null,
    localBodyByConstituency: entry.localBodyByConstituency || null,
    date: entry.date,
    year,
    sourceMapId: geography?.sourceMapId || null,
    layerId: layer?.id || null,
    labelProperty: layer?.labelProperty || null,
    geometryType: layer?.geometryType || null,
    anchorUrl: anchorIndex?.url || null,
    previousKey,
    previousDate,
    loadable: Boolean(layer && geography?.sourceMapId && results.length > 0 && matchedCount > 0),
    displaySubtitle: formatElectionSubtitle(entry, results, unmatchedCount),
    displayProvider: entry.displayProvider || (entry.bodyGroup === 'local-government' ? `Local government: ${entry.body}` : entry.body),
    constituencies: entry.constituencies,
    isByElection: isElectionByElectionScope(entry),
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

const anchorCache = new Map();

async function loadOrBuildAnchorIndex(layer, featureIndex) {
  if (!layer?.id) return null;
  if (anchorCache.has(layer.id)) return anchorCache.get(layer.id);
  const outputPath = path.join(OUT_ANCHOR_DIR, `${layer.id}.json`);
  const sourceFile = layer.sourceFile ? path.join(ROOT, layer.sourceFile) : null;
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

function isForumRegionalListResult(entry, constituency) {
  return entry?.body === 'Northern Ireland Forum for Political Dialogue'
    && normalizeName(constituency) === 'northern ireland';
}

function syntheticRegionMatch(anchorIndex, layer, name) {
  const bounds = unionAnchorBounds(anchorIndex?.items || []) || layerBounds(layer?.bounds);
  if (!bounds) return null;
  const center = boundsCenter(bounds);
  const area = (bounds.east - bounds.west) * (bounds.north - bounds.south);
  return {
    id: `synthetic:${normalizeName(name).replace(/\s+/g, '-')}`,
    name,
    aliases: [name],
    syntheticRegion: normalizeName(name),
    anchor: {
      center,
      bounds,
      method: 'synthetic-region-bounds-center',
      area: Math.abs(area)
    }
  };
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

  if (body === 'Referendum (Ireland)' && sourceMapId?.startsWith('dail-')) {
    return {
      code: 'referendum-boundary-split-merge',
      parityStatus: 'blocked-on-aggregation',
      reason: 'The result row is reported on a constituency scheme that is split from, merged into, or otherwise different from the main-site selected Dail boundary layer. This needs aggregation/splitting logic or a more exact boundary source, not a one-to-one alias.'
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
