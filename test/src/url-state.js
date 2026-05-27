export class UrlStateController {
  constructor(controller, metadataService, conditionalStyling = null) {
    this.controller = controller;
    this.metadataService = metadataService;
    this.conditionalStyling = conditionalStyling;
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
      stroke: parseLayerValueParam(params.get('stroke')),
      line: parseLayerValueParam(params.get('line')),
      fill: parseLayerValueParam(params.get('fill')),
      style: parseLayerValueParam(params.get('style')),
      styleAttr: parseLayerValueParam(params.get('styleAttr')),
      styleRamp: parseLayerValueParam(params.get('styleRamp')),
      filter: parseLayerValueParam(params.get('filter')),
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
          if (state.stroke[id] !== undefined) this.controller.setLayerStrokeWidth(id, Number(state.stroke[id]));
          if (state.line[id]) this.controller.setLayerColor(id, normalizeColorParam(state.line[id]));
          if (state.fill[id]) this.controller.setLayerFillColor(id, normalizeColorParam(state.fill[id]));
          this.restoreStyle(id, state);
          this.restoreFilter(id, state);
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
    const stroke = [];
    const line = [];
    const fill = [];
    const style = [];
    const styleAttr = [];
    const styleRamp = [];
    const filter = [];
    for (const [id, record] of this.controller.layers) {
      if (record.opacity !== undefined) opacity.push(`${id}:${Number(record.opacity).toFixed(2)}`);
      if (record.labelLayerIds?.length) labels.push(`${id}:${record.labelsEnabled ? '1' : '0'}`);
      if (record.textScale !== undefined) text.push(`${id}:${Math.round(record.textScale)}`);
      if (record.strokeWidth !== undefined) stroke.push(`${id}:${Number(record.strokeWidth).toFixed(1)}`);
      if (record.color) line.push(`${id}:${record.color.replace('#', '')}`);
      if (record.fillColor) fill.push(`${id}:${record.fillColor.replace('#', '')}`);
      const activeStyle = record.styleState || this.conditionalStyling?.activeStyles?.get(id);
      if (activeStyle?.type) {
        style.push(`${id}:${activeStyle.type}`);
        if (activeStyle.attribute) styleAttr.push(`${id}:${activeStyle.attribute}`);
        if (activeStyle.rampName) styleRamp.push(`${id}:${activeStyle.rampName}`);
      }
      if (record.attributeFilter?.attribute && record.attributeFilter?.value !== undefined) {
        filter.push(`${id}:${encodeURIComponent(record.attributeFilter.attribute)}=${encodeURIComponent(record.attributeFilter.value)}`);
      }
    }
    if (opacity.length) params.set('opacity', opacity.join(','));
    if (labels.length) params.set('labels', labels.join(','));
    if (text.length) params.set('text', text.join(','));
    if (stroke.length) params.set('stroke', stroke.join(','));
    if (line.length) params.set('line', line.join(','));
    if (fill.length) params.set('fill', fill.join(','));
    if (style.length) params.set('style', style.join(','));
    if (styleAttr.length) params.set('styleAttr', styleAttr.join(','));
    if (styleRamp.length) params.set('styleRamp', styleRamp.join(','));
    if (filter.length) params.set('filter', filter.join(','));
    if (this.controller.selected?.layerId && this.controller.selected?.id !== undefined) {
      params.set('selected', `${this.controller.selected.layerId}:${this.controller.selected.id}`);
    }
    params.set('lng', center.lng.toFixed(5));
    params.set('lat', center.lat.toFixed(5));
    params.set('z', this.controller.map.getZoom().toFixed(3));
    history.replaceState(null, '', `${location.pathname}${location.search}#${params.toString()}`);
  }

  restoreStyle(id, state) {
    const mode = state.style[id];
    const attribute = state.styleAttr[id];
    if (!this.conditionalStyling || !mode || !attribute) return;
    if (mode === 'gradient') {
      const ramp = getRamp(state.styleRamp[id]);
      this.conditionalStyling.applyGradient(id, {
        attribute,
        min: 0,
        max: 100,
        rampName: state.styleRamp[id] || 'blue-red',
        lowColor: ramp[0],
        highColor: ramp[1],
        noDataColor: '#cccccc'
      });
    } else if (mode === 'categorical') {
      this.conditionalStyling.applyCategorical(id, { attribute });
    } else if (mode === 'party') {
      this.conditionalStyling.applyPartyColours(id, { attribute });
    }
  }

  restoreFilter(id, state) {
    const value = state.filter[id];
    if (!value) return;
    const split = value.indexOf('=');
    if (split <= 0) return;
    this.controller.setLayerAttributeFilter(id, decodeURIComponent(value.slice(0, split)), decodeURIComponent(value.slice(split + 1)));
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

function getRamp(value) {
  if (value === 'green-purple') return ['#16a34a', '#7e22ce'];
  if (value === 'amber-blue') return ['#f59e0b', '#2563eb'];
  if (value === 'teal-rose') return ['#0f766e', '#be123c'];
  if (value === 'slate-gold') return ['#475467', '#ca8a04'];
  return ['#3182ce', '#e53e3e'];
}

function normalizeColorParam(value) {
  const text = String(value || '').replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(text) ? `#${text}` : '';
}
