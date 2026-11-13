/**
 * The component gallery: /design-system/.
 *
 * REFACTOR-PLAN.md item 6. Every design token and every shell and UI component, in isolation,
 * with sample data and its markup, rendered at request time by the same template functions the
 * record pages use (packages/ui/src/templates/shell.js, packages/ui/src/templates/components/index.js) and
 * styled by the same stylesheets (assets/ui/). It cannot go stale: there is no copy to rebuild.
 * The theme toggle in the header shows everything in light and dark.
 *
 * The token table is filled in the browser by assets/ui/gallery/gallery.js, which reads
 * assets/ui/tokens.css itself, so a token added there shows here with no edit to this file.
 *
 * Not for search engines: noindex in the page and in X-Robots-Tag, and no sitemap lists it.
 * tests/functions/design-system.test.mjs requires a specimen for every component stylesheet and
 * every template function, and every cg-* class used here to exist in a stylesheet.
 */
import { escapeHtml, html, raw, toHtmlString } from '../../../core/src/html.js';
import { page, sectionNav } from '../templates/shell.js';
import { badges, citations, dataTable, facts, link, notice, partyChip } from '../templates/components/index.js';
import colours from '../../../registries/src/browser/colours.mjs';
import { siteNumber } from '../../../core/src/format.js';
import { recordHtml, refWidget } from '../templates/proni/record-view.js';
// The map app's own renderers and their sample data: its pure drawing code (unit map-views), which ui
// may import (config/boundaries.json); never the map app itself.
import { legendBodyHtml, legendShellHtml, legendSummaryText } from '../../../map/src/views/legend-view.mjs';
import { renderElectionSummaryFromViewModel } from '../../../map/src/views/election-renderer.mjs';
import { buildTrendChartModel, layoutTrendChart, renderTrendChartSvg, trendLegendHtml } from '../../../map/src/views/election-trend-chart.mjs';
import { timelineChangesPanelHtml, timelineTicksHtml } from '../../../map/src/views/timeline-view.mjs';
import {
  LEGEND_SAMPLE, RESULTS_SAMPLE, TIMELINE_CHANGES_SAMPLE, TIMELINE_ITEMS_SAMPLE, TREND_POINTS_SAMPLE, timelineSampleYear,
} from '../../../map/src/views/specimens.mjs';

// The specimens' sample party colours: the colours registry's gallery.specimens (data/registries/colours.json).
const SAMPLE = colours.gallery.specimens;

export const GALLERY_PATH = '/design-system/';
export const ROBOTS = 'noindex, nofollow';

const code = (/** @type {string} */ markup) => html`<details class="cg-gallery__markup"><summary>Markup</summary><pre><code>${markup}</code></pre></details>`;

/**
 * One specimen per component. `stylesheet` is its file under assets/ui/components/ (null for
 * the shell's own parts); `templates` names the template functions it shows.
 */
