#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'data', 'browse');
const DETAILS_DIR = path.join(OUT_DIR, 'details');

const GENERATED_AT = new Date().toISOString();
const SAMPLE_RELATED_LIMIT = 40;
const FEATURE_SAMPLE_LIMIT = 600;
const PERSON_RELATED_LIMIT = 80;
const PARTY_RELATED_LIMIT = 120;

const ENTITY_GROUPS = [
  { id: 'maps', label: 'Maps', description: 'Catalogue map entries, metadata, downloads, source credits, and interactive-map links.' },
  { id: 'elections', label: 'Elections', description: 'Election entries by election, with links to open the corresponding election layer.' },
  { id: 'features', label: 'Features', description: 'Boundary features by source map, including election geography groups where available.' },
  { id: 'parties', label: 'Parties / Labels', description: 'Party and ticket labels observed in election data.' },
  { id: 'persons', label: 'Persons', description: 'Candidate and elected-person entries observed in election bundles.' },
  { id: 'sources', label: 'Books / Tables / Sources', description: 'Books, tables, datasets, map downloads, source files, and references.' }
];

main();

function main() {
  mkdirSync(DETAILS_DIR, { recursive: true });

  const mapsData = readJson('data/database/maps.json', { categories: [], maps: [] });
  const dataEntriesData = readJson('data/database/data-entries.json', { dataEntries: [] });
  const booksData = readJson('data/database/books.json', { categories: [], books: [] });
  const spatialIndex = readJson('data/database/spatial-index.json', { maps: [], features: [] });
  const partyIds = readJson('election-viewer-package/data/party-ids.json', { party_ids: [], aliases: {} });
  const electionManifest = readJson('test/metadata/elections-test2.json', { elections: [], totals: {} });

  const categoriesById = new Map((mapsData.categories || []).map((category) => [category.id, category]));
  const mapClassInfoById = buildMapClassInfo(mapsData);
  const maps = buildMaps(mapsData, dataEntriesData, categoriesById, mapClassInfoById);
  const elections = buildElections(electionManifest);
  const electionDetails = readElectionDetails(elections);
  const featureGroups = buildFeatureGroups(spatialIndex, maps, elections);
  const { parties, partyDetails } = buildParties(partyIds, electionDetails);
  const { persons, personDetails } = buildPersons(electionDetails);
  const sources = buildSources(booksData, dataEntriesData, maps, elections);
  ensureUniqueSlugs(maps);
  ensureUniqueSlugs(elections);
  ensureUniqueSlugs(featureGroups);
  ensureUniqueSlugs(parties);
  ensureUniqueSlugs(persons);
  ensureUniqueSlugs(sources);

  writeJson('maps.json', { schemaVersion: 1, generatedAt: GENERATED_AT, total: maps.length, items: maps });
  writeJson('elections.json', { schemaVersion: 1, generatedAt: GENERATED_AT, total: elections.length, items: elections });
  writeJson('features.json', {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    totalFeatureRecords: spatialIndex.features?.length || 0,
    totalFeatureGroups: featureGroups.length,
    featureSampleLimit: FEATURE_SAMPLE_LIMIT,
    items: featureGroups
  });
  writeJson('parties.json', { schemaVersion: 1, generatedAt: GENERATED_AT, total: parties.length, items: parties });
  writeJson('persons.json', { schemaVersion: 1, generatedAt: GENERATED_AT, total: persons.length, items: persons });
  writeJson('sources.json', { schemaVersion: 1, generatedAt: GENERATED_AT, total: sources.length, items: sources });

  writeDetailFiles('maps', maps);
  writeDetailFiles('elections', elections);
  writeDetailFiles('parties', Object.values(partyDetails));
  writeDetailFiles('sources', sources);

  writeJson('index.json', {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    groups: ENTITY_GROUPS,
    counts: {
      maps: maps.length,
      elections: elections.length,
      featureGroups: featureGroups.length,
      featureRecords: spatialIndex.features?.length || 0,
      parties: parties.length,
      persons: persons.length,
      sources: sources.length
    },
    entrypoints: {
      maps: '/data/browse/maps.json',
      elections: '/data/browse/elections.json',
      features: '/data/browse/features.json',
      parties: '/data/browse/parties.json',
      persons: '/data/browse/persons.json',
      sources: '/data/browse/sources.json'
    },
    notes: [
      'Browse is generated from static repository data.',
      'Feature records are grouped by map and loaded lazily from existing spatial-index sidecars to avoid creating thousands of static files.',
      'Open in interactive map and Open election layer links target the main site route with hash state.'
    ]
  });

  console.log(`Browse indexes written to ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`- maps: ${maps.length}`);
  console.log(`- elections: ${elections.length}`);
  console.log(`- feature groups: ${featureGroups.length} (${spatialIndex.features?.length || 0} feature records)`);
  console.log(`- parties: ${parties.length}`);
  console.log(`- persons: ${persons.length}`);
  console.log(`- sources: ${sources.length}`);
}

function buildMaps(mapsData, dataEntriesData, categoriesById, mapClassInfoById) {
  const mapRecords = (mapsData.maps || []).map((map) => {
    const category = categoriesById.get(map.category) || {};
    const files = normalizeFiles(map.files || map.file || map.sourceFile || map.data || null);
    const references = normalizeReferences(map.references || map.sourceReferences || map.sources);
    const downloads = normalizeLinks(map.downloads || map.sourceDownload || map.sourceDownloads || map.download || files);
    const rawTitle = cleanText(map.name || map.title || map.id);
    const title = mapDisplayTitle(map, mapClassInfoById.get(map.id), rawTitle);
    return compactObject({
      id: map.id,
      slug: map.slug || slugify(map.id || title),
      type: 'map',
      title,
      subtitle: compactJoin([formatDateRange(map), geographyLabel(map)]),
      categoryId: map.category || null,
      category: category.name || map.category || null,
      group: category.group || map.group || null,
      description: cleanText(map.description || category.description || ''),
      date: map.date || map.year || map.dateAdded || null,
      years: collectYears(map),
      provider: normalizeArray(map.provider || map.providers),
      credits: normalizeArray(map.credits || map.credit || map.sourceCredit),
      keywords: normalizeArray(map.keywords),
      status: map.hidden ? 'hidden' : map.placeholder ? 'not yet converted' : 'available',
      featured: Boolean(map.featured),
      loadable: Boolean(map.files || map.file || map.url || map.source || map.tiles || map.pmtiles || map.geojson),
      labelProperty: map.labelProperty || null,
      parentCard: mapClassInfoById.get(map.id)?.className || null,
      variants: normalizeArray(map.variants).map((variant) => typeof variant === 'string' ? { id: variant } : compactObject({
        id: variant.id || variant.mapId || variant.slug || variant.name,
        title: mapDisplayTitle(
          { ...map, ...variant, id: variant.id || variant.mapId || variant.slug || variant.name, name: variant.name || variant.title || variant.label || variant.id || variant.mapId },
          mapClassInfoById.get(variant.id || variant.mapId || variant.slug || variant.name),
          variant.name || variant.title || variant.label || variant.id || variant.mapId
        ),
        date: variant.date || variant.year || null
      })),
      sourceFiles: files,
      references,
      downloads,
      interactiveUrl: interactiveLayerUrl(map.id),
      browseUrl: `/browse/maps/${encodeURIComponent(map.id)}`
    });
  }).filter((map) => map.id);

  const dataEntries = normalizeArray(dataEntriesData.dataEntries || dataEntriesData.entries).map((entry) => {
    const id = entry.id || entry.slug || slugify(entry.name || entry.title);
    return compactObject({
      id,
      slug: slugify(id),
      type: 'data-entry',
      title: cleanText(entry.name || entry.title || id),
      subtitle: compactJoin([entry.year, entry.region, entry.geography]),
      categoryId: entry.category || 'data-entry',
      category: entry.categoryName || entry.category || 'Tables and data',
      group: entry.group || 'Tables and data',
      description: cleanText(entry.description || ''),
      date: entry.date || entry.year || null,
      years: collectYears(entry),
      provider: normalizeArray(entry.provider || entry.providers),
      credits: normalizeArray(entry.credits || entry.credit),
      keywords: normalizeArray(entry.keywords),
      status: entry.hidden ? 'hidden' : 'available',
      loadable: Boolean(entry.mapId || entry.layerId || entry.sourceMapId),
      sourceFiles: normalizeFiles(entry.files || entry.file || entry.sourceFile),
      references: normalizeReferences(entry.references || entry.sources),
      downloads: normalizeLinks(entry.downloads || entry.download || entry.sourceDownload),
      interactiveUrl: interactiveLayerUrl(entry.layerId || entry.mapId || entry.sourceMapId || id),
      browseUrl: `/browse/maps/${encodeURIComponent(id)}`
    });
  }).filter((entry) => entry.id);

  return [...mapRecords, ...dataEntries].sort(sortByTitle);
}

function buildMapClassInfo(mapsData) {
  const infoById = new Map();
  const mapsById = new Map((mapsData.maps || []).map((map) => [map.id, map]));

  for (const cls of mapsData.classes || []) {
    for (const mapId of cls.maps || []) {
      if (!infoById.has(mapId)) {
        infoById.set(mapId, {
          classId: cls.id,
          className: cls.name,
          scope: cls.scope || null
        });
      }
    }
  }

  for (const map of mapsData.maps || []) {
    for (const variant of map.variants || []) {
      const variantId = variant?.id || variant?.mapId || variant?.slug || variant?.name;
      if (!variantId || infoById.has(variantId)) continue;
      const parent = mapsById.get(map.id) || map;
      infoById.set(variantId, {
        classId: parent.id,
        className: parent.name || parent.title || parent.id,
        scope: parent.scope || null,
        parentId: parent.id
      });
    }
  }

  return infoById;
}

function mapDisplayTitle(map, classInfo, fallbackTitle = '') {
  const title = cleanText(fallbackTitle || map?.name || map?.title || map?.label || map?.id);
  if (!title) return title;
  const parentTitle = cleanText(classInfo?.className || map?.parentName || '');
  const derivedName = derivedMapNamePart(map, title, parentTitle);
  if (!parentTitle || !derivedName) return title;
  return `${parentTitle} - ${derivedName}`;
}

function derivedMapNamePart(map, title, parentTitle = '') {
  const text = cleanText(title);
  if (!text) return '';
  if (parentTitle) {
    const parentPattern = escapeRegExp(parentTitle).replace(/\\ /g, '\\s+');
    const parentDateMatch = text.match(new RegExp(`^${parentPattern}\\s+(.+)$`, 'i'));
    if (parentDateMatch && isDerivedMapName(map, parentDateMatch[1])) {
      return parentDateMatch[1].trim();
    }
  }
  return isDerivedMapName(map, text) ? text : '';
}

function isDerivedMapName(map, title) {
  const text = cleanText(title);
  if (!text) return false;
  if (/^\d{4}$/.test(text)) return true;
  if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}(?:\s*\([^)]*\))?$/.test(text)) return true;
  if (/^[A-Za-z]{3,9}\s+\d{4}$/.test(text)) return true;

  const normalText = normalizeDisplayText(text);
  for (const candidate of [formatPlainMapDate(map?.date), plainMapYear(map?.date)]) {
    const normalCandidate = normalizeDisplayText(candidate);
    if (normalCandidate && (normalText === normalCandidate || normalText.startsWith(`${normalCandidate} (`))) {
      return true;
    }
  }
  return false;
}

function formatPlainMapDate(dateStr) {
  if (!dateStr) return '';
  const str = String(dateStr);
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const longMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  if (/^\d{4}$/.test(str)) return str;
  if (/^\d{4}-\d{2}$/.test(str)) {
    const [year, month] = str.split('-').map(Number);
    return `${shortMonths[month - 1]} ${year}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [year, month, day] = str.split('-').map(Number);
    return `${String(day).padStart(2, '0')} ${longMonths[month - 1]} ${year}`;
  }
  return str;
}

function plainMapYear(dateStr) {
  const match = String(dateStr || '').match(/^(\d{4})/);
  return match ? match[1] : '';
}

function normalizeDisplayText(value) {
  return cleanText(value)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildElections(manifest) {
  return (manifest.elections || []).map((entry) => {
    const title = cleanText(entry.displayTitle || entry.body || entry.bodySlug || entry.key);
    const layerId = mainElectionLayerId(entry);
    const decade = Number.isFinite(Number(entry.date?.slice(0, 4))) ? `${Math.floor(Number(entry.date.slice(0, 4)) / 10) * 10}s` : null;
    return compactObject({
      id: entry.key,
      key: entry.key,
      type: 'election',
      title,
      body: cleanText(entry.body || title),
      bodySlug: entry.bodySlug || slugify(title),
      date: entry.date || null,
      year: entry.year || Number(entry.date?.slice(0, 4)) || null,
      decade,
      subtitle: cleanText(entry.displaySubtitle || ''),
      provider: cleanText(entry.displayProvider || entry.body || ''),
      category: 'Elections',
      geography: electionGeographyLabel(entry),
      constituencies: normalizeArray(entry.constituencies).slice(0, SAMPLE_RELATED_LIMIT),
      totalConstituencies: entry.totalConstituencies || entry.constituencies?.length || 0,
      matchedCount: entry.matchedCount || 0,
      unmatchedCount: entry.unmatchedCount || 0,
      sourceMapId: entry.sourceMapId || null,
      layerId: entry.layerId || null,
      labelProperty: entry.labelProperty || null,
      loadable: Boolean(entry.loadable),
      placeholder: Boolean(entry.placeholder),
      status: entry.placeholder ? 'not yet converted' : entry.loadable ? 'available' : 'metadata only',
      resultUrl: entry.resultUrl || null,
      anchorUrl: entry.anchorUrl || null,
      previousKey: entry.previousKey || null,
      interactiveUrl: interactiveLayerUrl(layerId),
      browseUrl: `/browse/elections/${encodeURIComponent(entry.key)}`
    });
  }).filter((entry) => entry.key).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || a.title.localeCompare(b.title));
}

function readElectionDetails(elections) {
  const detailFiles = new Map();
  for (const election of elections) {
    const rel = String(election.resultUrl || `/test/metadata/elections-test2/${election.key}.json`).replace(/^\/+/, '');
    const fullPath = path.join(ROOT, rel);
    if (!existsSync(fullPath)) continue;
    try {
      const detail = JSON.parse(readFileSync(fullPath, 'utf8'));
      detailFiles.set(election.key, detail);
      Object.assign(election, compactObject({
        title: cleanText(detail.displayTitle || detail.body || election.title),
        body: cleanText(detail.body || election.body),
        provider: cleanText(detail.displayProvider || election.provider),
        subtitle: cleanText(detail.displaySubtitle || election.subtitle),
        availableStyleModes: normalizeArray(detail.availableStyleModes),
        partySummary: normalizeArray(detail.mainLikePartySummary || detail.partySummary).slice(0, 16).map((party) => compactObject({
          party: party.party,
          seats: party.seats ?? party.elected,
          stood: party.stood,
          votes: party.votes ?? party.firstPrefs,
          share: party.share,
          colour: party.colour || party.color
        })),
        totals: compactObject({
          seats: detail.mainLikeTotals?.seats || sumNumbers(detail.partySummary, 'seats'),
          validPoll: detail.mainLikeTotals?.validPoll || sumNumbers(detail.partySummary, 'votes'),
          constituencies: detail.totalConstituencies || detail.constituencies?.length || election.totalConstituencies
        })
      }));
    } catch (error) {
      console.warn(`Could not read election detail ${rel}: ${error.message}`);
    }
  }
  return detailFiles;
}

function buildFeatureGroups(spatialIndex, maps, elections) {
  const mapById = new Map(maps.map((map) => [map.id, map]));
  const electionsBySourceMap = new Map();
  for (const election of elections) {
    if (!election.sourceMapId) continue;
    const current = electionsBySourceMap.get(election.sourceMapId) || [];
    current.push({ key: election.key, title: election.title, date: election.date, interactiveUrl: election.interactiveUrl });
    electionsBySourceMap.set(election.sourceMapId, current);
  }

  const sampleByMap = new Map();
  for (const feature of spatialIndex.features || []) {
    if (!feature?.mapId) continue;
    const sample = sampleByMap.get(feature.mapId) || [];
    if (sample.length < FEATURE_SAMPLE_LIMIT) {
      sample.push(compactObject({
        name: cleanText(feature.name || feature.label || 'Unnamed feature'),
        bbox: Array.isArray(feature.bbox) ? feature.bbox : null
      }));
    }
    sampleByMap.set(feature.mapId, sample);
  }

  return (spatialIndex.maps || []).map((group) => {
    const map = mapById.get(group.id) || {};
    const relatedElections = electionsBySourceMap.get(group.id) || [];
    return compactObject({
      id: group.id,
      type: 'feature-group',
      title: cleanText(group.name || map.title || group.id),
      category: map.category || group.category || null,
      group: map.group || null,
      featureCount: group.featureCount || sampleByMap.get(group.id)?.length || 0,
      bounds: Array.isArray(group.bounds) ? group.bounds : null,
      sourceMapId: group.id,
      sourceFile: group.file || null,
      spatialIndexUrl: `/data/database/spatial-index/${encodeURIComponent(group.id)}.json`,
      relatedElections: relatedElections.slice(0, SAMPLE_RELATED_LIMIT),
      relatedElectionCount: relatedElections.length,
      sampleFeatures: sampleByMap.get(group.id) || [],
      interactiveUrl: interactiveLayerUrl(group.id),
      browseUrl: `/browse/features?map=${encodeURIComponent(group.id)}`
    });
  }).sort((a, b) => (b.relatedElectionCount - a.relatedElectionCount) || (b.featureCount - a.featureCount) || a.title.localeCompare(b.title));
}

function buildParties(partyIds, electionDetails) {
  const aliasToId = new Map();
  const byId = new Map();
  for (const party of partyIds.party_ids || []) {
    const id = party.party_id || `party:${slugify(party.canonical_name)}`;
    const detail = {
      id,
      slug: id.replace(/^party:/, ''),
      type: 'party',
      title: cleanText(party.canonical_name || id),
      canonicalName: cleanText(party.canonical_name || id),
      observedNames: normalizeArray(party.observed_names),
      knownAliases: normalizeArray(party.known_aliases),
      occurrenceCount: Number(party.occurrence_count) || 0,
      fileCount: Number(party.file_count) || 0,
      relatedElections: [],
      totals: { stood: 0, seats: 0, votes: 0 },
      firstYear: null,
      lastYear: null,
      browseUrl: `/browse/parties/${encodeURIComponent(id.replace(/^party:/, ''))}`
    };
    byId.set(id, detail);
    for (const name of [detail.canonicalName, ...detail.observedNames, ...detail.knownAliases]) {
      if (name) aliasToId.set(normalizeName(name), id);
    }
  }

  for (const [key, detail] of electionDetails) {
    for (const row of normalizeArray(detail.mainLikePartySummary || detail.partySummary)) {
      const partyName = cleanText(row.party || row.name);
      if (!partyName) continue;
      const id = aliasToId.get(normalizeName(partyName)) || `party:${slugify(partyName)}`;
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          slug: id.replace(/^party:/, ''),
          type: 'party',
          title: partyName,
          canonicalName: partyName,
          observedNames: [partyName],
          knownAliases: [],
          occurrenceCount: 0,
          fileCount: 0,
          relatedElections: [],
          totals: { stood: 0, seats: 0, votes: 0 },
          firstYear: null,
          lastYear: null,
          browseUrl: `/browse/parties/${encodeURIComponent(id.replace(/^party:/, ''))}`
        });
      }
      const party = byId.get(id);
      const year = Number(detail.year || detail.date?.slice(0, 4));
      party.totals.stood += Number(row.stood || 0);
      party.totals.seats += Number(row.seats ?? row.elected ?? 0);
      party.totals.votes += Number(row.votes ?? row.firstPrefs ?? 0);
      party.firstYear = party.firstYear === null ? year : Math.min(party.firstYear, year || party.firstYear);
      party.lastYear = party.lastYear === null ? year : Math.max(party.lastYear, year || party.lastYear);
      if (party.relatedElections.length < PARTY_RELATED_LIMIT) {
        party.relatedElections.push(compactObject({
          key,
          title: cleanText(detail.body || detail.displayTitle || key),
          date: detail.date,
          seats: row.seats ?? row.elected,
          stood: row.stood,
          votes: row.votes ?? row.firstPrefs,
          share: row.share,
          interactiveUrl: interactiveLayerUrl(mainElectionLayerId(detail))
        }));
      }
    }
  }

  const details = Object.fromEntries([...byId.values()].map((party) => [party.slug, {
    ...party,
    subtitle: compactJoin([formatYearRange(party.firstYear, party.lastYear), `${party.relatedElections.length} linked elections`]),
    interactiveUrl: party.relatedElections[0]?.interactiveUrl || null
  }]));
  const items = Object.values(details).map((party) => compactObject({
    id: party.id,
    slug: party.slug,
    type: 'party',
    title: party.title,
    subtitle: party.subtitle,
    occurrenceCount: party.occurrenceCount,
    fileCount: party.fileCount,
    firstYear: party.firstYear,
    lastYear: party.lastYear,
    relatedElectionCount: party.relatedElections.length,
    totals: party.totals,
    browseUrl: party.browseUrl
  })).sort((a, b) => (b.occurrenceCount - a.occurrenceCount) || (b.relatedElectionCount - a.relatedElectionCount) || a.title.localeCompare(b.title));

  return { parties: items, partyDetails: details };
}

