/**
 * The component gallery: /design-system/.
 *
 * REFACTOR-PLAN.md item 6. Every design token and every shell and UI component, in isolation,
 * with sample data and its markup, rendered at request time by the same template functions the
 * record pages use (functions/_templates/shell.js, functions/_templates/components/index.js) and
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
import { html, raw, toHtmlString } from '../../../core/src/html.js';
import { page, sectionNav } from '../templates/shell.js';
import { badges, citations, dataTable, facts, link, notice, partyChip } from '../templates/components/index.js';

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
    render: () => html`<p class="cg-gallery__row">${partyChip('Alliance Party', '#f6cb2f')} ${partyChip('Social Democratic and Labour Party', '#2aa82c')} ${partyChip('Independent', null)}</p>`,
  },
  {
    id: 'facts', title: 'Record facts', stylesheet: 'facts.css', templates: ['facts', 'link'],
    render: () => facts([
      { label: 'Born', value: '1921' },
      { label: 'Party', value: partyChip('Ulster Unionist Party', '#48a5ee') },
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
        { cells: [html`Candidate A <span class="cg-elected-mark" title="Elected">✓</span>`, partyChip('Party one', '#1f77b4'), '4,120', html`<span class="cg-delta--positive">+3.2</span>`], className: 'cg-elected' },
        ['Candidate B', partyChip('Party two', '#d62728'), '3,987', html`<span class="cg-delta--negative">−1.4</span>`],
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
    render: () => raw('<ul class="cg-legend"><li class="cg-legend__item"><span class="cg-legend__swatch" style="background:#1f77b4"></span>Party one</li><li class="cg-legend__item"><span class="cg-legend__swatch" style="background:#d62728"></span>Party two</li><li class="cg-legend__item"><span class="cg-legend__swatch" style="background:#7f7f7f"></span>Other</li></ul>'),
  },
  {
    id: 'chart', title: 'Chart frame', stylesheet: 'chart.css', templates: [],
    render: () => raw('<figure class="cg-chart"><svg viewBox="0 0 240 80" role="img" aria-label="Sample trend"><line x1="0" y1="70" x2="240" y2="70" stroke="var(--chart-baseline)"/><line x1="0" y1="40" x2="240" y2="40" stroke="var(--chart-grid)"/><polyline fill="none" stroke="var(--color-accent)" stroke-width="2" points="0,60 60,52 120,30 180,36 240,18"/></svg><figcaption>Share of the vote, sample data</figcaption></figure>'),
  },
];

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
<p>This page's own header (with the skip link, navigation, Support button and theme toggle), the Support dialog and the footer are <code>header()</code>, <code>supportModal()</code> and <code>footer()</code> from <code>functions/_templates/shell.js</code>, through <code>page()</code>, as on every page. <button class="cg-button" type="button" data-support-open>Open the Support dialog</button></p>
</section>
<section class="cg-gallery__section" id="components" aria-labelledby="components-h">
<h2 id="components-h">Components</h2>
${SPECIMENS.map(specimenSection)}
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