export const SPECIMENS = [
  {
    id: 'section-nav', title: 'Section navigation (breadcrumb)', stylesheet: 'section-nav.css', templates: ['sectionNav'],
    render: () => sectionNav({ items: [{ href: '/browse/', label: 'Browse' }, { href: '/browse/persons/', label: 'People' }, { label: 'A person' }] }),
  },
  {
    id: 'button', title: 'Buttons', stylesheet: 'button.css', templates: [],
    render: () => raw('<p class="cg-gallery__row"><button class="cg-button" type="button">Default</button> <button class="cg-button cg-button--primary" type="button">Primary</button> <button class="cg-button cg-button--link" type="button">Link button</button> <button aria-label="Close" class="cg-button cg-button--icon" type="button">&times;</button> <button class="cg-button" type="button" disabled>Disabled</button></p>'),
  },
  {
    id: 'badge', title: 'Badges and counts', stylesheet: 'badge.css', templates: ['badges'],
    render: () => html`${badges(['Elected', { label: 'Unopposed', tone: 'success' }, { label: 'Disputed', tone: 'warning' }, { label: 'Withdrawn', tone: 'danger' }])}<p>Contests <span class="cg-count">1,141</span></p>`,
  },
  {
    id: 'party-chip', title: 'Party chip', stylesheet: 'party-chip.css', templates: ['partyChip'],
    render: () => html`<p class="cg-gallery__row">${partyChip('Alliance Party', SAMPLE.alliance)} ${partyChip('Social Democratic and Labour Party', SAMPLE.sdlp)} ${partyChip('Independent', null)}</p>`,
  },
  {
    id: 'facts', title: 'Record facts', stylesheet: 'facts.css', templates: ['facts', 'link'],
    render: () => facts([
      { label: 'Born', value: '1921' },
      { label: 'Party', value: partyChip('Ulster Unionist Party', SAMPLE.uup) },
      { label: 'Source', value: link('https://example.org/source', 'Sample source') },
      { label: 'Left out because empty', value: '' },
    ]),
  },
  {
    id: 'table', title: 'Data table', stylesheet: 'table.css', templates: ['dataTable'],
    render: () => html`${dataTable({
      caption: 'Sample count, first preferences',
      label: 'Sample results',
      columns: [{ label: 'Candidate', rowHeader: true }, { label: 'Party' }, { label: 'Votes', num: true }, { label: 'Change', num: true }],
      rows: [
        { cells: [html`Candidate A <span class="cg-elected-mark" title="Elected">✓</span>`, partyChip('Party one', SAMPLE.partyOne), '4,120', html`<span class="cg-delta--positive">+3.2</span>`], className: 'cg-elected' },
        ['Candidate B', partyChip('Party two', SAMPLE.partyTwo), '3,987', html`<span class="cg-delta--negative">−1.4</span>`],
        ['Candidate C', partyChip('Independent', null), '402', '–'],
      ],
    })}${dataTable({
      caption: 'Compact, first column sticky',
      className: 'cg-table--compact cg-table--sticky-first',
      columns: [{ label: 'Year', rowHeader: true }, { label: 'Seats', num: true }, { label: 'Contests', num: true }],
      rows: [['1923', '12', '40'], ['1926', '12', '38']],
    })}`,
  },
  {
    id: 'notice', title: 'Notices', stylesheet: 'notice.css', templates: ['notice'],
    render: () => html`${notice({ title: 'Coverage', body: 'An informational note about what this record holds.' })}${notice({ title: 'Partial', body: 'Some counts are missing.', tone: 'warning' })}${notice({ title: 'Checked', body: 'Cross-checked against two sources.', tone: 'success' })}${notice({ title: 'Unavailable', body: 'The database did not answer.', tone: 'danger' })}`,
  },
  {
    id: 'citations', title: 'Citations', stylesheet: 'citations.css', templates: ['citations'],
    render: () => html`<div class="cg-citation-block">${citations([
      { label: 'A printed source, p. 12', note: 'table 3' },
      { label: 'An online register', url: 'https://example.org/register', licence: 'OGL v3.0' },
    ])}</div>`,
  },
  {
    id: 'card', title: 'Cards and record header', stylesheet: 'card.css', templates: [],
    render: () => raw('<header class="cg-record-header"><h3>Record title</h3><p class="cg-lede">A one-line summary of the record.</p></header><ul class="cg-card-grid"><li class="cg-card"><h4 class="cg-card__title"><a href="#card">A map card</a></h4><p class="cg-card__meta">1923 · boundaries</p></li><li class="cg-card"><h4 class="cg-card__title"><a href="#card">Another card</a></h4><p class="cg-card__meta">1973 · elections</p></li></ul>'),
  },
  {
    id: 'tabs', title: 'Tabs', stylesheet: 'tabs.css', templates: [],
    render: () => raw('<ul class="cg-tabs__list"><li><a class="cg-tabs__tab" aria-current="true" href="#tabs">Results</a></li><li><a class="cg-tabs__tab" href="#tabs">Counts</a></li><li><a class="cg-tabs__tab" href="#tabs">Sources</a></li></ul>'),
  },
  {
    id: 'tabs-bar', title: 'Tabs, bar variant (an app\'s own views)', stylesheet: 'tabs.css', templates: [],
    render: () => raw('<nav class="cg-tabs__bar" aria-label="Sample app"><a href="#tabs-bar" aria-current="page">Elections</a><a href="#tabs-bar">Pivot tables</a><a href="#tabs-bar">Maps</a><a href="#tabs-bar">Compare</a></nav>'),
  },
  {
    id: 'toggle', title: 'Toggle switch', stylesheet: 'toggle.css', templates: [],
    render: () => raw('<label class="cg-toggle"><input type="checkbox" checked> Printed labels</label> <label class="cg-toggle"><input type="checkbox"> Hatching</label>'),
  },
  {
    id: 'segmented', title: 'Segmented control', stylesheet: 'segmented.css', templates: [],
    render: () => raw('<div class="cg-segmented" role="radiogroup" aria-label="View"><label><input type="radio" name="cg-gallery-view" checked> Map</label><label><input type="radio" name="cg-gallery-view"> Table</label><label><input type="radio" name="cg-gallery-view"> Chart</label></div>'),
  },
  {
    id: 'search', title: 'Search box', stylesheet: 'search.css', templates: [],
    render: () => raw('<form class="cg-search" role="search" action="#search"><label class="visually-hidden" for="cg-gallery-q">Search</label><input id="cg-gallery-q" type="search" placeholder="Search people" value="Moore"><button class="cg-button cg-button--primary" type="submit">Search</button></form>'),
  },
  {
    id: 'popover', title: 'Popover menu', stylesheet: 'popover.css', templates: [],
    render: () => raw('<button class="cg-button" type="button" popovertarget="cg-gallery-menu">Download</button><div class="cg-popover" id="cg-gallery-menu" popover><ul class="cg-menu"><li><a href="#popover">GeoJSON</a></li><li><a href="#popover" aria-current="true">FlatGeobuf</a></li><li><button type="button">Copy link</button></li></ul></div>'),
  },
  {
    id: 'dialog', title: 'Dialog', stylesheet: 'dialog.css', templates: [],
    render: () => raw('<button class="cg-button" type="button" data-gallery-open="cg-gallery-dialog">Open dialog</button><dialog class="cg-dialog" id="cg-gallery-dialog"><div class="cg-dialog__header"><h3>Dialog title</h3><form method="dialog"><button aria-label="Close" class="cg-button cg-button--icon">&times;</button></form></div><p>Dialog body.</p></dialog>'),
  },
  {
    id: 'pager', title: 'Pager', stylesheet: 'pager.css', templates: [],
    render: () => raw('<nav class="cg-pager" aria-label="Pages"><p class="cg-pager__status">Showing 51–100 of 31,240</p><p class="cg-pager__links"><a href="#pager" rel="prev">Previous</a> <a href="#pager" rel="next">Next</a></p></nav>'),
  },
  {
    id: 'skeleton', title: 'Loading skeleton', stylesheet: 'skeleton.css', templates: [],
    render: () => raw('<div aria-hidden="true"><span class="cg-skeleton" style="width: 60%"></span><span class="cg-skeleton" style="width: 40%"></span></div>'),
  },
  {
    id: 'legend', title: 'Legend', stylesheet: 'legend.css', templates: [],
    render: () => raw(`<ul class="cg-legend"><li class="cg-legend__item"><span class="cg-legend__swatch" style="background:${SAMPLE.partyOne}"></span>Party one</li><li class="cg-legend__item"><span class="cg-legend__swatch" style="background:${SAMPLE.partyTwo}"></span>Party two</li><li class="cg-legend__item"><span class="cg-legend__swatch" style="background:${SAMPLE.other}"></span>Other</li></ul>`),
  },
  {
    id: 'legend-chips', title: 'Legend of party chips', stylesheet: 'legend.css', templates: ['partyChip'],
    render: () => html`<div class="cg-legend cg-legend--chips">${partyChip('Party one', SAMPLE.partyOne)}${partyChip('Party two', SAMPLE.partyTwo)}${partyChip('Independent', null)}</div>`,
  },
  {
    id: 'chart', title: 'Chart frame', stylesheet: 'chart.css', templates: [],
    render: () => raw('<figure class="cg-chart"><svg viewBox="0 0 240 80" role="img" aria-label="Sample trend"><line x1="0" y1="70" x2="240" y2="70" stroke="var(--chart-baseline)"/><line x1="0" y1="40" x2="240" y2="40" stroke="var(--chart-grid)"/><polyline fill="none" stroke="var(--color-accent)" stroke-width="2" points="0,60 60,52 120,30 180,36 240,18"/></svg><figcaption>Share of the vote, sample data</figcaption></figure>'),
  },
];