function buildPersons(electionDetails) {
  const byId = new Map();
  for (const [key, election] of electionDetails) {
    const context = {
      key,
      title: cleanText(election.body || election.displayTitle || key),
      date: election.date,
      year: Number(election.year || election.date?.slice(0, 4)) || null,
      interactiveUrl: interactiveLayerUrl(mainElectionLayerId(election))
    };
    for (const result of normalizeArray(election.results)) {
      for (const candidate of extractCandidates(result)) {
        const name = cleanText(candidate.name || candidate.candidate || candidate.Candidate);
        if (!name) continue;
        const personId = cleanText(candidate.personId || candidate.person_id || candidate.personID || '') || `name:${slugify(name)}`;
        if (!byId.has(personId)) {
          byId.set(personId, {
            id: personId,
            slug: slugify(personId),
            type: 'person',
            title: name,
            name,
            parties: new Map(),
            constituencies: new Map(),
            elections: [],
            totals: { stood: 0, elected: 0, firstPrefs: 0 },
            firstYear: null,
            lastYear: null,
            browseUrl: `/browse/persons/${encodeURIComponent(slugify(personId))}`
          });
        }
        const person = byId.get(personId);
        const party = cleanText(candidate.party || candidate.Party || result.party || '');
        const constituency = cleanText(candidate.constituency || result.constituency || '');
        const year = context.year;
        person.parties.set(party || 'Unknown', (person.parties.get(party || 'Unknown') || 0) + 1);
        if (constituency) person.constituencies.set(constituency, (person.constituencies.get(constituency) || 0) + 1);
        person.totals.stood += 1;
        person.totals.elected += candidate.elected || candidate.counted_as_elected || candidate.outcome === 'Elected' || candidate.status === 'Elected' ? 1 : 0;
        person.totals.firstPrefs += Number(candidate.firstPrefs || candidate.firstPref || candidate.votes || 0);
        person.firstYear = person.firstYear === null ? year : Math.min(person.firstYear, year || person.firstYear);
        person.lastYear = person.lastYear === null ? year : Math.max(person.lastYear, year || person.lastYear);
        if (person.elections.length < PERSON_RELATED_LIMIT) {
          person.elections.push(compactObject({
            ...context,
            party,
            constituency,
            status: cleanText(candidate.status || candidate.outcome || ''),
            elected: Boolean(candidate.elected || candidate.counted_as_elected || candidate.outcome === 'Elected'),
            firstPrefs: Number(candidate.firstPrefs || candidate.firstPref || candidate.votes || 0) || null
          }));
        }
      }
    }
  }

  const details = Object.fromEntries([...byId.values()].map((person) => {
    const parties = mapToSortedArray(person.parties);
    const constituencies = mapToSortedArray(person.constituencies);
    const detail = {
      ...person,
      parties,
      constituencies,
      subtitle: compactJoin([parties[0]?.name, formatYearRange(person.firstYear, person.lastYear), `${person.totals.stood} contests`]),
      interactiveUrl: person.elections[0]?.interactiveUrl || null
    };
    return [detail.slug, detail];
  }));

  const items = Object.values(details).map((person) => compactObject({
    id: person.id,
    slug: person.slug,
    type: 'person',
    title: person.title,
    subtitle: person.subtitle,
    firstYear: person.firstYear,
    lastYear: person.lastYear,
    parties: person.parties.slice(0, 4),
    totals: person.totals,
    browseUrl: person.browseUrl
  })).sort((a, b) => (b.totals.elected - a.totals.elected) || (b.totals.stood - a.totals.stood) || a.title.localeCompare(b.title));

  return { persons: items, personDetails: details };
}

