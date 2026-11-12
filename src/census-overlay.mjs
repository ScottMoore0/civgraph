/**
 * Census statistic overlays (data/database/data-entries.json) on the MapLibre map.
 *
 * A statistic is a CSV of figures, one row per area, drawn on a boundary layer that is
 * already on the map engine (lgd-2012, wards-2012, dz-2021 ...). The join is a property
 * the boundary's vector tiles carry -- a real code, not the tiles' promoteId, which on some
 * layers is an OBJECTID or a row number that means nothing to the CSV:
 *
 *   entry.joinKey        the tile property            (LGDCode, WardCode, DZ2021_cd ...)
 *   entry.csvKeyColumn   the CSV column holding it    (defaults to joinKey)
 *   entry.joinCrosswalk  optional JSON {tileKey, map: {csvKey: tileValue}} for a layer
 *                        whose tiles do not carry the CSV's key at all (wards-1972: the
 *                        CSV is keyed by W72_ID, the tiles carry civ_fid)
 *
 * The figures are put into classes (equal steps across entry.domain, or log steps when
 * entry.logarithmic), and each class takes a colour from entry.ramp. The map is coloured
 * with one MapLibre `match` expression from the joined key to its class colour, so the
 * colouring holds at every zoom and on every tile as it arrives, with no per-feature state.
 *
 * Shared by the map (packages/map/app/maplibre-main-adapter.js), its legend and feature details
 * (packages/map/app/app.js, src/ui-controller.js) and the Browse and catalogue builders. Pure: no DOM.
 */

import { siteNumber } from '../packages/core/src/format.js';

/** @typedef {{ name: string, short: string, url: string }} Licence */

/**
 * A census statistic: one entry of data/database/data-entries.json, the fields read here.
 * @typedef {{
 *   id: string,
 *   name?: string,
 *   description?: string,
 *   category?: string,
 *   geography: string,
 *   csv?: string,
 *   joinKey: string,
 *   csvKeyColumn?: string,
 *   valueColumn: string,
 *   valueLabel?: string,
 *   numeratorColumn?: string,
 *   denominator?: { column?: string, label?: string } | null,
 *   tableColumns?: string[],
 *   areaNameColumn?: string,
 *   domain?: number[],
 *   ramp?: string,
 *   logarithmic?: boolean,
 *   classCount?: number,
 *   classLabels?: string[],
 *   licence?: string | Licence,
 *   source?: { licence?: string | Licence, title?: string, url?: string }
 * }} CensusEntry
 */

/**
 * One row of a statistic's CSV (parseCsv), by column name.
 * @typedef {Record<string, unknown>} CsvRow
 */
/**
 * One class of the overlay's legend: values from min (inclusive) to max (exclusive).
 * @typedef {{ min: number, max: number, colour: string, label: string }} OverlayClass
 */
/** @typedef {ReturnType<typeof joinRows>} JoinedRows */

// Matplotlib samples, as the Leaflet loader had them (archive/leaflet/js/colour-palettes.js, see ARCHIVE.md), less
// the repeated last stop three of them carried, which made the top two classes one colour.
// 'protestant-catholic' diverges: blue at 0 %, grey at 50 %, green at 100 %.
/** @type {Record<string, string[]>} */
export const RAMPS = {
  viridis: ['#440154', '#482878', '#3E4989', '#31688E', '#26828E', '#1F9E89', '#35B779', '#6CCE59', '#B4DD2C', '#FDE725'],
  inferno: ['#000004', '#1B0C41', '#4A0C6B', '#781C6D', '#A52C60', '#CF4446', '#ED6925', '#FB9A06', '#F7D03C', '#FCFFA4'],
  magma: ['#000004', '#180F3D', '#440F76', '#721F81', '#9E2F7F', '#CD4071', '#F1605D', '#FE9F6D', '#FEC589', '#FCFDBF'],
  plasma: ['#0D0887', '#41049D', '#6A00A8', '#8F0DA4', '#B12A90', '#CC4778', '#E16462', '#F2844B', '#FCA636', '#FCCE25', '#F0F921'],
  'protestant-catholic': ['#08306B', '#2171B5', '#4292C6', '#6BAED6', '#C6DBEF', '#F7F7F7', '#C7E9C0', '#74C476', '#41AB5D', '#238B45', '#00441B']
};

/** What an area with no figure is filled with: nothing, so the outline alone shows it. */
export const NO_DATA_FILL = 'rgba(0,0,0,0)';

