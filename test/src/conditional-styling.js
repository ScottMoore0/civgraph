export class ConditionalStylingController {
  constructor(controller) {
    this.controller = controller;
    this.activeStyles = new Map();
  }

  applyCategorical(layerId, config) {
    const record = this.controller.layers.get(layerId);
    if (!record || !config?.attribute) return false;
    const fillId = `${layerId}-fill`;
    if (!this.controller.map.getLayer(fillId)) return false;
    const palette = config.palette || ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#be123c', '#4b5563'];
    const values = record.config.categoricalValues?.[config.attribute] || [];
    if (!values.length) return this.clear(layerId);
    const expression = [
      'match',
      ['to-string', ['get', config.attribute]],
      ...values.slice(0, 32).flatMap((value, index) => [String(value), palette[index % palette.length]]),
      config.noDataColor || '#cccccc'
    ];
    this.controller.map.setPaintProperty(fillId, 'fill-color', expression);
    this.setActiveStyle(layerId, { type: 'categorical', palette, values: values.slice(0, 32), ...config });
    this.controller.notifyChange();
    return true;
  }

  applyPartyColours(layerId, config) {
    const record = this.controller.layers.get(layerId);
    if (!record || !config?.attribute) return false;
    const fillId = `${layerId}-fill`;
    if (!this.controller.map.getLayer(fillId)) return false;
    const colours = {
      DUP: '#D46A4C',
      UUP: '#48A5EE',
      SDLP: '#2AA82C',
      Alliance: '#F6CB2F',
      'Sinn Féin': '#326760',
      'Sinn Fein': '#326760',
      TUV: '#0C3A6A',
      Green: '#78B82A',
      PBP: '#E91D50',
      Independent: '#DDDDDD'
    };
    const expression = [
      'match',
      ['to-string', ['get', config.attribute]],
      ...Object.entries(colours).flat(),
      config.noDataColor || '#cccccc'
    ];
    this.controller.map.setPaintProperty(fillId, 'fill-color', expression);
    this.setActiveStyle(layerId, { type: 'party', colours, ...config });
    this.controller.notifyChange();
    return true;
  }

  applyGradient(layerId, config) {
    const record = this.controller.layers.get(layerId);
    if (!record || !config?.attribute) return false;
    const fillId = `${layerId}-fill`;
    if (!this.controller.map.getLayer(fillId)) return false;
    const expression = [
      'case',
      ['!', ['has', config.attribute]],
      config.noDataColor || '#cccccc',
      [
        'interpolate',
        ['linear'],
        ['to-number', ['get', config.attribute], Number(config.min ?? 0)],
        Number(config.min ?? 0),
        config.lowColor || '#3182ce',
        Number(config.max ?? 1),
        config.highColor || '#e53e3e'
      ]
    ];
    this.controller.map.setPaintProperty(fillId, 'fill-color', expression);
    this.setActiveStyle(layerId, { type: 'gradient', ...config });
    this.controller.notifyChange();
    return true;
  }

  clear(layerId) {
    const record = this.controller.layers.get(layerId);
    if (!record) return false;
    const fillId = `${layerId}-fill`;
    if (this.controller.map.getLayer(fillId)) {
      this.controller.map.setPaintProperty(fillId, 'fill-color', record.config.style?.fillColor || record.config.style?.color || '#7C3AED');
    }
    this.activeStyles.delete(layerId);
    delete record.styleState;
    this.controller.notifyChange();
    return true;
  }

  setActiveStyle(layerId, style) {
    const record = this.controller.layers.get(layerId);
    if (record) record.styleState = style;
    this.activeStyles.set(layerId, style);
  }
}
