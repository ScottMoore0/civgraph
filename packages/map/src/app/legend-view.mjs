/**
 * The map legend's markup, from its parts (UX review 2026-10-30, #6): pure, so the legend can be
 * rendered in isolation, by a test or a gallery specimen, with sample data
 * (packages/map/src/specimens.mjs). The app's updateMapLegend (legend.js) gathers the parts from
 * the election manager and the map controller, then writes what these return into #test2MapLegend.
 */
import { escapeHtml } from './helpers.mjs';
import { MAP_COLOURS } from '../colours.mjs';

/**
 * A party (or candidate) row of an election's key: its colour, the abbreviation in the swatch, the
 * full name beside it and how many areas it colours.
 * @typedef {{ colour: string, abbreviation: string, name: string, count: number, party?: string }} LegendItem
 */
/**
 * A swatch that is not a party: hatching ('hatch'), the neutral fill ('neutral'), seats split
 * evenly ('split'), or a plain line of text ('note').
 * @typedef {{ kind: string, text: string, count?: number }} LegendKeyNote
 */
/**
 * What an election's colours on the map mean (the election manager's legendModel()).
 * @typedef {object} LegendModel
 * @property {string} title the styling mode's name ("Winner", "Turnout")
 * @property {string} [heading] the heading in full, when the model words it itself
 * @property {string} [unit] 'council', 'area' or 'constituency': what is coloured
 * @property {string} [election] the election's display title
 * @property {LegendItem[]} items
 * @property {{ low: string, high: string, gradient: string } | null} ramp a numeric mode's scale
 * @property {LegendKeyNote[]} [keyNotes]
 * @property {boolean} seats one dot per seat is drawn
 * @property {boolean} [bars] vote-share bars are drawn
 */
/**
 * A census statistic on the map, keyed by its classes (the map controller's getCensusOverlayLegend).
 * @typedef {object} CensusLegend
 * @property {string} id
 * @property {{ name: string, source?: { url?: string, title?: string }, legendNote?: string, noFigureNote?: string }} entry
 * @property {{ colour: string, label: string, count: number }[]} classes
 * @property {{ url?: string, short?: string, name?: string } | null} [licence]
 * @property {number} [areaCount]
 */
/** @typedef {{ id: string, name: string, colour: string, role: string | null }} LegendLayer */
/** @typedef {{ name: string, colour: string, note: string }} ApproximateLegend */
/**
 * Everything the legend shows.
 * @typedef {object} LegendParts
 * @property {LegendModel | null} election
 * @property {CensusLegend[]} statistics
 * @property {LegendLayer[]} layers boundary maps with a colour, outside the election's own
 * @property {boolean} showLayers whether the boundary maps are listed
 * @property {ApproximateLegend[]} approximate maps with approximate stretches drawn dotted
 * @property {string | null} electionMapId the election map an SVG can be downloaded of
 */

/** @param {unknown} value */
const esc = (value) => escapeHtml(String(value ?? ''));

/**
 * The ink that reads on a swatch of the given colour.
 * @param {unknown} hex
 */