/**
 * A PRONI record, made up: the shape /_api/proni/node answers.
 * @type {import('../templates/proni/record-view.js').ProniNodeAnswer}
 */
const SAMPLE_PRONI_RECORD = {
  item: {
    ref: 'D0000/1/2', slug: 'd0000-1-2', fond: 'D0000', hasChildren: true, title: 'Sample estate papers: rentals and correspondence', level: 'Sub-fond', access: 'Open',
    dates: '1850-1890', description: 'A made-up record for the gallery: rentals, leases and letters of a sample estate.',
    digitalRecord: false, extractedDates: { display: '1850-1890', startYear: 1850, endYear: 1890, circa: true, estimated: false, bound: '', undated: false },
  },
  ancestors: [{ ref: 'D0000', slug: 'd0000', title: 'Sample family papers' }, { ref: 'D0000/1', slug: 'd0000-1', title: 'Estate papers' }],
  nav: { parent: 'D0000/1', first: 'D0000/1/1', last: 'D0000/1/4', prev: 'D0000/1/1', next: 'D0000/1/3', total: 4, position: 2 },
  children: [
    { ref: 'D0000/1/2/1', slug: 'd0000-1-2-1', title: 'Rental, 1850', level: 'File', dates: '1850', hasChildren: false },
    { ref: 'D0000/1/2/2', slug: 'd0000-1-2-2', title: 'Letters, 1851-1860', level: 'File', dates: '1851-1860', hasChildren: false },
  ],
  childCount: 2,
};

