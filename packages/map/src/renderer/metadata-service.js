import { METADATA_URL, PORT_PLAN_URL } from './config.js';
import { normalizeSearchText, unique } from './utils.js';
/**
 * A layer of the map index as the service keeps it: the index's record (or a map of the port plan
 * not yet converted), normalised. The fields the service itself reads are named; the rest are the
 * record's own (packages/types LayerEntry), which the renderer and the adapter type as they read them.
 * @typedef {Record<string, unknown> & {
 *   id: string,
 *   sourceMapId?: string,
 *   name?: string,
 *   category: string,
 *   categoryId: string,
 *   group: string,
 *   order: number,
 *   searchText: string,
 *   isConverted: boolean,
 *   loadable: boolean,
 *   detailUrl?: string,
 *   detailLoaded?: boolean,
 *   conversionStatus?: string
 * }} MetadataLayer
 */
/** A layer as the index or a layer's detail file gives it, before normalising. @typedef {Record<string, unknown> & { id?: string, sourceMapId?: string, name?: string, category?: string, group?: string, order?: unknown, conversionStatus?: string }} RawLayer */
/** A category of the index. @typedef {{ id: string, name: string, group: string, description?: string }} MetadataCategory */
/**
 * A row of the port plan (render/metadata/main-site-port-plan.json): a map of the main site and how far its conversion has got.
 * @typedef {Record<string, unknown> & {
 *   sourceMapId?: string,
 *   parentId?: string,
 *   name?: string,
 *   category?: string,
 *   categoryId?: string,
 *   group?: string,
 *   provider?: unknown,
 *   description?: string,
 *   conversionStatus?: string,
 *   recommendedTarget?: unknown,
 *   unsupportedReason?: string,
 *   sourceCredits?: unknown,
 *   sourceDownloads?: Array<{ url?: string, label?: string }>,
 *   references?: Array<{ url?: string, label?: string }>,
 *   sourceFiles?: Array<{ file?: string }>,
 *   style?: unknown,
 *   variants?: number
 * }} PortPlanRow
 */
/** The port plan, or its client part (clientPortPlan). @typedef {{ schemaVersion?: unknown, totals?: unknown, rows?: PortPlanRow[] }} PortPlan */
/** The map index (/_api/layers?view=index) before normalising. @typedef {Record<string, unknown> & { layers?: RawLayer[], categories?: Array<{ id?: string, name?: string, group?: string, description?: string }> }} RawMetadata */

export class TestMetadataService {
  /**
   * @param {string} [url] the map index
   * @param {string} [portPlanUrl]
   * @param {{ cache?: RequestCache, portPlanCache?: RequestCache }} [options]
   */
  constructor(url = METADATA_URL, portPlanUrl = PORT_PLAN_URL, options = {}) {
    this.url = url;
    this.portPlanUrl = portPlanUrl;
    this.cacheMode = options.cache || 'no-cache';
    this.portPlanCacheMode = options.portPlanCache || 'no-cache';
    /** @type {ReturnType<typeof normalizeMetadata> | null} */
    this.metadata = null;
    /** @type {PortPlan | null} */
    this.portPlan = null;
    /** @type {MetadataLayer[]} */
    this.layers = [];
    /** @type {Map<string, MetadataLayer>} by id, source map id and port id */
    this.layerById = new Map();
    /** @type {Map<string, Promise<MetadataLayer>>} a layer's detail file, fetched once */
    this.layerDetailCache = new Map();
  }

  async load() {
    const response = await fetch(this.url, { cache: this.cacheMode });
    if (!response.ok) throw new Error(`failed to load ${this.url}: ${response.status}`);
    /** @type {RawMetadata} */
    const rawMetadata = await response.json();
    this.portPlan = await this.loadPortPlan();
    this.metadata = normalizeMetadata(rawMetadata, this.portPlan);
    this.layers = this.metadata.layers;
    this.layerById = buildLayerLookup(this.layers);
    return this.metadata;
  }

