import { normalizeSearchText } from './utils.js';

export class FeatureSearchService {
  constructor(metadataService) {
    this.metadataService = metadataService;
    this.featureIndexes = new Map();
  }

  async search(query, limit = 12) {
    const q = normalizeSearchText(query);
    if (!q) return [];
    const results = [];
    for (const layer of this.metadataService.layers) {
      if (!layer.featureIndexUrl) continue;
      const index = await this.loadIndex(layer);
      for (const item of index) {
        if (normalizeSearchText(`${item.name} ${item.id} ${(item.aliases || []).join(' ')}`).includes(q)) {
          results.push({ ...item, layerId: layer.id, layerName: layer.name });
          if (results.length >= limit) return results;
        }
      }
    }
    return results;
  }

  async loadIndex(layer) {
    if (this.featureIndexes.has(layer.id)) return this.featureIndexes.get(layer.id);
    const response = await fetch(layer.featureIndexUrl, { cache: 'force-cache' });
    if (!response.ok) return [];
    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : payload.items || [];
    this.featureIndexes.set(layer.id, items);
    return items;
  }
}