/**
 * The map app's stylesheets: the site's shared main.css (the map page inlines its first part and
 * loads the rest as /build/main.css: the same rules) and the app's own test2.css (bundled into
 * app.bundle.css on the page, served as itself at /app/src/test2.css).
 */
const MAP_SHEETS = ['assets/css/main.css', 'app/src/test2.css'];

/**
 * The frame's stand-ins for what surrounds a map component on its page (`frameStyle`, rules for the
 * frame's #specimen, the element the component sits in): the map, which the legend and the changes
 * list float over by its corners; a phone's screen height, which the election pane is clamped to a
 * share of on a phone (test2.css .test2-election-panel max-height: 42vh, which in a frame would read
 * the frame's own height); and the rules the timeline's track gets inside the map's timeline bar
 * (.pane--map > #timelineSlider .timeline-track and .timeline-range).
 */
const MAP_FRAME = {
  /** @param {number} height px */
  overMap: (height) => `#specimen { position: relative; height: ${height}px; }`,
  phoneScreen: '@media (max-width: 640px) { #specimen { min-height: 812px; } }',
  timelineBar: '#specimen .timeline-track { position: relative; display: flex; flex-direction: column; justify-content: center; max-width: 440px; padding-bottom: 17px; } #specimen .timeline-range { width: 100%; max-width: none; }',
};