function buildSources(booksData, dataEntriesData, maps, elections) {
  const sources = [];
  const bookCategories = new Map((booksData.categories || []).map((category) => [category.id, category]));
  for (const book of normalizeArray(booksData.books || booksData.items)) {
    const id = `book:${book.id || book.slug || slugify(book.title || book.name)}`;
    const category = bookCategories.get(book.category) || {};
    sources.push(compactObject({
      id,
      slug: slugify(id),
      type: 'book',
      title: cleanText(book.title || book.name || id),
      subtitle: compactJoin([book.year, book.publisher, category.name]),
      category: category.name || book.category || 'Books',
      date: book.date || book.year || null,
      provider: normalizeArray(book.provider || book.publisher),
      description: cleanText(book.description || ''),
      references: normalizeReferences(book.references),
      downloads: normalizeLinks(book.downloads || book.url || book.archiveUrl || book.pdf),
      browseUrl: `/browse/sources/${encodeURIComponent(slugify(id))}`
    }));
  }
  for (const entry of normalizeArray(dataEntriesData.dataEntries || dataEntriesData.entries)) {
    const id = `table:${entry.id || entry.slug || slugify(entry.title || entry.name)}`;
    sources.push(compactObject({
      id,
      slug: slugify(id),
      type: 'table',
      title: cleanText(entry.title || entry.name || id),
      subtitle: compactJoin([entry.year, entry.provider, entry.category]),
      category: entry.category || 'Tables',
      date: entry.date || entry.year || null,
      provider: normalizeArray(entry.provider || entry.providers),
      description: cleanText(entry.description || ''),
      references: normalizeReferences(entry.references || entry.sources),
      downloads: normalizeLinks(entry.downloads || entry.sourceDownload || entry.file || entry.files),
      browseUrl: `/browse/sources/${encodeURIComponent(slugify(id))}`
    }));
  }
  for (const map of maps) {
    if (!map.sourceFiles?.length && !map.downloads?.length && !map.references?.length) continue;
    const id = `map-source:${map.id}`;
    sources.push(compactObject({
      id,
      slug: slugify(id),
      type: 'map-source',
      title: `${map.title} source files`,
      subtitle: compactJoin([map.category, map.provider?.join(', ')]),
      category: 'Map sources',
      date: map.date || null,
      provider: map.provider,
      description: map.description,
      sourceMapId: map.id,
      references: map.references,
      downloads: [...(map.downloads || []), ...(map.sourceFiles || [])],
      interactiveUrl: map.interactiveUrl,
      browseUrl: `/browse/sources/${encodeURIComponent(slugify(id))}`
    }));
  }
  for (const election of elections) {
    if (!election.resultUrl && !election.anchorUrl) continue;
    const id = `election-source:${election.key}`;
    sources.push(compactObject({
      id,
      slug: slugify(id),
      type: 'election-source',
      title: `${election.title} ${election.date || ''}`.trim(),
      subtitle: compactJoin([election.body, election.subtitle]),
      category: 'Election sources',
      date: election.date || null,
      provider: normalizeArray(election.provider),
      description: `Generated election bundle for ${election.title}.`,
      sourceMapId: election.sourceMapId,
      downloads: normalizeLinks([election.resultUrl, election.anchorUrl].filter(Boolean)),
      interactiveUrl: election.interactiveUrl,
      browseUrl: `/browse/sources/${encodeURIComponent(slugify(id))}`
    }));
  }
  return sources.sort(sortByTitle);
}