export function legendInk(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return MAP_COLOURS.inkDark;
  const n = parseInt(m[1], 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.55 ? MAP_COLOURS.inkDark : MAP_COLOURS.inkLight;
}

/**
 * The legend's body: the election's key, each statistic's classes, the other maps, the
 * approximate stretches and the SVG download button, in that order.
 * @param {LegendParts} parts
 * @returns {string}
 */
export function legendBodyHtml({ election, statistics, layers, showLayers, approximate, electionMapId }) {
  /** @type {string[]} */
  const parts = [];
  if (election) {
    const unit = election.heading || (election.unit ? `${election.unit === 'council' ? 'Councils' : election.unit === 'area' ? 'Areas' : 'Constituencies'} coloured by ${election.title.toLowerCase()}` : `${election.title}, low to high`);
    parts.push(`<p class="test2-map-legend__heading">${esc(unit)}</p>`);
    if (election.items.length) {
      const shown = election.items.slice(0, 14);
      parts.push(`<ul class="test2-map-legend__list">${shown.map((item) => `<li><span class="test2-map-legend__swatch" style="background:${esc(item.colour)};color:${legendInk(item.colour)}" aria-hidden="true">${esc(item.abbreviation.length <= 5 ? item.abbreviation : '')}</span><span class="test2-map-legend__name">${esc(item.name)}${item.abbreviation && item.abbreviation !== item.name ? ` <span class="test2-map-legend__abbr">(${esc(item.abbreviation)})</span>` : ''}</span><span class="test2-map-legend__count">${item.count}</span></li>`).join('')}</ul>`);
      if (election.items.length > shown.length) parts.push(`<p class="test2-map-legend__note">and ${election.items.length - shown.length} more</p>`);
    } else if (election.ramp) {
      parts.push(`<div class="test2-map-legend__ramp" style="background:${esc(election.ramp.gradient)}" aria-hidden="true"></div><p class="test2-map-legend__ramp-labels"><span>${esc(election.ramp.low)}</span><span>${esc(election.ramp.high)}</span></p>`);
    }
    // Swatches for what is not a party: hatching (results not available or incomplete), the
    // neutral fill (returned unopposed) and seats split evenly (packages/map/app/ni-local-view.js).
    const keyNotes = (election.keyNotes || []).filter((note) => note && note.text);
    if (keyNotes.length) {
      /** @param {string} kind */
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
      + (entry.noFigureNote ? '<li><span class="test2-map-legend__swatch test2-map-legend__swatch--line" style="border-color:' + MAP_COLOURS.legendLine + '" aria-hidden="true"></span><span class="test2-map-legend__name">No figure</span></li>' : '')
      + '</ul>'
      + (entry.legendNote ? `<p class="test2-map-legend__note">${esc(entry.legendNote)}</p>` : '')
      + (entry.noFigureNote ? `<p class="test2-map-legend__note">${esc(entry.noFigureNote)}</p>` : '')
      + ((sourceHtml || licenceHtml) ? `<p class="test2-map-legend__note test2-map-legend__source">Source: ${sourceHtml}${sourceHtml && licenceHtml ? ', ' : ''}${licenceHtml}</p>` : '')
      + '</div>');
  }
  if (showLayers) {
    // Two editions of one series: the older is drawn grey and dashed (updateEditionRoles).
    /** @param {LegendLayer} layer */
    const edition = (layer) => (layer.role === 'older' ? ' <span class="test2-map-legend__abbr">(older edition, grey dashed)</span>'
      : layer.role === 'newer' ? ' <span class="test2-map-legend__abbr">(newer edition)</span>' : '');
    parts.push(`${election || statistics.length ? '<p class="test2-map-legend__heading">Other maps</p>' : ''}<ul class="test2-map-legend__list">${layers.map((layer) => `<li><span class="test2-map-legend__swatch test2-map-legend__swatch--line${layer.role === 'older' ? ' test2-map-legend__swatch--older' : ''}" style="border-color:${esc(layer.role === 'older' ? MAP_COLOURS.olderEdition : layer.colour)}" aria-hidden="true"></span><span class="test2-map-legend__name">${esc(layer.name)}${edition(layer)}</span></li>`).join('')}</ul>`);
  }
  if (approximate.length) {
    const titled = approximate.length > 1;
    parts.push(`<div class="test2-map-legend__approx" data-approximate-legend>${approximate.map((entry) => `<ul class="test2-map-legend__list"><li><span class="test2-map-legend__swatch test2-map-legend__swatch--line test2-map-legend__swatch--approx" style="border-color:${esc(entry.colour)}" aria-hidden="true"></span><span class="test2-map-legend__name">Approximate boundary${titled ? ` <span class="test2-map-legend__abbr">(${esc(entry.name)})</span>` : ''}</span></li></ul>${entry.note ? `<p class="test2-map-legend__note">${esc(entry.note)}</p>` : ''}`).join('')}</div>`);
  }
  // The election map as a Wikipedia-style SVG of this view, areas in their party colours.
  if (electionMapId) parts.push(`<button type="button" class="test2-map-legend__export" data-map-image-export="${esc(electionMapId)}"><span data-export-label>Download map (SVG)</span></button>`);
  return parts.join('');
}

/**
 * The legend's summary line (its fold-out button).
 * @param {LegendModel | null} election
 * @param {CensusLegend[]} statistics
 */
export function legendSummaryText(election, statistics) {
  return election
    ? `Legend: ${election.title}`
    : statistics.length === 1 ? `Legend: ${statistics[0].entry.name}` : 'Legend';
}

/**
 * The legend's container, before its body is filled: folded unless `open`.
 * @param {boolean} open
 */
export function legendShellHtml(open) {
  return `<details${open ? ' open' : ''}><summary class="test2-map-legend__summary"><span>Legend</span></summary><div class="test2-map-legend__body"></div></details>`;
}