/** The map legend as app.updateMapLegend (packages/map/src/app/legend.js) writes it: the shell, then its body and summary. */
function mapLegendMarkup() {
  const { election, statistics } = LEGEND_SAMPLE;
  const shell = legendShellHtml(true)
    .replace('<div class="test2-map-legend__body"></div>', `<div class="test2-map-legend__body">${legendBodyHtml(LEGEND_SAMPLE)}</div>`)
    .replace('<span>Legend</span>', `<span>${escapeHtml(legendSummaryText(election, statistics))}</span>`);
  return `<section class="test2-map-legend" aria-label="Map legend">${shell}</section>`;
}

/** The trend chart as mountTrendChart (packages/map/src/election-trend-chart.mjs) lays it out, before any interaction. */
function mapTrendMarkup() {
  const model = buildTrendChartModel(TREND_POINTS_SAMPLE);
  const svg = renderTrendChartSvg(model, layoutTrendChart(model, { width: 560 }));
  return `<section class="test2-election-trends" aria-label="Sample party shares over time"><div class="test2-election-trends__chart"><div class="trend-chart">`
    + `<div class="test2-election-trends__legend" role="group" aria-label="Parties shown">${trendLegendHtml(model)}</div>`
    + `<div class="trend-chart__stage">${svg}</div></div></div></section>`;
}

/** The timeline's track: the slider and the ticks under it, as controls.js ensureTimelineChrome and renderTimelineTicks build it. */
function mapTimelineTicksMarkup() {
  const last = TIMELINE_ITEMS_SAMPLE.length - 1;
  return `<div class="timeline-track"><input type="range" class="timeline-range" min="0" max="${last}" value="${last}" aria-label="Timeline">`
    + `<div class="timeline-ticks" aria-hidden="true">${timelineTicksHtml(TIMELINE_ITEMS_SAMPLE, timelineSampleYear)}</div></div>`;
}

/** The list of boundary changes between two editions, as changes.js writes it into its panel over the map. */
function mapTimelineChangesMarkup() {
  return `<section class="timeline-changes-panel" aria-label="Boundary changes">${timelineChangesPanelHtml(TIMELINE_CHANGES_SAMPLE)}</section>`;
}

/**
 * The apps' own components (REFACTOR-PLAN.md G-4), each drawn in a frame of its own that loads the
 * shell's token, base and component sheets and its app's stylesheet, so the app's rules apply as on
 * its pages (dark rules on :root included), while its element rules (the Elections app styles every
 * h2) cannot restyle the gallery.
 * `render` is markup written here by the app's real code where that code is a package module (the
 * PRONI record view), or, for Browse, the markup its templates in browse.js write (markup only so
 * far: browse.js exports none of them); `module` is a served module whose
 * drawSpecimen(id, root, sample) draws the specimen in the browser with the app's own functions (the
 * Elections charts). `frameClass` is the class of the element the specimen sits in, as on its page
 * (the Elections app's main column), `bodyAttributes` those of the app's own <body>, `frameStyle` rules
 * the frame adds for what stands around the component on its page (the map under the map legend); the frame loads
 * the sheets every page loads (tokens, base, site chrome, components) before the app's. gallery.js
 * draws both.
 *
 * The map app's components (legend, results tables, trend chart, timeline: REFACTOR-PLAN.md G-5) are
 * drawn here by its own pure renderers, packages/map/src/views/ (rf10-gallery, 13 Nov 2026), from the
 * sample data beside them (views/specimens.mjs), in the element the app puts them in.
 *
 * Held back: a constituency's count table (renderElectionSummaryFromViewModel with view 'counts').
 * In the gallery's phone-width frame it is wider than its .test2-election-table-wrap, which then
 * scrolls but cannot take focus (axe scrollable-region-focusable; the same holds in the app for a
 * count too wide for the pane, and the fix, a tab stop on the wrap, changes the app: requested in
 * LANDING rf10-gallery).
 *
 * Still to come: the STV count viewer (the map app's classic scripts under
 * site/app/election-viewer-package/, which build their SVG with DOM calls from page globals, the
 * map app's colours and its election data; a specimen needs its drawing as a module that takes them).
 */
