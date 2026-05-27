export class ConditionalStylingController {
  constructor(controller) {
    this.controller = controller;
    this.activeStyles = new Map();
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
    this.activeStyles.set(layerId, { type: 'gradient', ...config });
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
    this.controller.notifyChange();
    return true;
  }
}
