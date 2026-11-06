#!/usr/bin/env node
/**
 * A demo page of the shell and every component in assets/ui/, for checking them by eye in
 * both themes. Written to tmp/ui-demo/index.html (gitignored, so it is never deployed);
 * serve the repository root and open /tmp/ui-demo/:
 *
 *   node tools/ui-demo.mjs
 *   npx wrangler pages dev . --port 8788      then http://127.0.0.1:8788/tmp/ui-demo/
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { html, raw, toHtmlString } from '../functions/_lib/html.js';
import { page, sectionNav } from '../functions/_templates/shell.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tmp', 'ui-demo', 'index.html');

const rows = [
  { name: 'Gerry Adams', party: 'Sinn Féin', colour: '#326760', votes: 22840, share: 71.08, delta: 4.6, elected: true },
  { name: 'Alex Attwood', party: 'SDLP', colour: '#2aa82c', votes: 5821, share: 16.5, delta: -1.2, elected: false },
  { name: 'Bill Manwaring', party: 'UUP', colour: '#48a5ee', votes: 2025, share: 6.3, delta: 0, elected: false },
];

const body = html`
${sectionNav({ items: [{ href: '/browse/', label: 'Browse' }, { href: '/browse/#/persons', label: 'People' }, { label: 'Component demo' }] })}
<header class="cg-record-header">
  <p class="cg-kicker">Design system</p>
  <h1>Shell and components</h1>
  <p class="cg-lede">Every component in assets/ui/components, on the tokens in assets/ui/tokens.css. Toggle the theme in the header to check dark mode.</p>
  <ul class="cg-badge-list"><li><span class="cg-badge">Badge</span></li><li><span class="cg-badge cg-badge--success">Elected</span></li><li><span class="cg-badge cg-badge--warning">Review</span></li><li><span class="cg-badge cg-badge--danger">Withdrawn</span></li><li><span class="cg-count">1,234 records</span></li></ul>
</header>

<h2>Buttons</h2>
<p><a class="cg-button cg-button--primary" href="#">Primary</a> <button class="cg-button" type="button">Default</button> <button class="cg-button" type="button" disabled>Disabled</button> <button class="cg-button cg-button--icon" type="button" aria-label="Close">&times;</button> <button class="cg-button cg-button--link" type="button">Link button</button></p>

<h2>Facts</h2>
<dl class="cg-facts"><dt>Born</dt><dd>6 October 1948</dd><dt>Parties</dt><dd><span class="cg-party"><span class="cg-party__swatch" style="--party-colour:#326760"></span>Sinn Féin</span></dd><dt>Constituencies</dt><dd>Belfast West, Louth</dd></dl>

<h2>Data table</h2>
<div class="cg-table-wrap"><table class="cg-table cg-table--sticky-first">
<caption>Belfast West, 2010</caption>
<thead><tr><th scope="col">Candidate</th><th scope="col">Party</th><th scope="col" class="cg-num">Votes</th><th scope="col" class="cg-num">Share</th><th scope="col" class="cg-num">Change</th></tr></thead>
<tbody>${rows.map((r) => html`<tr${raw(r.elected ? ' class="cg-elected"' : '')}><th scope="row">${r.name}${r.elected ? html` <span class="cg-elected-mark" aria-label="elected">&#10003;</span>` : ''}</th><td><span class="cg-party"><span class="cg-party__swatch" style="--party-colour:${r.colour}"></span>${r.party}</span></td><td class="cg-num">${r.votes.toLocaleString('en-GB')}</td><td class="cg-num">${r.share.toFixed(1)}%</td><td class="cg-num ${r.delta > 0 ? 'cg-delta--positive' : r.delta < 0 ? 'cg-delta--negative' : ''}">${r.delta > 0 ? '+' : ''}${r.delta.toFixed(1)}</td></tr>`)}</tbody>
</table></div>

<h2>Notices</h2>
<div class="cg-notice"><strong class="cg-notice__title">Coverage</strong><p>Results before 1973 are partial.</p></div>
<div class="cg-notice cg-notice--warning"><p>This record may combine more than one person.</p></div>

<h2>Tabs, toggle, segmented control</h2>
<ul class="cg-tabs__list"><li><a class="cg-tabs__tab" aria-current="true" href="#">Candidacies</a></li><li><a class="cg-tabs__tab" href="#">Offices</a></li><li><a class="cg-tabs__tab" href="#">Sources</a></li></ul>
<p><label class="cg-toggle"><input type="checkbox" checked> Printed labels</label></p>
<div class="cg-segmented"><a href="#" aria-current="true">Table</a><a href="#">Chart</a><a href="#">Map</a></div>

<h2>Cards</h2>
<ul class="cg-card-grid"><li><a class="cg-card" href="#"><p class="cg-card__title">Belfast West</p><p class="cg-card__meta">Westminster constituency, 1922-</p></a></li><li><a class="cg-card" href="#"><p class="cg-card__title">Louth</p><p class="cg-card__meta">Dáil constituency</p></a></li></ul>

<h2>Legend, citations, search, pager, skeleton</h2>
<ul class="cg-legend"><li class="cg-legend__item"><span class="cg-legend__swatch" style="--legend-colour:#326760"></span>Sinn Féin</li><li class="cg-legend__item"><span class="cg-legend__swatch" style="--legend-colour:#2aa82c"></span>SDLP</li></ul>
<ol class="cg-citations"><li><a href="#">Belfast Gazette, issue 2618, p. 153</a> <span class="cg-citations__licence">(Open Government Licence)</span></li></ol>
<form class="cg-search" role="search"><input type="search" name="q" aria-label="Search people" placeholder="Search people"><button class="cg-button" type="submit">Search</button></form>
<nav class="cg-pager" aria-label="Pages"><span class="cg-pager__status">Page 2 of 40</span><ul class="cg-pager__links"><li><a class="cg-button" href="#">Previous</a></li><li><a class="cg-button" href="#">Next</a></li></ul></nav>
<span class="cg-skeleton" style="width:60%"></span><span class="cg-skeleton" style="width:40%"></span>
`;

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, toHtmlString(page({ title: 'Component demo – Civgraph', description: 'The Civgraph shell and components.', section: 'none', robots: 'noindex', body })));
console.log(`Wrote ${path.relative(ROOT, OUT)}`);
