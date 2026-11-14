// The served page imports /pkg/map/src/views/election-trend-chart.mjs, which the dist build and the dev servers answer with
// packages/map/src/views/election-trend-chart.mjs (packages/served.json): this file is never served. It lets Node, the unit
// tests and tsc resolve that import to the same module. Do not edit: edit the package.
export * from '../../../../../packages/map/src/views/election-trend-chart.mjs';
