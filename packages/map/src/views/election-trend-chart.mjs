/**
 * Election trends chart, the pure half: party vote share over time, drawn the way a newsroom would.
 *
 * The election manager owns the DATA -- which elections are comparable, which rows belong to
 * the selected constituency, what colour a party is -- and hands this module a flat list of
 * points. Everything from there is presentation: a multi-series line chart on a real time axis
 * with thin lines, a faint horizontal grid, year labels that are never rotated, direct labels
 * at the end of each line carrying the latest share.
 *
 * The builders here (`buildTrendChartModel`, `layoutTrendChart`, `renderTrendChartSvg`) have no
 * DOM dependency, so they run in Node and in the design system's gallery (packages/ui/src/gallery,
 * sample data in ./specimens.mjs). `mountTrendChart`, the browser half (the crosshair, tooltip and
 * party focus), is packages/map/src/election-trend-chart.mjs, which re-exports this module (moved
 * here by rf10-gallery, 13 Nov 2026, unchanged).
 *
 * Gaps are real. A party with no comparable result at an election gets a break in its line,
 * not a segment drawn across the hole; the data model is the manager's and is not merged here.
 */
import { normalizeName } from '../../../core/src/election-domain.mjs';
import { escapeHtml } from '../../../core/src/html.js';

const SERIES_LIMIT = 8;
/** The direct labels' font size, px (the browser half measures them in it). */
export const LABEL_FONT_SIZE = 12;
const AXIS_FONT_SIZE = 11.5;
const LABEL_GAP = 14;          // Minimum vertical distance between two direct labels.
const MIN_COLUMN_GAP = 7;      // Minimum horizontal distance between two election columns.
const MIN_TICK_SPACING = 58;   // Minimum horizontal distance between two year labels.
const YEAR_STEPS = [1, 2, 5, 10, 20, 25, 50, 100];

/**
 * The election a point belongs to, as the manager passes it (a manifest entry or bundle).
 * @typedef {{ [field: string]: unknown, key?: string, body?: string, date?: string }} TrendEntry
 */
/**
 * One party's figures at one election: the manager's flat list is made of these.
 * @typedef {{ party: string, share: number, votes?: number, seats?: number, colour: string, entry?: TrendEntry | null }} TrendPoint
 */
/** @typedef {{ key: string, entry: TrendEntry, date: string, time: number, year: string, body: string }} TrendElection */
/** @typedef {{ share: number, votes: number, seats: number }} TrendValue */
/**
 * A party's line: its value at each election (null where it has none), ranked by the model.
 * @typedef {{
 *   key: string,
 *   party: string,
 *   abbreviation: string,
 *   colour: string,
 *   values: Array<TrendValue | null>,
 *   maxShare: number,
 *   latestShare: number,
 *   latestIndex: number
 * }} TrendSeries
 */
/** @typedef {ReturnType<typeof buildTrendChartModel>} TrendModel */
/** @typedef {ReturnType<typeof layoutTrendChart>} TrendLayout */
/** @typedef {{ x: number, y: number }} TrendXY */
/**
 * A direct label at the end of a line: where its point is, and where the label went.
 * @typedef {{
 *   key: string,
 *   colour: string,
 *   name: string,
 *   value: string,
 *   width: number,
 *   pointX: number,
 *   pointY: number,
 *   x: number,
 *   y: number,
 *   leader: boolean
 * }} TrendLabel
 */
/** @typedef {(text: string, bold?: boolean, size?: number) => number} MeasureText */

/* ------------------------------------------------------------------------------------------ */
/* Model                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/**
 * Turn the manager's flat point list into ordered elections and ranked series.
 *
 * @param {TrendPoint[]} [points]
 * @param {{ seriesLimit?: number, abbreviate?: (party:string)=>string, bodyLabel?: (entry: TrendEntry)=>string }} [options]
 */
