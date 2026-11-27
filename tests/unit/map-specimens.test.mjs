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
  assert.ok(panel.includes('1 earlier step is not listed: choose a later edition to see it.'));
  assert.match(panel, /Catalogue note:/);
  // The "Changes since" menu at the top right (Phelim Birch, 27 Nov 2026): labelled, the series'
  // earlier editions newest first, the preceding one marked and chosen.
  assert.match(panel, /<label class="timeline-changes-panel__since">\s*<span[^>]*>Changes since<\/span>\s*<select id="timelineChangesSince"/);
  assert.ok(panel.includes('<option value="wards-1977" selected>1977 (previous edition)</option><option value="wards-1973">1973</option>'));
  assert.ok(panel.indexOf('timelineChangesSince') < panel.indexOf('timeline-changes-panel__close'), 'the menu sits before the close button');
  assert.doesNotMatch(timelineChangesPanelHtml({ ...TIMELINE_CHANGES_SAMPLE, since: { selected: '', options: [] } }), /<select/);
  assert.match(timelineChangesPanelHtml({ ...TIMELINE_CHANGES_SAMPLE, changes: [{ type: 'merged', text: 'A and B merged to form C', key: '0:c1' }] }), /timeline-changes-panel__type--merged">Merged</);
});

test('timeline: changes since an earlier edition are grouped by step, oldest first, under one summary', () => {
  const panel = timelineChangesPanelHtml({
    fromLabel: '1973', toLabel: '1985', dateLabels: ['1977', '1985'], skipped: 0,
    summary: 'Changes since 1973: 2 steps, 3 changes, 120 ha in all.',
    since: { selected: 'wards-1973', options: [{ mapId: 'wards-1977', label: '1977', preceding: true }, { mapId: 'wards-1973', label: '1973', preceding: false }] },
    parts: [{ label: '1977', text: '1 change, 120 ha in all.' }, { label: '1985', text: '2 changes (1 rename).' }],
    changes: [
      { type: 'transfer', text: '120 ha from Antrim to Ballyclare', key: '0:c1', group: 0, step: '1977' },
      { type: 'created', text: 'Carnmoney formed from Newtownabbey', key: '1:c1', group: 1, step: '1985' },
      { type: 'renamed', text: 'Larne Lough renamed Larne', key: '1:c2', group: 1, step: '1985' },
    ],
  });
  assert.ok(panel.includes('<h2 class="timeline-changes-panel__title">Changes, 1977 to 1985</h2>'));
  assert.ok(panel.includes('<option value="wards-1973" selected>1973</option>'));
  assert.ok(panel.includes('class="timeline-changes-panel__overall">Changes since 1973: 2 steps, 3 changes, 120 ha in all.<'));
  const groups = panel.split('class="timeline-changes-panel__group"').slice(1);
  assert.equal(groups.length, 2);
  assert.match(groups[0], /__group-title">1977</);
  assert.match(groups[0], /120 ha from Antrim to Ballyclare/);
  assert.doesNotMatch(groups[0], /Carnmoney/);
  assert.match(groups[1], /__group-title">1985</);
  assert.equal((groups[1].match(/class="timeline-changes-panel__item"/g) || []).length, 2);
  // Under its group's heading a change does not repeat the date.
  assert.doesNotMatch(panel, /timeline-changes-panel__step/);
});

test('timeline: a series\' first edition says there is nothing earlier to compare', () => {
  const panel = timelineChangesPanelHtml({ kind: 'first', fromLabel: '', toLabel: '1915', dateLabels: [], skipped: 0, parts: [], changes: [], since: { selected: '', options: [] } });
  assert.ok(panel.includes('<h2 class="timeline-changes-panel__title">First edition</h2>'));
  assert.ok(panel.includes('The first edition of this series: there is nothing earlier to compare it with.'));
  assert.doesNotMatch(panel, /<select|__list|__key/);
  assert.equal(timelineChangesTitle({ kind: 'first', toLabel: '1915' }), 'First edition');
});

test('timeline: the changes heading names when the changes took effect, not the span stepped across', () => {
  const view = { fromLabel: '25 Oct 1927', toLabel: '01 Apr 1955' };
  assert.equal(timelineChangesTitle({ ...view, dateLabels: ['01 Apr 1955'] }), 'Changes, 01 Apr 1955');
  // A year where the edition has only a year.
  assert.equal(timelineChangesTitle({ fromLabel: '1973', toLabel: '1985', dateLabels: ['1985'] }), 'Changes, 1985');
  // Several steps at once: the first and last dates of change.
  assert.equal(timelineChangesTitle({ ...view, toLabel: '01 Nov 1957', dateLabels: ['01 Apr 1955', '01 Nov 1957'] }), 'Changes, 01 Apr 1955 to 01 Nov 1957');
  // No dates given: the edition selected, the later of the two.
  assert.equal(timelineChangesTitle(view), 'Changes, 01 Apr 1955');
});