export const APP_SPECIMENS = [
  {
    id: 'elections-seats', title: 'Elections: seat charts', app: 'elections', source: 'site/apps/elections/lib/charts.js', functions: ['parliamentArc', 'seatBar'],
    stylesheets: ['apps/elections/elections.css'], frameClass: 'el-main', module: 'apps/elections/gallery-specimens.js',
  },
  {
    id: 'elections-shares', title: 'Elections: vote bars', app: 'elections', source: 'site/apps/elections/lib/charts.js', functions: ['hbars'],
    stylesheets: ['apps/elections/elections.css'], frameClass: 'el-main', module: 'apps/elections/gallery-specimens.js',
  },
  {
    id: 'elections-count', title: 'Elections: an STV count (quota and transfers)', app: 'elections', source: 'site/apps/elections/lib/charts.js', functions: ['quotaBars', 'transferFlow'],
    stylesheets: ['apps/elections/elections.css'], frameClass: 'el-main', module: 'apps/elections/gallery-specimens.js',
  },
  {
    id: 'elections-chips', title: 'Elections: party chips', app: 'elections', source: 'site/apps/elections/lib/party.js', functions: ['partyChip'],
    stylesheets: ['apps/elections/elections.css'], frameClass: 'el-main', module: 'apps/elections/gallery-specimens.js',
  },
  {
    id: 'proni-record', title: 'PRONI Search: a record page', app: 'proni', source: 'packages/ui/src/templates/proni/record-view.js', functions: ['recordHtml', 'refWidget', 'pager', 'levelsNav'],
    stylesheets: ['apps/proni-search/app.css'], bodyAttributes: { 'data-app': 'proni' },
    render: () => `<div id="viewRecord">${recordHtml(SAMPLE_PRONI_RECORD, { fmt: siteNumber })}</div><p>On a search result card:</p>${refWidget('D0000/1/2', true)}`,
  },
  {
    id: 'browse-portal', title: 'Browse: totals and filters', app: 'browse', source: 'site/browse/browse.js', functions: ['renderPortalStat', 'renderListFilterControls'],
    stylesheets: ['browse/browse.css'],
    render: () => `<div class="browse-portal-stats" aria-label="Sample totals"><div class="browse-portal-stat"><strong>${siteNumber(22067)}</strong><span>Elections</span></div><div class="browse-portal-stat"><strong>${siteNumber(81540)}</strong><span>Candidacies</span></div><div class="browse-portal-stat"><strong>${siteNumber(38219)}</strong><span>People</span></div></div>`
      + '<section class="browse-controls" aria-label="Sample filters"><div class="browse-filter-grid"><label class="browse-filter"><span>Body</span><select><option value="">All</option><option>Sample council (12)</option></select></label><label class="browse-filter"><span>Sort by</span><select><option>Newest first</option></select></label></div>'
      + '<div class="browse-control-footer"><span>1 active filter.</span><button type="button" class="browse-btn">Clear filters</button></div></section>',
  },
  {
    id: 'browse-table', title: 'Browse: compact record table', app: 'browse', source: 'site/browse/browse.js', functions: ['renderRegisterSourcePanel'],
    stylesheets: ['browse/browse.css'],
    render: () => '<div class="browse-table-wrap" tabindex="0" role="region" aria-label="Sample provenance records"><table class="browse-table browse-table--compact"><caption class="visually-hidden">Sample provenance records</caption>'
      + '<thead><tr><th scope="col">Date</th><th scope="col">Category</th><th scope="col">Source</th><th scope="col">Method</th><th scope="col">Confidence</th></tr></thead>'
      + '<tbody><tr><td>12 May 1920</td><td>Election</td><td><a href="#browse-table">A sample newspaper, p. 4</a></td><td>transcribed</td><td>high</td></tr><tr><td>1921</td><td>Register</td><td>A sample directory</td><td>transcribed</td><td>medium</td></tr></tbody></table></div>',
  },
  {
    id: 'map-legend', title: 'Map: the legend', app: 'map', source: 'packages/map/src/views/legend-view.mjs', functions: ['legendShellHtml', 'legendBodyHtml', 'legendSummaryText'],
    stylesheets: MAP_SHEETS, frameStyle: MAP_FRAME.overMap(600),
    render: mapLegendMarkup,
  },
  {
    id: 'map-results', title: 'Map: election results by party', app: 'map', source: 'packages/map/src/views/election-renderer.mjs', functions: ['renderElectionSummaryFromViewModel'],
    stylesheets: MAP_SHEETS, frameClass: 'election-pane__content', frameStyle: MAP_FRAME.phoneScreen,
    render: () => renderElectionSummaryFromViewModel(RESULTS_SAMPLE),
  },
  {
    id: 'map-trends', title: 'Map: party shares over time', app: 'map', source: 'packages/map/src/views/election-trend-chart.mjs', functions: ['buildTrendChartModel', 'layoutTrendChart', 'renderTrendChartSvg', 'trendLegendHtml'],
    stylesheets: MAP_SHEETS, frameClass: 'election-pane__content',
    render: mapTrendMarkup,
  },
  {
    id: 'map-timeline', title: 'Map: the timeline\'s ticks and years', app: 'map', source: 'packages/map/src/views/timeline-view.mjs', functions: ['timelineTicksHtml'],
    stylesheets: MAP_SHEETS, frameStyle: MAP_FRAME.timelineBar,
    render: mapTimelineTicksMarkup,
  },
  {
    id: 'map-timeline-changes', title: 'Map: boundary changes between editions', app: 'map', source: 'packages/map/src/views/timeline-view.mjs', functions: ['timelineChangesPanelHtml'],
    stylesheets: MAP_SHEETS, frameStyle: MAP_FRAME.overMap(460),
    render: mapTimelineChangesMarkup,
  },
];