export const LICENCES = {
  ogl: { name: 'Open Government Licence v3.0', short: 'OGL v3.0', url: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/' },
  ccby: { name: 'Creative Commons Attribution 4.0 International', short: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }
};

/**
 * @param {string} a
 * @param {string} b
 * @param {number} t
 */
function lerpHex(a, b, t) {
  const ai = parseInt(a.slice(1), 16);
  const bi = parseInt(b.slice(1), 16);
  /**
   * @param {number} x
   * @param {number} s
   */
  const ch = (x, s) => (x >> s) & 255;
  /** @param {number} s */
  const mix = (s) => Math.round(ch(ai, s) + (ch(bi, s) - ch(ai, s)) * t);
  return `#${((1 << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).slice(1).toUpperCase()}`;
}

/**
 * @param {string} rampName
 * @param {unknown} t  0 to 1
 */
export function rampSample(rampName, t) {
  const stops = RAMPS[rampName] || RAMPS.viridis;
  const x = Math.max(0, Math.min(1, Number(t) || 0)) * (stops.length - 1);
  const i = Math.floor(x);
  if (i >= stops.length - 1) return stops[stops.length - 1];
  return lerpHex(stops[i], stops[i + 1], x - i);
}

/**
 * RFC 4180 enough for these files: quoted cells, doubled quotes, CRLF or LF.
 * @param {unknown} text
 */
export function parseCsv(text) {
  /** @type {string[][]} */
  const records = [];
  /** @type {string[]} */
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) records.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v !== '')) records.push(row);
  const header = records.shift() || [];
  const rows = records.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
  return { header, rows };
}

/** @param {unknown} raw */
export function toNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return NaN;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/** @param {unknown} column */
export function isPercentColumn(column) {
  return /(_pct$|percent|%)/i.test(String(column || ''));
}

/**
 * Round a class break to a figure a reader can take in: 2 significant figures, or whole.
 * @param {number} value
 * @param {number} step
 */
function niceBreak(value, step) {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;
  const mag = 10 ** Math.floor(Math.log10(Math.abs(step || value)));
  const unit = Math.abs(step || value) / mag < 2.5 ? mag / 10 : mag / 2;
  return Number((Math.round(value / unit) * unit).toPrecision(12));
}

/** @param {number[]} values */
function decimalsFor(values) {
  let d = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const s = String(Number(v.toPrecision(12)));
    const dot = s.indexOf('.');
    if (dot >= 0) d = Math.max(d, s.length - dot - 1);
  }
  return Math.min(d, 3);
}

/**
 * @param {unknown} value
 * @param {{ decimals?: number | null, percent?: boolean }} [options]
 */
export function formatNumber(value, { decimals = /** @type {number | null} */ (null), percent = false } = {}) {
  const n = toNumber(value);
  if (!Number.isFinite(n)) return '';
  const opts = decimals === null
    ? (Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: percent ? 1 : 0, maximumFractionDigits: 2 })
    : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  const text = siteNumber(n, opts);
  return percent ? `${text}%` : text;
}

/**
 * A CSV cell for a reader: counts whole, rates to two places, percentages with a %.
 * @param {unknown} column
 * @param {unknown} raw
 */
export function formatCell(column, raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const n = toNumber(raw);
  if (!Number.isFinite(n) || !/^-?\d/.test(String(raw).trim())) return String(raw);
  return formatNumber(n, { percent: isPercentColumn(column) });
}

