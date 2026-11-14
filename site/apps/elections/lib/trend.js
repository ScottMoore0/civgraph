/**
 * The area page's party-share chart: the /maps/ trend chart's own model, layout and SVG
 * (packages/map/src/views/election-trend-chart.mjs, served at /pkg/), drawn statically at the
 * width the page gives it, with a legend and the figures as a table. Pure: the view measures
 * the width and inserts the markup. Tests: tests/unit/elections-app-places.test.mjs.
 */
import { buildTrendChartModel, layoutTrendChart, renderTrendChartSvg } from '../../../pkg/map/src/views/election-trend-chart.mjs';

/** @typedef {import('../../../pkg/map/src/views/election-trend-chart.mjs').TrendPoint} TrendPoint */
/** @typedef {import('../../../pkg/map/src/views/election-trend-chart.mjs').TrendModel} TrendModel */

/**
 * The chart for a set of points, or null when fewer than two elections have any.
 * @param {TrendPoint[]} points
 * @param {{ width: number, ariaLabel: string }} opts
 * @returns {{ svg: string, model: TrendModel } | null}
 */
export function trendChart(points, { width, ariaLabel }) {
  const model = buildTrendChartModel(points, { seriesLimit: 8 });
  if (model.elections.length < 2 || !model.series.length) return null;
  const layout = layoutTrendChart(model, { width: Math.max(280, Math.min(960, Math.round(width))) });
  return { svg: renderTrendChartSvg(model, layout, { ariaLabel }), model };
}

/**
 * The chart's figures as rows: one per election, a share (or null) per party, in the chart's order.
 * @param {TrendModel} model
 * @returns {{ parties: Array<{ party: string, colour: string }>, rows: Array<{ key: string, date: string, shares: Array<number | null> }> }}
 */
export function trendTable(model) {
  return {
    parties: model.series.map((s) => ({ party: s.party, colour: s.colour })),
    rows: model.elections.map((e, i) => ({ key: e.key, date: e.date, shares: model.series.map((s) => s.values[i]?.share ?? null) })),
  };
}
