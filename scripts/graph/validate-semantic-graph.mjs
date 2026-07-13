import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gunzip } from 'node:zlib';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..', '..');
const GRAPH_DIR = path.join(ROOT_DIR, 'data', 'graph');
const BROWSE_DIR = path.join(ROOT_DIR, 'data', 'browse');
const MAX_GRAPH_FILE_BYTES = 25 * 1024 * 1024;
// Keep in sync with build-semantic-graph.mjs: bulk catalogue-link source
// tranches published to Browse/Sources but intentionally not promoted to graph
// entities (so the per-file entity indexes stay under the Pages 25 MiB cap).
const GRAPH_EXCLUDED_SOURCE_ID_PREFIXES = ['approved-publication:cso-pxstat-'];
const gunzipAsync = promisify(gunzip);

const REQUIRED_ENTITY_IDS = [
  'cg:body:house-of-commons',
  'cg:body:northern-ireland-assembly',
  'cg:office:mp',
  'cg:office:mla'
];

const REGISTER_REFERENCE_PROPERTIES = new Set([
  'cg:property:register-record',
  'cg:property:declared-interest',
  'cg:property:interest-category',
  'cg:property:interest-text',
  'cg:property:nil-return',
  'cg:property:source'
]);

async function main() {
  const runDeterminism = process.argv.includes('--determinism');
  const errors = [];
  const manifest = await readJson(path.join(GRAPH_DIR, 'manifest.json'));
  const entityTypesPayload = await readJson(siteUrlToPath(manifest.registries?.entityTypes));
  const propertiesPayload = await readJson(siteUrlToPath(manifest.registries?.properties));
  const entityTypes = requireArray(entityTypesPayload.types, 'entity type registry');
  const properties = requireArray(propertiesPayload.properties, 'property registry');
  const propertyIds = new Set(properties.map((property) => property.id));

  const entities = await loadShardedItems(manifest.entities?.shards, 'entities');
  const statements = await loadShardedItems(manifest.statements?.shards, 'statements');
  const entityIds = new Set();
  const entityById = new Map();
  const statementIds = new Set();
  const entityTypeCounts = new Map();
  const statementPropertyCounts = new Map();

  for (const entityType of entityTypes) {
    if (!entityType.id || !entityType.label) errors.push(`Entity type is missing id/label: ${JSON.stringify(entityType)}`);
  }
  for (const property of properties) {
    if (!property.id || !property.label || !property.valueType) errors.push(`Property is missing id/label/valueType: ${JSON.stringify(property)}`);
  }

  for (const entity of entities) {
    if (!entity.id) {
      errors.push(`Entity is missing id: ${JSON.stringify(entity).slice(0, 240)}`);
      continue;
    }
    if (entityIds.has(entity.id)) errors.push(`Duplicate entity id: ${entity.id}`);
    entityIds.add(entity.id);
    entityById.set(entity.id, entity);
    for (const typeId of normalizeArray(entity.typeIds)) {
      entityTypeCounts.set(typeId, (entityTypeCounts.get(typeId) || 0) + 1);
      if (!entityIds.has(typeId) && !entityTypes.some((type) => type.id === typeId)) {
        errors.push(`Entity ${entity.id} has unknown type id ${typeId}`);
      }
    }
  }

  for (const requiredId of REQUIRED_ENTITY_IDS) {
    if (!entityIds.has(requiredId)) errors.push(`Required entity is missing: ${requiredId}`);
  }

  const carla = entities.find((entity) => String(entity.label || '').toLowerCase() === 'carla lockhart');
  if (!carla) errors.push('Required smoke-check person entity is missing: Carla Lockhart');

  let registerRecordCount = 0;
  let declaredInterestCount = 0;
  let declaredInterestReferenceCount = 0;
  let registerStatementReferenceFailures = 0;
  let statementReferenceCount = 0;
  for (const statement of statements) {
    if (!statement.id) errors.push(`Statement is missing id: ${JSON.stringify(statement).slice(0, 240)}`);
    if (statementIds.has(statement.id)) errors.push(`Duplicate statement id: ${statement.id}`);
    statementIds.add(statement.id);
    if (!entityIds.has(statement.subjectId)) errors.push(`Statement ${statement.id} has missing subject ${statement.subjectId}`);
    if (!propertyIds.has(statement.propertyId)) errors.push(`Statement ${statement.id} has unknown property ${statement.propertyId}`);
    statementPropertyCounts.set(statement.propertyId, (statementPropertyCounts.get(statement.propertyId) || 0) + 1);
    validateValue(statement, statement.value, entityIds, propertyIds, errors, 'value');
    for (const qualifier of normalizeArray(statement.qualifiers)) {
      if (!propertyIds.has(qualifier.propertyId)) errors.push(`Statement ${statement.id} has unknown qualifier property ${qualifier.propertyId}`);
      validateValue(statement, qualifier.value, entityIds, propertyIds, errors, 'qualifier');
    }
    for (const reference of normalizeArray(statement.references)) {
      statementReferenceCount += 1;
      if (reference.sourceId && !entityIds.has(reference.sourceId)) errors.push(`Statement ${statement.id} references missing source ${reference.sourceId}`);
    }
    const subject = entityById.get(statement.subjectId);
    const valueEntity = statement.value?.type === 'entity' ? entityById.get(statement.value.id) : null;
    const isRegisterStatement = (
      subject?.typeIds?.includes('cg:entity-type:register-record') ||
      subject?.typeIds?.includes('cg:entity-type:register-interest') ||
      valueEntity?.typeIds?.includes('cg:entity-type:register-record') ||
      valueEntity?.typeIds?.includes('cg:entity-type:register-interest')
    );
    if (statement.propertyId === 'cg:property:declared-interest') {
      declaredInterestCount += 1;
      declaredInterestReferenceCount += normalizeArray(statement.references).length;
    }
    if (isRegisterStatement && REGISTER_REFERENCE_PROPERTIES.has(statement.propertyId) && !normalizeArray(statement.references).length) {
      registerStatementReferenceFailures += 1;
      if (registerStatementReferenceFailures <= 20) errors.push(`Register statement ${statement.id} has no source references`);
    }
  }

  for (const entity of entities) {
    if (normalizeArray(entity.typeIds).includes('cg:entity-type:register-record')) registerRecordCount += 1;
  }
  if (!registerRecordCount) errors.push('No register record entities were generated.');
  if (!declaredInterestCount) errors.push('No declared-interest statements were generated.');

  const mappingPayload = await readJson(siteUrlToPath(manifest.indexes?.browseRecordToEntity));
  const mappingItems = mappingPayload.items || {};
  await validateBrowseMappings(mappingItems, errors);
  const registerIndexItems = await loadRegisterInterestIndexItems();
  const missingRegisterMappings = [];
  for (const item of registerIndexItems) {
    const keys = [
      `register-interests:${item.slug}`,
      `register-interests:${item.id}`,
      `register-interests:${slugify(item.title)}`
    ].filter(Boolean);
    if (!keys.some((key) => mappingItems[key])) missingRegisterMappings.push(item.slug || item.id || item.title);
  }
  if (missingRegisterMappings.length) {
    errors.push(`Missing graph mapping for ${missingRegisterMappings.length} register-interest Browse records. First missing: ${missingRegisterMappings.slice(0, 5).join(', ')}`);
  }

  const registerDetailCoverage = await loadRegisterInterestDetailCoverage();
  if (registerRecordCount !== registerIndexItems.length) {
    errors.push(`Register record entity count ${registerRecordCount} does not match Browse register index count ${registerIndexItems.length}`);
  }
  if (declaredInterestCount !== registerDetailCoverage.interestCount) {
    errors.push(`Declared-interest statement count ${declaredInterestCount} does not match grouped detail interest count ${registerDetailCoverage.interestCount}`);
  }
  if (declaredInterestReferenceCount !== registerDetailCoverage.interestSourceRefCount) {
    errors.push(`Declared-interest reference count ${declaredInterestReferenceCount} does not match grouped detail source reference count ${registerDetailCoverage.interestSourceRefCount}`);
  }

  const personElectionAppearanceCount = await countPersonElectionAppearances();
  const candidatureCount = entityTypeCounts.get('cg:entity-type:candidature') || 0;
  const hasCandidatureCount = statementPropertyCounts.get('cg:property:has-candidature') || 0;
  const contestCount = entityTypeCounts.get('cg:entity-type:contest') || 0;
  if (candidatureCount < Math.floor(personElectionAppearanceCount.uniqueAppearances * 0.98)) {
    errors.push(`Candidature entity count ${candidatureCount} is too low for ${personElectionAppearanceCount.uniqueAppearances} unique person-election appearances`);
  }
  if (hasCandidatureCount < Math.floor(personElectionAppearanceCount.uniqueAppearances * 0.98)) {
    errors.push(`has-candidature statement count ${hasCandidatureCount} is too low for ${personElectionAppearanceCount.uniqueAppearances} unique person-election appearances`);
  }
  if (!contestCount) errors.push('No election contest entities were generated.');
  if (!(statementPropertyCounts.get('cg:property:appeared-in-election') || 0)) errors.push('No party appeared-in-election statements were generated.');
  await validateMapAndSourceFileCoverage(entityTypeCounts, entityById, statementPropertyCounts, mappingItems, errors);
  await validateGraphExports(manifest, {
    entityCount: entities.length,
    statementCount: statements.length,
    referenceCount: statementReferenceCount
  }, errors);

  const carlaStatements = carla ? await loadStatementsForSubject(manifest, carla.id) : [];
  if (carla && !carlaStatements.some((statement) => statement.propertyId === 'cg:property:register-record')) {
    errors.push('Carla Lockhart entity exists but has no graph-backed register-record statement.');
  }

  const oversizedFiles = await findOversizedGraphFiles(GRAPH_DIR);
  for (const file of oversizedFiles) {
    errors.push(`Graph file exceeds ${MAX_GRAPH_FILE_BYTES} bytes: ${path.relative(ROOT_DIR, file.path)} (${file.bytes} bytes)`);
  }

  if (!errors.length && runDeterminism) {
    const determinismError = await validateDeterministicBuild();
    if (determinismError) errors.push(determinismError);
  }

  if (errors.length) {
    console.error('Civgraph semantic graph validation failed:');
    for (const error of errors.slice(0, 120)) console.error(`- ${error}`);
    if (errors.length > 120) console.error(`- ...and ${errors.length - 120} more errors.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Civgraph semantic graph validation passed: ${entities.length.toLocaleString('en-GB')} entities, ${statements.length.toLocaleString('en-GB')} statements, ${registerRecordCount.toLocaleString('en-GB')} register records, ${declaredInterestCount.toLocaleString('en-GB')} declared-interest statements${runDeterminism ? ', deterministic rebuild verified' : ''}.`);
}

function validateValue(statement, value, entityIds, propertyIds, errors, label) {
  if (!value?.type) {
    errors.push(`Statement ${statement.id} has missing ${label} type`);
    return;
  }
  if (value.type === 'entity' && !entityIds.has(value.id)) errors.push(`Statement ${statement.id} has missing entity ${label} ${value.id}`);
  if (value.type !== 'entity' && (value.value === undefined || value.value === null)) errors.push(`Statement ${statement.id} has empty ${label}`);
}

async function loadShardedItems(shards, label) {
  const items = [];
  for (const shard of requireArray(shards, `${label} shards`)) {
    const payload = await readJson(siteUrlToPath(shard.url));
    const shardItems = requireArray(payload.items, shard.url);
    if (shard.count !== undefined && shard.count !== shardItems.length) {
      throw new Error(`${shard.url} manifest count ${shard.count} does not match ${shardItems.length}`);
    }
    items.push(...shardItems);
  }
  return items;
}

async function loadRegisterInterestIndexItems() {
  const index = await readJson(path.join(BROWSE_DIR, 'register-interests.json'));
  if (index.indexLayout !== 'sharded') return requireArray(index.items || [], 'register interest index items');
  const items = [];
  for (const shard of requireArray(index.shards, 'register interest index shards')) {
    const payload = await readJson(siteUrlToPath(shard.url));
    items.push(...requireArray(payload.items, shard.url));
  }
  return items;
}

async function validateBrowseMappings(mappingItems, errors) {
  const checks = [
    ['maps', await loadBrowseItems('maps.json')],
    ['persons', await loadBrowseItems('persons.json')],
    ['parties', await loadBrowseItems('parties.json')],
    ['elections', await loadBrowseItems('elections.json')],
    ['sources', await loadBrowseItems('sources.json')]
  ];
  for (const [type, items] of checks) {
    const missing = [];
    for (const item of items) {
      // Bulk catalogue-link source tranches (e.g. the CSO PxStat backfill) are
      // published to Browse/Sources but intentionally not promoted to
      // semantic-graph entities (see GRAPH_EXCLUDED_SOURCE_ID_PREFIXES in
      // build-semantic-graph.mjs), so they are exempt from the graph-mapping
      // requirement. They remain fully searchable via the Browse sources index.
      if (type === 'sources' && GRAPH_EXCLUDED_SOURCE_ID_PREFIXES.some((p) => String(item.id || '').startsWith(p))) continue;
      const keys = browseMappingKeys(type, item);
      if (!keys.some((key) => mappingItems[key])) missing.push(item.slug || item.id || item.key || item.title || item.name);
    }
    if (missing.length) errors.push(`Missing graph mapping for ${missing.length} ${type} Browse records. First missing: ${missing.slice(0, 5).join(', ')}`);
  }
}

async function loadBrowseItems(fileName) {
  const payload = await readJson(path.join(BROWSE_DIR, fileName));
  if (payload.indexLayout === 'sharded' && Array.isArray(payload.shards)) {
    return loadShardedItems(payload.shards, fileName);
  }
  return requireArray(payload.items || [], fileName);
}

async function loadSourceIndexItems() {
  const index = await readJson(path.join(BROWSE_DIR, 'sources.json'));
  if (index.indexLayout === 'sharded' && Array.isArray(index.shards)) {
    return loadShardedItems(index.shards, 'sources index');
  }
  return requireArray(index.items || [], 'sources index items');
}

function browseMappingKeys(type, item) {
  const values = [item.slug, item.id, item.key, item.title, item.name].filter(Boolean);
  return [...new Set(values.flatMap((value) => [`${type}:${value}`, `${type}:${slugify(value)}`]))];
}

async function loadRegisterInterestDetailCoverage() {
  const indexItems = await loadRegisterInterestIndexItems();
  const detailCache = new Map();
  let recordCount = 0;
  let interestCount = 0;
  let interestSourceRefCount = 0;
  for (const item of indexItems) {
    if (!item.detailUrl) continue;
    let shard = detailCache.get(item.detailUrl);
    if (!shard) {
      shard = await readJson(siteUrlToPath(item.detailUrl));
      detailCache.set(item.detailUrl, shard);
    }
    const detailItems = Array.isArray(shard.items)
      ? shard.items
      : Array.isArray(shard.interests)
        ? shard.interests
        : [];
    const match = detailItems.find((candidate) => (
      normalizeKey(candidate.slug) === normalizeKey(item.slug) ||
      normalizeKey(candidate.id) === normalizeKey(item.id)
    ));
    if (!match) throw new Error(`Register detail row missing for ${item.slug || item.id} in ${item.detailUrl}`);
    recordCount += 1;
    for (const interest of normalizeArray(match.interests)) {
      interestCount += 1;
      interestSourceRefCount += normalizeArray(interest.sourceRefs).length;
    }
  }
  return { recordCount, interestCount, interestSourceRefCount };
}

async function countPersonElectionAppearances() {
  const people = await loadBrowseItems('persons.json');
  const unique = new Set();
  let total = 0;
  for (const person of people) {
    for (const election of normalizeArray(person.elections)) {
      total += 1;
      unique.add([
        person.slug || person.id || person.name || person.title,
        election.key || election.title,
        election.constituency,
        election.party,
        election.status
      ].map((value) => normalizeKey(value)).join('|'));
    }
  }
  return { total, uniqueAppearances: unique.size };
}

async function validateMapAndSourceFileCoverage(entityTypeCounts, entityById, statementPropertyCounts, mappingItems, errors) {
  const maps = await loadBrowseItems('maps.json');
  const sources = await loadSourceRecordsWithDetails();
  const mapLayerCount = entityTypeCounts.get('cg:entity-type:map-layer') || 0;
  if (mapLayerCount < maps.length) {
    errors.push(`Map-layer entity count ${mapLayerCount} is lower than Browse map count ${maps.length}`);
  }
  const fileUrls = new Set();
  for (const entity of entityById.values()) {
    if (normalizeArray(entity.typeIds).includes('cg:entity-type:source-file')) {
      const url = normalizeUrl(entity.attributes?.url || entity.sourceUrl);
      if (url) fileUrls.add(url);
    }
  }
  const expectedFileUrls = new Set();
  const expectedMapSourceFileLinks = new Set();
  const expectedDownloadLinks = new Set();
  for (const map of maps) {
    const mapKey = map.slug || map.id || map.title;
    for (const file of normalizeArray(map.sourceFiles)) {
      if (file?.url) {
        expectedFileUrls.add(normalizeUrl(file.url));
        expectedMapSourceFileLinks.add(`${mapKey}|${normalizeUrl(file.url)}`);
      }
    }
    for (const download of normalizeDownloadLinks(map.downloads)) {
      expectedFileUrls.add(normalizeUrl(download.url));
      expectedDownloadLinks.add(`${mapKey}|${normalizeUrl(download.url)}`);
    }
  }
  for (const source of sources) {
    const sourceKey = source.slug || source.id || source.title;
    for (const download of normalizeDownloadLinks(source.downloads)) {
      expectedFileUrls.add(normalizeUrl(download.url));
      expectedDownloadLinks.add(`${sourceKey}|${normalizeUrl(download.url)}`);
    }
  }
  const missingUrls = [...expectedFileUrls].filter((url) => url && !fileUrls.has(url));
  if (missingUrls.length) {
    errors.push(`Missing source-file entities for ${missingUrls.length} map/source file URLs. First missing: ${missingUrls.slice(0, 5).join(', ')}`);
  }
  const sourceFileStatementCount = statementPropertyCounts.get('cg:property:source-file') || 0;
  const downloadStatementCount = statementPropertyCounts.get('cg:property:download') || 0;
  if (sourceFileStatementCount < expectedMapSourceFileLinks.size) {
    errors.push(`source-file statement count ${sourceFileStatementCount} is lower than expected map source file links ${expectedMapSourceFileLinks.size}`);
  }
  if (downloadStatementCount < expectedDownloadLinks.size) {
    errors.push(`download statement count ${downloadStatementCount} is lower than expected map/source download links ${expectedDownloadLinks.size}`);
  }
  if (!(statementPropertyCounts.get('cg:property:provider') || 0)) errors.push('No provider statements were generated.');
  await validateFeatureCoverage(entityTypeCounts, statementPropertyCounts, errors);
}

async function validateFeatureCoverage(entityTypeCounts, statementPropertyCounts, errors) {
  const features = await loadBrowseItems('features.json');
  const featureGroupCount = entityTypeCounts.get('cg:entity-type:feature-group') || 0;
  const geographicFeatureCount = entityTypeCounts.get('cg:entity-type:geographic-feature') || 0;
  const sampleFeatureCount = features.reduce((sum, item) => sum + normalizeArray(item.sampleFeatures).length, 0);
  if (featureGroupCount !== features.length) {
    errors.push(`Feature-group entity count ${featureGroupCount} does not match Browse feature group count ${features.length}`);
  }
  if (geographicFeatureCount !== sampleFeatureCount) {
    errors.push(`Geographic feature entity count ${geographicFeatureCount} does not match bounded sample feature count ${sampleFeatureCount}`);
  }
  const featureInLayerCount = statementPropertyCounts.get('cg:property:feature-in-layer') || 0;
  const hasFeatureCount = statementPropertyCounts.get('cg:property:has-feature') || 0;
  if (featureInLayerCount < featureGroupCount) errors.push(`feature-in-layer statement count ${featureInLayerCount} is lower than feature group count ${featureGroupCount}`);
  if (hasFeatureCount !== sampleFeatureCount) errors.push(`has-feature statement count ${hasFeatureCount} does not match bounded sample feature count ${sampleFeatureCount}`);
}

async function loadSourceRecordsWithDetails() {
  const items = await loadSourceIndexItems();
  const detailCache = new Map();
  const enriched = [];
  for (const item of items) {
    if (!item.detailUrl) {
      enriched.push(item);
      continue;
    }
    let shard = detailCache.get(item.detailUrl);
    if (!shard) {
      shard = await readJson(siteUrlToPath(item.detailUrl));
      detailCache.set(item.detailUrl, shard);
    }
    const detailItems = Array.isArray(shard.items) ? shard.items : [];
    const match = detailItems.find((candidate) => (
      normalizeKey(candidate.slug) === normalizeKey(item.slug) ||
      normalizeKey(candidate.id) === normalizeKey(item.id)
    ));
    enriched.push(match ? { ...item, ...match } : item);
  }
  return enriched;
}

function normalizeDownloadLinks(downloads) {
  const rows = normalizeArray(downloads);
  const links = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const next = rows[index + 1] || {};
    if (String(row.label || '').toLowerCase() === 'label' && String(next.label || '').toLowerCase() === 'file' && isLikelyUrl(next.url)) {
      links.push({ label: row.url || next.label || next.url, url: next.url, type: row.url || '' });
      index += 1;
      continue;
    }
    if (isLikelyUrl(row.url)) links.push({ label: row.label || row.url, url: row.url, type: row.type || row.format || '' });
  }
  const byUrl = new Map();
  for (const link of links) {
    const key = normalizeUrl(link.url);
    if (key && !byUrl.has(key)) byUrl.set(key, link);
  }
  return [...byUrl.values()];
}

function isLikelyUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim()) || /^\//.test(String(value || '').trim());
}

function normalizeUrl(value) {
  return String(value || '').trim();
}

async function validateDeterministicBuild() {
  const first = await normalizedGraphDigest();
  execFileSync(process.execPath, [path.join(ROOT_DIR, 'scripts', 'graph', 'build-semantic-graph.mjs')], {
    cwd: ROOT_DIR,
    stdio: 'pipe'
  });
  const second = await normalizedGraphDigest();
  execFileSync(process.execPath, [path.join(ROOT_DIR, 'scripts', 'graph', 'build-semantic-graph.mjs')], {
    cwd: ROOT_DIR,
    stdio: 'pipe'
  });
  const third = await normalizedGraphDigest();
  if (second !== third) return `Graph build is not deterministic: ${second} != ${third}`;
  if (first !== second) {
    // Existing generatedAt values or stale output can make the first digest differ. Two fresh builds must match.
    return '';
  }
  return '';
}

async function normalizedGraphDigest() {
  const entries = [];
  await collectNormalizedJsonEntries(GRAPH_DIR, GRAPH_DIR, entries);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const hash = crypto.createHash('sha256');
  for (const entry of entries) {
    hash.update(entry.path);
    hash.update('\n');
    hash.update(JSON.stringify(entry.data));
    hash.update('\n');
  }
  return hash.digest('hex');
}