/** @type {Record<string, string>} */
const COLUMN_LABELS = {
  AllUsualResidents: 'All usual residents',
  AllHouseholds: 'All households',
  PopulationDensity: 'Population density (people per hectare)',
  AverageHouseholdSize: 'Average household size (people)',
  BornInNI: 'Born in Northern Ireland',
  SomeIrish: 'Some knowledge of Irish',
  SomeUlsterScots: 'Some knowledge of Ulster-Scots',
  CatholicBackground: 'Catholic (religion or brought up in)',
  LimitingCondition: 'Day-to-day activities limited by a long-term condition',
  ProvidesUnpaidCare: 'Provides unpaid care',
  NoCar: 'No car or van',
  OwnerOccupied: 'Owner occupied',
  SocialRented: 'Social rented',
  PrivateRented: 'Private rented or rent free',
  NoQuals: 'No qualifications',
  Level4Plus: 'Level 4 qualifications or above',
  WorkFromHome: 'Works mainly at or from home',
  MDM_rank: 'Multiple Deprivation Measure rank (1 = most deprived)',
  MDM_decile: 'Multiple Deprivation Measure decile (1 = most deprived)',
  Income_rank: 'Income domain rank',
  Employment_rank: 'Employment domain rank',
  Age_10_19: 'Aged 10 to 19',
  Median_age: 'Median age (years)',
  Catholic_background: 'Catholic (religion or brought up in)',
  Protestant_background: 'Protestant and other Christian (religion or brought up in)',
  NSSeC_higher: 'Higher socio-economic classes (NS-SeC 1 to 3)',
  pop_1971_persons: 'Population 1971',
  pop_1981_persons: 'Population 1981',
  pop_change_pct: 'Change 1971 to 1981 (%)',
  MDM_score: 'Multiple Deprivation Measure score',
  EDM_score: 'Economic Deprivation Measure score',
  EDM_rank: 'Economic Deprivation Measure rank (1 = most deprived)',
  EDM_decile: 'Economic Deprivation Measure decile (1 = most deprived)',
  LivingEnv_rank: 'Living Environment domain rank',
  LivingEnv_decile: 'Living Environment domain decile',
  HP_rel: 'Relative index score (0 = national average)',
  HP_label: 'Pobal category',
  HP_cat: 'Relative index category (1 = extremely disadvantaged)',
  AgeDep_pct: 'Age dependency (%)',
  LoneParent_pct: 'Lone parents (%)',
  EduPrimaryOnly_pct: 'Primary education only (%)',
  EduThirdLevel_pct: 'Third-level education (%)',
  UnempMale_pct: 'Male unemployment (%)',
  UnempFemale_pct: 'Female unemployment (%)',
  PopChange_pct: 'Population change since the previous census (%)',
  Pobal_match_share: "Share of the area matched to Pobal's ED",
  Pobal_ED_name: "Pobal's name for the ED",
  Pobal_merged: 'Pobal published it merged with a neighbour',
  COUNTY_NAME: 'County',
  ED_NAME: 'Electoral Division',
  SOA_name: 'Super Output Area',
  LGD2014: 'District (2014)',
  LGD1992: 'District (1992)',
  UrbanRural2015: 'Urban or rural (2015)',
  LGD: 'District',
  District: 'District',
  Total: 'Total'
};

/**
 * "SomeIrish_pct" -> "Some knowledge of Irish (%)"; unknown columns are split on case.
 * @param {unknown} column
 */
export function columnLabel(column) {
  const col = String(column || '');
  if (COLUMN_LABELS[col]) return COLUMN_LABELS[col];
  const pct = /_pct$/i.test(col);
  const base = col.replace(/_pct$/i, '');
  const words = COLUMN_LABELS[base] || base
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w, i) => (i && /^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))
    .join(' ');
  return pct ? `${words} (%)` : words;
}

/**
 * The classes a statistic is drawn in. Equal steps across entry.domain (log steps when
 * entry.logarithmic); an integer scale of up to 12 values (a decile) is one class a value.
 * The first and last classes are open: a figure outside the domain falls into them.
 * @param {CensusEntry | null | undefined} entry
 * @returns {OverlayClass[]}
 */
export function overlayClasses(entry) {
  const [lo, hi] = (Array.isArray(entry?.domain) ? entry.domain : [0, 1]).map(Number);
  const ramp = entry?.ramp || 'viridis';
  const percent = isPercentColumn(entry?.valueColumn);
  const span = hi - lo;
  // entry.classLabels names the values of a categorical scale (Pobal's eight HP categories):
  // one class a value, labelled "1 Extremely disadvantaged (below -30)".
  const named = Array.isArray(entry?.classLabels) ? entry.classLabels : null;
  if (Number.isInteger(lo) && Number.isInteger(hi) && span > 0 && span <= 11 && (named || /decile|quintile|band|class/i.test(entry?.valueColumn || ''))) {
    const n = span + 1;
    return Array.from({ length: n }, (_, i) => ({
      min: lo + i - 0.5,
      max: lo + i + 0.5,
      colour: rampSample(ramp, n === 1 ? 0 : i / (n - 1)),
      label: named?.[i] ? `${lo + i} ${named[i]}` : String(lo + i)
    }));
  }
  const n = Math.max(2, Math.min(10, Number(entry?.classCount) || (lo === 0 && hi === 100 ? 10 : 6)));
  const log = Boolean(entry?.logarithmic) && lo > 0 && hi > 0;
  const raw = Array.from({ length: n + 1 }, (_, i) => (log
    ? Math.exp(Math.log(lo) + ((Math.log(hi) - Math.log(lo)) * i) / n)
    : lo + (span * i) / n));
  const edges = raw.map((v, i) => {
    if (i === 0 || i === n) return v;
    const step = log ? v * 0.25 : span / n;
    return niceBreak(v, step);
  });
  const decimals = decimalsFor(edges.slice(1, -1));
  /** @param {number} v */
  const fmt = (v) => formatNumber(v, { decimals, percent });
  return Array.from({ length: n }, (_, i) => {
    const min = i === 0 ? -Infinity : edges[i];
    const max = i === n - 1 ? Infinity : edges[i + 1];
    let label;
    if (i === 0) label = `Under ${fmt(edges[1])}`;
    else if (i === n - 1) label = `${fmt(edges[i])} and over`;
    else label = `${fmt(edges[i])} to under ${fmt(edges[i + 1])}`;
    return { min, max, colour: rampSample(ramp, i / (n - 1)), label };
  });
}