/** @param {(typeof APP_SPECIMENS)[number]} s */
function appSpecimenSection(s) {
  const markup = s.render ? s.render() : '';
  const sheets = JSON.stringify(['assets/ui/tokens.css', 'assets/ui/tokens-legacy.css', 'assets/ui/base.css', 'assets/site/site-chrome.css', 'assets/ui/components.css', ...s.stylesheets].map((p) => `/${p}`));
  return html`<section class="cg-gallery__specimen" id="${s.id}" aria-labelledby="${s.id}-h">
<h3 id="${s.id}-h">${s.title}</h3>
<p class="cg-gallery__source"><code>${s.source}</code> · ${s.functions.map((f, i) => html`${i ? ', ' : ''}<code>${f}()</code>`)}${s.app === 'browse' ? ' · markup only so far' : ''}</p>
<div class="cg-gallery__example" data-gallery-island="${s.id}" data-stylesheets="${sheets}"${s.frameClass ? html` data-frame-class="${s.frameClass}"` : ''}${s.bodyAttributes ? html` data-body-attributes="${JSON.stringify(s.bodyAttributes)}"` : ''}${s.frameStyle ? html` data-frame-style="${s.frameStyle}"` : ''}${s.module ? html` data-module="/${s.module}" data-sample="${JSON.stringify(SAMPLE)}"` : ''}>${markup ? html`<template>${raw(markup)}</template>` : ''}</div>
${markup ? code(markup) : ''}
</section>`;
}

function tokensSection() {
  return html`<section class="cg-gallery__section" id="tokens" aria-labelledby="tokens-h">
<h2 id="tokens-h">Tokens</h2>
<p>From <code>assets/ui/tokens.css</code>, read by this page as it loads, so the table is always the file. The swatch column shows each token in the current theme; switch the theme in the header to see the other.</p>
<div id="cg-gallery-tokens" class="cg-gallery__tokens" data-tokens-src="/assets/ui/tokens.css"><p class="cg-muted">Loading the tokens…</p></div>
<noscript><p>The token table needs JavaScript. The tokens themselves are in <code>assets/ui/tokens.css</code>.</p></noscript>
</section>`;
}