async function collectNormalizedJsonEntries(rootDir, currentDir, entries) {
  const dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
  dirEntries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of dirEntries) {
    const filePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectNormalizedJsonEntries(rootDir, filePath, entries);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const data = stripVolatileFields(await readJson(filePath));
    entries.push({
      path: path.relative(rootDir, filePath).replace(/\\/g, '/'),
      data
    });
  }
}

function stripVolatileFields(value) {
  if (Array.isArray(value)) return value.map(stripVolatileFields);
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'generatedAt') continue;
      output[key] = stripVolatileFields(child);
    }
    return output;
  }
  return value;
}

async function loadStatementsForSubject(manifest, subjectId) {
  const subjectMapPayload = await readJson(siteUrlToPath(manifest.indexes?.statementsBySubjectMap));
  const shardUrl = subjectMapPayload.items?.[subjectId];
  if (!shardUrl) return [];
  const shard = await readJson(siteUrlToPath(shardUrl));
  return normalizeArray(shard.items?.[subjectId]);
}

async function validateGraphExports(manifest, counts, errors) {
  if (!manifest.exports?.manifest || !manifest.exports?.jsonld || !manifest.exports?.rdfNdjson || !manifest.exports?.provenance) {
    errors.push('Graph manifest is missing JSON-LD, RDF NDJSON, or provenance export links.');
    return;
  }

  const exportManifest = await readJson(siteUrlToPath(manifest.exports.manifest));
  if (exportManifest.counts?.entities !== counts.entityCount) {
    errors.push(`Export manifest entity count ${exportManifest.counts?.entities} does not match graph entity count ${counts.entityCount}`);
  }
  if (exportManifest.counts?.statements !== counts.statementCount) {
    errors.push(`Export manifest statement count ${exportManifest.counts?.statements} does not match graph statement count ${counts.statementCount}`);
  }
  if (exportManifest.counts?.provenanceReferences !== counts.referenceCount) {
    errors.push(`Export manifest provenance reference count ${exportManifest.counts?.provenanceReferences} does not match graph reference count ${counts.referenceCount}`);
  }

  const jsonld = await readJson(siteUrlToPath(manifest.exports.jsonld));
  if (!jsonld['@context'] || !jsonld.entityShards || !jsonld.statementShards) {
    errors.push('JSON-LD export manifest is missing @context or shard lists.');
  }
  if (jsonld.entityCount !== counts.entityCount) {
    errors.push(`JSON-LD entity count ${jsonld.entityCount} does not match graph entity count ${counts.entityCount}`);
  }
  if (jsonld.statementCount !== counts.statementCount) {
    errors.push(`JSON-LD statement count ${jsonld.statementCount} does not match graph statement count ${counts.statementCount}`);
  }
  if (sumShardCounts(jsonld.entityShards) !== counts.entityCount) {
    errors.push(`JSON-LD entity shard counts do not sum to ${counts.entityCount}`);
  }
  if (sumShardCounts(jsonld.statementShards) !== counts.statementCount) {
    errors.push(`JSON-LD statement shard counts do not sum to ${counts.statementCount}`);
  }
  await validateCompressedJsonSample(jsonld.entityShards, '@graph', errors, 'JSON-LD entity export');
  await validateCompressedJsonSample(jsonld.statementShards, '@graph', errors, 'JSON-LD statement export');

  const rdfRows = await readNdjson(siteUrlToPath(manifest.exports.rdfNdjson));
  const rdfManifest = rdfRows.find((row) => row.recordType === 'manifest');
  const rdfShards = rdfRows.filter((row) => row.recordType === 'shard');
  if (!rdfManifest || rdfManifest.statementCount !== counts.statementCount) {
    errors.push(`RDF NDJSON manifest statement count ${rdfManifest?.statementCount} does not match graph statement count ${counts.statementCount}`);
  }
  if (sumShardCounts(rdfShards) !== counts.statementCount) {
    errors.push(`RDF NDJSON shard counts do not sum to ${counts.statementCount}`);
  }
  await validateCompressedNdjsonSample(rdfShards, errors, 'RDF NDJSON export');

  const provenance = await readJson(siteUrlToPath(manifest.exports.provenance));
  if (provenance.referenceCount !== counts.referenceCount) {
    errors.push(`Provenance export reference count ${provenance.referenceCount} does not match graph reference count ${counts.referenceCount}`);
  }
  if (sumShardCounts(provenance.shards) !== counts.referenceCount) {
    errors.push(`Provenance shard counts do not sum to ${counts.referenceCount}`);
  }
  await validateCompressedJsonSample(provenance.shards, 'items', errors, 'provenance export');
}

