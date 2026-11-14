/**
 * Embeds (el-context): the widget's address and snippet, the switch that keeps the app's "Embed
 * this" panel off until the owner approves (a local preview only), the licences the widget names
 * (embed/licences.json held to the source ledger), and its words keyed (R10).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EMBED } from '../../site/apps/elections/config.js';
import {
  EMBED_PREVIEW_KEY, WIDGET_TEXT, embedOffered, embedParams, embedSnippet, embedUrl, hostOf, sourceLicences,
} from '../../site/apps/elections/lib/embed.js';
import { LEDGER } from '../../scripts/build/build-licence-page.mjs';
import { OUT, licenceSlice } from '../../scripts/build/elections-app/embed-licences.mjs';

const read = (/** @type {string} */ rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('embeds are OFF: the config switch, and only a local server may preview the panel', () => {
  assert.equal(EMBED.offered, false, 'switching embeds on is the owner\'s decision (lib/embed.js says how)');
  assert.equal(EMBED_PREVIEW_KEY, 'civgraph.electionsEmbedPreview');
  assert.equal(embedOffered(false, 'civgraph.net', '1'), false);
  assert.equal(embedOffered(false, 'preview.civgraph.pages.dev', '1'), false);
  assert.equal(embedOffered(false, 'localhost', null), false);
  assert.equal(embedOffered(false, '127.0.0.1', '1'), true);
  assert.equal(embedOffered(true, 'civgraph.net', null), true);
  // The other switch: only this site may frame the widget (elections-app-prep holds the header).
  assert.match(read('site/_headers'), /\/apps\/elections\/embed\/\*\n(?: {2}.*\n)*? {2}Content-Security-Policy: frame-ancestors 'self';/);
});

test('the widget\'s address, its parameters and the snippet', () => {
  assert.equal(embedUrl('https://civgraph.net', 'dail-eireann-2020-02-08'), 'https://civgraph.net/apps/elections/embed/?e=dail-eireann-2020-02-08');
  assert.equal(embedUrl('https://civgraph.net/', 'x-2020-01-01', 'cork-south-west'), 'https://civgraph.net/apps/elections/embed/?e=x-2020-01-01&c=cork-south-west');
  assert.deepEqual(embedParams('?e=dail-eireann-2020-02-08&c=cork-south-west'), { election: 'dail-eireann-2020-02-08', contest: 'cork-south-west' });
  assert.deepEqual(embedParams('?e=<script>&c='), { election: null, contest: null });
  const s = embedSnippet({ origin: 'https://civgraph.net', election: 'e-2022-05-05', contest: 'foyle', title: 'Foyle – "2022" & more' });
  assert.match(s, /^<iframe src="https:\/\/civgraph\.net\/apps\/elections\/embed\/\?e=e-2022-05-05&amp;c=foyle" title="Foyle – &quot;2022&quot; &amp; more"/);
  assert.match(s, /loading="lazy"/);
  // A plain link back for pages that strip iframes, with the licence.
  assert.match(s, /<a href="https:\/\/civgraph\.net\/elections\/e-2022-05-05\/foyle\/">.*<\/a> \(Civgraph Elections, CC BY 4\.0\)/);
});

test('the licence slice is the source ledger\'s, as the builder writes it', () => {
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
  assert.equal(read(OUT), licenceSlice(ledger), `${OUT} is out of date: node scripts/build/elections-app/embed-licences.mjs`);
  const slice = JSON.parse(read(OUT));
  assert.match(slice.own.title, /CC BY 4\.0/);
  assert.ok(slice.sources.length > 10);
});

test('each source\'s licence is named by its link\'s host, the most specific match first', () => {
  const slice = JSON.parse(read(OUT));
  const { named, unmatched } = sourceLicences([
    'https://www.eoni.org.uk/Elections/results/2022', 'https://en.wikipedia.org/wiki/Foyle', 'https://data.gov.ie/dataset/x',
    'https://www.britishnewspaperarchive.co.uk/viewer/x', 'not a url', 'https://www.eoni.org.uk/other',
  ], slice);
  const by = Object.fromEntries(named.map((s) => [s.publisher, s.rights]));
  assert.equal(by['Electoral Office for Northern Ireland'], 'OGL-3.0');
  assert.equal(by['Wikimedia Foundation contributors'], 'CC-BY-SA');
  assert.equal(named.find((s) => s.hosts.includes('data.gov.ie'))?.id, slice.sources.find((/** @type {{ hosts: string[] }} */ s) => s.hosts.includes('data.gov.ie')).id);
  assert.equal(named.length, 3, 'each source once');
  assert.equal(unmatched, 1);
  assert.equal(hostOf('https://WWW.Example.org/x'), 'example.org');
  assert.equal(hostOf(null), '');
});

test('every word of the widget and the panel is keyed for translation in en.json (R10)', async () => {
  globalThis.location = /** @type {Location} */ (/** @type {unknown} */ ({ hostname: 'civgraph.net', origin: 'https://civgraph.net', search: '' }));
  const { EMBED_TEXT, embedOfferSection } = await import('../../site/apps/elections/views/embed-offer.js');
  const english = new Set(Object.values(JSON.parse(read('site/assets/i18n/en.json')).strings));
  for (const s of [...Object.values(EMBED_TEXT), ...Object.values(WIDGET_TEXT)]) assert.ok(english.has(s), `not keyed: ${s}`);
  // Off: the panel is not drawn at all.
  assert.equal(embedOfferSection({ election: 'e', title: 't' }), '');
});
