export class UrlStateController {
  constructor(controller, metadataService) {
    this.controller = controller;
    this.metadataService = metadataService;
    this.restoring = false;
  }

  read() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    return {
      layers: (params.get('layers') || '').split(',').filter(Boolean),
      z: Number(params.get('z')),
      lng: Number(params.get('lng')),
      lat: Number(params.get('lat')),
      opacity: parseLayerValueParam(params.get('opacity')),
      labels: parseLayerValueParam(params.get('labels')),
      text: parseLayerValueParam(params.get('text')),
      selected: params.get('selected') || ''
    };
  }

  async restore() {
    const state = this.read();
    this.restoring = true;
    try {
      for (const id of state.layers) {
        const layer = this.metadataService.getLayer(id);
        if (layer?.loadable !== false) {
          await this.controller.loadLayer(layer);
          if (state.opacity[id] !== undefined) this.controller.setOpacity(id, Number(state.opacity[id]));
          if (state.labels[id] !== undefined) this.controller.setLayerLabelsEnabled(id, state.labels[id] !== '0');
          if (state.text[id] !== undefined) this.controller.setLayerTextScale(id, Number(state.text[id]));
        }
      }
      if (Number.isFinite(state.lng) && Number.isFinite(state.lat) && Number.isFinite(state.z)) {
        this.controller.map.jumpTo({ center: [state.lng, state.lat], zoom: state.z });
      }
      const selection = parseSelection(state.selected);
      if (selection) this.controller.selectFeatureById(selection.layerId, selection.id, { id: selection.id });
    } finally {
      this.restoring = false;
    }
  }

  write() {
    if (this.restoring || !this.controller.map) return;
    const center = this.controller.map.getCenter();
    const params = new URLSearchParams();
    const layers = [...this.controller.layers.keys()];
    if (layers.length) params.set('layers', layers.join(','));
    const opacity = [];
    const labels = [];
    const text = [];
    for (const [id, record] of this.controller.layers) {
      if (record.opacity !== undefined) opacity.push(`${id}:${Number(record.opacity).toFixed(2)}`);
      if (record.labelLayerIds?.length) labels.push(`${id}:${record.labelsEnabled ? '1' : '0'}`);
      if (record.textScale !== undefined) text.push(`${id}:${Math.round(record.textScale)}`);
    }
    if (opacity.length) params.set('opacity', opacity.join(','));
    if (labels.length) params.set('labels', labels.join(','));
    if (text.length) params.set('text', text.join(','));
    if (this.controller.selected?.layerId && this.controller.selected?.id !== undefined) {
      params.set('selected', `${this.controller.selected.layerId}:${this.controller.selected.id}`);
    }
    params.set('lng', center.lng.toFixed(5));
    params.set('lat', center.lat.toFixed(5));
    params.set('z', this.controller.map.getZoom().toFixed(3));
    history.replaceState(null, '', `${location.pathname}${location.search}#${params.toString()}`);
  }
}

function parseLayerValueParam(value) {
  const output = {};
  for (const part of String(value || '').split(',')) {
    const index = part.indexOf(':');
    if (index <= 0) continue;
    output[part.slice(0, index)] = part.slice(index + 1);
  }
  return output;
}

function parseSelection(value) {
  const index = String(value || '').indexOf(':');
  if (index <= 0) return null;
  const layerId = value.slice(0, index);
  const id = value.slice(index + 1);
  return layerId && id ? { layerId, id } : null;
}
