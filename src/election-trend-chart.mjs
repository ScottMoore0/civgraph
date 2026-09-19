/**
 * Election trends chart: party vote share over time, drawn the way a newsroom would.
 *
 * The election manager owns the DATA -- which elections are comparable, which rows belong to
 * the selected constituency, what colour a party is -- and hands this module a flat list of
 * points. Everything from there is presentation: a multi-series line chart on a real time axis
 * with thin lines, a faint horizontal grid, year labels that are never rotated, direct labels
 * at the end of each line carrying the latest share, a crosshair with a tooltip at the nearest
 * election, and one-tap party focus that fades everything else.
 *
 * The pure builders (`buildTrendChartModel`, `layoutTrendChart`, `renderTrendChartSvg`) have no
 * DOM dependency so they can be exercised in Node. `mountTrendChart` is the browser half.
 *
 * Gaps are real. A party with no comparable result at an election gets a break in its line,
 * not a segment drawn across the hole; the data model is the manager's and is not merged here.
 */

const SERIES_LIMIT = 8;
const LINE_WIDTH = 2.25;
const LABEL_FONT_SIZE = 12;
const AXIS_FONT_SIZE = 11.5;
const LABEL_GAP = 14;          // Minimum vertical distance between two direct labels.
const MIN_COLUMN_GAP = 7;      // Minimum horizontal distance between two election columns.
const MIN_TICK_SPACING = 58;   // Minimum horizontal distance between two year labels.
const YEAR_STEPS = [1, 2, 5, 10, 20, 25, 50, 100];

/* ------------------------------------------------------------------------------------------ */
/* Model                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/**
 * Turn the manager's flat point list into ordered elections and ranked series.
 *
 * @param {Array<{party:string, share:number, colour:string, entry:object}>} points
 * @param {{ seriesLimit?: number, abbreviate?: (party:string)=>string, bodyLabel?: (entry:object)=>string }} [options]
 */
