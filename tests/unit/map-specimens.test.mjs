// The map app's components render in isolation from the sample data in packages/map/src/views/specimens.mjs
// (rf9-mapapp, 12 Nov 2026), as the design system's gallery specimens will (stream rf9-ui): the
// results tables, the trend chart and the timeline's ticks and changes list. The legend's case is in
// map-app-host.test.mjs. Each renderer is the one the app draws with, not a copy.
//
//   node --test tests/unit/map-specimens.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RESULTS_SAMPLE, TIMELINE_CHANGES_SAMPLE, TIMELINE_ITEMS_SAMPLE, TREND_POINTS_SAMPLE, timelineSampleYear,
} from '@civgraph/map/views/specimens.mjs';
import { renderElectionSummaryFromViewModel } from '@civgraph/map/views/election-renderer.mjs';
import { buildTrendChartModel, layoutTrendChart, renderTrendChartSvg } from '@civgraph/map/election-trend-chart.mjs';
import { timelineChangesPanelHtml, timelineChangesTitle, timelineTicksHtml } from '@civgraph/map/views/timeline-view.mjs';

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
  // Only the date the changes took effect, the later edition's (Phelim, 20 Nov 2026).
  assert.match(panel, /<h2 class="timeline-changes-panel__title">Changes, 1985<\/h2>/);
  assert.doesNotMatch(panel, /1973 to 1985/);
  // The zoom button draws the app's zoom-to frame (Lucide maximize), not a magnifying glass.
  assert.match(panel, /class="timeline-changes-panel__zoom-icon"[^>]*><path d="M8 3H5a2 2 0 0 0-2 2v3"\/>/);
  assert.doesNotMatch(panel, /<circle/);
  // A listed rename brings its swatch into the key.
  assert.match(panel, /timeline-changes-panel__swatch--renamed"><\/span>renamed/);
  assert.doesNotMatch(timelineChangesPanelHtml({ ...TIMELINE_CHANGES_SAMPLE, changes: TIMELINE_CHANGES_SAMPLE.changes.filter((c) => c.type !== 'renamed') }), /swatch--renamed/);
  assert.equal((panel.match(/class="timeline-changes-panel__item"/g) || []).length, 3);
  assert.match(panel, /timeline-changes-panel__type--created">New</);
  assert.match(panel, /\(1977\)/);
  assert.match(panel, /and 1 more step: step one edition at a time/);
  assert.match(panel, /Catalogue note:/);
  // Going back in time, a change still reads as what happened at its date (Phelim Birch, 26 Nov 2026).
  const back = timelineChangesPanelHtml({ ...TIMELINE_CHANGES_SAMPLE, reversed: true });
  assert.match(back, /timeline-changes-panel__type--created">New</);
  assert.doesNotMatch(back, /type--abolished/);
  assert.match(timelineChangesPanelHtml({ ...TIMELINE_CHANGES_SAMPLE, changes: [{ type: 'merged', text: 'A and B merged to form C', key: '0:c1' }] }), /timeline-changes-panel__type--merged">Merged</);
});

test('timeline: the changes heading names when the changes took effect, not the span stepped across', () => {
  const view = { fromLabel: '25 Oct 1927', toLabel: '01 Apr 1955', reversed: false };
  assert.equal(timelineChangesTitle({ ...view, dateLabels: ['01 Apr 1955'] }), 'Changes, 01 Apr 1955');
  // A year where the edition has only a year.
  assert.equal(timelineChangesTitle({ fromLabel: '1973', toLabel: '1985', reversed: false, dateLabels: ['1985'] }), 'Changes, 1985');
  // Stepping back from 1955 to 1927 lists the same changes, which took effect in 1955.
  assert.equal(timelineChangesTitle({ fromLabel: '01 Apr 1955', toLabel: '25 Oct 1927', reversed: true, dateLabels: ['01 Apr 1955'] }), 'Changes, 01 Apr 1955');
  // Several steps at once: the first and last dates of change.
  assert.equal(timelineChangesTitle({ ...view, toLabel: '01 Nov 1957', dateLabels: ['01 Apr 1955', '01 Nov 1957'] }), 'Changes, 01 Apr 1955 to 01 Nov 1957');
  // No dates given: the later of the two editions.
  assert.equal(timelineChangesTitle(view), 'Changes, 01 Apr 1955');
  assert.equal(timelineChangesTitle({ fromLabel: '01 Apr 1955', toLabel: '25 Oct 1927', reversed: true }), 'Changes, 01 Apr 1955');
});