function writeDetailFiles(kind, records) {
  const dir = path.join(DETAILS_DIR, kind);
  mkdirSync(dir, { recursive: true });
  for (const record of records) {
    const slug = record.slug || slugify(record.id || record.key || record.title);
    writeJson(path.join('details', kind, `${slug}.json`), { schemaVersion: 1, generatedAt: GENERATED_AT, item: record });
  }
}

function ensureUniqueSlugs(records) {
  const seen = new Map();
  for (const record of records) {
    const base = record.slug || slugify(record.id || record.key || record.title);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    if (count === 0) {
      record.slug = base;
      continue;
    }
    const suffix = slugify(record.id || record.key || `${base}-${count + 1}`);
    record.slug = suffix && suffix !== base ? `${base}-${suffix}` : `${base}-${count + 1}`;
  }
}

function readJson(relPath, fallback) {
  const fullPath = path.join(ROOT, relPath);
  if (!existsSync(fullPath)) return fallback;
  return JSON.parse(readFileSync(fullPath, 'utf8'));
}

function writeJson(relPath, value) {
  const fullPath = path.isAbsolute(relPath) ? relPath : path.join(OUT_DIR, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`);
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && item !== '');
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function normalizeFiles(value) {
  if (!value) return [];
  if (typeof value === 'string') return [{ label: fileLabel(value), url: value }];
  if (Array.isArray(value)) return value.flatMap(normalizeFiles);
  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([label, url]) => {
      if (!url) return [];
      if (typeof url === 'string') return [{ label, url }];
      if (Array.isArray(url)) return url.map((item) => ({ label, url: String(item) }));
      return normalizeFiles(url).map((item) => ({ ...item, label: item.label || label }));
    });
  }
  return [];
}

function normalizeReferences(value) {
  return normalizeArray(value).flatMap((ref) => {
    if (!ref) return [];
    if (typeof ref === 'string') return [{ label: ref, url: isUrl(ref) ? ref : null }];
    return [compactObject({
      label: cleanText(ref.label || ref.title || ref.name || ref.url || ref.href),
      url: ref.url || ref.href || null,
      note: ref.note || ref.notes || null,
      accessed: ref.accessed || ref.accessedDate || null
    })];
  });
}

function normalizeLinks(value) {
  return normalizeArray(value).flatMap((link) => {
    if (!link) return [];
    if (typeof link === 'string') return [{ label: fileLabel(link), url: link }];
    if (Array.isArray(link)) return link.flatMap(normalizeLinks);
    if (typeof link === 'object') {
      if (link.url || link.href) return [compactObject({ label: cleanText(link.label || link.title || link.name || fileLabel(link.url || link.href)), url: link.url || link.href, type: link.type || null })];
      return normalizeFiles(link);
    }
    return [];
  }).filter((link) => link.url || link.label);
}

function collectYears(value) {
  const years = new Set();
  for (const key of ['year', 'startYear', 'endYear', 'fromYear', 'toYear', 'date']) {
    const current = value?.[key];
    if (!current) continue;
    const matches = String(current).match(/\b(1[5-9]\d{2}|20\d{2})\b/g) || [];
    for (const match of matches) years.add(Number(match));
  }
  for (const item of normalizeArray(value?.years)) {
    const year = Number(item);
    if (Number.isFinite(year)) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

function formatDateRange(value) {
  const years = collectYears(value);
  if (!years.length) return null;
  if (years.length === 1) return String(years[0]);
  return `${years[0]}-${years[years.length - 1]}`;
}

function formatYearRange(firstYear, lastYear) {
  if (!firstYear && !lastYear) return null;
  if (firstYear === lastYear) return String(firstYear);
  return `${firstYear || '?'}-${lastYear || '?'}`;
}

function geographyLabel(value) {
  return value.geography || value.region || value.area || value.country || null;
}

function electionGeographyLabel(entry) {
  const body = cleanText(entry.body || '');
  if (/dail|referendum|european parliament \(ireland\)/i.test(body)) return 'Republic of Ireland';
  if (/northern ireland|westminster|local government districts|assembly|forum/i.test(body)) return 'Northern Ireland';
  return entry.bodyGroup || null;
}

function compactJoin(parts) {
  return parts.filter((part) => part !== null && part !== undefined && String(part).trim()).map(cleanText).join(' / ') || null;
}

function compactObject(object) {
  const output = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    output[key] = value;
  }
  return output;
}

function fileLabel(value) {
  const text = cleanText(value);
  if (!text) return 'Source';
  const last = text.split(/[\\/]/).pop() || text;
  return last.split('?')[0] || text;
}

function isUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function slugify(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}

function normalizeName(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mainElectionLayerId(entry) {
  return `election-${mainElectionSlug(entry.body || entry.displayTitle || entry.bodySlug || entry.key)}-${entry.date || ''}`.replace(/-+$/g, '');
}

function mainElectionSlug(value) {
  return slugify(cleanText(value)
    .replace(/DÃ¡il Ã‰ireann/g, 'Dail Eireann')
    .replace(/Dáil Éireann/g, 'Dail Eireann')
    .replace(/Ã‰/g, 'E')
    .replace(/Ã¡/g, 'a')
    .replace(/Ã©/g, 'e'));
}

function interactiveLayerUrl(layerId, extra = {}) {
  if (!layerId) return null;
  const params = new URLSearchParams();
  params.set('layers', layerId);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, value);
  }
  return `/#${params.toString()}`;
}

function sortByTitle(a, b) {
  return String(a.title || '').localeCompare(String(b.title || ''));
}

function sumNumbers(rows, key) {
  return normalizeArray(rows).reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0);
}

function extractCandidates(result) {
  const candidates = [];
  for (const candidate of normalizeArray(result?.candidates)) {
    candidates.push({ ...candidate, constituency: result.constituency });
  }
  for (const row of normalizeArray(result?.forum?.rows)) {
    for (const candidate of normalizeArray(row?.list_candidates)) {
      candidates.push({ ...candidate, party: row.party, constituency: result.constituency });
    }
  }
  return candidates;
}

function mapToSortedArray(map) {
  return [...map.entries()]
    .filter(([name]) => name)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