  /** @returns {Promise<PortPlan | null>} */
  async loadPortPlan() {
    try {
      const response = await fetch(this.portPlanUrl, { cache: this.portPlanCacheMode });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  /** @param {string} id */
  getLayer(id) {
    return this.layerById.get(id) || null;
  }

  /** @param {string} id @returns {Promise<MetadataLayer | null | undefined>} */
  async loadLayerDetails(id) {
    const layer = this.getLayer(id);
    if (!layer?.detailUrl) return layer;
    if (!this.layerDetailCache.has(layer.id)) {
      this.layerDetailCache.set(layer.id, fetch(layer.detailUrl, { cache: 'default' })
        .then((response) => {
          if (!response.ok) throw new Error(`failed to load ${layer.detailUrl}: ${response.status}`);
          return response.json();
        })
        .then((/** @type {RawLayer} */ detail) => {
          const merged = normalizeLayer({
            ...layer,
            ...detail,
            detailUrl: layer.detailUrl,
            detailLoaded: true
          }, this.metadata?.categories || [], layer.order || 0);
          Object.assign(layer, merged);
          this.layerById = buildLayerLookup(this.layers);
          return layer;
        })
        .catch((error) => {
          this.layerDetailCache.delete(layer.id);
          throw error;
        }));
    }
    return this.layerDetailCache.get(layer.id);
  }

  /** @param {unknown} query */
  searchLayers(query) {
    const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return this.layers;
    return this.layers.filter((layer) => terms.every((term) => layer.searchText.includes(term)));
  }
}

/** @param {MetadataLayer[]} layers */
function buildLayerLookup(layers) {
  /** @type {Map<string, MetadataLayer>} */
  const lookup = new Map();
  for (const layer of layers || []) {
    for (const key of [layer.id, layer.sourceMapId, layer.sourceMapId ? `port-${layer.sourceMapId}` : null]) {
      if (key && !lookup.has(key)) lookup.set(key, layer);
    }
  }
  return lookup;
}

/** @param {RawMetadata} raw @param {PortPlan | null} [portPlan] */
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
    // Carried through deliberately. This object is rebuilt from an explicit field list,
    // so anything not named here is DROPPED -- which is how the app silently fell back to
    // computing the count itself and displayed 893 while every other surface said 794.
    publicMapCount: Number.isFinite(raw.publicMapCount) ? raw.publicMapCount : undefined,
    categories,
    capabilities: raw.capabilities || {},
    readiness: raw.readiness || {},
    timeSeriesChains: raw.timeSeriesChains || [],
    electionCatalogues: raw.electionCatalogues || [],
    portPlanSummary: portPlan?.totals || null,
    layers
  };
}

/** @param {Array<{ id?: string, name?: string, group?: string, description?: string }>} categories @param {Array<{ category?: string, group?: string }>} layers @returns {MetadataCategory[]} */
function normalizeCategories(categories, layers) {
  /** @type {Map<string, MetadataCategory>} */
  const explicit = new Map();
  for (const category of categories) {
    // A category has an id or a name (the index's own, or a layer's).
    const normalized = {
      id: category.id || slugify(category.name),
      name: /** @type {string} */ (category.name || category.id),
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

/** @param {RawLayer} layer @param {MetadataCategory[]} categories @param {number} index @returns {MetadataLayer} */
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
  return /** @type {MetadataLayer} */ ({
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
  });
}

/** @param {PortPlanRow} row @param {MetadataCategory[]} categories @param {number} index @returns {MetadataLayer} */
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

/** @param {unknown} value @returns {string[]} */
function formatCredits(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return value ? [String(value)] : [];
}

/**
 * The part of the port plan (render/metadata/main-site-port-plan.json, 2.8 MB) the map app reads,
 * for the build to ship inside the app bundle (port-plan-client.generated.json, about 50 KB): the
 * totals; every row not yet converted, whole; and of the converted rows, only the first of each
 * category, as category, group and status. normalizeMetadata gives the same answer for either:
 * converted rows add nothing but their category, in order of first appearance, and the plan was
 * fetched on every visit before any map could draw (QA 2026-11-11, M8).
 */
/**
 * @param {unknown} plan the plan file as read (JSON): its rows and totals are read where present
 * @returns {PortPlan}
 */
export function clientPortPlan(plan) {
  /** @type {PortPlanRow[]} */
  const rows = [];
  const seen = new Set();
  for (const row of /** @type {PortPlan | null | undefined} */ (plan)?.rows || []) {
    const key = portRowToCategoryLayer(row).category;
    if (!isConvertedPortStatus(row.conversionStatus)) {
      rows.push(row);
      seen.add(key);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    /** @type {PortPlanRow} */
    const slim = { conversionStatus: row.conversionStatus };
    for (const field of ['category', 'categoryId', 'group']) {
      if (row[field] !== undefined) slim[field] = row[field];
    }
    rows.push(slim);
  }
  return { schemaVersion: /** @type {PortPlan | null | undefined} */ (plan)?.schemaVersion, totals: /** @type {PortPlan | null | undefined} */ (plan)?.totals || null, rows };
}

/** @param {unknown} status */
function isConvertedPortStatus(status) {
  return status === 'converted' || status === 'convertedComposite' || status === 'convertedAlias';
}

/** @param {{ category?: string, categoryId?: string, group?: string }} row */
function portRowToCategoryLayer(row) {
  return {
    category: row.category || row.categoryId || 'Uncategorised',
    group: row.group || 'Maps'
  };
}

/** @param {unknown} value */
function slugify(value) {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'maps';
}
