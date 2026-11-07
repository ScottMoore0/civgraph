/**
 * The map legend: the election key, layer swatches, statistics and the approximate-stretch entries of
 * reconstructed editions (src/map/renderer/approximate-segments.js).
 *
 * Methods of the map app (Test2App, app/src/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import { escapeHtml } from './helpers.mjs';

export class LegendMethods {
  /**
   * The map's legend (UX review 2026-10-30, #6). An election's colours were explained only in
   * a container inside the results pane's secondary views, so the map itself had no key: not
   * for the winner fills, not for the seat dots, and FF and SF are both greens. It now sits on
   * the map, open on a desktop and folded to a "Legend" button on a phone. Boundary maps are
   * listed by their colours when there is more than one to tell apart, or beside an election.
   */
  updateMapLegend() {
    const host = this.mapController?.map?.getContainer?.() || document.getElementById('map');
    if (!host) return;
    const election = this.elections?.legendModel?.() || null;
    const backing = new Set(election ? this.elections.getActiveElectionBackingLayerIds?.() || [] : []);
    // Census statistics are keyed by their classes, not listed as outlines.
    const statistics = this.getLoadedLayerIds()
      .filter((id) => this.isMapVisible(id))
      .map((id) => this.mapController?.getCensusOverlayLegend?.(id))
      .filter(Boolean);
    const statisticIds = new Set(statistics.map((s) => s.id));
    const layers = this.getLoadedLayerIds()
      .filter((id) => !backing.has(id) && !statisticIds.has(id) && this.isMapVisible(id))
      .map((id) => ({ id, name: this.mapLabel(id), colour: this.layerColour(id), role: this.editionRoles?.get(id) || null }))
      .filter((layer) => layer.colour);
    const showLayers = layers.length > 1 || ((election || statistics.length) && layers.length > 0);
    // Reconstructed editions draw their approximate stretches dotted (boundary audit, 7 Nov 2026); the
    // legend says so even for a single map, with the edition's own note.
    const approximate = this.getLoadedLayerIds()
      .filter((id) => this.isMapVisible(id))
      .map((id) => this.approximateSegmentsLegend(id))
      .filter(Boolean);
    let legend = document.getElementById('test2MapLegend');
    if (!election && !showLayers && !statistics.length && !approximate.length) {
      legend?.remove();
      return;
    }
    if (!legend) {
      legend = document.createElement('section');
      legend.id = 'test2MapLegend';
      legend.className = 'test2-map-legend';
      legend.setAttribute('aria-label', 'Map legend');
      // Folded on a phone, or over a short map (a laptop with the election pane up), where an
      // open key would cover much of what it explains.
      const roomy = !this.isPhoneLayout() && host.getBoundingClientRect().height >= 420;
      legend.innerHTML = `<details${roomy ? ' open' : ''}><summary class="test2-map-legend__summary"><span>Legend</span></summary><div class="test2-map-legend__body"></div></details>`;
      host.appendChild(legend);
    }
    const esc = (value) => escapeHtml(String(value ?? ''));
    const ink = (hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
      if (!m) return '#111827';
      const n = parseInt(m[1], 16);
      const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
      return lum > 0.55 ? '#111827' : '#ffffff';
    };
    const parts = [];
    if (election) {
      const unit = election.heading || (election.unit ? `${election.unit === 'council' ? 'Councils' : election.unit === 'area' ? 'Areas' : 'Constituencies'} coloured by ${election.title.toLowerCase()}` : `${election.title}, low to high`);
      parts.push(`<p class="test2-map-legend__heading">${esc(unit)}</p>`);
      if (election.items.length) {
        const shown = election.items.slice(0, 14);
        parts.push(`<ul class="test2-map-legend__list">${shown.map((item) => `<li><span class="test2-map-legend__swatch" style="background:${esc(item.colour)};color:${ink(item.colour)}" aria-hidden="true">${esc(item.abbreviation.length <= 5 ? item.abbreviation : '')}</span><span class="test2-map-legend__name">${esc(item.name)}${item.abbreviation && item.abbreviation !== item.name ? ` <span class="test2-map-legend__abbr">(${esc(item.abbreviation)})</span>` : ''}</span><span class="test2-map-legend__count">${item.count}</span></li>`).join('')}</ul>`);
        if (election.items.length > shown.length) parts.push(`<p class="test2-map-legend__note">and ${election.items.length - shown.length} more</p>`);
      } else if (election.ramp) {
        parts.push(`<div class="test2-map-legend__ramp" style="background:${esc(election.ramp.gradient)}" aria-hidden="true"></div><p class="test2-map-legend__ramp-labels"><span>${esc(election.ramp.low)}</span><span>${esc(election.ramp.high)}</span></p>`);
      }
      // Swatches for what is not a party: hatching (results not available or incomplete), the
      // neutral fill (returned unopposed) and seats split evenly (app/src/ni-local-view.js).
      const keyNotes = (election.keyNotes || []).filter((note) => note && note.text);
      if (keyNotes.length) {
        const swatch = (kind) => (kind === 'note' ? '' : `<span class="test2-map-legend__swatch test2-map-legend__swatch--${esc(kind)}" aria-hidden="true"></span>`);
        parts.push(`<ul class="test2-map-legend__list test2-map-legend__list--key">${keyNotes.map((note) => `<li${note.kind === 'note' ? ' class="test2-map-legend__keynote"' : ''}>${swatch(note.kind)}<span class="test2-map-legend__name">${esc(note.text)}</span>${Number.isFinite(note.count) ? `<span class="test2-map-legend__count">${note.count}</span>` : ''}</li>`).join('')}</ul>`);
      }
      if (election.seats) parts.push('<p class="test2-map-legend__note"><span class="test2-map-legend__dots" aria-hidden="true"><i></i><i></i><i></i></span>One dot per seat, in the colour of the party that won it</p>');
      else if (election.bars) parts.push('<p class="test2-map-legend__note">Bars: each party\'s share of the vote</p>');
    }
    for (const stat of statistics) {
      const entry = stat.entry;
      const source = entry.source || {};
      const sourceHtml = source.url
        ? `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.title || 'Source')}</a>`
        : esc(source.title || '');
      const licenceHtml = stat.licence
        ? (stat.licence.url ? `<a href="${esc(stat.licence.url)}" target="_blank" rel="noopener">${esc(stat.licence.short || stat.licence.name)}</a>` : esc(stat.licence.short || stat.licence.name))
        : '';
      // The summary already names a lone statistic; a heading is needed only to tell several apart.
      const titled = election || statistics.length > 1;
      parts.push(`<div class="test2-map-legend__statistic" data-census-legend="${esc(stat.id)}">`
        + (titled ? `<p class="test2-map-legend__heading">${esc(entry.name)}</p>` : '')
        + `<ul class="test2-map-legend__list test2-map-legend__list--classes">${stat.classes.map((cls) => `<li><span class="test2-map-legend__swatch" style="background:${esc(cls.colour)}" aria-hidden="true"></span><span class="test2-map-legend__name">${esc(cls.label)}</span><span class="test2-map-legend__count" title="Areas in this class">${cls.count}</span></li>`).join('')}`
        + (entry.noFigureNote ? '<li><span class="test2-map-legend__swatch test2-map-legend__swatch--line" style="border-color:#374151" aria-hidden="true"></span><span class="test2-map-legend__name">No figure</span></li>' : '')
        + '</ul>'
        + (entry.legendNote ? `<p class="test2-map-legend__note">${esc(entry.legendNote)}</p>` : '')
        + (entry.noFigureNote ? `<p class="test2-map-legend__note">${esc(entry.noFigureNote)}</p>` : '')
        + ((sourceHtml || licenceHtml) ? `<p class="test2-map-legend__note test2-map-legend__source">Source: ${sourceHtml}${sourceHtml && licenceHtml ? ', ' : ''}${licenceHtml}</p>` : '')
        + '</div>');
    }
    if (showLayers) {
      // Two editions of one series: the older is drawn grey and dashed (updateEditionRoles).
      const edition = (layer) => (layer.role === 'older' ? ' <span class="test2-map-legend__abbr">(older edition, grey dashed)</span>'
        : layer.role === 'newer' ? ' <span class="test2-map-legend__abbr">(newer edition)</span>' : '');
      parts.push(`${election || statistics.length ? '<p class="test2-map-legend__heading">Other maps</p>' : ''}<ul class="test2-map-legend__list">${layers.map((layer) => `<li><span class="test2-map-legend__swatch test2-map-legend__swatch--line${layer.role === 'older' ? ' test2-map-legend__swatch--older' : ''}" style="border-color:${esc(layer.role === 'older' ? '#6b7280' : layer.colour)}" aria-hidden="true"></span><span class="test2-map-legend__name">${esc(layer.name)}${edition(layer)}</span></li>`).join('')}</ul>`);
    }
    if (approximate.length) {
      const titled = approximate.length > 1;
      parts.push(`<div class="test2-map-legend__approx" data-approximate-legend>${approximate.map((entry) => `<ul class="test2-map-legend__list"><li><span class="test2-map-legend__swatch test2-map-legend__swatch--line test2-map-legend__swatch--approx" style="border-color:${esc(entry.colour)}" aria-hidden="true"></span><span class="test2-map-legend__name">Approximate boundary${titled ? ` <span class="test2-map-legend__abbr">(${esc(entry.name)})</span>` : ''}</span></li></ul>${entry.note ? `<p class="test2-map-legend__note">${esc(entry.note)}</p>` : ''}`).join('')}</div>`);
    }
    // The election map as a Wikipedia-style SVG of this view, areas in their party colours.
    const electionMapId = election ? this.elections.getActiveElectionStyleSourceMapId?.() : null;
    if (electionMapId) parts.push(`<button type="button" class="test2-map-legend__export" data-map-image-export="${esc(electionMapId)}"><span data-export-label>Download map (SVG)</span></button>`);
    legend.querySelector('.test2-map-legend__body').innerHTML = parts.join('');
    legend.querySelector('[data-map-image-export]')?.addEventListener('click', (event) => {
      const button = event.currentTarget;
      this.exportMapImage(button.dataset.mapImageExport, 'svg', { trigger: button });
    });
    legend.querySelector('.test2-map-legend__summary span').textContent = election
      ? `Legend: ${election.title}`
      : statistics.length === 1 ? `Legend: ${statistics[0].entry.name}` : 'Legend';
  }

  /** The outline colour a loaded layer is drawn in, or '' (rasters and point clouds have none). */
  /** The legend entry for a loaded map's approximate stretches, or null (src/map/renderer/approximate-segments.js). */
  approximateSegmentsLegend(mapId) {
    const testId = this.mapController?.mainToTest?.get(mapId) || mapId;
    const record = this.mapController?.renderer?.layers?.get(testId);
    const approx = record?.config?.approximateSegments;
    if (!approx || !this.mapController?.map?.getLayer?.(`${testId}-approx`)) return null;
    const older = this.editionRoles?.get(mapId) === 'older';
    return { name: this.mapLabel(mapId), colour: older ? '#6b7280' : (record.color || '#5B21B6'), note: approx.note || '' };
  }

  layerColour(mapId) {
    const testId = this.mapController?.mainToTest?.get(mapId) || mapId;
    const record = this.mapController?.renderer?.layers?.get(testId);
    if (!record || /raster|image|point-cloud/.test(record.config?.sourceType || '')) return '';
    return record.color || record.fillColor || '';
  }
}
