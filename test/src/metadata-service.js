import { METADATA_URL, PORT_PLAN_URL } from './config.js';
import { normalizeSearchText, unique } from './utils.js';

export class TestMetadataService {
  constructor(url = METADATA_URL, portPlanUrl = PORT_PLAN_URL) {
    this.url = url;
    this.portPlanUrl = portPlanUrl;
    this.metadata = null;
    this.portPlan = null;
    this.layers = [];
    this.layerById = new Map();
  }

  async load() {
    const response = await fetch(this.url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`failed to load ${this.url}: ${response.status}`);
    const rawMetadata = await response.json();
    this.portPlan = await this.loadPortPlan();
    this.metadata = normalizeMetadata(rawMetadata, this.portPlan);
    this.layers = this.metadata.layers;
    this.layerById = buildLayerLookup(this.layers);
    return this.metadata;
  }

  async loadPortPlan() {
    try {
      const response = await fetch(this.portPlanUrl, { cache: 'no-cache' });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  getLayer(id) {
    return this.layerById.get(id) || null;
  }

  searchLayers(query) {
    const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return this.layers;
    return this.layers.filter((layer) => terms.every((term) => layer.searchText.includes(term)));
  }
}

function buildLayerLookup(layers) {
  const lookup = new Map();
  for (const layer of layers || []) {
    for (const key of [layer.id, layer.sourceMapId, layer.sourceMapId ? `port-${layer.sourceMapId}` : null]) {
      if (key && !lookup.has(key)) lookup.set(key, layer);
    }
  }
  return lookup;
}

export function normalizeMetadata(raw, portPlan = null) {
  const portRows = Array.isArray(portPlan?.rows) ? portPlan.rows : [];
  const explicitLayers = raw.layers || [];
  const categories = normalizeCategories(raw.categories || [], [...explicitLayers, ...portRows.map(portRowToCategoryLayer)]);
  const convertedLayers = explicitLayers.map((layer, index) => normalizeLayer({ ...layer, conversionStatus: 'converted', loadable: true }, categories, index));
  const convertedSourceIds = new Set(convertedLayers.flatMap((layer) => [layer.id, layer.sourceMapId]).filter(Boolean));
  const unconvertedLayers = portRows
    .filter((row) => !isConvertedPortStatus(row.conversionStatus) && !convertedSourceIds.has(row.sourceMapId))
    .map((row, index) => normalizePortPlanRow(row, categories, convertedLayers.length + index));
  const layers = [...convertedLayers, ...unconvertedLayers];
  return {
    version: Number(raw.version || 1),
    schemaVersion: Number(raw.schemaVersion || 2),
    description: raw.description || '',
    categories,
    capabilities: raw.capabilities || {},
    readiness: raw.readiness || {},
    timeSeriesChains: raw.timeSeriesChains || [],
    electionCatalogues: raw.electionCatalogues || [],
    portPlanSummary: portPlan?.totals || null,
    layers
  };
}

function normalizeCategories(categories, layers) {
  const explicit = new Map();
  for (const category of categories) {
    const normalized = {
      id: category.id || slugify(category.name),
      name: category.name || category.id,
      group: category.group || 'Maps',
      description: category.description || ''
    };
    explicit.set(normalized.id, normalized);
    explicit.set(normalized.name, normalized);
  }
  for (const layer of layers) {
    const key = layer.category || 'Maps';
    if (!explicit.has(key)) {
      const normalized = {
        id: slugify(key),
        name: key,
        group: layer.group || 'Maps',
        description: ''
      };
      explicit.set(normalized.id, normalized);
      explicit.set(normalized.name, normalized);
    }
  }
  return [...new Map([...explicit.values()].map((category) => [category.id, category])).values()];
}

function normalizeLayer(layer, categories, index) {
  const categoryName = layer.category || 'Maps';
  const category = categories.find((item) => item.name === categoryName || item.id === categoryName) || {
    id: slugify(categoryName),
    name: categoryName,
    group: 'Maps'
  };
  const references = Array.isArray(layer.references) ? layer.references : [];
  const sourceDownloads = Array.isArray(layer.sourceDownloads) ? layer.sourceDownloads : [];
  const keywords = unique([
    ...(Array.isArray(layer.keywords) ? layer.keywords : []),
    layer.name,
    layer.id,
    layer.sourceMapId,
    category.name,
    category.group,
    layer.provider,
    layer.status,
    layer.description,
    ...(Array.isArray(layer.sourceCredits) ? layer.sourceCredits : [])
  ]);
  return {
    ...layer,
    isConverted: isConvertedPortStatus(layer.conversionStatus) || layer.loadable === true,
    loadable: layer.loadable !== false && layer.sourceType !== 'unconverted',
    category: category.name,
    categoryId: category.id,
    group: layer.group || category.group || 'Maps',
    renderer: layer.renderer || 'maplibre',
    geometryType: layer.geometryType || 'polygon',
    status: layer.status || 'pilot',
    description: layer.description || layer.notes || '',
    dateAdded: layer.dateAdded || null,
    dateEffective: layer.dateEffective || null,
    sourceCredits: Array.isArray(layer.sourceCredits) ? layer.sourceCredits : formatCredits(layer.provider),
    references,
    sourceDownloads,
    variants: Array.isArray(layer.variants) ? layer.variants : [],
    order: Number.isFinite(Number(layer.order)) ? Number(layer.order) : index,
    searchText: normalizeSearchText(keywords.join(' ')),
    migration: {
      sourceMapId: layer.sourceMapId || layer.id,
      portedFromMainSite: Boolean(layer.sourceMapId),
      unsupportedReason: layer.unsupportedReason || null
    }
  };
}

function normalizePortPlanRow(row, categories, index) {
  const categoryName = row.category || 'Uncategorised';
  const category = categories.find((item) => item.name === categoryName || item.id === row.categoryId) || {
    id: row.categoryId || slugify(categoryName),
    name: categoryName,
    group: row.group || 'Maps'
  };
  const sourceDownloads = (row.sourceDownloads || [])
    .filter((item) => item.url)
    .map((item) => ({ label: item.label || 'Source', file: item.url }));
  const references = (row.references || [])
    .filter((item) => item.url)
    .map((item) => ({ label: item.label || 'Reference', url: item.url }));
  const sourceFiles = row.sourceFiles || [];
  const keywords = unique([
    row.name,
    row.sourceMapId,
    row.parentId,
    row.category,
    row.group,
    row.provider,
    row.description,
    row.conversionStatus,
    row.recommendedTarget,
    ...(Array.isArray(row.sourceCredits) ? row.sourceCredits : []),
    ...(sourceFiles || []).map((item) => item.file)
  ]);
  return {
    id: `port-${row.sourceMapId}`,
    sourceMapId: row.sourceMapId,
    parentId: row.parentId,
    name: row.name || row.sourceMapId,
    category: category.name,
    categoryId: category.id,
    group: row.group || category.group || 'Maps',
    date: row.date,
    dateAdded: row.dateAdded,
    dateEffective: row.dateEffective,
    provider: row.provider,
    description: row.description || '',
    sourceCredits: Array.isArray(row.sourceCredits) ? row.sourceCredits : formatCredits(row.provider),
    renderer: 'maplibre',
    sourceType: 'unconverted',
    geometryType: 'unknown',
    status: 'not-yet-converted',
    conversionStatus: row.conversionStatus,
    recommendedTarget: row.recommendedTarget,
    unsupportedReason: row.unsupportedReason,
    bounds: row.bounds,
    style: row.style || {},
    sourceDownloads,
    references,
    sourceFiles,
    variants: [],
    variantCount: row.variants || 0,
    order: index,
    isConverted: false,
    loadable: false,
    searchText: normalizeSearchText(keywords.join(' ')),
    migration: {
      sourceMapId: row.sourceMapId,
      portedFromMainSite: true,
      unsupportedReason: row.unsupportedReason || row.conversionStatus
    }
  };
}

function formatCredits(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return value ? [String(value)] : [];
}

function isConvertedPortStatus(status) {
  return status === 'converted' || status === 'convertedComposite' || status === 'convertedAlias';
}

function portRowToCategoryLayer(row) {
  return {
    category: row.category || row.categoryId || 'Uncategorised',
    group: row.group || 'Maps'
  };
}

function slugify(value) {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'maps';
}
