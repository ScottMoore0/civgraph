/**
 * Election trends chart, the browser half: `mountTrendChart` draws the chart into the election
 * pane and wires the crosshair with its tooltip at the nearest election and one-tap party focus
 * that fades everything else.
 *
 * The pure builders (`buildTrendChartModel`, `layoutTrendChart`, `renderTrendChartSvg`,
 * `formatShare`) are packages/map/src/views/election-trend-chart.mjs (moved there by rf10-gallery,
 * 13 Nov 2026, so the design system's gallery can draw the chart without importing the map app);
 * this module re-exports them, so its importers are unchanged.
 */
import { escapeHtml } from '../../core/src/html.js';
import { defineFlagFields, present, setHidden } from './state-helpers.mjs';
import { LABEL_FONT_SIZE, estimateTextWidth, formatShare, layoutTrendChart, renderTrendChartSvg } from './views/election-trend-chart.mjs';

export { buildTrendChartModel, formatShare, layoutTrendChart, renderTrendChartSvg } from './views/election-trend-chart.mjs';

// The pure half's types, under the names this module has always given them.
/** @typedef {import('./views/election-trend-chart.mjs').TrendEntry} TrendEntry */
/** @typedef {import('./views/election-trend-chart.mjs').TrendPoint} TrendPoint */
/** @typedef {import('./views/election-trend-chart.mjs').TrendElection} TrendElection */
/** @typedef {import('./views/election-trend-chart.mjs').TrendValue} TrendValue */
/** @typedef {import('./views/election-trend-chart.mjs').TrendSeries} TrendSeries */
/** @typedef {import('./views/election-trend-chart.mjs').TrendModel} TrendModel */
/** @typedef {import('./views/election-trend-chart.mjs').TrendLayout} TrendLayout */
/** @typedef {import('./views/election-trend-chart.mjs').TrendXY} TrendXY */
/** @typedef {import('./views/election-trend-chart.mjs').TrendLabel} TrendLabel */
/** @typedef {import('./views/election-trend-chart.mjs').MeasureText} MeasureText */
/** @typedef {{ render: () => void, focus: (party: string | null) => void, destroy: () => void }} TrendChartController */

/* ------------------------------------------------------------------------------------------ */
/* Browser mount                                                                              */
/* ------------------------------------------------------------------------------------------ */

