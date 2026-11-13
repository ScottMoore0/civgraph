// The map app's components render in isolation from the sample data in packages/map/src/specimens.mjs
// (rf9-mapapp, 12 Nov 2026), as the design system's gallery specimens will (stream rf9-ui): the
// results tables, the trend chart and the timeline's ticks and changes list. The legend's case is in
// map-app-host.test.mjs. Each renderer is the one the app draws with, not a copy.
//
//   node --test tests/unit/map-specimens.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RESULTS_SAMPLE, TIMELINE_CHANGES_SAMPLE, TIMELINE_ITEMS_SAMPLE, TREND_POINTS_SAMPLE, timelineSampleYear,
} from '../../packages/map/src/specimens.mjs';
import { renderElectionSummaryFromViewModel } from '../../packages/map/src/election-renderer.mjs';
import { buildTrendChartModel, layoutTrendChart, renderTrendChartSvg } from '../../packages/map/src/election-trend-chart.mjs';
import { timelineChangesPanelHtml, timelineTicksHtml } from '../../packages/map/src/app/timeline/timeline-view.mjs';

const rows = (html) => (html.match(/<tr\b/g) || []).length;

test('results tables: the party table, the candidate table and a constituency\'s counts', () => {
  const party = renderElectionSummaryFromViewModel(RESULTS_SAMPLE);
  assert.match(party, /data-election-renderer="shared"/);
  assert.match(party, /data-election-view="party"/);
  assert.match(party, /Fianna F/);
  assert.ok(rows(party) >= 5, 'a row per party and the header');
  const byCandidate = renderElectionSummaryFromViewModel({ ...RESULTS_SAMPLE, view: 'candidate' });
  assert.match(byCandidate, /Gráinne Murphy|Gr&aacute;inne Murphy|Gráinne/);
  const counts = renderElectionSummaryFromViewModel({ ...RESULTS_SAMPLE, selectedResult: RESULTS_SAMPLE.results?.[0], view: 'counts' });
  assert.match(counts, /aria-label="Northborough results"/);
  assert.match(counts, /<dt>Quota<\/dt><dd>10,001<\/dd>/);
  assert.equal(rows(counts), 6, 'the header and a row per candidate');
});

test('trend chart: four elections, a line per party, an SVG of the asked width', () => {
  const model = buildTrendChartModel(TREND_POINTS_SAMPLE);
  assert.equal(model.elections.length, 4);
  assert.equal(model.series.length, 4);
  assert.deepEqual(new Set(model.series.map((s) => s.party)), new Set(TREND_POINTS_SAMPLE.map((p) => p.party)));
  const svg = renderTrendChartSvg(model, layoutTrendChart(model, { width: 640 }));
  assert.match(svg, /^<svg class="test2-election-trends__svg" viewBox="0 0 640 /);
  assert.match(svg, /role="img"/);
});

test('timeline: ticks with the first, last and one year a decade, and the changes list', () => {
  const ticks = timelineTicksHtml(TIMELINE_ITEMS_SAMPLE, timelineSampleYear);
  assert.equal((ticks.match(/class="timeline-tick/g) || []).length, TIMELINE_ITEMS_SAMPLE.length);
  assert.equal((ticks.match(/timeline-tick--major/g) || []).length, TIMELINE_ITEMS_SAMPLE.filter((item) => !item.minor).length);
  assert.match(ticks, /data-priority="3" style="--p:0.00000">1921</);
  assert.match(ticks, /data-priority="3" style="--p:1.00000">1953</);
  assert.match(ticks, />1933</, 'the 1930s are labelled by their first major stop');
  assert.equal(timelineTicksHtml(TIMELINE_ITEMS_SAMPLE.slice(0, 1), timelineSampleYear), '');
  const panel = timelineChangesPanelHtml(TIMELINE_CHANGES_SAMPLE);
  assert.match(panel, /Changes, 1973 to 1985/);
  assert.equal((panel.match(/class="timeline-changes-panel__item"/g) || []).length, 3);
  assert.match(panel, /timeline-changes-panel__type--created">New</);
  assert.match(panel, /\(1977\)/);
  assert.match(panel, /and 1 more step: step one edition at a time/);
  assert.match(panel, /Catalogue note:/);
  // Going back in time, a new area reads as abolished.
  assert.match(timelineChangesPanelHtml({ ...TIMELINE_CHANGES_SAMPLE, reversed: true }), /timeline-changes-panel__type--abolished">Abolished</);
});