export function buildTrendChartModel(points = [], options = {}) {
  const seriesLimit = Math.max(1, Number(options.seriesLimit) || SERIES_LIMIT);
  const abbreviate = typeof options.abbreviate === 'function' ? options.abbreviate : (/** @type {string} */ party) => party;
  const bodyLabel = typeof options.bodyLabel === 'function' ? options.bodyLabel : (/** @type {TrendEntry} */ entry) => String(entry?.body || '');

  /** @type {Map<string, TrendElection>} */
  const electionByKey = new Map();
  for (const point of points) {
    const entry = point?.entry || {};
    const key = entry.key || `${entry.body}|${entry.date}`;
    if (!electionByKey.has(key)) {
      electionByKey.set(key, {
        key,
        entry,
        date: String(entry.date || ''),
        time: parseDateUtc(entry.date),
        year: String(entry.date || '').slice(0, 4),
        body: bodyLabel(entry)
      });
    }
  }
  const elections = [...electionByKey.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.body.localeCompare(b.body));
  const indexByKey = new Map(elections.map((election, index) => [election.key, index]));

  /** @type {Map<string, TrendSeries>} */
  const byParty = new Map();
  for (const point of points) {
    const entry = point?.entry || {};
    const electionKey = entry.key || `${entry.body}|${entry.date}`;
    const index = indexByKey.get(electionKey);
    if (index === undefined) continue;
    const partyKey = normalizeName(point.party);
    if (!partyKey) continue;
    if (!byParty.has(partyKey)) {
      byParty.set(partyKey, {
        key: partyKey,
        party: String(point.party || ''),
        abbreviation: abbreviate(point.party) || String(point.party || ''),
        colour: point.colour,
        values: new Array(elections.length).fill(null),
        maxShare: 0,
        latestShare: 0,
        latestIndex: -1
      });
    }
    const series = /** @type {TrendSeries} */ (byParty.get(partyKey));
    const share = finiteOrZero(point.share);
    series.values[index] = { share, votes: finiteOrZero(point.votes), seats: finiteOrZero(point.seats) };
    series.maxShare = Math.max(series.maxShare, share);
    if (index >= series.latestIndex) {
      series.latestIndex = index;
      series.latestShare = share;
    }
  }

  // Ranking: parties standing at the most recent election first, by their share there, so
  // the chart reads as a tracker of the parties a reader knows; then everything else by its
  // peak, so a party that mattered once still earns a line when there is room.
  const lastIndex = elections.length - 1;
  /** @param {TrendSeries} item */
  const currentShare = (item) => (lastIndex >= 0 && item.values[lastIndex] ? item.values[lastIndex].share : -1);
  const series = [...byParty.values()]
    .sort((a, b) => currentShare(b) - currentShare(a) || b.maxShare - a.maxShare || a.party.localeCompare(b.party))
    .slice(0, seriesLimit);

  // Two parties that abbreviate the same way ("Independent" and "Non party/Independent" are
  // both "Ind") keep their full names, otherwise a short label would point at the wrong line.
  const abbreviationCounts = new Map();
  for (const item of series) abbreviationCounts.set(item.abbreviation, (abbreviationCounts.get(item.abbreviation) || 0) + 1);
  for (const item of series) {
    if (abbreviationCounts.get(item.abbreviation) > 1) item.abbreviation = item.party;
  }

  return { elections, series, totalSeries: byParty.size };
}

/* ------------------------------------------------------------------------------------------ */
/* Layout                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/**
 * Compute every coordinate the renderer needs for a given pixel width.
 *
 * @param {ReturnType<typeof buildTrendChartModel>} model
 * @param {{ width?:number, height?:number, measureText?:(text:string, bold?:boolean, size?:number)=>number, directLabels?:boolean }} [options]
 */