/**
 * @param {OverlayClass[]} classes
 * @param {unknown} value
 */
export function classIndexFor(classes, value) {
  const n = toNumber(value);
  if (!Number.isFinite(n) || !classes.length) return -1;
  for (let i = 0; i < classes.length; i += 1) {
    if (n >= classes[i].min && n < classes[i].max) return i;
  }
  return n < classes[0].min ? 0 : classes.length - 1;
}

/**
 * Join a statistic's rows to its tiles. Returns the tile property to match on and, per row,
 * the tile value it is drawn under. `crosswalk` is the parsed entry.joinCrosswalk, if any.
 * @param {CensusEntry} entry
 * @param {CsvRow[]} rows
 * @param {{ tileKey?: string, map?: { [key: string]: unknown } } | null} [crosswalk]
 */
export function joinRows(entry, rows, crosswalk = null) {
  const csvKey = entry.csvKeyColumn || entry.joinKey;
  const tileKey = crosswalk?.tileKey || entry.joinKey;
  /** @type {Map<string, CsvRow>} */
  const byTileValue = new Map();
  /** @type {string[]} */
  const unmatched = [];
  for (const row of rows) {
    const key = String(row[csvKey] ?? '').trim();
    if (!key) continue;
    const tileValue = crosswalk ? crosswalk.map?.[key] : key;
    if (tileValue === undefined || tileValue === null || tileValue === '') { unmatched.push(key); continue; }
    byTileValue.set(String(tileValue), row);
  }
  return { tileKey, byTileValue, unmatched };
}

/**
 * One MapLibre fill-color expression: the tile's key -> its class colour, else no fill.
 * @param {CensusEntry} entry
 * @param {JoinedRows} joined
 * @param {OverlayClass[]} [classes]
 */
export function fillColorExpression(entry, joined, classes = overlayClasses(entry)) {
  const groups = classes.map(() => /** @type {string[]} */ ([]));
  for (const [tileValue, row] of joined.byTileValue) {
    const i = classIndexFor(classes, row[entry.valueColumn]);
    if (i >= 0) groups[i].push(tileValue);
  }
  const expr = ['match', ['to-string', ['get', joined.tileKey]]];
  classes.forEach((cls, i) => { if (groups[i].length) expr.push(groups[i], cls.colour); });
  if (expr.length === 2) return NO_DATA_FILL;
  expr.push(NO_DATA_FILL);
  return expr;
}

/**
 * How many areas fall in each class, for the legend.
 * @param {CensusEntry} entry
 * @param {JoinedRows} joined
 * @param {OverlayClass[]} [classes]
 */
export function classCounts(entry, joined, classes = overlayClasses(entry)) {
  const counts = classes.map(() => 0);
  for (const row of joined.byTileValue.values()) {
    const i = classIndexFor(classes, row[entry.valueColumn]);
    if (i >= 0) counts[i] += 1;
  }
  return counts;
}

/**
 * The licence a statistic is published under: its own, else its publisher's.
 * @param {CensusEntry | null | undefined} entry
 * @returns {Licence | null}
 */
export function licenceFor(entry) {
  const own = entry?.source?.licence || entry?.licence;
  if (own && typeof own === 'object') return own;
  if (typeof own === 'string') {
    if (/cc[ -]?by|creative commons/i.test(own)) return LICENCES.ccby;
    if (/ogl|open government/i.test(own)) return LICENCES.ogl;
  }
  const text = `${entry?.source?.title || ''} ${entry?.source?.url || ''}`;
  if (/\bCSO\b|Central Statistics Office|cso\.ie/i.test(text)) return LICENCES.ccby;
  if (/NISRA|nisra\.gov\.uk|Registrar General Northern Ireland|Northern Ireland Census/i.test(text)) return LICENCES.ogl;
  return null;
}