function typographySection() {
  return html`<section class="cg-gallery__section" id="type" aria-labelledby="type-h">
<h2 id="type-h">Type and base</h2>
<p class="cg-kicker">Kicker</p>
<h1 class="cg-gallery__h1">Heading one</h1><h2>Heading two</h2><h3>Heading three</h3><h4>Heading four</h4>
<p class="cg-lede">A lede paragraph introduces a record.</p>
<p>Body text with a <a href="#type">link</a>, <strong>strong</strong>, <em>emphasis</em> and <code>code</code>. <span class="cg-muted">Muted text.</span> Numbers align in <span class="cg-num">12,345</span>.</p>
</section>`;
}

/** @param {(typeof SPECIMENS)[number]} s */
function specimenSection(s) {
  const body = s.render();
  return html`<section class="cg-gallery__specimen" id="${s.id}" aria-labelledby="${s.id}-h">
<h3 id="${s.id}-h">${s.title}</h3>
<p class="cg-gallery__source">${s.stylesheet ? html`<code>assets/ui/components/${s.stylesheet}</code>` : ''}${s.templates.length ? html` · template${s.templates.length > 1 ? 's' : ''} ${s.templates.map((t, i) => html`${i ? ', ' : ''}<code>${t}()</code>`)}` : html` · markup only so far`}</p>
<div class="cg-gallery__example">${body}</div>
${code(toHtmlString(body))}
</section>`;
}

/** @param {{ version?: (path: string) => string | null }} [options] */
export function renderGallery({ version } = {}) {
  const body = html`<div class="cg-gallery">
<header class="cg-record-header">
<p class="cg-kicker">Design system</p>
<h1>Component gallery</h1>
<p class="cg-lede">Every token and component of the site, in isolation, drawn by the same templates and stylesheets as the pages. For people working on the site; not indexed.</p>
</header>
<nav class="cg-gallery__toc" aria-label="On this page"><ul><li><a href="#tokens">Tokens</a></li><li><a href="#type">Type and base</a></li><li><a href="#shell">Shell</a></li>${SPECIMENS.map((s) => html`<li><a href="#${s.id}">${s.title}</a></li>`)}</ul></nav>
${tokensSection()}
${typographySection()}
<section class="cg-gallery__section" id="shell" aria-labelledby="shell-h">
<h2 id="shell-h">Shell</h2>
<p>This page's own header (with the skip link, navigation, Support button and theme toggle), the Support dialog and the footer are <code>header()</code>, <code>supportModal()</code> and <code>footer()</code> from <code>packages/ui/src/templates/shell.js</code>, through <code>page()</code>, as on every page. <button class="cg-button" type="button" data-support-open>Open the Support dialog</button></p>
</section>
<section class="cg-gallery__section" id="components" aria-labelledby="components-h">
<h2 id="components-h">Components</h2>
${SPECIMENS.map(specimenSection)}
</section>
<section class="cg-gallery__section" id="apps" aria-labelledby="apps-h">
<h2 id="apps-h">App components</h2>
<p>The apps' own components, drawn by the apps' code with sample data, each in a frame with its app's stylesheet. The figures, references and names are made up.</p>
${APP_SPECIMENS.map(appSpecimenSection)}
</section>
</div>`;
  return page({
    title: 'Component gallery – Civgraph',
    description: 'The Civgraph design tokens and components, in isolation.',
    section: 'none',
    robots: ROBOTS,
    styles: ['assets/ui/gallery/gallery.css'],
    scripts: ['assets/ui/gallery/gallery.js'],
    body,
    version,
  });
}

export async function onRequestGet() {
  return new Response(toHtmlString(renderGallery()), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': ROBOTS,
    },
  });
}