/**
 * Render the chart into `container` and wire up the interactions. Returns a controller with
 * `destroy()`; mounting again into the same container destroys the previous instance.
 *
 * @param {HTMLElement & { __trendChart?: TrendChartController }} container
 * @param {TrendModel} model
 * @param {{ ariaLabel?:string, footnotes?:string, formatDate?:(date:string)=>string, height?:number | ((width:number)=>number), fitTo?:Element }} [options]
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

  // The stage, tooltip and legend are the markup just above, so they are there.
  const stage = /** @type {HTMLElement} */ (root.querySelector('.trend-chart__stage'));
  const tooltip = /** @type {HTMLElement} */ (root.querySelector('.trend-tooltip'));
  const legend = /** @type {HTMLElement} */ (root.querySelector('.test2-election-trends__legend'));
  const measureText = createTextMeasurer(root);
  const formatDate = typeof options.formatDate === 'function' ? options.formatDate : (/** @type {string} */ value) => value;
  const seriesByKey = new Map(model.series.map((item) => [item.key, item]));

  /**
   * @type {{
   *   layout: TrendLayout | null,
   *   svg: SVGSVGElement | null,
   *   width: number,
   *   height?: number,
   *   lockedParty: string | null,
   *   hoverParty: string | null,
   *   column: number,
   *   destroyed: boolean,
   *   pinned?: boolean
   * }}
   */
  const state = {
    layout: null,
    svg: null,
    width: 0,
    lockedParty: null,
    hoverParty: null,
    column: -1,
    destroyed: false
  };
  // The crosshair pinned by a tap or a click (a flag, MA-L): reads and writes unchanged.
  defineFlagFields(state, ['pinned']);

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

  /** @param {number} index */
  const setColumn = (index) => {
    const layout = state.layout;
    if (!layout || !state.svg) return;
    const next = Number.isInteger(index) && index >= 0 && index < layout.columns.length ? index : -1;
    state.column = next;
    const crosshair = present(state.svg.querySelector('.trend-crosshair'), 'the trend crosshair');
    state.svg.querySelectorAll('.trend-marker.is-active').forEach((node) => node.classList.remove('is-active'));
    if (next < 0) {
      crosshair.classList.remove('is-active');
      setHidden(tooltip, true);
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

  /** @param {number} index */
  const renderTooltip = (index) => {
    const election = model.elections[index];
    if (!election) {
      setHidden(tooltip, true);
      return;
    }
    const rows = model.series
      .map((item) => ({ item, value: item.values[index] }))
      .filter((row) => row.value)
      .sort((a, b) => /** @type {TrendValue} */ (b.value).share - /** @type {TrendValue} */ (a.value).share);
    const focus = effectiveFocus();
    tooltip.innerHTML = `
      <div class="trend-tooltip__title">${escapeHtml(formatDate(election.date))}</div>
      ${election.body ? `<div class="trend-tooltip__subtitle">${escapeHtml(election.body)}</div>` : ''}
      <table class="trend-tooltip__table"><tbody>
        ${rows.map((row) => `
          <tr class="${focus === row.item.key ? 'is-focused' : ''}">
            <td><span class="trend-tooltip__swatch" style="background:${escapeHtml(row.item.colour)}"></span>${escapeHtml(row.item.party)}</td>
            <td class="trend-tooltip__value">${formatShare(/** @type {TrendValue} */ (row.value).share)}</td>
          </tr>`).join('')}
      </tbody></table>
    `;
    setHidden(tooltip, false);
    positionTooltip(index);
  };

  /** @param {number} index */
  const positionTooltip = (index) => {
    const layout = state.layout;
    if (!layout) return;
    const rootRect = root.getBoundingClientRect();
    const svgRect = present(state.svg, 'the trend chart').getBoundingClientRect();
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

  /** @param {number} clientX */
  const nearestColumn = (clientX) => {
    const layout = state.layout;
    if (!layout || !layout.columns.length) return -1;
    const rect = present(state.svg, 'the trend chart').getBoundingClientRect();
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

  /** @param {Event} event */
  const partyFromEvent = (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-party]') : null;
    return target ? target.getAttribute('data-party') : null;
  };

  /** @param {string | null} party */
  const togglePartyLock = (party) => {
    if (!party || !seriesByKey.has(party)) return;
    state.lockedParty = state.lockedParty === party ? null : party;
    state.hoverParty = null;
    applyFocus();
    if (state.column >= 0) renderTooltip(state.column);
  };

  /** @param {PointerEvent} event */
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

  /** @param {PointerEvent} event */
  const onPointerDown = (event) => {
    if (event.pointerType !== 'touch') return;
    state.pinned = true;
    setColumn(nearestColumn(event.clientX));
  };

  /** @param {MouseEvent} event */
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
  /** @param {PointerEvent} event */
  const onDocumentPointerDown = (event) => {
    if (!state.pinned || event.pointerType !== 'touch') return;
    if (event.target instanceof Node && root.contains(event.target)) return;
    state.pinned = false;
    setColumn(-1);
  };

  /** @param {KeyboardEvent} event */
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

  /** @param {MouseEvent} event */
  const onLegendClick = (event) => {
    const button = event.target instanceof Element ? event.target.closest('button[data-party]') : null;
    if (button) togglePartyLock(button.getAttribute('data-party'));
  };
  /** @param {PointerEvent} event */
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
    const svg = present(state.svg, 'the trend chart');
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerleave', onPointerLeave);
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('click', onClick);
    svg.addEventListener('keydown', onKeyDown);
    applyFocus();
    const column = state.column;
    state.column = -1;
    if (column >= 0 && state.pinned) setColumn(column);
    else setHidden(tooltip, true);
  };

  legend.addEventListener('click', onLegendClick);
  legend.addEventListener('pointerover', onLegendPointerOver);
  legend.addEventListener('pointerout', onLegendPointerOut);
  doc.addEventListener('pointerdown', onDocumentPointerDown, true);

  /** @type {ResizeObserver | null} */
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

  /** @type {TrendChartController} */
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

/** @param {TrendModel} model */
function legendMarkup(model) {
  return model.series.map((item) => (
    `<button type="button" class="test2-election-trends__legend-item" data-party="${escapeHtml(item.key)}" aria-pressed="false" title="${escapeHtml(`Focus ${item.party}`)}">`
    + `<span class="test2-election-trends__legend-swatch" style="background:${escapeHtml(item.colour)}"></span>`
    + `<span class="test2-election-trends__legend-name">${escapeHtml(item.party)}</span>`
    + '</button>'
  )).join('');
}

/**
 * @param {Element} root
 * @returns {MeasureText}
 */
function createTextMeasurer(root) {
  try {
    const canvas = root.ownerDocument.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return estimateTextWidth;
    const family = getComputedStyle(root).fontFamily || 'sans-serif';
    return (/** @type {string} */ text, bold = false, size = LABEL_FONT_SIZE) => {
      context.font = `${bold ? '600' : '400'} ${size}px ${family}`;
      return context.measureText(String(text)).width;
    };
  } catch {
    return estimateTextWidth;
  }
}