export function buildTrendChartModel(points = [], options = {}) {
  const seriesLimit = Math.max(1, Number(options.seriesLimit) || SERIES_LIMIT);
  const abbreviate = typeof options.abbreviate === 'function' ? options.abbreviate : (party) => party;
  const bodyLabel = typeof options.bodyLabel === 'function' ? options.bodyLabel : (entry) => String(entry?.body || '');

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
    const series = byParty.get(partyKey);
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
 * @param {{ width:number, height?:number, measureText?:(text:string, bold?:boolean)=>number, directLabels?:boolean }} options
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
  const labelTextFor = (item, mode) => {
    const value = formatShare(item.latestShare);
    if (mode === 'full') return { name: item.party, value };
    if (mode === 'abbr') return { name: item.abbreviation, value };
    return { name: '', value };
  };
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
  const plot = {
    left: pad.left,
    right: width - pad.right,
    top: pad.top,
    bottom: height - pad.bottom
  };
  plot.width = Math.max(40, plot.right - plot.left);
  plot.height = Math.max(40, plot.bottom - plot.top);

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
    columns = elections.map((election, index) => plot.left + (index / (elections.length - 1)) * plot.width);
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
    const segments = [];
    let current = null;
    const isolated = [];
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
  const labels = [];
  if (labelMode !== 'none') {
    const groups = new Map();
    for (const item of seriesLayout) {
      if (!item.last) continue;
      const anchorX = Math.round(item.last.x);
      if (!groups.has(anchorX)) groups.set(anchorX, []);
      const source = seriesByKey.get(item.key);
      const text = labelTextFor(source, labelMode);
      const textWidth = labelWidthFor(source, labelMode);
      groups.get(anchorX).push({
        key: item.key,
        colour: item.colour,
        name: text.name,
        value: text.value,
        width: textWidth,
        pointX: item.last.x,
        pointY: item.last.y,
        y: item.last.y
      });
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

/* ------------------------------------------------------------------------------------------ */
/* Browser mount                                                                              */
/* ------------------------------------------------------------------------------------------ */

/**
 * Render the chart into `container` and wire up the interactions. Returns a controller with
 * `destroy()`; mounting again into the same container destroys the previous instance.
 *
 * @param {HTMLElement} container
 * @param {ReturnType<typeof buildTrendChartModel>} model
 * @param {{ ariaLabel?:string, footnotes?:string, formatDate?:(date:string)=>string, height?:number }} [options]
 */
export function mountTrendChart(container, model, options = {}) {
  if (!container) return null;
  container.__trendChart?.destroy();

  const doc = container.ownerDocument;
  const root = doc.createElement('div');
  root.className = 'trend-chart';
  root.innerHTML = `
    <div class="test2-election-trends__legend" role="group" aria-label="Parties shown">${legendMarkup(model)}</div>
    <div class="trend-chart__stage"></div>
    <div class="trend-tooltip" role="tooltip" hidden></div>
    ${options.footnotes || ''}
  `;
  container.replaceChildren(root);

  const stage = root.querySelector('.trend-chart__stage');
  const tooltip = root.querySelector('.trend-tooltip');
  const legend = root.querySelector('.test2-election-trends__legend');
  const measureText = createTextMeasurer(root);
  const formatDate = typeof options.formatDate === 'function' ? options.formatDate : (value) => value;
  const seriesByKey = new Map(model.series.map((item) => [item.key, item]));

  const state = {
    layout: null,
    svg: null,
    width: 0,
    lockedParty: null,
    hoverParty: null,
    column: -1,
    pinned: false,
    destroyed: false
  };

  const effectiveFocus = () => state.hoverParty || state.lockedParty;

  const applyFocus = () => {
    const focus = effectiveFocus();
    if (focus) root.setAttribute('data-trend-focus', focus);
    else root.removeAttribute('data-trend-focus');
    root.querySelectorAll('[data-party]').forEach((node) => {
      node.classList.toggle('is-focused', Boolean(focus) && node.getAttribute('data-party') === focus);
    });
    legend.querySelectorAll('[data-party]').forEach((button) => {
      button.setAttribute('aria-pressed', state.lockedParty === button.getAttribute('data-party') ? 'true' : 'false');
    });
  };

  const setColumn = (index) => {
    const layout = state.layout;
    if (!layout || !state.svg) return;
    const next = Number.isInteger(index) && index >= 0 && index < layout.columns.length ? index : -1;
    state.column = next;
    const crosshair = state.svg.querySelector('.trend-crosshair');
    state.svg.querySelectorAll('.trend-marker.is-active').forEach((node) => node.classList.remove('is-active'));
    if (next < 0) {
      crosshair.classList.remove('is-active');
      tooltip.hidden = true;
      root.classList.remove('is-hovering');
      return;
    }
    const x = layout.columns[next].toFixed(1);
    crosshair.setAttribute('x1', x);
    crosshair.setAttribute('x2', x);
    crosshair.classList.add('is-active');
    state.svg.querySelectorAll(`.trend-marker[data-election-index="${next}"]`).forEach((node) => node.classList.add('is-active'));
    root.classList.add('is-hovering');
    renderTooltip(next);
  };

  const renderTooltip = (index) => {
    const election = model.elections[index];
    if (!election) {
      tooltip.hidden = true;
      return;
    }
    const rows = model.series
      .map((item) => ({ item, value: item.values[index] }))
      .filter((row) => row.value)
      .sort((a, b) => b.value.share - a.value.share);
    const focus = effectiveFocus();
    tooltip.innerHTML = `
      <div class="trend-tooltip__title">${escapeHtml(formatDate(election.date))}</div>
      ${election.body ? `<div class="trend-tooltip__subtitle">${escapeHtml(election.body)}</div>` : ''}
      <table class="trend-tooltip__table"><tbody>
        ${rows.map((row) => `
          <tr class="${focus === row.item.key ? 'is-focused' : ''}">
            <td><span class="trend-tooltip__swatch" style="background:${escapeHtml(row.item.colour)}"></span>${escapeHtml(row.item.party)}</td>
            <td class="trend-tooltip__value">${formatShare(row.value.share)}</td>
          </tr>`).join('')}
      </tbody></table>
    `;
    tooltip.hidden = false;
    positionTooltip(index);
  };

  const positionTooltip = (index) => {
    const layout = state.layout;
    if (!layout) return;
    const rootRect = root.getBoundingClientRect();
    const svgRect = state.svg.getBoundingClientRect();
    const scale = svgRect.width / layout.width || 1;
    const columnX = (svgRect.left - rootRect.left) + layout.columns[index] * scale;
    const tipWidth = tooltip.offsetWidth;
    const tipHeight = tooltip.offsetHeight;
    let left = columnX + 12;
    if (left + tipWidth > rootRect.width - 4) left = columnX - tipWidth - 12;
    if (left < 4) left = 4;
    let top = (svgRect.top - rootRect.top) + layout.plot.top * scale;
    top = Math.max(0, Math.min(top, rootRect.height - tipHeight));
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  };

  const nearestColumn = (clientX) => {
    const layout = state.layout;
    if (!layout || !layout.columns.length) return -1;
    const rect = state.svg.getBoundingClientRect();
    const scale = rect.width / layout.width || 1;
    const x = (clientX - rect.left) / scale;
    let best = -1;
    let bestDistance = Infinity;
    layout.columns.forEach((column, index) => {
      const distance = Math.abs(column - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  };

  const partyFromEvent = (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-party]') : null;
    return target ? target.getAttribute('data-party') : null;
  };

  const togglePartyLock = (party) => {
    if (!party || !seriesByKey.has(party)) return;
    state.lockedParty = state.lockedParty === party ? null : party;
    state.hoverParty = null;
    applyFocus();
    if (state.column >= 0) renderTooltip(state.column);
  };

  const onPointerMove = (event) => {
    if (event.pointerType === 'touch') return;
    state.hoverParty = partyFromEvent(event);
    applyFocus();
    setColumn(nearestColumn(event.clientX));
  };

  const onPointerLeave = () => {
    state.hoverParty = null;
    applyFocus();
    if (!state.pinned) setColumn(-1);
  };

  const onPointerDown = (event) => {
    if (event.pointerType !== 'touch') return;
    state.pinned = true;
    setColumn(nearestColumn(event.clientX));
  };

  const onClick = (event) => {
    const party = partyFromEvent(event);
    if (party) {
      togglePartyLock(party);
    } else if (state.lockedParty) {
      // A click on empty chart space releases the focused party.
      togglePartyLock(state.lockedParty);
    }
  };

  // A touch outside the chart releases a pinned crosshair.
  const onDocumentPointerDown = (event) => {
    if (!state.pinned || event.pointerType !== 'touch') return;
    if (event.target instanceof Node && root.contains(event.target)) return;
    state.pinned = false;
    setColumn(-1);
  };

  const onKeyDown = (event) => {
    const count = state.layout?.columns.length || 0;
    if (!count) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const next = state.column < 0 ? (delta > 0 ? 0 : count - 1) : Math.min(count - 1, Math.max(0, state.column + delta));
      state.pinned = true;
      setColumn(next);
    } else if (event.key === 'Escape') {
      state.pinned = false;
      state.lockedParty = null;
      applyFocus();
      setColumn(-1);
    }
  };

  const onLegendClick = (event) => {
    const button = event.target instanceof Element ? event.target.closest('button[data-party]') : null;
    if (button) togglePartyLock(button.getAttribute('data-party'));
  };
  const onLegendPointerOver = (event) => {
    if (event.pointerType === 'touch') return;
    const button = event.target instanceof Element ? event.target.closest('button[data-party]') : null;
    state.hoverParty = button ? button.getAttribute('data-party') : null;
    applyFocus();
  };
  const onLegendPointerOut = () => {
    state.hoverParty = null;
    applyFocus();
  };

  const render = () => {
    if (state.destroyed) return;
    const width = Math.round(stage.clientWidth || container.clientWidth || 640);
    const height = typeof options.height === 'function' ? options.height(width) : options.height;
    if (width === state.width && height === state.height && state.svg) return;
    state.width = width;
    state.height = height;
    state.layout = layoutTrendChart(model, { width, height, measureText });
    stage.innerHTML = renderTrendChartSvg(model, state.layout, { ariaLabel: options.ariaLabel });
    state.svg = stage.querySelector('svg');
    state.svg.addEventListener('pointermove', onPointerMove);
    state.svg.addEventListener('pointerleave', onPointerLeave);
    state.svg.addEventListener('pointerdown', onPointerDown);
    state.svg.addEventListener('click', onClick);
    state.svg.addEventListener('keydown', onKeyDown);
    applyFocus();
    const column = state.column;
    state.column = -1;
    if (column >= 0 && state.pinned) setColumn(column);
    else tooltip.hidden = true;
  };

  legend.addEventListener('click', onLegendClick);
  legend.addEventListener('pointerover', onLegendPointerOver);
  legend.addEventListener('pointerout', onLegendPointerOut);
  doc.addEventListener('pointerdown', onDocumentPointerDown, true);

  let observer = null;
  let frame = 0;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        render();
      });
    });
    observer.observe(stage);
    if (options.fitTo instanceof Element) observer.observe(options.fitTo);
  }
  render();

  const controller = {
    render,
    focus(party) {
      state.lockedParty = party && seriesByKey.has(party) ? party : null;
      applyFocus();
    },
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      legend.removeEventListener('click', onLegendClick);
      legend.removeEventListener('pointerover', onLegendPointerOver);
      legend.removeEventListener('pointerout', onLegendPointerOut);
      doc.removeEventListener('pointerdown', onDocumentPointerDown, true);
      if (container.__trendChart === controller) delete container.__trendChart;
    }
  };
  container.__trendChart = controller;
  return controller;
}

