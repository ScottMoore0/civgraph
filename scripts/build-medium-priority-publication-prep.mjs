import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REVIEW_INPUT_DIR = path.join(ROOT, 'data', 'review-inputs');
const INPUT = path.join(REVIEW_INPUT_DIR, 'content-blocker-review-2026-06-24.csv');
const OUT_DIR = path.join(REVIEW_INPUT_DIR, 'medium-priority-publication-prep-2026-06-25');
const TARGET_GROUPS = new Set([
  '2. Irish election source/enrichment data',
  '3. Authoritative boundary variants from Tailte/OSI/Open Data NI/NISRA',
  '4. Open Data NI boundary and statistical-geography files',
  '5. Local authority planning/property/open-data layers',
  '7. Transport, roads, infrastructure, public assets',
]);

const EXPECTED_COUNTS = new Map([
  ['2. Irish election source/enrichment data', 176],
  ['3. Authoritative boundary variants from Tailte/OSI/Open Data NI/NISRA', 270],
  ['4. Open Data NI boundary and statistical-geography files', 93],
  ['5. Local authority planning/property/open-data layers', 1637],
  ['7. Transport, roads, infrastructure, public assets', 170],
]);

const ACTION_LABELS = {
  enrichExistingElection: 'enrich-existing-election',
  createElectionEntry: 'create-new-election-entry',
  enrichExistingSource: 'enrich-existing-source',
  variantChildMap: 'variant-child-map',
  newInteractiveMap: 'new-interactive-map',
  sourceOnly: 'source-download-only',
  holdSpecialFormat: 'hold-special-format',
  localAuthorityBatch: 'local-authority-batch-review',
  transportBatch: 'transport-public-asset-batch-review',
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) row.push(field);
  if (row.length) rows.push(row);
  const [headers, ...body] = rows.filter((candidate) => candidate.some((cell) => cell !== ''));
  return body.map((values) => Object.fromEntries(headers.map((header, idx) => [header, values[idx] ?? ''])));
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function writeCsv(filePath, rows, headers) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function readJson(relativePath, fallback = null) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function norm(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

function slugify(value) {
  return norm(value).replace(/\s+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
}

function titleCaseGroup(group) {
  return group.replace(/^\d+\.\s*/, '');
}

function splitList(value, separator = '|') {
  return String(value ?? '')
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

function scrubPublicText(value) {
  return String(value ?? '')
    .replace(/\[local source path withheld\]/gi, 'Local standalone source')
    .replace(/\b[A-Z]:\\[^\s|]+/g, '[local source path withheld]')
    .replace(/\bD:\\\s*standalone\b/gi, 'Local standalone source')
    .replace(/\bD:\s*standalone\b/gi, 'Local standalone source')
    .replace(/\b[A-Z]:\\\b/g, '[local drive withheld]');
}

function hasAny(value, terms) {
  const text = norm(value);
  return terms.some((term) => text.includes(norm(term)));
}

function parseEvidence(value) {
  return String(value ?? '')
    .split(/\s+\|\s+/)
    .map((part) => {
      const pieces = part.split('::');
      if (pieces.length < 4) return null;
      const [type, id, title, scoreRaw] = pieces;
      const score = Number(scoreRaw);
      return {
        type: type.trim(),
        id: id.trim(),
        title: title.trim(),
        score: Number.isFinite(score) ? score : 0,
        raw: part,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function loadExistingRecords() {
  const maps = readJson('data/browse/maps.json', { items: [] });
  const sources = readJson('data/browse/sources.json', { items: [] });
  const dbMaps = readJson('data/database/maps.json', {});
  const electionDir = path.join(ROOT, 'render', 'metadata', 'elections-test2');
  const electionIds = new Set();
  if (fs.existsSync(electionDir)) {
    for (const name of fs.readdirSync(electionDir)) {
      if (name.endsWith('.json')) electionIds.add(name.replace(/\.json$/, ''));
    }
  }
  const dbMapIds = new Set();
  const collectIds = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string') dbMapIds.add(value.id);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(collectIds);
      else if (child && typeof child === 'object') collectIds(child);
    }
  };
  collectIds(dbMaps);
  return {
    browseMapIds: new Set((maps.items ?? []).map((item) => item.id)),
    browseSourceIds: new Set((sources.items ?? []).map((item) => item.id)),
    databaseMapIds: dbMapIds,
    electionIds,
    mapTitles: (maps.items ?? []).map((item) => ({ id: item.id, title: item.title, subtitle: item.subtitle ?? '', category: item.category ?? '' })),
  };
}

function evidenceExists(evidence, existing) {
  if (!evidence) return false;
  if (evidence.type === 'browse-map') return existing.browseMapIds.has(evidence.id);
  if (evidence.type === 'browse-source') return existing.browseSourceIds.has(evidence.id);
  if (evidence.type === 'database-map') return existing.databaseMapIds.has(evidence.id);
  if (evidence.type === 'browse-feature') return true;
  return false;
}

function inferJurisdiction(row) {
  const text = norm(`${row.title} ${row.organisation} ${row.provider} ${row.detectedFamilies}`);
  if (hasAny(text, ['northern ireland', 'open data ni', 'osni', 'nisra', 'eoni', 'belfast', 'derry', 'antrim', 'armagh', 'tyrone', 'fermanagh', 'down'])) return 'Northern Ireland';
  if (hasAny(text, ['republic of ireland', 'ireland', 'cso', 'tailte', 'osi', 'dail', 'cork', 'dublin', 'galway', 'kerry', 'limerick'])) return 'Republic of Ireland';
  return 'Ireland / unspecified';
}

function inferTopic(row) {
  const text = norm(`${row.title} ${row.category} ${row.detectedFamilies}`);
  if (hasAny(text, ['election', 'dail', 'constituency', 'candidate', 'referendum', 'polling'])) return 'election';
  if (hasAny(text, ['boundary', 'boundaries', 'ward', 'district electoral area', 'dea', 'townland', 'barony', 'civil parish', 'electoral division', 'small area', 'output area', 'local government district'])) return 'boundary';
  if (hasAny(text, ['planning', 'zoning', 'development plan', 'property', 'housing', 'vacant', 'derelict'])) return 'planning-property';
  if (hasAny(text, ['road', 'transport', 'cycle', 'traffic', 'collision', 'parking', 'bridge', 'rail', 'ev charging', 'public art', 'wifi'])) return 'transport-public-asset';
  return 'source-data';
}

function inferFeatureUnit(row) {
  const text = norm(`${row.title} ${row.detectedFamilies}`);
  if (text.includes('ward')) return 'wards';
  if (text.includes('district electoral area') || /\bdea\b/.test(text)) return 'DEAs';
  if (text.includes('constituenc')) return 'constituencies';
  if (text.includes('townland')) return 'townlands';
  if (text.includes('small area')) return 'Small Areas';
  if (text.includes('output area')) return 'Output Areas';
  if (text.includes('electoral division') || /\bded\b/.test(text)) return 'Electoral Divisions';
  if (text.includes('local government district')) return 'Local Government Districts';
  if (text.includes('road')) return 'road features';
  if (text.includes('parking')) return 'parking assets';
  return 'features';
}

function isSpatial(row) {
  const text = norm(`${row.category} ${row.formats} ${row.title}`);
  return hasAny(text, ['spatial', 'geojson', 'shp', 'shapefile', 'kml', 'gpkg', 'gdb', 'geodatabase', 'wms', 'wfs']);
}

function isLargeOrSpecial(row) {
  return hasAny(`${row.formats} ${row.title}`, ['TIFF', 'TIF', 'LAZ', 'LIDAR', 'POINT CLOUD', 'GDB', 'GEODATABASE', 'MDB', 'MBTILES', 'RASTER', '3D']);
}

function actionFor(row, group, evidence) {
  const status = norm(row.refinedStatus);
  const score = evidence?.score ?? 0;
  const spatial = isSpatial(row);
  const large = isLargeOrSpecial(row);
  const titleText = `${row.title} ${row.category} ${row.formats}`;
  if (group.startsWith('2.')) {
    if (spatial) return score >= 0.5 ? ACTION_LABELS.variantChildMap : ACTION_LABELS.newInteractiveMap;
    if (hasAny(titleText, ['election', 'dail', 'candidate', 'count', 'postal', 'special voting'])) return ACTION_LABELS.enrichExistingElection;
    return ACTION_LABELS.enrichExistingSource;
  }
  if (group.startsWith('3.') || group.startsWith('4.')) {
    if (large && score < 0.55) return ACTION_LABELS.holdSpecialFormat;
    if (score >= 0.7 || status.includes('already represented')) return ACTION_LABELS.enrichExistingSource;
    if (score >= 0.4 || status.includes('family already present') || status.includes('possible variant')) return ACTION_LABELS.variantChildMap;
    return spatial ? ACTION_LABELS.newInteractiveMap : ACTION_LABELS.sourceOnly;
  }
  if (group.startsWith('5.')) {
    if (large) return ACTION_LABELS.holdSpecialFormat;
    if (score >= 0.7 || status.includes('already represented')) return ACTION_LABELS.enrichExistingSource;
    return ACTION_LABELS.localAuthorityBatch;
  }
  if (group.startsWith('7.')) {
    if (large) return ACTION_LABELS.holdSpecialFormat;
    if (score >= 0.7 || status.includes('already represented')) return ACTION_LABELS.enrichExistingSource;
    return ACTION_LABELS.transportBatch;
  }
  return ACTION_LABELS.sourceOnly;
}

function confidenceFor(row, action, evidence) {
  let score = 50;
  if (evidence) score += Math.round(evidence.score * 35);
  if (row.refinedStatus && !norm(row.refinedStatus).includes('unclassified')) score += 5;
  if (row.cleanedRecommendation) score += 5;
  if (action === ACTION_LABELS.enrichExistingSource || action === ACTION_LABELS.enrichExistingElection) score += 5;
  if (action === ACTION_LABELS.holdSpecialFormat) score -= 15;
  if (!evidence && (action === ACTION_LABELS.variantChildMap || action === ACTION_LABELS.enrichExistingSource)) score -= 15;
  return Math.max(5, Math.min(99, score));
}

function blockerResolution(row, group, action, evidence) {
  const blockers = splitList(row.blockerCategories, ';').map((item) => item.trim()).filter(Boolean);
  const resolved = [];
  const residual = [];
  const largeOrSpecial = isLargeOrSpecial(row);
  for (const blocker of blockers) {
    const key = norm(blocker);
    if (key.includes('duplicate') || key.includes('variant')) {
      if (evidence || action === ACTION_LABELS.variantChildMap || action === ACTION_LABELS.enrichExistingSource) resolved.push(`${blocker}: classified as ${action}`);
      else residual.push(`${blocker}: no existing match candidate`);
    } else if (key.includes('election')) {
      if (action === ACTION_LABELS.enrichExistingElection || action === ACTION_LABELS.createElectionEntry) resolved.push(`${blocker}: election staging action assigned`);
      else residual.push(`${blocker}: requires exact election merge review`);
    } else if (key.includes('geography')) {
      if (evidence || inferFeatureUnit(row) !== 'features') resolved.push(`${blocker}: geography family inferred`);
      else residual.push(`${blocker}: needs exact geography crosswalk`);
    } else if (key.includes('map conversion')) {
      resolved.push(`${blocker}: conversion path staged, not executed`);
    } else if (key.includes('large') || key.includes('special')) {
      if (largeOrSpecial) residual.push(`${blocker}: size/format decision remains before runtime publication`);
      else resolved.push(`${blocker}: normal source package; no special-format hold`);
    } else if (key.includes('local authority')) {
      resolved.push(`${blocker}: batched by council/provider for approval`);
    } else {
      resolved.push(`${blocker}: publication policy assigned`);
    }
  }
  if (!blockers.length) resolved.push('No explicit blocker in source row; staging policy assigned.');
  if (action === ACTION_LABELS.holdSpecialFormat && largeOrSpecial && !residual.some((item) => item.includes('format'))) {
    residual.push('Large/special format: requires download-only vs derived-runtime decision.');
  }
  return { resolved, residual };
}

function proposedPlacement(row, group, action) {
  if (action === ACTION_LABELS.enrichExistingElection || action === ACTION_LABELS.createElectionEntry) return 'Elections/source provenance';
  if (action === ACTION_LABELS.variantChildMap || action === ACTION_LABELS.newInteractiveMap) {
    if (group.startsWith('3.') || group.startsWith('4.')) return 'Maps > boundary/geography variant';
    if (group.startsWith('5.')) return 'Maps > local authority / planning / property';
    if (group.startsWith('7.')) return 'Maps > transport / public assets';
  }
  if (action === ACTION_LABELS.enrichExistingSource) return 'Existing Browse/Books/Tables source metadata';
  return 'Books/Tables/Sources source/download record';
}

function proposedRuntime(row, action) {
  const formats = splitList(row.formats).map((format) => format.toUpperCase());
  if ([ACTION_LABELS.variantChildMap, ACTION_LABELS.newInteractiveMap].includes(action)) {
    return {
      desired: 'MapLibre interactive layer',
      conversion: 'Convert source geometry to PMTiles/vector tiles after approval.',
      sourceFormats: formats,
    };
  }
  if (action === ACTION_LABELS.holdSpecialFormat) {
    return {
      desired: 'download/source viewport first',
      conversion: 'Do not convert until size/format review approves an interactive derivative.',
      sourceFormats: formats,
    };
  }
  return {
    desired: 'metadata/source page',
    conversion: 'No runtime conversion required unless structured values are later extracted.',
    sourceFormats: formats,
  };
}

function providerUrl(row) {
  const provider = norm(row.provider);
  const slug = row.slugOrId || slugify(row.title);
  if (provider.includes('data gov')) return `https://data.gov.ie/dataset/${slug}`;
  if (provider.includes('open data ni')) return `https://admin.opendatani.gov.uk/dataset/${slug}`;
  return '';
}

function normalisedRecord(row, index, existing) {
  const evidence = parseEvidence(row.matchedSiteEvidence);
  const bestEvidence = evidence[0] ?? null;
  const action = actionFor(row, row.roiGroup, bestEvidence);
  const blockers = blockerResolution(row, row.roiGroup, action, bestEvidence);
  const stableId = `medium-prep:${slugify(row.roiGroup)}:${slugify(row.slugOrId || row.title)}:${String(index + 1).padStart(5, '0')}`;
  const url = providerUrl(row);
  const sourceFormats = splitList(row.formats).map((format) => format.toUpperCase());
  const provider = scrubPublicText(row.provider || 'Unknown provider');
  return {
    id: stableId,
    sourceRowNumber: index + 2,
    roiGroup: row.roiGroup,
    groupTitle: titleCaseGroup(row.roiGroup),
    provider,
    organisation: scrubPublicText(row.organisation || ''),
    category: row.category || '',
    title: scrubPublicText(row.title || row.slugOrId || 'Untitled source'),
    cleanTitle: scrubPublicText(cleanTitle(row.title || row.slugOrId || 'Untitled source')),
    slugOrId: row.slugOrId || slugify(row.title),
    jurisdiction: inferJurisdiction(row),
    topic: inferTopic(row),
    featureUnit: inferFeatureUnit(row),
    formats: sourceFormats,
    isSpatial: isSpatial(row),
    isLargeOrSpecial: isLargeOrSpecial(row),
    proposedAction: action,
    proposedPlacement: proposedPlacement(row, row.roiGroup, action),
    proposedRuntime: proposedRuntime(row, action),
    confidence: confidenceFor(row, action, bestEvidence),
    currentProviderUrl: url,
    waybackUrl: url ? `https://web.archive.org/web/*/${url}` : '',
    internetArchiveStatus: 'pending-upload-or-linking',
    canonicalSourcePolicy: 'current provider URL first, Wayback and IA mirror/link retained where available',
    bestExistingMatchType: bestEvidence?.type ?? '',
    bestExistingMatchId: bestEvidence?.id ?? '',
    bestExistingMatchTitle: bestEvidence?.title ?? '',
    bestExistingMatchScore: bestEvidence ? bestEvidence.score.toFixed(2) : '',
    bestExistingMatchStillPresent: bestEvidence ? evidenceExists(bestEvidence, existing) : false,
    allMatchEvidence: evidence,
    resolvedBlockers: blockers.resolved,
    residualBlockers: blockers.residual,
    residualBlockerCount: blockers.residual.length,
    cleanedRecommendation: row.cleanedRecommendation,
    geographyRecommendation: row.geographyRecommendation || geographyRecommendationFor(row),
    comparabilityRecommendation: row.comparabilityRecommendation || '',
    sourcePlacement: row.sourcePlacement || proposedPlacement(row, row.roiGroup, action),
    sourceProvenanceDraft: provenanceDraft({ ...row, provider, organisation: scrubPublicText(row.organisation || '') }, url),
    approvalState: blockers.residual.length ? 'ready-with-residual-review' : 'ready-for-approval',
    publicationState: 'staged-only-not-published',
  };
}

function cleanTitle(value) {
  return String(value ?? '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+-?\d{12,}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function geographyRecommendationFor(row) {
  const unit = inferFeatureUnit(row);
  if (unit !== 'features') return `Mechanically inferred geography family: ${unit}. Exact generation/year matching still required before runtime publication.`;
  if (isSpatial(row)) return 'Spatial layer requires provider extent, geometry type, and existing family comparison before publication.';
  return '';
}

function provenanceDraft(row, url) {
  const bits = [];
  bits.push(row.organisation || row.provider || 'Unknown provider');
  bits.push(cleanTitle(row.title || row.slugOrId || 'Untitled source'));
  if (row.formats) bits.push(`formats: ${splitList(row.formats).join(', ')}`);
  if (url) bits.push(`current URL: ${url}`);
  bits.push('IA mirror/download link pending; do not expose local drive paths.');
  return bits.join(' | ');
}

function buildBatchKey(record) {
  const provider = slugify(record.provider);
  const topic = slugify(record.topic);
  const action = slugify(record.proposedAction);
  return `${provider}__${topic}__${action}`;
}

function groupRecords(records) {
  const groups = new Map();
  for (const record of records) {
    const key = buildBatchKey(record);
    if (!groups.has(key)) {
      groups.set(key, {
        batchId: `batch:${key}`,
        provider: record.provider,
        topic: record.topic,
        proposedAction: record.proposedAction,
        proposedPlacement: record.proposedPlacement,
        count: 0,
        readyCount: 0,
        residualReviewCount: 0,
        averageConfidence: 0,
        sampleIds: [],
        recommendation: batchRecommendation(record),
      });
    }
    const batch = groups.get(key);
    batch.count += 1;
    batch.readyCount += record.residualBlockerCount ? 0 : 1;
    batch.residualReviewCount += record.residualBlockerCount ? 1 : 0;
    batch.averageConfidence += record.confidence;
    if (batch.sampleIds.length < 6) batch.sampleIds.push(record.id);
  }
  return [...groups.values()]
    .map((batch) => ({
      ...batch,
      averageConfidence: Math.round(batch.averageConfidence / batch.count),
      sampleIds: batch.sampleIds.join('; '),
    }))
    .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider));
}

function batchRecommendation(record) {
  switch (record.proposedAction) {
    case ACTION_LABELS.enrichExistingElection:
      return 'Apply as election provenance/source enrichment only after exact election/person/party/constituency match review.';
    case ACTION_LABELS.variantChildMap:
      return 'Prepare as child/variant candidate; compare geometry/source lineage before conversion.';
    case ACTION_LABELS.newInteractiveMap:
      return 'Candidate new map layer; requires conversion and final topic placement approval.';
    case ACTION_LABELS.localAuthorityBatch:
      return 'Batch by council/provider; approve only non-duplicate and materially different layers.';
    case ACTION_LABELS.transportBatch:
      return 'Lower-priority public asset/infrastructure batch; prefer stable layers over operational feeds.';
    case ACTION_LABELS.holdSpecialFormat:
      return 'Hold for size/format decision; likely IA/download-only or derived R2/CDN preview.';
    default:
      return 'Source/provenance record or enrichment candidate; no map conversion required by default.';
  }
}

function writeOutputs(records) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rowsCsv = records.map((record) => flatRecord(record));
  const rowHeaders = [
    'id',
    'roiGroup',
    'provider',
    'organisation',
    'category',
    'title',
    'cleanTitle',
    'jurisdiction',
    'topic',
    'featureUnit',
    'formats',
    'proposedAction',
    'proposedPlacement',
    'runtimeDesired',
    'runtimeConversion',
    'confidence',
    'bestExistingMatchType',
    'bestExistingMatchId',
    'bestExistingMatchTitle',
    'bestExistingMatchScore',
    'bestExistingMatchStillPresent',
    'residualBlockerCount',
    'residualBlockers',
    'resolvedBlockers',
    'currentProviderUrl',
    'waybackUrl',
    'sourcePlacement',
    'sourceProvenanceDraft',
    'approvalState',
  ];
  fs.writeFileSync(path.join(OUT_DIR, 'row-staging-records.json'), JSON.stringify(records, null, 2), 'utf8');
  writeCsv(path.join(OUT_DIR, 'row-staging-records.csv'), rowsCsv, rowHeaders);

  const batches = groupRecords(records);
  fs.writeFileSync(path.join(OUT_DIR, 'batch-review-bundles.json'), JSON.stringify(batches, null, 2), 'utf8');
  writeCsv(path.join(OUT_DIR, 'batch-review-bundles.csv'), batches, [
    'batchId',
    'provider',
    'topic',
    'proposedAction',
    'proposedPlacement',
    'count',
    'readyCount',
    'residualReviewCount',
    'averageConfidence',
    'sampleIds',
    'recommendation',
  ]);

  writeSubset(records, 'election-enrichment-prep', (record) => record.roiGroup.startsWith('2.'));
  writeSubset(records, 'boundary-variant-prep', (record) => record.roiGroup.startsWith('3.') || record.roiGroup.startsWith('4.'));
  writeSubset(records, 'local-authority-planning-property-prep', (record) => record.roiGroup.startsWith('5.'));
  writeSubset(records, 'transport-public-assets-prep', (record) => record.roiGroup.startsWith('7.'));
  writeSubset(records, 'conversion-plan', (record) => [ACTION_LABELS.variantChildMap, ACTION_LABELS.newInteractiveMap, ACTION_LABELS.holdSpecialFormat].includes(record.proposedAction));
  writeSubset(records, 'residual-blocker-review', (record) => record.residualBlockerCount > 0);
  writeSubset(records, 'source-provenance-drafts', () => true, (record) => ({
    id: record.id,
    provider: record.provider,
    title: record.cleanTitle,
    proposedAction: record.proposedAction,
    currentProviderUrl: record.currentProviderUrl,
    waybackUrl: record.waybackUrl,
    internetArchiveStatus: record.internetArchiveStatus,
    sourceProvenanceDraft: record.sourceProvenanceDraft,
  }));

  const summary = buildSummary(records, batches);
  fs.writeFileSync(path.join(OUT_DIR, 'validation-report.json'), JSON.stringify(summary.validation, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'README.md'), renderReadme(summary), 'utf8');
  return summary;
}

function flatRecord(record) {
  return {
    ...record,
    formats: record.formats.join('|'),
    runtimeDesired: record.proposedRuntime.desired,
    runtimeConversion: record.proposedRuntime.conversion,
    residualBlockers: record.residualBlockers.join(' | '),
    resolvedBlockers: record.resolvedBlockers.join(' | '),
  };
}

function writeSubset(records, baseName, predicate, mapper = flatRecord) {
  const subset = records.filter(predicate);
  fs.writeFileSync(path.join(OUT_DIR, `${baseName}.json`), JSON.stringify(subset.map(mapper), null, 2), 'utf8');
  if (!subset.length) return;
  const mapped = subset.map(mapper);
  writeCsv(path.join(OUT_DIR, `${baseName}.csv`), mapped, Object.keys(mapped[0]));
}

function countBy(records, keyFn) {
  const counts = new Map();
  for (const record of records) {
    const key = keyFn(record) || '(blank)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function buildSummary(records, batches) {
  const actualCounts = countBy(records, (record) => record.roiGroup);
  const validationErrors = [];
  for (const [group, expected] of EXPECTED_COUNTS) {
    if ((actualCounts[group] ?? 0) !== expected) {
      validationErrors.push(`Expected ${expected} rows for ${group}, found ${actualCounts[group] ?? 0}.`);
    }
  }
  for (const record of records) {
    if (!record.id || !record.title || !record.proposedAction) validationErrors.push(`Incomplete record ${record.id || record.title}`);
    if (/\b[A-Z]:\\/.test(JSON.stringify(record))) validationErrors.push(`Local Windows path leaked in ${record.id}`);
    if (!record.currentProviderUrl && ['data.gov.ie', 'Open Data NI'].includes(record.provider)) validationErrors.push(`Missing provider URL for ${record.id}`);
  }
  return {
    generatedAt: new Date().toISOString(),
    input: path.relative(ROOT, INPUT),
    outputDir: path.relative(ROOT, OUT_DIR),
    totalRows: records.length,
    groupCounts: actualCounts,
    actionCounts: countBy(records, (record) => record.proposedAction),
    approvalStateCounts: countBy(records, (record) => record.approvalState),
    providerCounts: countBy(records, (record) => record.provider),
    topicCounts: countBy(records, (record) => record.topic),
    residualBlockerRows: records.filter((record) => record.residualBlockerCount > 0).length,
    readyForApprovalRows: records.filter((record) => record.approvalState === 'ready-for-approval').length,
    batches: batches.length,
    validation: {
      status: validationErrors.length ? 'failed' : 'passed',
      errors: validationErrors,
      checks: [
        'target group counts match approved queue counts',
        'each row has stable ID/title/action',
        'no local Windows paths exposed in generated staging records',
        'provider URLs generated for data.gov.ie and Open Data NI rows',
        'all rows remain staged-only-not-published',
      ],
    },
  };
}

function renderReadme(summary) {
  const groupLines = Object.entries(summary.groupCounts)
    .map(([group, count]) => `| ${group.replace(/^\d+\.\s*/, '')} | ${count} |`)
    .join('\n');
  const actionLines = Object.entries(summary.actionCounts)
    .map(([action, count]) => `| ${action} | ${count} |`)
    .join('\n');
  return `# Medium-Priority Publication Prep

Generated: ${summary.generatedAt}

This pack stages the five approved medium-priority D-drive queues for later Civgraph publication. It does **not** publish new website records, upload to IA/R2/CDN, or create runtime catalogue entries.

## Counts

| Queue | Rows |
|---|---:|
${groupLines}

Total rows: ${summary.totalRows}

## Proposed Actions

| Action | Rows |
|---|---:|
${actionLines}

Rows ready for approval without residual blockers: ${summary.readyForApprovalRows}

Rows still needing residual review: ${summary.residualBlockerRows}

Batch review bundles: ${summary.batches}

## Outputs

- \`row-staging-records.csv/json\`: all cleaned staging records.
- \`batch-review-bundles.csv/json\`: approval bundles grouped by provider/topic/action.
- \`election-enrichment-prep.csv/json\`: election source/enrichment staging.
- \`boundary-variant-prep.csv/json\`: Tailte/OSI/Open Data NI/NISRA boundary variant staging.
- \`local-authority-planning-property-prep.csv/json\`: council/provider local authority staging.
- \`transport-public-assets-prep.csv/json\`: transport/infrastructure/public asset staging.
- \`conversion-plan.csv/json\`: rows needing PMTiles/vector/runtime or special-format decisions.
- \`residual-blocker-review.csv/json\`: rows that still need manual review after deterministic staging.
- \`source-provenance-drafts.csv/json\`: source-page/provenance drafts.
- \`validation-report.json\`: generation checks.

## Current Recommendation

Use these outputs as an approval pack. Approve at the batch level where possible; only after approval should a separate publication step write public Browse/catalogue/runtime records or upload raw/derived assets to IA/R2/CDN.
`;
}

function main() {
  if (!fs.existsSync(INPUT)) throw new Error(`Missing input CSV: ${path.relative(ROOT, INPUT)}`);
  const existing = loadExistingRecords();
  const rows = parseCsv(fs.readFileSync(INPUT, 'utf8')).filter((row) => TARGET_GROUPS.has(row.roiGroup));
  const records = rows.map((row, index) => normalisedRecord(row, index, existing));
  const summary = writeOutputs(records);
  if (summary.validation.status !== 'passed') {
    console.error(JSON.stringify(summary.validation, null, 2));
    process.exit(1);
  }
  console.log(`Prepared ${summary.totalRows} rows in ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`Ready without residual blockers: ${summary.readyForApprovalRows}`);
  console.log(`Residual review rows: ${summary.residualBlockerRows}`);
}

main();
