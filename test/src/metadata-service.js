import { METADATA_URL } from './config.js';
import { normalizeSearchText, unique } from './utils.js';

export class TestMetadataService {
  constructor(url = METADATA_URL) {
    this.url = url;
    this.metadata = null;
    this.layers = [];
    this.layerById = new Map();
  }

  async load() {
    const response = await fetch(this.url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`failed to load ${this.url}: ${response.status}`);
    this.metadata = normalizeMetadata(await response.json());
    this.layers = this.metadata.layers;
    this.layerById = new Map(this.layers.map((layer) => [layer.id, layer]));
    return this.metadata;
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

export function normalizeMetadata(raw) {
  const categories = normalizeCategories(raw.categories || [], raw.layers || []);
  const layers = (raw.layers || []).map((layer, index) => normalizeLayer(layer, categories, index));
  return {
    version: Number(raw.version || 1),
    schemaVersion: Number(raw.schemaVersion || 2),
    description: raw.description || '',
    categories,
    capabilities: raw.capabilities || {},
    readiness: raw.readiness || {},
    timeSeriesChains: raw.timeSeriesChains || [],
    electionCatalogues: raw.electionCatalogues || [],
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
    layer.status
  ]);
  return {
    ...layer,
    category: category.name,
    categoryId: category.id,
    group: layer.group || category.group || 'Maps',
    renderer: layer.renderer || 'maplibre',
    geometryType: layer.geometryType || 'polygon',
    status: layer.status || 'pilot',
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

function slugify(value) {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'maps';
}