function legendMarkup(model) {
  return model.series.map((item) => (
    `<button type="button" class="test2-election-trends__legend-item" data-party="${escapeHtml(item.key)}" aria-pressed="false" title="${escapeHtml(`Focus ${item.party}`)}">`
    + `<span class="test2-election-trends__legend-swatch" style="background:${escapeHtml(item.colour)}"></span>`
    + `<span class="test2-election-trends__legend-name">${escapeHtml(item.party)}</span>`
    + '</button>'
  )).join('');
}

function createTextMeasurer(root) {
  try {
    const canvas = root.ownerDocument.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return estimateTextWidth;
    const family = getComputedStyle(root).fontFamily || 'sans-serif';
    return (text, bold = false, size = LABEL_FONT_SIZE) => {
      context.font = `${bold ? '600' : '400'} ${size}px ${family}`;
      return context.measureText(String(text)).width;
    };
  } catch {
    return estimateTextWidth;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Helpers                                                                                    */
/* ------------------------------------------------------------------------------------------ */

export function formatShare(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)}%` : '';
}

function estimateTextWidth(text, bold = false, size = LABEL_FONT_SIZE) {
  return String(text).length * size * (bold ? 0.6 : 0.55);
}

function parseDateUtc(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function finiteOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[-_/.,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