export function layoutTrendChart(model, options = {}) {
  const width = Math.max(240, Math.round(Number(options.width) || 640));
  const narrow = width < 560;
  const height = Math.round(Number(options.height) || (narrow ? 216 : 256));
  const measure = typeof options.measureText === 'function' ? options.measureText : estimateTextWidth;
  const { elections, series } = model;

  // Y scale: share of the vote, from zero to a round number at or just above the highest point.
  const maxShare = series.reduce((max, item) => item.values.reduce((inner, value) => (value ? Math.max(inner, value.share) : inner), max), 0);
  const yStep = maxShare <= 25 ? 5 : maxShare <= 60 ? 10 : 20;
  const yMax = Math.min(100, Math.max(yStep * 2, Math.ceil(maxShare / yStep) * yStep));
  const yTicks = [];
  for (let value = 0; value <= yMax; value += yStep) yTicks.push(value);
  const yLabelWidth = Math.max(...yTicks.map((value) => measure(`${value}%`, false, AXIS_FONT_SIZE)));

  // Direct labels: the fullest form that fits in a modest share of the width, else shorter.
  const seriesByKey = new Map(series.map((item) => [item.key, item]));
  /**
   * @param {TrendSeries} item
   * @param {string} mode  'full', 'abbr' or 'value'
   */
  const labelTextFor = (item, mode) => {
    const value = formatShare(item.latestShare);
    if (mode === 'full') return { name: item.party, value };
    if (mode === 'abbr') return { name: item.abbreviation, value };
    return { name: '', value };
  };
  /**
   * @param {TrendSeries} item
   * @param {string} mode
   */
  const labelWidthFor = (item, mode) => {
    const text = labelTextFor(item, mode);
    return (text.name ? measure(`${text.name} `, false, LABEL_FONT_SIZE) : 0) + measure(text.value, true, LABEL_FONT_SIZE);
  };
  let labelMode = 'none';
  let labelWidth = 0;
  if (options.directLabels !== false && !narrow && series.length) {
    const modes = width >= 760 ? ['full', 'abbr', 'value'] : ['abbr', 'value'];
    for (const mode of modes) {
      labelMode = mode;
      labelWidth = Math.max(...series.map((item) => labelWidthFor(item, mode)));
      if (labelWidth <= width * 0.28) break;
    }
  }

  const pad = {
    top: 12,
    right: labelMode === 'none' ? 14 : Math.ceil(labelWidth) + 14,
    bottom: 26,
    left: Math.ceil(yLabelWidth) + 10
  };
  // width and height are set just below.
  const plot = /** @type {{ left: number, right: number, top: number, bottom: number, width: number, height: number }} */ ({
    left: pad.left,
    right: width - pad.right,
    top: pad.top,
    bottom: height - pad.bottom
  });
  plot.width = Math.max(40, plot.right - plot.left);
  plot.height = Math.max(40, plot.bottom - plot.top);

  /** @param {unknown} share */
  const yFor = (share) => plot.bottom - (finiteOrZero(share) / yMax) * plot.height;

  // X scale: real time, then nudged so no two elections share a pixel column.
  const times = elections.map((election) => election.time);
  const timed = times.length > 0 && times.every((time) => Number.isFinite(time));
  const minTime = timed ? Math.min(...times) : 0;
  const maxTime = timed ? Math.max(...times) : 0;
  const span = maxTime - minTime;
  let columns;
  if (elections.length <= 1) {
    columns = elections.map(() => plot.left + plot.width / 2);
  } else if (timed && span > 0) {
    columns = times.map((time) => plot.left + ((time - minTime) / span) * plot.width);
  } else {
    columns = elections.map((_election, index) => plot.left + (index / (elections.length - 1)) * plot.width);
  }
  for (let index = 1; index < columns.length; index += 1) {
    columns[index] = Math.max(columns[index], columns[index - 1] + MIN_COLUMN_GAP);
  }
  const overshoot = columns.length ? columns[columns.length - 1] - plot.right : 0;
  if (overshoot > 0 && columns.length > 1) {
    const scale = plot.width / (plot.width + overshoot);
    for (let index = 0; index < columns.length; index += 1) {
      columns[index] = plot.left + (columns[index] - plot.left) * scale;
    }
  }

  // Piecewise-linear map from a moment in time to a pixel column, through the election anchors.
  /** @param {number} time */
  const xForTime = (time) => {
    if (!timed || !columns.length) return plot.left;
    if (columns.length === 1) return columns[0];
    if (time <= times[0]) return columns[0] - ((times[0] - time) / span) * plot.width;
    for (let index = 1; index < times.length; index += 1) {
      if (time <= times[index]) {
        const gap = times[index] - times[index - 1];
        const ratio = gap > 0 ? (time - times[index - 1]) / gap : 1;
        return columns[index - 1] + (columns[index] - columns[index - 1]) * ratio;
      }
    }
    return columns[columns.length - 1] + ((time - times[times.length - 1]) / span) * plot.width;
  };

  const xTicks = [];
  if (timed && elections.length > 1 && span > 0) {
    const minYear = new Date(minTime).getUTCFullYear();
    const maxYear = new Date(maxTime).getUTCFullYear();
    const spanYears = Math.max(1, maxYear - minYear);
    const step = YEAR_STEPS.find((candidate) => (plot.width / (spanYears / candidate)) >= MIN_TICK_SPACING) || YEAR_STEPS[YEAR_STEPS.length - 1];
    for (let year = Math.ceil(minYear / step) * step; year <= maxYear; year += step) {
      const x = xForTime(Date.UTC(year, 0, 1));
      if (x < plot.left - 0.5 || x > plot.right + 0.5) continue;
      xTicks.push({ year, x });
    }
    if (!xTicks.length) {
      xTicks.push({ year: minYear, x: columns[0] }, { year: maxYear, x: columns[columns.length - 1] });
    }
  } else {
    elections.forEach((election, index) => {
      if (election.year) xTicks.push({ year: Number(election.year), x: columns[index] });
    });
  }

  // Series geometry: segments broken at every missing election, isolated points, label anchors.
  const seriesLayout = series.map((item) => {
    /** @type {TrendXY[][]} */
    const segments = [];
    /** @type {TrendXY[] | null} */
    let current = null;
    /** @type {Array<TrendXY & { index: number }>} */
    const isolated = [];
    /** @type {Array<TrendXY & { index: number, share: number }>} */
    const markers = [];
    item.values.forEach((value, index) => {
      if (!value) {
        current = null;
        return;
      }
      const x = columns[index];
      const y = yFor(value.share);
      markers.push({ index, x, y, share: value.share });
      if (!current) {
        current = [];
        segments.push(current);
      }
      current.push({ x, y });
      const previous = item.values[index - 1];
      const next = item.values[index + 1];
      if (!previous && !next) isolated.push({ index, x, y });
    });
    // A faint dotted bridge across each gap keeps the series legible without claiming a value
    // for the elections the party has no comparable result at.
    const bridges = [];
    for (let index = 1; index < segments.length; index += 1) {
      const from = segments[index - 1][segments[index - 1].length - 1];
      const to = segments[index][0];
      bridges.push({ from, to });
    }
    const last = markers.length ? markers[markers.length - 1] : null;
    return {
      bridges,
      key: item.key,
      party: item.party,
      abbreviation: item.abbreviation,
      colour: item.colour,
      latestShare: item.latestShare,
      latestIndex: item.latestIndex,
      segments,
      isolated,
      markers,
      last
    };
  });

  // Direct labels sit at the end of each line, pushed apart so they never overlap, with a
  // short leader whenever one had to move away from its point.
  /** @type {TrendLabel[]} */
  const labels = [];
  if (labelMode !== 'none') {
    /** @type {Map<number, TrendLabel[]>} */
    const groups = new Map();
    for (const item of seriesLayout) {
      if (!item.last) continue;
      const anchorX = Math.round(item.last.x);
      if (!groups.has(anchorX)) groups.set(anchorX, []);
      const source = /** @type {TrendSeries} */ (seriesByKey.get(item.key));
      const text = labelTextFor(source, labelMode);
      const textWidth = labelWidthFor(source, labelMode);
      // x and leader are set once the group is spread out, below.
      /** @type {TrendLabel[]} */ (groups.get(anchorX)).push(/** @type {TrendLabel} */ ({
        key: item.key,
        colour: item.colour,
        name: text.name,
        value: text.value,
        width: textWidth,
        pointX: item.last.x,
        pointY: item.last.y,
        y: item.last.y
      }));
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.pointY - b.pointY);
      const top = plot.top + LABEL_FONT_SIZE / 2;
      const bottom = plot.bottom + 4;
      for (let index = 0; index < group.length; index += 1) {
        const floor = index === 0 ? top : group[index - 1].y + LABEL_GAP;
        group[index].y = Math.max(group[index].y, floor);
      }
      for (let index = group.length - 1; index >= 0; index -= 1) {
        const ceiling = index === group.length - 1 ? bottom : group[index + 1].y - LABEL_GAP;
        group[index].y = Math.min(group[index].y, ceiling);
      }
      for (let index = 1; index < group.length; index += 1) {
        group[index].y = Math.max(group[index].y, group[index - 1].y + LABEL_GAP);
      }
      for (const label of group) {
        label.x = Math.min(label.pointX + 8, width - label.width - 2);
        label.leader = Math.abs(label.y - label.pointY) > 5;
        labels.push(label);
      }
    }
  }

  return {
    width,
    height,
    narrow,
    pad,
    plot,
    yMax,
    yTicks,
    yFor,
    columns,
    xTicks,
    labelMode,
    series: seriesLayout,
    labels
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Markup                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/**
 * SVG markup for a laid-out chart. Static: interaction state is applied by the mount code.
 * @param {TrendModel} model
 * @param {TrendLayout} layout
 * @param {{ ariaLabel?: string }} [options]
 */
export function renderTrendChartSvg(model, layout, options = {}) {
  const { elections } = model;
  const { width, height, plot } = layout;
  const ariaLabel = escapeHtml(options.ariaLabel || 'Party vote share over time');

  const grid = layout.yTicks.map((value) => {
    const y = layout.yFor(value).toFixed(1);
    const baseline = value === 0 ? ' trend-grid--baseline' : '';
    return `<line class="trend-grid${baseline}" x1="${plot.left}" x2="${plot.right}" y1="${y}" y2="${y}"/>`
      + `<text class="trend-axis trend-axis--y" x="${plot.left - 6}" y="${y}" dy="0.35em" text-anchor="end">${value}%</text>`;
  }).join('');

  const electionTicks = layout.columns.map((x) => (
    `<line class="trend-election-tick" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${plot.bottom}" y2="${plot.bottom + 4}"/>`
  )).join('');

  const xLabels = layout.xTicks.map((tick) => {
    const anchor = tick.x < plot.left + 16 ? 'start' : tick.x > plot.right - 16 ? 'end' : 'middle';
    const x = anchor === 'start' ? Math.max(tick.x - 2, 2) : anchor === 'end' ? Math.min(tick.x + 2, width - 2) : tick.x;
    return `<text class="trend-axis trend-axis--x" x="${x.toFixed(1)}" y="${height - 8}" text-anchor="${anchor}">${tick.year}</text>`;
  }).join('');

  const seriesMarkup = layout.series.map((item) => {
    const colour = escapeHtml(item.colour);
    const path = item.segments
      .map((segment) => segment.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(''))
      .join('');
    const dots = item.isolated.map((point) => (
      `<circle class="trend-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="2.6"/>`
    )).join('');
    const gaps = item.bridges.length
      ? `<path class="trend-gap" d="${item.bridges.map((bridge) => `M${bridge.from.x.toFixed(1)} ${bridge.from.y.toFixed(1)}L${bridge.to.x.toFixed(1)} ${bridge.to.y.toFixed(1)}`).join('')}"/>`
      : '';
    const markers = item.markers.map((marker) => {
      const election = elections[marker.index];
      const title = escapeHtml(`${item.party}: ${formatShare(marker.share)} at ${[election.year, election.body].filter(Boolean).join(' ')}`);
      return `<circle class="trend-marker" data-election-index="${marker.index}" cx="${marker.x.toFixed(1)}" cy="${marker.y.toFixed(1)}" r="3.5"><title>${title}</title></circle>`;
    }).join('');
    return `<g class="trend-series" data-party="${escapeHtml(item.key)}" style="--trend-colour:${colour}">`
      + gaps
      + (path ? `<path class="trend-line" d="${path}"/>` : '')
      + dots
      + (path ? `<path class="trend-hit" d="${path}"/>` : '')
      + markers
      + '</g>';
  }).join('');

  const labels = layout.labels.map((label) => {
    const colour = escapeHtml(label.colour);
    const leader = label.leader
      ? `<line class="trend-label-leader" x1="${(label.pointX + 3).toFixed(1)}" y1="${label.pointY.toFixed(1)}" x2="${(label.x - 3).toFixed(1)}" y2="${label.y.toFixed(1)}"/>`
      : '';
    const name = label.name ? `<tspan class="trend-label__name">${escapeHtml(label.name)} </tspan>` : '';
    return `<g class="trend-label" data-party="${escapeHtml(label.key)}" style="--trend-colour:${colour}">${leader}`
      + `<text x="${label.x.toFixed(1)}" y="${label.y.toFixed(1)}" dy="0.35em">${name}<tspan class="trend-label__value">${escapeHtml(label.value)}</tspan></text>`
      + '</g>';
  }).join('');

  return `<svg class="test2-election-trends__svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${ariaLabel}" tabindex="0">`
    + `<g class="trend-grid-layer">${grid}${electionTicks}</g>`
    + `<line class="trend-crosshair" x1="0" x2="0" y1="${plot.top}" y2="${plot.bottom}"/>`
    + `<g class="trend-series-layer">${seriesMarkup}</g>`
    + `<g class="trend-label-layer">${labels}</g>`
    + `<g class="trend-axis-layer">${xLabels}</g>`
    + '</svg>';
}

/**
 * The chart's key: a button per party, which mountTrendChart wires as the party focus control.
 * @param {TrendModel} model
 */
export function trendLegendHtml(model) {
  return model.series.map((item) => (
    `<button type="button" class="test2-election-trends__legend-item" data-party="${escapeHtml(item.key)}" aria-pressed="false" title="${escapeHtml(`Focus ${item.party}`)}">`
    + `<span class="test2-election-trends__legend-swatch" style="background:${escapeHtml(item.colour)}"></span>`
    + `<span class="test2-election-trends__legend-name">${escapeHtml(item.party)}</span>`
    + '</button>'
  )).join('');
}

/* ------------------------------------------------------------------------------------------ */
/* Helpers                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/** @param {unknown} value */
export function formatShare(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)}%` : '';
}

/**
 * @param {unknown} text
 * @param {boolean} [bold]
 * @param {number} [size]
 */
export function estimateTextWidth(text, bold = false, size = LABEL_FONT_SIZE) {
  return String(text).length * size * (bold ? 0.6 : 0.55);
}

/** @param {unknown} value */
function parseDateUtc(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** @param {unknown} value */
function finiteOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