async function validateCompressedJsonSample(shards, arrayKey, errors, label) {
  const samples = sampleShards(shards);
  for (const shard of samples) {
    const payload = await readGzipJson(siteUrlToPath(shard.url));
    const items = payload[arrayKey];
    if (!Array.isArray(items)) {
      errors.push(`${label} shard ${shard.url} is missing ${arrayKey} array.`);
      continue;
    }
    if (items.length !== shard.count) {
      errors.push(`${label} shard ${shard.url} manifest count ${shard.count} does not match ${items.length}`);
    }
  }
}

async function validateCompressedNdjsonSample(shards, errors, label) {
  const samples = sampleShards(shards);
  for (const shard of samples) {
    const text = await readGzipText(siteUrlToPath(shard.url));
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length !== shard.count) {
      errors.push(`${label} shard ${shard.url} manifest count ${shard.count} does not match ${lines.length}`);
      continue;
    }
    for (const line of [lines[0], lines[lines.length - 1]].filter(Boolean)) {
      JSON.parse(line);
    }
  }
}

function sampleShards(shards) {
  const items = requireArray(shards || [], 'export shards');
  if (items.length <= 2) return items;
  return [items[0], items[items.length - 1]];
}

function sumShardCounts(shards) {
  return normalizeArray(shards).reduce((total, shard) => total + Number(shard.count || 0), 0);
}

async function readGzipJson(filePath) {
  return JSON.parse(await readGzipText(filePath));
}

async function readGzipText(filePath) {
  return String(await gunzipAsync(await fs.readFile(filePath)));
}

async function readNdjson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function findOversizedGraphFiles(dir) {
  const oversized = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      oversized.push(...await findOversizedGraphFiles(filePath));
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_GRAPH_FILE_BYTES) oversized.push({ path: filePath, bytes: stat.size });
  }
  return oversized;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function siteUrlToPath(url) {
  if (!url) throw new Error('Missing graph URL in manifest.');
  const clean = decodeURIComponent(String(url).split('?')[0].replace(/^\/+/, ''));
  return path.join(ROOT_DIR, ...clean.split('/'));
}

function normalizeArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function normalizeKey(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
