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
        const haystack = normalizeSearchText(`${item.name} ${item.id} ${(item.aliases || []).join(' ')}`);
        if (haystack.includes(q)) {
          results.push({
            ...item,
            layerId: layer.id,
            layerName: layer.name,
            category: layer.category,
            sourceType: layer.sourceType,
            score: scoreResult(q, item, haystack)
          });
        }
      }
    }
    return results
      .sort((a, b) => b.score - a.score || a.layerName.localeCompare(b.layerName) || a.name.localeCompare(b.name))
      .slice(0, limit);
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

function scoreResult(query, item, haystack) {
  const name = normalizeSearchText(item.name || '');
  if (name === query) return 100;
  if (name.startsWith(query)) return 80;
  if ((item.aliases || []).map(normalizeSearchText).includes(query)) return 70;
  if (haystack.split(/\s+/).some((part) => part.startsWith(query))) return 55;
  return 35;
}