/**
 * The figures a feature details pane shows for one area: the mapped value, and where the
 * statistic is a share, its count and the total it is a share of.
 * @param {CensusEntry | null | undefined} entry
 * @param {CsvRow | null | undefined} row
 */
export function statisticFor(entry, row) {
  if (!entry || !row) return null;
  const valueColumn = entry.valueColumn;
  const value = toNumber(row[valueColumn]);
  const percent = isPercentColumn(valueColumn);
  const denominator = entry.denominator || null;
  const numeratorColumn = entry.numeratorColumn
    || (percent && valueColumn.replace(/_pct$/i, '') in row ? valueColumn.replace(/_pct$/i, '') : null);
  const denominatorValue = denominator?.column ? toNumber(row[denominator.column]) : NaN;
  const numeratorValue = numeratorColumn ? toNumber(row[numeratorColumn]) : NaN;
  const skip = new Set(['Geography', 'GeographyCode', entry.csvKeyColumn || entry.joinKey, entry.joinKey, valueColumn, numeratorColumn, denominator?.column].filter(Boolean));
  const other = (entry.tableColumns || [])
    .filter((c) => !skip.has(c) && row[c] !== undefined && row[c] !== '')
    .map((c) => ({ column: c, label: columnLabel(c), text: formatCell(c, row[c]) }));
  let summary = '';
  if (Number.isFinite(numeratorValue) && Number.isFinite(denominatorValue)) {
    // A finite denominatorValue means denominator.column was read.
    summary = `${formatNumber(numeratorValue)} of ${formatNumber(denominatorValue)} ${/** @type {{ label?: string }} */ (denominator).label || ''}`.trim();
  } else if (Number.isFinite(denominatorValue)) {
    summary = `of ${formatNumber(denominatorValue)} ${/** @type {{ label?: string }} */ (denominator).label || ''}`.trim();
  } else if (denominator?.label && percent) {
    summary = `of ${denominator.label}`;
  }
  return {
    entryId: entry.id,
    // A table with no Geography column names its area in entry.areaNameColumn (SOA_name, ED_NAME).
    areaName: String(row.Geography ?? (entry.areaNameColumn ? row[entry.areaNameColumn] : '') ?? '').trim(),
    valueColumn,
    valueLabel: entry.valueLabel || columnLabel(valueColumn),
    value: Number.isFinite(value) ? value : null,
    valueText: formatCell(valueColumn, row[valueColumn]),
    numeratorLabel: numeratorColumn ? columnLabel(numeratorColumn) : null,
    numeratorText: Number.isFinite(numeratorValue) ? formatNumber(numeratorValue) : null,
    denominatorLabel: denominator?.label || null,
    denominatorText: Number.isFinite(denominatorValue) ? formatNumber(denominatorValue) : null,
    summary,
    other
  };
}

/**
 * The runtime layer a statistic is drawn as: its geography's tiles under the statistic's own id.
 * @param {CensusEntry} entry
 * @param {import('../packages/types/index.js').LayerEntry} geographyLayer
 */
export function overlayRuntimeLayer(entry, geographyLayer) {
  return {
    ...geographyLayer,
    id: `${entry.id}-census-overlay`,
    sourceMapId: entry.id,
    name: entry.name,
    description: entry.description,
    category: entry.category || geographyLayer.category,
    loadable: true,
    censusOverlay: entry,
    geographyId: entry.geography,
    style: { ...(geographyLayer.style || {}), color: '#374151', weight: 0.6, fillColor: '#9CA3AF', fillOpacity: 0.8 },
    // Districts, wards and towns keep their names. Thousands of Small Areas, Data Zones and
    // Super Data Zones are labelled by code ("N00001508") or by a zone name, which buries the
    // colours a reader came for; their names are in the details on a click.
    labelProperty: UNLABELLED_GEOGRAPHIES.has(entry.geography) ? null : geographyLayer.labelProperty,
    duplicateFeatureIds: geographyLayer.duplicateFeatureIds
  };
}

const UNLABELLED_GEOGRAPHIES = new Set(['sa-2011', 'dz-2021', 'sdz-2021', 'oa-2001', 'soa-2011']);

export const OVERLAY_FILL_OPACITY = 0.8;
